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
        throw new Error(await parseFunctionError(error, 'Test send failed'));
      }

      if (!data?.ok) {
        throw new Error(data?.error ?? 'Test send failed');
      }
      return { sentTo: data.sent_to ?? 'your inbox' };
    },
  });
}

/**
 * Extended contract: the function also accepts an inline draft
 * `{ subject, preheader, blocks }` so unsaved broadcast content can be
 * test-sent without persisting first.
 */
export function useSendInlineTestEmail() {
  return useMutation({
    mutationFn: async (draft: {
      subject: string;
      preheader: string | null;
      blocks: EmailBlock[];
    }): Promise<{ sentTo: string }> => {
      const { data, error } = await supabase.functions.invoke<SendTestResponse>('send-test-email', {
        body: draft,
      });
      if (error) {
        throw new Error(await parseFunctionError(error, 'Test send failed'));
      }
      if (!data?.ok) {
        throw new Error(data?.error ?? 'Test send failed');
      }
      return { sentTo: data.sent_to ?? 'your inbox' };
    },
  });
}

/* ------------------------------------------------------------------ */
/* Broadcasts (da_email_broadcasts + da_email_broadcast_recipients)    */
/* ------------------------------------------------------------------ */

export type BroadcastAudienceType =
  | 'customers_all'
  | 'customers_franchisee'
  | 'franchisees_all'
  | 'franchisees_selected'
  | 'list';

export type BroadcastStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed';

export interface BroadcastAudienceConfig {
  franchisee_ids?: string[];
  list_id?: string;
}

export interface EmailBroadcast {
  id: string;
  name: string;
  subject: string;
  preheader: string | null;
  blocks: EmailBlock[];
  audience_type: BroadcastAudienceType;
  audience_config: BroadcastAudienceConfig;
  status: BroadcastStatus;
  scheduled_for: string | null;
  sent_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type RecipientStatus = 'pending' | 'sent' | 'failed' | 'skipped';

export interface BroadcastRecipient {
  id: string;
  broadcast_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  customer_id: string | null;
  franchisee_id: string | null;
  list_member_id: string | null;
  status: RecipientStatus;
  provider_message_id: string | null;
  sent_at: string | null;
  opened_at: string | null;
}

export function useBroadcasts(): UseQueryResult<EmailBroadcast[], Error> {
  return useQuery({
    queryKey: ['emails', 'broadcasts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('da_email_broadcasts')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) {
        throw new Error(`useBroadcasts: ${error.message}`);
      }
      return (data ?? []) as EmailBroadcast[];
    },
  });
}

export function useBroadcast(
  id: string | undefined,
  opts: { pollMsWhileSending?: number } = {},
): UseQueryResult<EmailBroadcast, Error> {
  const pollMs = opts.pollMsWhileSending;
  return useQuery({
    queryKey: ['emails', 'broadcasts', id],
    enabled: Boolean(id),
    refetchInterval: pollMs
      ? (query) => (query.state.data?.status === 'sending' ? pollMs : false)
      : false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('da_email_broadcasts')
        .select('*')
        .eq('id', id ?? '')
        .maybeSingle();
      if (error) {
        throw new Error(`useBroadcast: ${error.message}`);
      }
      if (!data) {
        throw new Error('Broadcast not found.');
      }
      return data as EmailBroadcast;
    },
  });
}

export interface BroadcastSendTotals {
  sent: number;
  opened: number;
}

/**
 * Per-broadcast sent/opened counts for the list page. Franchise scale is a
 * few thousand recipient rows at most, so we aggregate client-side rather
 * than issuing one count query per broadcast.
 */
export function useBroadcastRecipientTotals(): UseQueryResult<
  Record<string, BroadcastSendTotals>,
  Error
> {
  return useQuery({
    queryKey: ['emails', 'broadcasts', 'recipient-totals'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('da_email_broadcast_recipients')
        .select('broadcast_id, status, opened_at');
      if (error) {
        throw new Error(`useBroadcastRecipientTotals: ${error.message}`);
      }
      const rows = (data ?? []) as {
        broadcast_id: string;
        status: RecipientStatus;
        opened_at: string | null;
      }[];
      const totals: Record<string, BroadcastSendTotals> = {};
      for (const row of rows) {
        const t = (totals[row.broadcast_id] ??= { sent: 0, opened: 0 });
        if (row.status === 'sent') t.sent += 1;
        if (row.opened_at) t.opened += 1;
      }
      return totals;
    },
  });
}

export function useBroadcastRecipients(
  broadcastId: string | undefined,
  opts: { pollMs?: number } = {},
): UseQueryResult<BroadcastRecipient[], Error> {
  return useQuery({
    queryKey: ['emails', 'broadcasts', broadcastId, 'recipients'],
    enabled: Boolean(broadcastId),
    refetchInterval: opts.pollMs ?? false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('da_email_broadcast_recipients')
        .select('*')
        .eq('broadcast_id', broadcastId ?? '')
        .order('email', { ascending: true });
      if (error) {
        throw new Error(`useBroadcastRecipients: ${error.message}`);
      }
      return (data ?? []) as BroadcastRecipient[];
    },
  });
}

export interface BroadcastUpsert {
  id?: string;
  name: string;
  subject: string;
  preheader: string | null;
  blocks: EmailBlock[];
  audience_type: BroadcastAudienceType;
  audience_config: BroadcastAudienceConfig;
  scheduled_for?: string | null;
  created_by?: string | null;
}

export function useUpsertBroadcast() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, created_by, ...fields }: BroadcastUpsert): Promise<EmailBroadcast> => {
      if (id) {
        const { data, error } = await supabase
          .from('da_email_broadcasts')
          .update({ ...fields, updated_at: new Date().toISOString() })
          .eq('id', id)
          .select()
          .single();
        if (error) {
          throw new Error(error.message);
        }
        return data as EmailBroadcast;
      }
      const { data, error } = await supabase
        .from('da_email_broadcasts')
        .insert({ ...fields, created_by: created_by ?? null, status: 'draft' })
        .select()
        .single();
      if (error) {
        throw new Error(error.message);
      }
      return data as EmailBroadcast;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['emails', 'broadcasts'] });
    },
  });
}

/* --------------------------- send-broadcast ------------------------ */

/**
 * On a non-2xx response supabase-js raises FunctionsHttpError with the raw
 * Response on `context`; pull the `{ error }` body out of it.
 */
async function parseFunctionError(error: unknown, fallback: string): Promise<string> {
  const context = (error as { context?: unknown }).context;
  if (context instanceof Response) {
    try {
      const parsed = (await context.json()) as { error?: string };
      if (parsed.error) return parsed.error;
    } catch {
      // body wasn't JSON; keep the fallback.
    }
  }
  return fallback;
}

async function invokeSendBroadcast<T>(body: Record<string, unknown>, fallback: string): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T & { error?: string }>(
    'send-broadcast',
    { body },
  );
  if (error) {
    throw new Error(await parseFunctionError(error, fallback));
  }
  if (!data) {
    throw new Error(fallback);
  }
  return data;
}

export interface AudiencePreviewCount {
  eligible: number;
  suppressed: number;
  to_send: number;
}

export function usePreviewAudienceCount(
  audienceType: BroadcastAudienceType,
  audienceConfig: BroadcastAudienceConfig,
  enabled: boolean,
): UseQueryResult<AudiencePreviewCount, Error> {
  return useQuery({
    queryKey: ['emails', 'broadcasts', 'preview-count', audienceType, audienceConfig],
    enabled,
    staleTime: 30_000,
    queryFn: () =>
      invokeSendBroadcast<AudiencePreviewCount>(
        { action: 'preview_count', audience_type: audienceType, audience_config: audienceConfig },
        'Could not count recipients',
      ),
  });
}

export interface SendNowResult {
  ok: boolean;
  sent: number;
  failed: number;
  skipped: number;
}

export function useSendBroadcastNow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (broadcastId: string) =>
      invokeSendBroadcast<SendNowResult>(
        { action: 'send_now', broadcast_id: broadcastId },
        'Send failed',
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['emails', 'broadcasts'] });
    },
  });
}

export function useScheduleBroadcast() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (broadcastId: string) =>
      invokeSendBroadcast<{ ok: boolean }>(
        { action: 'schedule', broadcast_id: broadcastId },
        'Schedule failed',
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['emails', 'broadcasts'] });
    },
  });
}

export function useCancelBroadcastSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (broadcastId: string) =>
      invokeSendBroadcast<{ ok: boolean }>(
        { action: 'cancel_schedule', broadcast_id: broadcastId },
        'Cancel failed',
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['emails', 'broadcasts'] });
    },
  });
}

/* ------------------------------------------------------------------ */
/* Lists (da_email_lists + da_email_list_members)                      */
/* ------------------------------------------------------------------ */

export interface EmailList {
  id: string;
  name: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** Embedded count from da_email_list_members. */
  member_count: number;
}

export interface EmailListMember {
  id: string;
  list_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  created_at: string;
}

export function useEmailLists(): UseQueryResult<EmailList[], Error> {
  return useQuery({
    queryKey: ['emails', 'lists'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('da_email_lists')
        .select('*, members:da_email_list_members(count)')
        .order('created_at', { ascending: false });
      if (error) {
        throw new Error(`useEmailLists: ${error.message}`);
      }
      return ((data ?? []) as (Record<string, unknown> & { members?: { count: number }[] })[]).map(
        (row) => {
          const { members, ...rest } = row;
          return { ...rest, member_count: members?.[0]?.count ?? 0 } as EmailList;
        },
      );
    },
  });
}

export function useEmailList(id: string | undefined): UseQueryResult<EmailList, Error> {
  return useQuery({
    queryKey: ['emails', 'lists', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('da_email_lists')
        .select('*, members:da_email_list_members(count)')
        .eq('id', id ?? '')
        .maybeSingle();
      if (error) {
        throw new Error(`useEmailList: ${error.message}`);
      }
      if (!data) {
        throw new Error('List not found.');
      }
      const { members, ...rest } = data as Record<string, unknown> & {
        members?: { count: number }[];
      };
      return { ...rest, member_count: members?.[0]?.count ?? 0 } as EmailList;
    },
  });
}

export function useCreateEmailList() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; created_by: string | null }) => {
      const { data, error } = await supabase.from('da_email_lists').insert(input).select().single();
      if (error) {
        throw new Error(error.message);
      }
      return data as EmailList;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['emails', 'lists'] });
    },
  });
}

export function useRenameEmailList() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await supabase
        .from('da_email_lists')
        .update({ name, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) {
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['emails', 'lists'] });
    },
  });
}

export function useDeleteEmailList() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // Remove members first in case the FK isn't ON DELETE CASCADE.
      const membersRes = await supabase.from('da_email_list_members').delete().eq('list_id', id);
      if (membersRes.error) {
        throw new Error(membersRes.error.message);
      }
      const { error } = await supabase.from('da_email_lists').delete().eq('id', id);
      if (error) {
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['emails', 'lists'] });
    },
  });
}

export function useListMembers(
  listId: string | undefined,
): UseQueryResult<EmailListMember[], Error> {
  return useQuery({
    queryKey: ['emails', 'lists', listId, 'members'],
    enabled: Boolean(listId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('da_email_list_members')
        .select('*')
        .eq('list_id', listId ?? '')
        .order('created_at', { ascending: false });
      if (error) {
        throw new Error(`useListMembers: ${error.message}`);
      }
      return (data ?? []) as EmailListMember[];
    },
  });
}

export function useAddListMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      list_id: string;
      email: string;
      first_name: string | null;
      last_name: string | null;
    }) => {
      const { error } = await supabase
        .from('da_email_list_members')
        .insert({ ...input, email: input.email.trim().toLowerCase() });
      if (error) {
        // 23505 = the UNIQUE (list_id, lower(email)) index.
        if (error.code === '23505') {
          throw new Error('That email address is already on this list.');
        }
        throw new Error(error.message);
      }
    },
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['emails', 'lists'] });
      void queryClient.invalidateQueries({
        queryKey: ['emails', 'lists', vars.list_id, 'members'],
      });
    },
  });
}

export function useDeleteListMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; list_id: string }) => {
      const { error } = await supabase.from('da_email_list_members').delete().eq('id', id);
      if (error) {
        throw new Error(error.message);
      }
    },
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['emails', 'lists'] });
      void queryClient.invalidateQueries({
        queryKey: ['emails', 'lists', vars.list_id, 'members'],
      });
    },
  });
}

export interface ImportMemberRow {
  email: string;
  first_name: string | null;
  last_name: string | null;
}

const IMPORT_CHUNK_SIZE = 500;

/**
 * Chunked insert of pre-validated, pre-deduplicated rows. The unique index
 * on (list_id, lower(email)) is an expression index, which PostgREST's
 * `on_conflict` (column lists only) can't target — so deduplication happens
 * client-side (against the loaded members and within the file) and the
 * insert is plain. Emails are already lowercased by the caller.
 */
export function useImportListMembers() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ list_id, rows }: { list_id: string; rows: ImportMemberRow[] }) => {
      for (let i = 0; i < rows.length; i += IMPORT_CHUNK_SIZE) {
        const chunk = rows.slice(i, i + IMPORT_CHUNK_SIZE).map((r) => ({ ...r, list_id }));
        const { error } = await supabase.from('da_email_list_members').insert(chunk);
        if (error) {
          throw new Error(
            `Import failed after ${i} rows: ${error.code === '23505' ? 'a duplicate slipped in — refresh and retry' : error.message}`,
          );
        }
      }
      return rows.length;
    },
    onSuccess: (_count, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['emails', 'lists'] });
      void queryClient.invalidateQueries({
        queryKey: ['emails', 'lists', vars.list_id, 'members'],
      });
    },
  });
}

/* ------------------------------------------------------------------ */
/* Franchisee options (audience picker)                                */
/* ------------------------------------------------------------------ */

export interface FranchiseeOption {
  id: string;
  name: string;
  email: string;
}

export function useActiveFranchiseeOptions(): UseQueryResult<FranchiseeOption[], Error> {
  return useQuery({
    queryKey: ['emails', 'franchisee-options'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('da_franchisees')
        .select('id, name, email')
        .eq('status', 'active')
        .eq('is_hq', false)
        .order('name', { ascending: true });
      if (error) {
        throw new Error(`useActiveFranchiseeOptions: ${error.message}`);
      }
      return (data ?? []) as FranchiseeOption[];
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
