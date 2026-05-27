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
