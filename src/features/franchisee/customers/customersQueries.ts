/**
 * TanStack Query hooks for the Customers feature (Wave 11 + Wave 12 contacts).
 *
 * da_customers is read directly via the anon Supabase client. The RLS policy
 * `franchisee_read_own_customers` (SELECT where the customer has a booking
 * with the franchisee) scopes results automatically — no client-side
 * franchisee_id filter is required.
 *
 * Booking history per customer joins:
 *   da_bookings → da_course_instances → da_course_templates
 * mirroring the pattern from clientQueries.useClientRecentBookings.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { franchiseeKeys } from '@/features/franchisee/queryKeys';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Customer {
  id: string;
  created_at: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  postcode: string | null;
}

export interface CustomerBookingRow {
  id: string;
  booking_reference: string;
  created_at: string;
  total_price_pence: number;
  payment_status: string;
  booking_status: string;
  course_event_date: string | null;
  course_template_name: string | null;
}

export interface CustomerWithBookingCount extends Customer {
  booking_count: number;
}

// ---------------------------------------------------------------------------
// useOwnCustomers
// ---------------------------------------------------------------------------

/**
 * Fetches all da_customers the franchisee is allowed to see (RLS-scoped).
 * Returns customers enriched with a booking count derived from a separate
 * query on da_bookings so we avoid a heavy aggregate on first load.
 *
 * The booking count is computed by fetching all bookings in a second query
 * and grouping client-side — acceptable given the typical volume (hundreds,
 * not millions). If volume grows this should move to a DB view.
 */
export function useOwnCustomers() {
  return useQuery<CustomerWithBookingCount[]>({
    queryKey: franchiseeKeys.customers(),
    queryFn: async () => {
      // Fetch customers
      const { data: customers, error: custErr } = await supabase
        .from('da_customers')
        .select('id, created_at, first_name, last_name, email, phone, postcode')
        .order('last_name', { ascending: true })
        .order('first_name', { ascending: true });

      if (custErr) throw custErr;
      if (!customers || customers.length === 0) return [];

      // Fetch booking counts for all visible customers in one query
      const customerIds = (customers as Customer[]).map((c) => c.id);
      const { data: bookings, error: bookErr } = await supabase
        .from('da_bookings')
        .select('customer_id')
        .in('customer_id', customerIds);

      if (bookErr) throw bookErr;

      // Build a count map
      const countMap = new Map<string, number>();
      for (const b of (bookings ?? []) as { customer_id: string }[]) {
        countMap.set(b.customer_id, (countMap.get(b.customer_id) ?? 0) + 1);
      }

      return (customers as Customer[]).map((c) => ({
        ...c,
        booking_count: countMap.get(c.id) ?? 0,
      }));
    },
  });
}

// ---------------------------------------------------------------------------
// useMedicalContacts — Wave 12
// ---------------------------------------------------------------------------

/**
 * Medical-form contacts for the signed-in franchisee (RLS-scoped automatically).
 *
 * NEVER selects declaration_data. Used only to build the "All contacts" union
 * view in CustomersList. Contacts are identified by attendee_email; those with
 * no email are always included as distinct rows.
 */
export interface MedicalContact {
  id: string;
  created_at: string;
  attendee_name: string;
  attendee_email: string | null;
  email_opt_in: boolean | null;
  photo_consent: boolean | null;
}

export function useMedicalContacts() {
  return useQuery<MedicalContact[]>({
    queryKey: franchiseeKeys.medicalContacts(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('da_medical_declarations')
        .select('id, created_at, attendee_name, attendee_email, email_opt_in, photo_consent')
        .order('created_at', { ascending: false });

      if (error) {
        // Table not yet migrated in some environments — fail silently
        if (error.code === '42P01' || error.code === 'PGRST205') return [];
        throw error;
      }

      return (data ?? []) as MedicalContact[];
    },
  });
}

// ---------------------------------------------------------------------------
// useCustomerBookings
// ---------------------------------------------------------------------------

/**
 * Fetches bookings for a single customer, joined to the course instance and
 * template name. Mirrors useClientRecentBookings but keyed by customer_id.
 *
 * RLS: da_bookings.franchisee_own scopes to the caller's bookings automatically.
 */
export function useCustomerBookings(customerId: string | undefined, limit = 20) {
  return useQuery<CustomerBookingRow[]>({
    enabled: !!customerId,
    queryKey: [...franchiseeKeys.customer(customerId ?? ''), 'bookings', limit],
    queryFn: async () => {
      if (!customerId) return [];

      const { data, error } = await supabase
        .from('da_bookings')
        .select(
          `id,
           booking_reference,
           created_at,
           total_price_pence,
           payment_status,
           booking_status,
           course_instance:da_course_instances (
             event_date,
             template:da_course_templates ( name )
           )`,
        )
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;

      type Joined = {
        id: string;
        booking_reference: string;
        created_at: string;
        total_price_pence: number;
        payment_status: string;
        booking_status: string;
        course_instance: {
          event_date: string | null;
          template: { name: string } | null;
        } | null;
      };

      return ((data ?? []) as unknown as Joined[]).map((row) => ({
        id: row.id,
        booking_reference: row.booking_reference,
        created_at: row.created_at,
        total_price_pence: row.total_price_pence,
        payment_status: row.payment_status,
        booking_status: row.booking_status,
        course_event_date: row.course_instance?.event_date ?? null,
        course_template_name: row.course_instance?.template?.name ?? null,
      }));
    },
  });
}
