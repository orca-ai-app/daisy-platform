/**
 * The widget's trainer "Request a class" form sends the franchisee NUMBER.
 * It must be resolved to the uuid before the insert (production 500s with a
 * number, 30 Sep 2026).
 */

import { describe, it, expect, vi } from 'vitest';
import { resolveFranchiseeId } from './resolveFranchisee.ts';

const UUID = '6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f';

describe('resolveFranchiseeId', () => {
  it('passes a uuid straight through without a lookup', async () => {
    const lookup = vi.fn();
    expect(await resolveFranchiseeId(UUID, lookup)).toEqual({ ok: true, id: UUID });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('resolves a trainer number to its uuid', async () => {
    const lookup = vi.fn(async (num: string) => (num === '0086' ? UUID : null));
    expect(await resolveFranchiseeId('0086', lookup)).toEqual({ ok: true, id: UUID });
    expect(lookup).toHaveBeenCalledWith('0086');
  });

  it('resolves a non-numeric number such as OMG1', async () => {
    const lookup = vi.fn(async () => UUID);
    expect(await resolveFranchiseeId('OMG1', lookup)).toEqual({ ok: true, id: UUID });
  });

  it('rejects an unknown number', async () => {
    expect(await resolveFranchiseeId('9999', async () => null)).toEqual({
      ok: false,
      error: 'Unknown trainer',
    });
  });

  it('leaves a vacant-area enquiry (no trainer) alone', async () => {
    const lookup = vi.fn();
    expect(await resolveFranchiseeId(null, lookup)).toEqual({ ok: true, id: null });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('lets a database error propagate so the caller can 500', async () => {
    await expect(
      resolveFranchiseeId('0086', async () => {
        throw new Error('db down');
      }),
    ).rejects.toThrow('db down');
  });
});
