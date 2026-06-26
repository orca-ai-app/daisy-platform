// Email templates for the send-emails cron. One entry per da_email_sequences
// template_key (migration 028). Variables are filled with simple {{mustache}}
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
}

function fill(s: string, ctx: TemplateContext): string {
  return s.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => (ctx as any)[k] ?? '');
}

const DAISY_BLUE = '#006FAC';

function wrap(title: string, bodyHtml: string, ctx: TemplateContext): string {
  return `<!doctype html><html><body style="margin:0;background:#f5f9fb;font-family:Poppins,Arial,sans-serif;color:#1a4359">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="background:#fff;border-radius:14px;padding:28px">
      <h1 style="font-family:Quicksand,Arial,sans-serif;color:${DAISY_BLUE};font-size:22px;margin:0 0 16px">${title}</h1>
      ${bodyHtml}
      <p style="color:#5a7a8f;font-size:13px;margin-top:24px">With love,<br/>${ctx.franchisee_name} &amp; the Daisy First Aid team</p>
    </div>
    <p style="color:#9bb0bd;font-size:11px;text-align:center;margin-top:16px">
      You're receiving this because you booked a Daisy First Aid class.
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

export function renderTemplate(
  key: string,
  ctx: TemplateContext,
): { subject: string; html: string; text: string } | null {
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
  return {
    subject: fill(t.subject, ctx),
    html: fill(
      wrap(t.subject.replace(/\s*\(\{\{booking_reference\}\}\)/, ''), t.bodyHtml, ctx),
      ctx,
    ),
    text: fill(t.text, ctx),
  };
}
