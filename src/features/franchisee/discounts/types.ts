/**
 * ============================================================================
 * FROZEN CONTRACT — builders consume, do not redefine.
 * ============================================================================
 *
 * Wave 9 SCAFFOLD owns this file. Build agent 9B (discount codes) imports
 * these types and MUST NOT declare parallel shapes for the same concepts. If
 * a new field is genuinely needed, raise it back to the scaffold owner rather
 * than widening the type locally.
 *
 * Every column name below matches the real DB schema exactly:
 *   - supabase/migrations/005_billing_tables.sql (da_discount_codes)
 *
 * Money rule: when `type === 'fixed'`, `value` is in PENCE (integer). When
 * `type === 'percentage'`, `value` is a whole-number percentage 0-100. The DB
 * enforces both via CHECK (value >= 0) and CHECK (type <> 'percentage' OR
 * value BETWEEN 0 AND 100).
 */

export type DiscountType = 'percentage' | 'fixed';

/**
 * Full `da_discount_codes` row as returned by the anon client (RLS-scoped).
 *
 * `franchisee_id` is NULL for network-wide codes; otherwise it scopes the code
 * to a single franchisee. `code` is globally UNIQUE across the whole table.
 */
export interface DiscountCode {
  id: string;
  created_at: string;
  updated_at: string;
  /** NULL = network-wide code (HQ-created); otherwise scoped to a franchisee. */
  franchisee_id: string | null;
  /** Globally unique code string. */
  code: string;
  type: DiscountType;
  /** Percentage 0-100 when type='percentage'; pence when type='fixed'. */
  value: number;
  /** NULL = unlimited uses; otherwise > 0. */
  max_uses: number | null;
  uses_count: number;
  /** ISO timestamp; NULL = valid immediately. */
  valid_from: string | null;
  /** ISO timestamp; NULL = no expiry. */
  valid_until: string | null;
  is_active: boolean;
}

/**
 * Payload for the create-discount-code Edge Function. Server stamps id,
 * created_at, updated_at, uses_count (0). `franchisee_id` is derived
 * server-side from the caller's session — never sent by the franchisee
 * client.
 */
export interface CreateDiscountCodePayload {
  code: string;
  type: DiscountType;
  /** Percentage 0-100 when type='percentage'; pence when type='fixed'. */
  value: number;
  max_uses?: number | null;
  valid_from?: string | null;
  valid_until?: string | null;
  is_active?: boolean;
}

/**
 * Payload for the update-discount-code Edge Function. `id` identifies the row;
 * all other fields are optional partial edits. `code` and `type`/`value` may
 * be edited while uses_count is 0; the server decides which transitions are
 * legal.
 */
export interface UpdateDiscountCodePayload {
  id: string;
  code?: string;
  type?: DiscountType;
  /** Percentage 0-100 when type='percentage'; pence when type='fixed'. */
  value?: number;
  max_uses?: number | null;
  valid_from?: string | null;
  valid_until?: string | null;
  is_active?: boolean;
}
