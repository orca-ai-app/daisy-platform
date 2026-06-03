/**
 * ============================================================================
 * FROZEN CONTRACT — builders consume, do not redefine.
 * ============================================================================
 *
 * Wave 9 SCAFFOLD owns this file. Build agent 9C (private clients) imports
 * these types and MUST NOT declare parallel shapes for the same concepts. If
 * a new field is genuinely needed, raise it back to the scaffold owner rather
 * than widening the type locally.
 *
 * Every column name below matches the real DB schema exactly:
 *   - supabase/migrations/003_customer_booking_tables.sql (da_private_clients)
 */

/**
 * Full `da_private_clients` row as returned by the anon client (RLS-scoped).
 *
 * `franchisee_id` is NOT NULL — every private client belongs to exactly one
 * franchisee. `company_name` is unique per franchisee (UNIQUE(franchisee_id,
 * company_name)). Contact fields are optional.
 */
export type ClientType = 'organisation' | 'individual';

export interface PrivateClient {
  id: string;
  created_at: string;
  updated_at: string;
  franchisee_id: string;
  /** 'organisation' (school/company → company_name) or 'individual' (person → contact_name). */
  client_type: ClientType;
  /** Null for individuals. */
  company_name: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  notes: string | null;
}

/** Display name regardless of type: company for orgs, contact name for individuals. */
export function clientDisplayName(c: Pick<PrivateClient, 'company_name' | 'contact_name'>): string {
  return c.company_name ?? c.contact_name ?? 'Unnamed client';
}

/**
 * Payload for the create-private-client Edge Function. Server stamps id,
 * created_at, updated_at. `franchisee_id` is derived server-side from the
 * caller's session — never sent by the franchisee client.
 */
export interface CreatePrivateClientPayload {
  client_type?: ClientType;
  /** Required for organisations; omitted/null for individuals. */
  company_name?: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  notes?: string | null;
}

/**
 * Payload for the update-private-client Edge Function. `id` identifies the
 * row; all other fields are optional partial edits.
 */
export interface UpdatePrivateClientPayload {
  id: string;
  company_name?: string;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  notes?: string | null;
}
