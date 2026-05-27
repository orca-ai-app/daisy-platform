// supabase/functions/update-ticket-type/index.ts
//
// POST { id: string, fields: Partial<TicketTypeInput> } -> da_ticket_types row
//
// Reference: docs/PRD-technical.md §4.6 (da_ticket_types), §4.15
// (da_activities), Wave 7B.
//
// Auth: caller must be the franchisee who owns the parent course instance,
//   or an HQ actor (is_hq = true).
//
// Editable fields: name, price_pence, seats_consumed, max_available, sort_order.
// Activity log includes changed_fields diff (before/after).

// deno-lint-ignore-file no-explicit-any

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ALLOWED_FIELDS = new Set([
  'name',
  'price_pence',
  'seats_consumed',
  'max_available',
  'sort_order',
]);

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

interface RequestBody {
  id?: unknown;
  fields?: Record<string, unknown>;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
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

  // -------------------------------------------------------------------------
  // Resolve actor
  // -------------------------------------------------------------------------
  const actorQuery = await admin
    .from('da_franchisees')
    .select('id, is_hq, name')
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  if (actorQuery.error) {
    console.error('franchisee lookup failed', actorQuery.error);
    return jsonResponse({ error: 'Failed to verify caller' }, 500);
  }
  if (!actorQuery.data) {
    return jsonResponse({ error: 'Caller is not provisioned' }, 403);
  }
  const actor = actorQuery.data as { id: string; is_hq: boolean; name: string };

  // -------------------------------------------------------------------------
  // Parse + validate body
  // -------------------------------------------------------------------------
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  if (!body.id || typeof body.id !== 'string' || !isUuid(body.id as string)) {
    return jsonResponse({ error: 'id is required (uuid)' }, 400);
  }
  if (!body.fields || typeof body.fields !== 'object') {
    return jsonResponse({ error: 'fields is required (object)' }, 400);
  }

  const fields = body.fields;
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

  // Type validation
  if ('name' in updateFields) {
    const v = updateFields.name;
    if (typeof v !== 'string' || v.trim().length === 0) {
      return jsonResponse({ error: 'name must be a non-empty string' }, 400);
    }
    updateFields.name = (v as string).trim();
  }
  if ('price_pence' in updateFields) {
    const v = updateFields.price_pence;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
      return jsonResponse({ error: 'price_pence must be a non-negative integer' }, 400);
    }
  }
  if ('seats_consumed' in updateFields) {
    const v = updateFields.seats_consumed;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
      return jsonResponse({ error: 'seats_consumed must be a positive integer' }, 400);
    }
  }
  if ('max_available' in updateFields) {
    const v = updateFields.max_available;
    if (v !== null && (typeof v !== 'number' || !Number.isInteger(v) || v < 1)) {
      return jsonResponse({ error: 'max_available must be a positive integer or null' }, 400);
    }
  }
  if ('sort_order' in updateFields) {
    const v = updateFields.sort_order;
    if (typeof v !== 'number' || !Number.isInteger(v)) {
      return jsonResponse({ error: 'sort_order must be an integer' }, 400);
    }
  }

  // -------------------------------------------------------------------------
  // Load ticket type + parent instance for ownership check
  // -------------------------------------------------------------------------
  const ttQuery = await admin
    .from('da_ticket_types')
    .select('id, course_instance_id, name, price_pence, seats_consumed, max_available, sort_order')
    .eq('id', body.id as string)
    .maybeSingle();

  if (ttQuery.error) {
    console.error('ticket type lookup failed', ttQuery.error);
    return jsonResponse({ error: 'Failed to load ticket type' }, 500);
  }
  if (!ttQuery.data) {
    return jsonResponse({ error: 'Ticket type not found' }, 404);
  }
  const beforeRow = ttQuery.data as Record<string, unknown>;

  const instanceQuery = await admin
    .from('da_course_instances')
    .select('id, franchisee_id, venue_postcode, event_date')
    .eq('id', beforeRow.course_instance_id as string)
    .maybeSingle();

  if (instanceQuery.error) {
    console.error('instance lookup failed', instanceQuery.error);
    return jsonResponse({ error: 'Failed to load course instance' }, 500);
  }
  if (!instanceQuery.data) {
    return jsonResponse({ error: 'Parent course instance not found' }, 404);
  }

  const instance = instanceQuery.data as {
    id: string;
    franchisee_id: string;
    venue_postcode: string;
    event_date: string;
  };

  // Auth predicate: HQ or owning franchisee.
  if (!actor.is_hq && actor.id !== instance.franchisee_id) {
    return jsonResponse({ error: 'You do not own this course instance' }, 403);
  }

  // -------------------------------------------------------------------------
  // Build diff and apply update
  // -------------------------------------------------------------------------
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
    // No-op — return current row without logging.
    return jsonResponse(beforeRow, 200);
  }

  const updated = await admin
    .from('da_ticket_types')
    .update(changedFields)
    .eq('id', body.id as string)
    .select('*')
    .single();

  if (updated.error) {
    console.error('ticket type update failed', updated.error);
    return jsonResponse({ error: 'Failed to update ticket type' }, 500);
  }

  // -------------------------------------------------------------------------
  // Activity log
  // -------------------------------------------------------------------------
  const actorType = actor.is_hq ? 'hq' : 'franchisee';
  const name = (updateFields.name ?? beforeRow.name) as string;
  const description = `Ticket type "${name}" updated on course at ${instance.venue_postcode} on ${instance.event_date}`;

  const activityInsert = await admin.from('da_activities').insert({
    actor_type: actorType,
    actor_id: actor.id,
    entity_type: 'course_instance',
    entity_id: instance.id,
    action: 'ticket_type_updated',
    metadata: {
      ticket_type_id: body.id,
      changed_fields: changedFields,
      before: beforeSnapshot,
      after: afterSnapshot,
    },
    description,
  });

  if (activityInsert.error) {
    console.error('activity log insert failed', activityInsert.error);
  }

  return jsonResponse(updated.data, 200);
});
