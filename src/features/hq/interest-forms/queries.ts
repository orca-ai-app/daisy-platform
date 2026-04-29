/**
 * Interest-form queries + mutations for HQ.
 *
 * - useInterestForms(filters): SELECT from da_interest_forms with optional
 *   status filter and free-text search (postcode / contact_email / contact_name).
 *   Server-side pagination via TanStack `useInfiniteQuery`.
 * - useUpdateInterestForm(): POSTs to the `update-interest-form` Edge Function
 *   with the caller's session JWT. Edge Function enforces HQ-only and writes
 *   the activity row.
 *
 * Reference: docs/PRD-technical.md §4.11.
 */

import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type UseInfiniteQueryResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type InterestFormStatus = 'new' | 'contacted' | 'booked' | 'declined' | 'expired';

export const INTEREST_FORM_STATUSES: InterestFormStatus[] = [
  'new',
  'contacted',
  'booked',
  'declined',
  'expired',
];

export interface InterestForm {
  id: string;
  created_at: string;
  updated_at: string;
  postcode: string;
  num_attendees: number;
  preferred_dates: string | null;
  venue_preference: string | null;
  contact_name: string;
  contact_email: string;
  contact_phone: string | null;
  status: InterestFormStatus;
  assigned_freelancer: string | null;
  notes: string | null;
}

export interface InterestFormUpdate {
  status?: InterestFormStatus;
  assigned_freelancer?: string | null;
  notes?: string | null;
}

export interface InterestFormFilters {
  /** When undefined, no status filter is applied (i.e. "all"). */
  status?: InterestFormStatus;
  /** Free-text search over postcode / contact_email / contact_name. */
  search?: string;
  /** Page size. Defaults to 20. */
  limit?: number;
}

interface InterestFormPage {
  rows: InterestForm[];
  nextOffset: number | null;
}

const DEFAULT_LIMIT = 20;

export const INTEREST_FORMS_QUERY_KEY = ['interest-forms'] as const;

async function fetchInterestFormPage(
  filters: InterestFormFilters,
  offset: number,
): Promise<InterestFormPage> {
  const limit = filters.limit ?? DEFAULT_LIMIT;
  let query = supabase
    .from('da_interest_forms')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (filters.status) {
    query = query.eq('status', filters.status);
  }

  const search = filters.search?.trim();
  if (search && search.length > 0) {
    // Escape % and _ so user's free text doesn't accidentally turn into a wildcard.
    const safe = search.replace(/[%_]/g, (c) => `\\${c}`);
    // OR across postcode / contact_email / contact_name.
    query = query.or(
      `postcode.ilike.%${safe}%,contact_email.ilike.%${safe}%,contact_name.ilike.%${safe}%`,
    );
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`useInterestForms: ${error.message}`);
  }

  const rows = (data ?? []) as InterestForm[];
  const nextOffset = rows.length === limit ? offset + limit : null;
  return { rows, nextOffset };
}

/**
 * Paginated, infinite-query hook for `da_interest_forms`.
 *
 * The `data.pages` array contains one `{ rows, nextOffset }` page per fetch.
 * Flatten with `data.pages.flatMap(p => p.rows)` for rendering.
 */
export function useInterestForms(
  filters: InterestFormFilters = {},
): UseInfiniteQueryResult<{ pages: InterestFormPage[]; pageParams: number[] }, Error> {
  return useInfiniteQuery({
    queryKey: [...INTEREST_FORMS_QUERY_KEY, filters],
    queryFn: ({ pageParam }) => fetchInterestFormPage(filters, pageParam ?? 0),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
  });
}

interface UpdateInterestFormArgs {
  id: string;
  fields: InterestFormUpdate;
}

async function callUpdateInterestForm({
  id,
  fields,
}: UpdateInterestFormArgs): Promise<InterestForm> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) {
    throw new Error('You must be signed in to edit interest forms.');
  }

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/update-interest-form`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ id, fields }),
  });

  if (!response.ok) {
    let message = `Update failed (${response.status})`;
    try {
      const errBody = (await response.json()) as { error?: string };
      if (errBody.error) message = errBody.error;
    } catch {
      // body wasn't JSON; keep the generic message.
    }
    throw new Error(message);
  }

  return (await response.json()) as InterestForm;
}

export function useUpdateInterestForm() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: callUpdateInterestForm,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: INTEREST_FORMS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ['activities'] });
      // Dashboard "new enquiries" attention item also depends on these counts.
      void queryClient.invalidateQueries({ queryKey: ['hq', 'attention'] });
    },
  });
}
