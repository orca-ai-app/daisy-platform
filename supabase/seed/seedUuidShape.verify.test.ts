/**
 * Wave 9 VERIFIER peer test — every UUID-shaped literal in seed-dev.sql must be
 * valid hexadecimal so PostgreSQL's `uuid` type accepts it.
 *
 * Regression guard for the Wave 9D defect where the new id namespaces
 * (d1f4tt90 / d1fapc00 / d1fdsc00) contained non-hex letters (t, p, s), which
 * would make PostgreSQL reject the whole M2 seed transaction with
 * "invalid input syntax for type uuid".
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const seedPath = join(here, 'seed-dev.sql');

const UUID_SHAPED =
  /'([0-9a-zA-Z]{8}-[0-9a-zA-Z]{4}-[0-9a-zA-Z]{4}-[0-9a-zA-Z]{4}-[0-9a-zA-Z]{12})'/g;
const HEX_UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

describe('seed-dev.sql UUID literals', () => {
  const sql = readFileSync(seedPath, 'utf8');

  it('contains UUID-shaped literals (sanity: the file was read)', () => {
    const matches = [...sql.matchAll(UUID_SHAPED)];
    expect(matches.length).toBeGreaterThan(100);
  });

  it('every UUID-shaped literal is valid hexadecimal', () => {
    const invalid = [...sql.matchAll(UUID_SHAPED)]
      .map((m) => m[1])
      .filter((u) => !HEX_UUID.test(u));
    expect(invalid).toEqual([]);
  });
});
