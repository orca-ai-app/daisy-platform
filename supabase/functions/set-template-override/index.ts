// supabase/functions/set-template-override/index.ts
//
// POST { franchisee_id, course_template_id, fields }
//   -> upserted da_franchisee_template_overrides row
//
// Reference: docs/PRD-technical.md §4.4 (da_course_templates), §4.15
// (da_activities), and migration 017_franchisee_template_overrides.sql.
//
// Behaviour:
//  - Requires Authorization: Bearer <jwt>. The JWT's `sub` claim is matched
//    against da_franchisees.auth_user_id.
//  - Row-scoped auth: the caller may write the override iff
//      (a) caller.is_hq = TRUE, OR
//      (b) caller.id = body.franchisee_id (i.e. the franchisee is editing
//          their own override).
//    Anyone else gets 403.
//  - Validates the input body's `fields` against an explicit whitelist of
//    nullable override columns. NULL means "inherit from template".
//  - Uses service_role to UPSERT da_franchisee_template_overrides keyed on
//    (franchisee_id, course_template_id).
//  - Inserts a da_activities row (action = 'template_override_set') with the
//    fields that were set/cleared.
//  - Returns 4xx for bad input, 401/403 for auth failures, 5xx for DB issues.

// deno-lint-ignore-file no-explicit-any

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const OVERRIDE_FIELDS = new Set([
  'name',
  'duration_hours',
  'default_price_pence',
  'default_capacity',
  'description',
  'default_ticket_types',
  'is_active',
]);

interface RequestBody {
  franchisee_id?: unknown;
  course_template_id?: unknown;
  fields?: unknown;
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
  // Identify caller
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

  // ---------------------------------------------------------------------
  // Parse + validate body
  // ---------------------------------------------------------------------
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  if (typeof body.franchisee_id !== 'string' || !isUuid(body.franchisee_id as string)) {
    return jsonResponse({ error: 'franchisee_id is required (uuid)' }, 400);
  }
  if (typeof body.course_template_id !== 'string' || !isUuid(body.course_template_id as string)) {
    return jsonResponse({ error: 'course_template_id is required (uuid)' }, 400);
  }
  if (!body.fields || typeof body.fields !== 'object' || Array.isArray(body.fields)) {
    return jsonResponse({ error: 'fields is required (object)' }, 400);
  }

  const franchiseeId = body.franchisee_id as string;
  const courseTemplateId = body.course_template_id as string;
  const fields = body.fields as Record<string, unknown>;

  // ---------------------------------------------------------------------
  // Row-scoped auth: HQ may write any row; non-HQ may only write their own.
  // ---------------------------------------------------------------------
  if (!actor.data.is_hq && actor.data.id !== franchiseeId) {
    return jsonResponse({ error: 'You may only set overrides for your own franchisee' }, 403);
  }

  // ---------------------------------------------------------------------
  // Whitelist + type-shape validate the override fields. NULL is allowed
  // on every field (NULL = inherit).
  // ---------------------------------------------------------------------
  const overrideFields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!OVERRIDE_FIELDS.has(key)) {
      return jsonResponse({ error: `Field not overridable: ${key}` }, 400);
    }
    overrideFields[key] = value;
  }
  if (Object.keys(overrideFields).length === 0) {
    return jsonResponse({ error: 'No fields to set' }, 400);
  }

  if (
    'name' in overrideFields &&
    overrideFields.name !== null &&
    (typeof overrideFields.name !== 'string' || (overrideFields.name as string).trim().length === 0)
  ) {
    return jsonResponse({ error: 'name must be a non-empty string or null' }, 400);
  }
  if (
    'duration_hours' in overrideFields &&
    overrideFields.duration_hours !== null &&
    (typeof overrideFields.duration_hours !== 'number' ||
      !Number.isFinite(overrideFields.duration_hours) ||
      (overrideFields.duration_hours as number) <= 0)
  ) {
    return jsonResponse({ error: 'duration_hours must be a positive number or null' }, 400);
  }
  if (
    'default_price_pence' in overrideFields &&
    overrideFields.default_price_pence !== null &&
    (typeof overrideFields.default_price_pence !== 'number' ||
      !Number.isInteger(overrideFields.default_price_pence) ||
      (overrideFields.default_price_pence as number) < 0)
  ) {
    return jsonResponse(
      { error: 'default_price_pence must be a non-negative integer or null' },
      400,
    );
  }
  if (
    'default_capacity' in overrideFields &&
    overrideFields.default_capacity !== null &&
    (typeof overrideFields.default_capacity !== 'number' ||
      !Number.isInteger(overrideFields.default_capacity) ||
      (overrideFields.default_capacity as number) <= 0)
  ) {
    return jsonResponse({ error: 'default_capacity must be a positive integer or null' }, 400);
  }
  if (
    'description' in overrideFields &&
    overrideFields.description !== null &&
    typeof overrideFields.description !== 'string'
  ) {
    return jsonResponse({ error: 'description must be a string or null' }, 400);
  }
  if (
    'default_ticket_types' in overrideFields &&
    overrideFields.default_ticket_types !== null &&
    !isValidTicketTypes(overrideFields.default_ticket_types)
  ) {
    return jsonResponse(
      {
        error:
          'default_ticket_types must be a non-empty array of { name, seats_consumed, price_modifier_pence } or null',
      },
      400,
    );
  }
  if (
    'is_active' in overrideFields &&
    overrideFields.is_active !== null &&
    typeof overrideFields.is_active !== 'boolean'
  ) {
    return jsonResponse({ error: 'is_active must be a boolean or null' }, 400);
  }

  // Normalise text fields.
  if (typeof overrideFields.name === 'string') {
    overrideFields.name = (overrideFields.name as string).trim();
  }
  if (typeof overrideFields.description === 'string') {
    const trimmed = (overrideFields.description as string).trim();
    overrideFields.description = trimmed.length === 0 ? null : trimmed;
  }

  // ---------------------------------------------------------------------
  // Sanity-check the referenced rows exist.
  // ---------------------------------------------------------------------
  const franchiseeExists = await admin
    .from('da_franchisees')
    .select('id, name')
    .eq('id', franchiseeId)
    .maybeSingle();
  if (franchiseeExists.error) {
    console.error('franchisee existence check failed', franchiseeExists.error);
    return jsonResponse({ error: 'Failed to verify franchisee' }, 500);
  }
  if (!franchiseeExists.data) {
    return jsonResponse({ error: 'Franchisee not found' }, 404);
  }

  const templateExists = await admin
    .from('da_course_templates')
    .select('id, name')
    .eq('id', courseTemplateId)
    .maybeSingle();
  if (templateExists.error) {
    console.error('template existence check failed', templateExists.error);
    return jsonResponse({ error: 'Failed to verify template' }, 500);
  }
  if (!templateExists.data) {
    return jsonResponse({ error: 'Course template not found' }, 404);
  }

  // ---------------------------------------------------------------------
  // Upsert
  // ---------------------------------------------------------------------
  const upsertPayload: Record<string, unknown> = {
    franchisee_id: franchiseeId,
    course_template_id: courseTemplateId,
    ...overrideFields,
    updated_at: new Date().toISOString(),
  };

  const upserted = await admin
    .from('da_franchisee_template_overrides')
    .upsert(upsertPayload, { onConflict: 'franchisee_id,course_template_id' })
    .select('*')
    .single();

  if (upserted.error || !upserted.data) {
    console.error('override upsert failed', upserted.error);
    return jsonResponse({ error: 'Failed to set override' }, 500);
  }

  // ---------------------------------------------------------------------
  // Activity log
  // ---------------------------------------------------------------------
  const setKeys = Object.entries(overrideFields)
    .filter(([, v]) => v !== null)
    .map(([k]) => k);
  const clearedKeys = Object.entries(overrideFields)
    .filter(([, v]) => v === null)
    .map(([k]) => k);

  const franchiseeName = (franchiseeExists.data as any).name ?? 'franchisee';
  const templateName = (templateExists.data as any).name ?? 'template';

  let description: string;
  if (setKeys.length && clearedKeys.length) {
    description = `${franchiseeName} override on "${templateName}" — set ${setKeys.join(', ')}; cleared ${clearedKeys.join(', ')}`;
  } else if (setKeys.length) {
    description = `${franchiseeName} override on "${templateName}" — set ${setKeys.join(', ')}`;
  } else if (clearedKeys.length) {
    description = `${franchiseeName} override on "${templateName}" — cleared ${clearedKeys.join(', ')}`;
  } else {
    description = `${franchiseeName} override on "${templateName}" updated`;
  }

  const activityInsert = await admin.from('da_activities').insert({
    actor_type: actor.data.is_hq ? 'hq' : 'franchisee',
    actor_id: actor.data.id,
    entity_type: 'course_template',
    entity_id: courseTemplateId,
    action: 'template_override_set',
    metadata: {
      franchisee_id: franchiseeId,
      course_template_id: courseTemplateId,
      fields: overrideFields,
      set_keys: setKeys,
      cleared_keys: clearedKeys,
    },
    description,
  });

  if (activityInsert.error) {
    console.error('activity log insert failed', activityInsert.error);
  }

  return jsonResponse(upserted.data, 200);
});
