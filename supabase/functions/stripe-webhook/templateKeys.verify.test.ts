/**
 * Wave 8 VERIFIER peer test — the webhook's email-sequence template_key set
 * MUST be a subset of migration 020's CHECK constraint set.
 *
 * Why this matters (critical):
 *   stripe-webhook/index.ts inserts da_email_sequences rows on
 *   checkout.session.completed. Migration 020 puts a CHECK on
 *   da_email_sequences.template_key. If the webhook ever queues a key that is
 *   NOT in the migration-020 allowed set, the INSERT violates the constraint at
 *   runtime — *after* money has already moved through Stripe — and the email
 *   queue silently fails (the booking still lands, but the customer/franchisee
 *   never get their confirmation/refreshers).
 *
 * This test reads BOTH files from disk and asserts:
 *   1. Every key in the webhook's ALLOWED_TEMPLATE_KEYS Set is present in the
 *      migration-020 CHECK list.
 *   2. Every template_key the webhook actually QUEUES (the push(...) calls in
 *      buildEmailSequenceRows) is in the migration-020 set.
 *
 * It is a guard, not a re-implementation: it parses the real source so it
 * cannot drift out of sync the way a hand-copied constant would.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const webhookSrc = readFileSync(join(here, 'index.ts'), 'utf8');
// Migration 028 supersedes 020 — it widens the CHECK to Daisy's real Kartra
// journey. The webhook must only queue keys in this (current) allowed set.
const migration028 = readFileSync(
  join(here, '..', '..', 'migrations', '028_email_journey_keys.sql'),
  'utf8',
);

// ---------------------------------------------------------------------------
// Extract the migration-020 CHECK allowed set.
// We grab the ALTER TABLE ... ADD CONSTRAINT ... CHECK (template_key IN (...))
// block (the enforced one — there is also a guard DO-block earlier) and pull
// every single-quoted literal out of it.
// ---------------------------------------------------------------------------

function extractMigrationKeys(sql: string): Set<string> {
  const checkBlock = sql.slice(sql.indexOf('ADD CONSTRAINT'));
  const inClause = checkBlock.slice(
    checkBlock.indexOf('template_key IN ('),
    checkBlock.indexOf('))', checkBlock.indexOf('template_key IN (')) + 1,
  );
  const keys = [...inClause.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
  return new Set(keys);
}

// ---------------------------------------------------------------------------
// Extract the webhook's ALLOWED_TEMPLATE_KEYS Set literal.
// ---------------------------------------------------------------------------

function extractWebhookAllowedSet(src: string): Set<string> {
  const start = src.indexOf('const ALLOWED_TEMPLATE_KEYS = new Set([');
  const end = src.indexOf(']);', start);
  const block = src.slice(start, end);
  const keys = [...block.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
  return new Set(keys);
}

// ---------------------------------------------------------------------------
// Extract the keys the webhook actually queues via push('<key>', ...).
// ---------------------------------------------------------------------------

function extractQueuedKeys(src: string): string[] {
  // Only the buildEmailSequenceRows body calls push('<literal>', ...).
  return [...src.matchAll(/push\(\s*'([a-z0-9_]+)'/g)].map((m) => m[1]);
}

const migrationKeys = extractMigrationKeys(migration028);
const allowedSet = extractWebhookAllowedSet(webhookSrc);
const queuedKeys = extractQueuedKeys(webhookSrc);

// ---------------------------------------------------------------------------
// Sanity: parsing actually found something.
// ---------------------------------------------------------------------------

describe('template_key extraction (sanity)', () => {
  it('parsed the migration-020 CHECK set', () => {
    expect(migrationKeys.size).toBeGreaterThanOrEqual(12);
    expect(migrationKeys.has('booking_confirmation')).toBe(true);
  });

  it('parsed the webhook ALLOWED_TEMPLATE_KEYS set', () => {
    expect(allowedSet.size).toBeGreaterThanOrEqual(12);
    expect(allowedSet.has('booking_confirmation')).toBe(true);
  });

  it('parsed the keys the webhook actually queues', () => {
    expect(queuedKeys.length).toBeGreaterThan(0);
    expect(queuedKeys).toContain('booking_confirmation');
  });
});

// ---------------------------------------------------------------------------
// The critical subset checks.
// ---------------------------------------------------------------------------

describe('webhook template_key set ⊆ migration 028 CHECK set', () => {
  it('every webhook ALLOWED_TEMPLATE_KEYS entry exists in the migration set', () => {
    const orphans = [...allowedSet].filter((k) => !migrationKeys.has(k));
    expect(orphans).toEqual([]);
  });

  it('the webhook set is a subset of the migration CHECK set', () => {
    // Migration 028 also allows legacy + billing keys the webhook never queues,
    // so the sets are NOT identical — but the webhook's set must be a subset so
    // every key it could insert is constraint-safe.
    const subset = [...allowedSet].every((k) => migrationKeys.has(k));
    expect(subset).toBe(true);
  });
});

describe('every QUEUED template_key is constraint-safe', () => {
  it('every push() key is in the migration-028 CHECK set', () => {
    const violations = queuedKeys.filter((k) => !migrationKeys.has(k));
    expect(violations).toEqual([]);
  });

  it('every push() key is also in the webhook ALLOWED_TEMPLATE_KEYS set', () => {
    const violations = queuedKeys.filter((k) => !allowedSet.has(k));
    expect(violations).toEqual([]);
  });

  it('queues the immediate pair, the pre-event reminder and the Kartra journey', () => {
    // Documents the actual runtime schedule (Daisy's Kartra journey) so a future
    // edit that drops one is caught. Legacy interval keys are intentionally NOT
    // queued any more — assert their absence so re-adding is a deliberate change.
    expect(new Set(queuedKeys)).toEqual(
      new Set([
        'new_booking_notification',
        'booking_confirmation',
        'medical_reminder',
        'post_course_welcome',
        'recap_anaphylaxis',
        'recap_choking',
        'recap_head_injuries',
        'recap_cpr',
        'recap_febrile_convulsions',
        'recap_burns',
        'quiz_general',
        'refresher',
        'refresher_elearning_option',
      ]),
    );
    expect(queuedKeys).not.toContain('refresher_6w');
    expect(queuedKeys).not.toContain('fee_invoice');
  });
});
