import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { Receipt } from 'lucide-react';
import { PageHeader, DataTable, StatusPill, EmptyState } from '@/components/daisy';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatPence } from '@/lib/format';
import { useBillingRuns, type BillingRunRow, type BillingPaymentStatus } from './queries';
import { PreviewBillingDialog } from './PreviewBillingDialog';
import type { StatusVariant } from '@/components/daisy/StatusPill';

const PAYMENT_OPTIONS: ReadonlyArray<{
  value: BillingPaymentStatus | 'all';
  label: string;
}> = [
  { value: 'all', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'sent', label: 'Sent' },
  { value: 'paid', label: 'Paid' },
  { value: 'failed', label: 'Failed' },
  { value: 'retry', label: 'Retry' },
];

/**
 * Map `billing_runs.payment_status` to StatusPill variants. M1 plan §6
 * Wave 4 Agent 4C calls these out: pending → pending, sent → manual
 * (neutral blue), paid → paid, failed → failed, retry → overdue (amber).
 */
export function billingStatusVariant(s: BillingPaymentStatus): StatusVariant {
  switch (s) {
    case 'paid':
      return 'paid';
    case 'pending':
      return 'pending';
    case 'failed':
      return 'failed';
    case 'sent':
      return 'manual';
    case 'retry':
      return 'overdue';
    default:
      return 'pending';
  }
}

function formatPeriod(start: string, end: string): string {
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'Europe/London',
    }).format(d);
  return `${fmt(s)} – ${fmt(e)}`;
}

function formatDateOnly(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Europe/London',
  }).format(new Date(iso));
}

export default function BillingPage() {
  const navigate = useNavigate();
  const [paymentStatus, setPaymentStatus] = useState<BillingPaymentStatus | 'all'>('all');
  const [previewOpen, setPreviewOpen] = useState(false);

  const runs = useBillingRuns({
    paymentStatus,
  });

  const totalCount = runs.data?.length ?? 0;

  const columns = useMemo<ColumnDef<BillingRunRow>[]>(
    () => [
      {
        id: 'period',
        header: 'Period',
        cell: ({ row }) => (
          <span className="font-semibold">
            {formatPeriod(row.original.billing_period_start, row.original.billing_period_end)}
          </span>
        ),
      },
      {
        id: 'franchisee',
        header: 'Franchisee',
        cell: ({ row }) => (
          <span className="flex flex-col">
            <span className="text-daisy-ink font-bold">{row.original.franchisee_name}</span>
            <span className="text-daisy-muted font-mono text-[12px]">
              {row.original.franchisee_number.padStart(4, '0')}
            </span>
          </span>
        ),
      },
      {
        accessorKey: 'total_due_pence',
        header: 'Total due',
        cell: ({ row }) => (
          <span className="text-daisy-ink font-bold">
            {formatPence(row.original.total_due_pence)}
          </span>
        ),
      },
      {
        accessorKey: 'payment_status',
        header: 'Status',
        cell: ({ row }) => (
          <StatusPill variant={billingStatusVariant(row.original.payment_status)}>
            {row.original.payment_status}
          </StatusPill>
        ),
      },
      {
        accessorKey: 'paid_at',
        header: 'Paid at',
        cell: ({ row }) => (
          <span className="text-daisy-muted text-[13px]">
            {formatDateOnly(row.original.paid_at)}
          </span>
        ),
      },
      {
        id: 'actions',
        header: 'Actions',
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/hq/billing/${row.original.id}`);
              }}
            >
              View
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button variant="ghost" size="sm" disabled>
                    Retry
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>Retry ships in Phase 2 with GoCardless.</TooltipContent>
            </Tooltip>
          </div>
        ),
      },
    ],
    [navigate],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Billing"
        subtitle="Preview the next monthly run, or audit historical runs once Phase 2 begins collecting."
        actions={
          <>
            <Badge variant="primary">
              {totalCount === 0
                ? '0 runs to date'
                : `${totalCount} run${totalCount === 1 ? '' : 's'}`}
            </Badge>
            <Button onClick={() => setPreviewOpen(true)}>
              <Receipt className="h-4 w-4" />
              Preview next run
            </Button>
          </>
        }
      />

      <div className="mb-2 flex flex-wrap items-center gap-3">
        <Select
          value={paymentStatus}
          onValueChange={(v) => setPaymentStatus(v as BillingPaymentStatus | 'all')}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAYMENT_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {runs.isError ? (
        <div className="mb-4 rounded-[8px] border border-[#FDEAE5] bg-[#FDEAE5]/40 p-4 text-sm text-[#8A2A2A]">
          Could not load billing runs: {runs.error.message}
        </div>
      ) : null}

      <DataTable<BillingRunRow>
        columns={columns}
        data={runs.data ?? []}
        isLoading={runs.isLoading}
        searchable={false}
        onRowClick={(row) => navigate(`/hq/billing/${row.id}`)}
        emptyState={
          <EmptyState
            icon={<Receipt />}
            title="No billing runs yet"
            body="Phase 2 (Weeks 14–17) automates the monthly collection. In the meantime, use 'Preview next run' to dry-run the calculation against any franchisee or all of them."
            cta={{
              label: 'Preview next run',
              onClick: () => setPreviewOpen(true),
            }}
          />
        }
      />

      <PreviewBillingDialog open={previewOpen} onClose={() => setPreviewOpen(false)} />
    </div>
  );
}
