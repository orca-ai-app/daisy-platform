/**
 * TanStack Query hooks for Wave 7A (create-course wizard).
 *
 * useCourseTemplates()        — reads da_course_templates WHERE is_active = true,
 *                               anon client (templates are world-readable via RLS).
 * useCreateCourseInstance()   — mutation that POSTs to the create-course-instance
 *                               Edge Function with the caller's JWT. Returns the
 *                               success body or throws on non-2xx responses.
 *
 * Key factory: franchiseeKeys (frozen contract in ../queryKeys.ts).
 * Money: integer pence throughout.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { franchiseeKeys } from '../queryKeys';
import type {
  CourseTemplateOption,
  CreateCourseInstanceRequest,
  CreateCourseInstanceResponse,
  CreateCourseInstanceTerritoryConflict,
} from './types';

// ---------------------------------------------------------------------------
// useCourseTemplates
// ---------------------------------------------------------------------------

async function fetchCourseTemplates(): Promise<CourseTemplateOption[]> {
  const { data, error } = await supabase
    .from('da_course_templates')
    .select(
      `id,
       name,
       slug,
       duration_hours,
       default_price_pence,
       default_capacity,
       age_range,
       certification,
       description,
       is_active,
       is_online,
       default_ticket_types`,
    )
    .eq('is_active', true)
    .order('name', { ascending: true });

  if (error) throw error;
  return (data ?? []) as CourseTemplateOption[];
}

export function useCourseTemplates(): UseQueryResult<CourseTemplateOption[]> {
  return useQuery<CourseTemplateOption[]>({
    queryKey: franchiseeKeys.courseTemplates(),
    queryFn: fetchCourseTemplates,
    // Templates change rarely; 10 min stale time avoids redundant refetches
    // during the wizard lifecycle.
    staleTime: 10 * 60_000,
    retry: 2,
  });
}

// ---------------------------------------------------------------------------
// useRecentVenues (G6)
//
// The franchisee's own previously used venues, most recently scheduled first,
// so they can refill all three venue fields in one go instead of retyping a
// venue they run at every week. Read via the anon client + RLS — RLS already
// scopes da_course_instances to the caller, so there is no client-side
// franchisee_id filter.
// ---------------------------------------------------------------------------

export interface RecentVenue {
  venue_name: string;
  venue_address: string;
  venue_postcode: string;
}

/** Max distinct venues offered in the picker. */
const RECENT_VENUE_LIMIT = 10;

/**
 * Cache key, derived from the frozen franchiseeKeys.courses() root so it
 * invalidates with the rest of the course cache after a create.
 */
const recentVenuesKey = () => [...franchiseeKeys.courses(), 'recent-venues'] as const;

async function fetchRecentVenues(): Promise<RecentVenue[]> {
  // Over-fetch rows because we de-duplicate client-side (Postgrest has no
  // DISTINCT ON), then cap the distinct list.
  const { data, error } = await supabase
    .from('da_course_instances')
    .select('venue_name, venue_address, venue_postcode, event_date, created_at')
    .not('venue_name', 'is', null)
    .not('venue_postcode', 'is', null)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    // A missing table or a blocked read must not break the wizard — the
    // franchisee can still type the venue in by hand.
    console.error('recent venue lookup failed', error);
    return [];
  }

  type Row = {
    venue_name: string | null;
    venue_address: string | null;
    venue_postcode: string | null;
  };

  const seen = new Set<string>();
  const venues: RecentVenue[] = [];
  for (const row of (data ?? []) as Row[]) {
    const name = (row.venue_name ?? '').trim();
    const postcode = (row.venue_postcode ?? '').trim().toUpperCase();
    if (!name || !postcode) continue;
    const address = (row.venue_address ?? '').trim();
    const key = `${name.toLowerCase()}|${address.toLowerCase()}|${postcode}`;
    if (seen.has(key)) continue;
    seen.add(key);
    venues.push({ venue_name: name, venue_address: address, venue_postcode: postcode });
    if (venues.length >= RECENT_VENUE_LIMIT) break;
  }
  return venues;
}

export function useRecentVenues(): UseQueryResult<RecentVenue[]> {
  return useQuery<RecentVenue[]>({
    queryKey: recentVenuesKey(),
    queryFn: fetchRecentVenues,
    staleTime: 5 * 60_000,
  });
}

// ---------------------------------------------------------------------------
// Territory-conflict error class
//
// The Edge Function returns HTTP 409 with a CreateCourseInstanceTerritoryConflict
// body when a warning exists and out_of_territory_confirmed is not true.
// The wizard catches this and re-renders TerritoryWarning with the server-
// derived warning so the franchisee can tick confirm and resubmit.
// ---------------------------------------------------------------------------

export class TerritoryConflictError extends Error {
  constructor(public readonly conflict: CreateCourseInstanceTerritoryConflict) {
    super(
      conflict.warning === 'owned_by_other'
        ? "This venue is in another franchisee's territory. Please confirm to continue."
        : 'This venue is in an unallocated territory. Please confirm to continue.',
    );
    this.name = 'TerritoryConflictError';
  }
}

// ---------------------------------------------------------------------------
// useCreateCourseInstance
// ---------------------------------------------------------------------------

async function callCreateCourseInstance(
  body: CreateCourseInstanceRequest,
): Promise<CreateCourseInstanceResponse> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) {
    throw new Error('You must be signed in to create a course.');
  }

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-course-instance`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (response.status === 409) {
    let conflict: CreateCourseInstanceTerritoryConflict;
    try {
      conflict = (await response.json()) as CreateCourseInstanceTerritoryConflict;
    } catch {
      throw new Error('Territory conflict (unexpected response shape).');
    }
    throw new TerritoryConflictError(conflict);
  }

  if (!response.ok) {
    let message = `Failed to create course (${response.status})`;
    try {
      const errBody = (await response.json()) as { error?: string };
      if (errBody.error) message = errBody.error;
    } catch {
      // body was not JSON; keep the generic message.
    }
    throw new Error(message);
  }

  return (await response.json()) as CreateCourseInstanceResponse;
}

export function useCreateCourseInstance(): UseMutationResult<
  CreateCourseInstanceResponse,
  Error,
  CreateCourseInstanceRequest
> {
  const queryClient = useQueryClient();

  return useMutation<CreateCourseInstanceResponse, Error, CreateCourseInstanceRequest>({
    mutationFn: callCreateCourseInstance,
    onSuccess: () => {
      // Invalidate the course list / calendar so the new instance appears
      // without requiring a manual refresh.
      void queryClient.invalidateQueries({ queryKey: franchiseeKeys.courses() });
    },
  });
}
