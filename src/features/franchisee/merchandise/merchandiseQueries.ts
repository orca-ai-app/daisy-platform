/**
 * TanStack Query hooks for the franchisee merchandise surface.
 *
 * Read:  anon client + RLS. da_products is readable by any authenticated
 *        user; da_product_sales uses the `franchisee_own` policy so no
 *        client-side franchisee_id filter is needed — RLS scopes the rows
 *        (exactly like discounts).
 * Write: POST to create-product-sale / delete-product-sale Edge Functions
 *        (service_role server-side, franchisee_id stamped from JWT,
 *        total_pence computed server-side).
 *
 * Key factory: franchiseeKeys from ../queryKeys (frozen contract).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatInTimeZone } from 'date-fns-tz';
import { supabase } from '@/lib/supabase';
import { franchiseeKeys } from '../queryKeys';

const STALE_TIME = 2 * 60_000;

/** Postgrest error codes that indicate a table doesn't exist yet. */
const TABLE_MISSING_CODES = new Set(['42P01', 'PGRST205']);

function isTableMissing(code: string | null | undefined): boolean {
  return TABLE_MISSING_CODES.has(code ?? '');
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Catalogue item kind. `elearning` items are fulfilled by sending the buyer
 * to `fulfilment_url` after payment; `physical` items are handed over or
 * posted by the franchisee.
 */
export type ProductKind = 'physical' | 'elearning';

export interface Product {
  id: string;
  name: string;
  description: string | null;
  rrp_pence: number | null;
  active: boolean;
  sort_order: number;
  /** Nullable while the catalogue migration is still rolling out. */
  kind: ProductKind | null;
  fulfilment_url: string | null;
  fulfilment_notes: string | null;
  created_at: string;
  updated_at: string;
}

export type ProductSalePaymentMethod = 'cash' | 'card' | 'other';

/**
 * How a sale reached the franchisee: `in_person` rows are keyed in by hand
 * on this page, `online` rows arrive from a Stripe checkout on the public
 * booking page. Nullable for rows written before the column existed — treat
 * a missing value as `in_person` (see `saleChannel`).
 */
export type ProductSaleChannel = 'in_person' | 'online';

export interface ProductSale {
  id: string;
  franchisee_id: string;
  product_id: string;
  quantity: number;
  unit_price_pence: number;
  total_pence: number;
  payment_method: ProductSalePaymentMethod;
  /** DATE column, 'YYYY-MM-DD'. */
  sold_at: string;
  course_instance_id: string | null;
  note: string | null;
  /** Null on rows written before the channel column shipped. */
  channel: ProductSaleChannel | null;
  created_at: string;
}

/** A sale's channel, defaulting pre-migration rows to the manual ledger. */
export function saleChannel(sale: Pick<ProductSale, 'channel'>): ProductSaleChannel {
  return sale.channel === 'online' ? 'online' : 'in_person';
}

/** A sale row joined to its product name and (optional) linked class. */
export interface ProductSaleRow extends ProductSale {
  product_name: string;
  course_event_date: string | null;
  course_venue_name: string | null;
}

export interface CreateProductSalePayload {
  product_id: string;
  quantity: number;
  unit_price_pence: number;
  payment_method: ProductSalePaymentMethod;
  /** 'YYYY-MM-DD'. */
  sold_at: string;
  course_instance_id?: string;
  note?: string;
}

/** A course-instance option for linking a sale to a class. */
export interface SaleCourseOption {
  id: string;
  /** DATE column, 'YYYY-MM-DD'. */
  event_date: string;
  venue_name: string | null;
  template_name: string | null;
}

/**
 * One franchisee's own listing of a catalogue product: their price, whether
 * it shows on their public booking page, and the VAT rate they charge.
 */
export interface FranchiseeProduct {
  id: string;
  franchisee_id: string;
  product_id: string;
  price_pence: number;
  is_online: boolean;
  /** Percentage (0 / 5 / 20), or null for "no VAT applied". */
  vat_rate: number | null;
  created_at: string;
  updated_at: string;
}

export interface UpsertFranchiseeProductPayload {
  product_id: string;
  price_pence: number;
  is_online: boolean;
  vat_rate?: number | null;
}

/** A catalogue product paired with this franchisee's listing, if any. */
export interface ShopItem {
  product: Product;
  listing: FranchiseeProduct | null;
}

// ---------------------------------------------------------------------------
// Date helper — Europe/London wall-clock, never toISOString().split('T')[0]
// ---------------------------------------------------------------------------

/** Today's date as 'YYYY-MM-DD' in Europe/London. */
export function todayLondon(): string {
  return formatInTimeZone(new Date(), 'Europe/London', 'yyyy-MM-dd');
}

/** Today shifted by `days` (may be negative) as 'YYYY-MM-DD' in Europe/London. */
function londonDatePlusDays(days: number): string {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return formatInTimeZone(d, 'Europe/London', 'yyyy-MM-dd');
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Active products from the network-wide catalogue, ordered by sort_order.
 * RLS: any authenticated user can SELECT da_products.
 */
export function useProducts() {
  return useQuery<Product[]>({
    queryKey: franchiseeKeys.merchandiseProducts(),
    staleTime: STALE_TIME,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('da_products')
        .select('*')
        .eq('active', true)
        .order('sort_order', { ascending: true });

      if (error) {
        if (isTableMissing(error.code)) return [];
        throw error;
      }
      return (data ?? []) as Product[];
    },
  });
}

type ProductSaleJoined = ProductSale & {
  product: { name: string } | null;
  course_instance: { event_date: string | null; venue_name: string | null } | null;
};

/**
 * Returns all merchandise sales owned by the signed-in franchisee.
 * RLS on da_product_sales filters to rows where franchisee_id matches the
 * caller — no client-side .eq() filter required.
 */
export function useOwnProductSales() {
  return useQuery<ProductSaleRow[]>({
    queryKey: franchiseeKeys.merchandiseSales(),
    staleTime: STALE_TIME,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('da_product_sales')
        .select(
          `*,
           product:da_products ( name ),
           course_instance:da_course_instances ( event_date, venue_name )`,
        )
        .order('sold_at', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) {
        if (isTableMissing(error.code)) return [];
        throw error;
      }

      return ((data ?? []) as unknown as ProductSaleJoined[]).map((row) => ({
        ...row,
        product_name: row.product?.name ?? 'Unknown product',
        course_event_date: row.course_instance?.event_date ?? null,
        course_venue_name: row.course_instance?.venue_name ?? null,
      }));
    },
  });
}

/**
 * The franchisee's own course instances within the last 60 days and next
 * 7 days — the options for linking a sale to a class. RLS scopes the rows.
 */
export function useSaleCourseOptions() {
  return useQuery<SaleCourseOption[]>({
    queryKey: franchiseeKeys.merchandiseCourseOptions(),
    staleTime: STALE_TIME,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('da_course_instances')
        .select(
          `id,
           event_date,
           venue_name,
           template:da_course_templates ( name )`,
        )
        .gte('event_date', londonDatePlusDays(-60))
        .lte('event_date', londonDatePlusDays(7))
        .order('event_date', { ascending: false });

      if (error) {
        if (isTableMissing(error.code)) return [];
        throw error;
      }

      type Joined = {
        id: string;
        event_date: string;
        venue_name: string | null;
        template: { name: string } | null;
      };

      return ((data ?? []) as unknown as Joined[]).map((row) => ({
        id: row.id,
        event_date: row.event_date,
        venue_name: row.venue_name,
        template_name: row.template?.name ?? null,
      }));
    },
  });
}

/**
 * The signed-in franchisee's own da_franchisee_products rows. RLS is
 * franchisee-scoped exactly like da_product_sales, so no client-side
 * franchisee_id filter is needed.
 */
export function useOwnFranchiseeProducts() {
  return useQuery<FranchiseeProduct[]>({
    queryKey: franchiseeKeys.merchandiseShop(),
    staleTime: STALE_TIME,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await supabase.from('da_franchisee_products').select('*');

      if (error) {
        if (isTableMissing(error.code)) return [];
        throw error;
      }
      return (data ?? []) as FranchiseeProduct[];
    },
  });
}

/**
 * Every active catalogue product paired with this franchisee's own listing.
 * Products the franchisee has never priced come through with `listing: null`
 * so the shop table can still offer them a row to fill in.
 */
export function useShopItems() {
  const products = useProducts();
  const listings = useOwnFranchiseeProducts();

  const byProductId = new Map((listings.data ?? []).map((l) => [l.product_id, l]));
  const items: ShopItem[] = (products.data ?? []).map((product) => ({
    product,
    listing: byProductId.get(product.id) ?? null,
  }));

  return {
    items,
    isLoading: products.isLoading || listings.isLoading,
    error: products.error ?? listings.error ?? null,
  };
}

// ---------------------------------------------------------------------------
// Write helpers
// ---------------------------------------------------------------------------

async function callEdgeFunction<TResult>(path: string, payload: unknown): Promise<TResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) {
    throw new Error('You must be signed in to record merchandise sales.');
  }

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${path}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    let requestId: string | undefined;
    try {
      const body = (await response.json()) as { error?: string; request_id?: string };
      if (body.error) message = body.error;
      if (typeof body.request_id === 'string') requestId = body.request_id;
    } catch {
      // body wasn't JSON
    }
    const err = new Error(message);
    if (requestId) (err as Error & { request_id?: string }).request_id = requestId;
    throw err;
  }

  return (await response.json()) as TResult;
}

function invalidateMerchandise(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: franchiseeKeys.merchandise() });
  // The dashboard's "Merchandise this month" KPI reads da_product_sales too.
  void queryClient.invalidateQueries({ queryKey: franchiseeKeys.dashboardStats() });
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export function useCreateProductSale() {
  const queryClient = useQueryClient();
  return useMutation<ProductSale, Error, CreateProductSalePayload>({
    mutationFn: (payload) => callEdgeFunction<ProductSale>('create-product-sale', payload),
    onSuccess: () => {
      invalidateMerchandise(queryClient);
    },
  });
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export function useDeleteProductSale() {
  const queryClient = useQueryClient();
  return useMutation<{ ok: boolean }, Error, { sale_id: string }>({
    mutationFn: (payload) => callEdgeFunction<{ ok: boolean }>('delete-product-sale', payload),
    onSuccess: () => {
      invalidateMerchandise(queryClient);
    },
  });
}

// ---------------------------------------------------------------------------
// Shop listing upsert
// ---------------------------------------------------------------------------

/**
 * Create or update this franchisee's listing for a catalogue product. The
 * Edge Function derives franchisee_id from the JWT and upserts on
 * (franchisee_id, product_id), so the client never sends an id.
 */
export function useUpsertFranchiseeProduct() {
  const queryClient = useQueryClient();
  return useMutation<FranchiseeProduct, Error, UpsertFranchiseeProductPayload>({
    mutationFn: (payload) =>
      callEdgeFunction<FranchiseeProduct>('upsert-franchisee-product', payload),
    onSuccess: () => {
      invalidateMerchandise(queryClient);
    },
  });
}
