// supabase/functions/update-course-instance/index.ts
//
// POST { id: string, fields: Partial<CourseInstanceUpdate> } -> updated row
//
// Reference: docs/PRD-technical.md §4.5 (da_course_instances), §4.15
// (da_activities), docs/M1-build-plan.md §6 Wave 4 Agent 4B.
//
// Behaviour:
//  - Requires Authorization: Bearer <jwt>. JWT `sub` claim is matched
//    against da_franchisees.auth_user_id; only rows with `is_hq = TRUE`
//    may proceed. Non-HQ users get 403.
//  - Editable columns: event_date, start_time, end_time, venue_name,
//    venue_address, venue_postcode, capacity, price_pence. Any other
//    key in `fields` is rejected as 400. Sibling-managed columns
//    (franchisee_id, template_id, status, spots_remaining,
//    out_of_territory*) intentionally have separate flows.
//  - When venue_postcode changes we attempt to refresh lat/lng/geom by
//    calling the geocode-postcode Edge Function. Geocode failure does
//    NOT block the update — we persist the new postcode and stamp
//    `metadata.geocode_failed = true` on the activity row.
//  - Inserts a da_activities row with `entity_type='course_instance'`,
//    `action='course_instance_updated'`, before/after diff in metadata.

// deno-lint-ignore-file no-explicit-any

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ALLOWED_FIELDS = new Set([
  'event_date',
  'start_time',
  'end_time',
  'venue_name',
  'venue_address',
  'venue_postcode',
  'capacity',
  'price_pence',
  // Migration 040 (NTH-9): customer-facing name override + venue-TBC flag.
  'display_name',
  'venue_tbc',
  // Migration 045 (G1): franchisee-written customer-facing description.
  // NULL falls back to the template description on the booking page.
  'description_override',
]);

// Changes to any of these trigger the course_updated email when
// notify_attendees is set (NTH-14).
const NOTIFY_FIELDS = new Set([
  'event_date',
  'start_time',
  'end_time',
  'venue_name',
  'venue_address',
  'venue_postcode',
  'venue_tbc',
]);

interface RequestBody {
  id?: string;
  fields?: Record<string, unknown>;
  /**
   * When true and any date/time/venue field actually changed, queue one
   * 'course_updated' email per confirmed booking (NTH-14).
   */
  notify_attendees?: boolean;
}

interface ErrorResponse {
  error: string;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function decodeJwtSub(jwt: string): string | null {
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
    const decoded = atob(padded);
    const claims = JSON.parse(decoded);
    return typeof claims.sub === 'string' ? claims.sub : null;
  } catch {
    return null;
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Postgres TIME accepts HH:MM and HH:MM:SS — allow either, the DB
// stores HH:MM:SS internally.
const ISO_TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;
const UK_POSTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;
// Outward code only (e.g. 'GU1') — accepted for PRIVATE courses (migration 040).
const UK_OUTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?$/i;

function summariseChanges(
  changedFields: Record<string, unknown>,
  venuePostcode: string,
  eventDate: string,
  actorLabel: string,
): string {
  const keys = Object.keys(changedFields);
  const list = keys.length === 0 ? 'no changes' : keys.join(', ');
  return `Course at ${venuePostcode} on ${eventDate} updated by ${actorLabel} — ${list}`;
}

// Outcode geocode (private courses) — postcodes.io outcode endpoint returns
// the district centroid. Mirrors create-course-instance (migration 040).
async function geocodeOutcode(outcode: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const res = await fetch(`https://api.postcodes.io/outcodes/${encodeURIComponent(outcode)}`);
    if (!res.ok) {
      console.warn('postcodes.io outcode lookup returned non-200', res.status);
      return null;
    }
    const body = (await res.json()) as {
      result?: { latitude?: number | null; longitude?: number | null };
    };
    const latitude = body.result?.latitude;
    const longitude = body.result?.longitude;
    if (typeof latitude !== 'number' || typeof longitude !== 'number') return null;
    return { lat: latitude, lng: longitude };
  } catch (err) {
    console.warn('outcode geocode call failed', err);
    return null;
  }
}

async function geocodeViaEdgeFunction(
  supabaseUrl: string,
  serviceRoleKey: string,
  postcode: string,
): Promise<{ lat: number; lng: number } | null> {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/geocode-postcode`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({ postcode }),
    });
    if (!res.ok) {
      console.warn('geocode-postcode returned non-200', res.status);
      return null;
    }
    const body = (await res.json()) as { lat?: number; lng?: number };
    if (typeof body.lat !== 'number' || typeof body.lng !== 'number') return null;
    return { lat: body.lat, lng: body.lng };
  } catch (err) {
    console.warn('geocode call failed', err);
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' } as ErrorResponse, 405);
  }

  const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization');
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
    return jsonResponse({ error: 'Authorization header required' }, 401);
  }
  const jwt = authHeader.slice('bearer '.length).trim();
  const authUserId = decodeJwtSub(jwt);
  if (!authUserId) {
    return jsonResponse({ error: 'Invalid JWT' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Server misconfigured' }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // ---------------------------------------------------------------------
  // Auth check: HQ or owning franchisee (widened in Wave 7B).
  //
  // We resolve the actor first.  The instance ownership check runs
  // later — after we load the instance row — using the predicate:
  //   actor.is_hq === true  OR  actor.id === instance.franchisee_id
  // ---------------------------------------------------------------------
  const actorResult = await admin
    .from('da_franchisees')
    .select('id, is_hq, name')
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  if (actorResult.error) {
    console.error('franchisee lookup failed', actorResult.error);
    return jsonResponse({ error: 'Failed to verify caller' }, 500);
  }
  if (!actorResult.data) {
    return jsonResponse({ error: 'Caller is not provisioned' }, 403);
  }
  const actor = actorResult.data as { id: string; is_hq: boolean; name: string };

  // ---------------------------------------------------------------------
  // Parse + validate body
  // ---------------------------------------------------------------------
  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  if (!body.id || typeof body.id !== 'string' || !isUuid(body.id)) {
    return jsonResponse({ error: 'id is required (uuid)' }, 400);
  }
  if (!body.fields || typeof body.fields !== 'object') {
    return jsonResponse({ error: 'fields is required (object)' }, 400);
  }

  const fields = body.fields as Record<string, unknown>;
  const updateFields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!ALLOWED_FIELDS.has(key)) {
      return jsonResponse({ error: `Field not editable: ${key}` }, 400);
    }
    updateFields[key] = value;
  }

  if (Object.keys(updateFields).length === 0) {
    return jsonResponse({ error: 'No fields to update' }, 400);
  }

  // Type-shape sanity (cheap; DB will catch the rest).
  if ('event_date' in updateFields) {
    const v = updateFields.event_date;
    if (typeof v !== 'string' || !ISO_DATE_RE.test(v)) {
      return jsonResponse({ error: 'event_date must be YYYY-MM-DD' }, 400);
    }
  }
  for (const k of ['start_time', 'end_time'] as const) {
    if (k in updateFields) {
      const v = updateFields[k];
      if (typeof v !== 'string' || !ISO_TIME_RE.test(v)) {
        return jsonResponse({ error: `${k} must be HH:MM or HH:MM:SS` }, 400);
      }
    }
  }
  if ('venue_postcode' in updateFields) {
    // Shape check only here — the public-vs-private rule needs the instance
    // row (visibility), so it is enforced after the load below.
    const v = updateFields.venue_postcode;
    if (v === null) {
      // Allowed only for private venue-TBC courses — checked after load.
    } else if (typeof v !== 'string' || (!UK_POSTCODE_RE.test(v) && !UK_OUTCODE_RE.test(v))) {
      return jsonResponse(
        { error: 'venue_postcode must be a valid UK postcode or district (e.g. GU1), or null' },
        400,
      );
    } else {
      updateFields.venue_postcode = v.trim().toUpperCase();
    }
  }
  if ('venue_tbc' in updateFields && typeof updateFields.venue_tbc !== 'boolean') {
    return jsonResponse({ error: 'venue_tbc must be a boolean' }, 400);
  }
  if ('display_name' in updateFields) {
    const v = updateFields.display_name;
    if (v !== null && typeof v !== 'string') {
      return jsonResponse({ error: 'display_name must be a string or null' }, 400);
    }
    if (typeof v === 'string') {
      updateFields.display_name = v.trim() || null;
    }
  }
  // Migration 045 (G1): empty string normalises to NULL so clearing the box
  // falls back to the template description rather than showing nothing.
  if ('description_override' in updateFields) {
    const v = updateFields.description_override;
    if (v !== null && typeof v !== 'string') {
      return jsonResponse({ error: 'description_override must be a string or null' }, 400);
    }
    if (typeof v === 'string') {
      updateFields.description_override = v.trim() || null;
    }
  }
  for (const k of ['venue_name', 'venue_address'] as const) {
    if (k in updateFields) {
      const v = updateFields[k];
      if (v !== null && typeof v !== 'string') {
        return jsonResponse({ error: `${k} must be a string or null` }, 400);
      }
    }
  }
  if ('capacity' in updateFields) {
    const v = updateFields.capacity;
    if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) {
      return jsonResponse({ error: 'capacity must be a positive integer' }, 400);
    }
  }
  if ('price_pence' in updateFields) {
    const v = updateFields.price_pence;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
      return jsonResponse({ error: 'price_pence must be a non-negative integer' }, 400);
    }
  }

  // ---------------------------------------------------------------------
  // Read current row (for the activity diff)
  // ---------------------------------------------------------------------
  const before = await admin
    .from('da_course_instances')
    .select('*')
    .eq('id', body.id)
    .maybeSingle();

  if (before.error) {
    console.error('course instance lookup failed', before.error);
    return jsonResponse({ error: 'Failed to load course instance' }, 500);
  }
  if (!before.data) {
    return jsonResponse({ error: 'Course instance not found' }, 404);
  }

  const beforeRow = before.data as Record<string, unknown>;

  // Ownership check: HQ may edit any instance; a franchisee may only edit
  // their own.  Evaluated here (after load) so the 404 path fires first for
  // non-existent ids regardless of who is calling.
  if (!actor.is_hq && actor.id !== (beforeRow.franchisee_id as string)) {
    return jsonResponse({ error: 'You do not own this course instance' }, 403);
  }

  // F1: a ticket must never use more places than the class has. Lowering the
  // capacity below an existing ticket's seats_consumed would recreate the bug
  // where a single booking consumes the whole class, so reject it and name the
  // ticket that blocks the change.
  if ('capacity' in updateFields) {
    const newCapacity = updateFields.capacity as number;
    const tickets = await admin
      .from('da_ticket_types')
      .select('name, seats_consumed')
      .eq('course_instance_id', body.id as string);

    if (tickets.error) {
      console.error('ticket type lookup failed', tickets.error);
      return jsonResponse({ error: 'Failed to check ticket types' }, 500);
    }

    const offending = (
      (tickets.data ?? []) as Array<{ name: string; seats_consumed: number }>
    ).find((tt) => tt.seats_consumed > newCapacity);
    if (offending) {
      return jsonResponse(
        {
          error: `Ticket "${offending.name}" uses ${offending.seats_consumed} places, so the class cannot have a capacity of ${newCapacity}. A ticket cannot use more places than the class has.`,
        },
        400,
      );
    }
  }

  // Venue rules (migration 040 / NTH-9), evaluated against the POST-update
  // effective state so a TBC venue can be completed later:
  //   public  — full postcode required, venue_tbc not allowed.
  //   private — full postcode, outcode, or null (null only while venue_tbc).
  {
    const visibility = beforeRow.visibility as string;
    const effectivePostcode = (
      'venue_postcode' in updateFields ? updateFields.venue_postcode : beforeRow.venue_postcode
    ) as string | null;
    const effectiveTbc = (
      'venue_tbc' in updateFields ? updateFields.venue_tbc : beforeRow.venue_tbc
    ) as boolean;

    if (visibility === 'public') {
      if (!effectivePostcode || !UK_POSTCODE_RE.test(effectivePostcode)) {
        return jsonResponse({ error: 'Public courses require a full venue postcode' }, 400);
      }
      if (effectiveTbc) {
        return jsonResponse({ error: 'venue_tbc is only allowed for private courses' }, 400);
      }
    } else if (!effectivePostcode && !effectiveTbc) {
      return jsonResponse(
        { error: 'venue_postcode is required unless the venue is marked as to be confirmed' },
        400,
      );
    }
  }

  // Reject capacity that drops below seats already sold (capacity - spots_remaining).
  if ('capacity' in updateFields) {
    const seatsSold = Number(beforeRow.capacity ?? 0) - Number(beforeRow.spots_remaining ?? 0);
    if ((updateFields.capacity as number) < seatsSold) {
      return jsonResponse(
        {
          error: `capacity cannot drop below ${seatsSold} (seats already sold)`,
        },
        400,
      );
    }
  }

  // Build the changed-fields diff (only entries that actually changed).
  const changedFields: Record<string, unknown> = {};
  const beforeSnapshot: Record<string, unknown> = {};
  const afterSnapshot: Record<string, unknown> = {};
  for (const [key, newValue] of Object.entries(updateFields)) {
    const oldValue = beforeRow[key];
    if (oldValue !== newValue) {
      changedFields[key] = newValue;
      beforeSnapshot[key] = oldValue;
      afterSnapshot[key] = newValue;
    }
  }

  if (Object.keys(changedFields).length === 0) {
    // No-op update — return current row, skip activity log.
    return jsonResponse(before.data, 200);
  }

  // ---------------------------------------------------------------------
  // Geocode if postcode changed
  // ---------------------------------------------------------------------
  let geocodeFailed = false;
  const finalUpdate: Record<string, unknown> = { ...changedFields };
  // If capacity is changing, keep spots_remaining consistent: bump it
  // by the same delta so the seats-sold count stays the same.
  if ('capacity' in changedFields) {
    const oldCapacity = Number(beforeRow.capacity ?? 0);
    const newCapacity = Number(changedFields.capacity);
    const oldSpots = Number(beforeRow.spots_remaining ?? 0);
    const seatsSold = oldCapacity - oldSpots;
    finalUpdate.spots_remaining = Math.max(newCapacity - seatsSold, 0);
  }

  if ('venue_postcode' in changedFields) {
    const newPostcode = changedFields.venue_postcode as string | null;
    if (newPostcode === null) {
      // Venue TBC — clear the coordinates. geom is left as-is by the 007
      // trigger (it only writes when lat AND lng are non-null), which is
      // harmless: the row never surfaces in public search while private.
      finalUpdate.lat = null;
      finalUpdate.lng = null;
    } else if (UK_OUTCODE_RE.test(newPostcode) && !UK_POSTCODE_RE.test(newPostcode)) {
      // Outcode only (private courses) — postcodes.io district centroid.
      const coords = await geocodeOutcode(newPostcode);
      if (coords) {
        finalUpdate.lat = coords.lat;
        finalUpdate.lng = coords.lng;
      } else {
        geocodeFailed = true;
      }
    } else {
      const coords = await geocodeViaEdgeFunction(supabaseUrl, serviceRoleKey, newPostcode);
      if (coords) {
        finalUpdate.lat = coords.lat;
        finalUpdate.lng = coords.lng;
        // geom is auto-populated by the 007 trigger from lat/lng.
      } else {
        geocodeFailed = true;
      }
    }
  }

  // ---------------------------------------------------------------------
  // Apply update + activity log
  // ---------------------------------------------------------------------
  const updated = await admin
    .from('da_course_instances')
    .update({ ...finalUpdate, updated_at: new Date().toISOString() })
    .eq('id', body.id)
    .select('*')
    .single();

  if (updated.error) {
    console.error('course instance update failed', updated.error);
    return jsonResponse({ error: 'Failed to update course instance' }, 500);
  }

  const updatedRow = updated.data as Record<string, unknown>;
  const venuePostcode =
    (updatedRow.venue_postcode as string) ?? (beforeRow.venue_postcode as string) ?? '';
  const eventDate = (updatedRow.event_date as string) ?? (beforeRow.event_date as string) ?? '';

  const actorType = actor.is_hq ? 'hq' : 'franchisee';
  const actorLabel = actor.is_hq ? 'HQ' : 'franchisee';
  const description = summariseChanges(changedFields, venuePostcode, eventDate, actorLabel);

  const activityMetadata: Record<string, unknown> = {
    changed_fields: changedFields,
    before: beforeSnapshot,
    after: afterSnapshot,
  };
  if (geocodeFailed) {
    activityMetadata.geocode_failed = true;
  }

  const activityInsert = await admin.from('da_activities').insert({
    actor_type: actorType,
    actor_id: actor.id,
    entity_type: 'course_instance',
    entity_id: body.id,
    action: 'course_instance_updated',
    metadata: activityMetadata,
    description,
  });

  if (activityInsert.error) {
    console.error('activity log insert failed', activityInsert.error);
  }

  // ---------------------------------------------------------------------
  // NTH-14 — notify booked customers of date/time/venue changes.
  //
  // When the caller set notify_attendees and any notify-relevant field
  // actually changed, queue one 'course_updated' row per CONFIRMED booking
  // in da_email_sequences (same row shape as _shared/emailSchedule.ts —
  // the send-emails cron drains them on its next run and renders the
  // course's CURRENT details, i.e. the new date/time/venue).
  // Queue failure must not fail the update — money/state has already moved.
  // ---------------------------------------------------------------------
  const notifyRelevantChange = Object.keys(changedFields).some((k) => NOTIFY_FIELDS.has(k));
  if (body.notify_attendees === true && notifyRelevantChange) {
    const bookings = await admin
      .from('da_bookings')
      .select('id, customer_id')
      .eq('course_instance_id', body.id)
      .eq('booking_status', 'confirmed');

    if (bookings.error) {
      console.error('course_updated: confirmed bookings load failed', bookings.error);
    } else {
      const nowIso = new Date().toISOString();
      const rows = ((bookings.data ?? []) as Array<{ id: string; customer_id: string }>).map(
        (b) => ({
          customer_id: b.customer_id,
          booking_id: b.id,
          template_key: 'course_updated',
          sequence_day: 0,
          scheduled_for: nowIso,
          status: 'pending',
        }),
      );
      if (rows.length > 0) {
        const queueInsert = await admin.from('da_email_sequences').insert(rows);
        if (queueInsert.error) {
          console.error('course_updated: email queue insert failed', queueInsert.error);
          await admin
            .from('da_activities')
            .insert({
              actor_type: 'system',
              actor_id: null,
              entity_type: 'course_instance',
              entity_id: body.id,
              action: 'email_queue_failed',
              metadata: { template_key: 'course_updated', error: queueInsert.error.message },
              description: `course_updated emails failed to queue for course at ${venuePostcode}`,
            })
            .then((r: { error: unknown }) => {
              if (r.error) console.error('email_queue_failed activity insert failed', r.error);
            });
        }
      }
    }
  }

  return jsonResponse(updated.data, 200);
});
