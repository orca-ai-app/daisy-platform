/**
 * HQ billing queries + the preview-billing-run mutation.
 *
 * - `useBillingRuns(filters)` — list of `da_billing_runs` joined to franchisee
 *   summary fields. Empty in M1; Phase 2 starts populating.
 * - `useBillingRun(id)` — single billing run with full territory_breakdown.
 * - `usePreviewBillingRun()` — TanStack mutation calling the
 *   `preview-billing-run` Edge Function. Does NOT invalidate the runs list
 *   because preview never writes a row.
 *
 * Reference:
 *   - docs/PRD-technical.md §4.13 (da_billing_runs + territory_breakdown)
 *   - docs/PRD-technical.md §7 (fee math)
 *   - docs/M1-build-plan.md §6 Wave 4 Agent 4C
 */

import {
  useMutation,
  useQuery,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------

export type BillingPaymentStatus = 'pending' | 'sent' | 'paid' | 'failed' | 'retry';

export interface TerritoryBreakdownRow {
  territory_id: string;
  postcode_prefix: string;
  territory_name: string;
  base_fee_pence: number;
  revenue_pence: number;
  percentage_fee_pence: number;
  fee_charged_pence: number;
  logic:
    | 'base_fee_wins'
    | 'percentage_wins'
    | 'base_fee_wins_pro_rata'
    | 'percentage_wins_pro_rata';
}

export interface BillingRun {
  id: string;
  created_at: string;
  franchisee_id: string;
  billing_period_start: string;
  billing_period_end: string;
  territory_breakdown: TerritoryBreakdownRow[];
  total_base_fees_pence: number;
  total_percentage_fees_pence: number;
  total_due_pence: number;
  gocardless_payment_id: string | null;
  payment_status: BillingPaymentStatus;
  retry_count: number;
  paid_at: string | null;
  notes: string | null;
}

export interface BillingRunRow extends BillingRun {
  franchisee_number: string;
  franchisee_name: string;
}

export interface FranchiseePreview {
  franchisee_id: string;
  franchisee_number: string;
  franchisee_name: string;
  fee_tier: number;
  billing_period_start: string;
  billing_period_end: string;
  territory_breakdown: TerritoryBreakdownRow[];
  total_base_fees_pence: number;
  total_percentage_fees_pence: number;
  total_due_pence: number;
  pro_rata_applied: boolean;
}

export interface BillingRunFilters {
  franchiseeId?: string;
  paymentStatus?: BillingPaymentStatus | 'all';
  /** ISO YYYY-MM-DD; rows whose period ends on or after this date. */
  periodFrom?: string;
  /** ISO YYYY-MM-DD; rows whose period starts on or before this date. */
  periodTo?: string;
}

// ---------------------------------------------------------------------
// useBillingRuns
// ---------------------------------------------------------------------

/**
 * List the `da_billing_runs` table with the franchisee number + name pulled
 * across the FK chain. Phase 2 will start populating this; M1 returns an
 * empty list in normal use (preview never writes).
 */
export function useBillingRuns(
  filters: BillingRunFilters = {},
): UseQueryResult<BillingRunRow[], Error> {
  return useQuery({
    queryKey: ['hq', 'billing-runs', filters],
    queryFn: async () => {
      let query = supabase
        .from('da_billing_runs')
        .select(
          `id, created_at, franchisee_id, billing_period_start, billing_period_end,
           territory_breakdown, total_base_fees_pence, total_percentage_fees_pence,
           total_due_pence, gocardless_payment_id, payment_status, retry_count,
           paid_at, notes,
           franchisee:da_franchisees!inner ( number, name )`,
        )
        .order('billing_period_start', { ascending: false });

      if (filters.franchiseeId) {
        query = query.eq('franchisee_id', filters.franchiseeId);
      }
      if (filters.paymentStatus && filters.paymentStatus !== 'all') {
        query = query.eq('payment_status', filters.paymentStatus);
      }
      if (filters.periodFrom) {
        query = query.gte('billing_period_end', filters.periodFrom);
      }
      if (filters.periodTo) {
        query = query.lte('billing_period_start', filters.periodTo);
      }

      const { data, error } = await query;
      if (error) {
        // PGRST205 / 42P01 = table missing in a fresh project.
        if (error.code === '42P01' || error.code === 'PGRST205') return [];
        throw new Error(`useBillingRuns: ${error.message}`);
      }

      type Joined = BillingRun & {
        franchisee: { number: string; name: string } | null;
      };

      return ((data ?? []) as unknown as Joined[]).map((row) => ({
        ...row,
        franchisee_number: row.franchisee?.number ?? '—',
        franchisee_name: row.franchisee?.name ?? 'Unknown',
      })) as BillingRunRow[];
    },
  });
}

// ---------------------------------------------------------------------
// useBillingRun (single)
// ---------------------------------------------------------------------

export function useBillingRun(id: string | undefined): UseQueryResult<BillingRunRow | null, Error> {
  return useQuery({
    enabled: !!id,
    queryKey: ['hq', 'billing-run', id],
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase
        .from('da_billing_runs')
        .select(
          `id, created_at, franchisee_id, billing_period_start, billing_period_end,
           territory_breakdown, total_base_fees_pence, total_percentage_fees_pence,
           total_due_pence, gocardless_payment_id, payment_status, retry_count,
           paid_at, notes,
           franchisee:da_franchisees!inner ( number, name )`,
        )
        .eq('id', id)
        .maybeSingle();

      if (error) {
        if (error.code === '42P01' || error.code === 'PGRST205') return null;
        throw new Error(`useBillingRun: ${error.message}`);
      }
      if (!data) return null;

      type Joined = BillingRun & {
        franchisee: { number: string; name: string } | null;
      };
      const row = data as unknown as Joined;
      return {
        ...row,
        franchisee_number: row.franchisee?.number ?? '—',
        franchisee_name: row.franchisee?.name ?? 'Unknown',
      } as BillingRunRow;
    },
  });
}

// ---------------------------------------------------------------------
// useFranchiseesForSelect
// ---------------------------------------------------------------------

export interface FranchiseeOption {
  id: string;
  number: string;
  name: string;
}

/**
 * Active, non-HQ franchisees for the preview dialog's dropdown.
 */
export function useActiveFranchisees(): UseQueryResult<FranchiseeOption[], Error> {
  return useQuery({
    queryKey: ['hq', 'billing', 'active-franchisees'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('da_franchisees')
        .select('id, number, name')
        .eq('status', 'active')
        .eq('is_hq', false)
        .order('number', { ascending: true });
      if (error) {
        if (error.code === '42P01' || error.code === 'PGRST205') return [];
        throw new Error(`useActiveFranchisees: ${error.message}`);
      }
      return (data ?? []) as FranchiseeOption[];
    },
  });
}

// ---------------------------------------------------------------------
// usePreviewBillingRun
// ---------------------------------------------------------------------

export interface PreviewBillingRunArgs {
  franchiseeId: string | null;
  billingPeriodStart: string;
  billingPeriodEnd: string;
}

export type PreviewBillingRunResult = FranchiseePreview | FranchiseePreview[];

async function callPreviewBillingRun(
  args: PreviewBillingRunArgs,
): Promise<PreviewBillingRunResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) {
    throw new Error('You must be signed in to preview a billing run.');
  }

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/preview-billing-run`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      id: null,
      fields: {
        franchisee_id: args.franchiseeId,
        billing_period_start: args.billingPeriodStart,
        billing_period_end: args.billingPeriodEnd,
      },
    }),
  });

  if (!response.ok) {
    let message = `Preview failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // body wasn't JSON — keep generic
    }
    throw new Error(message);
  }

  return (await response.json()) as PreviewBillingRunResult;
}

export function usePreviewBillingRun(): UseMutationResult<
  PreviewBillingRunResult,
  Error,
  PreviewBillingRunArgs
> {
  // Preview never invalidates the runs list — it doesn't write.
  return useMutation({
    mutationFn: callPreviewBillingRun,
  });
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

/** Coerce the JSONB column to the typed row array if it arrived as a string. */
export function parseTerritoryBreakdown(value: unknown): TerritoryBreakdownRow[] {
  if (Array.isArray(value)) return value as TerritoryBreakdownRow[];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as TerritoryBreakdownRow[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Last calendar month start/end in `YYYY-MM-DD`. Default for the dialog.
 */
export function lastCalendarMonth(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}
