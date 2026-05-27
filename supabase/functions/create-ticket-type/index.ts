// supabase/functions/create-ticket-type/index.ts
//
// POST { course_instance_id: string, ticket_type: TicketTypeInput } ->
//   da_ticket_types row
//
// Reference: docs/PRD-technical.md §4.6 (da_ticket_types), §4.15
// (da_activities), Wave 7B.
//
// Auth: caller must be the franchisee who owns the course instance.
//   JWT sub → da_franchisees.auth_user_id → franchisee row.
//   The instance's franchisee_id must equal the caller's franchisee id.
//   HQ actors (is_hq = true) are also permitted.
//
// Behaviour:
//  - Validates input; rejects non-owning franchisees with 403.
//  - INSERTs a da_ticket_types row.
//  - INSERTs a da_activities row (actor_type depends on is_hq).

// deno-lint-ignore-file no-explicit-any

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

interface TicketTypeInput {
  name?: unknown;
  price_pence?: unknown;
  seats_consumed?: unknown;
  max_available?: unknown;
  sort_order?: unknown;
}

interface RequestBody {
  course_instance_id?: unknown;
  ticket_type?: TicketTypeInput;
}

function validateTicketTypeInput(
  tt: TicketTypeInput,
):
  | {
      ok: true;
      value: {
        name: string;
        price_pence: number;
        seats_consumed: number;
        max_available: number | null;
        sort_order: number;
      };
    }
  | { ok: false; error: string } {
  if (typeof tt.name !== 'string' || tt.name.trim().length === 0) {
    return { ok: false, error: 'ticket_type.name must be a non-empty string' };
  }
  if (
    typeof tt.price_pence !== 'number' ||
    !Number.isInteger(tt.price_pence) ||
    tt.price_pence < 0
  ) {
    return { ok: false, error: 'ticket_type.price_pence must be a non-negative integer' };
  }
  if (
    typeof tt.seats_consumed !== 'number' ||
    !Number.isInteger(tt.seats_consumed) ||
    tt.seats_consumed < 1
  ) {
    return { ok: false, error: 'ticket_type.seats_consumed must be a positive integer' };
  }
  if (
    tt.max_available !== null &&
    tt.max_available !== undefined &&
    (typeof tt.max_available !== 'number' ||
      !Number.isInteger(tt.max_available) ||
      tt.max_available < 1)
  ) {
    return { ok: false, error: 'ticket_type.max_available must be a positive integer or null' };
  }
  const sort_order =
    tt.sort_order !== undefined && typeof tt.sort_order === 'number' ? tt.sort_order : 0;

  return {
    ok: true,
    value: {
      name: (tt.name as string).trim(),
      price_pence: tt.price_pence as number,
      seats_consumed: tt.seats_consumed as number,
      max_available: tt.max_available != null ? (tt.max_available as number) : null,
      sort_order,
    },
  };
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

  if (typeof body.course_instance_id !== 'string' || !isUuid(body.course_instance_id)) {
    return jsonResponse({ error: 'course_instance_id is required (uuid)' }, 400);
  }
  if (!body.ticket_type || typeof body.ticket_type !== 'object') {
    return jsonResponse({ error: 'ticket_type is required (object)' }, 400);
  }

  const validated = validateTicketTypeInput(body.ticket_type);
  if (!validated.ok) {
    return jsonResponse({ error: validated.error }, 400);
  }
  const input = validated.value;

  // -------------------------------------------------------------------------
  // Load instance and check ownership
  // -------------------------------------------------------------------------
  const instanceQuery = await admin
    .from('da_course_instances')
    .select('id, franchisee_id, venue_postcode, event_date')
    .eq('id', body.course_instance_id)
    .maybeSingle();

  if (instanceQuery.error) {
    console.error('instance lookup failed', instanceQuery.error);
    return jsonResponse({ error: 'Failed to load course instance' }, 500);
  }
  if (!instanceQuery.data) {
    return jsonResponse({ error: 'Course instance not found' }, 404);
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
  // INSERT ticket type
  // -------------------------------------------------------------------------
  const inserted = await admin
    .from('da_ticket_types')
    .insert({
      course_instance_id: body.course_instance_id,
      name: input.name,
      price_pence: input.price_pence,
      seats_consumed: input.seats_consumed,
      max_available: input.max_available,
      sort_order: input.sort_order,
    })
    .select('*')
    .single();

  if (inserted.error || !inserted.data) {
    console.error('ticket type insert failed', inserted.error);
    return jsonResponse({ error: 'Failed to create ticket type' }, 500);
  }

  const ticketType = inserted.data;

  // -------------------------------------------------------------------------
  // Activity log
  // -------------------------------------------------------------------------
  const actorType = actor.is_hq ? 'hq' : 'franchisee';
  const description = `Ticket type "${input.name}" added to course at ${instance.venue_postcode} on ${instance.event_date}`;

  const activityInsert = await admin.from('da_activities').insert({
    actor_type: actorType,
    actor_id: actor.id,
    entity_type: 'course_instance',
    entity_id: body.course_instance_id,
    action: 'ticket_type_created',
    metadata: {
      ticket_type_id: (ticketType as any).id,
      name: input.name,
      price_pence: input.price_pence,
      seats_consumed: input.seats_consumed,
      max_available: input.max_available,
    },
    description,
  });

  if (activityInsert.error) {
    console.error('activity log insert failed', activityInsert.error);
  }

  return jsonResponse(ticketType, 201);
});
