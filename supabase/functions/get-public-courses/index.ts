// supabase/functions/get-public-courses/index.ts
//
// PUBLIC (no auth) — the booking widget's read API. PRD §5.2.
//
// POST {
//   postcode?: string,                 // a UK postcode OR (round 2, G8) a town/area name
//   location?: string,                 // explicit free-text town/area alias for `postcode`
//   lat?: number, lng?: number,        // pre-resolved (skips geocode)
//   radius_miles?: number,             // default from da_settings.course_finder_radius_miles
//   franchisee_id?: string,            // optional: filter to one franchisee's courses
//   limit?: number
// }
// -> {
//   courses: Array<CourseCard>,        // each carries sold_out + spots_remaining
//   territory_status: 'active' | 'vacant' | 'none',
//   suggest_interest_form: boolean,
//   resolved_location?: string         // the place name we matched a town search to
// }
//
// All PUBLIC, SCHEDULED courses are returned, INCLUDING sold-out ones (round 2,
// G4: Feola runs waiting lists and a full schedule reads better than a thin one,
// so a full class stays visible, marked sold out, with booking disabled). The
// `spots_remaining > 0` predicate was dropped from find_nearest_courses in
// migration 048.
//
// Geocoding is done server-side via postcodes.io (free, keyless — replaced
// Google Geocoding 2026-07-30 after Google Cloud billing lapsed). A search term
// that is not a valid postcode is resolved as a place name via the same API's
// /places endpoint (round 2, G8). Best-effort per-IP rate limit (20/min) per
// PRD §12.5.

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
  /** Free-text town/area (G8). An alias for `postcode` — either field accepts either kind. */
  location?: unknown;
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
    display_name: r.display_name ?? null,
    template_name: r.template_name ?? r.template?.name ?? null,
    template_slug: r.template_slug ?? r.template?.slug ?? null,
    // Class content + suitability, shown before booking (Jenni, M3 feedback §1).
    template_description: r.template_description ?? r.template?.description ?? null,
    // The franchisee's own wording for this one class (G1, migration 045).
    // Absent until that migration lands, hence the `?? null` — the widget falls
    // back to template_description whenever it is null or blank.
    description_override: r.description_override ?? null,
    age_range: r.age_range ?? r.template?.age_range ?? null,
    event_date: r.event_date,
    start_time: r.start_time,
    end_time: r.end_time,
    venue_name: r.venue_name,
    venue_postcode: r.venue_postcode,
    distance_miles: r.distance_miles == null ? null : Math.round(r.distance_miles * 10) / 10,
    franchisee_name: r.franchisee_name ?? r.franchisee?.name ?? null,
    capacity: r.capacity,
    spots_remaining: r.spots_remaining,
    // Explicit so the widget never has to infer "full" from a number that could
    // in principle go negative (G4).
    sold_out: Number(r.spots_remaining) <= 0,
    ticket_types: Array.isArray(r.ticket_types) ? r.ticket_types : [],
  };
}

// postcodes.io /places returns matches in no useful order, so taking the first
// is wrong: "Guildford" returns a suburban area in Pembrokeshire ahead of the
// Surrey town, which sent customers 200 miles west and found nothing. Rank an
// exact name match first, then by how substantial the settlement is.
const PLACE_TYPE_RANK: Record<string, number> = {
  City: 0,
  Town: 1,
  Village: 2,
  'Suburban Area': 3,
  Hamlet: 4,
  'Other Settlement': 5,
};

function pickBestPlace(places: any[], query: string): any | null {
  if (!Array.isArray(places) || places.length === 0) return null;
  const wanted = query.trim().toLowerCase();
  const scored = places
    .filter((p) => typeof p?.latitude === 'number' && typeof p?.longitude === 'number')
    .map((p, i) => ({
      place: p,
      exact: String(p.name_1 ?? '').toLowerCase() === wanted ? 0 : 1,
      type: PLACE_TYPE_RANK[String(p.local_type ?? '')] ?? 6,
      order: i,
    }));
  if (scored.length === 0) return null;
  scored.sort((a, b) => a.exact - b.exact || a.type - b.type || a.order - b.order);
  return scored[0].place;
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
    // description_override (migration 045) may not exist yet — a select naming a
    // missing column is a hard 400 from PostgREST, so try it first and retry
    // without it rather than breaking every /book/:token page in between.
    const columns = (withOverride: boolean) =>
      `id, booking_token, display_name,${withOverride ? ' description_override,' : ''} event_date, start_time, end_time, venue_name, venue_postcode, capacity, spots_remaining, status, visibility,
         template:da_course_templates ( name, slug, description, age_range ),
         franchisee:da_franchisees ( name ),
         ticket_types:da_ticket_types ( id, name, price_pence, seats_consumed, session_label, vat_rate )`;
    let single = await admin
      .from('da_course_instances')
      .select(columns(true))
      .eq('booking_token', bookingToken)
      .maybeSingle();
    if (single.error) {
      single = await admin
        .from('da_course_instances')
        .select(columns(false))
        .eq('booking_token', bookingToken)
        .maybeSingle();
    }
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

  // --- Search term: a postcode OR a town/area name (G8) ---------------------
  // `location` and `postcode` are interchangeable: the WordPress embeds and the
  // widget have always sent `postcode`, and customers now type towns into that
  // same box, so both fields accept both kinds of input.
  const searchTerm =
    (typeof body.location === 'string' ? body.location.trim() : '') ||
    (typeof body.postcode === 'string' ? body.postcode.trim() : '');

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // --- Franchisee schedule: franchisee_id with no search term ----------------
  // The Book Online button on a trainer's page of the website opens the widget
  // scoped to that trainer, and the visitor is already on the trainer's page —
  // asking for a postcode before showing anything is friction with no purpose.
  // So: no search term + franchisee_id = the trainer's upcoming public
  // classes, soonest first. Sold-out classes are kept (G4), same as the search
  // path. A call with neither search term nor franchisee_id still 400s below.
  const franchiseeParam = typeof body.franchisee_id === 'string' ? body.franchisee_id.trim() : '';
  if (!searchTerm && franchiseeParam) {
    let fid = franchiseeParam;
    if (!UUID_RE.test(fid)) {
      const byNumber = await admin
        .from('da_franchisees')
        .select('id')
        .eq('number', fid)
        .maybeSingle();
      if (!byNumber.data) {
        // Unknown number → an empty schedule, never every franchisee's classes.
        return jsonResponse(
          { courses: [], territory_status: 'none', suggest_interest_form: false },
          200,
        );
      }
      fid = (byNumber.data as any).id;
    }
    const schedule = await admin
      .from('da_course_instances')
      .select(
        `id, booking_token, display_name, description_override, event_date, start_time, end_time, venue_name, venue_postcode, capacity, spots_remaining,
         template:da_course_templates ( name, slug, description, age_range ),
         franchisee:da_franchisees ( name ),
         ticket_types:da_ticket_types ( id, name, price_pence, seats_consumed, session_label, vat_rate )`,
      )
      .eq('franchisee_id', fid)
      .eq('visibility', 'public')
      .eq('status', 'scheduled')
      .gte('event_date', londonToday())
      .order('event_date', { ascending: true })
      .order('start_time', { ascending: true })
      .limit(50);
    if (schedule.error) {
      console.error('franchisee schedule lookup failed', schedule.error);
      return jsonResponse({ error: 'Could not load classes right now' }, 500);
    }
    return jsonResponse(
      {
        courses: ((schedule.data ?? []) as any[]).map(toCard),
        territory_status: 'none',
        suggest_interest_form: false,
      },
      200,
    );
  }

  if (!searchTerm) {
    return jsonResponse({ error: 'A postcode or town is required' }, 400);
  }
  const isPostcode = UK_POSTCODE_RE.test(searchTerm);
  // Only a real postcode has a territory prefix — a town search leaves the
  // territory lookup to the postcode resolved from the matched place.
  let prefix = isPostcode ? postcodePrefix(searchTerm) : '';

  // franchisee_id accepts EITHER the internal UUID or the human franchisee
  // number ("0042") — the WordPress embeds use the number, so resolve it.
  let franchiseeId = typeof body.franchisee_id === 'string' ? body.franchisee_id.trim() : null;
  if (franchiseeId && !UUID_RE.test(franchiseeId)) {
    const byNumber = await admin
      .from('da_franchisees')
      .select('id')
      .eq('number', franchiseeId)
      .maybeSingle();
    // Unknown number → keep the unmatchable string so the filter returns
    // nothing (never silently fall back to ALL franchisees' courses).
    franchiseeId = (byNumber.data as any)?.id ?? franchiseeId;
  }
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
  // Two postcodes.io endpoints, both free and keyless:
  //   /postcodes/{pc} -> { result: { latitude, longitude, ... } }
  //   /places?q=&limit=1 -> { result: [ { name_1, outcode, latitude, longitude } ] }
  // The places endpoint returns an ARRAY (verified against the live API), and a
  // no-match is a 200 with an empty array, not a 404.
  let lat = typeof body.lat === 'number' ? body.lat : NaN;
  let lng = typeof body.lng === 'number' ? body.lng : NaN;
  let resolvedLocation: string | null = null;
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    if (isPostcode) {
      try {
        const geo = await fetch(
          `https://api.postcodes.io/postcodes/${encodeURIComponent(searchTerm)}`,
        );
        if (geo.status === 404) {
          return jsonResponse({ error: `Could not locate postcode ${searchTerm}` }, 404);
        }
        const payload = (await geo.json()) as any;
        const result = payload?.result;
        if (
          !geo.ok ||
          typeof result?.latitude !== 'number' ||
          typeof result?.longitude !== 'number'
        ) {
          return jsonResponse({ error: `Could not locate postcode ${searchTerm}` }, 404);
        }
        lat = result.latitude;
        lng = result.longitude;
      } catch (err) {
        console.error('geocode failed', err);
        return jsonResponse({ error: 'Could not look up that postcode right now' }, 502);
      }
    } else {
      // Town/area search (G8).
      try {
        const geo = await fetch(
          `https://api.postcodes.io/places?q=${encodeURIComponent(searchTerm)}&limit=10`,
        );
        const payload = (await geo.json()) as any;
        const place = pickBestPlace(
          Array.isArray(payload?.result) ? payload.result : [],
          searchTerm,
        );
        if (
          !geo.ok ||
          !place ||
          typeof place.latitude !== 'number' ||
          typeof place.longitude !== 'number'
        ) {
          return jsonResponse(
            { error: `We could not find ${searchTerm}. Please try a postcode.` },
            404,
          );
        }
        lat = place.latitude;
        lng = place.longitude;
        resolvedLocation =
          typeof place.name_1 === 'string' && place.name_1.trim()
            ? place.name_1.trim()
            : searchTerm;
        // The place's outcode ("RG1") is the territory prefix for this search.
        if (typeof place.outcode === 'string' && place.outcode.trim()) {
          prefix = place.outcode.trim().toUpperCase();
        }
      } catch (err) {
        console.error('place lookup failed', err);
        return jsonResponse({ error: 'Could not look up that place right now' }, 502);
      }
    }
  }

  // --- Territory status ------------------------------------------------------
  // `prefix` is empty only when a town search was handed pre-resolved lat/lng,
  // so there is no outcode to look up — that is 'none', not a wasted query.
  const territory = prefix
    ? await admin
        .from('da_territories')
        .select('status, franchisee:da_franchisees ( name, business_name, email, phone )')
        .eq('postcode_prefix', prefix)
        .maybeSingle()
    : { data: null };
  const territoryStatus: 'active' | 'vacant' | 'none' = territory.data
    ? (territory.data as any).status === 'active'
      ? 'active'
      : 'vacant'
    : 'none';
  // The searched area's own franchisee (active territories only). The widget
  // uses this when a search finds nothing: instead of a dead-end "check back
  // soon", the customer gets the local trainer's contact details for a bespoke
  // class. These are the trainer's public business details, the same ones on
  // their page of the website.
  const territoryFranchisee =
    territoryStatus === 'active' ? ((territory.data as any).franchisee ?? null) : null;
  const localFranchisee = territoryFranchisee
    ? {
        name: territoryFranchisee.name ?? null,
        business_name: territoryFranchisee.business_name ?? null,
        email: territoryFranchisee.email ?? null,
        phone: territoryFranchisee.phone ?? null,
      }
    : null;

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

  // Public and scheduled. Optional franchisee filter. Sold-out classes are
  // DELIBERATELY kept (G4) — they render marked "Sold out" with booking
  // disabled, in their normal date/distance position.
  const rows = ((nearest.data ?? []) as any[]).filter(
    (r) =>
      r.visibility === 'public' &&
      r.status === 'scheduled' &&
      (!franchiseeId || r.franchisee_id === franchiseeId),
  );

  // toCard already resolves description_override, sold_out and the rounded
  // distance — the RPC's column names match the fields it reads.
  const courses = rows.slice(0, limit).map(toCard);

  // Suggest the interest form when the searched area has no active franchisee
  // and the search found nothing bookable. A schedule made up entirely of
  // sold-out classes still counts as "nothing they can book", so the interest
  // form stays on offer. (Group-size threshold is applied client-side per
  // da_settings.interest_form_min_attendees.)
  const bookable = courses.filter((c) => !c.sold_out);
  const suggestInterestForm = bookable.length === 0 && territoryStatus !== 'active';

  return jsonResponse(
    {
      courses,
      territory_status: territoryStatus,
      suggest_interest_form: suggestInterestForm,
      ...(resolvedLocation ? { resolved_location: resolvedLocation } : {}),
      ...(localFranchisee ? { local_franchisee: localFranchisee } : {}),
    },
    200,
  );
});
