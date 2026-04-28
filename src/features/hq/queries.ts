import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { AttentionItem } from '@/components/daisy';

/**
 * HQ dashboard data hooks.
 *
 * Strategy: keep these as plain client-side aggregates against Supabase
 * with HQ RLS already in place (010_rls_policies.sql). Each query is
 * defensive against missing tables (Wave 1B not applied) and missing
 * columns (returns zeros) so the dashboard renders cleanly on a fresh
 * project. Wave 5 seeds real numbers.
 */

const STALE_TIME = 30_000;

/** Postgrest error code for "relation does not exist". */
const TABLE_MISSING_CODES = new Set(['42P01', 'PGRST205']);

interface NetworkStats {
  bookingsMtd: number;
  bookingsLastMonth: number;
  revenueMtd: number;
  revenueLastMonth: number;
  activeFranchisees: number;
  totalFranchisees: number;
  territoryCoverage: number;
  vacantTerritories: number;
}

interface MonthRange {
  startIso: string;
  endIso: string;
}

function monthRangeIso(offset = 0): MonthRange {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1, 0, 0, 0));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset + 1, 1, 0, 0, 0));
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

function isTableMissing(code: string | null | undefined): boolean {
  return TABLE_MISSING_CODES.has(code ?? '');
}

async function fetchBookingsForRange(range: MonthRange): Promise<{
  count: number;
  revenuePence: number;
}> {
  const { data, error } = await supabase
    .from('da_bookings')
    .select('total_price_pence')
    .gte('created_at', range.startIso)
    .lt('created_at', range.endIso);

  if (error) {
    if (isTableMissing(error.code)) return { count: 0, revenuePence: 0 };
    throw error;
  }

  const rows = data ?? [];
  const revenue = rows.reduce((acc, row) => acc + (row.total_price_pence ?? 0), 0);
  return { count: rows.length, revenuePence: revenue };
}

async function fetchFranchiseeCounts(): Promise<{
  active: number;
  total: number;
}> {
  const totalRes = await supabase
    .from('da_franchisees')
    .select('*', { count: 'exact', head: true });

  if (totalRes.error) {
    if (isTableMissing(totalRes.error.code)) return { active: 0, total: 0 };
    throw totalRes.error;
  }

  const activeRes = await supabase
    .from('da_franchisees')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'active')
    .eq('is_hq', false);

  if (activeRes.error) {
    if (isTableMissing(activeRes.error.code)) return { active: 0, total: 0 };
    throw activeRes.error;
  }

  return { active: activeRes.count ?? 0, total: totalRes.count ?? 0 };
}

async function fetchTerritoryCounts(): Promise<{
  active: number;
  vacant: number;
  total: number;
}> {
  const { data, error } = await supabase.from('da_territories').select('status');

  if (error) {
    if (isTableMissing(error.code)) return { active: 0, vacant: 0, total: 0 };
    throw error;
  }

  const rows = data ?? [];
  let active = 0;
  let vacant = 0;
  for (const row of rows) {
    if (row.status === 'active') active += 1;
    else if (row.status === 'vacant') vacant += 1;
  }
  return { active, vacant, total: rows.length };
}

export function useNetworkStats() {
  return useQuery<NetworkStats>({
    queryKey: ['hq', 'network-stats'],
    staleTime: STALE_TIME,
    retry: 1,
    queryFn: async () => {
      const [thisMonth, lastMonth, franchisees, territories] = await Promise.all([
        fetchBookingsForRange(monthRangeIso(0)),
        fetchBookingsForRange(monthRangeIso(-1)),
        fetchFranchiseeCounts(),
        fetchTerritoryCounts(),
      ]);

      const coverage =
        territories.total > 0 ? Math.round((territories.active / territories.total) * 100) : 0;

      return {
        bookingsMtd: thisMonth.count,
        bookingsLastMonth: lastMonth.count,
        revenueMtd: thisMonth.revenuePence,
        revenueLastMonth: lastMonth.revenuePence,
        activeFranchisees: franchisees.active,
        totalFranchisees: franchisees.total,
        territoryCoverage: coverage,
        vacantTerritories: territories.vacant,
      };
    },
  });
}

export function useAttentionItems() {
  return useQuery<AttentionItem[]>({
    queryKey: ['hq', 'attention'],
    staleTime: STALE_TIME,
    retry: 1,
    queryFn: async () => {
      const items: AttentionItem[] = [];

      // Overdue / failed billing runs
      const overdue = await supabase
        .from('da_billing_runs')
        .select('*', { count: 'exact', head: true })
        .eq('payment_status', 'failed');

      if (overdue.error) {
        if (!isTableMissing(overdue.error.code)) throw overdue.error;
      } else if ((overdue.count ?? 0) > 0) {
        items.push({
          id: 'overdue-fees',
          title: 'Overdue fee payments',
          meta: 'Billing runs with failed payments — chase or retry',
          severity: 'red',
          count: overdue.count ?? 0,
          href: '/hq/billing',
        });
      }

      // Vacant territories — proxy for "quiet"
      const vacant = await supabase
        .from('da_territories')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'vacant');

      if (vacant.error) {
        if (!isTableMissing(vacant.error.code)) throw vacant.error;
      } else if ((vacant.count ?? 0) > 0) {
        items.push({
          id: 'quiet-territories',
          title: 'Quiet territories',
          meta: 'Vacant on the map — assign a franchisee or run a campaign',
          severity: 'amber',
          count: vacant.count ?? 0,
          href: '/hq/territories',
        });
      }

      // New interest forms
      const enquiries = await supabase
        .from('da_interest_forms')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'new');

      if (enquiries.error) {
        if (!isTableMissing(enquiries.error.code)) throw enquiries.error;
      } else if ((enquiries.count ?? 0) > 0) {
        items.push({
          id: 'new-enquiries',
          title: 'New franchisee enquiries',
          meta: 'Vacant territories · waiting for review',
          severity: 'blue',
          count: enquiries.count ?? 0,
          href: '/hq/activity',
        });
      }

      // Upcoming billing runs (this week, pending)
      const weekFromNow = new Date();
      weekFromNow.setUTCDate(weekFromNow.getUTCDate() + 7);
      const upcoming = await supabase
        .from('da_billing_runs')
        .select('*', { count: 'exact', head: true })
        .eq('payment_status', 'pending')
        .lte('billing_period_end', weekFromNow.toISOString());

      if (upcoming.error) {
        if (!isTableMissing(upcoming.error.code)) throw upcoming.error;
      } else if ((upcoming.count ?? 0) > 0) {
        items.push({
          id: 'upcoming-billing',
          title: 'Billing runs this week',
          meta: 'Scheduled runs in the next 7 days — preview before they fire',
          severity: 'grey',
          count: upcoming.count ?? 0,
          href: '/hq/billing',
        });
      }

      return items;
    },
  });
}

export interface ActivityRow {
  id: string;
  created_at: string;
  actor_type: string;
  actor_id: string | null;
  entity_type: string;
  entity_id: string;
  action: string;
  metadata: Record<string, unknown> | null;
  description: string | null;
}

export function useRecentActivity(limit = 10) {
  return useQuery<ActivityRow[]>({
    queryKey: ['hq', 'recent-activity', limit],
    staleTime: STALE_TIME,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('da_activities')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        if (isTableMissing(error.code)) return [];
        throw error;
      }
      return (data ?? []) as ActivityRow[];
    },
  });
}
