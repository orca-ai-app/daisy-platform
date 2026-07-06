/**
 * HQ Emails queries + mutations.
 *
 * The post-booking journey emails live in `da_email_templates` (one row per
 * Kartra journey step, ordered by `sort_order`). HQ has full RLS access so
 * template reads and writes go straight through supabase-js. Sends are
 * recorded in `da_email_sequences` and provider webhooks land in
 * `da_email_events`; both are read-only here and power the overview stats.
 *
 * Media assets live in the public `email-assets` storage bucket.
 */

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { EmailBlock } from './renderBlocks';

const BUCKET = 'email-assets';

export type EmailStatsPeriod = 'last-30-days' | 'last-90-days' | 'last-365-days' | 'all-time';

export interface EmailTemplate {
  id: string;
  template_key: string;
  name: string;
  subject: string;
  preheader: string | null;
  blocks: EmailBlock[];
  is_marketing: boolean;
  sort_order: number;
  delay_label: string | null;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

export function useEmailTemplates(): UseQueryResult<EmailTemplate[], Error> {
  return useQuery({
    queryKey: ['emails', 'templates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('da_email_templates')
        .select('*')
        .order('sort_order', { ascending: true });
      if (error) {
        throw new Error(`useEmailTemplates: ${error.message}`);
      }
      return (data ?? []) as EmailTemplate[];
    },
  });
}

export function useEmailTemplate(
  templateKey: string | undefined,
): UseQueryResult<EmailTemplate, Error> {
  return useQuery({
    queryKey: ['emails', 'templates', templateKey],
    enabled: Boolean(templateKey),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('da_email_templates')
        .select('*')
        .eq('template_key', templateKey ?? '')
        .maybeSingle();
      if (error) {
        throw new Error(`useEmailTemplate: ${error.message}`);
      }
      if (!data) {
        throw new Error(`Email template "${templateKey ?? ''}" not found.`);
      }
      return data as EmailTemplate;
    },
  });
}

export interface EmailTemplateUpdate {
  id: string;
  subject: string;
  preheader: string | null;
  blocks: EmailBlock[];
  updated_by: string | null;
}

export function useUpdateEmailTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...fields }: EmailTemplateUpdate) => {
      const { data, error } = await supabase
        .from('da_email_templates')
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      if (error) {
        throw new Error(error.message);
      }
      return data as EmailTemplate;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['emails', 'templates'] });
    },
  });
}

/* ------------------------------------------------------------------ */
/* Stats                                                               */
/* ------------------------------------------------------------------ */

export interface TemplateEmailStats {
  sent: number;
  opened: number;
  /** 0–100, rounded. Null when nothing has been sent. */
  openRatePct: number | null;
}

export interface EmailStatsResult {
  byTemplate: Record<string, TemplateEmailStats>;
  totalSent: number;
  totalOpened: number;
  openRatePct: number | null;
  /** Queued sends (status = pending). Not period-filtered — they're future. */
  totalPending: number;
}

function periodFromIso(period: EmailStatsPeriod): string | null {
  if (period === 'all-time') return null;
  const days = period === 'last-30-days' ? 30 : period === 'last-90-days' ? 90 : 365;
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - days);
  return from.toISOString();
}

export function useEmailStats(period: EmailStatsPeriod): UseQueryResult<EmailStatsResult, Error> {
  return useQuery({
    queryKey: ['emails', 'stats', period],
    queryFn: async () => {
      const fromIso = periodFromIso(period);
      let sentQuery = supabase
        .from('da_email_sequences')
        .select('template_key, opened_at')
        .eq('status', 'sent');
      if (fromIso) {
        sentQuery = sentQuery.gte('sent_at', fromIso);
      }

      const [sentRes, pendingRes] = await Promise.all([
        sentQuery,
        supabase
          .from('da_email_sequences')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'pending'),
      ]);

      if (sentRes.error) {
        throw new Error(`useEmailStats: ${sentRes.error.message}`);
      }
      if (pendingRes.error) {
        throw new Error(`useEmailStats: ${pendingRes.error.message}`);
      }

      const rows = (sentRes.data ?? []) as { template_key: string; opened_at: string | null }[];
      const byTemplate: Record<string, TemplateEmailStats> = {};
      let totalSent = 0;
      let totalOpened = 0;

      for (const row of rows) {
        const stats = (byTemplate[row.template_key] ??= { sent: 0, opened: 0, openRatePct: null });
        stats.sent += 1;
        totalSent += 1;
        if (row.opened_at) {
          stats.opened += 1;
          totalOpened += 1;
        }
      }
      for (const stats of Object.values(byTemplate)) {
        stats.openRatePct = stats.sent > 0 ? Math.round((stats.opened / stats.sent) * 100) : null;
      }

      return {
        byTemplate,
        totalSent,
        totalOpened,
        openRatePct: totalSent > 0 ? Math.round((totalOpened / totalSent) * 100) : null,
        totalPending: pendingRes.count ?? 0,
      };
    },
  });
}

export interface EmailDeliveryIssues {
  bounced: number;
  spamComplaints: number;
}

export function useEmailDeliveryIssues(
  period: EmailStatsPeriod,
): UseQueryResult<EmailDeliveryIssues, Error> {
  return useQuery({
    queryKey: ['emails', 'delivery-issues', period],
    queryFn: async () => {
      const fromIso = periodFromIso(period);
      let query = supabase
        .from('da_email_events')
        .select('event_type')
        .in('event_type', ['bounced', 'spam_complaint']);
      if (fromIso) {
        query = query.gte('occurred_at', fromIso);
      }
      const { data, error } = await query;
      if (error) {
        throw new Error(`useEmailDeliveryIssues: ${error.message}`);
      }
      const rows = (data ?? []) as { event_type: string }[];
      return {
        bounced: rows.filter((r) => r.event_type === 'bounced').length,
        spamComplaints: rows.filter((r) => r.event_type === 'spam_complaint').length,
      };
    },
  });
}

/* ------------------------------------------------------------------ */
/* Test sends                                                          */
/* ------------------------------------------------------------------ */

interface SendTestResponse {
  ok?: boolean;
  sent_to?: string;
  error?: string;
}

/**
 * POST to the `send-test-email` edge function with the caller's JWT.
 * Contract: `{ template_key }` in, `{ ok: true, sent_to }` on success,
 * `{ error }` with a non-2xx status on failure.
 */
export function useSendTestEmail() {
  return useMutation({
    mutationFn: async (templateKey: string): Promise<{ sentTo: string }> => {
      const { data, error } = await supabase.functions.invoke<SendTestResponse>('send-test-email', {
        body: { template_key: templateKey },
      });

      if (error) {
        // On a non-2xx response supabase-js raises FunctionsHttpError with
        // the raw Response on `context`; pull the `{ error }` body out of it.
        let message = 'Test send failed';
        const context = (error as { context?: unknown }).context;
        if (context instanceof Response) {
          try {
            const parsed = (await context.json()) as { error?: string };
            if (parsed.error) message = parsed.error;
          } catch {
            // body wasn't JSON; keep the generic message.
          }
        }
        throw new Error(message);
      }

      if (!data?.ok) {
        throw new Error(data?.error ?? 'Test send failed');
      }
      return { sentTo: data.sent_to ?? 'your inbox' };
    },
  });
}

/* ------------------------------------------------------------------ */
/* Media library (email-assets bucket)                                 */
/* ------------------------------------------------------------------ */

export interface MediaAsset {
  name: string;
  publicUrl: string;
  updatedAt: string | null;
}

export function useEmailAssets(): UseQueryResult<MediaAsset[], Error> {
  return useQuery({
    queryKey: ['emails', 'media'],
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(BUCKET).list('', {
        limit: 1000,
        sortBy: { column: 'name', order: 'asc' },
      });
      if (error) {
        throw new Error(`useEmailAssets: ${error.message}`);
      }
      return (
        (data ?? [])
          // Folder placeholders come back with a null id at runtime.
          .filter((f) => Boolean((f as { id: string | null }).id))
          .map((f) => ({
            name: f.name,
            publicUrl: supabase.storage.from(BUCKET).getPublicUrl(f.name).data.publicUrl,
            updatedAt: f.updated_at ?? null,
          }))
      );
    },
  });
}

/** Restrict uploaded filenames to [A-Za-z0-9._-]. */
export function sanitiseFilename(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, '-');
}

export function useUploadEmailAsset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: File): Promise<string> => {
      const name = sanitiseFilename(file.name);
      const { error } = await supabase.storage.from(BUCKET).upload(name, file, { upsert: false });
      if (error) {
        throw new Error(error.message);
      }
      return name;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['emails', 'media'] });
    },
  });
}

export function useDeleteEmailAsset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase.storage.from(BUCKET).remove([name]);
      if (error) {
        throw new Error(error.message);
      }
      return name;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['emails', 'media'] });
    },
  });
}
