// Email templates for the send-emails cron. One entry per da_email_sequences
// template_key (migration 044). Variables are filled with simple {{mustache}}
// substitution. PLACEHOLDER COPY: the structure, subjects and variables are
// final; the body wording is sensible-default and is replaced verbatim with
// Jenni's real Kartra copy when provided (docs/M3-email-journey.md).

export interface TemplateContext {
  first_name: string;
  customer_name: string;
  template_name: string;
  event_date: string; // already formatted for display
  start_time: string;
  venue: string;
  franchisee_name: string;
  franchisee_email: string;
  booking_reference: string;
  unsubscribe_url: string;
  // Sellable items (migration 044) — set only for product_purchase_confirmation,
  // which resolves via da_product_sales rather than a booking.
  product_name?: string;
  product_quantity?: string;
  /**
   * da_products.kind for the purchased item. Decides whether the buyer is told
   * their access details follow separately (e-learning) or that their
   * instructor will be in touch (physical). Missing = treated as physical.
   */
  product_kind?: string;
  /** E-learning access link. Empty string for physical products. */
  fulfilment_url?: string;
  fulfilment_notes?: string;
  /**
   * The franchisee's own message (migration 046, G2), rendered in its own
   * block on the confirmation emails. Empty string when they have not set one.
   *
   * NOT a {{mustache}} variable: it is customer-visible free text, so it is
   * escaped and inserted as markup rather than substituted into a template
   * string, which would let an apostrophe or angle bracket break the HTML.
   */
  booking_email_message?: string;
}

function fill(s: string, ctx: TemplateContext): string {
  return s.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => (ctx as any)[k] ?? '');
}

const DAISY_BLUE = '#006FAC';

/** Escape free text before it goes anywhere near an HTML body. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The franchisee's own message as a visually separated block (G2). Returns an
 * empty string when they have not written one, so callers can concatenate it
 * unconditionally. Line breaks are preserved.
 */
function franchiseeMessageHtml(ctx: TemplateContext): string {
  const msg = (ctx.booking_email_message ?? '').trim();
  if (!msg) return '';
  const body = escapeHtml(msg).replace(/\r?\n/g, '<br/>');
  return `<div style="border-top:1px solid #e2edf3;margin-top:24px;padding-top:16px">
      <p style="color:#5a7a8f;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;margin:0 0 8px">A note from ${escapeHtml(
        ctx.franchisee_name,
      )}</p>
      <p style="margin:0">${body}</p>
    </div>`;
}

/** Plain-text counterpart of franchiseeMessageHtml. */
function franchiseeMessageText(ctx: TemplateContext): string {
  const msg = (ctx.booking_email_message ?? '').trim();
  if (!msg) return '';
  return `\n\n---\nA note from ${ctx.franchisee_name}:\n${msg}`;
}

/**
 * `extraHtml` is already-escaped markup (the franchisee's own message) that
 * must NOT go through fill() — see franchiseeMessageHtml. Callers therefore
 * fill the rest of the body first and pass this in last.
 */
function wrap(
  title: string,
  bodyHtml: string,
  ctx: TemplateContext,
  reason?: string,
  extraHtml = '',
): string {
  return `<!doctype html><html><body style="margin:0;background:#f5f9fb;font-family:Poppins,Arial,sans-serif;color:#1a4359">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="background:#fff;border-radius:14px;padding:28px">
      <h1 style="font-family:Quicksand,Arial,sans-serif;color:${DAISY_BLUE};font-size:22px;margin:0 0 16px">${title}</h1>
      ${bodyHtml}
      ${extraHtml}
      <p style="color:#5a7a8f;font-size:13px;margin-top:24px">With love,<br/>${ctx.franchisee_name} &amp; the Daisy First Aid team</p>
    </div>
    <p style="color:#9bb0bd;font-size:11px;text-align:center;margin-top:16px">
      ${reason ?? "You're receiving this because you booked a Daisy First Aid class."}
      <a href="${ctx.unsubscribe_url}" style="color:#9bb0bd">Unsubscribe</a>.
    </p>
  </div></body></html>`;
}

interface RawTemplate {
  subject: string;
  // bodyHtml is the inner content; wrapped with Daisy branding at render time.
  bodyHtml: string;
  text: string;
}

const TEMPLATES: Record<string, RawTemplate> = {
  booking_confirmation: {
    subject: 'Your Daisy First Aid booking is confirmed ({{booking_reference}})',
    bodyHtml: `<p>Hi {{first_name}},</p>
      <p>Thank you for booking <strong>{{template_name}}</strong>. Your place is confirmed.</p>
      <p><strong>When:</strong> {{event_date}} at {{start_time}}<br/>
      <strong>Where:</strong> {{venue}}<br/>
      <strong>Reference:</strong> {{booking_reference}}</p>
      <p>We look forward to seeing you. If you need anything, just reply to this email.</p>`,
    text: `Hi {{first_name}},\n\nThank you for booking {{template_name}}. Your place is confirmed.\n\nWhen: {{event_date}} at {{start_time}}\nWhere: {{venue}}\nReference: {{booking_reference}}\n\nWe look forward to seeing you.\n\n{{franchisee_name}} & the Daisy First Aid team`,
  },
  new_booking_notification: {
    subject: 'New booking: {{template_name}} ({{booking_reference}})',
    bodyHtml: `<p>A new booking has come in.</p>
      <p><strong>Customer:</strong> {{customer_name}}<br/>
      <strong>Course:</strong> {{template_name}}<br/>
      <strong>When:</strong> {{event_date}} at {{start_time}}<br/>
      <strong>Reference:</strong> {{booking_reference}}</p>`,
    text: `New booking.\n\nCustomer: {{customer_name}}\nCourse: {{template_name}}\nWhen: {{event_date}} at {{start_time}}\nReference: {{booking_reference}}`,
  },
  medical_reminder: {
    subject: 'Reminder: your Daisy First Aid class is soon',
    bodyHtml: `<p>Hi {{first_name}},</p>
      <p>Just a quick reminder that your <strong>{{template_name}}</strong> class is coming up at {{start_time}} ({{event_date}}), at {{venue}}.</p>
      <p>If you haven't completed your medical declaration yet, your instructor will have a QR code at the venue.</p>`,
    text: `Hi {{first_name}},\n\nReminder: your {{template_name}} class is at {{start_time}} on {{event_date}}, at {{venue}}.\n\nYour instructor will have a QR code for your medical declaration at the venue.`,
  },
  course_updated: {
    subject: 'Update to your Daisy First Aid booking ({{booking_reference}})',
    bodyHtml: `<p>Hi {{first_name}},</p>
      <p>The details of your <strong>{{template_name}}</strong> class have changed. Here are the updated details:</p>
      <p><strong>When:</strong> {{event_date}} at {{start_time}}<br/>
      <strong>Where:</strong> {{venue}}<br/>
      <strong>Reference:</strong> {{booking_reference}}</p>
      <p>Your place is still confirmed. If the new details don't work for you, just reply to this email and we'll sort it out.</p>`,
    text: `Hi {{first_name}},\n\nThe details of your {{template_name}} class have changed. Here are the updated details:\n\nWhen: {{event_date}} at {{start_time}}\nWhere: {{venue}}\nReference: {{booking_reference}}\n\nYour place is still confirmed. If the new details don't work for you, just reply to this email.\n\n{{franchisee_name}} & the Daisy First Aid team`,
  },
  post_course_welcome: {
    subject: 'Thank you for coming to your Daisy First Aid class',
    bodyHtml: `<p>Hi {{first_name}},</p>
      <p>Thank you for joining us for <strong>{{template_name}}</strong>. We hope you found it useful and feel more confident.</p>
      <p>Over the coming months we'll send you short refreshers on the key topics, so the skills stay fresh.</p>`,
    text: `Hi {{first_name}},\n\nThank you for joining us for {{template_name}}. Over the coming months we'll send short refreshers so your skills stay fresh.`,
  },
};

// The recap / refresher series share a simple structure — one topical reminder.
const RECAP_TOPICS: Record<string, { subject: string; topic: string }> = {
  recap_anaphylaxis: {
    subject: 'Refresher: Anaphylaxis',
    topic: 'recognising and responding to anaphylaxis',
  },
  recap_choking: { subject: 'Refresher: Choking', topic: 'helping a choking baby or child' },
  recap_head_injuries: {
    subject: 'Refresher: Head injuries',
    topic: 'assessing and managing head injuries',
  },
  recap_cpr: { subject: 'Refresher: CPR', topic: 'CPR for babies and children' },
  recap_febrile_convulsions: {
    subject: 'Refresher: Febrile convulsions',
    topic: 'what to do during a febrile convulsion',
  },
  recap_burns: { subject: 'Refresher: Burns', topic: 'treating burns and scalds' },
  quiz_general: {
    subject: 'A quick Daisy First Aid quiz',
    topic: 'a short quiz to test your knowledge',
  },
  refresher: {
    subject: 'Time for a Daisy First Aid refresher',
    topic: 'refreshing everything you learned',
  },
  refresher_elearning_option: {
    subject: 'Keep your skills current with an online refresher',
    topic: 'an online refresher option',
  },
};

// Sellable items (migration 044). Built here rather than in TEMPLATES because
// the body branches by kind: an e-learning buyer needs to know how access will
// reach them, whereas a physical buyer needs to know it's coming from their
// instructor.
//
// F8 (Hannah + Feola, round 2): this email used to promise instant access and
// show a "Start now" button. That is factually wrong. Access is MANUAL — the
// franchisee buys licence keys and enrols the customer through elearnhere,
// which will not happen on an evening or at a weekend. Their own established
// wording promises details "within 48 hours", so that is what we say. A
// fulfilment_url, when HQ has set one on a network item, is offered as an
// extra below that message; it never replaces it and it is never a button, so
// the default promise stays honest. Never assume fulfilment_url is present — a
// physical product has none, and a franchisee's own e-learning item never has
// one at all.
const PRODUCT_PURCHASE_SUBJECT = 'Your Daisy First Aid order is confirmed';

function renderProductPurchase(ctx: TemplateContext): {
  subject: string;
  html: string;
  text: string;
} {
  const productName = ctx.product_name || ctx.template_name || 'your order';
  const quantity = ctx.product_quantity && ctx.product_quantity !== '1' ? ctx.product_quantity : '';
  const line = quantity ? `${quantity} × ${productName}` : productName;
  const url = ctx.fulfilment_url ?? '';
  const notes = ctx.fulfilment_notes ?? '';
  const isElearning = ctx.product_kind === 'elearning';

  let accessHtml: string;
  let accessText: string;
  if (isElearning) {
    accessHtml = `<p>Your access details will be emailed to you separately, usually within 48 hours. We set your account up by hand, so it may take a little longer over a weekend or a bank holiday.</p>
      <p>You do not need to do anything in the meantime.</p>${
        url
          ? `\n      <p style="font-size:13px;color:#5a7a8f">The course lives here for when you are ready: <a href="${escapeHtml(
              url,
            )}" style="color:${DAISY_BLUE}">${escapeHtml(url)}</a></p>`
          : ''
      }`;
    accessText = `Your access details will be emailed to you separately, usually within 48 hours. We set your account up by hand, so it may take a little longer over a weekend or a bank holiday. You do not need to do anything in the meantime.${
      url ? `\n\nThe course lives here for when you are ready:\n${url}` : ''
    }`;
  } else {
    accessHtml = `<p>Your instructor will be in touch about getting this to you.</p>`;
    accessText = 'Your instructor will be in touch about getting this to you.';
  }

  const notesHtml = notes ? `<p>${escapeHtml(notes)}</p>` : '';

  const bodyHtml = `<p>Hi ${escapeHtml(ctx.first_name)},</p>
      <p>Thank you for your order. Here's what you bought:</p>
      <p><strong>${escapeHtml(line)}</strong></p>
      ${accessHtml}
      ${notesHtml}
      <p>If you need anything at all, just reply to this email.</p>`;

  const text = `Hi ${ctx.first_name},\n\nThank you for your order. Here's what you bought:\n\n${line}\n\n${accessText}${
    notes ? `\n\n${notes}` : ''
  }\n\nIf you need anything at all, just reply to this email.\n\n${ctx.franchisee_name} & the Daisy First Aid team`;

  return {
    subject: fill(PRODUCT_PURCHASE_SUBJECT, ctx),
    html: wrap(
      PRODUCT_PURCHASE_SUBJECT,
      bodyHtml,
      ctx,
      "You're receiving this because you bought this from Daisy First Aid.",
      // The franchisee's own message (G2) rides on this email too.
      franchiseeMessageHtml(ctx),
    ),
    text: text + franchiseeMessageText(ctx),
  };
}

export function renderTemplate(
  key: string,
  ctx: TemplateContext,
): { subject: string; html: string; text: string } | null {
  if (key === 'product_purchase_confirmation') return renderProductPurchase(ctx);

  const recap = RECAP_TOPICS[key];
  if (recap) {
    const bodyHtml = `<p>Hi {{first_name}},</p>
      <p>A little while ago you came to your Daisy First Aid class. Here's a short refresher on <strong>${recap.topic}</strong>, so it stays fresh in your mind.</p>
      <p>If you'd like to book another class or a refresher session, just reply to this email.</p>`;
    const text = `Hi {{first_name}},\n\nHere's a short refresher on ${recap.topic}, so it stays fresh. To book another class, just reply.\n\n${ctx.franchisee_name} & the Daisy First Aid team`;
    return {
      subject: fill(recap.subject, ctx),
      html: fill(wrap(recap.subject, bodyHtml, ctx), ctx),
      text: fill(text, ctx),
    };
  }
  const t = TEMPLATES[key];
  if (!t) return null;

  // The franchisee's own message (G2) rides on the booking confirmation — the
  // one email every customer definitely reads. It is appended AFTER fill() has
  // run on the template so the message text is never treated as a template
  // itself (a customer-visible "{{" would otherwise blank out).
  const wantsFranchiseeMessage = key === 'booking_confirmation';
  const messageHtml = wantsFranchiseeMessage ? franchiseeMessageHtml(ctx) : '';
  const messageText = wantsFranchiseeMessage ? franchiseeMessageText(ctx) : '';

  return {
    subject: fill(t.subject, ctx),
    html: wrap(
      fill(t.subject.replace(/\s*\(\{\{booking_reference\}\}\)/, ''), ctx),
      fill(t.bodyHtml, ctx),
      ctx,
      undefined,
      messageHtml,
    ),
    text: fill(t.text, ctx) + messageText,
  };
}
