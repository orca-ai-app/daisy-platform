import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { ChevronDown, ChevronRight, FileSpreadsheet, FileText } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatPence } from '@/lib/format';
import {
  useActiveFranchisees,
  usePreviewBillingRun,
  lastCalendarMonth,
  type FranchiseePreview,
  type PreviewBillingRunResult,
  type TerritoryBreakdownRow,
} from './queries';
import {
  exportBillingPreviewToCSV,
  exportBillingPreviewToPDF,
  billingExportFilename,
} from './exports';

const ALL_VALUE = '__all__';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD');

const formSchema = z
  .object({
    franchiseeId: z.string(),
    billingPeriodStart: isoDate,
    billingPeriodEnd: isoDate,
  })
  .refine((data) => Date.parse(data.billingPeriodStart) <= Date.parse(data.billingPeriodEnd), {
    message: 'Start date must be on or before end date',
    path: ['billingPeriodEnd'],
  });

type FormValues = z.infer<typeof formSchema>;

interface PreviewBillingDialogProps {
  open: boolean;
  onClose: () => void;
}

export function PreviewBillingDialog({ open, onClose }: PreviewBillingDialogProps) {
  const franchisees = useActiveFranchisees();
  const previewMutation = usePreviewBillingRun();
  const [result, setResult] = useState<PreviewBillingRunResult | null>(null);

  const defaults = useMemo(() => lastCalendarMonth(), []);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setValue,
    watch,
    reset,
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      franchiseeId: ALL_VALUE,
      billingPeriodStart: defaults.start,
      billingPeriodEnd: defaults.end,
    },
  });
  const franchiseeId = watch('franchiseeId');

  const handleClose = () => {
    setResult(null);
    reset({
      franchiseeId: ALL_VALUE,
      billingPeriodStart: defaults.start,
      billingPeriodEnd: defaults.end,
    });
    onClose();
  };

  const onSubmit = async (values: FormValues) => {
    try {
      const data = await previewMutation.mutateAsync({
        franchiseeId: values.franchiseeId === ALL_VALUE ? null : values.franchiseeId,
        billingPeriodStart: values.billingPeriodStart,
        billingPeriodEnd: values.billingPeriodEnd,
      });
      setResult(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Preview failed';
      toast.error(message);
    }
  };

  const previews = result == null ? [] : Array.isArray(result) ? result : [result];

  const periodStart = watch('billingPeriodStart') || defaults.start;
  const periodEnd = watch('billingPeriodEnd') || defaults.end;

  const handleCSV = () => {
    if (!result) return;
    exportBillingPreviewToCSV(result, billingExportFilename(periodStart, periodEnd, 'csv'));
    toast.success('CSV downloaded');
  };

  const handlePDF = () => {
    if (!result) return;
    exportBillingPreviewToPDF(result, billingExportFilename(periodStart, periodEnd, 'pdf'));
    toast.success('PDF downloaded');
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? handleClose() : null)}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Preview billing run</DialogTitle>
          <DialogDescription>
            Dry-run the monthly fee calculation. Nothing is written to the database. This is a
            preview only. Phase 2 ships the live collection job.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            void handleSubmit(onSubmit)(e);
          }}
          className="mt-2 flex flex-col gap-4"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="preview-franchisee">Franchisee</Label>
              <Select
                value={franchiseeId}
                onValueChange={(v) => setValue('franchiseeId', v, { shouldDirty: true })}
              >
                <SelectTrigger id="preview-franchisee">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_VALUE}>All active franchisees</SelectItem>
                  {(franchisees.data ?? []).map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.number.padStart(4, '0')}, {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="preview-start">Period start</Label>
              <Input id="preview-start" type="date" {...register('billingPeriodStart')} />
              {errors.billingPeriodStart ? (
                <p className="text-daisy-orange text-xs">{errors.billingPeriodStart.message}</p>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="preview-end">Period end</Label>
              <Input id="preview-end" type="date" {...register('billingPeriodEnd')} />
              {errors.billingPeriodEnd ? (
                <p className="text-daisy-orange text-xs">{errors.billingPeriodEnd.message}</p>
              ) : null}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="submit" disabled={isSubmitting || previewMutation.isPending}>
              {isSubmitting || previewMutation.isPending ? 'Calculating...' : 'Run preview'}
            </Button>
          </div>
        </form>

        {previews.length > 0 ? (
          <div className="mt-4 flex flex-col gap-4">
            {previews.length === 1 ? (
              <SingleFranchiseeBreakdown preview={previews[0]} />
            ) : (
              <MultiFranchiseeBreakdown previews={previews} />
            )}
          </div>
        ) : null}

        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" type="button" onClick={handleCSV} disabled={!result}>
            <FileSpreadsheet className="h-4 w-4" />
            Export CSV
          </Button>
          <Button variant="outline" type="button" onClick={handlePDF} disabled={!result}>
            <FileText className="h-4 w-4" />
            Export PDF
          </Button>
          <Button variant="ghost" type="button" onClick={handleClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------

function SingleFranchiseeBreakdown({ preview }: { preview: FranchiseePreview }) {
  return (
    <section className="border-daisy-line-soft rounded-[12px] border p-4">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="font-display text-daisy-ink text-lg font-bold">
            {preview.franchisee_name}{' '}
            <span className="text-daisy-muted font-mono text-sm">
              {preview.franchisee_number.padStart(4, '0')}
            </span>
          </h3>
          <p className="text-daisy-muted text-xs">
            {preview.billing_period_start} to {preview.billing_period_end} · £{preview.fee_tier}
            /territory
            {preview.pro_rata_applied ? ' · pro-rata applied' : ''}
          </p>
        </div>
        <div className="text-right">
          <div className="text-daisy-muted text-xs tracking-wide uppercase">Total due</div>
          <div className="text-daisy-primary-deep font-display text-2xl font-bold">
            {formatPence(preview.total_due_pence)}
          </div>
        </div>
      </header>
      <BreakdownTable rows={preview.territory_breakdown} />
    </section>
  );
}

function MultiFranchiseeBreakdown({ previews }: { previews: FranchiseePreview[] }) {
  const grandTotal = previews.reduce((acc, p) => acc + p.total_due_pence, 0);

  return (
    <section className="border-daisy-line-soft rounded-[12px] border p-4">
      <header className="mb-3 flex items-baseline justify-between">
        <h3 className="font-display text-daisy-ink text-lg font-bold">
          {previews.length} franchisee{previews.length === 1 ? '' : 's'}
        </h3>
        <div className="text-right">
          <div className="text-daisy-muted text-xs tracking-wide uppercase">Network total</div>
          <div className="text-daisy-primary-deep font-display text-2xl font-bold">
            {formatPence(grandTotal)}
          </div>
        </div>
      </header>
      <ul className="flex flex-col gap-2">
        {previews.map((p) => (
          <FranchiseeRow key={p.franchisee_id} preview={p} />
        ))}
      </ul>
    </section>
  );
}

function FranchiseeRow({ preview }: { preview: FranchiseePreview }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="border-daisy-line-soft rounded-[8px] border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="hover:bg-daisy-primary-tint/40 flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <span className="text-daisy-ink font-bold">{preview.franchisee_name}</span>
          <span className="text-daisy-muted font-mono text-xs">
            {preview.franchisee_number.padStart(4, '0')}
          </span>
          <span className="text-daisy-muted text-xs">
            · {preview.territory_breakdown.length} territor
            {preview.territory_breakdown.length === 1 ? 'y' : 'ies'}
          </span>
        </span>
        <span className="text-daisy-ink font-display font-bold">
          {formatPence(preview.total_due_pence)}
        </span>
      </button>
      {open ? (
        <div className="border-daisy-line-soft border-t px-4 py-3">
          <BreakdownTable rows={preview.territory_breakdown} />
        </div>
      ) : null}
    </li>
  );
}

function BreakdownTable({ rows }: { rows: TerritoryBreakdownRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-daisy-muted py-4 text-center text-sm italic">
        No territories assigned to this franchisee.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="text-daisy-muted text-[11px] font-bold tracking-wider uppercase">
            <th className="border-daisy-line-soft border-b px-2 py-2 text-left">Territory</th>
            <th className="border-daisy-line-soft border-b px-2 py-2 text-left">Postcode</th>
            <th className="border-daisy-line-soft border-b px-2 py-2 text-right">Base</th>
            <th className="border-daisy-line-soft border-b px-2 py-2 text-right">Revenue</th>
            <th className="border-daisy-line-soft border-b px-2 py-2 text-right">10%</th>
            <th className="border-daisy-line-soft border-b px-2 py-2 text-right">Charged</th>
            <th className="border-daisy-line-soft border-b px-2 py-2 text-right">Logic</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const baseWins = row.logic.startsWith('base_fee');
            return (
              <tr key={row.territory_id} className="border-daisy-line border-b border-dashed">
                <td className="px-2 py-2 font-semibold">{row.territory_name}</td>
                <td className="text-daisy-muted px-2 py-2 font-mono text-xs">
                  {row.postcode_prefix}
                </td>
                <td
                  className={`px-2 py-2 text-right ${
                    baseWins ? 'text-daisy-primary-deep font-bold' : 'text-daisy-muted'
                  }`}
                >
                  {formatPence(row.base_fee_pence)}
                </td>
                <td className="px-2 py-2 text-right">{formatPence(row.revenue_pence)}</td>
                <td
                  className={`px-2 py-2 text-right ${
                    !baseWins ? 'text-daisy-primary-deep font-bold' : 'text-daisy-muted'
                  }`}
                >
                  {formatPence(row.percentage_fee_pence)}
                </td>
                <td className="text-daisy-ink px-2 py-2 text-right font-bold">
                  {formatPence(row.fee_charged_pence)}
                </td>
                <td className="text-daisy-muted px-2 py-2 text-right text-xs">
                  {baseWins ? 'Base' : '10%'}
                  {row.logic.endsWith('_pro_rata') ? ' · pro-rata' : ''}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
