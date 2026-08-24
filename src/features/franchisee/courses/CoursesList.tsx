/**
 * /franchisee/courses — franchisee's own course instances (Wave 7C).
 *
 * Default view: DataTable (list). Toggle to MonthCalendar via view button.
 * Filters: status, date range (presets + custom), course type (grouped).
 * Sort: event_date desc by default (latest first, F5) with a direction toggle.
 *
 * Course type (G7): the filter offers five franchisee-facing groupings rather
 * than the 12 raw template names; see courseTypeGroups.ts for the mapping.
 *
 * Filter/sort/view state persists (NTH-3 / FIX-6): the URL search params are
 * the source of truth (shareable, survives in-history navigation) and are
 * mirrored to localStorage ('daisy.courses.filters') so the state also
 * survives plain links back to /franchisee/courses.
 *
 * Reads via anon client + RLS. No client-side franchisee_id filter.
 */

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { ArrowDown, ArrowUp, QrCode } from 'lucide-react';
import {
  PageHeader,
  DataTable,
  StatusPill,
  EmptyState,
  MonthCalendar,
  FieldHelp,
} from '@/components/daisy';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Link } from 'react-router';
import { MedicalQr } from '../components/MedicalQr';
import {
  useOwnCourses,
  useOwnCoursesForMonth,
  type OwnCourseListRow,
  type OwnCoursesFilters,
} from './courseListQueries';
import { useCourseTemplates } from './createCourseQueries';
import { buildCourseTypeGroups } from './courseTypeGroups';
import { formatPrice } from './money';
import type { CourseInstanceStatus } from './types';
import { useOwnProfile } from '../profileQueries';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export type DatePreset = 'all' | 'next-30-days' | 'this-month' | 'last-month' | 'past' | 'custom';

const STATUS_OPTIONS: ReadonlyArray<{ value: CourseInstanceStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const DATE_OPTIONS: ReadonlyArray<{ value: DatePreset; label: string }> = [
  { value: 'all', label: 'All dates' },
  { value: 'next-30-days', label: 'Next 30 days' },
  { value: 'this-month', label: 'This month' },
  { value: 'last-month', label: 'Last month' },
  { value: 'past', label: 'Past only' },
  { value: 'custom', label: 'Custom range' },
];

// ---------------------------------------------------------------------------
// Filter persistence (NTH-3 / FIX-6)
//
// URL search params are the source of truth; localStorage mirrors them so
// state survives plain (param-less) navigation back to the list.
// ---------------------------------------------------------------------------

const FILTERS_STORAGE_KEY = 'daisy.courses.filters';

/** Search-param keys with their default values (defaults are omitted from the URL). */
const FILTER_DEFAULTS: Record<string, string> = {
  view: 'list',
  status: 'all',
  date: 'all',
  from: '',
  to: '',
  template: 'all',
  // F5: latest first is now the default, so 'desc' is the value omitted from
  // the URL. An explicit 'asc' choice is still written to the URL + storage,
  // so a franchisee's saved preference survives exactly as before.
  sort: 'desc',
};
const FILTER_KEYS = Object.keys(FILTER_DEFAULTS);

const STATUS_VALUES = new Set(STATUS_OPTIONS.map((o) => o.value as string));
const DATE_VALUES = new Set(DATE_OPTIONS.map((o) => o.value as string));

// ---------------------------------------------------------------------------
// Date helpers — wall-clock, no UTC arithmetic
// ---------------------------------------------------------------------------

/**
 * Resolve a DatePreset to {from, to} 'YYYY-MM-DD' bounds (inclusive).
 * Uses integer arithmetic on y/m/d parts to avoid BST-related Date drift.
 */
export function resolvePreset(
  preset: DatePreset,
  customFrom?: string,
  customTo?: string,
): { from?: string; to?: string } {
  if (preset === 'all') return {};

  // Wall-clock today from the local Date (not UTC) for bounds logic.
  const now = new Date();
  const todayY = now.getFullYear();
  const todayM = now.getMonth() + 1; // 1-based
  const todayD = now.getDate();

  function pad2(n: number) {
    return String(n).padStart(2, '0');
  }
  function ymd(y: number, m: number, d: number) {
    return `${y}-${pad2(m)}-${pad2(d)}`;
  }

  const today = ymd(todayY, todayM, todayD);

  if (preset === 'next-30-days') {
    // Add 30 days by leaning on Date arithmetic for day-of-month roll-over.
    const end = new Date(todayY, todayM - 1, todayD + 30);
    return {
      from: today,
      to: ymd(end.getFullYear(), end.getMonth() + 1, end.getDate()),
    };
  }

  if (preset === 'this-month') {
    // Last day of this month: day 0 of next month
    const lastDay = new Date(todayY, todayM, 0).getDate();
    return { from: ymd(todayY, todayM, 1), to: ymd(todayY, todayM, lastDay) };
  }

  if (preset === 'last-month') {
    const prevM = todayM === 1 ? 12 : todayM - 1;
    const prevY = todayM === 1 ? todayY - 1 : todayY;
    const lastDay = new Date(prevY, prevM, 0).getDate();
    return { from: ymd(prevY, prevM, 1), to: ymd(prevY, prevM, lastDay) };
  }

  if (preset === 'past') {
    // Up to (but not including) today
    const yesterday = new Date(todayY, todayM - 1, todayD - 1);
    return {
      from: '2000-01-01',
      to: ymd(yesterday.getFullYear(), yesterday.getMonth() + 1, yesterday.getDate()),
    };
  }

  if (preset === 'custom') {
    return { from: customFrom, to: customTo };
  }

  return {};
}

/**
 * Format a 'YYYY-MM-DD' string for display (e.g. "3 Jun 2025").
 * Splits on '-' to avoid any Date/UTC parsing.
 */
function formatDate(d: string | null): string {
  if (!d) return '-';
  const parts = d.split('-');
  if (parts.length !== 3) return d;
  const [y, m, day] = parts.map(Number);
  try {
    // Build a local Date from integer parts — getMonth() is 0-based.
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'Europe/London',
    }).format(new Date(y, m - 1, day));
  } catch {
    return d;
  }
}

function formatTime(t: string | null): string {
  if (!t) return '';
  return t.slice(0, 5);
}

function statusVariant(s: CourseInstanceStatus): 'active' | 'paid' | 'terminated' {
  if (s === 'cancelled') return 'terminated';
  if (s === 'completed') return 'paid';
  return 'active';
}

// ---------------------------------------------------------------------------
// Month navigator helpers
// ---------------------------------------------------------------------------

function monthLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/London',
  }).format(new Date(year, month - 1, 1));
}

// ---------------------------------------------------------------------------
// List columns
// ---------------------------------------------------------------------------

function buildColumns(onQrClick: () => void): ColumnDef<OwnCourseListRow>[] {
  return [
    {
      id: 'date',
      header: 'Date',
      accessorFn: (row) => row.event_date,
      cell: ({ row }) => (
        <span className="flex flex-col">
          <span className="font-semibold">{formatDate(row.original.event_date)}</span>
          <span className="text-daisy-muted text-[12px]">
            {formatTime(row.original.start_time)}
            {row.original.end_time ? ` – ${formatTime(row.original.end_time)}` : ''}
          </span>
        </span>
      ),
    },
    {
      id: 'template',
      header: 'Course',
      accessorFn: (row) => row.display_name ?? row.template_name,
      cell: ({ row }) => (
        <span className="flex flex-col">
          <span className="text-daisy-ink font-semibold">
            {row.original.display_name ?? row.original.template_name}
          </span>
          {row.original.display_name ? (
            <span className="text-daisy-muted text-[12px]">{row.original.template_name}</span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'venue',
      header: 'Venue',
      accessorFn: (row) => `${row.venue_name ?? ''} ${row.venue_postcode ?? ''}`,
      cell: ({ row }) =>
        row.original.venue_tbc && !row.original.venue_postcode ? (
          <span className="inline-flex items-center gap-1">
            <span className="text-daisy-muted text-[12px] font-semibold">Venue TBC</span>
            <FieldHelp>Venue to be confirmed. You can add it later.</FieldHelp>
          </span>
        ) : (
          <span className="flex flex-col">
            <span className="font-semibold">{row.original.venue_name ?? '-'}</span>
            <span className="text-daisy-muted font-mono text-[12px]">
              {row.original.venue_postcode ?? '-'}
            </span>
          </span>
        ),
    },
    {
      id: 'capacity',
      meta: { mobileLabel: 'Capacity' },
      header: () => (
        <span className="inline-flex items-center gap-1">
          Capacity
          <FieldHelp>Left number is places booked, right number is the total class size.</FieldHelp>
        </span>
      ),
      accessorFn: (row) => row.capacity - row.spots_remaining,
      cell: ({ row }) => {
        const used = row.original.capacity - row.original.spots_remaining;
        return (
          <span className="text-daisy-ink-soft font-mono text-[13px] font-semibold">
            {used}/{row.original.capacity}
          </span>
        );
      },
    },
    {
      id: 'spots',
      meta: { mobileLabel: 'Spots remaining' },
      header: () => (
        <span className="inline-flex items-center gap-1">
          Spots remaining
          <FieldHelp>Free places still available to book.</FieldHelp>
        </span>
      ),
      accessorFn: (row) => row.spots_remaining,
      cell: ({ row }) => (
        <span className="text-daisy-ink-soft font-mono text-[13px]">
          {row.original.spots_remaining}
        </span>
      ),
    },
    {
      accessorKey: 'price_pence',
      meta: { mobileLabel: 'Price' },
      header: () => (
        <span className="inline-flex items-center gap-1">
          Price
          <FieldHelp>
            From appears when a class has ticket types at different prices, so customers see the
            lowest one.
          </FieldHelp>
        </span>
      ),
      cell: ({ row }) => (
        <span className="font-semibold">
          {row.original.ticket_prices_differ && row.original.ticket_price_from != null
            ? `From ${formatPrice(row.original.ticket_price_from)}`
            : formatPrice(row.original.price_pence)}
        </span>
      ),
    },
    {
      accessorKey: 'status',
      meta: { mobileLabel: 'Status' },
      header: () => (
        <span className="inline-flex items-center gap-1">
          Status
          <FieldHelp>
            Scheduled classes are open for booking. Completed have already run. Cancelled are off.
          </FieldHelp>
        </span>
      ),
      cell: ({ row }) => (
        <StatusPill variant={statusVariant(row.original.status)}>{row.original.status}</StatusPill>
      ),
    },
    {
      id: 'action',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-2">
          {row.original.status !== 'cancelled' ? (
            <span className="inline-flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  onQrClick();
                }}
              >
                <QrCode className="h-4 w-4" aria-hidden />
                <span className="sr-only">Show my medical form QR</span>
              </Button>
              <FieldHelp label="About the medical form QR code">
                Show your medical form QR code. Same code for every class.
              </FieldHelp>
            </span>
          ) : null}
          <Link
            to={`/franchisee/courses/${row.original.id}`}
            onClick={(e) => e.stopPropagation()}
            className="text-daisy-primary text-[12px] font-semibold hover:underline"
          >
            View
          </Link>
        </div>
      ),
    },
  ];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type ViewMode = 'list' | 'calendar';

export default function CoursesList() {
  const navigate = useNavigate();

  // Own profile — needed for QR franchisee number
  const { data: ownProfile } = useOwnProfile();

  // Course templates — course-type filter options (NTH-3)
  const { data: templates = [] } = useCourseTemplates();

  // QR dialog state — shows THE permanent QR (one-QR model); which row was
  // clicked no longer matters, the code is identical for every class.
  const [qrOpen, setQrOpen] = useState(false);

  // ------------------------------------------------------------------
  // Filter / sort / view state — URL params + localStorage mirror
  // ------------------------------------------------------------------
  const [searchParams, setSearchParams] = useSearchParams();

  // One-time restore from localStorage when the URL carries no filter state
  // (e.g. a plain "Back to courses" link).
  useEffect(() => {
    if (FILTER_KEYS.some((k) => searchParams.has(k))) return;
    try {
      const raw = localStorage.getItem(FILTERS_STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Record<string, string>;
      const params = new URLSearchParams(searchParams);
      let restored = false;
      for (const k of FILTER_KEYS) {
        const v = saved[k];
        if (typeof v === 'string' && v && v !== FILTER_DEFAULTS[k]) {
          params.set(k, v);
          restored = true;
        }
      }
      if (restored) setSearchParams(params, { replace: true });
    } catch {
      // Corrupt storage — ignore and start from defaults.
    }
    // Mount-only: subsequent param changes flow through setFilter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Set one filter param (defaults are removed from the URL) + mirror all to localStorage. */
  const setFilter = useCallback(
    (key: string, value: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value === FILTER_DEFAULTS[key] || value === '') next.delete(key);
          else next.set(key, value);
          const persisted: Record<string, string> = {};
          for (const k of FILTER_KEYS) {
            const v = next.get(k);
            if (v) persisted[k] = v;
          }
          try {
            localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(persisted));
          } catch {
            // Storage unavailable — URL params still work for this session.
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // Read current values (unknown values fall back to defaults).
  const rawStatus = searchParams.get('status') ?? 'all';
  const status = (STATUS_VALUES.has(rawStatus) ? rawStatus : 'all') as CourseInstanceStatus | 'all';
  const rawDate = searchParams.get('date') ?? 'all';
  const datePreset = (DATE_VALUES.has(rawDate) ? rawDate : 'all') as DatePreset;
  const customFrom = searchParams.get('from') ?? '';
  const customTo = searchParams.get('to') ?? '';
  const templateFilter = searchParams.get('template') ?? 'all';
  // F5: latest first unless the franchisee explicitly chose soonest first.
  const sortDir: 'asc' | 'desc' = searchParams.get('sort') === 'asc' ? 'asc' : 'desc';
  const view: ViewMode = searchParams.get('view') === 'calendar' ? 'calendar' : 'list';

  // Calendar navigation — default to current wall-clock month
  const now = new Date();
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth() + 1); // 1-based

  // Resolve date bounds for the list query
  const { from, to } = resolvePreset(datePreset, customFrom || undefined, customTo || undefined);

  // Course-type groupings (G7) — resolved from the live templates so a name
  // that does not match any rule still appears under "Other course types".
  const courseTypeGroups = useMemo(() => buildCourseTypeGroups(templates), [templates]);
  const selectedGroup = courseTypeGroups.find((g) => g.id === templateFilter);

  const listFilters: OwnCoursesFilters = {
    status,
    from,
    to,
    // A group selection resolves to its template ids; 'all' clears the filter.
    templateId: selectedGroup ? 'all' : templateFilter,
    templateIds: selectedGroup?.templateIds,
    sortDir,
  };

  const { rows, totalCount, isLoading, error } = useOwnCourses(listFilters);
  const {
    courses: calCourses,
    isLoading: calLoading,
    error: calError,
  } = useOwnCoursesForMonth(calYear, calMonth);

  const columns = useMemo(() => buildColumns(() => setQrOpen(true)), []);

  // Month navigation
  function prevMonth() {
    if (calMonth === 1) {
      setCalYear((y) => y - 1);
      setCalMonth(12);
    } else {
      setCalMonth((m) => m - 1);
    }
  }
  function nextMonth() {
    if (calMonth === 12) {
      setCalYear((y) => y + 1);
      setCalMonth(1);
    } else {
      setCalMonth((m) => m + 1);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="My courses"
        subtitle="Your scheduled, completed, and cancelled course instances."
        actions={
          // Wraps rather than overflowing: the badge, the schedule button and
          // the view toggle together are wider than a 375px viewport on one
          // line, which pushed the whole page ~16px horizontally.
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="primary">{totalCount} total</Badge>
            <Button asChild variant="default" size="sm">
              <Link to="/franchisee/courses/new">Schedule a course</Link>
            </Button>
            {/* View toggle */}
            <div className="border-daisy-line-soft flex overflow-hidden rounded-full border">
              <button
                type="button"
                onClick={() => setFilter('view', 'list')}
                className={
                  view === 'list'
                    ? 'bg-daisy-primary px-3 py-1.5 text-[12px] font-bold text-white sm:px-4'
                    : 'text-daisy-muted hover:text-daisy-ink px-3 py-1.5 text-[12px] font-bold sm:px-4'
                }
                aria-pressed={view === 'list'}
              >
                List
              </button>
              <button
                type="button"
                onClick={() => setFilter('view', 'calendar')}
                className={
                  view === 'calendar'
                    ? 'bg-daisy-primary px-3 py-1.5 text-[12px] font-bold text-white sm:px-4'
                    : 'text-daisy-muted hover:text-daisy-ink px-3 py-1.5 text-[12px] font-bold sm:px-4'
                }
                aria-pressed={view === 'calendar'}
              >
                Calendar
              </button>
            </div>
          </div>
        }
      />

      {/* ------------------------------------------------------------------ */}
      {/* LIST VIEW                                                            */}
      {/* ------------------------------------------------------------------ */}
      {view === 'list' ? (
        <>
          {/* Filters */}
          <div className="flex flex-wrap items-end gap-3">
            <Select value={status} onValueChange={(v) => setFilter('status', v)}>
              <SelectTrigger className="w-[170px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={datePreset} onValueChange={(v) => setFilter('date', v)}>
              <SelectTrigger className="w-[170px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DATE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Course type filter — grouped (G7), truncated so long labels
                cannot spill outside the trigger (F3). */}
            <Select value={templateFilter} onValueChange={(v) => setFilter('template', v)}>
              <SelectTrigger className="w-[260px] max-w-full">
                <span className="block min-w-0 flex-1 truncate text-left">
                  <SelectValue />
                </span>
              </SelectTrigger>
              <SelectContent className="max-w-[min(24rem,calc(100vw-2rem))]">
                <SelectItem value="all">All course types</SelectItem>
                {courseTypeGroups.map((g) => (
                  <SelectItem key={g.id} value={g.id} className="whitespace-normal">
                    {g.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Sort direction toggle — NTH-3 (latest first is the default, F5) */}
            <Button
              type="button"
              variant="outline"
              onClick={() => setFilter('sort', sortDir === 'asc' ? 'desc' : 'asc')}
              title="Toggle sort direction"
            >
              {sortDir === 'asc' ? (
                <ArrowUp className="h-4 w-4" aria-hidden />
              ) : (
                <ArrowDown className="h-4 w-4" aria-hidden />
              )}
              {sortDir === 'asc' ? 'Soonest first' : 'Latest first'}
            </Button>

            {datePreset === 'custom' ? (
              <>
                <div className="flex flex-col gap-1">
                  <label className="text-daisy-muted text-[10px] font-bold tracking-wider uppercase">
                    From
                  </label>
                  <Input
                    type="date"
                    value={customFrom}
                    onChange={(e) => setFilter('from', e.target.value)}
                    className="h-10 w-[150px]"
                    aria-label="From date"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-daisy-muted text-[10px] font-bold tracking-wider uppercase">
                    To
                  </label>
                  <Input
                    type="date"
                    value={customTo}
                    onChange={(e) => setFilter('to', e.target.value)}
                    className="h-10 w-[150px]"
                    aria-label="To date"
                  />
                </div>
              </>
            ) : null}
          </div>

          {error ? (
            <div className="rounded-[8px] border border-[#FDEAE5] bg-[#FDEAE5]/40 p-4 text-sm text-[#8A2A2A]">
              Could not load courses: {error.message}
            </div>
          ) : null}

          <DataTable<OwnCourseListRow>
            columns={columns}
            data={rows}
            isLoading={isLoading}
            searchable={false}
            onRowClick={(row) => navigate(`/franchisee/courses/${row.id}`)}
            emptyState={
              <EmptyState
                title="No courses found"
                body="Try widening the date range or clearing the status filter. Schedule a new course using the button above."
                cta={{ label: 'Schedule a course', href: '/franchisee/courses/new' }}
              />
            }
          />
        </>
      ) : null}

      {/* ------------------------------------------------------------------ */}
      {/* CALENDAR VIEW                                                        */}
      {/* ------------------------------------------------------------------ */}
      {view === 'calendar' ? (
        <div className="flex flex-col gap-4">
          {/* Month navigator */}
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={prevMonth} aria-label="Previous month">
              &lsaquo;
            </Button>
            <span className="font-display text-daisy-ink min-w-[160px] text-center text-[16px] font-bold">
              {monthLabel(calYear, calMonth)}
            </span>
            <Button variant="outline" size="sm" onClick={nextMonth} aria-label="Next month">
              &rsaquo;
            </Button>
          </div>

          {calError ? (
            <div className="rounded-[8px] border border-[#FDEAE5] bg-[#FDEAE5]/40 p-4 text-sm text-[#8A2A2A]">
              Could not load calendar: {calError.message}
            </div>
          ) : null}

          {calLoading ? (
            <div className="flex flex-col gap-2 py-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-4/5" />
            </div>
          ) : (
            <MonthCalendar
              year={calYear}
              month={calMonth}
              courses={calCourses}
              onChipClick={(id) => navigate(`/franchisee/courses/${id}`)}
            />
          )}

          {!calLoading && calCourses.length === 0 && !calError ? (
            <EmptyState
              title="No courses this month"
              body="There are no course instances scheduled for this month."
              cta={{ label: 'Schedule a course', href: '/franchisee/courses/new' }}
            />
          ) : null}
        </div>
      ) : null}

      {/* THE permanent QR dialog — same code for every class (one-QR model) */}
      {ownProfile?.number ? (
        <Dialog open={qrOpen} onOpenChange={setQrOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Medical form QR</DialogTitle>
              <DialogDescription>
                One QR for every class you run. Print or laminate it once, the form finds the right
                class automatically on the day.
              </DialogDescription>
            </DialogHeader>
            <MedicalQr franchiseeNumber={ownProfile.number} compact />
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
