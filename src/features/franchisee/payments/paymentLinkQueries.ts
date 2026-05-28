/**
 * paymentLinkQueries — Wave 8B.
 *
 * Provides `useCreatePaymentLink()`, the single mutation for generating a
 * Stripe Payment Link for a private course. On success it invalidates the
 * course-detail query so the URL and timestamp appear immediately in
 * <CourseDetail> without a manual page refresh.
 *
 * Consumes:
 *  - src/features/franchisee/payments/types.ts (frozen contract — do not redefine)
 *  - src/features/franchisee/queryKeys.ts (franchiseeKeys.course)
 *
 * Edge Function: `create-payment-link`
 *   POST { course_instance_id, ticket_type_id, quantity }
 *   -> { payment_link_url }
 */

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { franchiseeKeys } from '../queryKeys';
import type { CreatePaymentLinkRequest, CreatePaymentLinkResponse } from './types';

// ---------------------------------------------------------------------------
// Shared fetch helper (mirrors the pattern in courseDetailQueries.ts)
// ---------------------------------------------------------------------------

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
// useCreatePaymentLink
// ---------------------------------------------------------------------------

/**
 * Mutation to generate a Stripe Payment Link for a private course instance.
 *
 * Variables: `CreatePaymentLinkRequest` — { course_instance_id, ticket_type_id, quantity }
 * Data:      `CreatePaymentLinkResponse` — { payment_link_url }
 *
 * On success, invalidates:
 *  - `franchiseeKeys.course(course_instance_id)` — so the stripe_payment_link
 *    column and payment_link_created_at appear in <CourseDetail> immediately.
 *  - `franchiseeKeys.courses()` — so any list/calendar views that show
 *    payment-link presence also refresh.
 */
export function useCreatePaymentLink(): UseMutationResult<
  CreatePaymentLinkResponse,
  Error,
  CreatePaymentLinkRequest
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (variables) =>
      callEdgeFunction<CreatePaymentLinkResponse>('create-payment-link', {
        course_instance_id: variables.course_instance_id,
        ticket_type_id: variables.ticket_type_id,
        quantity: variables.quantity,
      }),

    onSuccess: (_data, variables) => {
      // Invalidate the single course-detail query so stripe_payment_link and
      // payment_link_created_at are immediately visible.
      void queryClient.invalidateQueries({
        queryKey: franchiseeKeys.course(variables.course_instance_id),
      });
      // Invalidate the broader courses list so any indicator of "has payment link"
      // in CoursesList or the calendar also refreshes.
      void queryClient.invalidateQueries({
        queryKey: franchiseeKeys.courses(),
      });
      // Invalidate activities so the timeline in CourseDetail refreshes.
      void queryClient.invalidateQueries({ queryKey: ['activities'] });
    },
  });
}
