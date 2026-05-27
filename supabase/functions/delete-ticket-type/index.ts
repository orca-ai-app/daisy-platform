// supabase/functions/delete-ticket-type/index.ts
//
// POST { id: string } -> { deleted: true }
//
// Reference: docs/PRD-technical.md §4.6 (da_ticket_types), §4.9
// (da_bookings), §4.15 (da_activities), Wave 7B.
//
// Auth: caller must be the franchisee who owns the parent course instance,
//   or an HQ actor (is_hq = true).
//
// Delete is blocked with 409 if any da_bookings row references the ticket
// type via ticket_type_id — the client must be shown the block reason
// rather than cascading a delete under active bookings.
//
// Activity: logs ticket_type_deleted on the parent course_instance entity.

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

interface RequestBody {
  id?: unknown;
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

  // -------------------------------------------------------------------------
  // Load ticket type + parent instance for ownership check
  // -------------------------------------------------------------------------
  const ttQuery = await admin
    .from('da_ticket_types')
    .select('id, name, course_instance_id')
    .eq('id', body.id as string)
    .maybeSingle();

  if (ttQuery.error) {
    console.error('ticket type lookup failed', ttQuery.error);
    return jsonResponse({ error: 'Failed to load ticket type' }, 500);
  }
  if (!ttQuery.data) {
    return jsonResponse({ error: 'Ticket type not found' }, 404);
  }
  const ticketType = ttQuery.data as { id: string; name: string; course_instance_id: string };

  const instanceQuery = await admin
    .from('da_course_instances')
    .select('id, franchisee_id, venue_postcode, event_date')
    .eq('id', ticketType.course_instance_id)
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
  // Booking-reference check — block delete if any booking uses this ticket type.
  // da_bookings.ticket_type_id FK (from migration 002) links bookings to types.
  // -------------------------------------------------------------------------
  const bookingCheck = await admin
    .from('da_bookings')
    .select('id', { count: 'exact', head: true })
    .eq('ticket_type_id', body.id as string);

  if (bookingCheck.error) {
    console.error('booking reference check failed', bookingCheck.error);
    return jsonResponse({ error: 'Failed to check booking references' }, 500);
  }

  const bookingCount = bookingCheck.count ?? 0;
  if (bookingCount > 0) {
    const noun = bookingCount === 1 ? 'booking' : 'bookings';
    return jsonResponse(
      {
        error: `Cannot delete: ${bookingCount} ${noun} reference this ticket type. Remove or reassign those bookings first.`,
        bookings_count: bookingCount,
      },
      409,
    );
  }

  // -------------------------------------------------------------------------
  // Delete
  // -------------------------------------------------------------------------
  const deleted = await admin
    .from('da_ticket_types')
    .delete()
    .eq('id', body.id as string);

  if (deleted.error) {
    console.error('ticket type delete failed', deleted.error);
    return jsonResponse({ error: 'Failed to delete ticket type' }, 500);
  }

  // -------------------------------------------------------------------------
  // Activity log
  // -------------------------------------------------------------------------
  const actorType = actor.is_hq ? 'hq' : 'franchisee';
  const description = `Ticket type "${ticketType.name}" deleted from course at ${instance.venue_postcode} on ${instance.event_date}`;

  const activityInsert = await admin.from('da_activities').insert({
    actor_type: actorType,
    actor_id: actor.id,
    entity_type: 'course_instance',
    entity_id: instance.id,
    action: 'ticket_type_deleted',
    metadata: {
      ticket_type_id: body.id,
      name: ticketType.name,
    },
    description,
  });

  if (activityInsert.error) {
    console.error('activity log insert failed', activityInsert.error);
  }

  return jsonResponse({ deleted: true }, 200);
});
