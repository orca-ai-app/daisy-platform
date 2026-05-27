/**
 * Franchisee course-detail queries and mutations — Wave 7B.
 *
 * Covers:
 *  - useCourseInstance(id)      — single course instance + template + ticket types
 *  - useCourseTicketTypes(id)   — ticket types for a course (live-updating panel)
 *  - useUpdateCourseInstance()  — POST to update-course-instance EF
 *  - useCancelCourseInstance()  — POST to cancel-course-instance EF
 *  - useCreateTicketType()      — POST to create-ticket-type EF
 *  - useUpdateTicketType()      — POST to update-ticket-type EF
 *  - useDeleteTicketType()      — POST to delete-ticket-type EF
 *
 * RLS: anon client + RLS, no client-side franchisee_id filter — the
 * database enforces row-level scoping.
 *
 * Money: integer pence throughout (use formatPence from @/lib/format).
 * Dates: raw 'YYYY-MM-DD' strings; never pass through a Date constructor.
 *
 * Key factory: franchiseeKeys (frozen contract in ./queryKeys).
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { franchiseeKeys } from '../queryKeys';
import type { CourseInstance, TicketType } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TABLE_MISSING_CODES = new Set(['42P01', 'PGRST205']);

function isTableMissing(code: string | null | undefined): boolean {
  return TABLE_MISSING_CODES.has(code ?? '');
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

async function getSessionToken(): Promise<string> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error('You must be signed in.');
  return token;
}

async function callEdgeFunction<T>(
  functionName: string,
  body: Record<string, unknown>,
): Promise<T> {
  const token = await getSessionToken();
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${functionName}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let message = `${functionName} failed (${res.status})`;
    try {
      const errBody = (await res.json()) as { error?: string };
      if (errBody.error) message = errBody.error;
    } catch {
      // body was not JSON
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Projected shape returned by useCourseInstance
// ---------------------------------------------------------------------------

export interface CourseInstanceWithTemplate extends CourseInstance {
  template: { id: string; name: string; slug: string } | null;
}

// ---------------------------------------------------------------------------
// useCourseInstance
// ---------------------------------------------------------------------------

export function useCourseInstance(id: string | undefined) {
  return useQuery<CourseInstanceWithTemplate | null>({
    enabled: !!id && isUuid(id ?? ''),
    queryKey: franchiseeKeys.course(id ?? ''),
    queryFn: async () => {
      if (!id) return null;

      const { data, error } = await supabase
        .from('da_course_instances')
        .select(
          `id,
           created_at,
           updated_at,
           franchisee_id,
           template_id,
           territory_id,
           event_date,
           start_time,
           end_time,
           venue_name,
           venue_address,
           venue_postcode,
           lat,
           lng,
           visibility,
           capacity,
           spots_remaining,
           price_pence,
           bespoke_details,
           status,
           stripe_payment_link,
           out_of_territory,
           out_of_territory_warning,
           cancellation_reason,
           template:da_course_templates ( id, name, slug )`,
        )
        .eq('id', id)
        .maybeSingle();

      if (error) {
        if (isTableMissing(error.code)) return null;
        throw error;
      }
      if (!data) return null;

      return data as unknown as CourseInstanceWithTemplate;
    },
  });
}

// ---------------------------------------------------------------------------
// useCourseTicketTypes
// ---------------------------------------------------------------------------

export function useCourseTicketTypes(courseInstanceId: string | undefined) {
  return useQuery<TicketType[]>({
    enabled: !!courseInstanceId && isUuid(courseInstanceId ?? ''),
    queryKey: franchiseeKeys.courseTicketTypes(courseInstanceId ?? ''),
    queryFn: async () => {
      if (!courseInstanceId) return [];

      const { data, error } = await supabase
        .from('da_ticket_types')
        .select(
          'id, created_at, course_instance_id, name, price_pence, seats_consumed, max_available, sort_order',
        )
        .eq('course_instance_id', courseInstanceId)
        .order('sort_order', { ascending: true, nullsFirst: false });

      if (error) {
        if (isTableMissing(error.code)) return [];
        throw error;
      }
      return (data ?? []) as TicketType[];
    },
  });
}

// ---------------------------------------------------------------------------
// useUpdateCourseInstance
// ---------------------------------------------------------------------------

export interface CourseInstanceUpdateFields {
  event_date?: string;
  start_time?: string;
  end_time?: string;
  venue_name?: string | null;
  venue_address?: string | null;
  venue_postcode?: string;
  capacity?: number;
  price_pence?: number;
}

interface UpdateCourseInstanceArgs {
  id: string;
  fields: CourseInstanceUpdateFields;
}

export function useUpdateCourseInstance(): UseMutationResult<
  CourseInstance,
  Error,
  UpdateCourseInstanceArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, fields }) =>
      callEdgeFunction<CourseInstance>('update-course-instance', { id, fields }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: franchiseeKeys.course(variables.id) });
      void queryClient.invalidateQueries({ queryKey: franchiseeKeys.courses() });
      void queryClient.invalidateQueries({ queryKey: ['activities'] });
    },
  });
}

// ---------------------------------------------------------------------------
// useCancelCourseInstance
// ---------------------------------------------------------------------------

interface CancelCourseInstanceArgs {
  id: string;
  fields: { cancellation_reason: string };
}

interface CancelCourseInstanceResponse {
  instance: CourseInstance;
  bookings_affected: number;
  already_cancelled?: boolean;
}

export function useCancelCourseInstance(): UseMutationResult<
  CancelCourseInstanceResponse,
  Error,
  CancelCourseInstanceArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, fields }) =>
      callEdgeFunction<CancelCourseInstanceResponse>('cancel-course-instance', { id, fields }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: franchiseeKeys.course(variables.id) });
      void queryClient.invalidateQueries({ queryKey: franchiseeKeys.courses() });
      void queryClient.invalidateQueries({ queryKey: ['activities'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Bookings count for cancel confirmation
// ---------------------------------------------------------------------------

export function useCourseBookingsCount(courseInstanceId: string | undefined) {
  return useQuery<number>({
    enabled: !!courseInstanceId,
    queryKey: [...franchiseeKeys.course(courseInstanceId ?? ''), 'bookings-count'] as const,
    queryFn: async () => {
      if (!courseInstanceId) return 0;
      const { count, error } = await supabase
        .from('da_bookings')
        .select('id', { count: 'exact', head: true })
        .eq('course_instance_id', courseInstanceId);
      if (error) {
        if (isTableMissing(error.code)) return 0;
        throw error;
      }
      return count ?? 0;
    },
  });
}

// ---------------------------------------------------------------------------
// Ticket-type mutations
// ---------------------------------------------------------------------------

export interface TicketTypeInput {
  name: string;
  price_pence: number;
  seats_consumed: number;
  max_available: number | null;
  sort_order: number;
}

interface CreateTicketTypeArgs {
  course_instance_id: string;
  ticket_type: TicketTypeInput;
}

interface UpdateTicketTypeArgs {
  id: string;
  fields: Partial<TicketTypeInput>;
}

interface DeleteTicketTypeArgs {
  id: string;
}

export function useCreateTicketType(): UseMutationResult<TicketType, Error, CreateTicketTypeArgs> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ course_instance_id, ticket_type }) =>
      callEdgeFunction<TicketType>('create-ticket-type', { course_instance_id, ticket_type }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: franchiseeKeys.courseTicketTypes(variables.course_instance_id),
      });
    },
  });
}

export function useUpdateTicketType(): UseMutationResult<TicketType, Error, UpdateTicketTypeArgs> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, fields }) =>
      callEdgeFunction<TicketType>('update-ticket-type', { id, fields }),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({
        queryKey: franchiseeKeys.courseTicketTypes(data.course_instance_id),
      });
    },
  });
}

export function useDeleteTicketType(): UseMutationResult<void, Error, DeleteTicketTypeArgs> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) => callEdgeFunction<void>('delete-ticket-type', { id }),
    onSuccess: () => {
      // Invalidate all ticket-type queries — we don't hold the instance id at
      // the call site easily, so blow the whole franchisee cache key subtree.
      void queryClient.invalidateQueries({ queryKey: franchiseeKeys.courses() });
    },
  });
}

// ---------------------------------------------------------------------------
// Status-to-variant helper (mirrors the HQ pattern)
// ---------------------------------------------------------------------------

import type { CourseInstanceStatus } from './types';

export function courseInstanceStatusVariant(
  s: CourseInstanceStatus,
): 'active' | 'paid' | 'terminated' {
  if (s === 'cancelled') return 'terminated';
  if (s === 'completed') return 'paid';
  return 'active';
}
