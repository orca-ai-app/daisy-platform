/**
 * /franchisee/courses — franchisee's own course instances (Wave 7C).
 *
 * Default view: DataTable (list). Toggle to MonthCalendar via view button.
 * Filters: status, date range (presets + custom). Sort: event_date asc.
 * Calendar view: month navigator + MonthCalendar chip grid.
 *
 * Reads via anon client + RLS. No client-side franchisee_id filter.
 */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { PageHeader, DataTable, StatusPill, EmptyState, MonthCalendar } from '@/components/daisy';
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
import { formatPence } from '@/lib/format';
import { Link } from 'react-router';
import {
  useOwnCourses,
  useOwnCoursesForMonth,
  type OwnCourseListRow,
  type OwnCoursesFilters,
} from './courseListQueries';
import type { CourseInstanceStatus } from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type DatePreset = 'all' | 'next-30-days' | 'this-month' | 'last-month' | 'past' | 'custom';

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
// Date helpers — wall-clock, no UTC arithmetic
// ---------------------------------------------------------------------------

/**
 * Resolve a DatePreset to {from, to} 'YYYY-MM-DD' bounds (inclusive).
 * Uses integer arithmetic on y/m/d parts to avoid BST-related Date drift.
 */
function resolvePreset(
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

function buildColumns(): ColumnDef<OwnCourseListRow>[] {
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
      accessorFn: (row) => row.template_name,
      cell: ({ row }) => (
        <span className="text-daisy-ink font-semibold">{row.original.template_name}</span>
      ),
    },
    {
      id: 'venue',
      header: 'Venue',
      accessorFn: (row) => `${row.venue_name ?? ''} ${row.venue_postcode}`,
      cell: ({ row }) => (
        <span className="flex flex-col">
          <span className="font-semibold">{row.original.venue_name ?? '-'}</span>
          <span className="text-daisy-muted font-mono text-[12px]">
            {row.original.venue_postcode}
          </span>
        </span>
      ),
    },
    {
      id: 'capacity',
      header: 'Capacity',
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
      header: 'Spots remaining',
      accessorFn: (row) => row.spots_remaining,
      cell: ({ row }) => (
        <span className="text-daisy-ink-soft font-mono text-[13px]">
          {row.original.spots_remaining}
        </span>
      ),
    },
    {
      accessorKey: 'price_pence',
      header: 'Price',
      cell: ({ row }) => (
        <span className="font-semibold">{formatPence(row.original.price_pence)}</span>
      ),
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <StatusPill variant={statusVariant(row.original.status)}>{row.original.status}</StatusPill>
      ),
    },
    {
      id: 'action',
      header: '',
      cell: ({ row }) => (
        <Link
          to={`/franchisee/courses/${row.original.id}`}
          onClick={(e) => e.stopPropagation()}
          className="text-daisy-primary text-[12px] font-semibold hover:underline"
        >
          View
        </Link>
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

  // View toggle
  const [view, setView] = useState<ViewMode>('list');

  // List filters
  const [status, setStatus] = useState<CourseInstanceStatus | 'all'>('all');
  const [datePreset, setDatePreset] = useState<DatePreset>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  // Calendar navigation — default to current wall-clock month
  const now = new Date();
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth() + 1); // 1-based

  // Resolve date bounds for the list query
  const { from, to } = resolvePreset(datePreset, customFrom || undefined, customTo || undefined);

  const listFilters: OwnCoursesFilters = {
    status,
    from,
    to,
  };

  const { rows, totalCount, isLoading, error } = useOwnCourses(listFilters);
  const {
    courses: calCourses,
    isLoading: calLoading,
    error: calError,
  } = useOwnCoursesForMonth(calYear, calMonth);

  const columns = useMemo(() => buildColumns(), []);

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
          <div className="flex items-center gap-2">
            <Badge variant="primary">{totalCount} total</Badge>
            <Button asChild variant="default" size="sm">
              <Link to="/franchisee/courses/new">Schedule a course</Link>
            </Button>
            {/* View toggle */}
            <div className="border-daisy-line-soft flex overflow-hidden rounded-full border">
              <button
                type="button"
                onClick={() => setView('list')}
                className={
                  view === 'list'
                    ? 'bg-daisy-primary px-4 py-1.5 text-[12px] font-bold text-white'
                    : 'text-daisy-muted hover:text-daisy-ink px-4 py-1.5 text-[12px] font-bold'
                }
                aria-pressed={view === 'list'}
              >
                List
              </button>
              <button
                type="button"
                onClick={() => setView('calendar')}
                className={
                  view === 'calendar'
                    ? 'bg-daisy-primary px-4 py-1.5 text-[12px] font-bold text-white'
                    : 'text-daisy-muted hover:text-daisy-ink px-4 py-1.5 text-[12px] font-bold'
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
            <Select
              value={status}
              onValueChange={(v) => setStatus(v as CourseInstanceStatus | 'all')}
            >
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

            <Select value={datePreset} onValueChange={(v) => setDatePreset(v as DatePreset)}>
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

            {datePreset === 'custom' ? (
              <>
                <div className="flex flex-col gap-1">
                  <label className="text-daisy-muted text-[10px] font-bold tracking-wider uppercase">
                    From
                  </label>
                  <Input
                    type="date"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
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
                    onChange={(e) => setCustomTo(e.target.value)}
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
            <div className="text-daisy-muted py-10 text-center text-sm">Loading calendar…</div>
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
    </div>
  );
}
