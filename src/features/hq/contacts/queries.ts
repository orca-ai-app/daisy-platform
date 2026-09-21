/**
 * HQ Contacts (CRM) queries — read-only directory over da_customers.
 *
 * RLS gives HQ users full read access to da_customers, so a plain
 * `supabase.from('da_customers').select(...)` returns every contact.
 *
 * The list query is paginated server-side via `range()` so only the visible
 * page is fetched, and totals come back via `count: 'exact'`. Booking counts
 * are derived from a second query keyed on the page's customer ids — the same
 * `.in('customer_id', ids)` + client-side count pattern used by the franchisee
 * customers list (features/franchisee/customers/customersQueries.ts).
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/** Postgrest "relation does not exist" — match the codebase's defensive helper. */
const TABLE_MISSING_CODES = new Set(['42P01', 'PGRST205']);

function isTableMissing(code: string | null | undefined): boolean {
  return TABLE_MISSING_CODES.has(code ?? '');
}

/**
 * Escape a user-supplied search term for use inside a Postgrest `or()` filter.
 * `%`, `,`, `(` and `)` all have structural meaning there, so strip them.
 */
function escapeSearchTerm(term: string): string {
  return term.replace(/[%,()]/g, '');
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Marketing status filter for the contacts list. */
export type MarketingFilter = 'all' | 'emailable' | 'suppressed';

export interface ContactRow {
  id: string;
  created_at: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  postcode: string | null;
  marketing_opt_out: boolean;
  source: string | null;
  booking_count: number;
}

export interface HQContactsFilters {
  /** Free-text search across first_name, last_name, email. */
  search?: string;
  /** Marketing status filter. Default 'all'. */
  marketing?: MarketingFilter;
  /** 0-indexed page. Default 0. */
  page?: number;
  /** Rows per page. Default 50. */
  pageSize?: number;
}

export interface HQContactsResult {
  rows: ContactRow[];
  totalCount: number;
}

// ---------------------------------------------------------------------------
// Shared query-builder helpers
// ---------------------------------------------------------------------------

/** Row shape selected from da_customers (before booking counts are attached). */
interface RawContact {
  id: string;
  created_at: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  postcode: string | null;
  marketing_opt_out: boolean;
  source: string | null;
}

/**
 * Attach a booking_count to each contact by fetching all bookings for the
 * given customer ids and counting client-side (mirrors the franchisee list).
 */
async function attachBookingCounts(contacts: RawContact[]): Promise<ContactRow[]> {
  if (contacts.length === 0) return [];

  const ids = contacts.map((c) => c.id);
  const { data: bookings, error } = await supabase
    .from('da_bookings')
    .select('customer_id')
    .in('customer_id', ids);

  // Booking counts are a nice-to-have; if the table is missing or the query
  // fails, fall back to zero rather than breaking the whole directory.
  const countMap = new Map<string, number>();
  if (!error) {
    for (const b of (bookings ?? []) as { customer_id: string }[]) {
      countMap.set(b.customer_id, (countMap.get(b.customer_id) ?? 0) + 1);
    }
  }

  return contacts.map((c) => ({
    ...c,
    booking_count: countMap.get(c.id) ?? 0,
  }));
}

// ---------------------------------------------------------------------------
// useHQContacts — paginated directory
// ---------------------------------------------------------------------------

/**
 * Paginated, filterable list of da_customers with a booking count per row.
 * Server-side `range()` pagination; totals via `count: 'exact'`.
 */
export function useHQContacts(filters: HQContactsFilters = {}) {
  const { search = '', marketing = 'all', page = 0, pageSize = 50 } = filters;

  const query = useQuery<HQContactsResult>({
    queryKey: ['hq', 'contacts', { search, marketing, page }],
    queryFn: async () => {
      let qb = supabase
        .from('da_customers')
        .select(
          'id, created_at, first_name, last_name, email, phone, postcode, marketing_opt_out, source',
          { count: 'exact' },
        )
        .order('last_name', { ascending: true })
        .order('first_name', { ascending: true });

      const trimmed = search.trim();
      if (trimmed.length > 0) {
        const term = escapeSearchTerm(trimmed);
        qb = qb.or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,email.ilike.%${term}%`);
      }

      if (marketing === 'emailable') {
        qb = qb.eq('marketing_opt_out', false);
      } else if (marketing === 'suppressed') {
        qb = qb.eq('marketing_opt_out', true);
      }

      const from = page * pageSize;
      const to = from + pageSize - 1;
      const { data, count, error } = await qb.range(from, to);

      if (error) {
        if (isTableMissing(error.code)) return { rows: [], totalCount: 0 };
        throw error;
      }

      const rows = await attachBookingCounts((data ?? []) as RawContact[]);
      return { rows, totalCount: count ?? 0 };
    },
  });

  return {
    rows: query.data?.rows ?? [],
    totalCount: query.data?.totalCount ?? 0,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
  };
}

// ---------------------------------------------------------------------------
// useAllMatchingContactIds — select-all-across-pages
// ---------------------------------------------------------------------------

/** Chunk size for paged id fetches. */
const ID_CHUNK = 1000;
/** Hard cap so an accidental "select all" can't fetch an unbounded set. */
const ID_CAP = 25_000;

export interface AllMatchingArgs {
  search?: string;
  marketing?: MarketingFilter;
}

/**
 * Returns a function that fetches ALL matching customer ids for the given
 * filters, paged internally in chunks of 1000 until exhausted (capped at
 * 25,000). Powers the "Select all N matching" action across pages.
 *
 * This is a plain async function rather than a react-query hook because it's
 * invoked imperatively on a button click, not rendered.
 */
export function useAllMatchingContactIds() {
  return async ({ search = '', marketing = 'all' }: AllMatchingArgs = {}): Promise<string[]> => {
    const ids: string[] = [];
    const trimmed = search.trim();
    const term = trimmed.length > 0 ? escapeSearchTerm(trimmed) : null;

    for (let page = 0; ids.length < ID_CAP; page += 1) {
      let qb = supabase
        .from('da_customers')
        .select('id')
        .order('last_name', { ascending: true })
        .order('first_name', { ascending: true });

      if (term) {
        qb = qb.or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,email.ilike.%${term}%`);
      }
      if (marketing === 'emailable') {
        qb = qb.eq('marketing_opt_out', false);
      } else if (marketing === 'suppressed') {
        qb = qb.eq('marketing_opt_out', true);
      }

      const from = page * ID_CHUNK;
      const to = from + ID_CHUNK - 1;
      const { data, error } = await qb.range(from, to);

      if (error) {
        if (isTableMissing(error.code)) break;
        throw error;
      }

      const batch = (data ?? []) as { id: string }[];
      for (const row of batch) ids.push(row.id);

      // Last page reached when we got fewer rows than a full chunk.
      if (batch.length < ID_CHUNK) break;
    }

    return ids.slice(0, ID_CAP);
  };
}
