/**
 * Wave 7 VERIFIER peer test — courseListQueries month-bound resolver.
 *
 * useOwnCoursesForMonth computes the calendar month's SQL bounds WITHOUT a
 * Date constructor or UTC arithmetic:
 *   fromBound = 'YYYY-MM-01'  (inclusive, gte)
 *   toBound   = next-month 'YYYY-MM-01'  (exclusive, lt)
 *
 * This test captures the .gte / .lt arguments the hook sends to Supabase and
 * asserts:
 *   - a normal month (March 2025) -> 2025-03-01 .. 2025-04-01
 *   - a year rollback (December 2025) -> 2025-12-01 .. 2026-01-01
 *   - single-digit months are zero-padded
 *   - it is driven entirely by the integer year/month args (no local-time
 *     dependence), so the bounds are identical regardless of the host TZ.
 *
 * The query builder + React Query are mocked; nothing hits the network.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Capture the query builder calls ---------------------------------------
interface Captured {
  table: string;
  gte?: [string, string];
  lt?: [string, string];
}
const captured: Captured = { table: '' };

function makeBuilder() {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = vi.fn(chain);
  builder.order = vi.fn(chain);
  builder.gte = vi.fn((col: string, val: string) => {
    captured.gte = [col, val];
    return builder;
  });
  builder.lt = vi.fn((col: string, val: string) => {
    captured.lt = [col, val];
    return builder;
  });
  // Make the builder awaitable -> resolves to an empty result set.
  builder.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
    resolve({ data: [], error: null });
  return builder;
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      captured.table = table;
      return makeBuilder();
    },
  },
}));

type QueryOpts = { queryFn?: () => Promise<unknown> };
const capture: { last: QueryOpts | null } = { last: null };
function setLast(opts: QueryOpts | null) {
  capture.last = opts;
}
function getLast(): QueryOpts | null {
  return capture.last;
}
vi.mock('@tanstack/react-query', () => ({
  useQuery: (opts: QueryOpts) => {
    setLast(opts);
    return { data: [], isLoading: false, error: null };
  },
}));

import { useOwnCoursesForMonth } from './courseListQueries';

async function runQueryFnFor(year: number, month: number) {
  setLast(null);
  // useQuery is mocked above to a plain capture function, so this is safe to
  // call outside a React component in this test.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useOwnCoursesForMonth(year, month);
  const queryFn = getLast()?.queryFn;
  if (!queryFn) throw new Error('queryFn not captured');
  await queryFn();
}

describe('useOwnCoursesForMonth bounds', () => {
  beforeEach(() => {
    captured.table = '';
    captured.gte = undefined;
    captured.lt = undefined;
  });

  it('queries da_course_instances', async () => {
    await runQueryFnFor(2025, 3);
    expect(captured.table).toBe('da_course_instances');
  });

  it('March 2025 -> [2025-03-01, 2025-04-01)', async () => {
    await runQueryFnFor(2025, 3);
    expect(captured.gte).toEqual(['event_date', '2025-03-01']);
    expect(captured.lt).toEqual(['event_date', '2025-04-01']);
  });

  it('December 2025 rolls over to January 2026', async () => {
    await runQueryFnFor(2025, 12);
    expect(captured.gte).toEqual(['event_date', '2025-12-01']);
    expect(captured.lt).toEqual(['event_date', '2026-01-01']);
  });

  it('zero-pads single-digit months', async () => {
    await runQueryFnFor(2025, 1);
    expect(captured.gte).toEqual(['event_date', '2025-01-01']);
    expect(captured.lt).toEqual(['event_date', '2025-02-01']);
  });
});
