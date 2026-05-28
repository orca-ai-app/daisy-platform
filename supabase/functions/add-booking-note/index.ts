// supabase/functions/add-booking-note/index.ts
//
// POST { booking_id, note } -> 200 updated booking row
//
// Appends a timestamped note to da_bookings.notes (append-only, newline-separated).
//
// Note format appended:
//   [YYYY-MM-DD HH:mm UTC] <note text>
//
// If the existing notes field is null/empty the note becomes the whole value.
// If it already has content, a newline separator is used:
//   <existing notes>\n[YYYY-MM-DD HH:mm UTC] <note text>
//
// Behaviour:
//  1. Auth: JWT sub → da_franchisees.auth_user_id → franchisee row.
//  2. Load the target booking row.
//  3. Ownership: booking.franchisee_id must equal caller's id → 403 if not.
//  4. Append note with timestamp prefix.
//  5. UPDATE da_bookings.notes; stamp updated_at.
//  6. INSERT da_activities (action='booking_note_added').
//  7. Return updated row.
//
// NOTE: do NOT deploy — the verifier/orchestrator deploys all Edge Functions.

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
    const claims = JSON.parse(decoded) as Record<string, unknown>;
    return typeof claims.sub === 'string' ? claims.sub : null;
  } catch {
    return null;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

/**
 * Build the timestamp prefix for an appended note.
 * Format: [YYYY-MM-DD HH:mm UTC]
 */
function buildTimestampPrefix(now: Date): string {
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const y = now.getUTCFullYear();
  const m = pad2(now.getUTCMonth() + 1);
  const d = pad2(now.getUTCDate());
  const hh = pad2(now.getUTCHours());
  const mm = pad2(now.getUTCMinutes());
  return `[${y}-${m}-${d} ${hh}:${mm} UTC]`;
}

interface RequestBody {
  booking_id?: unknown;
  note?: unknown;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // Resolve franchisee from JWT sub
  // ---------------------------------------------------------------------------
  const franchiseeResult = await admin
    .from('da_franchisees')
    .select('id, name')
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  if (franchiseeResult.error) {
    console.error('franchisee lookup failed', franchiseeResult.error);
    return jsonResponse({ error: 'Failed to verify caller' }, 500);
  }
  if (!franchiseeResult.data) {
    return jsonResponse({ error: 'Caller is not provisioned as a franchisee' }, 403);
  }

  const franchisee = franchiseeResult.data as { id: string; name: string };

  // ---------------------------------------------------------------------------
  // Parse + validate body
  // ---------------------------------------------------------------------------
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  if (!isUuid(body.booking_id)) {
    return jsonResponse({ error: 'booking_id is required (uuid)' }, 400);
  }
  const bookingId = body.booking_id;

  if (typeof body.note !== 'string' || (body.note as string).trim().length === 0) {
    return jsonResponse({ error: 'note is required (non-empty string)' }, 400);
  }
  const noteText = (body.note as string).trim();

  // ---------------------------------------------------------------------------
  // Load current booking row
  // ---------------------------------------------------------------------------
  const bookingResult = await admin
    .from('da_bookings')
    .select('id, franchisee_id, booking_reference, notes, booking_status')
    .eq('id', bookingId)
    .maybeSingle();

  if (bookingResult.error) {
    console.error('booking lookup failed', bookingResult.error);
    return jsonResponse({ error: 'Failed to load booking' }, 500);
  }
  if (!bookingResult.data) {
    return jsonResponse({ error: 'Booking not found' }, 404);
  }

  const booking = bookingResult.data as {
    id: string;
    franchisee_id: string;
    booking_reference: string;
    notes: string | null;
    booking_status: string;
  };

  // ---------------------------------------------------------------------------
  // Ownership check
  // ---------------------------------------------------------------------------
  if (booking.franchisee_id !== franchisee.id) {
    return jsonResponse({ error: 'You do not own this booking' }, 403);
  }

  // ---------------------------------------------------------------------------
  // Build appended notes value (append-only, newline-separated with timestamp)
  // ---------------------------------------------------------------------------
  const now = new Date();
  const prefix = buildTimestampPrefix(now);
  const newEntry = `${prefix} ${noteText}`;
  const existingNotes = booking.notes?.trim() ?? '';
  const updatedNotes = existingNotes.length > 0 ? `${existingNotes}\n${newEntry}` : newEntry;

  // ---------------------------------------------------------------------------
  // UPDATE da_bookings
  // ---------------------------------------------------------------------------
  const updated = await admin
    .from('da_bookings')
    .update({
      notes: updatedNotes,
      updated_at: now.toISOString(),
    })
    .eq('id', bookingId)
    .select('*')
    .single();

  if (updated.error) {
    console.error('booking notes update failed', updated.error);
    return jsonResponse({ error: 'Failed to update booking notes' }, 500);
  }

  // ---------------------------------------------------------------------------
  // INSERT da_activities
  // ---------------------------------------------------------------------------
  await admin
    .from('da_activities')
    .insert({
      actor_type: 'franchisee',
      actor_id: franchisee.id,
      entity_type: 'booking',
      entity_id: bookingId,
      action: 'booking_note_added',
      metadata: {
        note: noteText,
        timestamp: now.toISOString(),
      },
      description: `Note added to booking ${booking.booking_reference}`,
    })
    .catch((err: unknown) => {
      console.error('activity log insert failed', err);
    });

  return jsonResponse(updated.data, 200);
});
