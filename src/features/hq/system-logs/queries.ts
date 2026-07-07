import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/**
 * HQ system-logs queries. da_system_logs is the DEBUG trail (edge functions
 * plus browser errors shipped via log-client-event); da_activities remains
 * the business audit trail. HQ has SELECT via RLS; writes are service-role
 * only, so this feature is read-only.
 */

const TABLE_MISSING_CODES = new Set(['42P01', 'PGRST205']);

function isTableMissing(code: string | null | undefined): boolean {
  return TABLE_MISSING_CODES.has(code ?? '');
}

export type LogWindow = '1h' | '24h' | '7d' | '30d';
export type LogLevel = 'info' | 'warn' | 'error';

export interface SystemLogRow {
  id: string;
  created_at: string;
  level: LogLevel;
  source: string;
  request_id: string | null;
  actor: string | null;
  entity_type: string | null;
  entity_id: string | null;
  message: string;
  context: Record<string, unknown> | null;
}

export interface SystemLogFilters {
  window: LogWindow;
  level: LogLevel | 'all';
  /** Exact source match; ignored while browserOnly is set. */
  source: string | 'all';
  /** "Browser errors" quick filter — source LIKE 'browser:%'. */
  browserOnly: boolean;
}

export const WINDOW_OPTIONS: { value: LogWindow; label: string }[] = [
  { value: '1h', label: 'Last hour' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
];

const WINDOW_MS: Record<LogWindow, number> = {
  '1h': 3_600_000,
  '24h': 24 * 3_600_000,
  '7d': 7 * 24 * 3_600_000,
  '30d': 30 * 24 * 3_600_000,
};

/** Latest 500 rows for the chosen window/filters, newest first. */
export function useSystemLogs(filters: SystemLogFilters, autoRefresh: boolean) {
  return useQuery<SystemLogRow[]>({
    queryKey: ['hq', 'system-logs', filters],
    staleTime: 30_000,
    refetchInterval: autoRefresh ? 30_000 : false,
    retry: 1,
    queryFn: async () => {
      const sinceIso = new Date(Date.now() - WINDOW_MS[filters.window]).toISOString();
      let qb = supabase
        .from('da_system_logs')
        .select('*')
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false })
        .limit(500);

      if (filters.level !== 'all') qb = qb.eq('level', filters.level);
      if (filters.browserOnly) {
        qb = qb.like('source', 'browser:%');
      } else if (filters.source !== 'all') {
        qb = qb.eq('source', filters.source);
      }

      const { data, error } = await qb;
      if (error) {
        if (isTableMissing(error.code)) return [];
        throw error;
      }
      return (data ?? []) as SystemLogRow[];
    },
  });
}
