/**
 * useOwnCourses visibility filter (TRI-0037, October batch A4).
 *
 * The filter must run in the database query (so it works across pages), as
 * an eq on da_course_instances.visibility, and add nothing for "All classes".
 * The query builder and React Query are mocked; nothing hits the network.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OwnCoursesFilters } from './courseListQueries';

const calls: Array<[string, ...unknown[]]> = [];

function makeBuilder() {
  const builder: Record<string, unknown> = {};
  for (const m of ['select', 'order', 'eq', 'in', 'gte', 'lte', 'or', 'range']) {
    builder[m] = vi.fn((...args: unknown[]) => {
      calls.push([m, ...args]);
      return builder;
    });
  }
  builder.then = (resolve: (v: { data: unknown[]; count: number; error: null }) => unknown) =>
    resolve({ data: [], count: 0, error: null });
  return builder;
}

vi.mock('@/lib/supabase', () => ({
  supabase: { from: () => makeBuilder() },
}));

type QueryOpts = { queryKey: unknown[]; queryFn?: () => Promise<unknown> };
const capture: { last: QueryOpts | null } = { last: null };
vi.mock('@tanstack/react-query', () => ({
  useQuery: (opts: QueryOpts) => {
    capture.last = opts;
    return { data: undefined, isLoading: false, isFetching: false, error: null };
  },
}));

import { useOwnCourses } from './courseListQueries';

async function run(filters: OwnCoursesFilters) {
  capture.last = null;
  // useQuery is mocked to a plain capture function, so this is safe outside React.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useOwnCourses(filters);
  const opts = capture.last as QueryOpts | null;
  if (!opts?.queryFn) throw new Error('queryFn not captured');
  await opts.queryFn();
  return opts;
}

describe('useOwnCourses visibility filter', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('Public filters the query to visibility = public', async () => {
    await run({ visibility: 'public' });
    expect(calls).toContainEqual(['eq', 'visibility', 'public']);
  });

  it('Private filters the query to visibility = private (hidden and private-client)', async () => {
    await run({ visibility: 'private', status: 'scheduled' });
    expect(calls).toContainEqual(['eq', 'visibility', 'private']);
    expect(calls).toContainEqual(['eq', 'status', 'scheduled']);
  });

  it('All classes adds no visibility filter (and is the default)', async () => {
    await run({ visibility: 'all' });
    expect(calls.some((c) => c[0] === 'eq' && c[1] === 'visibility')).toBe(false);
    calls.length = 0;
    await run({});
    expect(calls.some((c) => c[0] === 'eq' && c[1] === 'visibility')).toBe(false);
  });

  it('is part of the cache key, so switching it refetches', async () => {
    const pub = await run({ visibility: 'public' });
    const priv = await run({ visibility: 'private' });
    expect(JSON.stringify(pub.queryKey)).not.toBe(JSON.stringify(priv.queryKey));
  });

  it('still pages server-side with the filter on', async () => {
    await run({ visibility: 'public', page: 2, pageSize: 20 });
    expect(calls).toContainEqual(['range', 40, 59]);
  });
});
