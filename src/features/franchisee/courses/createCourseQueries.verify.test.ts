/**
 * Wave 7 VERIFIER peer test — createCourseQueries.
 *
 * Covers the create-course territory-conflict handling:
 *   - A 409 response from create-course-instance is mapped to a
 *     TerritoryConflictError carrying the server-derived warning.
 *   - The message differentiates owned_by_other vs vacant.
 *   - A 201 response resolves to the success body.
 *   - A non-409 error surfaces the EF's `error` string.
 *
 * The Supabase client + global fetch are mocked so the test is fully
 * deterministic and never touches the network.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mock the Supabase client (session token only) -------------------------
const getSessionMock = vi.fn();
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: () => getSessionMock() },
  },
}));

// --- Mock React Query so we can capture the hook's mutationFn --------------
// useMutation simply records the options it is called with; useQueryClient
// returns a no-op stub. This lets us pull out the real callCreateCourseInstance
// (module-private) and exercise its fetch/error mapping directly.
type MutationOpts = { mutationFn?: (b: unknown) => Promise<unknown> };
const capture: { last: MutationOpts | null } = { last: null };
function setLast(opts: MutationOpts | null) {
  capture.last = opts;
}
function getLast(): MutationOpts | null {
  return capture.last;
}
vi.mock('@tanstack/react-query', () => ({
  useMutation: (opts: MutationOpts) => {
    setLast(opts);
    return {};
  },
  useQuery: () => ({ data: undefined, isLoading: false, error: null }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

import { TerritoryConflictError, useCreateCourseInstance } from './createCourseQueries';

import type { CreateCourseInstanceRequest, CreateCourseInstanceTerritoryConflict } from './types';

describe('TerritoryConflictError', () => {
  it('uses the owned_by_other copy for owned_by_other warnings', () => {
    const err = new TerritoryConflictError({
      error: 'out_of_territory',
      warning: 'owned_by_other',
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('TerritoryConflictError');
    expect(err.conflict.warning).toBe('owned_by_other');
    expect(err.message).toMatch(/another franchisee/i);
  });

  it('uses the vacant copy for vacant warnings', () => {
    const err = new TerritoryConflictError({
      error: 'out_of_territory',
      warning: 'vacant',
    });
    expect(err.conflict.warning).toBe('vacant');
    expect(err.message).toMatch(/unallocated/i);
  });
});

// ---------------------------------------------------------------------------
// Exercise the real network mapping by reaching the module-private
// callCreateCourseInstance through the exported hook's mutationFn.
// We reconstruct the request flow by mocking fetch and getSession, then call
// the hook's mutationFn via a minimal harness.
// ---------------------------------------------------------------------------

const VALID_BODY: CreateCourseInstanceRequest = {
  template_id: '11111111-1111-1111-1111-111111111111',
  event_date: '2025-06-01',
  start_time: '10:00',
  end_time: '12:00',
  venue_postcode: 'SM1 1AB',
  visibility: 'public',
  capacity: 12,
  price_pence: 5500,
  ticket_types: [
    { name: 'Single', price_pence: 5500, seats_consumed: 1, max_available: null, sort_order: 0 },
  ],
  out_of_territory_confirmed: false,
};

describe('useCreateCourseInstance mutationFn (network mapping)', () => {
  beforeEach(() => {
    getSessionMock.mockReset();
    getSessionMock.mockResolvedValue({ data: { session: { access_token: 'tok-123' } } });
    vi.stubGlobal('fetch', vi.fn());
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  // Pull the mutationFn out of the hook without rendering React.
  function getMutationFn(): (b: CreateCourseInstanceRequest) => Promise<unknown> {
    setLast(null);
    // useMutation is mocked above to a plain capture function, so this is safe
    // to call outside a React component in this test.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useCreateCourseInstance();
    const fn = getLast()?.mutationFn;
    if (!fn) throw new Error('mutationFn was not captured');
    return fn as (b: CreateCourseInstanceRequest) => Promise<unknown>;
  }

  it('throws TerritoryConflictError on a 409 response', async () => {
    const conflict: CreateCourseInstanceTerritoryConflict = {
      error: 'out_of_territory',
      warning: 'owned_by_other',
    };
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 409,
      ok: false,
      json: async () => conflict,
    });

    const fn = getMutationFn();
    await expect(fn(VALID_BODY)).rejects.toBeInstanceOf(TerritoryConflictError);
  });

  it('resolves the success body on 201', async () => {
    const success = {
      instance: { id: 'abc' },
      ticket_types: [],
      out_of_territory_warning: 'none',
    };
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 201,
      ok: true,
      json: async () => success,
    });

    const fn = getMutationFn();
    await expect(fn(VALID_BODY)).resolves.toEqual(success);
  });

  it('surfaces the EF error string on a non-409 failure', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 400,
      ok: false,
      json: async () => ({ error: 'capacity must be a positive integer' }),
    });

    const fn = getMutationFn();
    await expect(fn(VALID_BODY)).rejects.toThrow('capacity must be a positive integer');
  });

  it('throws a signed-in error when there is no session token', async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } });
    const fn = getMutationFn();
    await expect(fn(VALID_BODY)).rejects.toThrow(/signed in/i);
  });
});
