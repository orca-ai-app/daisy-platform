/**
 * VERIFIER peer test — the trainer's shop-order alert (migration 071).
 *
 * Standalone online shop purchases used to tell only the buyer. E-learning
 * buyers are promised access "within 48 hours" and the trainer sets them up
 * by hand, so an untold trainer meant an indefinite wait. These checks pin:
 *   - migration 071 recreates the template_key CHECK with EVERY key from 066
 *     (drop-and-recreate, so an omission silently revokes a live key) plus
 *     product_sale_notification, and nothing else;
 *   - the webhook queues the alert for a standalone sale, anchored to the sale;
 *   - a basket's shop items queue nothing (their order alert lists them);
 *   - send-emails routes the key to the franchisee, on the outbound stream,
 *     with no suppression check;
 *   - trainers can read customers who bought from them, read-only.
 *
 * Reads the real source files so it cannot drift from them.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fns = join(here, '..');
const migrationsDir = join(fns, '..', 'migrations');
const read = (p: string) => readFileSync(join(fns, p), 'utf8');

const webhook = read('stripe-webhook/index.ts');
const sendEmails = read('send-emails/index.ts');
const migration066 = readFileSync(join(migrationsDir, '066_checkout_recovery.sql'), 'utf8');
const migration071 = readFileSync(
  join(migrationsDir, '071_shop_sale_trainer_visibility.sql'),
  'utf8',
);

/** Keys inside `check (template_key = any (array[ ... ]))`. */
function checkKeys(sql: string): string[] {
  const start = sql.indexOf('template_key = any (array[');
  expect(start, 'CHECK block found').toBeGreaterThan(-1);
  const block = sql.slice(start, sql.indexOf(']::text[]', start));
  return [...block.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
}

function fnBody(src: string, name: string): string {
  const start = src.indexOf(`async function ${name}(`);
  expect(start, `${name} exists`).toBeGreaterThan(-1);
  const next = src.indexOf('\nasync function ', start + 10);
  return src.slice(start, next === -1 ? undefined : next);
}

describe('migration 071 template_key CHECK', () => {
  const keys066 = checkKeys(migration066);
  const keys071 = checkKeys(migration071);

  it('parsed both key sets', () => {
    expect(keys066.length).toBe(29);
    expect(new Set(keys071).size).toBe(keys071.length);
  });

  it('keeps every key 066 allowed', () => {
    expect(keys066.filter((k) => !keys071.includes(k))).toEqual([]);
  });

  it('adds exactly product_sale_notification', () => {
    expect(keys071.filter((k) => !keys066.includes(k))).toEqual(['product_sale_notification']);
  });

  it('drops and re-adds the named constraint', () => {
    expect(migration071).toMatch(/drop constraint if exists da_email_sequences_template_key_check/);
    expect(migration071).toMatch(/add constraint da_email_sequences_template_key_check/);
  });
});

describe('migration 071 customer visibility', () => {
  it('adds a SELECT-only policy for customers with a shop sale for this trainer', () => {
    const policy = migration071.slice(migration071.indexOf('create policy'));
    expect(policy).toMatch(/on da_customers\s+for select using/);
    expect(policy).toMatch(/from da_product_sales/);
    expect(policy).toMatch(/franchisee_id = get_current_franchisee_id\(\)/);
  });

  it('leaves the bookings rule alone and grants no write', () => {
    // Statements only: the header comments may name the existing policy.
    const sql = migration071.replace(/--.*$/gm, '');
    expect(sql).not.toMatch(/franchisee_read_own_customers/);
    expect(sql).not.toMatch(/for (all|insert|update|delete)/i);
  });
});

describe('webhook queues the trainer alert', () => {
  it('a standalone sale queues product_sale_notification anchored to the sale', () => {
    const fn = fnBody(webhook, 'recordProductSale');
    const at = fn.indexOf("template_key: 'product_sale_notification'");
    expect(at).toBeGreaterThan(-1);
    const insert = fn.slice(fn.lastIndexOf('.insert({', at), fn.indexOf('});', at));
    expect(insert).toMatch(/customer_id: customerId/);
    expect(insert).toMatch(/booking_id: null/);
    expect(insert).toMatch(/product_sale_id: saleId/);
    expect(insert).toMatch(/status: 'pending'/);
    expect(insert).toMatch(/scheduled_for: new Date\(\)\.toISOString\(\)/);
  });

  it('a failed queue is logged loudly, not swallowed', () => {
    const fn = fnBody(webhook, 'recordProductSale');
    expect(fn).toMatch(/product_sale_notification FAILED to queue/);
  });

  it('basket shop items queue no trainer alert (the order alert lists them)', () => {
    const items = fnBody(webhook, 'recordOrderItems');
    expect(items).not.toMatch(/product_sale_notification/);
    expect(items).not.toMatch(/da_email_sequences/);
  });
});

describe('send-emails routes the alert to the trainer', () => {
  const saleBranch = sendEmails.slice(
    sendEmails.indexOf('if (row.product_sale_id)'),
    sendEmails.indexOf('// Load booking → customer'),
  );

  it('sends product_sale_notification to the franchisee email', () => {
    expect(saleBranch).toMatch(
      /const toFranchisee = row\.template_key === 'product_sale_notification'/,
    );
    expect(saleBranch).toMatch(
      /const recipient = toFranchisee \? s\.franchisee\?\.email : s\.customer\?\.email/,
    );
  });

  it('loads the buyer phone for the alert', () => {
    expect(saleBranch).toMatch(/customer:da_customers \( first_name, last_name, email, phone \)/);
  });

  it('is transactional: outbound stream, never suppressed', () => {
    expect(saleBranch).toMatch(/'outbound',\n\s*\);/);
    expect(saleBranch).not.toMatch(/suppressed\.has|marketing_opt_out/);
    expect(saleBranch).not.toMatch(/'broadcasts'/);
  });
});
