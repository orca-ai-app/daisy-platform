// supabase/functions/create-template/index.ts
//
// POST { name, slug, duration_hours, default_price_pence, default_capacity?,
//        age_range?, certification?, description?, default_ticket_types?,
//        is_active? }
//   -> created da_course_templates row
//
// Reference: docs/PRD-technical.md §4.4 (da_course_templates), §4.15
// (da_activities). Course templates are HQ-only writes; everyone reads.
//
// Behaviour mirrors update-template:
//  - Requires Authorization: Bearer <jwt>. The JWT's `sub` claim is matched
//    against da_franchisees.auth_user_id; only rows with `is_hq = TRUE` may
//    proceed. Non-HQ users get 403.
//  - Validates the input body against an explicit field whitelist + types.
//    Rejects with 400 + descriptive error.
//  - Uses service_role to INSERT da_course_templates.
//  - Inserts a da_activities row (action = 'template_created') with the new
//    template snapshot and a human-readable description.
//  - Returns 4xx for bad input, 401/403 for auth failures, 409 for slug
//    conflicts, 5xx for DB issues.

// deno-lint-ignore-file no-explicit-any

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ALLOWED_CERTIFICATIONS = new Set(['yes', 'no', 'if_requested']);
const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const DEFAULT_TICKET_TYPES = [{ name: 'Single', seats_consumed: 1, price_modifier_pence: 0 }];

interface CreateRequestBody {
  name?: unknown;
  slug?: unknown;
  duration_hours?: unknown;
  default_price_pence?: unknown;
  default_capacity?: unknown;
  age_range?: unknown;
  certification?: unknown;
  description?: unknown;
  default_ticket_types?: unknown;
  is_active?: unknown;
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

function isValidTicketTypes(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  if (value.length === 0) return false;
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const row = entry as Record<string, unknown>;
    if (typeof row.name !== 'string' || row.name.trim().length === 0) return false;
    if (
      typeof row.seats_consumed !== 'number' ||
      !Number.isInteger(row.seats_consumed) ||
      (row.seats_consumed as number) <= 0
    ) {
      return false;
    }
    if (
      typeof row.price_modifier_pence !== 'number' ||
      !Number.isInteger(row.price_modifier_pence)
    ) {
      return false;
    }
  }
  return true;
}

interface ValidatedInput {
  name: string;
  slug: string;
  duration_hours: number;
  default_price_pence: number;
  default_capacity: number;
  age_range: string | null;
  certification: string | null;
  description: string | null;
  default_ticket_types: Array<Record<string, unknown>>;
  is_active: boolean;
}

function validate(
  body: CreateRequestBody,
): { ok: true; value: ValidatedInput } | { ok: false; error: string } {
  if (typeof body.name !== 'string' || body.name.trim().length < 2) {
    return { ok: false, error: 'name must be a string of at least 2 characters' };
  }
  if (typeof body.slug !== 'string' || !SLUG_REGEX.test(body.slug)) {
    return {
      ok: false,
      error: 'slug must be lower-case kebab-case (letters, digits, hyphens)',
    };
  }
  if (
    typeof body.duration_hours !== 'number' ||
    !Number.isFinite(body.duration_hours) ||
    (body.duration_hours as number) <= 0
  ) {
    return { ok: false, error: 'duration_hours must be a positive number' };
  }
  if (
    typeof body.default_price_pence !== 'number' ||
    !Number.isInteger(body.default_price_pence) ||
    (body.default_price_pence as number) < 0
  ) {
    return { ok: false, error: 'default_price_pence must be a non-negative integer' };
  }
  if (
    body.default_capacity !== undefined &&
    (typeof body.default_capacity !== 'number' ||
      !Number.isInteger(body.default_capacity) ||
      (body.default_capacity as number) <= 0)
  ) {
    return { ok: false, error: 'default_capacity must be a positive integer' };
  }
  if (
    body.age_range !== undefined &&
    body.age_range !== null &&
    typeof body.age_range !== 'string'
  ) {
    return { ok: false, error: 'age_range must be a string or null' };
  }
  if (
    body.certification !== undefined &&
    body.certification !== null &&
    (typeof body.certification !== 'string' ||
      !ALLOWED_CERTIFICATIONS.has(body.certification as string))
  ) {
    return {
      ok: false,
      error: 'certification must be one of: yes, no, if_requested (or null)',
    };
  }
  if (
    body.description !== undefined &&
    body.description !== null &&
    typeof body.description !== 'string'
  ) {
    return { ok: false, error: 'description must be a string or null' };
  }
  if (body.default_ticket_types !== undefined && !isValidTicketTypes(body.default_ticket_types)) {
    return {
      ok: false,
      error:
        'default_ticket_types must be a non-empty array of { name, seats_consumed, price_modifier_pence }',
    };
  }
  if (body.is_active !== undefined && typeof body.is_active !== 'boolean') {
    return { ok: false, error: 'is_active must be a boolean' };
  }

  return {
    ok: true,
    value: {
      name: (body.name as string).trim(),
      slug: (body.slug as string).trim(),
      duration_hours: body.duration_hours as number,
      default_price_pence: body.default_price_pence as number,
      default_capacity:
        typeof body.default_capacity === 'number' ? (body.default_capacity as number) : 12,
      age_range:
        typeof body.age_range === 'string' && body.age_range.trim().length > 0
          ? (body.age_range as string).trim()
          : null,
      certification: typeof body.certification === 'string' ? (body.certification as string) : null,
      description:
        typeof body.description === 'string' && body.description.trim().length > 0
          ? (body.description as string).trim()
          : null,
      default_ticket_types: Array.isArray(body.default_ticket_types)
        ? (body.default_ticket_types as Array<Record<string, unknown>>)
        : DEFAULT_TICKET_TYPES,
      is_active: body.is_active === undefined ? true : (body.is_active as boolean),
    },
  };
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
  let body: CreateRequestBody;
  try {
    body = (await req.json()) as CreateRequestBody;
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const validated = validate(body);
  if (!validated.ok) {
    return jsonResponse({ error: validated.error }, 400);
  }
  const input = validated.value;

  // ---------------------------------------------------------------------
  // Uniqueness check (slug)
  // ---------------------------------------------------------------------
  const dupe = await admin
    .from('da_course_templates')
    .select('id')
    .eq('slug', input.slug)
    .maybeSingle();

  if (dupe.error) {
    console.error('slug uniqueness check failed', dupe.error);
    return jsonResponse({ error: 'Failed to check existing templates' }, 500);
  }
  if (dupe.data) {
    return jsonResponse({ error: `Slug "${input.slug}" is already in use` }, 409);
  }

  // ---------------------------------------------------------------------
  // INSERT da_course_templates
  // ---------------------------------------------------------------------
  const insertPayload: Record<string, unknown> = {
    name: input.name,
    slug: input.slug,
    duration_hours: input.duration_hours,
    default_price_pence: input.default_price_pence,
    default_capacity: input.default_capacity,
    age_range: input.age_range,
    certification: input.certification,
    description: input.description,
    default_ticket_types: input.default_ticket_types,
    is_active: input.is_active,
  };

  const inserted = await admin
    .from('da_course_templates')
    .insert(insertPayload)
    .select('*')
    .single();

  if (inserted.error || !inserted.data) {
    console.error('template insert failed', inserted.error);
    if ((inserted.error as any)?.code === '23505') {
      return jsonResponse({ error: 'Slug already in use' }, 409);
    }
    return jsonResponse({ error: 'Failed to create template' }, 500);
  }

  const templateRow = inserted.data;

  // ---------------------------------------------------------------------
  // Activity log
  // ---------------------------------------------------------------------
  const description = `Template "${input.name}" created`;
  const activityInsert = await admin.from('da_activities').insert({
    actor_type: 'hq',
    actor_id: actor.data.id,
    entity_type: 'course_template',
    entity_id: (templateRow as any).id,
    action: 'template_created',
    metadata: {
      name: input.name,
      slug: input.slug,
      duration_hours: input.duration_hours,
      default_price_pence: input.default_price_pence,
      default_capacity: input.default_capacity,
      certification: input.certification,
      is_active: input.is_active,
    },
    description,
  });

  if (activityInsert.error) {
    console.error('activity log insert failed', activityInsert.error);
  }

  return jsonResponse(templateRow, 201);
});
