/**
 * Course-template queries + mutations for HQ.
 *
 * - useCourseTemplates(): SELECT active rows from da_course_templates
 *   (is_active = true). Archived templates (e.g. the 6 pre-June-2026 courses
 *   kept for their historical course instances) are hidden from the catalogue.
 * - useUpdateTemplate(): POSTs to the `update-template` Edge Function with the
 *   caller's session JWT. Edge Function enforces HQ-only and writes the
 *   activity row.
 * - useCreateTemplate(): POSTs to the `create-template` Edge Function. Same
 *   auth + activity guarantees.
 *
 * Reference: docs/PRD-technical.md §4.4.
 */

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type TemplateCertification = 'yes' | 'no' | 'if_requested';

export interface TemplateTicketType {
  name: string;
  seats_consumed: number;
  price_modifier_pence: number;
}

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
  certification: TemplateCertification | null;
  description: string | null;
  default_ticket_types: TemplateTicketType[];
  is_active: boolean;
}

export interface TemplateUpdate {
  name?: string;
  description?: string | null;
  default_price_pence?: number;
  default_capacity?: number;
  certification?: TemplateCertification;
  default_ticket_types?: TemplateTicketType[];
  is_active?: boolean;
}

export interface TemplateCreate {
  name: string;
  slug: string;
  duration_hours: number;
  default_price_pence: number;
  default_capacity: number;
  age_range?: string | null;
  certification?: TemplateCertification;
  description?: string | null;
  default_ticket_types?: TemplateTicketType[];
  is_active?: boolean;
}

export const TEMPLATES_QUERY_KEY = ['course-templates'] as const;

async function fetchCourseTemplates(): Promise<CourseTemplate[]> {
  const { data, error } = await supabase
    .from('da_course_templates')
    .select('*')
    .eq('is_active', true)
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

async function getAuthToken(): Promise<string> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) {
    throw new Error('You must be signed in to edit templates.');
  }
  return token;
}

async function postEdgeFunction<T>(
  name: string,
  body: unknown,
  fallbackErrorPrefix: string,
): Promise<T> {
  const token = await getAuthToken();
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let message = `${fallbackErrorPrefix} (${response.status})`;
    try {
      const parsed = (await response.json()) as { error?: string };
      if (parsed.error) message = parsed.error;
    } catch {
      // body wasn't JSON; keep the generic message.
    }
    throw new Error(message);
  }

  return (await response.json()) as T;
}

interface UpdateTemplateArgs {
  id: string;
  fields: TemplateUpdate;
}

async function callUpdateTemplate({ id, fields }: UpdateTemplateArgs): Promise<CourseTemplate> {
  return postEdgeFunction<CourseTemplate>('update-template', { id, fields }, 'Update failed');
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

async function callCreateTemplate(fields: TemplateCreate): Promise<CourseTemplate> {
  return postEdgeFunction<CourseTemplate>('create-template', fields, 'Create failed');
}

export function useCreateTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: callCreateTemplate,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TEMPLATES_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ['activities'] });
    },
  });
}
