/**
 * /franchisee/imports — BookWhen bookings CSV importer (dormant / unlinked).
 *
 * Parses a BookWhen "Export bookings (CSV)" file client-side into an import
 * plan (bookwhenParse.planFromCsv), previews the upcoming courses + bookings,
 * then, on explicit confirmation, drives the existing edge functions via
 * importQueries.runImport to create REAL courses and bookings in the
 * franchisee's account.
 *
 * The parsing / orchestration modules are consumed as-is; this file is purely
 * the UI + wiring. Templates come from the Wave 7A useCourseTemplates() hook.
 */

import { useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { PageHeader, EmptyState, FieldHelp } from '@/components/daisy';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCourseTemplates } from '../courses/createCourseQueries';
import { franchiseeKeys } from '../queryKeys';
import { planFromCsv } from './bookwhenParse';
import type { ImportPlan, PlannedCourse, TemplateLite } from './bookwhenParse';
import { runImport } from './importQueries';
import type { ImportProgress, ImportResult } from './importQueries';

// ---------------------------------------------------------------------------
// Date formatting (wall-clock 'YYYY-MM-DD' — never through a Date constructor
// in a way that can roll the day back under BST).
// ---------------------------------------------------------------------------

const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'Europe/London',
});

function formatEventDate(iso: string | null): string {
  if (!iso) return '—';
  // Treat the string as a wall-clock date: append midday UTC so the London
  // conversion can never fall back to the previous day.
  const d = new Date(`${iso}T12:00:00Z`);
  if (!Number.isFinite(d.getTime())) return '—';
  return DATE_FORMAT.format(d);
}

/** Today's calendar day in Europe/London as 'YYYY-MM-DD' (en-CA gives ISO). */
function londonToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
}

// ---------------------------------------------------------------------------
// Per-course import blocker — mirrors importQueries.courseBlocker so the
// preview flags exactly the courses the importer will skip.
// ---------------------------------------------------------------------------

function courseBlocker(c: PlannedCourse, effectiveTemplateId: string | null): string | null {
  if (!effectiveTemplateId) return 'No course type matched';
  if (!c.event_date) return 'No date';
  if (!c.start_time) return 'No start time';
  if (!c.venue_postcode) return 'No venue postcode';
  return null;
}

function matchBadge(match: PlannedCourse['template_match']) {
  if (match === 'matched') return <Badge variant="success">Matched</Badge>;
  if (match === 'guessed') return <Badge variant="warning">Guessed</Badge>;
  return <Badge variant="danger">Unmatched</Badge>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ImportPage() {
  const queryClient = useQueryClient();
  const { data: templateOptions, isLoading: templatesLoading } = useCourseTemplates();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);

  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  // Per-course "course type" corrections, keyed by bookwhen_event_id → template_id.
  // Lets the franchisee fix a guessed/unmatched type inline before importing.
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  // Map the wizard's template options down to the parser's TemplateLite shape.
  const templates: TemplateLite[] = useMemo(
    () =>
      (templateOptions ?? []).map((t) => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        default_capacity: t.default_capacity,
        default_price_pence: t.default_price_pence,
      })),
    [templateOptions],
  );

  const templatesReady = !templatesLoading && templates.length > 0;

  // The effective course type for a course = the franchisee's override if they
  // picked one, otherwise the parser's matched/guessed template.
  const effectiveTemplateId = (c: PlannedCourse): string | null =>
    overrides[c.bookwhen_event_id] ?? c.template_id;

  // Courses that will be skipped by the importer (blocked) — flagged as
  // "needs attention" in the preview. Uses the effective (overridden) type so a
  // corrected course is no longer flagged for "no course type".
  const blockers = useMemo(() => {
    const map = new Map<string, string>();
    if (!plan) return map;
    for (const c of plan.courses) {
      const b = courseBlocker(c, overrides[c.bookwhen_event_id] ?? c.template_id);
      if (b) map.set(c.bookwhen_event_id, b);
    }
    return map;
  }, [plan, overrides]);

  const importableCount = plan ? plan.courses.length - blockers.size : 0;

  function handleFile(file: File) {
    setParseError(null);
    setResult(null);
    setPlan(null);
    setOverrides({});
    setFileName(file.name);

    const reader = new FileReader();
    reader.onerror = () => setParseError('Could not read that file. Please try again.');
    reader.onload = () => {
      try {
        const text = String(reader.result ?? '');
        const parsed = planFromCsv(text, { today: londonToday(), templates });
        setPlan(parsed);
      } catch (err) {
        setParseError(err instanceof Error ? err.message : 'Could not parse that CSV.');
      }
    };
    reader.readAsText(file);
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    // Allow re-selecting the same file after a reset.
    e.target.value = '';
  }

  function reset() {
    setPlan(null);
    setResult(null);
    setParseError(null);
    setFileName(null);
    setProgress(null);
    setOverrides({});
  }

  async function confirmImport() {
    if (!plan || importing) return;
    setImporting(true);
    setResult(null);
    setProgress({ done: 0, total: 0, label: 'Starting…' });
    try {
      // Apply the franchisee's course-type corrections before importing: an
      // overridden course carries the chosen template_id and counts as matched
      // so the importer's blocker no longer skips it for "no course type".
      const effectivePlan: ImportPlan = {
        ...plan,
        courses: plan.courses.map((c) => {
          const override = overrides[c.bookwhen_event_id];
          if (!override) return c;
          return { ...c, template_id: override, template_match: 'matched' };
        }),
      };
      const res = await runImport(effectivePlan, { onProgress: (p) => setProgress(p) });
      setResult(res);
      toast.success(
        `Import complete — ${res.coursesCreated} course${res.coursesCreated === 1 ? '' : 's'} and ${res.bookingsCreated} booking${res.bookingsCreated === 1 ? '' : 's'} created.`,
      );
      // Refresh the course + booking caches so the imported rows appear.
      void queryClient.invalidateQueries({ queryKey: franchiseeKeys.courses() });
      void queryClient.invalidateQueries({ queryKey: franchiseeKeys.bookings() });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      setImporting(false);
    }
  }

  const progressPct =
    progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Import from BookWhen"
        subtitle="Bring your existing upcoming classes and their paid bookings across in one go."
        actions={
          plan || result ? (
            <Button variant="outline" onClick={reset} disabled={importing}>
              Start over
            </Button>
          ) : undefined
        }
      />

      {/* --- Step 1: upload --------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Upload your bookings file</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-daisy-muted text-sm">
            Export your bookings from BookWhen (Options › Export bookings CSV), then upload the file
            here. We&rsquo;ll show you exactly what will be created before anything happens.
          </p>

          {!templatesReady ? (
            <p className="text-daisy-muted text-[13px]">
              {templatesLoading
                ? 'Loading your course types…'
                : 'No course types are available yet — add a course type before importing.'}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={onFileChange}
              disabled={!templatesReady || importing}
              className="text-daisy-ink file:border-daisy-line file:bg-daisy-line-soft file:text-daisy-ink hover:file:bg-daisy-line block text-sm file:mr-4 file:cursor-pointer file:rounded-[8px] file:border file:px-4 file:py-2 file:text-sm file:font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            />
            {fileName ? <span className="text-daisy-muted text-[13px]">{fileName}</span> : null}
          </div>

          {parseError ? (
            <div className="rounded-[8px] border border-[#FDEAE5] bg-[#FDEAE5]/40 p-3 text-sm text-[#8A2A2A]">
              {parseError}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* --- Step 2: summary + preview ---------------------------------- */}
      {plan ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>What we found</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                <SummaryStat label="Upcoming courses" value={plan.totals.courses} />
                <SummaryStat label="Bookings" value={plan.totals.bookings} />
                <SummaryStat
                  label="Cancelled (not imported)"
                  value={plan.totals.cancelledBookings}
                />
                <SummaryStat label="Past courses skipped" value={plan.skippedPastCourses} />
                <SummaryStat
                  label="Cancelled events skipped"
                  value={plan.skippedCancelledCourses}
                  help="Bookings that were cancelled in BookWhen. We skip these on purpose."
                />
                <SummaryStat
                  label="Unresolved rows"
                  value={plan.unresolved.length}
                  help="Rows we could not turn into a class. They will be left out."
                />
              </dl>

              {plan.warnings.length > 0 ? (
                <ul className="text-daisy-muted mt-4 list-disc space-y-1 pl-5 text-[13px]">
                  {plan.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              ) : null}
            </CardContent>
          </Card>

          {plan.courses.length === 0 ? (
            <EmptyState
              title="No upcoming courses to import"
              body="This file has no upcoming classes we could read. Past classes and cancelled bookings are skipped automatically."
            />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Courses to import</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full text-left text-[13px]">
                  <thead className="border-daisy-line-soft border-b">
                    <tr className="text-daisy-muted text-[11px] font-bold tracking-[0.06em] uppercase">
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Course</th>
                      <th className="px-4 py-3">
                        <span className="inline-flex items-center gap-1">
                          Match
                          <FieldHelp>
                            Matched means we are confident of the class type. Guessed means please
                            check it. Unmatched means choose the class type yourself.
                          </FieldHelp>
                        </span>
                      </th>
                      <th className="px-4 py-3">Course type</th>
                      <th className="px-4 py-3">Venue</th>
                      <th className="px-4 py-3 text-right">Bookings</th>
                      <th className="px-4 py-3">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.courses.map((c) => {
                      const blocker = blockers.get(c.bookwhen_event_id);
                      return (
                        <tr
                          key={c.bookwhen_event_id}
                          className={
                            blocker
                              ? 'border-daisy-line-soft border-b bg-[#FDEAE5]/25 align-top'
                              : 'border-daisy-line-soft border-b align-top'
                          }
                        >
                          <td className="text-daisy-ink px-4 py-3 whitespace-nowrap">
                            {formatEventDate(c.event_date)}
                            {c.start_time ? (
                              <span className="text-daisy-muted block text-[12px]">
                                {c.start_time}
                                {c.end_time ? `–${c.end_time}` : ''}
                              </span>
                            ) : null}
                          </td>
                          <td className="text-daisy-ink px-4 py-3 font-semibold">{c.title}</td>
                          <td className="px-4 py-3">{matchBadge(c.template_match)}</td>
                          <td className="px-4 py-3">
                            <Select
                              value={effectiveTemplateId(c) ?? ''}
                              onValueChange={(value) =>
                                setOverrides((prev) => ({ ...prev, [c.bookwhen_event_id]: value }))
                              }
                              disabled={importing}
                            >
                              <SelectTrigger className="min-w-[180px]">
                                <SelectValue placeholder="Choose a course type" />
                              </SelectTrigger>
                              <SelectContent>
                                {templates.map((t) => (
                                  <SelectItem key={t.id} value={t.id}>
                                    {t.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {c.template_match !== 'matched' && !overrides[c.bookwhen_event_id] ? (
                              <span className="mt-1 block text-[12px] text-[#8A5A1A]">
                                Please check this is the right type
                              </span>
                            ) : null}
                          </td>
                          <td className="text-daisy-ink px-4 py-3">
                            {c.venue_name ?? <span className="text-daisy-muted">—</span>}
                            {c.venue_postcode ? (
                              <span className="text-daisy-muted block text-[12px]">
                                {c.venue_postcode}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[12px] text-[#8A2A2A]">
                                No postcode
                                <FieldHelp>
                                  A class needs a venue postcode to import. Fix it in BookWhen or
                                  add the class by hand.
                                </FieldHelp>
                              </span>
                            )}
                          </td>
                          <td className="text-daisy-ink px-4 py-3 text-right tabular-nums">
                            {c.bookings.filter((b) => b.status !== 'cancelled').length}
                          </td>
                          <td className="px-4 py-3">
                            {blocker ? (
                              <span className="mb-1 block font-semibold text-[#8A2A2A]">
                                Needs attention: {blocker} — will be skipped
                              </span>
                            ) : null}
                            {c.warnings.length > 0 ? (
                              <ul className="text-daisy-muted list-disc space-y-0.5 pl-4 text-[12px]">
                                {c.warnings.map((w, i) => (
                                  <li key={i}>{w}</li>
                                ))}
                              </ul>
                            ) : !blocker ? (
                              <span className="text-daisy-muted">—</span>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          {plan.unresolved.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Rows we couldn&rsquo;t read</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-daisy-muted mb-3 text-[13px]">
                  These rows couldn&rsquo;t be turned into a course and will be left out.
                </p>
                <ul className="space-y-2 text-[13px]">
                  {plan.unresolved.map((u, i) => (
                    <li key={i} className="border-daisy-line-soft border-b pb-2 last:border-0">
                      <span className="text-daisy-ink font-semibold">{u.event}</span>
                      <span className="text-daisy-muted"> — {u.reason}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          {/* --- Step 3: confirm ---------------------------------------- */}
          {!result ? (
            <Card>
              <CardHeader>
                <CardTitle>Confirm import</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="rounded-[8px] border border-[#FEF8DD] bg-[#FEF8DD]/60 p-4 text-sm text-[#8A5A1A]">
                  <strong className="font-bold">This creates real data.</strong> Confirming will
                  create {importableCount} course{importableCount === 1 ? '' : 's'} and their paid
                  bookings in your live account. Cancelled bookings, past classes and any course
                  flagged &ldquo;needs attention&rdquo; above are skipped. This can&rsquo;t be
                  undone automatically.
                </div>

                {importing && progress ? (
                  <div className="flex flex-col gap-2">
                    <div className="bg-daisy-line-soft h-2 w-full overflow-hidden rounded-full">
                      <div
                        className="bg-daisy-primary h-full rounded-full transition-all"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                    <p className="text-daisy-muted text-[13px]">
                      {progress.done} of {progress.total} — {progress.label}
                    </p>
                  </div>
                ) : null}

                <div>
                  <Button onClick={confirmImport} disabled={importing || importableCount === 0}>
                    {importing
                      ? 'Importing…'
                      : `Confirm import (${importableCount} course${importableCount === 1 ? '' : 's'})`}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : null}

      {/* --- Step 4: results -------------------------------------------- */}
      {result ? (
        <Card>
          <CardHeader>
            <CardTitle>Import results</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <SummaryStat label="Courses created" value={result.coursesCreated} />
              <SummaryStat
                label="Classes already on the platform (reused)"
                value={result.coursesReused}
              />
              <SummaryStat label="Bookings created" value={result.bookingsCreated} />
              <SummaryStat label="Bookings marked paid" value={result.bookingsPaid} />
              <SummaryStat
                label="Bookings already imported (skipped)"
                value={result.bookingsAlreadyImported}
              />
            </dl>

            {result.coursesSkipped.length > 0 ? (
              <ResultList
                title="Courses skipped"
                items={result.coursesSkipped.map((s) => `${s.title} — ${s.reason}`)}
                tone="warning"
              />
            ) : null}

            {result.bookingsSkipped.length > 0 ? (
              <ResultList
                title="Bookings skipped"
                items={result.bookingsSkipped.map((s) => `${s.who} — ${s.reason}`)}
                tone="warning"
              />
            ) : null}

            {result.errors.length > 0 ? (
              <ResultList
                title="Errors"
                items={result.errors.map((e) => `${e.where}: ${e.message}`)}
                tone="danger"
              />
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

function SummaryStat({
  label,
  value,
  help,
}: {
  label: string;
  value: number;
  help?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-daisy-muted text-[11px] font-bold tracking-[0.06em] uppercase">
        <span className="inline-flex items-center gap-1">
          {label}
          {help ? <FieldHelp>{help}</FieldHelp> : null}
        </span>
      </dt>
      <dd className="text-daisy-ink text-[22px] font-extrabold tabular-nums">{value}</dd>
    </div>
  );
}

function ResultList({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: 'warning' | 'danger';
}) {
  const box =
    tone === 'danger'
      ? 'border-[#FDEAE5] bg-[#FDEAE5]/40 text-[#8A2A2A]'
      : 'border-[#FEF8DD] bg-[#FEF8DD]/50 text-[#8A5A1A]';
  return (
    <div className={`rounded-[8px] border p-4 ${box}`}>
      <p className="mb-2 text-[13px] font-bold">{title}</p>
      <ul className="list-disc space-y-1 pl-5 text-[13px]">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}
