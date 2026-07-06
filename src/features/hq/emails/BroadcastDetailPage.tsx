/**
 * Broadcast delivery report: per-status StatCards plus the recipient table
 * with status filter and email search. Polls while the broadcast is sending.
 */

import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { ArrowLeft, CircleSlash, Mail, MailOpen, TriangleAlert, Users } from 'lucide-react';
import { DataTable, EmptyState, PageHeader, StatCard, StatusPill } from '@/components/daisy';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useBroadcast,
  useBroadcastRecipients,
  useEmailLists,
  type BroadcastRecipient,
  type RecipientStatus,
} from './queries';
import {
  BROADCAST_STATUS_LABEL,
  BROADCAST_STATUS_VARIANT,
  RECIPIENT_STATUS_LABEL,
  RECIPIENT_STATUS_VARIANT,
  describeAudience,
  formatDateTime,
} from './broadcastHelpers';

const SENDING_POLL_MS = 3000;

const STATUS_FILTER_OPTIONS: ReadonlyArray<{ value: RecipientStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'sent', label: 'Sent' },
  { value: 'failed', label: 'Failed' },
  { value: 'skipped', label: 'Skipped' },
];

export default function BroadcastDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  // While a send is in flight the broadcast row and the recipient
  // snapshot both re-poll every few seconds.
  const broadcast = useBroadcast(id, { pollMsWhileSending: SENDING_POLL_MS });
  const isSending = broadcast.data?.status === 'sending';
  const recipients = useBroadcastRecipients(id, {
    pollMs: isSending ? SENDING_POLL_MS : undefined,
  });
  const lists = useEmailLists();

  const [statusFilter, setStatusFilter] = useState<RecipientStatus | 'all'>('all');

  const row = broadcast.data;

  const listNamesById = useMemo(
    () => Object.fromEntries((lists.data ?? []).map((l) => [l.id, l.name])),
    [lists.data],
  );

  const stats = useMemo(() => {
    const all = recipients.data ?? [];
    const sent = all.filter((r) => r.status === 'sent').length;
    const opened = all.filter((r) => Boolean(r.opened_at)).length;
    return {
      total: all.length,
      sent,
      opened,
      openRatePct: sent > 0 ? Math.round((opened / sent) * 100) : null,
      failed: all.filter((r) => r.status === 'failed').length,
      skipped: all.filter((r) => r.status === 'skipped').length,
    };
  }, [recipients.data]);

  const filteredRecipients = useMemo(
    () =>
      statusFilter === 'all'
        ? (recipients.data ?? [])
        : (recipients.data ?? []).filter((r) => r.status === statusFilter),
    [recipients.data, statusFilter],
  );

  const columns = useMemo<ColumnDef<BroadcastRecipient>[]>(
    () => [
      {
        accessorKey: 'email',
        header: 'Email',
        cell: ({ row: r }) => <span className="font-semibold">{r.original.email}</span>,
      },
      {
        id: 'name',
        accessorFn: (r) => [r.first_name, r.last_name].filter(Boolean).join(' '),
        header: 'Name',
        cell: ({ row: r }) => (
          <span className="text-daisy-ink-soft text-[13px]">
            {[r.original.first_name, r.original.last_name].filter(Boolean).join(' ') || '-'}
          </span>
        ),
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row: r }) => (
          <StatusPill variant={RECIPIENT_STATUS_VARIANT[r.original.status]}>
            {RECIPIENT_STATUS_LABEL[r.original.status]}
          </StatusPill>
        ),
      },
      {
        accessorKey: 'sent_at',
        header: 'Sent',
        cell: ({ row: r }) => (
          <span className="text-daisy-muted text-[13px]">{formatDateTime(r.original.sent_at)}</span>
        ),
      },
      {
        accessorKey: 'opened_at',
        header: 'Opened',
        cell: ({ row: r }) => (
          <span className="text-daisy-muted text-[13px]">
            {formatDateTime(r.original.opened_at)}
          </span>
        ),
      },
    ],
    [],
  );

  if (broadcast.isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-12 w-1/2" />
        <Skeleton className="h-[420px] w-full" />
      </div>
    );
  }

  if (broadcast.isError || !row) {
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

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumb={
          <Link to="/hq/emails/broadcasts" className="hover:text-daisy-primary transition-colors">
            Broadcasts
          </Link>
        }
        title={row.name}
        subtitle={
          <>
            {describeAudience(row.audience_type, row.audience_config, listNamesById)}
            {row.sent_at ? ` · Sent ${formatDateTime(row.sent_at)}` : ''}
            {row.status === 'sending' ? ' · Sending now, this page refreshes itself.' : ''}
          </>
        }
        actions={
          <StatusPill variant={BROADCAST_STATUS_VARIANT[row.status]}>
            {BROADCAST_STATUS_LABEL[row.status]}
          </StatusPill>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard
          label="Recipients"
          value={recipients.isLoading ? '…' : stats.total}
          icon={Users}
        />
        <StatCard label="Sent" value={recipients.isLoading ? '…' : stats.sent} icon={Mail} />
        <StatCard
          label="Opened"
          value={recipients.isLoading ? '…' : stats.opened}
          delta={stats.openRatePct !== null ? `${stats.openRatePct}% of sent` : undefined}
          tone="flat"
          icon={MailOpen}
        />
        <StatCard
          label="Failed"
          value={recipients.isLoading ? '…' : stats.failed}
          tone={stats.failed > 0 ? 'down' : 'flat'}
          icon={TriangleAlert}
        />
        <StatCard
          label="Skipped"
          value={recipients.isLoading ? '…' : stats.skipped}
          tone="flat"
          icon={CircleSlash}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as RecipientStatus | 'all')}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTER_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-daisy-muted text-xs font-semibold">
          Opens rely on the tracking pixel, so real open rates are usually a little higher.
        </span>
      </div>

      {recipients.isError ? (
        <p className="text-daisy-orange text-sm">
          Failed to load recipients: {recipients.error.message}
        </p>
      ) : (
        <DataTable<BroadcastRecipient>
          columns={columns}
          data={filteredRecipients}
          isLoading={recipients.isLoading}
          searchPlaceholder="Search by email…"
          pageSize={50}
          emptyState={
            <EmptyState
              icon={<Users />}
              title="No recipients"
              body={
                statusFilter === 'all'
                  ? 'The recipient snapshot appears once the send starts.'
                  : 'No recipients with this status.'
              }
              action={
                statusFilter !== 'all' ? (
                  <Button variant="outline" onClick={() => setStatusFilter('all')}>
                    Show all statuses
                  </Button>
                ) : (
                  <Button variant="outline" onClick={() => void navigate('/hq/emails/broadcasts')}>
                    Back to broadcasts
                  </Button>
                )
              }
            />
          }
        />
      )}
    </div>
  );
}
