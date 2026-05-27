/**
 * MonthCalendar — custom month grid for course instances (Wave 7C).
 *
 * Renders a standard 7-column weekly grid for the given year+month. Each
 * course chip is coloured by status using Daisy colour tokens. Clicking a
 * chip fires onChipClick(courseId).
 *
 * DATE BUCKETING (BST-safe):
 *   event_date arrives as a 'YYYY-MM-DD' string. We split on '-' and read
 *   Y/M/D as integers to build the grid — no Date constructor, no
 *   toISOString(), no UTC arithmetic. A course is assigned to a cell by
 *   comparing its raw 'YYYY-MM-DD' string to the cell's computed
 *   'YYYY-MM-DD' key. A BST midnight-UTC rollback is therefore impossible.
 *
 * Sizing: ~150 lines as per DECISIONS.md guidance; no FullCalendar dep.
 */

import { useMemo } from 'react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Contract types (frozen by scaffold — re-exported from index.ts)
// ---------------------------------------------------------------------------

/** Minimal projection a calendar chip needs. Sourced from CourseInstance. */
export interface MonthCalendarCourse {
  id: string;
  /** 'YYYY-MM-DD' wall-clock date — bucket by the raw string. */
  event_date: string;
  start_time: string;
  template_name: string;
  status: 'scheduled' | 'completed' | 'cancelled';
  spots_remaining: number;
  capacity: number;
}

export interface MonthCalendarProps {
  year: number;
  /** 1-based month (1 = January, 12 = December). */
  month: number;
  /** Courses to plot. May contain entries outside the visible month; filtered here. */
  courses: MonthCalendarCourse[];
  /** Fired with the course id when a chip is clicked. */
  onChipClick: (courseId: string) => void;
}

// ---------------------------------------------------------------------------
// Status chip styling — Daisy colour tokens
// ---------------------------------------------------------------------------

const CHIP_CLASSES: Record<MonthCalendarCourse['status'], string> = {
  scheduled: 'bg-[#EBF6ED] text-[#2F6F4F] hover:bg-[#D2EDD8]',
  completed: 'bg-[#E8F0FD] text-[#1A3F8A] hover:bg-[#D2E3FA]',
  cancelled: 'bg-[#FDEAE5] text-[#8A2A2A] hover:bg-[#F9D2CA]',
};

// ---------------------------------------------------------------------------
// Pure date helpers (wall-clock, no Date constructor)
// ---------------------------------------------------------------------------

/** Zero-padded 2-digit string. */
function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Build a 'YYYY-MM-DD' string from parts. No Date constructor. */
function ymd(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/**
 * Day-of-week (0=Mon … 6=Sun, ISO week) for the 1st of a given month.
 * Uses the Date constructor ONLY for weekday lookup — not for any date
 * arithmetic or string formatting. The weekday is timezone-independent
 * because getDay() on a local midnight is consistent across BST/GMT.
 */
function firstDayOfWeek(year: number, month: number): number {
  // month is 1-based; Date months are 0-based
  const jsDay = new Date(year, month - 1, 1).getDay(); // 0=Sun…6=Sat
  // Convert to ISO: Mon=0, Tue=1, … Sun=6
  return (jsDay + 6) % 7;
}

/** Number of days in a month. Handles leap years via Date roll-over. */
function daysInMonth(year: number, month: number): number {
  // Day 0 of next month = last day of this month
  return new Date(year, month, 0).getDate();
}

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ---------------------------------------------------------------------------
// MonthCalendar component
// ---------------------------------------------------------------------------

export function MonthCalendar({ year, month, courses, onChipClick }: MonthCalendarProps) {
  const monthStr = `${year}-${pad2(month)}`;

  // Filter to courses strictly within this month by raw string prefix.
  const monthCourses = useMemo(
    () => courses.filter((c) => c.event_date.startsWith(monthStr + '-')),
    [courses, monthStr],
  );

  // Build lookup: 'YYYY-MM-DD' → course[]
  const byDate = useMemo(() => {
    const map = new Map<string, MonthCalendarCourse[]>();
    for (const c of monthCourses) {
      const bucket = map.get(c.event_date) ?? [];
      bucket.push(c);
      map.set(c.event_date, bucket);
    }
    return map;
  }, [monthCourses]);

  const totalDays = daysInMonth(year, month);
  const startOffset = firstDayOfWeek(year, month); // 0=Mon, cells before day 1

  // Build flat array of cell objects: leading empties + day cells
  const cells = useMemo(() => {
    const result: Array<{ key: string; day: number | null; dateKey: string | null }> = [];
    for (let i = 0; i < startOffset; i++) {
      result.push({ key: `empty-${i}`, day: null, dateKey: null });
    }
    for (let d = 1; d <= totalDays; d++) {
      const dateKey = ymd(year, month, d);
      result.push({ key: dateKey, day: d, dateKey });
    }
    return result;
  }, [year, month, totalDays, startOffset]);

  // Compute today's 'YYYY-MM-DD' key for highlighting (split-parse, no UTC).
  const todayKey = useMemo(() => {
    const t = new Date();
    return ymd(t.getFullYear(), t.getMonth() + 1, t.getDate());
  }, []);

  if (totalDays === 0) return null;

  return (
    <div className="w-full">
      {/* Day-of-week header */}
      <div className="mb-1 grid grid-cols-7 gap-px">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="text-daisy-muted py-1 text-center text-[11px] font-bold tracking-wider uppercase"
          >
            {label}
          </div>
        ))}
      </div>

      {/* Calendar grid — one row per week */}
      <div className="border-daisy-line-soft grid grid-cols-7 gap-px overflow-hidden rounded-[12px] border bg-[#E8E4DF]">
        {cells.map(({ key, day, dateKey }) => {
          const isToday = dateKey === todayKey;
          const dayChips = dateKey ? (byDate.get(dateKey) ?? []) : [];
          const isWeekend = (() => {
            if (day === null || !dateKey) return false;
            // getDay on local midnight: 0=Sun, 6=Sat
            const wd = new Date(year, month - 1, day).getDay();
            return wd === 0 || wd === 6;
          })();

          return (
            <div
              key={key}
              className={cn(
                'bg-daisy-paper min-h-[80px] p-1.5 align-top text-[12px]',
                day === null && 'bg-[#F5F3F0]',
                isWeekend && day !== null && 'bg-[#FAFAF9]',
              )}
            >
              {day !== null ? (
                <>
                  <span
                    className={cn(
                      'mb-1 flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-semibold',
                      isToday ? 'bg-daisy-primary text-white' : 'text-daisy-ink-soft',
                    )}
                  >
                    {day}
                  </span>

                  {/* Course chips */}
                  <div className="flex flex-col gap-0.5">
                    {dayChips.map((course) => (
                      <button
                        key={course.id}
                        type="button"
                        onClick={() => onChipClick(course.id)}
                        title={`${course.template_name} — ${course.start_time.slice(0, 5)}, ${course.spots_remaining}/${course.capacity} spots`}
                        className={cn(
                          'w-full truncate rounded-[4px] px-1.5 py-0.5 text-left text-[11px] leading-tight font-semibold transition-colors',
                          CHIP_CLASSES[course.status],
                        )}
                      >
                        <span className="block truncate">
                          {course.start_time.slice(0, 5)} {course.template_name}
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
