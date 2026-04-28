// supabase/functions/geocode-postcode/index.ts
//
// POST { postcode: string } → { lat, lng, postcode_prefix, formatted_address }
//
// Reference: docs/PRD-technical.md §5.1 (auth required) and the M1 build plan
// Wave 1B brief.
//
// Behaviour:
//  - Requires an Authorization: Bearer <jwt> header. Any valid Supabase JWT
//    (anon, authenticated user, or service_role) is accepted — the function
//    is a thin server-side wrapper around the Geocoding API so we never
//    expose the server-restricted GOOGLE_MAPS_API_KEY to the browser.
//  - Validates the postcode with a permissive UK regex.
//  - Calls the Google Maps Geocoding API (region=uk).
//  - Inserts a da_activities audit row on every call (success or failure).
//  - Returns 4xx for bad input, 5xx for upstream failure.

// deno-lint-ignore-file no-explicit-any

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const UK_POSTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface GeocodeBody {
  postcode?: string;
}

interface SuccessResponse {
  lat: number;
  lng: number;
  postcode_prefix: string;
  formatted_address: string;
}

interface ErrorResponse {
  error: string;
}

function jsonResponse(
  body: SuccessResponse | ErrorResponse,
  status: number,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function postcodePrefix(postcode: string): string {
  // Outward code = chars before the space when the postcode is normalised
  // to a single-space format. "SW1A1AA" → "SW1A 1AA" → "SW1A".
  const cleaned = postcode.trim().toUpperCase().replace(/\s+/g, "");
  // The inward code is always the last three chars (digit + 2 letters).
  if (cleaned.length < 5) return cleaned;
  return cleaned.slice(0, cleaned.length - 3);
}

async function logActivity(
  supabaseUrl: string,
  serviceRoleKey: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  // Use service_role to bypass RLS for the audit insert.
  try {
    const client = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });
    // entity_id is required (NOT NULL UUID) per da_activities schema, so we
    // mint a synthetic UUID for system geocode events. metadata holds the
    // actual postcode for audit.
    await client.from("da_activities").insert({
      actor_type: "system",
      actor_id: null,
      entity_type: "geocode",
      entity_id: crypto.randomUUID(),
      action: "geocode",
      metadata,
      description: typeof metadata.postcode === "string"
        ? `Geocoded ${metadata.postcode}`
        : "Geocoded postcode",
    });
  } catch (err) {
    // Audit failure must never block the user response.
    console.error("activity log failed", err);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  // Auth: any Supabase JWT (Bearer token) is acceptable. We don't decode it —
  // Supabase Edge Function runtime does that when JWT verification is on. As a
  // belt-and-braces check we require the header to be present.
  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
    return jsonResponse({ error: "Authorization header required" }, 401);
  }

  // Env vars supplied by Supabase runtime / function secrets.
  const googleKey = Deno.env.get("GOOGLE_MAPS_API_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!googleKey) {
    return jsonResponse({ error: "Server misconfigured: GOOGLE_MAPS_API_KEY missing" }, 500);
  }

  let body: GeocodeBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const postcode = (body.postcode ?? "").trim();
  if (!postcode) {
    return jsonResponse({ error: "postcode is required" }, 400);
  }

  if (!UK_POSTCODE_RE.test(postcode)) {
    if (supabaseUrl && serviceRoleKey) {
      await logActivity(supabaseUrl, serviceRoleKey, { postcode, success: false, reason: "invalid_format" });
    }
    return jsonResponse({ error: "Invalid UK postcode" }, 400);
  }

  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", postcode);
  url.searchParams.set("region", "uk");
  url.searchParams.set("components", "country:GB");
  url.searchParams.set("key", googleKey);

  let upstream: Response;
  try {
    upstream = await fetch(url.toString());
  } catch (err) {
    console.error("upstream fetch failed", err);
    if (supabaseUrl && serviceRoleKey) {
      await logActivity(supabaseUrl, serviceRoleKey, { postcode, success: false, reason: "upstream_unreachable" });
    }
    return jsonResponse({ error: "Upstream Google Maps request failed" }, 502);
  }

  if (!upstream.ok) {
    if (supabaseUrl && serviceRoleKey) {
      await logActivity(supabaseUrl, serviceRoleKey, {
        postcode,
        success: false,
        reason: "upstream_http_error",
        status: upstream.status,
      });
    }
    return jsonResponse({ error: `Google Maps returned ${upstream.status}` }, 502);
  }

  const payload = await upstream.json() as any;

  if (payload.status !== "OK" || !Array.isArray(payload.results) || payload.results.length === 0) {
    if (supabaseUrl && serviceRoleKey) {
      await logActivity(supabaseUrl, serviceRoleKey, {
        postcode,
        success: false,
        reason: "no_results",
        google_status: payload.status,
      });
    }
    const status = payload.status === "ZERO_RESULTS" ? 404 : 502;
    return jsonResponse(
      { error: `Geocode failed: ${payload.status ?? "unknown error"}` },
      status,
    );
  }

  const top = payload.results[0];
  const lat = top?.geometry?.location?.lat;
  const lng = top?.geometry?.location?.lng;
  const formatted_address = top?.formatted_address ?? "";

  if (typeof lat !== "number" || typeof lng !== "number") {
    if (supabaseUrl && serviceRoleKey) {
      await logActivity(supabaseUrl, serviceRoleKey, { postcode, success: false, reason: "no_lat_lng" });
    }
    return jsonResponse({ error: "Geocode response missing coordinates" }, 502);
  }

  const result: SuccessResponse = {
    lat,
    lng,
    postcode_prefix: postcodePrefix(postcode),
    formatted_address,
  };

  if (supabaseUrl && serviceRoleKey) {
    await logActivity(supabaseUrl, serviceRoleKey, {
      postcode,
      success: true,
      postcode_prefix: result.postcode_prefix,
    });
  }

  return jsonResponse(result, 200);
});
