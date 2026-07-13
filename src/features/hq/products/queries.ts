/**
 * Merchandise-product queries + mutations for HQ.
 *
 * - useAllProducts(): SELECT every row from da_products (including inactive,
 *   e.g. the unpriced First Aid Kit) ordered by sort_order. RLS lets any
 *   authenticated user read the catalogue.
 * - useCreateProduct() / useUpdateProduct(): POST to the create-product /
 *   update-product Edge Functions (HQ-only server-side). Errors carry the
 *   server's request_id so toasts can show a support reference.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface Product {
  id: string;
  name: string;
  description: string | null;
  rrp_pence: number | null;
  active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface CreateProductPayload {
  name: string;
  description?: string;
  rrp_pence: number;
  active?: boolean;
  sort_order?: number;
}

export interface UpdateProductPayload {
  product_id: string;
  name?: string;
  description?: string;
  rrp_pence?: number;
  active?: boolean;
  sort_order?: number;
}

export const HQ_PRODUCTS_QUERY_KEY = ['hq', 'products'] as const;

/** Postgrest error codes that indicate a table doesn't exist yet. */
const TABLE_MISSING_CODES = new Set(['42P01', 'PGRST205']);

function isTableMissing(code: string | null | undefined): boolean {
  return TABLE_MISSING_CODES.has(code ?? '');
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export function useAllProducts() {
  return useQuery<Product[]>({
    queryKey: HQ_PRODUCTS_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('da_products')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });

      if (error) {
        if (isTableMissing(error.code)) return [];
        throw error;
      }
      return (data ?? []) as Product[];
    },
  });
}

// ---------------------------------------------------------------------------
// Write helpers
// ---------------------------------------------------------------------------

async function callEdgeFunction<TResult>(path: string, payload: unknown): Promise<TResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) {
    throw new Error('You must be signed in to manage products.');
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

// ---------------------------------------------------------------------------
// Create / update
// ---------------------------------------------------------------------------

export function useCreateProduct() {
  const queryClient = useQueryClient();
  return useMutation<Product, Error, CreateProductPayload>({
    mutationFn: (payload) => callEdgeFunction<Product>('create-product', payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: HQ_PRODUCTS_QUERY_KEY });
    },
  });
}

export function useUpdateProduct() {
  const queryClient = useQueryClient();
  return useMutation<Product, Error, UpdateProductPayload>({
    mutationFn: (payload) => callEdgeFunction<Product>('update-product', payload),
    onSuccess: (updated) => {
      // Punch the updated row into the list cache immediately so the
      // table reflects the change before the invalidation refetch lands.
      queryClient.setQueryData<Product[]>(HQ_PRODUCTS_QUERY_KEY, (prev) =>
        prev ? prev.map((p) => (p.id === updated.id ? updated : p)) : [updated],
      );
      void queryClient.invalidateQueries({ queryKey: HQ_PRODUCTS_QUERY_KEY });
    },
  });
}
