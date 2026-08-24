// importQueries.ts
//
// Orchestrates a confirmed BookWhen import plan by driving the EXISTING,
// proven edge functions rather than a new bespoke writer:
//   create-course-instance  -> one per upcoming course (geocode, territory,
//                               booking_token, ticket types all handled there)
//   create-booking          -> one per active (non-cancelled) booking
//   mark-booking-paid        -> for bookings that were paid on BookWhen
//
// Runs sequentially with a progress callback (a franchisee's whole history is
// a modest number of calls, and per-row visibility beats speed for a one-off).

import { supabase } from '@/lib/supabase';
import type { ImportPlan, PlannedCourse } from './bookwhenParse';

export interface ImportResult {
  coursesCreated: number;
  coursesSkipped: Array<{ title: string; reason: string }>;
  bookingsCreated: number;
  bookingsPaid: number;
  bookingsSkipped: Array<{ who: string; reason: string }>;
  errors: Array<{ where: string; message: string }>;
}

export interface ImportProgress {
  done: number;
  total: number;
  label: string;
}

async function callFn<T>(name: string, body: unknown): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error('You must be signed in.');
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `${name} failed (${res.status})`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      /* keep default */
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

/** start 'HH:MM' plus n hours, clamped to 23:59. */
function addHours(start: string, n: number): string {
  const [h, m] = start.split(':').map((x) => Number(x));
  const total = Math.min(
    23 * 60 + 59,
    (Number.isFinite(h) ? h : 10) * 60 + (Number.isFinite(m) ? m : 0) + n * 60,
  );
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return `${hh < 10 ? '0' : ''}${hh}:${mm < 10 ? '0' : ''}${mm}`;
}

function courseBlocker(c: PlannedCourse): string | null {
  if (!c.template_id) return 'no course type matched — pick one first';
  if (!c.event_date) return 'no date';
  if (!c.start_time) return 'no start time';
  if (!c.venue_postcode) return 'no venue postcode';
  return null;
}

interface CreateInstanceResponse {
  instance: { id: string };
  ticket_types: Array<{ id: string; seats_consumed: number }>;
}

/** Count the units of work for the progress bar (courses + active bookings). */
function totalUnits(plan: ImportPlan): number {
  let n = 0;
  for (const c of plan.courses) {
    if (courseBlocker(c)) continue;
    n += 1;
    n += c.bookings.filter((b) => b.status !== 'cancelled' && b.email).length;
  }
  return n;
}

export async function runImport(
  plan: ImportPlan,
  opts: { onProgress?: (p: ImportProgress) => void } = {},
): Promise<ImportResult> {
  const result: ImportResult = {
    coursesCreated: 0,
    coursesSkipped: [],
    bookingsCreated: 0,
    bookingsPaid: 0,
    bookingsSkipped: [],
    errors: [],
  };
  const total = totalUnits(plan);
  let done = 0;
  const tick = (label: string) => opts.onProgress?.({ done, total, label });

  for (const course of plan.courses) {
    const blocker = courseBlocker(course);
    if (blocker) {
      result.coursesSkipped.push({ title: course.title, reason: blocker });
      continue;
    }

    let instanceId: string;
    let ticketTypeId: string;
    try {
      const resp = await callFn<CreateInstanceResponse>('create-course-instance', {
        template_id: course.template_id,
        event_date: course.event_date,
        start_time: course.start_time,
        end_time: course.end_time ?? addHours(course.start_time as string, 2),
        venue_name: course.venue_name,
        venue_postcode: course.venue_postcode,
        visibility: 'public',
        capacity: course.capacity,
        price_pence: course.price_pence,
        ticket_types: [],
        out_of_territory_confirmed: true,
        allow_free: course.price_pence === 0,
      });
      instanceId = resp.instance.id;
      const base = resp.ticket_types.find((t) => t.seats_consumed === 1) ?? resp.ticket_types[0];
      if (!base) throw new Error('course created but no ticket type returned');
      ticketTypeId = base.id;
      result.coursesCreated += 1;
    } catch (err) {
      result.errors.push({ where: `course "${course.title}"`, message: (err as Error).message });
      continue;
    }
    done += 1;
    tick(`Created ${course.title}`);

    for (const b of course.bookings) {
      if (b.status === 'cancelled') continue;
      if (!b.email) {
        result.bookingsSkipped.push({
          who: `${b.first_name} ${b.last_name}`.trim() || '(unnamed)',
          reason: 'no email',
        });
        continue;
      }
      try {
        const bk = await callFn<{ id: string }>('create-booking', {
          course_instance_id: instanceId,
          ticket_type_id: ticketTypeId,
          quantity: b.quantity,
          customer: {
            first_name: b.first_name || 'Unknown',
            last_name: b.last_name || 'Unknown',
            email: b.email,
            phone: b.phone ?? undefined,
          },
          notes: `Imported from BookWhen (BookingID ${b.bookwhen_booking_id}).`,
        });
        result.bookingsCreated += 1;

        if (b.paid) {
          try {
            await callFn('mark-booking-paid', {
              booking_id: bk.id,
              payment_reference: `BookWhen ${b.bookwhen_booking_id}`,
            });
            result.bookingsPaid += 1;
          } catch (err) {
            result.errors.push({ where: `mark paid ${b.email}`, message: (err as Error).message });
          }
        }
      } catch (err) {
        result.errors.push({ where: `booking ${b.email}`, message: (err as Error).message });
      }
      done += 1;
      tick(`${b.email}`);
    }
  }

  return result;
}
