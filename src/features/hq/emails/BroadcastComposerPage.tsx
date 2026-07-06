/**
 * Broadcast composer: create a draft, edit a draft or scheduled broadcast,
 * pick an audience, test-send, send now or schedule.
 *
 * Routes: /hq/emails/broadcasts/new and /hq/emails/broadcasts/:id/edit.
 * Broadcasts that are sending/sent/failed redirect to the detail page.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { ArrowLeft, CalendarClock, Send, Undo2 } from 'lucide-react';
import { PageHeader } from '@/components/daisy';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useRole } from '@/features/auth/RoleContext';
import type { EmailBlock } from './renderBlocks';
import { BlockEditor } from './BlockEditor';
import { EmailPreview } from './EmailPreview';
import {
  useActiveFranchiseeOptions,
  useBroadcast,
  useCancelBroadcastSchedule,
  useEmailLists,
  usePreviewAudienceCount,
  useScheduleBroadcast,
  useSendBroadcastNow,
  useSendInlineTestEmail,
  useUpsertBroadcast,
  type BroadcastAudienceConfig,
  type BroadcastAudienceType,
  type EmailBroadcast,
} from './queries';
import { describeAudience, formatDateTime, isFranchiseeAudience } from './broadcastHelpers';

const AUDIENCE_OPTIONS: ReadonlyArray<{
  value: BroadcastAudienceType;
  label: string;
  help: string;
}> = [
  {
    value: 'customers_all',
    label: 'All opted-in customers',
    help: 'Every customer with a marketing opt-in, minus the suppression list.',
  },
  {
    value: 'customers_franchisee',
    label: 'Customers of specific franchisees',
    help: 'Opted-in customers belonging to the franchisees you tick below.',
  },
  {
    value: 'franchisees_all',
    label: 'All active franchisees',
    help: 'Every franchisee with an active agreement.',
  },
  {
    value: 'franchisees_selected',
    label: 'Selected franchisees',
    help: 'Only the franchisees you tick below.',
  },
  {
    value: 'list',
    label: 'A saved list',
    help: 'A list you manage on the Lists tab, minus the suppression list.',
  },
];

/** Format a Date as a `datetime-local` input value in the browser's zone. */
function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function BroadcastComposerPage() {
  const { id } = useParams<{ id: string }>();
  const broadcast = useBroadcast(id);

  if (!id) {
    return <BroadcastComposer broadcast={null} />;
  }

  if (broadcast.isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-12 w-1/2" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Skeleton className="h-[560px] w-full" />
          <Skeleton className="h-[560px] w-full" />
        </div>
      </div>
    );
  }

  if (broadcast.isError || !broadcast.data) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-daisy-orange text-sm">
          Failed to load this broadcast: {broadcast.error?.message ?? 'not found'}
        </p>
        <Button asChild variant="outline" size="sm" className="self-start">
          <Link to="/hq/emails/broadcasts">
            <ArrowLeft className="h-4 w-4" />
            Back to broadcasts
          </Link>
        </Button>
      </div>
    );
  }

  if (broadcast.data.status !== 'draft' && broadcast.data.status !== 'scheduled') {
    return <Navigate to={`/hq/emails/broadcasts/${id}`} replace />;
  }

  // Key on the row id so composer state resets if the route changes broadcast.
  return <BroadcastComposer key={broadcast.data.id} broadcast={broadcast.data} />;
}

function BroadcastComposer({ broadcast }: { broadcast: EmailBroadcast | null }) {
  const navigate = useNavigate();
  const { franchisee } = useRole();

  const upsert = useUpsertBroadcast();
  const sendTest = useSendInlineTestEmail();
  const sendNow = useSendBroadcastNow();
  const schedule = useScheduleBroadcast();
  const cancelSchedule = useCancelBroadcastSchedule();

  const franchisees = useActiveFranchiseeOptions();
  const lists = useEmailLists();
  const listNamesById = useMemo(
    () => Object.fromEntries((lists.data ?? []).map((l) => [l.id, l.name])),
    [lists.data],
  );

  const [name, setName] = useState(broadcast?.name ?? '');
  const [subject, setSubject] = useState(broadcast?.subject ?? '');
  const [preheader, setPreheader] = useState(broadcast?.preheader ?? '');
  const [blocks, setBlocks] = useState<EmailBlock[]>(broadcast?.blocks ?? []);
  const [audienceType, setAudienceType] = useState<BroadcastAudienceType>(
    broadcast?.audience_type ?? 'customers_all',
  );
  const [franchiseeIds, setFranchiseeIds] = useState<string[]>(
    broadcast?.audience_config.franchisee_ids ?? [],
  );
  const [listId, setListId] = useState<string>(broadcast?.audience_config.list_id ?? '');

  const [confirmSendOpen, setConfirmSendOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleValue, setScheduleValue] = useState('');

  const audienceConfig = useMemo<BroadcastAudienceConfig>(() => {
    if (audienceType === 'list') return listId ? { list_id: listId } : {};
    if (audienceType === 'customers_franchisee' || audienceType === 'franchisees_selected') {
      return { franchisee_ids: franchiseeIds };
    }
    return {};
  }, [audienceType, franchiseeIds, listId]);

  const audienceValid =
    audienceType === 'customers_all' ||
    audienceType === 'franchisees_all' ||
    (audienceType === 'list' ? Boolean(listId) : franchiseeIds.length > 0);

  // Debounce the audience for the live count so rapid checkbox ticking
  // doesn't hammer the edge function.
  const [debouncedAudience, setDebouncedAudience] = useState<{
    type: BroadcastAudienceType;
    config: BroadcastAudienceConfig;
    valid: boolean;
  }>({ type: audienceType, config: audienceConfig, valid: audienceValid });

  useEffect(() => {
    const t = setTimeout(
      () =>
        setDebouncedAudience({ type: audienceType, config: audienceConfig, valid: audienceValid }),
      500,
    );
    return () => clearTimeout(t);
  }, [audienceType, audienceConfig, audienceValid]);

  const count = usePreviewAudienceCount(
    debouncedAudience.type,
    debouncedAudience.config,
    debouncedAudience.valid,
  );

  const dirty = useMemo(() => {
    const initial = {
      name: broadcast?.name ?? '',
      subject: broadcast?.subject ?? '',
      preheader: broadcast?.preheader ?? '',
      blocks: broadcast?.blocks ?? [],
      audienceType: broadcast?.audience_type ?? 'customers_all',
      franchiseeIds: broadcast?.audience_config.franchisee_ids ?? [],
      listId: broadcast?.audience_config.list_id ?? '',
    };
    const current = { name, subject, preheader, blocks, audienceType, franchiseeIds, listId };
    return JSON.stringify(current) !== JSON.stringify(initial);
  }, [broadcast, name, subject, preheader, blocks, audienceType, franchiseeIds, listId]);

  // Warn on tab close / hard navigation while there are unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const handleBack = () => {
    // Plain web app, so window.confirm is fine here (not the Tauri webview).
    if (dirty && !window.confirm('You have unsaved changes. Leave without saving?')) return;
    void navigate('/hq/emails/broadcasts');
  };

  /** Upsert the row without navigating. Returns null (after a toast) on failure. */
  const persist = async (scheduledFor?: string | null): Promise<EmailBroadcast | null> => {
    if (!name.trim()) {
      toast.error('Give this email an internal name first.');
      return null;
    }
    if (!subject.trim()) {
      toast.error('Add a subject line first.');
      return null;
    }
    try {
      return await upsert.mutateAsync({
        id: broadcast?.id,
        name: name.trim(),
        subject: subject.trim(),
        preheader: preheader.trim() ? preheader.trim() : null,
        blocks,
        audience_type: audienceType,
        audience_config: audienceConfig,
        ...(scheduledFor !== undefined ? { scheduled_for: scheduledFor } : {}),
        created_by: franchisee?.id ?? null,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
      return null;
    }
  };

  const handleSaveDraft = async () => {
    const row = await persist();
    if (!row) return;
    toast.success('Draft saved');
    if (!broadcast) {
      void navigate(`/hq/emails/broadcasts/${row.id}/edit`, { replace: true });
    }
  };

  const handleSendTest = async () => {
    try {
      const { sentTo } = await sendTest.mutateAsync({
        subject: subject.trim() || '(no subject)',
        preheader: preheader.trim() ? preheader.trim() : null,
        blocks,
      });
      toast.success(`Test email sent to ${sentTo}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Test send failed');
    }
  };

  /** Shared pre-flight for send now / schedule. */
  const readyToSend = (): boolean => {
    if (!name.trim() || !subject.trim()) {
      toast.error('Add an internal name and a subject line first.');
      return false;
    }
    if (blocks.length === 0) {
      toast.error('This email has no content blocks yet.');
      return false;
    }
    if (!audienceValid) {
      toast.error(
        audienceType === 'list' ? 'Choose a list to send to.' : 'Tick at least one franchisee.',
      );
      return false;
    }
    return true;
  };

  const handleConfirmSend = async () => {
    setConfirmSendOpen(false);
    const row = await persist();
    if (!row) return;
    try {
      const result = await sendNow.mutateAsync(row.id);
      const extras = [
        result.failed > 0 ? `${result.failed} failed` : null,
        result.skipped > 0 ? `${result.skipped} skipped` : null,
      ]
        .filter(Boolean)
        .join(', ');
      toast.success(
        `Sent to ${result.sent} recipient${result.sent === 1 ? '' : 's'}${extras ? ` (${extras})` : ''}`,
      );
      void navigate(`/hq/emails/broadcasts/${row.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Send failed');
    }
  };

  const handleConfirmSchedule = async () => {
    if (!scheduleValue) {
      toast.error('Pick a date and time.');
      return;
    }
    const when = new Date(scheduleValue);
    if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
      toast.error('The scheduled time must be in the future.');
      return;
    }
    setScheduleOpen(false);
    const row = await persist(when.toISOString());
    if (!row) return;
    try {
      await schedule.mutateAsync(row.id);
      toast.success(`Scheduled for ${formatDateTime(when.toISOString())}`);
      if (!broadcast) {
        void navigate(`/hq/emails/broadcasts/${row.id}/edit`, { replace: true });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Schedule failed');
    }
  };

  const handleCancelSchedule = async () => {
    if (!broadcast) return;
    try {
      await cancelSchedule.mutateAsync(broadcast.id);
      toast.success('Schedule cancelled — back to draft');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Cancel failed');
    }
  };

  const isScheduled = broadcast?.status === 'scheduled';
  const busy =
    upsert.isPending || sendNow.isPending || schedule.isPending || cancelSchedule.isPending;

  const audienceText = describeAudience(audienceType, audienceConfig, listNamesById);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumb={
          <button
            type="button"
            onClick={handleBack}
            className="hover:text-daisy-primary transition-colors"
          >
            ← Broadcasts
          </button>
        }
        title={broadcast ? broadcast.name : 'New broadcast email'}
        subtitle="A one-off email. Nothing sends until you press Send now or Schedule."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleSendTest()}
              disabled={sendTest.isPending}
            >
              <Send className="h-4 w-4" />
              {sendTest.isPending ? 'Sending…' : 'Send me a test'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleSaveDraft()}
              disabled={busy || (!dirty && Boolean(broadcast))}
            >
              {upsert.isPending ? 'Saving…' : dirty || !broadcast ? 'Save draft' : 'Saved'}
            </Button>
            {!isScheduled ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (!readyToSend()) return;
                    setScheduleValue(toLocalInputValue(new Date(Date.now() + 60 * 60_000)));
                    setScheduleOpen(true);
                  }}
                  disabled={busy}
                >
                  <CalendarClock className="h-4 w-4" />
                  Schedule
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    if (!readyToSend()) return;
                    setConfirmSendOpen(true);
                  }}
                  disabled={busy}
                >
                  <Send className="h-4 w-4" />
                  {sendNow.isPending ? 'Sending…' : 'Send now'}
                </Button>
              </>
            ) : null}
          </div>
        }
      />

      {dirty ? (
        <p className="text-daisy-muted -mt-4 text-xs font-semibold">
          Unsaved changes. &ldquo;Send me a test&rdquo; uses what you see here; Send now and
          Schedule save first.
        </p>
      ) : null}

      {isScheduled && broadcast ? (
        <div className="border-daisy-line-soft bg-daisy-primary-tint flex flex-wrap items-center justify-between gap-3 rounded-[12px] border px-4 py-3">
          <p className="text-daisy-primary-deep text-sm font-semibold">
            Scheduled for {formatDateTime(broadcast.scheduled_for)}. It goes out on the next hourly
            run after that time.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleCancelSchedule()}
            disabled={cancelSchedule.isPending}
          >
            <Undo2 className="h-4 w-4" />
            {cancelSchedule.isPending ? 'Cancelling…' : 'Cancel schedule'}
          </Button>
        </div>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        {/* Left: details, audience and blocks */}
        <div className="flex flex-col gap-4">
          <div className="border-daisy-line-soft bg-daisy-paper shadow-card flex flex-col gap-4 rounded-[12px] border p-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bc-name">Internal name</Label>
              <Input
                id="bc-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Spring offer — March"
              />
              <p className="text-daisy-muted text-xs">
                Only you see this. Recipients see the subject.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bc-subject">Subject</Label>
              <Input id="bc-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bc-preheader">Preheader</Label>
              <Input
                id="bc-preheader"
                value={preheader}
                onChange={(e) => setPreheader(e.target.value)}
                placeholder="The short line inbox apps show after the subject"
              />
              <p className="text-daisy-muted text-xs">
                Optional. Merge fields like {'{{first_name}}'} work in the subject, preheader and
                every block.
              </p>
            </div>
          </div>

          {/* Audience */}
          <div className="border-daisy-line-soft bg-daisy-paper shadow-card flex flex-col gap-3 rounded-[12px] border p-4">
            <h2 className="font-display text-daisy-ink text-lg font-bold">Audience</h2>
            <div className="flex flex-col gap-2">
              {AUDIENCE_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className="border-daisy-line bg-daisy-paper-soft flex items-start gap-3 rounded-[8px] border-2 p-3"
                >
                  <input
                    type="radio"
                    name="bc-audience"
                    value={opt.value}
                    checked={audienceType === opt.value}
                    onChange={() => setAudienceType(opt.value)}
                    className="mt-0.5 h-4 w-4"
                  />
                  <span className="flex flex-col">
                    <span className="text-sm font-bold">{opt.label}</span>
                    <span className="text-daisy-muted text-xs">{opt.help}</span>
                  </span>
                </label>
              ))}
            </div>

            {audienceType === 'customers_franchisee' || audienceType === 'franchisees_selected' ? (
              <div className="flex flex-col gap-1.5">
                <Label>Franchisees</Label>
                {franchisees.isLoading ? (
                  <Skeleton className="h-24 w-full" />
                ) : franchisees.isError ? (
                  <p className="text-daisy-orange text-xs">
                    Failed to load franchisees: {franchisees.error.message}
                  </p>
                ) : (
                  <div className="border-daisy-line flex max-h-56 flex-col overflow-y-auto rounded-[8px] border-2 bg-white">
                    {(franchisees.data ?? []).map((f) => (
                      <label
                        key={f.id}
                        className="border-daisy-line hover:bg-daisy-primary-tint flex items-center gap-3 border-b border-dashed px-3 py-2 last:border-b-0"
                      >
                        <input
                          type="checkbox"
                          checked={franchiseeIds.includes(f.id)}
                          onChange={(e) =>
                            setFranchiseeIds((prev) =>
                              e.target.checked ? [...prev, f.id] : prev.filter((id) => id !== f.id),
                            )
                          }
                          className="h-4 w-4"
                        />
                        <span className="flex flex-col">
                          <span className="text-sm font-semibold">{f.name}</span>
                          <span className="text-daisy-muted text-xs">{f.email}</span>
                        </span>
                      </label>
                    ))}
                    {(franchisees.data ?? []).length === 0 ? (
                      <p className="text-daisy-muted p-3 text-xs">No active franchisees.</p>
                    ) : null}
                  </div>
                )}
              </div>
            ) : null}

            {audienceType === 'list' ? (
              <div className="flex flex-col gap-1.5">
                <Label>List</Label>
                <Select value={listId || undefined} onValueChange={setListId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a list…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(lists.data ?? []).map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.name} ({l.member_count} member{l.member_count === 1 ? '' : 's'})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {(lists.data ?? []).length === 0 && !lists.isLoading ? (
                  <p className="text-daisy-muted text-xs">
                    No lists yet — create one on the Lists tab first.
                  </p>
                ) : null}
              </div>
            ) : null}

            {/* Live recipient count */}
            <p className="text-daisy-ink text-sm font-semibold" aria-live="polite">
              {!audienceValid ? (
                <span className="text-daisy-muted font-normal">
                  {audienceType === 'list'
                    ? 'Choose a list to see the recipient count.'
                    : 'Tick at least one franchisee to see the recipient count.'}
                </span>
              ) : count.isFetching || !count.data ? (
                count.isError ? (
                  <span className="text-daisy-orange font-normal">
                    Could not count recipients: {count.error.message}
                  </span>
                ) : (
                  'Counting recipients…'
                )
              ) : isFranchiseeAudience(audienceType) ? (
                `To send: ${count.data.to_send}`
              ) : (
                `To send: ${count.data.to_send} (${count.data.suppressed} suppressed excluded)`
              )}
            </p>
          </div>

          <BlockEditor blocks={blocks} onChange={setBlocks} />
        </div>

        {/* Right: sticky live preview */}
        <EmailPreview blocks={blocks} preheader={preheader} />
      </div>

      {/* Send-now confirmation */}
      <Dialog open={confirmSendOpen} onOpenChange={setConfirmSendOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Send this email now?</DialogTitle>
            <DialogDescription>
              &ldquo;{subject.trim() || name.trim()}&rdquo; will go to{' '}
              <strong>{audienceText}</strong>
              {count.data ? (
                <>
                  {' '}
                  — <strong>{count.data.to_send}</strong> recipient
                  {count.data.to_send === 1 ? '' : 's'}
                </>
              ) : null}
              . This sends immediately and cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setConfirmSendOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void handleConfirmSend()} disabled={busy}>
              {sendNow.isPending ? 'Sending…' : 'Send now'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Schedule dialog */}
      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Schedule this email</DialogTitle>
            <DialogDescription>
              To {audienceText}. Sends on the next hourly run after this time.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bc-schedule">Date and time</Label>
            <Input
              id="bc-schedule"
              type="datetime-local"
              value={scheduleValue}
              min={toLocalInputValue(new Date())}
              onChange={(e) => setScheduleValue(e.target.value)}
            />
            <p className="text-daisy-muted text-xs">
              Times are in your local timezone; the schedule is stored in UTC.
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setScheduleOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void handleConfirmSchedule()} disabled={busy}>
              {schedule.isPending ? 'Scheduling…' : 'Schedule'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
