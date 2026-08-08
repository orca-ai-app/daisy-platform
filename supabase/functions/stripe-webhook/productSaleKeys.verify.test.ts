/**
 * VERIFIER peer test — the sellable-items path (migration 044).
 *
 * Why this matters (critical):
 *   recordProductSale() inserts a da_email_sequences row DIRECTLY, bypassing
 *   buildJourneyRows and the ALLOWED_TEMPLATE_KEYS guard that protects the
 *   booking path (templateKeys.verify.test.ts). If 'product_purchase_confirmation'
 *   is ever missing from the migration-044 CHECK, the insert violates the
 *   constraint at runtime — after money has moved — and the buyer never gets
 *   their e-learning access link.
 *
 *   Two further silent-failure modes are guarded here:
 *     - migration 044 must reproduce migration 040's FULL key list (the CHECK is
 *       drop-and-recreate, so an omission silently revokes a live key);
 *     - booking_id must be nullable and product_sale_id must exist, because a
 *       product purchase has no booking to anchor to.
 *
 * Reads the real source files from disk so it cannot drift the way a
 * hand-copied constant would.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', '..', 'migrations');

const webhookSrc = readFileSync(join(here, 'index.ts'), 'utf8');
const migration040 = readFileSync(join(migrationsDir, '040_prelaunch_courses.sql'), 'utf8');
const migration044 = readFileSync(join(migrationsDir, '044_sellable_items.sql'), 'utf8');
const templatesSrc = readFileSync(join(here, '..', 'send-emails', 'templates.ts'), 'utf8');
const sendEmailsSrc = readFileSync(join(here, '..', 'send-emails', 'index.ts'), 'utf8');

// Pull the keys out of the enforced `ADD CONSTRAINT ... CHECK (template_key IN (...))`
// block — same approach as templateKeys.verify.test.ts.
function extractTemplateKeys(sql: string): Set<string> {
  const idx = sql.indexOf('template_key IN (');
  const inClause = sql.slice(idx, sql.indexOf('))', idx) + 1);
  return new Set([...inClause.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]));
}

const keys040 = extractTemplateKeys(migration040);
const keys044 = extractTemplateKeys(migration044);

describe('migration 044 template_key CHECK', () => {
  it('parsed both key sets', () => {
    expect(keys040.size).toBeGreaterThanOrEqual(20);
    expect(keys044.size).toBe(keys040.size + 1);
  });

  it('allows product_purchase_confirmation', () => {
    expect(keys044.has('product_purchase_confirmation')).toBe(true);
  });

  it('reproduces every key migration 040 allowed (drop-and-recreate loses nothing)', () => {
    const dropped = [...keys040].filter((k) => !keys044.has(k));
    expect(dropped).toEqual([]);
  });
});

describe('the key the webhook queues for a product sale is constraint-safe', () => {
  it('recordProductSale queues exactly the keys migration 044 allows', () => {
    const start = webhookSrc.indexOf('async function recordProductSale');
    expect(start).toBeGreaterThan(-1);
    const block = webhookSrc.slice(start);
    const queued = [...block.matchAll(/template_key:\s*'([a-z0-9_]+)'/g)].map((m) => m[1]);
    expect(queued).toEqual(['product_purchase_confirmation']);
    expect(queued.filter((k) => !keys044.has(k))).toEqual([]);
  });

  it("uses 'card' — an existing da_product_sales payment_method value (migration 038)", () => {
    const start = webhookSrc.indexOf('async function recordProductSale');
    const block = webhookSrc.slice(start);
    const method = block.match(/payment_method:\s*'([a-z]+)'/)?.[1];
    expect(['cash', 'card', 'other']).toContain(method);
  });

  it("stamps channel 'online' so billing and reporting can tell the two apart", () => {
    const start = webhookSrc.indexOf('async function recordProductSale');
    expect(webhookSrc.slice(start)).toContain("channel: 'online'");
  });
});

describe('da_email_sequences can anchor to a product sale', () => {
  it('migration 044 drops the NOT NULL on booking_id', () => {
    expect(migration044).toMatch(/ALTER COLUMN booking_id DROP NOT NULL/);
  });

  it('migration 044 adds product_sale_id', () => {
    expect(migration044).toMatch(/ADD COLUMN IF NOT EXISTS product_sale_id UUID/);
  });

  it('send-emails selects and branches on product_sale_id', () => {
    expect(sendEmailsSrc).toContain('product_sale_id');
    expect(sendEmailsSrc).toContain('if (row.product_sale_id)');
  });
});

describe('product_purchase_confirmation renders', () => {
  it('templates.ts handles the key', () => {
    expect(templatesSrc).toContain("key === 'product_purchase_confirmation'");
  });

  it('surfaces the fulfilment URL and guards its absence for physical items', () => {
    expect(templatesSrc).toContain('fulfilment_url');
    // The physical fallback must exist — a missing link must never render an
    // empty button.
    expect(templatesSrc).toContain('Your instructor will be in touch');
  });
});
