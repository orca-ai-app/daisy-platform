// bookwhenParse.ts
//
// Pure, dependency-free parsing of a BookWhen "Export attendances (CSV)" file
// into an import plan (upcoming courses + their paid bookings) for the Daisy
// platform. No React / Deno / Supabase imports, so it is unit-tested
// (bookwhenParse.test.ts) and reused by the orchestration layer.
//
// WHY ATTENDANCES, NOT BOOKINGS: the bookings export is purely transactional and
// carries NO event date, title or venue (verified on real exports). The
// attendances export is the one with the class details. Its date filter is on
// the EVENT date, so a franchisee sets Start date = today, End date = past
// cutover, status = Completed, and gets their upcoming classes with the people
// booked on them. Events with no bookings do not appear (franchisee adds those
// by hand). Confirmed against BookWhen docs + a real franchisee export.
//
// Grain: ONE ROW PER ATTENDEE. We group rows by EventID (one dated occurrence =
// one course) and, within that, by BookingID (one booking = one customer with
// quantity = number of attendee rows).
//
// Stable core columns used (a real export also carries ~35 franchisee-specific
// custom-question columns after these, which we treat as best-effort fallbacks):
//   Event title, EventID, Event starts, Event ends, Event cancelled, Location,
//   BookingID, Booking status, Booking cancelled, Booking cost,
//   Booking payments, Booking owed amount, Ticket name, Ticket face value,
//   Ticket cancelled, Attendance status, Attended?, Contact name, Contact email,
//   Booker email, Attendee email, First name, Last name.

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
  bookwhen_event_id: string;
  title: string;
  template_id: string | null;
  template_match: TemplateMatch;
  event_date: string | null; // 'YYYY-MM-DD'
  start_time: string | null; // 'HH:MM'
  end_time: string | null; // 'HH:MM'
  venue_name: string | null;
  venue_postcode: string | null;
  online: boolean;
  price_pence: number;
  capacity: number;
  bookings: PlannedBooking[];
  warnings: string[];
}

export interface ImportPlan {
  courses: PlannedCourse[];
  /** EventIDs dropped because the event date is in the past. */
  skippedPastCourses: number;
  /** EventIDs dropped because the event is marked cancelled in BookWhen. */
  skippedCancelledCourses: number;
  /** Rows/groups that could not be turned into a course (unparseable date, etc.). */
  unresolved: Array<{ event: string; reason: string }>;
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
    if (cells.every((c) => c.trim() === '')) continue;
    const rec: Record<string, string> = {};
    headers.forEach((h, i) => {
      rec[h] = (cells[i] ?? '').trim();
    });
    out.push(rec);
  }
  return out;
}

// First non-empty value across candidate header names.
function pick(rec: Record<string, string>, names: string[]): string {
  for (const n of names) {
    const v = rec[n];
    if (v != null && v.trim() !== '') return v.trim();
  }
  return '';
}

// Phone / postcode live in franchisee-specific custom columns — scan a list.
const PHONE_COLS = [
  'Booker phone number',
  'Phone number',
  'Phone',
  'Contact number',
  'Contact number for home classes',
  'School or Nursery phone number',
  'School contact number',
];
const POSTCODE_COLS = [
  'Postcode',
  'School or Nursery postcode',
  'School postcode',
  'Class Address',
];

// ---------------------------------------------------------------------------
// Field parsers
// ---------------------------------------------------------------------------

/** "£30.00", "101.09", "1,234.50", "GBP 30" -> integer pence. Null if unparseable. */
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

const TRUEY = new Set(['yes', 'y', 'true', '1']);
export function isTruthyFlag(raw: string): boolean {
  return TRUEY.has(raw.trim().toLowerCase());
}

/** Strip BookWhen title decoration (emoji like the ticks/laptops franchisees prefix) for matching + display. */
export function cleanTitle(raw: string): string {
  return raw
    .replace(/\p{Extended_Pictographic}/gu, ' ')
    .replace(/[\u2190-\u21FF\u2300-\u27BF]/g, ' ')
    .replace(/\uFE0F/g, '')
    .replace(/\u200D/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const UK_POSTCODE_RE = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i;
/** Pull a venue name + postcode out of a free-text address (e.g. BookWhen "Location"). */
export function parseAddress(raw: string): {
  venue_name: string | null;
  venue_postcode: string | null;
} {
  const t = raw.trim();
  if (t === '') return { venue_name: null, venue_postcode: null };
  const m = t.match(UK_POSTCODE_RE);
  const postcode = m ? m[1].toUpperCase().replace(/\s+/g, ' ').trim() : null;
  const venue = t.split(',')[0].trim() || null;
  return { venue_name: venue, venue_postcode: postcode };
}

/** Parse a BookWhen datetime "2026-08-08 09:00:00 +0100" -> date + HH:MM. */
export function parseBookwhenDateTime(s: string): { date: string | null; time: string | null } {
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) {
    const d = s.match(/(\d{4})-(\d{2})-(\d{2})/);
    return { date: d ? `${d[1]}-${d[2]}-${d[3]}` : null, time: null };
  }
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  const time = `${m[4]}:${m[5]}`;
  // Midnight on an all-day event carries no real class time.
  return { date, time: time === '00:00' ? null : time };
}

const ONLINE_RE = /online|distance|e-?learning|virtual|zoom|remote|webinar/i;
export function looksOnline(title: string, location: string): boolean {
  if (location.trim() === '') return true;
  return ONLINE_RE.test(title) || ONLINE_RE.test(location);
}

const NON_WORD = /[^a-z0-9]+/g;
function normalise(s: string): string {
  return s.toLowerCase().replace(NON_WORD, ' ').trim();
}

/**
 * Map a BookWhen event title (+ ticket name) to a Daisy course template.
 * Exact/substring on template name/slug, else best token overlap.
 */
export function matchTemplate(
  text: string,
  templates: TemplateLite[],
): { template: TemplateLite | null; match: TemplateMatch } {
  const q = normalise(text);
  if (q === '' || templates.length === 0) return { template: null, match: 'unmatched' };

  for (const t of templates) {
    if (normalise(t.name) === q) return { template: t, match: 'matched' };
  }
  for (const t of templates) {
    const tn = normalise(t.name);
    if (tn.includes(q) || q.includes(tn)) return { template: t, match: 'matched' };
  }
  const qTokens = new Set(q.split(' ').filter(Boolean));
  let best: TemplateLite | null = null;
  let bestScore = 0;
  for (const t of templates) {
    const tTokens = normalise(t.name).split(' ').filter(Boolean);
    let score = 0;
    for (const tok of tTokens) if (qTokens.has(tok)) score++;
    // Normalise slightly by template length so short template names aren't unfairly beaten.
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
  /** 'YYYY-MM-DD' in Europe/London — events before this are skipped as past. */
  today: string;
  templates: TemplateLite[];
}

function bookingStatus(rec: Record<string, string>): 'confirmed' | 'attended' | 'cancelled' {
  if (
    pick(rec, ['Booking cancelled']) !== '' ||
    isTruthyFlag(pick(rec, ['Ticket cancelled'])) ||
    /cancel|refund/i.test(pick(rec, ['Booking status', 'Attendance status', 'Ticket status']))
  ) {
    return 'cancelled';
  }
  if (isTruthyFlag(pick(rec, ['Attended?']))) return 'attended';
  return 'confirmed';
}

export function buildPlan(
  records: Array<Record<string, string>>,
  opts: BuildPlanOptions,
): ImportPlan {
  const warnings: string[] = [];
  const unresolved: Array<{ event: string; reason: string }> = [];
  let cancelledBookings = 0;
  let skippedPastCourses = 0;
  let skippedCancelledCourses = 0;
  let bookingCount = 0;

  // Group attendee rows by EventID (one dated occurrence).
  const events = new Map<string, Array<Record<string, string>>>();
  for (const rec of records) {
    const eventId = pick(rec, ['EventID']);
    if (!eventId) {
      unresolved.push({
        event: pick(rec, ['Event title']) || '(no EventID)',
        reason: 'row has no EventID',
      });
      continue;
    }
    const arr = events.get(eventId) ?? [];
    arr.push(rec);
    events.set(eventId, arr);
  }

  const courses: PlannedCourse[] = [];

  for (const [eventId, rows] of events) {
    const first = rows[0];
    const rawTitle = pick(first, ['Event title']);
    const title = cleanTitle(rawTitle) || rawTitle || eventId;

    if (isTruthyFlag(pick(first, ['Event cancelled'])) || pick(first, ['Event cancelled']) !== '') {
      skippedCancelledCourses++;
      continue;
    }

    const starts = parseBookwhenDateTime(pick(first, ['Event starts']));
    if (!starts.date) {
      unresolved.push({ event: title, reason: 'could not read the Event starts date' });
      continue;
    }
    if (starts.date < opts.today) {
      skippedPastCourses++;
      continue;
    }
    const ends = parseBookwhenDateTime(pick(first, ['Event ends']));

    const location = pick(first, ['Location']);
    const online = looksOnline(rawTitle, location);
    const addr = parseAddress(location);
    const venuePostcode =
      addr.venue_postcode ??
      pick(first, POSTCODE_COLS).match(UK_POSTCODE_RE)?.[1]?.toUpperCase() ??
      null;

    const ticketName = pick(first, ['Ticket name']);
    const { template, match } = matchTemplate(`${title} ${ticketName}`, opts.templates);

    const courseWarnings: string[] = [];
    if (match !== 'matched') {
      courseWarnings.push(
        match === 'guessed'
          ? `Course type guessed as "${template?.name}" — check it.`
          : `Could not match a course type for "${title}" — pick one before importing.`,
      );
    }
    if (!starts.time) courseWarnings.push('No start time on the event — defaulting to 10:00.');
    if (online)
      courseWarnings.push('Looks like an online class — it has no venue; set this up as needed.');
    else if (!venuePostcode)
      courseWarnings.push('No postcode found for the venue — this class will need one.');

    // Group this event's attendee rows into bookings by BookingID.
    const byBooking = new Map<string, Array<Record<string, string>>>();
    for (const rec of rows) {
      const bid = pick(rec, ['BookingID', 'Booking ref']) || `${eventId}:${byBooking.size}`;
      const arr = byBooking.get(bid) ?? [];
      arr.push(rec);
      byBooking.set(bid, arr);
    }

    const bookings: PlannedBooking[] = [];
    for (const [bid, brows] of byBooking) {
      const r = brows[0];
      const status = bookingStatus(r);
      if (status === 'cancelled') cancelledBookings++;

      const email = pick(r, [
        'Contact email',
        'Booker email',
        'Attendee email',
        'Email address',
      ]).toLowerCase();
      const name = pick(r, ['Contact name', 'Full name']);
      let { first_name, last_name } = splitName(name);
      if (!first_name) {
        first_name = pick(r, ['First name']);
        last_name = pick(r, ['Last name']);
      }
      const cost = parseMoneyToPence(pick(r, ['Booking cost', 'Booking payments']));
      const face = parseMoneyToPence(pick(r, ['Ticket face value']));
      const owed = parseMoneyToPence(pick(r, ['Booking owed amount'])) ?? 0;
      const paid = /complete|paid/i.test(pick(r, ['Booking status'])) && owed <= 0;

      const bWarnings: string[] = [];
      if (!email) bWarnings.push('No email address on this booking.');

      bookings.push({
        bookwhen_booking_id: bid,
        first_name,
        last_name,
        email,
        phone: pick(r, PHONE_COLS) || null,
        quantity: brows.length,
        total_price_pence: cost ?? (face != null ? face * brows.length : 0),
        paid,
        status,
        warnings: bWarnings,
      });
      bookingCount += 1;
    }

    const activeSeats = bookings
      .filter((b) => b.status !== 'cancelled')
      .reduce((sum, b) => sum + b.quantity, 0);
    const capacity = Math.max(template?.default_capacity ?? 12, activeSeats);
    const pricePence =
      parseMoneyToPence(pick(first, ['Ticket face value'])) ?? template?.default_price_pence ?? 0;

    courses.push({
      bookwhen_event_id: eventId,
      title,
      template_id: template?.id ?? null,
      template_match: match,
      event_date: starts.date,
      start_time: starts.time ?? '10:00',
      end_time: ends.time ?? null,
      venue_name: online ? null : addr.venue_name,
      venue_postcode: online ? null : venuePostcode,
      online,
      price_pence: pricePence,
      capacity,
      bookings,
      warnings: courseWarnings,
    });
  }

  courses.sort((a, b) => (a.event_date ?? '').localeCompare(b.event_date ?? ''));

  return {
    courses,
    skippedPastCourses,
    skippedCancelledCourses,
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
