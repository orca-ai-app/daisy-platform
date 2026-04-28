/**
 * Course-template queries + mutations for HQ.
 *
 * - useCourseTemplates(): SELECT all rows from da_course_templates
 * - useUpdateTemplate(): POSTs to the `update-template` Edge Function with the
 *   caller's session JWT. Edge Function enforces HQ-only and writes the
 *   activity row.
 *
 * Reference: docs/PRD-technical.md §4.4.
 */

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface CourseTemplate {
  id: string;
  created_at: string;
  updated_at: string;
  name: string;
  slug: string;
  duration_hours: number;
  default_price_pence: number;
  default_capacity: number;
  age_range: string | null;
  certification: string | null;
  description: string | null;
  is_active: boolean;
}

export interface TemplateUpdate {
  name?: string;
  description?: string | null;
  default_price_pence?: number;
  default_capacity?: number;
  is_active?: boolean;
}

export const TEMPLATES_QUERY_KEY = ['course-templates'] as const;

async function fetchCourseTemplates(): Promise<CourseTemplate[]> {
  const { data, error } = await supabase
    .from('da_course_templates')
    .select('*')
    .order('name', { ascending: true });

  if (error) {
    throw new Error(`useCourseTemplates: ${error.message}`);
  }
  return (data ?? []) as CourseTemplate[];
}

export function useCourseTemplates(): UseQueryResult<CourseTemplate[], Error> {
  return useQuery({
    queryKey: TEMPLATES_QUERY_KEY,
    queryFn: fetchCourseTemplates,
  });
}

interface UpdateTemplateArgs {
  id: string;
  fields: TemplateUpdate;
}

async function callUpdateTemplate({ id, fields }: UpdateTemplateArgs): Promise<CourseTemplate> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) {
    throw new Error('You must be signed in to edit templates.');
  }

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/update-template`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ id, fields }),
  });

  if (!response.ok) {
    let message = `Update failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // body wasn't JSON; keep the generic message.
    }
    throw new Error(message);
  }

  return (await response.json()) as CourseTemplate;
}

export function useUpdateTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: callUpdateTemplate,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TEMPLATES_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ['activities'] });
    },
  });
}
