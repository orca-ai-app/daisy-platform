// supabase/functions/process-interest-form/index.ts
//
// PUBLIC (no auth) — the booking widget's interest-form capture. PRD §6.3.
// Used when a postcode search finds no courses in a vacant/un-owned territory.
//
// POST {
//   postcode: string,
//   num_attendees: number,            // >= 1
//   contact_name: string,
//   contact_email: string,
//   contact_phone?: string,
//   preferred_dates?: string,
//   venue_preference?: string,
//   course_template_id?: string,      // optional course of interest
//   notes?: string
// }
// -> 201 { ok: true, id }
//
// Inserts da_interest_forms (status='new'), queues an interest_form_hq email
// row for HQ, and writes a da_activities audit row. Best-effort 20/min/IP limit.

// deno-lint-ignore-file no-explicit-any

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

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

function reqStr(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

interface RequestBody {
  postcode?: unknown;
  num_attendees?: unknown;
  contact_name?: unknown;
  contact_email?: unknown;
  contact_phone?: unknown;
  preferred_dates?: unknown;
  venue_preference?: unknown;
  course_template_id?: unknown;
  notes?: unknown;
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

  const postcode = reqStr(body.postcode);
  const contactName = reqStr(body.contact_name);
  const contactEmailRaw = reqStr(body.contact_email);
  const numAttendees = body.num_attendees;

  if (!postcode) return jsonResponse({ error: 'postcode is required' }, 400);
  if (!contactName) return jsonResponse({ error: 'contact_name is required' }, 400);
  if (!contactEmailRaw || !EMAIL_RE.test(contactEmailRaw)) {
    return jsonResponse({ error: 'a valid contact_email is required' }, 400);
  }
  if (typeof numAttendees !== 'number' || !Number.isInteger(numAttendees) || numAttendees < 1) {
    return jsonResponse({ error: 'num_attendees must be a positive integer' }, 400);
  }

  const courseTemplateId = reqStr(body.course_template_id);

  const insert = await admin
    .from('da_interest_forms')
    .insert({
      postcode: postcode.toUpperCase(),
      num_attendees: numAttendees,
      contact_name: contactName,
      contact_email: contactEmailRaw.toLowerCase(),
      contact_phone: reqStr(body.contact_phone),
      preferred_dates: reqStr(body.preferred_dates),
      venue_preference: reqStr(body.venue_preference),
      course_template_id: courseTemplateId,
      notes: reqStr(body.notes),
      status: 'new',
    })
    .select('id')
    .single();

  if (insert.error || !insert.data) {
    console.error('interest form insert failed', insert.error);
    return jsonResponse({ error: 'Could not submit your enquiry right now' }, 500);
  }
  const id = (insert.data as { id: string }).id;

  // --- HQ notification email (best-effort, never blocks the submission) -----
  // Sent inline via Postmark on the transactional 'outbound' stream — an
  // enquiry has no booking/customer, so it can't ride da_email_sequences.
  // Recipient comes from da_settings.hq_notification_email (HQ-editable).
  // NOTE: while the Postmark account is in test mode, only confirmed sender-
  // signature addresses receive mail; other recipients are rejected by
  // Postmark (recorded as hq_notified=false in the activity metadata).
  let hqNotified = false;
  try {
    const postmarkToken = Deno.env.get('POSTMARK_SERVER_TOKEN') ?? '';
    const fromEmail = Deno.env.get('POSTMARK_FROM_EMAIL') ?? '';
    const setting = await admin
      .from('da_settings')
      .select('value')
      .eq('key', 'hq_notification_email')
      .maybeSingle();
    const hqEmail = ((setting.data as any)?.value ?? '').trim();

    if (postmarkToken && fromEmail && hqEmail) {
      const portalUrl = Deno.env.get('PORTAL_URL') ?? 'https://daisy-crm-platform.netlify.app';
      const esc = (s: string | null) =>
        (s ?? '').replace(
          /[&<>"']/g,
          (c) =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
        );
      const rowsHtml = [
        ['Postcode', postcode.toUpperCase()],
        ['Group size', String(numAttendees)],
        ['Name', contactName],
        ['Email', contactEmailRaw.toLowerCase()],
        ['Phone', reqStr(body.contact_phone) ?? '-'],
        ['Preferred dates', reqStr(body.preferred_dates) ?? '-'],
        ['Notes', reqStr(body.notes) ?? '-'],
      ]
        .map(
          ([k, v]) =>
            `<tr><td style="padding:6px 12px 6px 0;color:#5A7A8F;font-size:13px;white-space:nowrap">${k}</td><td style="padding:6px 0;color:#1A4359;font-size:14px;font-weight:600">${esc(v)}</td></tr>`,
        )
        .join('');
      const html = `<!doctype html><html><body style="margin:0;background:#f5f9fb;font-family:Poppins,Arial,sans-serif;color:#1a4359">
        <div style="max-width:560px;margin:0 auto;padding:24px"><div style="background:#fff;border-radius:14px;padding:28px">
        <h1 style="font-family:Quicksand,Arial,sans-serif;color:#006FAC;font-size:20px;margin:0 0 12px">New class enquiry — ${esc(postcode.toUpperCase())}</h1>
        <p style="font-size:14px;margin:0 0 16px">Someone searched an area with no trainer and left their details.</p>
        <table style="border-collapse:collapse">${rowsHtml}</table>
        <p style="margin:20px 0 0"><a href="${portalUrl}/hq/interest-forms" style="display:inline-block;background:#006FAC;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:700;font-size:14px">Open the enquiries queue</a></p>
        </div></div></body></html>`;
      const text = `New class enquiry — ${postcode.toUpperCase()}\n\nPostcode: ${postcode.toUpperCase()}\nGroup size: ${numAttendees}\nName: ${contactName}\nEmail: ${contactEmailRaw.toLowerCase()}\nPhone: ${reqStr(body.contact_phone) ?? '-'}\nPreferred dates: ${reqStr(body.preferred_dates) ?? '-'}\nNotes: ${reqStr(body.notes) ?? '-'}\n\nQueue: ${portalUrl}/hq/interest-forms`;

      const res = await fetch('https://api.postmarkapp.com/email', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Postmark-Server-Token': postmarkToken,
        },
        body: JSON.stringify({
          From: fromEmail,
          To: hqEmail,
          ReplyTo: contactEmailRaw.toLowerCase(),
          Subject: `New class enquiry — ${postcode.toUpperCase()} (${numAttendees} people)`,
          HtmlBody: html,
          TextBody: text,
          MessageStream: 'outbound',
        }),
      });
      hqNotified = res.ok;
      if (!res.ok) {
        console.error(
          'enquiry notification send failed',
          res.status,
          (await res.text()).slice(0, 200),
        );
      }
    }
  } catch (err) {
    console.error('enquiry notification failed', err);
  }

  await admin
    .from('da_activities')
    .insert({
      actor_type: 'system',
      actor_id: null,
      entity_type: 'interest_form',
      entity_id: id,
      action: 'interest_form_submitted',
      metadata: {
        postcode: postcode.toUpperCase(),
        num_attendees: numAttendees,
        source: 'widget',
        hq_notified: hqNotified,
      },
      description: `Interest form from ${contactName} (${postcode.toUpperCase()}, ${numAttendees} attendees)`,
    })
    .then((r: { error: unknown }) => {
      if (r.error) console.error('activity insert failed', r.error);
    });

  return jsonResponse({ ok: true, id }, 201);
});
