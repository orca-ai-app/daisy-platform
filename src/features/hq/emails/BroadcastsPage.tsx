import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { Megaphone, Plus } from 'lucide-react';
import { DataTable, EmptyState, PageHeader, StatusPill } from '@/components/daisy';
import { Button } from '@/components/ui/button';
import { EmailSectionTabs } from './EmailSectionTabs';
import {
  useBroadcastRecipientTotals,
  useBroadcasts,
  useEmailLists,
  type EmailBroadcast,
} from './queries';
import {
  BROADCAST_STATUS_LABEL,
  BROADCAST_STATUS_VARIANT,
  describeAudience,
  formatDateTime,
} from './broadcastHelpers';

interface BroadcastRow extends EmailBroadcast {
  audienceText: string;
  sentCount: number;
  openedCount: number;
}

export default function BroadcastsPage() {
  const navigate = useNavigate();
  const broadcasts = useBroadcasts();
  const totals = useBroadcastRecipientTotals();
  const lists = useEmailLists();

  const listNamesById = useMemo(
    () => Object.fromEntries((lists.data ?? []).map((l) => [l.id, l.name])),
    [lists.data],
  );

  const rows = useMemo<BroadcastRow[]>(
    () =>
      (broadcasts.data ?? []).map((b) => ({
        ...b,
        audienceText: describeAudience(b.audience_type, b.audience_config, listNamesById),
        sentCount: totals.data?.[b.id]?.sent ?? 0,
        openedCount: totals.data?.[b.id]?.opened ?? 0,
      })),
    [broadcasts.data, totals.data, listNamesById],
  );

  const columns = useMemo<ColumnDef<BroadcastRow>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Name',
        cell: ({ row }) => <span className="font-bold">{row.original.name}</span>,
      },
      {
        accessorKey: 'audienceText',
        header: 'Audience',
        cell: ({ row }) => (
          <span className="text-daisy-ink-soft text-[13px]">{row.original.audienceText}</span>
        ),
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => (
          <StatusPill variant={BROADCAST_STATUS_VARIANT[row.original.status]}>
            {BROADCAST_STATUS_LABEL[row.original.status]}
          </StatusPill>
        ),
      },
      {
        id: 'when',
        accessorFn: (row) => row.sent_at ?? row.scheduled_for ?? '',
        header: 'Scheduled / sent',
        cell: ({ row }) => (
          <span className="text-daisy-muted text-[13px]">
            {row.original.status === 'scheduled'
              ? formatDateTime(row.original.scheduled_for)
              : formatDateTime(row.original.sent_at)}
          </span>
        ),
      },
      {
        id: 'sent',
        accessorFn: (row) => row.sentCount,
        header: 'Sent',
        cell: ({ row }) => <span className="font-semibold">{row.original.sentCount}</span>,
      },
      {
        id: 'opened',
        accessorFn: (row) => row.openedCount,
        header: 'Opened',
        cell: ({ row }) => <span className="font-semibold">{row.original.openedCount}</span>,
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Broadcast emails"
        subtitle="One-off emails to customers, franchisees or saved lists. Drafts and scheduled emails open in the composer; sent emails open their delivery report."
        actions={
          <Button size="sm" onClick={() => void navigate('/hq/emails/broadcasts/new')}>
            <Plus className="h-4 w-4" />
            New email
          </Button>
        }
      />
      <EmailSectionTabs />

      {broadcasts.isError ? (
        <p className="text-daisy-orange text-sm">
          Failed to load broadcasts: {broadcasts.error.message}
        </p>
      ) : (
        <DataTable<BroadcastRow>
          columns={columns}
          data={rows}
          isLoading={broadcasts.isLoading}
          searchPlaceholder="Search broadcasts…"
          onRowClick={(row) =>
            void navigate(
              row.status === 'draft' || row.status === 'scheduled'
                ? `/hq/emails/broadcasts/${row.id}/edit`
                : `/hq/emails/broadcasts/${row.id}`,
            )
          }
          emptyState={
            <EmptyState
              icon={<Megaphone />}
              title="No broadcasts yet"
              body="Compose a one-off email to customers, franchisees or a saved list. Drafts stay here until you send or schedule them."
              action={
                <Button onClick={() => void navigate('/hq/emails/broadcasts/new')}>
                  <Plus className="h-4 w-4" />
                  New email
                </Button>
              }
            />
          }
        />
      )}
    </div>
  );
}
