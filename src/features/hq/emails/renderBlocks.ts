// MIRROR of supabase/functions/_shared/emailBlocks.ts — keep byte-identical below this line.
// The Deno/Vite split precludes a shared import; the editor's live preview must
// match exactly what send-emails produces. If you change one, change both.

export type EmailBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'image'; src: string; alt?: string; href?: string; width?: number }
  | { type: 'button'; label: string; url: string }
  | { type: 'list'; items: string[] }
  | { type: 'divider' };

export interface RenderContext {
  first_name: string;
  customer_name: string;
  template_name: string;
  event_date: string;
  start_time: string;
  venue: string;
  franchisee_name: string;
  franchisee_email: string;
  booking_reference: string;
  unsubscribe_url: string;
}

const DAISY_BLUE = '#006FAC';
const DAISY_DARK = '#1a4359';
const ASSETS_BASE =
  'https://dmvajkreuwknjqxyxmlv.supabase.co/storage/v1/object/public/email-assets';
const LOGO_URL = `${ASSETS_BASE}/dfa-logo.png`;
const FACEBOOK_URL = 'https://www.facebook.com/daisyfirstaid';
const INSTAGRAM_URL = 'https://www.instagram.com/daisyfirstaid';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Inline markdown subset over already-escaped text: [label](url), **bold**, *italic*.
function inline(s: string): string {
  return escapeHtml(s)
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
      `<a href="$2" style="color:${DAISY_BLUE};font-weight:600">$1</a>`,
    )
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

// Plain-text form of the same subset: strip formatting, keep "label (url)".
function inlineText(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 ($2)')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1');
}

export function fillMerge(s: string, ctx: RenderContext): string {
  return s.replace(
    /\{\{(\w+)\}\}/g,
    (_m, k: string) => (ctx as unknown as Record<string, string>)[k] ?? '',
  );
}

function renderBlockHtml(block: EmailBlock): string {
  switch (block.type) {
    case 'heading':
      return `<h2 style="font-family:Quicksand,Arial,sans-serif;color:${DAISY_BLUE};font-size:20px;line-height:1.3;margin:24px 0 12px">${inline(block.text)}</h2>`;
    case 'paragraph':
      return `<p style="font-size:15px;line-height:1.6;margin:0 0 14px">${inline(block.text)}</p>`;
    case 'image': {
      const width = block.width && block.width > 0 && block.width <= 560 ? block.width : 560;
      const img = `<img src="${escapeHtml(block.src)}" alt="${escapeHtml(block.alt ?? '')}" width="${width}" style="display:block;max-width:100%;width:${width}px;height:auto;border-radius:10px;margin:0 auto" />`;
      const inner = block.href
        ? `<a href="${escapeHtml(block.href)}" target="_blank">${img}</a>`
        : img;
      return `<div style="margin:18px 0;text-align:center">${inner}</div>`;
    }
    case 'button':
      return `<div style="text-align:center;margin:22px 0"><a href="${escapeHtml(block.url)}" target="_blank" style="display:inline-block;background:${DAISY_BLUE};color:#ffffff;font-family:Quicksand,Arial,sans-serif;font-weight:700;font-size:15px;text-decoration:none;padding:13px 30px;border-radius:999px">${inline(block.label)}</a></div>`;
    case 'list':
      return `<ul style="font-size:15px;line-height:1.6;margin:0 0 14px;padding-left:22px">${block.items
        .map((item) => `<li style="margin:0 0 6px">${inline(item)}</li>`)
        .join('')}</ul>`;
    case 'divider':
      return '<hr style="border:none;border-top:1px solid #e1ecf2;margin:24px 0" />';
    default:
      return '';
  }
}

function renderBlockText(block: EmailBlock): string {
  switch (block.type) {
    case 'heading':
      return `\n${inlineText(block.text).toUpperCase()}\n`;
    case 'paragraph':
      return inlineText(block.text);
    case 'image':
      return block.href ? `[Image: ${block.alt ?? 'image'}] ${block.href}` : '';
    case 'button':
      return `${inlineText(block.label)}: ${block.url}`;
    case 'list':
      return block.items.map((item) => `  - ${inlineText(item)}`).join('\n');
    case 'divider':
      return '---';
    default:
      return '';
  }
}

export interface RenderOptions {
  // 'marketing' (default): unsubscribe link + booking rationale in the footer.
  // 'operational': franchisee/internal mail — no unsubscribe, franchisee rationale.
  footer?: 'marketing' | 'operational';
}

function shell(
  bodyHtml: string,
  ctx: RenderContext,
  preheader?: string,
  opts?: RenderOptions,
): string {
  const preheaderHtml = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${escapeHtml(preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>`
    : '';
  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f5f9fb;font-family:Poppins,Arial,sans-serif;color:${DAISY_DARK}">
  ${preheaderHtml}
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f5f9fb">
    <tr><td align="center" style="padding:24px 12px">
      <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;width:100%">
        <tr><td align="center" style="padding:0 0 18px">
          <a href="https://www.daisyfirstaid.com" target="_blank"><img src="${LOGO_URL}" alt="Daisy First Aid" width="170" style="display:block;width:170px;height:auto" /></a>
        </td></tr>
        <tr><td style="background:#ffffff;border-radius:14px;padding:32px 32px 24px">
          ${bodyHtml}
        </td></tr>
        <tr><td align="center" style="padding:20px 12px 0">
          <p style="font-size:13px;color:#5a7a8f;margin:0 0 10px">Follow us</p>
          <p style="margin:0 0 16px">
            <a href="${FACEBOOK_URL}" target="_blank" style="color:${DAISY_BLUE};font-weight:600;text-decoration:none;font-size:13px">Facebook</a>
            &nbsp;&middot;&nbsp;
            <a href="${INSTAGRAM_URL}" target="_blank" style="color:${DAISY_BLUE};font-weight:600;text-decoration:none;font-size:13px">Instagram</a>
          </p>
          ${
            opts?.footer === 'operational'
              ? `<p style="font-size:11px;color:#9bb0bd;line-height:1.6;margin:0">
            You're receiving this as part of the Daisy First Aid network.<br />
            Daisy First Aid, daisyfirstaid.com
          </p>`
              : `<p style="font-size:11px;color:#9bb0bd;line-height:1.6;margin:0">
            You're receiving this because you booked a Daisy First Aid class.<br />
            <a href="${escapeHtml(ctx.unsubscribe_url)}" style="color:#9bb0bd">Unsubscribe</a>
            &nbsp;&middot;&nbsp; Daisy First Aid, daisyfirstaid.com
          </p>`
          }
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function renderBlocks(
  blocks: EmailBlock[],
  ctx: RenderContext,
  preheader?: string,
  opts?: RenderOptions,
): { html: string; text: string } {
  const bodyHtml = blocks.map(renderBlockHtml).join('\n');
  const html = fillMerge(shell(bodyHtml, ctx, preheader, opts), ctx);
  const bodyText = blocks
    .map(renderBlockText)
    .filter((s) => s.length > 0)
    .join('\n\n');
  const textFooter =
    opts?.footer === 'operational'
      ? '\n\n--\nDaisy First Aid | daisyfirstaid.com'
      : `\n\n--\nDaisy First Aid | daisyfirstaid.com\nUnsubscribe: ${ctx.unsubscribe_url}`;
  const text = fillMerge(`${bodyText}${textFooter}`, ctx);
  return { html, text };
}
