import { useMemo, useState, type ReactNode } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import { Inbox, Save } from 'lucide-react';
import { PageHeader, DataTable, StatusPill, EmptyState } from '@/components/daisy';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  useInterestForms,
  useUpdateInterestForm,
  INTEREST_FORM_STATUSES,
  type InterestForm,
  type InterestFormStatus,
} from './queries';

/**
 * Map interest-form status -> StatusPill variant.
 *
 * StatusPill has no native pills for the interest-form lifecycle, so
 * we re-use existing variants from the franchisee/billing palette:
 *
 *   new       -> pending      (amber, awaiting attention)
 *   contacted -> active       (green, in progress)
 *   booked    -> paid         (green, success - converted to revenue)
 *   declined  -> failed       (red, definitively rejected)
 *   expired   -> terminated   (red-grey, dropped without conversion)
 *
 * Documented here so future callers don't reinvent the mapping.
 */
const STATUS_PILL_VARIANT: Record<
  InterestFormStatus,
  'pending' | 'active' | 'paid' | 'failed' | 'terminated'
> = {
  new: 'pending',
  contacted: 'active',
  booked: 'paid',
  declined: 'failed',
  expired: 'terminated',
};

const STATUS_FILTER_OPTIONS: ReadonlyArray<{
  value: InterestFormStatus | 'all';
  label: string;
}> = [
  { value: 'all', label: 'All statuses' },
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'booked', label: 'Booked' },
  { value: 'declined', label: 'Declined' },
  { value: 'expired', label: 'Expired' },
];

const STATUS_LABEL: Record<InterestFormStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  booked: 'Booked',
  declined: 'Declined',
  expired: 'Expired',
};

function formatRelative(iso: string): string {
  const then = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - then.getTime();
  if (Number.isNaN(diffMs)) return '-';
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Europe/London',
  }).format(then);
}

function truncate(value: string | null, max = 60): string {
  if (!value) return '-';
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

export default function InterestFormsPage() {
  const [statusFilter, setStatusFilter] = useState<InterestFormStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<InterestForm | null>(null);

  const filters = useMemo(
    () => ({
      status: statusFilter === 'all' ? undefined : statusFilter,
      search: search.trim() || undefined,
    }),
    [statusFilter, search],
  );

  const query = useInterestForms(filters);
  const updateMutation = useUpdateInterestForm();

  const rows = useMemo<InterestForm[]>(
    () => query.data?.pages.flatMap((p) => p.rows) ?? [],
    [query.data],
  );

  // Keep the side panel in sync if the underlying row gets updated.
  const selectedSynced = useMemo<InterestForm | null>(() => {
    if (!selected) return null;
    return rows.find((r) => r.id === selected.id) ?? selected;
  }, [selected, rows]);

  const handleStatusChange = async (form: InterestForm, nextStatus: InterestFormStatus) => {
    if (form.status === nextStatus) return;
    try {
      await updateMutation.mutateAsync({
        id: form.id,
        fields: { status: nextStatus },
      });
      toast.success(
        `${form.postcode} - status changed from ${STATUS_LABEL[form.status]} to ${STATUS_LABEL[nextStatus]}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Update failed';
      toast.error(message);
    }
  };

  const columns = useMemo<ColumnDef<InterestForm>[]>(
    () => [
      {
        accessorKey: 'postcode',
        header: 'Postcode',
        cell: ({ row }) => (
          <span className="text-daisy-ink-soft font-mono text-[13px] font-bold">
            {row.original.postcode}
          </span>
        ),
      },
      {
        accessorKey: 'num_attendees',
        header: 'Attendees',
        cell: ({ row }) => (
          <span className="font-semibold tabular-nums">{row.original.num_attendees}</span>
        ),
      },
      {
        id: 'contact',
        header: 'Contact',
        cell: ({ row }) => (
          <div className="flex flex-col leading-tight">
            <span className="text-daisy-ink font-bold">{row.original.contact_name}</span>
            <span className="text-daisy-muted text-[12px]">{row.original.contact_email}</span>
            {row.original.contact_phone ? (
              <span className="text-daisy-muted text-[12px]">{row.original.contact_phone}</span>
            ) : null}
          </div>
        ),
      },
      {
        accessorKey: 'preferred_dates',
        header: 'Preferred dates',
        cell: ({ row }) => (
          <span
            className="text-daisy-ink-soft text-[13px]"
            title={row.original.preferred_dates ?? ''}
          >
            {truncate(row.original.preferred_dates, 40)}
          </span>
        ),
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => (
          <StatusPill variant={STATUS_PILL_VARIANT[row.original.status]}>
            {STATUS_LABEL[row.original.status]}
          </StatusPill>
        ),
      },
      {
        accessorKey: 'created_at',
        header: 'Created',
        cell: ({ row }) => (
          <span className="text-daisy-muted text-[13px]">
            {formatRelative(row.original.created_at)}
          </span>
        ),
      },
      {
        id: 'actions',
        header: 'Actions',
        cell: ({ row }) => (
          <RowActions
            form={row.original}
            onStatusChange={(next) => void handleStatusChange(row.original, next)}
            disabled={updateMutation.isPending}
          />
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [updateMutation.isPending],
  );

  const totalLoaded = rows.length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Interest forms"
        subtitle="Triage parent and corporate enquiries from postcodes without an active franchisee."
        actions={<Badge variant="primary">{totalLoaded} loaded</Badge>}
      />

      <div className="mb-2 flex flex-wrap items-center gap-3">
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by postcode, name, or email…"
          className="h-10 max-w-sm flex-1 rounded-full"
          aria-label="Search interest forms"
        />
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as InterestFormStatus | 'all')}
        >
          <SelectTrigger className="w-[200px]">
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
      </div>

      {query.isError ? (
        <div className="mb-4 rounded-[8px] border border-[#FDEAE5] bg-[#FDEAE5]/40 p-4 text-sm text-[#8A2A2A]">
          Could not load interest forms: {query.error.message}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div>
          <DataTable<InterestForm>
            columns={columns}
            data={rows}
            isLoading={query.isLoading}
            searchable={false}
            onRowClick={(row) => setSelected(row)}
            emptyState={
              <EmptyState
                icon={<Inbox />}
                title="No interest forms yet."
                body="They'll arrive here when parents in unowned territories enquire about courses with 5+ attendees."
              />
            }
          />

          {query.hasNextPage ? (
            <div className="mt-4 flex justify-center">
              <Button
                variant="outline"
                onClick={() => void query.fetchNextPage()}
                disabled={query.isFetchingNextPage}
              >
                {query.isFetchingNextPage ? 'Loading more…' : 'Load more'}
              </Button>
            </div>
          ) : null}
        </div>

        <SidePanel selected={selectedSynced} onClose={() => setSelected(null)} />
      </div>
    </div>
  );
}

interface RowActionsProps {
  form: InterestForm;
  onStatusChange: (next: InterestFormStatus) => void;
  disabled: boolean;
}

function RowActions({ form, onStatusChange, disabled }: RowActionsProps) {
  // Stop row-click navigation when interacting with form controls inside the row.
  const stop: ReactNode = null;
  void stop;

  return (
    <div className="flex flex-col items-stretch gap-2" onClick={(e) => e.stopPropagation()}>
      <Select
        value={form.status}
        onValueChange={(v) => onStatusChange(v as InterestFormStatus)}
        disabled={disabled}
      >
        <SelectTrigger
          className="h-8 w-[140px] text-xs"
          aria-label={`Change status for ${form.postcode}`}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {INTEREST_FORM_STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              {STATUS_LABEL[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Button variant="outline" size="sm" disabled className="w-full">
              Convert to private booking
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>Available in M2 (franchisee portal)</TooltipContent>
      </Tooltip>
    </div>
  );
}

interface SidePanelProps {
  selected: InterestForm | null;
  onClose: () => void;
}

function SidePanel({ selected, onClose }: SidePanelProps) {
  if (!selected) {
    return (
      <aside className="border-daisy-line-soft bg-daisy-paper rounded-[12px] border p-6">
        <h2 className="font-display text-daisy-ink mb-2 text-lg font-bold">Form details</h2>
        <p className="text-daisy-muted text-sm">
          Select a row to see the full enquiry, edit the notes, or assign a freelancer.
        </p>
      </aside>
    );
  }

  return <SidePanelDetail key={selected.id} form={selected} onClose={onClose} />;
}

interface SidePanelDetailProps {
  form: InterestForm;
  onClose: () => void;
}

function SidePanelDetail({ form, onClose }: SidePanelDetailProps) {
  const updateMutation = useUpdateInterestForm();
  const [notes, setNotes] = useState(form.notes ?? '');
  const [assignedFreelancer, setAssignedFreelancer] = useState(form.assigned_freelancer ?? '');

  const isDirty =
    (notes ?? '') !== (form.notes ?? '') ||
    (assignedFreelancer ?? '') !== (form.assigned_freelancer ?? '');

  const handleSave = async () => {
    const fields: Record<string, string | null> = {};
    if ((notes ?? '') !== (form.notes ?? '')) {
      fields.notes = notes.trim().length === 0 ? null : notes;
    }
    if ((assignedFreelancer ?? '') !== (form.assigned_freelancer ?? '')) {
      fields.assigned_freelancer =
        assignedFreelancer.trim().length === 0 ? null : assignedFreelancer.trim();
    }
    if (Object.keys(fields).length === 0) return;

    try {
      await updateMutation.mutateAsync({ id: form.id, fields });
      toast.success(`${form.postcode} - saved`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Save failed';
      toast.error(message);
    }
  };

  return (
    <aside className="border-daisy-line-soft bg-daisy-paper flex flex-col gap-4 rounded-[12px] border p-6">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-display text-daisy-ink text-lg font-bold">{form.postcode}</h2>
          <p className="text-daisy-muted text-xs">
            {form.num_attendees} attendees · {STATUS_LABEL[form.status]}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>

      <dl className="grid grid-cols-1 gap-y-2 text-sm">
        <Field label="Contact">
          <div className="flex flex-col">
            <span className="text-daisy-ink font-semibold">{form.contact_name}</span>
            <span className="text-daisy-muted text-[12px]">{form.contact_email}</span>
            {form.contact_phone ? (
              <span className="text-daisy-muted text-[12px]">{form.contact_phone}</span>
            ) : null}
          </div>
        </Field>
        <Field label="Preferred dates">{form.preferred_dates ?? '-'}</Field>
        <Field label="Venue preference">{form.venue_preference ?? '-'}</Field>
        <Field label="Created">{formatRelative(form.created_at)}</Field>
      </dl>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`assigned-freelancer-${form.id}`}
          className="text-daisy-muted text-xs font-semibold tracking-wide uppercase"
        >
          Assigned freelancer
        </label>
        <Input
          id={`assigned-freelancer-${form.id}`}
          value={assignedFreelancer}
          onChange={(e) => setAssignedFreelancer(e.target.value)}
          placeholder="Name (free text for M1)"
          className="h-9"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`notes-${form.id}`}
          className="text-daisy-muted text-xs font-semibold tracking-wide uppercase"
        >
          Notes
        </label>
        <textarea
          id={`notes-${form.id}`}
          rows={5}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="border-daisy-line text-daisy-ink placeholder:text-daisy-muted focus-visible:border-daisy-primary rounded-[8px] border-2 bg-white px-3 py-2 text-sm focus-visible:outline-none"
          placeholder="Add notes about this enquiry…"
        />
      </div>

      <div className="flex justify-end">
        <Button onClick={() => void handleSave()} disabled={!isDirty || updateMutation.isPending}>
          <Save className="h-4 w-4" />
          {updateMutation.isPending ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </aside>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-daisy-muted text-xs font-semibold tracking-wide uppercase">{label}</dt>
      <dd className="text-daisy-ink text-sm">{children}</dd>
    </div>
  );
}
