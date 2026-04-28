/**
 * Franchisee row shape. Matches the `da_franchisees` table from
 * supabase/migrations/001_initial_schema.sql (Wave 1B).
 */
export interface Franchisee {
  id: string;
  auth_user_id: string | null;
  number: string;
  name: string;
  email: string;
  phone: string | null;
  stripe_account_id: string | null;
  stripe_connected: boolean;
  gocardless_mandate_id: string | null;
  fee_tier: number;
  billing_date: number;
  vat_registered: boolean;
  status: FranchiseeStatus;
  is_hq: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type FranchiseeStatus = 'active' | 'paused' | 'terminated';

export type TerritoryStatus = 'active' | 'vacant' | 'reserved';

export interface Territory {
  id: string;
  franchisee_id: string | null;
  postcode_prefix: string;
  name: string;
  status: TerritoryStatus;
  lat: number | null;
  lng: number | null;
  created_at: string;
  updated_at: string;
}

export type PaymentStatus = 'pending' | 'paid' | 'refunded' | 'failed' | 'manual';

export type BookingStatus = 'confirmed' | 'attended' | 'no_show' | 'cancelled';

/**
 * Booking row joined with template name + customer name for the
 * detail-page bookings tab. Matches the `useFranchiseeBookings()` shape.
 */
export interface FranchiseeBookingRow {
  id: string;
  booking_reference: string;
  total_price_pence: number;
  payment_status: PaymentStatus;
  booking_status: BookingStatus;
  created_at: string;
  customer_name: string;
  course_template_name: string | null;
  course_event_date: string | null;
}

/**
 * Activity row from `da_activities` filtered to a single franchisee.
 */
export interface ActivityRow {
  id: string;
  created_at: string;
  actor_type: 'hq' | 'franchisee' | 'system' | 'customer';
  actor_id: string | null;
  entity_type: string;
  entity_id: string;
  action: string;
  metadata: Record<string, unknown> | null;
  description: string | null;
}
