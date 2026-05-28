// supabase/functions/create-payment-link/index.ts
//
// POST { course_instance_id, ticket_type_id, quantity } (auth: franchisee JWT)
//   -> 200 { payment_link_url }
//   -> 400 stripe not connected / visibility != private / bad input
//   -> 403 caller does not own the course instance
//   -> 401 missing / invalid JWT
//   -> 500 server / Stripe error
//
// Reference: src/features/franchisee/payments/types.ts (frozen contract),
//   DECISIONS.md §"Locked at M2 kick-off" (direct charges, application fee,
//   Payment Links on connected account, booking rows only from webhook).
//
// Responsibilities:
//   1. Franchisee-auth: JWT sub → da_franchisees row.
//   2. Ownership: course.franchisee_id === actor.id, else 403.
//   3. stripe_connected check: else 400 "Connect your Stripe account first".
//   4. visibility check: only 'private' courses use Payment Links in M2.
//   5. Load the chosen ticket type and compute total amount_pence.
//   6. Compute application_fee_amount = Math.floor(amount_pence * PLATFORM_FEE_PERCENT / 100).
//   7. stripe.paymentLinks.create on the connected account with an inline price_data.
//   8. Persist stripe_payment_link + payment_link_created_at on da_course_instances.
//   9. Insert da_activities row (action='payment_link_created').
//  10. Return { payment_link_url }.
//
// NOTE: do NOT deploy this function — the verifier agent does that.

// deno-lint-ignore-file no-explicit-any

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import Stripe from 'https://esm.sh/stripe@17.7.0?target=denonext';

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
// JWT decode (sub claim only — gateway validates the signature)
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
// Input validation
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

interface ValidatedInput {
  course_instance_id: string;
  ticket_type_id: string;
  quantity: number;
}

function validateBody(
  raw: unknown,
): { ok: true; value: ValidatedInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Request body must be a JSON object' };
  }
  const b = raw as Record<string, unknown>;

  if (!isUuid(b.course_instance_id)) {
    return { ok: false, error: 'course_instance_id must be a valid UUID' };
  }
  if (!isUuid(b.ticket_type_id)) {
    return { ok: false, error: 'ticket_type_id must be a valid UUID' };
  }
  if (typeof b.quantity !== 'number' || !Number.isInteger(b.quantity) || b.quantity < 1) {
    return { ok: false, error: 'quantity must be a positive integer' };
  }

  return {
    ok: true,
    value: {
      course_instance_id: b.course_instance_id as string,
      ticket_type_id: b.ticket_type_id as string,
      quantity: b.quantity as number,
    },
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

  // -------------------------------------------------------------------------
  // Auth: extract JWT, decode sub
  // -------------------------------------------------------------------------
  const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization');
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
    return jsonResponse({ error: 'Authorization header required' }, 401);
  }
  const jwt = authHeader.slice('bearer '.length).trim();
  const authUserId = decodeJwtSub(jwt);
  if (!authUserId) {
    return jsonResponse({ error: 'Invalid JWT' }, 401);
  }

  // -------------------------------------------------------------------------
  // Environment
  // -------------------------------------------------------------------------
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
  const platformFeePercentRaw = Deno.env.get('PLATFORM_FEE_PERCENT') ?? '2';

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Server misconfigured (Supabase env)' }, 500);
  }
  if (!stripeSecretKey) {
    return jsonResponse({ error: 'Server misconfigured (Stripe key not set)' }, 500);
  }

  const platformFeePercent = Number(platformFeePercentRaw);
  if (!Number.isFinite(platformFeePercent) || platformFeePercent < 0) {
    return jsonResponse({ error: 'Server misconfigured (invalid PLATFORM_FEE_PERCENT)' }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // -------------------------------------------------------------------------
  // Resolve franchisee from JWT sub
  // -------------------------------------------------------------------------
  const franchiseeResult = await admin
    .from('da_franchisees')
    .select('id, name, email, stripe_account_id, stripe_connected')
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  if (franchiseeResult.error) {
    console.error('franchisee lookup failed', franchiseeResult.error);
    return jsonResponse({ error: 'Failed to verify caller' }, 500);
  }
  if (!franchiseeResult.data) {
    return jsonResponse({ error: 'Caller is not provisioned as a franchisee' }, 403);
  }

  const franchisee = franchiseeResult.data as {
    id: string;
    name: string;
    email: string;
    stripe_account_id: string | null;
    stripe_connected: boolean;
  };

  // -------------------------------------------------------------------------
  // Parse + validate request body
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // Load course instance and verify ownership
  // -------------------------------------------------------------------------
  const instanceResult = await admin
    .from('da_course_instances')
    .select('id, franchisee_id, visibility, price_pence, template_id, event_date, venue_postcode')
    .eq('id', input.course_instance_id)
    .maybeSingle();

  if (instanceResult.error) {
    console.error('course instance lookup failed', instanceResult.error);
    return jsonResponse({ error: 'Failed to load course instance' }, 500);
  }
  if (!instanceResult.data) {
    return jsonResponse({ error: 'Course instance not found' }, 404);
  }

  const instance = instanceResult.data as {
    id: string;
    franchisee_id: string;
    visibility: string;
    price_pence: number;
    template_id: string;
    event_date: string;
    venue_postcode: string;
  };

  // Ownership check — non-HQ franchisee must own the course.
  if (instance.franchisee_id !== franchisee.id) {
    return jsonResponse({ error: 'You do not own this course instance' }, 403);
  }

  // -------------------------------------------------------------------------
  // Stripe Connect check
  // -------------------------------------------------------------------------
  if (!franchisee.stripe_connected || !franchisee.stripe_account_id) {
    return jsonResponse(
      { error: 'Connect your Stripe account first before generating a payment link' },
      400,
    );
  }

  // -------------------------------------------------------------------------
  // Visibility check — Payment Links are for private courses only in M2
  // -------------------------------------------------------------------------
  if (instance.visibility !== 'private') {
    return jsonResponse(
      { error: 'Payment links can only be generated for private courses (public checkout is M3)' },
      400,
    );
  }

  // -------------------------------------------------------------------------
  // Load ticket type (must belong to the same course instance)
  // -------------------------------------------------------------------------
  const ticketResult = await admin
    .from('da_ticket_types')
    .select('id, name, price_pence, seats_consumed')
    .eq('id', input.ticket_type_id)
    .eq('course_instance_id', input.course_instance_id)
    .maybeSingle();

  if (ticketResult.error) {
    console.error('ticket type lookup failed', ticketResult.error);
    return jsonResponse({ error: 'Failed to load ticket type' }, 500);
  }
  if (!ticketResult.data) {
    return jsonResponse({ error: 'Ticket type not found on this course instance' }, 404);
  }

  const ticketType = ticketResult.data as {
    id: string;
    name: string;
    price_pence: number;
    seats_consumed: number;
  };

  // -------------------------------------------------------------------------
  // Fee calculation
  //
  //   amount_pence = ticket.price_pence * quantity
  //   application_fee_amount = Math.floor(amount_pence * PLATFORM_FEE_PERCENT / 100)
  //
  // Both values are integer pence, matching DECISIONS.md "Money: integer pence
  // everywhere" and the frozen types contract.
  // -------------------------------------------------------------------------
  const amount_pence = ticketType.price_pence * input.quantity;
  const application_fee_amount = Math.floor((amount_pence * platformFeePercent) / 100);

  // -------------------------------------------------------------------------
  // Fetch template name for a human-readable Stripe product label
  // -------------------------------------------------------------------------
  let templateName = 'Course';
  const templateResult = await admin
    .from('da_course_templates')
    .select('name')
    .eq('id', instance.template_id)
    .maybeSingle();

  if (!templateResult.error && templateResult.data) {
    templateName = (templateResult.data as { name: string }).name;
  }

  // -------------------------------------------------------------------------
  // Create Stripe Payment Link on the connected account
  //
  // We use `price_data` with an inline product so no persistent Stripe product
  // or price object is created beyond the Payment Link itself — keeps the
  // connected account clean for M2. The quantity on the line item is set to 1
  // because price_data carries the per-booking total; the "quantity" from the
  // request is embedded in the product name so operators can see it.
  //
  // `currency: 'gbp'` — all Daisy money is GBP (DECISIONS.md).
  //
  // `unit_amount` = amount_pence (already the total for quantity tickets).
  //
  // `application_fee_amount` is the 2% slice that flows to the platform; the
  // rest settles directly to the franchisee's Stripe account.
  //
  // `{ stripeAccount }` — the "on behalf of" header that routes the charge to
  // the franchisee's connected account (Standard Connect direct charge).
  //
  // metadata carries course_instance_id, ticket_type_id, quantity, and
  // franchisee_id so the stripe-webhook (8C) can correlate
  // checkout.session.completed events back to the right rows without a
  // secondary lookup.
  // -------------------------------------------------------------------------
  const stripe = new Stripe(stripeSecretKey, {
    // httpClient is not typed in some Stripe dts; omit it to let the SDK
    // pick the appropriate Deno-compatible fetch-based client automatically.
    apiVersion: '2024-06-20',
  });

  let paymentLink: Stripe.PaymentLink;
  try {
    paymentLink = await stripe.paymentLinks.create(
      {
        line_items: [
          {
            price_data: {
              currency: 'gbp',
              unit_amount: amount_pence,
              product_data: {
                name: `${templateName} — ${ticketType.name} × ${input.quantity}`,
                description: `${instance.event_date} · ${instance.venue_postcode}`,
              },
            },
            quantity: 1,
          },
        ],
        application_fee_amount,
        metadata: {
          course_instance_id: input.course_instance_id,
          ticket_type_id: input.ticket_type_id,
          quantity: String(input.quantity),
          franchisee_id: franchisee.id,
        },
      },
      { stripeAccount: franchisee.stripe_account_id },
    );
  } catch (err: any) {
    console.error('Stripe paymentLinks.create failed', err);
    const message: string =
      typeof err?.message === 'string' ? (err.message as string) : 'Stripe error';
    return jsonResponse({ error: `Failed to create payment link: ${message}` }, 500);
  }

  const paymentLinkUrl = paymentLink.url;

  // -------------------------------------------------------------------------
  // Persist the URL on da_course_instances
  // -------------------------------------------------------------------------
  const updateResult = await admin
    .from('da_course_instances')
    .update({
      stripe_payment_link: paymentLinkUrl,
      payment_link_created_at: new Date().toISOString(),
    })
    .eq('id', input.course_instance_id);

  if (updateResult.error) {
    // The link is live; log the failure but do not surface as an error.
    // The webhook can fall back to the metadata to find the course.
    console.error('failed to persist stripe_payment_link on instance', updateResult.error);
  }

  // -------------------------------------------------------------------------
  // Activity row
  // -------------------------------------------------------------------------
  await admin
    .from('da_activities')
    .insert({
      actor_type: 'franchisee',
      actor_id: franchisee.id,
      entity_type: 'course_instance',
      entity_id: input.course_instance_id,
      action: 'payment_link_created',
      metadata: {
        ticket_type_id: input.ticket_type_id,
        ticket_type_name: ticketType.name,
        quantity: input.quantity,
        amount_pence,
        application_fee_amount,
        platform_fee_percent: platformFeePercent,
        stripe_payment_link_id: paymentLink.id,
        regenerated: false,
      },
      description: `Payment link generated for ${ticketType.name} × ${input.quantity} (${templateName}, ${instance.event_date})`,
    })
    .catch((err: unknown) => {
      console.error('activity insert failed', err);
    });

  // -------------------------------------------------------------------------
  // Return
  // -------------------------------------------------------------------------
  return jsonResponse({ payment_link_url: paymentLinkUrl }, 200);
});
