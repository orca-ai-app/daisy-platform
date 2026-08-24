// bookwhenParse.ts
//
// Pure, dependency-free parsing of a BookWhen "Export bookings (CSV)" file into
// an import plan (upcoming courses + their paid bookings) for the Daisy platform.
//
// This module is deliberately free of React / Deno / Supabase imports so it can
// be unit-tested (bookwhenParse.test.ts) and reused by the orchestration layer.
//
// SCAFFOLD STATUS (2026-08-24): the DETERMINISTIC mapping (customer identity,
// money, paid/cancelled status, grouping by ScheduleID, idempotency ids) is
// complete against the real export headers. THREE parsers depend on the internal
// format of columns we have only seen the HEADER for, not populated cells. They
// are isolated below and marked `TODO(hannah-export)`: parseScheduleDateTime,
// parseTicketQuantity, and (loosely) matchTemplate. Finish = validate these
// three against Hannah's real export, then wire the nav link in.
//
// Real headers (BookWhen bookings export):
//   BookingID, Booking ref, Booking status, Created, Fields complete?,
//   Payment complete?, Currency, Prices include tax?, Tax Pcnt, Cost, Payments,
//   Owes, Franchise fees, Franchisee takings, Paid, Invoice, Payment type,
//   Details, Tickets, Discounts, Fees, Total cost, Total tax, Booker email,
//   Contact CustomerID, Contact name, Contact email, ScheduleID, Schedule,
//   Additional Information:, Booker Name, Booker Phone Number, Class Address, ...

export interface TemplateLite {
  id: string;
  name: string;
  slug: string;
  default_capacity: number;
  default_price_pence: number;
}

export type TemplateMatch = 'matched' | 'guessed' | 'unmatched';

export interface PlannedBooking {
  bookwhen_booking_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  quantity: number;
  total_price_pence: number;
  paid: boolean;
  /** 'confirmed' | 'attended' | 'cancelled' — cancelled ones are not imported. */
  status: 'confirmed' | 'attended' | 'cancelled';
  warnings: string[];
}

export interface PlannedCourse {
  bookwhen_schedule_id: string;
  title: string;
  template_id: string | null;
  template_match: TemplateMatch;
  event_date: string | null; // 'YYYY-MM-DD'
  start_time: string | null; // 'HH:MM'
  end_time: string | null; // 'HH:MM'
  venue_name: string | null;
  venue_postcode: string | null;
  price_pence: number;
  capacity: number;
  bookings: PlannedBooking[];
  warnings: string[];
}

export interface ImportPlan {
  courses: PlannedCourse[];
  /** ScheduleIDs dropped because their event date is in the past. */
  skippedPastCourses: number;
  /** Rows/groups that could not be turned into a course (unparseable date, etc.). */
  unresolved: Array<{ schedule: string; reason: string }>;
  warnings: string[];
  totals: {
    rows: number;
    courses: number;
    bookings: number;
    cancelledBookings: number;
  };
}

// ---------------------------------------------------------------------------
// CSV parsing (RFC-4180-ish: quoted fields, escaped quotes, CRLF)
// ---------------------------------------------------------------------------

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  // Strip a leading UTF-8 BOM if present.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch === '\r') {
      // swallow; '\n' handles the row break
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Turn the parsed grid into objects keyed by trimmed header name. */
export function toRecords(grid: string[][]): Array<Record<string, string>> {
  if (grid.length === 0) return [];
  const headers = grid[0].map((h) => h.trim());
  const out: Array<Record<string, string>> = [];
  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r];
    // Skip fully-empty trailing lines.
    if (cells.every((c) => c.trim() === '')) continue;
    const rec: Record<string, string> = {};
    headers.forEach((h, i) => {
      rec[h] = (cells[i] ?? '').trim();
    });
    out.push(rec);
  }
  return out;
}

// First non-empty value across a list of candidate header names.
function pick(rec: Record<string, string>, names: string[]): string {
  for (const n of names) {
    const v = rec[n];
    if (v != null && v.trim() !== '') return v.trim();
  }
  return '';
}

// ---------------------------------------------------------------------------
// Deterministic field parsers (complete)
// ---------------------------------------------------------------------------

/** "£30.00", "30", "1,234.50", "GBP 30" -> integer pence. Returns null if unparseable. */
export function parseMoneyToPence(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9.,-]/g, '').replace(/,/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

/** Split a full name into first / last on the last space. */
export function splitName(full: string): { first_name: string; last_name: string } {
  const t = full.trim().replace(/\s+/g, ' ');
  if (t === '') return { first_name: '', last_name: '' };
  const idx = t.lastIndexOf(' ');
  if (idx === -1) return { first_name: t, last_name: '' };
  return { first_name: t.slice(0, idx), last_name: t.slice(idx + 1) };
}

const TRUEY = new Set(['yes', 'y', 'true', '1', 'paid', 'complete', 'completed']);
export function isTruthyFlag(raw: string): boolean {
  return TRUEY.has(raw.trim().toLowerCase());
}

/** Map BookWhen "Booking status" to our booking_status. Unknown -> 'confirmed'. */
export function bookingStatusFrom(raw: string): 'confirmed' | 'attended' | 'cancelled' {
  const s = raw.trim().toLowerCase();
  if (s.includes('cancel') || s.includes('refund')) return 'cancelled';
  if (s.includes('attend')) return 'attended';
  return 'confirmed';
}

const UK_POSTCODE_RE = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i;
/** Pull a venue name + postcode out of a free-text address. */
export function parseAddress(raw: string): {
  venue_name: string | null;
  venue_postcode: string | null;
} {
  const t = raw.trim();
  if (t === '') return { venue_name: null, venue_postcode: null };
  const m = t.match(UK_POSTCODE_RE);
  const postcode = m ? m[1].toUpperCase().replace(/\s+/g, ' ').trim() : null;
  // Venue name = the first comma-separated chunk (usually the building/place).
  const venue = t.split(',')[0].trim() || null;
  return { venue_name: venue, venue_postcode: postcode };
}

// ---------------------------------------------------------------------------
// TODO(hannah-export): format-dependent parsers — best-effort until validated
// ---------------------------------------------------------------------------

/**
 * TODO(hannah-export): the exact shape of the "Schedule" cell is unconfirmed.
 * Best-effort: find a date (various formats) and an optional HH:MM-HH:MM range.
 * Returns nulls (and the caller flags the course unresolved) when no date is found.
 */
export function parseScheduleDateTime(schedule: string): {
  event_date: string | null;
  start_time: string | null;
  end_time: string | null;
  title: string;
} {
  const title = schedule.trim();
  const date = findIsoDate(schedule);
  const times = findTimeRange(schedule);
  return {
    event_date: date,
    start_time: times.start,
    end_time: times.end,
    title,
  };
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Extract 'YYYY-MM-DD' from common UK date renderings. Null if none found. */
export function findIsoDate(s: string): string | null {
  // 2026-09-06
  let m = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // 06/09/2026 or 6-9-2026 (assume UK day-first)
  m = s.match(/\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b/);
  if (m) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${y}-${pad(mo)}-${pad(d)}`;
  }
  // 6 September 2026 / 6th Sep 2026 / Saturday 6 Sep 2026
  m = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?\s+(\d{4})\b/);
  if (m) {
    const d = Number(m[1]);
    const mo = MONTHS[m[2].slice(0, 4).toLowerCase()] ?? MONTHS[m[2].slice(0, 3).toLowerCase()];
    const y = Number(m[3]);
    if (mo && d >= 1 && d <= 31) return `${y}-${pad(mo)}-${pad(d)}`;
  }
  return null;
}

/** Extract an HH:MM start (and optional end) from a time range like "10:00-12:00" or "10am - 12:30pm". */
export function findTimeRange(s: string): { start: string | null; end: string | null } {
  const re = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/gi;
  const found: string[] = [];
  // Only look at a segment that plausibly holds times (after a comma or 'at').
  const matches = [...s.matchAll(re)];
  for (const m of matches) {
    let h = Number(m[1]);
    const min = m[2] ? Number(m[2]) : 0;
    const ap = m[3]?.toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    // Ignore obvious non-times (e.g. a year or day number without am/pm and >23).
    if (h > 23 || min > 59) continue;
    if (!ap && !m[2]) continue; // a bare number with no colon and no am/pm is probably not a time
    found.push(`${pad(h)}:${pad(min)}`);
  }
  return { start: found[0] ?? null, end: found[1] ?? null };
}

/**
 * TODO(hannah-export): the "Tickets" cell format is unconfirmed (could be
 * "2 x Baby Class", "2", or a multi-line list). Best-effort: the first integer
 * is the quantity; default 1.
 */
export function parseTicketQuantity(tickets: string): number {
  const m = tickets.match(/\d+/);
  const n = m ? Number(m[0]) : 1;
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

const NON_WORD = /[^a-z0-9]+/g;
function normalise(s: string): string {
  return s.toLowerCase().replace(NON_WORD, ' ').trim();
}

/**
 * Map a BookWhen "Select Class Type" (or Schedule title) to a course template.
 * Exact/substring match on template name or slug; otherwise best token overlap.
 * TODO(hannah-export): confirm the real Class Type strings and tighten scoring.
 */
export function matchTemplate(
  classType: string,
  templates: TemplateLite[],
): { template: TemplateLite | null; match: TemplateMatch } {
  const q = normalise(classType);
  if (q === '' || templates.length === 0) return { template: null, match: 'unmatched' };

  // 1. exact name/slug
  for (const t of templates) {
    if (normalise(t.name) === q || t.slug === classType.trim().toLowerCase()) {
      return { template: t, match: 'matched' };
    }
  }
  // 2. substring either direction
  for (const t of templates) {
    const tn = normalise(t.name);
    if (tn.includes(q) || q.includes(tn)) return { template: t, match: 'matched' };
  }
  // 3. best token overlap (guessed)
  const qTokens = new Set(q.split(' ').filter(Boolean));
  let best: TemplateLite | null = null;
  let bestScore = 0;
  for (const t of templates) {
    const tTokens = t.name.toLowerCase().replace(NON_WORD, ' ').split(' ').filter(Boolean);
    let score = 0;
    for (const tok of tTokens) if (qTokens.has(tok)) score++;
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  if (best && bestScore >= 2) return { template: best, match: 'guessed' };
  return { template: null, match: 'unmatched' };
}

// ---------------------------------------------------------------------------
// Plan builder
// ---------------------------------------------------------------------------

export interface BuildPlanOptions {
  /** 'YYYY-MM-DD' in Europe/London — courses before this are skipped as past. */
  today: string;
  templates: TemplateLite[];
}

export function buildPlan(
  records: Array<Record<string, string>>,
  opts: BuildPlanOptions,
): ImportPlan {
  const warnings: string[] = [];
  const unresolved: Array<{ schedule: string; reason: string }> = [];
  let cancelledBookings = 0;

  // Group rows by ScheduleID (the BookWhen event id).
  const groups = new Map<string, Array<Record<string, string>>>();
  for (const rec of records) {
    const scheduleId = pick(rec, ['ScheduleID']) || pick(rec, ['Schedule']);
    if (!scheduleId) {
      unresolved.push({ schedule: '(no ScheduleID)', reason: 'row has no ScheduleID/Schedule' });
      continue;
    }
    const arr = groups.get(scheduleId) ?? [];
    arr.push(rec);
    groups.set(scheduleId, arr);
  }

  const courses: PlannedCourse[] = [];
  let skippedPastCourses = 0;
  let bookingCount = 0;

  for (const [scheduleId, rows] of groups) {
    const first = rows[0];
    const scheduleText = pick(first, ['Schedule']) || scheduleId;
    const sched = parseScheduleDateTime(scheduleText);

    if (!sched.event_date) {
      unresolved.push({
        schedule: scheduleText,
        reason: 'could not read a date from the Schedule cell',
      });
      continue;
    }
    if (sched.event_date < opts.today) {
      skippedPastCourses++;
      continue;
    }

    const classType = pick(first, ['Select Class Type']) || sched.title;
    const { template, match } = matchTemplate(classType, opts.templates);
    const addr = parseAddress(pick(first, ['Class Address']));

    const courseWarnings: string[] = [];
    if (match !== 'matched') {
      courseWarnings.push(
        match === 'guessed'
          ? `Course type guessed as "${template?.name}" from "${classType}" — check it.`
          : `Could not match a course type for "${classType}" — pick one before importing.`,
      );
    }
    if (!sched.start_time)
      courseWarnings.push('No start time found in the Schedule cell — defaulting to 10:00.');
    if (!addr.venue_postcode)
      courseWarnings.push('No postcode found in the address — this class will need one.');

    const bookings: PlannedBooking[] = [];
    for (const rec of rows) {
      const status = bookingStatusFrom(pick(rec, ['Booking status']));
      const email = pick(rec, ['Contact email', 'Booker email']).toLowerCase();
      const name = pick(rec, ['Contact name', 'Booker Name']);
      const { first_name, last_name } = splitName(name);
      const qty = parseTicketQuantity(pick(rec, ['Tickets']));
      const totalPence = parseMoneyToPence(pick(rec, ['Total cost', 'Cost', 'Paid'])) ?? 0;
      const paid =
        isTruthyFlag(pick(rec, ['Payment complete?'])) ||
        parseMoneyToPence(pick(rec, ['Paid'])) === totalPence;

      const bWarnings: string[] = [];
      if (!email) bWarnings.push('No email address — booking will import without a contact email.');
      if (!name) bWarnings.push('No name found.');

      if (status === 'cancelled') cancelledBookings++;

      bookings.push({
        bookwhen_booking_id:
          pick(rec, ['BookingID', 'Booking ref']) || `${scheduleId}:${bookings.length}`,
        first_name,
        last_name,
        email,
        phone: pick(rec, ['Booker Phone Number']) || null,
        quantity: qty,
        total_price_pence: totalPence,
        paid,
        status,
        warnings: bWarnings,
      });
      bookingCount++;
    }

    const activeSeats = bookings
      .filter((b) => b.status !== 'cancelled')
      .reduce((sum, b) => sum + b.quantity, 0);
    const capacity = Math.max(template?.default_capacity ?? 12, activeSeats);

    const pricePence =
      parseMoneyToPence(pick(first, ['Cost'])) ?? template?.default_price_pence ?? 0;

    courses.push({
      bookwhen_schedule_id: scheduleId,
      title: sched.title,
      template_id: template?.id ?? null,
      template_match: match,
      event_date: sched.event_date,
      start_time: sched.start_time ?? '10:00',
      end_time: sched.end_time ?? null,
      venue_name: addr.venue_name,
      venue_postcode: addr.venue_postcode,
      price_pence: pricePence,
      capacity,
      bookings,
      warnings: courseWarnings,
    });
  }

  // Stable sort by date for a readable preview.
  courses.sort((a, b) => (a.event_date ?? '').localeCompare(b.event_date ?? ''));

  return {
    courses,
    skippedPastCourses,
    unresolved,
    warnings,
    totals: {
      rows: records.length,
      courses: courses.length,
      bookings: bookingCount,
      cancelledBookings,
    },
  };
}

/** Convenience: raw CSV text -> plan. */
export function planFromCsv(csvText: string, opts: BuildPlanOptions): ImportPlan {
  return buildPlan(toRecords(parseCsv(csvText)), opts);
}
