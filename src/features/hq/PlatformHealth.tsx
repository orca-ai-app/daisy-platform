import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

/**
 * "Platform health" strip on the HQ dashboard — four compact ops tiles:
 * email failures, manual payments needing review, the send-emails cron
 * heartbeat, and browser errors shipped by the portal logger.
 *
 * Each tile has its own query so one failure degrades to an em-dash without
 * taking the others down; failures are logged by the global QueryCache
 * handler in App.tsx.
 */

const TABLE_MISSING_CODES = new Set(['42P01', 'PGRST205']);

function isTableMissing(code: string | null | undefined): boolean {
  return TABLE_MISSING_CODES.has(code ?? '');
}

const STALE_TIME = 60_000;

function useEmailFailures() {
  return useQuery<number>({
    queryKey: ['hq', 'health', 'email-failures'],
    staleTime: STALE_TIME,
    retry: 1,
    queryFn: async () => {
      const [sequences, recipients] = await Promise.all([
        supabase
          .from('da_email_sequences')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'failed'),
        supabase
          .from('da_email_broadcast_recipients')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'failed'),
      ]);
      if (sequences.error && !isTableMissing(sequences.error.code)) throw sequences.error;
      if (recipients.error && !isTableMissing(recipients.error.code)) throw recipients.error;
      return (sequences.count ?? 0) + (recipients.count ?? 0);
    },
  });
}

function useManualPayments() {
  return useQuery<number>({
    queryKey: ['hq', 'health', 'manual-payments'],
    staleTime: STALE_TIME,
    retry: 1,
    queryFn: async () => {
      const { count, error } = await supabase
        .from('da_bookings')
        .select('*', { count: 'exact', head: true })
        .eq('payment_status', 'manual');
      if (error) {
        if (isTableMissing(error.code)) return 0;
        throw error;
      }
      return count ?? 0;
    },
  });
}

/** Newest info-level send-emails log row, or null when none exists. */
function useEmailCronHeartbeat() {
  return useQuery<string | null>({
    queryKey: ['hq', 'health', 'email-cron'],
    staleTime: STALE_TIME,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('da_system_logs')
        .select('created_at')
        .eq('source', 'send-emails')
        .eq('level', 'info')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        if (isTableMissing(error.code)) return null;
        throw error;
      }
      return data?.created_at ?? null;
    },
  });
}

function useBrowserErrors24h() {
  return useQuery<number>({
    queryKey: ['hq', 'health', 'browser-errors'],
    staleTime: STALE_TIME,
    retry: 1,
    queryFn: async () => {
      const sinceIso = new Date(Date.now() - 24 * 3_600_000).toISOString();
      const { count, error } = await supabase
        .from('da_system_logs')
        .select('*', { count: 'exact', head: true })
        .like('source', 'browser:%')
        .eq('level', 'error')
        .gte('created_at', sinceIso);
      if (error) {
        if (isTableMissing(error.code)) return 0;
        throw error;
      }
      return count ?? 0;
    },
  });
}

function agoLabel(iso: string): { label: string; stale: boolean } {
  const ageMs = Date.now() - new Date(iso).getTime();
  const stale = ageMs > 2 * 3_600_000;
  if (ageMs < 3_600_000) {
    const mins = Math.max(1, Math.round(ageMs / 60_000));
    return { label: `${mins}m ago`, stale };
  }
  const hours = Math.round(ageMs / 3_600_000);
  return { label: `${hours}h ago`, stale };
}

type Tone = 'ok' | 'warn' | 'bad';

const valueTone: Record<Tone, string> = {
  ok: 'text-daisy-ink',
  bad: 'text-[#8A2A2A]',
  warn: 'text-[#8A5A1A]',
};

interface HealthTileProps {
  label: string;
  to: string;
  isLoading: boolean;
  isError: boolean;
  value: string;
  meta: string;
  tone: Tone;
}

function HealthTile({ label, to, isLoading, isError, value, meta, tone }: HealthTileProps) {
  return (
    <Link
      to={to}
      className="hover:shadow-lift focus-visible:ring-daisy-primary rounded-[12px] transition-shadow focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
    >
      <div className="border-daisy-line-soft bg-daisy-paper shadow-card flex h-full flex-col gap-1 rounded-[12px] border px-4 py-3">
        <span className="text-daisy-muted text-[11px] font-bold tracking-[0.08em] uppercase">
          {label}
        </span>
        {isLoading ? (
          <>
            <Skeleton className="h-6 w-16" />
            <Skeleton className="h-3 w-24" />
          </>
        ) : isError ? (
          <>
            <span className="font-display text-daisy-muted text-xl font-bold">—</span>
            <span className="text-daisy-muted text-[12px]">Could not load</span>
          </>
        ) : (
          <>
            <span
              className={cn(
                'font-display text-xl leading-tight font-bold tracking-tight',
                valueTone[tone],
              )}
            >
              {value}
            </span>
            <span
              className={cn(
                'text-[12px] font-semibold',
                tone === 'ok' ? 'text-daisy-muted' : valueTone[tone],
              )}
            >
              {meta}
            </span>
          </>
        )}
      </div>
    </Link>
  );
}

export function PlatformHealth() {
  const emailFailures = useEmailFailures();
  const manualPayments = useManualPayments();
  const heartbeat = useEmailCronHeartbeat();
  const browserErrors = useBrowserErrors24h();

  const heartbeatInfo = heartbeat.data ? agoLabel(heartbeat.data) : null;

  return (
    <section aria-label="Platform health" className="flex flex-col gap-2">
      <h2 className="text-daisy-muted text-[12px] font-extrabold tracking-[0.08em] uppercase">
        Platform health
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <HealthTile
          label="Email failures"
          to="/hq/system-logs?source=send-emails"
          isLoading={emailFailures.isLoading}
          isError={emailFailures.isError}
          value={(emailFailures.data ?? 0).toLocaleString('en-GB')}
          meta={(emailFailures.data ?? 0) > 0 ? 'Journey + broadcast sends' : 'All clear'}
          tone={(emailFailures.data ?? 0) > 0 ? 'bad' : 'ok'}
        />
        <HealthTile
          label="Needs review: manual payments"
          to="/hq/bookings"
          isLoading={manualPayments.isLoading}
          isError={manualPayments.isError}
          value={(manualPayments.data ?? 0).toLocaleString('en-GB')}
          meta={(manualPayments.data ?? 0) > 0 ? 'Cheque or invoice bookings' : 'All clear'}
          tone={(manualPayments.data ?? 0) > 0 ? 'warn' : 'ok'}
        />
        <HealthTile
          label="Email cron"
          to="/hq/system-logs?source=send-emails"
          isLoading={heartbeat.isLoading}
          isError={heartbeat.isError}
          value={heartbeatInfo ? heartbeatInfo.label : 'No runs'}
          meta={
            heartbeatInfo
              ? heartbeatInfo.stale
                ? `Email cron last ran ${heartbeatInfo.label.replace(' ago', '')} ago`
                : 'Running hourly'
              : 'No runs logged yet'
          }
          tone={heartbeatInfo && !heartbeatInfo.stale ? 'ok' : 'warn'}
        />
        <HealthTile
          label="Browser errors (24h)"
          to="/hq/system-logs?browser=1&level=error&window=24h"
          isLoading={browserErrors.isLoading}
          isError={browserErrors.isError}
          value={(browserErrors.data ?? 0).toLocaleString('en-GB')}
          meta={(browserErrors.data ?? 0) > 0 ? 'From portal sessions' : 'All clear'}
          tone={(browserErrors.data ?? 0) > 0 ? 'bad' : 'ok'}
        />
      </div>
    </section>
  );
}

export default PlatformHealth;
