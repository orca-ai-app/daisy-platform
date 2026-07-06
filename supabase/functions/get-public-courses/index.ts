// supabase/functions/get-public-courses/index.ts
//
// PUBLIC (no auth) — the booking widget's read API. PRD §5.2.
//
// POST {
//   postcode: string,
//   lat?: number, lng?: number,        // pre-resolved (skips geocode)
//   radius_miles?: number,             // default from da_settings.course_finder_radius_miles
//   franchisee_id?: string,            // optional: filter to one franchisee's courses
//   limit?: number
// }
// -> {
//   courses: Array<CourseCard>,
//   territory_status: 'active' | 'vacant' | 'none',
//   suggest_interest_form: boolean
// }
//
// Only PUBLIC, SCHEDULED courses with spots remaining are returned. Geocoding is
// done server-side with the server-restricted GOOGLE_MAPS_API_KEY (never exposed
// to the browser). Best-effort per-IP rate limit (20/min) per PRD §12.5.

// deno-lint-ignore-file no-explicit-any

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const UK_POSTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;

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

function postcodePrefix(postcode: string): string {
  const cleaned = postcode.trim().toUpperCase().replace(/\s+/g, '');
  if (cleaned.length < 5) return cleaned;
  return cleaned.slice(0, cleaned.length - 3);
}

// --- Best-effort per-isolate rate limit (PRD §12.5: 20 req/min/IP) -----------
// In-memory, per-isolate — not bulletproof across cold starts/regions, but
// throttles the common abuse case. A CDN/WAF is the real defence (noted in PRD).
const RATE_LIMIT = 20;
const WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > RATE_LIMIT;
}

interface RequestBody {
  postcode?: unknown;
  lat?: unknown;
  lng?: unknown;
  radius_miles?: unknown;
  franchisee_id?: unknown;
  limit?: unknown;
  booking_token?: unknown;
  instructor_number?: unknown;
  on_date?: unknown;
}

// Shape one da_course_instances row (+ joined names + ticket types) into a card.
function toCard(r: any) {
  return {
    id: r.id,
    booking_token: r.booking_token ?? null,
    template_name: r.template_name ?? r.template?.name ?? null,
    template_slug: r.template_slug ?? r.template?.slug ?? null,
    event_date: r.event_date,
    start_time: r.start_time,
    end_time: r.end_time,
    venue_name: r.venue_name,
    venue_postcode: r.venue_postcode,
    distance_miles: r.distance_miles == null ? null : Math.round(r.distance_miles * 10) / 10,
    franchisee_name: r.franchisee_name ?? r.franchisee?.name ?? null,
    capacity: r.capacity,
    spots_remaining: r.spots_remaining,
    ticket_types: Array.isArray(r.ticket_types) ? r.ticket_types : [],
  };
}

// Today's date in Europe/London ('YYYY-MM-DD') — a 23:30 UTC submission in BST
// is already "tomorrow" in London.
function londonToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    req.headers.get('cf-connecting-ip') ||
    'unknown';
  if (rateLimited(ip)) {
    return jsonResponse({ error: 'Too many requests. Please slow down.' }, 429);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const googleKey = Deno.env.get('GOOGLE_MAPS_API_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Server misconfigured' }, 500);
  }
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  // --- booking_token path: resolve a single course (the /book/:token page) ---
  const bookingToken = typeof body.booking_token === 'string' ? body.booking_token.trim() : '';
  if (bookingToken) {
    const single = await admin
      .from('da_course_instances')
      .select(
        `id, booking_token, event_date, start_time, end_time, venue_name, venue_postcode, capacity, spots_remaining, status, visibility,
         template:da_course_templates ( name, slug ),
         franchisee:da_franchisees ( name ),
         ticket_types:da_ticket_types ( id, name, price_pence, seats_consumed )`,
      )
      .eq('booking_token', bookingToken)
      .maybeSingle();
    if (single.error) {
      console.error('booking_token lookup failed', single.error);
      return jsonResponse({ error: 'Could not load that course' }, 500);
    }
    if (!single.data || (single.data as any).status !== 'scheduled') {
      return jsonResponse(
        { courses: [], territory_status: 'none', suggest_interest_form: false },
        200,
      );
    }
    return jsonResponse(
      { courses: [toCard(single.data)], territory_status: 'none', suggest_interest_form: false },
      200,
    );
  }

  // --- instructor_number path: the medical form's STATIC-QR resolver ---------
  // "Which class is instructor NNNN running on <date>?" (default: today,
  // Europe/London). Includes PRIVATE classes — attendees at a private class
  // still fill the medical form, and the response only reveals what anyone
  // standing in the room already knows (class name, time, venue).
  const instructorNumber =
    typeof body.instructor_number === 'string' ? body.instructor_number.trim() : '';
  if (instructorNumber) {
    const onDate =
      typeof body.on_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.on_date)
        ? body.on_date
        : londonToday();
    const fr = await admin
      .from('da_franchisees')
      .select('id, name')
      .eq('number', instructorNumber)
      .maybeSingle();
    if (fr.error) {
      console.error('instructor lookup failed', fr.error);
      return jsonResponse({ error: 'Could not look up that instructor' }, 500);
    }
    if (!fr.data) {
      return jsonResponse(
        { courses: [], territory_status: 'none', suggest_interest_form: false },
        200,
      );
    }
    const day = await admin
      .from('da_course_instances')
      .select(
        `id, booking_token, event_date, start_time, end_time, venue_name, venue_postcode, capacity, spots_remaining,
         template:da_course_templates ( name, slug )`,
      )
      .eq('franchisee_id', (fr.data as any).id)
      .eq('status', 'scheduled')
      .eq('event_date', onDate)
      .order('start_time', { ascending: true });
    if (day.error) {
      console.error('instructor day lookup failed', day.error);
      return jsonResponse({ error: 'Could not look up classes' }, 500);
    }
    return jsonResponse(
      {
        // Inject the instructor's display name (the confirmation banner's
        // typo-catcher: wrong number → wrong name → attendee corrects it).
        courses: ((day.data ?? []) as any[]).map((r) => ({
          ...toCard(r),
          franchisee_name: (fr.data as any).name ?? null,
        })),
        territory_status: 'none',
        suggest_interest_form: false,
      },
      200,
    );
  }

  const postcode = typeof body.postcode === 'string' ? body.postcode.trim() : '';
  if (!postcode || !UK_POSTCODE_RE.test(postcode)) {
    return jsonResponse({ error: 'A valid UK postcode is required' }, 400);
  }
  const prefix = postcodePrefix(postcode);

  const franchiseeId = typeof body.franchisee_id === 'string' ? body.franchisee_id : null;
  const limit =
    typeof body.limit === 'number' && Number.isInteger(body.limit) && body.limit > 0
      ? Math.min(body.limit, 100)
      : 50;

  // --- Resolve radius from settings (fallback 15) ---------------------------
  let radiusMiles =
    typeof body.radius_miles === 'number' && body.radius_miles > 0 ? body.radius_miles : 0;
  if (!radiusMiles) {
    const setting = await admin
      .from('da_settings')
      .select('value')
      .eq('key', 'course_finder_radius_miles')
      .maybeSingle();
    radiusMiles = Number((setting.data as any)?.value) || 15;
  }

  // --- Resolve lat/lng (geocode if not provided) ----------------------------
  let lat = typeof body.lat === 'number' ? body.lat : NaN;
  let lng = typeof body.lng === 'number' ? body.lng : NaN;
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    if (!googleKey) {
      return jsonResponse({ error: 'Server misconfigured: geocoding unavailable' }, 500);
    }
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('address', postcode);
    url.searchParams.set('region', 'uk');
    url.searchParams.set('components', 'country:GB');
    url.searchParams.set('key', googleKey);
    try {
      const geo = await fetch(url.toString());
      const payload = (await geo.json()) as any;
      const loc = payload?.results?.[0]?.geometry?.location;
      if (payload.status !== 'OK' || !loc) {
        return jsonResponse({ error: `Could not locate postcode ${postcode}` }, 404);
      }
      lat = loc.lat;
      lng = loc.lng;
    } catch (err) {
      console.error('geocode failed', err);
      return jsonResponse({ error: 'Could not look up that postcode right now' }, 502);
    }
  }

  // --- Territory status ------------------------------------------------------
  const territory = await admin
    .from('da_territories')
    .select('status')
    .eq('postcode_prefix', prefix)
    .maybeSingle();
  const territoryStatus: 'active' | 'vacant' | 'none' = territory.data
    ? (territory.data as any).status === 'active'
      ? 'active'
      : 'vacant'
    : 'none';

  // --- Nearest courses (PostGIS) --------------------------------------------
  const nearest = await admin.rpc('find_nearest_courses', {
    search_lat: lat,
    search_lng: lng,
    radius_miles: radiusMiles,
  });
  if (nearest.error) {
    console.error('find_nearest_courses failed', nearest.error);
    return jsonResponse({ error: 'Could not search for courses right now' }, 500);
  }

  // Public, scheduled, with space. Optional franchisee filter.
  const rows = ((nearest.data ?? []) as any[]).filter(
    (r) =>
      r.visibility === 'public' &&
      r.status === 'scheduled' &&
      r.spots_remaining > 0 &&
      (!franchiseeId || r.franchisee_id === franchiseeId),
  );

  const courses = rows.slice(0, limit).map((r) => ({
    id: r.id,
    template_name: r.template_name,
    template_slug: r.template_slug,
    event_date: r.event_date,
    start_time: r.start_time,
    end_time: r.end_time,
    venue_name: r.venue_name,
    venue_postcode: r.venue_postcode,
    distance_miles: r.distance_miles == null ? null : Math.round(r.distance_miles * 10) / 10,
    franchisee_name: r.franchisee_name,
    capacity: r.capacity,
    spots_remaining: r.spots_remaining,
    ticket_types: Array.isArray(r.ticket_types) ? r.ticket_types : [],
  }));

  // Suggest the interest form when the searched area has no active franchisee
  // and the search found nothing. (Group-size threshold is applied client-side
  // per da_settings.interest_form_min_attendees.)
  const suggestInterestForm = courses.length === 0 && territoryStatus !== 'active';

  return jsonResponse(
    { courses, territory_status: territoryStatus, suggest_interest_form: suggestInterestForm },
    200,
  );
});
