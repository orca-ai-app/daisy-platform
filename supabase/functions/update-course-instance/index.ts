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
]);

interface RequestBody {
  id?: string;
  fields?: Record<string, unknown>;
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

function summariseChanges(
  changedFields: Record<string, unknown>,
  venuePostcode: string,
  eventDate: string,
): string {
  const keys = Object.keys(changedFields);
  const list = keys.length === 0 ? 'no changes' : keys.join(', ');
  return `Course at ${venuePostcode} on ${eventDate} updated by HQ — ${list}`;
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
  // HQ check
  // ---------------------------------------------------------------------
  const actor = await admin
    .from('da_franchisees')
    .select('id, is_hq, name')
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  if (actor.error) {
    console.error('franchisee lookup failed', actor.error);
    return jsonResponse({ error: 'Failed to verify caller' }, 500);
  }
  if (!actor.data) {
    return jsonResponse({ error: 'Caller is not provisioned' }, 403);
  }
  if (!actor.data.is_hq) {
    return jsonResponse({ error: 'HQ access required' }, 403);
  }

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
    const v = updateFields.venue_postcode;
    if (typeof v !== 'string' || !UK_POSTCODE_RE.test(v)) {
      return jsonResponse({ error: 'venue_postcode must be a valid UK postcode' }, 400);
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
    const newPostcode = changedFields.venue_postcode as string;
    const coords = await geocodeViaEdgeFunction(supabaseUrl, serviceRoleKey, newPostcode);
    if (coords) {
      finalUpdate.lat = coords.lat;
      finalUpdate.lng = coords.lng;
      // geom is auto-populated by the 007 trigger from lat/lng.
    } else {
      geocodeFailed = true;
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

  const description = summariseChanges(changedFields, venuePostcode, eventDate);

  const activityMetadata: Record<string, unknown> = {
    changed_fields: changedFields,
    before: beforeSnapshot,
    after: afterSnapshot,
  };
  if (geocodeFailed) {
    activityMetadata.geocode_failed = true;
  }

  const activityInsert = await admin.from('da_activities').insert({
    actor_type: 'hq',
    actor_id: actor.data.id,
    entity_type: 'course_instance',
    entity_id: body.id,
    action: 'course_instance_updated',
    metadata: activityMetadata,
    description,
  });

  if (activityInsert.error) {
    console.error('activity log insert failed', activityInsert.error);
  }

  return jsonResponse(updated.data, 200);
});
