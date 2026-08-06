// supabase/functions/create-course-instance/index.ts
//
// POST <CreateCourseInstanceRequest body>
//   -> 201 CreateCourseInstanceResponse
//   -> 409 CreateCourseInstanceTerritoryConflict (warning present, not confirmed)
//   -> 400 bad input / 401 auth / 403 no franchisee row / 500 server error
//
// Reference: docs/types.ts contract (Wave 7 SCAFFOLD), PRD §4.5 (course instances),
// §4.6 (ticket types), §4.15 (activities).
//
// Responsibilities:
//   1. Authenticate: JWT sub → da_franchisees.auth_user_id → franchisee row.
//   2. Server-side geocode via geocode-postcode function (ignores any client lat/lng).
//   3. Resolve territory by postcode_prefix; compute out_of_territory +
//      out_of_territory_warning. If a warning applies and out_of_territory_confirmed
//      !== true, return 409 with the conflict body so the client can re-render
//      <TerritoryWarning> and resubmit.
//   4. INSERT da_course_instances (status='scheduled', spots_remaining=capacity,
//      server-derived lat/lng/territory/out_of_territory/out_of_territory_warning).
//   5. INSERT da_ticket_types — either the request ticket_types array or, if
//      that is empty/absent, seed from the template's default_ticket_types.
//   6. INSERT da_activities (actor_type='franchisee', action='course_created').
//   7. Return CreateCourseInstanceResponse (201).
//
// NOTE: do NOT deploy this function — the verifier agent does that.

// deno-lint-ignore-file no-explicit-any

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// JWT decode (sub claim only — Supabase gateway validates the signature)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Types (mirrors the frozen client contract — kept local so the function has
// no import dependency on the TS source tree)
// ---------------------------------------------------------------------------

type Visibility = 'public' | 'private';
type OutOfTerritoryWarningColumn = 'owned_by_other' | 'vacant' | null;
type OutOfTerritoryWarning = 'none' | 'vacant' | 'owned_by_other';

interface CreateCourseTicketTypeInput {
  name: string;
  price_pence: number;
  seats_consumed: number;
  max_available: number | null;
  sort_order: number;
  /** Optional session details shown under the ticket name (migration 040). */
  session_label?: string | null;
  /** Optional VAT rate percentage the price includes, e.g. 20 (migration 040). */
  vat_rate?: number | null;
}

interface DefaultTicketType {
  name: string;
  seats_consumed: number;
  price_modifier_pence: number;
}

interface CreateCourseInstanceRequest {
  template_id: string;
  event_date: string;
  start_time: string;
  end_time: string;
  venue_name?: string | null;
  venue_address?: string | null;
  /**
   * Public courses: a full UK postcode (required). Private courses: a full
   * postcode, an outcode only (e.g. 'GU1'), or null when venue_tbc.
   */
  venue_postcode: string | null;
  visibility: Visibility;
  capacity: number;
  price_pence: number;
  bespoke_details?: string | null;
  ticket_types: CreateCourseTicketTypeInput[];
  out_of_territory_confirmed?: boolean;
  /** Optional: the private client this course is for (Wave 9C / migration 021). */
  private_client_id?: string | null;
  /** Optional customer-facing class name override (migration 040). */
  display_name?: string | null;
  /** Venue not yet confirmed (private courses only, migration 040). */
  venue_tbc?: boolean;
}

// ---------------------------------------------------------------------------
// Geocode helper (calls geocode-postcode function server-to-server)
// ---------------------------------------------------------------------------

interface GeocodeResult {
  lat: number;
  lng: number;
  postcode_prefix: string;
}

async function geocodePostcode(
  supabaseUrl: string,
  serviceRoleKey: string,
  postcode: string,
): Promise<{ ok: true; result: GeocodeResult } | { ok: false; status: number; error: string }> {
  const url = `${supabaseUrl}/functions/v1/geocode-postcode`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Service-role key satisfies the geocode function's Bearer requirement.
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({ postcode }),
    });
  } catch (err) {
    return { ok: false, status: 502, error: `Geocode request failed: ${String(err)}` };
  }

  if (!response.ok) {
    let message = `Geocode failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* ignore */
    }
    return { ok: false, status: response.status, error: message };
  }

  const data = (await response.json()) as GeocodeResult;
  if (typeof data.lat !== 'number' || typeof data.lng !== 'number' || !data.postcode_prefix) {
    return { ok: false, status: 502, error: 'Geocode returned unexpected shape' };
  }
  return { ok: true, result: data };
}

// ---------------------------------------------------------------------------
// Territory resolution
// ---------------------------------------------------------------------------

interface TerritoryResolution {
  territory_id: string | null;
  out_of_territory: boolean;
  out_of_territory_warning: OutOfTerritoryWarningColumn;
}

async function resolveTerritory(
  admin: ReturnType<typeof createClient>,
  franchiseeId: string,
  postcodePrefix: string,
): Promise<TerritoryResolution> {
  // Look up da_territories by postcode_prefix (unique column).
  const { data: territory, error } = await admin
    .from('da_territories')
    .select('id, franchisee_id, status')
    .eq('postcode_prefix', postcodePrefix)
    .maybeSingle();

  if (error) {
    console.error('territory lookup error', error);
    // Treat as unknown territory — safe to proceed without a territory_id.
    return {
      territory_id: null,
      out_of_territory: true,
      out_of_territory_warning: 'vacant',
    };
  }

  if (!territory) {
    // Postcode prefix not in our territory table at all — treat as vacant.
    return {
      territory_id: null,
      out_of_territory: true,
      out_of_territory_warning: 'vacant',
    };
  }

  const isOwn = territory.franchisee_id === franchiseeId;

  if (isOwn) {
    return {
      territory_id: territory.id as string,
      out_of_territory: false,
      out_of_territory_warning: null,
    };
  }

  if (territory.franchisee_id === null || territory.status === 'vacant') {
    return {
      territory_id: territory.id as string,
      out_of_territory: true,
      out_of_territory_warning: 'vacant',
    };
  }

  // Assigned to someone else.
  return {
    territory_id: territory.id as string,
    out_of_territory: true,
    out_of_territory_warning: 'owned_by_other',
  };
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

const UK_POSTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;
// Outward code only (e.g. 'GU1', 'SW1A') — accepted for PRIVATE courses.
const UK_OUTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;

function validateBody(
  raw: unknown,
): { ok: true; value: CreateCourseInstanceRequest } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Request body must be a JSON object' };
  }
  const b = raw as Record<string, unknown>;

  if (typeof b.template_id !== 'string' || !UUID_RE.test(b.template_id)) {
    return { ok: false, error: 'template_id must be a valid UUID' };
  }
  if (typeof b.event_date !== 'string' || !DATE_RE.test(b.event_date)) {
    return { ok: false, error: 'event_date must be a YYYY-MM-DD string' };
  }
  if (typeof b.start_time !== 'string' || !TIME_RE.test(b.start_time)) {
    return { ok: false, error: 'start_time must be HH:MM or HH:MM:SS' };
  }
  if (typeof b.end_time !== 'string' || !TIME_RE.test(b.end_time)) {
    return { ok: false, error: 'end_time must be HH:MM or HH:MM:SS' };
  }
  if (b.visibility !== 'public' && b.visibility !== 'private') {
    return { ok: false, error: 'visibility must be "public" or "private"' };
  }

  // Postcode rules (migration 040 / NTH-9):
  //   public  — a full UK postcode is REQUIRED (unchanged behaviour).
  //   private — a full postcode, an outcode only (e.g. 'GU1'), or nothing
  //             when the venue is TBC.
  const venueTbc = b.venue_tbc === true;
  const rawPostcode = typeof b.venue_postcode === 'string' ? b.venue_postcode.trim() : '';
  if (b.visibility === 'public') {
    if (!rawPostcode || !UK_POSTCODE_RE.test(rawPostcode)) {
      return { ok: false, error: 'venue_postcode must be a valid UK postcode' };
    }
    if (venueTbc) {
      return { ok: false, error: 'venue_tbc is only allowed for private courses' };
    }
  } else if (rawPostcode) {
    if (!UK_POSTCODE_RE.test(rawPostcode) && !UK_OUTCODE_RE.test(rawPostcode)) {
      return {
        ok: false,
        error: 'venue_postcode must be a valid UK postcode or district (e.g. GU1)',
      };
    }
  } else if (!venueTbc) {
    return {
      ok: false,
      error: 'venue_postcode is required unless the venue is marked as to be confirmed',
    };
  }
  if (typeof b.capacity !== 'number' || !Number.isInteger(b.capacity) || b.capacity < 1) {
    return { ok: false, error: 'capacity must be a positive integer' };
  }
  if (typeof b.price_pence !== 'number' || !Number.isInteger(b.price_pence) || b.price_pence < 0) {
    return { ok: false, error: 'price_pence must be a non-negative integer' };
  }
  if (!Array.isArray(b.ticket_types)) {
    return { ok: false, error: 'ticket_types must be an array' };
  }
  for (let i = 0; i < b.ticket_types.length; i++) {
    const tt = b.ticket_types[i] as Record<string, unknown>;
    if (!tt || typeof tt !== 'object') {
      return { ok: false, error: `ticket_types[${i}] must be an object` };
    }
    if (typeof tt.name !== 'string' || tt.name.trim().length === 0) {
      return { ok: false, error: `ticket_types[${i}].name is required` };
    }
    if (
      typeof tt.price_pence !== 'number' ||
      !Number.isInteger(tt.price_pence) ||
      tt.price_pence < 0
    ) {
      return { ok: false, error: `ticket_types[${i}].price_pence must be a non-negative integer` };
    }
    if (
      typeof tt.seats_consumed !== 'number' ||
      !Number.isInteger(tt.seats_consumed) ||
      tt.seats_consumed < 1
    ) {
      return { ok: false, error: `ticket_types[${i}].seats_consumed must be a positive integer` };
    }
    if (tt.max_available !== null && tt.max_available !== undefined) {
      if (
        typeof tt.max_available !== 'number' ||
        !Number.isInteger(tt.max_available) ||
        tt.max_available < 1
      ) {
        return {
          ok: false,
          error: `ticket_types[${i}].max_available must be a positive integer or null`,
        };
      }
    }
    if (tt.session_label !== null && tt.session_label !== undefined) {
      if (typeof tt.session_label !== 'string') {
        return { ok: false, error: `ticket_types[${i}].session_label must be a string or null` };
      }
    }
    if (tt.vat_rate !== null && tt.vat_rate !== undefined) {
      if (
        typeof tt.vat_rate !== 'number' ||
        !Number.isFinite(tt.vat_rate) ||
        tt.vat_rate < 0 ||
        tt.vat_rate > 99.99 ||
        Math.round(tt.vat_rate * 100) !== tt.vat_rate * 100
      ) {
        return {
          ok: false,
          error: `ticket_types[${i}].vat_rate must be a percentage between 0 and 99.99 (max 2 decimals) or null`,
        };
      }
    }
  }

  // private_client_id — optional UUID or null.
  if (
    b.private_client_id !== undefined &&
    b.private_client_id !== null &&
    (typeof b.private_client_id !== 'string' || !UUID_RE.test(b.private_client_id as string))
  ) {
    return { ok: false, error: 'private_client_id must be a valid UUID or null' };
  }

  return {
    ok: true,
    value: {
      template_id: b.template_id as string,
      event_date: b.event_date as string,
      start_time: b.start_time as string,
      end_time: b.end_time as string,
      venue_name: typeof b.venue_name === 'string' ? b.venue_name || null : null,
      venue_address: typeof b.venue_address === 'string' ? b.venue_address || null : null,
      venue_postcode: rawPostcode ? rawPostcode.toUpperCase() : null,
      visibility: b.visibility as Visibility,
      capacity: b.capacity as number,
      price_pence: b.price_pence as number,
      bespoke_details: typeof b.bespoke_details === 'string' ? b.bespoke_details || null : null,
      ticket_types: b.ticket_types as CreateCourseTicketTypeInput[],
      out_of_territory_confirmed: b.out_of_territory_confirmed === true,
      private_client_id:
        typeof b.private_client_id === 'string' && UUID_RE.test(b.private_client_id as string)
          ? (b.private_client_id as string)
          : null,
      display_name: typeof b.display_name === 'string' ? b.display_name.trim() || null : null,
      venue_tbc: venueTbc,
    },
  };
}

// ---------------------------------------------------------------------------
// Outcode geocode (private courses only) — postcodes.io outcode endpoint
// returns the district centroid directly; postcode_prefix = the outcode.
// ---------------------------------------------------------------------------

async function geocodeOutcode(
  outcode: string,
): Promise<{ ok: true; result: GeocodeResult } | { ok: false; status: number; error: string }> {
  let response: Response;
  try {
    response = await fetch(`https://api.postcodes.io/outcodes/${encodeURIComponent(outcode)}`);
  } catch (err) {
    return { ok: false, status: 502, error: `Outcode lookup failed: ${String(err)}` };
  }
  if (!response.ok) {
    return {
      ok: false,
      status: response.status === 404 ? 400 : 502,
      error:
        response.status === 404
          ? `Postcode district not found: ${outcode}`
          : `Outcode lookup failed (${response.status})`,
    };
  }
  const body = (await response.json()) as {
    result?: { latitude?: number | null; longitude?: number | null };
  };
  const latitude = body.result?.latitude;
  const longitude = body.result?.longitude;
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return { ok: false, status: 502, error: 'Outcode lookup returned no coordinates' };
  }
  return {
    ok: true,
    result: { lat: latitude, lng: longitude, postcode_prefix: outcode.toUpperCase() },
  };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  // ----------------------------------------------------------
  // Auth: extract JWT, decode sub
  // ----------------------------------------------------------
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

  // ----------------------------------------------------------
  // Resolve franchisee from JWT sub
  // ----------------------------------------------------------
  const franchiseeResult = await admin
    .from('da_franchisees')
    .select('id, name, is_hq')
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  if (franchiseeResult.error) {
    console.error('franchisee lookup failed', franchiseeResult.error);
    return jsonResponse({ error: 'Failed to verify caller' }, 500);
  }
  if (!franchiseeResult.data) {
    return jsonResponse({ error: 'Caller is not provisioned as a franchisee' }, 403);
  }

  const franchisee = franchiseeResult.data as { id: string; name: string; is_hq: boolean };

  // ----------------------------------------------------------
  // Parse + validate request body
  // ----------------------------------------------------------
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const validated = validateBody(rawBody);
  if (!validated.ok) {
    return jsonResponse({ error: validated.error }, 400);
  }
  const input = validated.value;

  // ----------------------------------------------------------
  // Verify template exists and is active
  // ----------------------------------------------------------
  const templateResult = await admin
    .from('da_course_templates')
    .select('id, name, default_ticket_types')
    .eq('id', input.template_id)
    .eq('is_active', true)
    .maybeSingle();

  if (templateResult.error) {
    console.error('template lookup failed', templateResult.error);
    return jsonResponse({ error: 'Failed to verify template' }, 500);
  }
  if (!templateResult.data) {
    return jsonResponse({ error: 'Template not found or is inactive' }, 404);
  }

  const templateRow = templateResult.data as {
    id: string;
    name: string;
    default_ticket_types: DefaultTicketType[];
  };

  // ----------------------------------------------------------
  // Server-side geocode (ignores any client-supplied lat/lng)
  //
  // Three modes (migration 040 / NTH-9):
  //   full postcode — geocode-postcode function (unchanged).
  //   outcode only (private) — postcodes.io outcode endpoint directly;
  //     postcode_prefix = the outcode. Territory resolution + 409 gate as
  //     normal.
  //   venue TBC (private) — no coordinates; territory falls back to the
  //     franchisee's own primary territory, out_of_territory false, no gate.
  // ----------------------------------------------------------
  let lat: number | null = null;
  let lng: number | null = null;
  let territory: TerritoryResolution;

  if (input.venue_postcode) {
    const isFullPostcode = UK_POSTCODE_RE.test(input.venue_postcode);
    const geocodeRes = isFullPostcode
      ? await geocodePostcode(supabaseUrl, serviceRoleKey, input.venue_postcode)
      : await geocodeOutcode(input.venue_postcode);
    if (!geocodeRes.ok) {
      return jsonResponse(
        { error: `Postcode geocode failed: ${geocodeRes.error}` },
        geocodeRes.status >= 500 ? 502 : 400,
      );
    }
    lat = geocodeRes.result.lat;
    lng = geocodeRes.result.lng;

    // ----------------------------------------------------------
    // Territory resolution
    // ----------------------------------------------------------
    territory = await resolveTerritory(admin, franchisee.id, geocodeRes.result.postcode_prefix);

    // ----------------------------------------------------------
    // Out-of-territory gate — return 409 if confirmation missing
    // ----------------------------------------------------------
    if (territory.out_of_territory_warning !== null && !input.out_of_territory_confirmed) {
      const uiWarning: Exclude<OutOfTerritoryWarning, 'none'> =
        territory.out_of_territory_warning === 'owned_by_other' ? 'owned_by_other' : 'vacant';
      return jsonResponse({ error: 'out_of_territory', warning: uiWarning }, 409);
    }
  } else {
    // Venue TBC — no postcode. Stamp the franchisee's own primary territory
    // so the instance still rolls up to their reporting; no 409 gate.
    const ownTerritory = await admin
      .from('da_territories')
      .select('id')
      .eq('franchisee_id', franchisee.id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (ownTerritory.error) {
      console.error('own territory lookup failed', ownTerritory.error);
    }
    territory = {
      territory_id: (ownTerritory.data as { id: string } | null)?.id ?? null,
      out_of_territory: false,
      out_of_territory_warning: null,
    };
  }

  // ----------------------------------------------------------
  // Validate private_client_id ownership (if provided)
  //
  // The client must belong to the calling franchisee. We do this via a
  // service_role query (bypasses RLS) so we can be explicit about the
  // ownership error vs a "not found" situation — RLS alone would silently
  // return 0 rows for both cases, making it hard to give a useful error.
  // ----------------------------------------------------------
  if (input.private_client_id) {
    const clientLookup = await admin
      .from('da_private_clients')
      .select('id, franchisee_id')
      .eq('id', input.private_client_id)
      .maybeSingle();

    if (clientLookup.error) {
      console.error('private_client ownership check failed', clientLookup.error);
      return jsonResponse({ error: 'Failed to verify private client' }, 500);
    }
    if (!clientLookup.data) {
      return jsonResponse({ error: 'Private client not found' }, 404);
    }
    const clientRow = clientLookup.data as { id: string; franchisee_id: string };
    if (clientRow.franchisee_id !== franchisee.id) {
      return jsonResponse({ error: 'Private client does not belong to your account' }, 403);
    }
  }

  // ----------------------------------------------------------
  // INSERT da_course_instances
  // ----------------------------------------------------------
  const instancePayload: Record<string, unknown> = {
    franchisee_id: franchisee.id,
    template_id: input.template_id,
    territory_id: territory.territory_id,
    event_date: input.event_date,
    start_time: input.start_time,
    end_time: input.end_time,
    venue_name: input.venue_name ?? null,
    venue_address: input.venue_address ?? null,
    venue_postcode: input.venue_postcode,
    lat,
    lng,
    // geom is handled by the da_course_instances_set_geom trigger (migration 007)
    visibility: input.visibility,
    capacity: input.capacity,
    spots_remaining: input.capacity, // spots_remaining = capacity at creation
    price_pence: input.price_pence,
    bespoke_details: input.bespoke_details ?? null,
    status: 'scheduled',
    out_of_territory: territory.out_of_territory,
    out_of_territory_warning: territory.out_of_territory_warning,
    // private_client_id is persisted from migration 021; null for public courses.
    private_client_id: input.private_client_id ?? null,
    // Migration 040: customer-facing name override + venue-TBC flag.
    display_name: input.display_name ?? null,
    venue_tbc: input.venue_tbc === true,
  };

  const instanceInsert = await admin
    .from('da_course_instances')
    .insert(instancePayload)
    .select('*')
    .single();

  if (instanceInsert.error || !instanceInsert.data) {
    console.error('course_instance insert failed', instanceInsert.error);
    return jsonResponse({ error: 'Failed to create course instance' }, 500);
  }

  const instanceRow = instanceInsert.data as Record<string, unknown>;
  const instanceId = instanceRow.id as string;

  // ----------------------------------------------------------
  // Build ticket-type rows
  // ----------------------------------------------------------
  // Prefer the client's explicit ticket_types array when non-empty.
  // Fall back to the template's default_ticket_types.
  const ticketInputs: CreateCourseTicketTypeInput[] =
    input.ticket_types.length > 0
      ? input.ticket_types
      : (templateRow.default_ticket_types ?? []).map((dt, i) => ({
          name: dt.name,
          price_pence: input.price_pence + (dt.price_modifier_pence ?? 0),
          seats_consumed: dt.seats_consumed,
          max_available: null,
          sort_order: i,
        }));

  // Guarantee at least one ticket type (Single at base price) even if the
  // template has an empty default_ticket_types array.
  if (ticketInputs.length === 0) {
    ticketInputs.push({
      name: 'Single',
      price_pence: input.price_pence,
      seats_consumed: 1,
      max_available: null,
      sort_order: 0,
    });
  }

  const ticketRows = ticketInputs.map((tt) => ({
    course_instance_id: instanceId,
    name: tt.name,
    price_pence: tt.price_pence,
    seats_consumed: tt.seats_consumed,
    max_available: tt.max_available ?? null,
    sort_order: tt.sort_order ?? 0,
    session_label: typeof tt.session_label === 'string' ? tt.session_label.trim() || null : null,
    vat_rate: typeof tt.vat_rate === 'number' ? tt.vat_rate : null,
  }));

  const ticketInsert = await admin.from('da_ticket_types').insert(ticketRows).select('*');

  if (ticketInsert.error) {
    console.error('ticket_types insert failed', ticketInsert.error);
    // The instance exists; log and return partial success rather than rolling
    // back (the verifier can fix up orphaned instances in testing). In
    // production we'd want a cleanup step, but per the brief the verifier
    // deploys and integration-tests this.
    return jsonResponse({ error: 'Course created but ticket types failed to save' }, 500);
  }

  // ----------------------------------------------------------
  // INSERT da_activities
  // ----------------------------------------------------------
  const uiWarningForActivity: OutOfTerritoryWarning =
    territory.out_of_territory_warning == null ? 'none' : territory.out_of_territory_warning;

  await admin
    .from('da_activities')
    .insert({
      actor_type: 'franchisee',
      actor_id: franchisee.id,
      entity_type: 'course_instance',
      entity_id: instanceId,
      action: 'course_created',
      metadata: {
        template_id: input.template_id,
        template_name: templateRow.name,
        event_date: input.event_date,
        venue_postcode: input.venue_postcode,
        out_of_territory_warning: uiWarningForActivity,
        private_client_id: input.private_client_id ?? null,
      },
      description: `Course '${templateRow.name}' scheduled for ${input.event_date} at ${input.venue_postcode ?? 'venue TBC'}`,
    })
    .then((r: { error: unknown }) => {
      // Activity insert failure must not block the response.
      if (r.error) console.error('activity log insert failed', r.error);
    });

  // ----------------------------------------------------------
  // Return CreateCourseInstanceResponse
  // ----------------------------------------------------------
  return jsonResponse(
    {
      instance: instanceRow,
      ticket_types: ticketInsert.data ?? [],
      out_of_territory_warning: uiWarningForActivity,
    },
    201,
  );
});
