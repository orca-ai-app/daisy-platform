import { useMemo } from 'react';
import { Link, useParams, useNavigate } from 'react-router';
import { ArrowLeft, FileSpreadsheet, FileText, Receipt } from 'lucide-react';
import { PageHeader, StatCard, StatusPill, EmptyState } from '@/components/daisy';
import { Button } from '@/components/ui/button';
import { formatPence } from '@/lib/format';
import { useActivityLog, formatActivityDescription } from '@/lib/queries/activities';
import {
  useBillingRun,
  parseTerritoryBreakdown,
  type FranchiseePreview,
  type TerritoryBreakdownRow,
} from './queries';
import { billingStatusVariant } from './BillingPage';
import {
  exportBillingPreviewToCSV,
  exportBillingPreviewToPDF,
  billingExportFilename,
} from './exports';

function formatPeriod(start: string, end: string): string {
  const fmt = (iso: string) =>
    new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'Europe/London',
    }).format(new Date(`${iso}T00:00:00Z`));
  return `${fmt(start)} – ${fmt(end)}`;
}

export default function BillingRunDetail() {
  const params = useParams<{ run_id: string }>();
  const navigate = useNavigate();
  const runId = params.run_id;
  const run = useBillingRun(runId);
  const activity = useActivityLog({
    entityType: 'billing_run',
    entityId: runId,
    limit: 20,
  });

  const breakdown = useMemo<TerritoryBreakdownRow[]>(
    () => (run.data ? parseTerritoryBreakdown(run.data.territory_breakdown) : []),
    [run.data],
  );

  // Map a saved billing run into the preview shape so we can re-use the same
  // CSV/PDF generators across the app.
  const asPreview = useMemo<FranchiseePreview | null>(() => {
    if (!run.data) return null;
    return {
      franchisee_id: run.data.franchisee_id,
      franchisee_number: run.data.franchisee_number,
      franchisee_name: run.data.franchisee_name,
      // The fee_tier isn't stored on the run row — leave it 0 here, the export
      // surfaces it from the breakdown rows directly anyway.
      fee_tier: 0,
      billing_period_start: run.data.billing_period_start,
      billing_period_end: run.data.billing_period_end,
      territory_breakdown: breakdown,
      total_base_fees_pence: run.data.total_base_fees_pence,
      total_percentage_fees_pence: run.data.total_percentage_fees_pence,
      total_due_pence: run.data.total_due_pence,
      pro_rata_applied: breakdown.some((r) => r.logic.endsWith('_pro_rata')),
    };
  }, [run.data, breakdown]);

  if (run.isLoading) {
    return <p className="text-daisy-muted text-sm">Loading billing run…</p>;
  }
  if (run.isError) {
    return (
      <div className="rounded-[8px] border border-[#FDEAE5] bg-[#FDEAE5]/40 p-4 text-sm text-[#8A2A2A]">
        Could not load billing run: {run.error.message}
      </div>
    );
  }
  if (!run.data) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Billing run" subtitle="Run not found." />
        <EmptyState
          icon={<Receipt />}
          title="Run not found"
          body="The billing run id is invalid or this row is no longer visible to you."
          cta={{ label: 'Back to billing', onClick: () => navigate('/hq/billing') }}
        />
      </div>
    );
  }

  const handleCSV = () => {
    if (!asPreview) return;
    exportBillingPreviewToCSV(
      asPreview,
      billingExportFilename(asPreview.billing_period_start, asPreview.billing_period_end, 'csv'),
    );
  };
  const handlePDF = () => {
    if (!asPreview) return;
    exportBillingPreviewToPDF(
      asPreview,
      billingExportFilename(asPreview.billing_period_start, asPreview.billing_period_end, 'pdf'),
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumb={
          <Link
            to="/hq/billing"
            className="hover:text-daisy-primary-deep inline-flex items-center gap-1"
          >
            <ArrowLeft className="h-3 w-3" /> Billing
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {run.data.franchisee_name}
            <StatusPill variant={billingStatusVariant(run.data.payment_status)}>
              {run.data.payment_status}
            </StatusPill>
          </span>
        }
        subtitle={`${formatPeriod(
          run.data.billing_period_start,
          run.data.billing_period_end,
        )} · ${run.data.franchisee_number.padStart(4, '0')}`}
        actions={
          <>
            <Button variant="outline" onClick={handleCSV}>
              <FileSpreadsheet className="h-4 w-4" />
              Export CSV
            </Button>
            <Button variant="outline" onClick={handlePDF}>
              <FileText className="h-4 w-4" />
              Export PDF
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Total due"
          value={formatPence(run.data.total_due_pence)}
          delta={`${breakdown.length} territor${breakdown.length === 1 ? 'y' : 'ies'}`}
          tone="flat"
        />
        <StatCard
          label="Total base fees"
          value={formatPence(run.data.total_base_fees_pence)}
          tone="flat"
        />
        <StatCard
          label="Total 10% fees"
          value={formatPence(run.data.total_percentage_fees_pence)}
          tone="flat"
        />
      </div>

      <section className="border-daisy-line-soft bg-daisy-paper shadow-card rounded-[12px] border p-5">
        <h2 className="font-display text-daisy-ink mb-3 text-lg font-bold">Territory breakdown</h2>
        {breakdown.length === 0 ? (
          <p className="text-daisy-muted py-2 text-sm italic">
            No territories were billed in this run.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[14px]">
              <thead>
                <tr className="text-daisy-muted border-daisy-line-soft border-b text-left text-[11px] font-bold tracking-wider uppercase">
                  <th className="px-3 py-2">Territory</th>
                  <th className="px-3 py-2">Postcode</th>
                  <th className="px-3 py-2 text-right">Base fee</th>
                  <th className="px-3 py-2 text-right">Revenue</th>
                  <th className="px-3 py-2 text-right">10% fee</th>
                  <th className="px-3 py-2 text-right">Charged</th>
                  <th className="px-3 py-2 text-right">Logic</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.map((row) => {
                  const baseWins = row.logic.startsWith('base_fee');
                  return (
                    <tr
                      key={row.territory_id}
                      className="border-daisy-line border-b border-dashed last:border-b-0"
                    >
                      <td className="text-daisy-ink px-3 py-3 font-semibold">
                        {row.territory_name}
                      </td>
                      <td className="text-daisy-muted px-3 py-3 font-mono text-xs">
                        {row.postcode_prefix}
                      </td>
                      <td
                        className={`px-3 py-3 text-right ${
                          baseWins ? 'text-daisy-primary-deep font-bold' : 'text-daisy-muted'
                        }`}
                      >
                        {formatPence(row.base_fee_pence)}
                      </td>
                      <td className="text-daisy-ink px-3 py-3 text-right">
                        {formatPence(row.revenue_pence)}
                      </td>
                      <td
                        className={`px-3 py-3 text-right ${
                          !baseWins ? 'text-daisy-primary-deep font-bold' : 'text-daisy-muted'
                        }`}
                      >
                        {formatPence(row.percentage_fee_pence)}
                      </td>
                      <td className="text-daisy-ink px-3 py-3 text-right font-bold">
                        {formatPence(row.fee_charged_pence)}
                      </td>
                      <td className="text-daisy-muted px-3 py-3 text-right text-xs">
                        {baseWins ? 'Base' : '10%'}
                        {row.logic.endsWith('_pro_rata') ? ' · pro-rata' : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="border-daisy-line-soft bg-daisy-paper shadow-card rounded-[12px] border p-5">
        <h2 className="font-display text-daisy-ink mb-3 text-lg font-bold">Activity log</h2>
        {activity.isLoading ? (
          <p className="text-daisy-muted text-sm">Loading…</p>
        ) : activity.isError ? (
          <p className="text-daisy-orange text-sm">
            Failed to load activity: {activity.error.message}
          </p>
        ) : (
          (() => {
            const rows = activity.data?.pages.flatMap((p) => p.rows) ?? [];
            if (rows.length === 0) {
              return (
                <p className="text-daisy-muted text-sm">
                  No activity logged for this run yet. Phase 2 records collection events here.
                </p>
              );
            }
            return (
              <ol className="border-daisy-line-soft flex flex-col gap-2 border-l-2 pl-4">
                {rows.map((row) => (
                  <li key={row.id} className="text-sm">
                    <span className="text-daisy-ink font-semibold">
                      {formatActivityDescription(row)}
                    </span>
                    <span className="text-daisy-muted ml-2 text-xs">
                      {new Date(row.created_at).toLocaleString('en-GB', {
                        timeZone: 'Europe/London',
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </li>
                ))}
              </ol>
            );
          })()
        )}
      </section>
    </div>
  );
}
