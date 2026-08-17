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
 *   - supabase/migrations/042_prelaunch_discounts.sql (group_name)
 *
 * Money rule: when `type === 'fixed'`, `value` is in PENCE (integer). When
 * `type === 'percentage'`, `value` is a whole-number percentage 0-100. The DB
 * enforces both via CHECK (value >= 0) and CHECK (type <> 'percentage' OR
 * value BETWEEN 0 AND 100).
 */

export type DiscountType = 'percentage' | 'fixed';

/**
 * The slice of da_course_templates the restriction picker needs (migration
 * 046). Read via the anon client + RLS — templates are world-readable.
 */
export interface DiscountCourseType {
  id: string;
  name: string;
}

/**
 * Human-readable summary of a code's course-type restriction (migration 046).
 * NULL/empty reads as "All course types"; otherwise the template names, with
 * any id whose template has since been retired shown as "1 removed type" so
 * the row never silently under-reports the restriction.
 */
export function restrictionSummary(
  templateIds: string[] | null | undefined,
  courseTypes: DiscountCourseType[],
): string {
  if (!templateIds || templateIds.length === 0) return 'All course types';
  const byId = new Map(courseTypes.map((t) => [t.id, t.name]));
  const named = templateIds.map((id) => byId.get(id)).filter((n): n is string => Boolean(n));
  const missing = templateIds.length - named.length;
  if (missing > 0) {
    named.push(`${missing} removed type${missing === 1 ? '' : 's'}`);
  }
  return named.join(', ');
}

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
  /** Batch label for single-use code groups (migration 042); NULL = standalone. */
  group_name: string | null;
  /**
   * Course types this code may be redeemed against (migration 046).
   * NULL or empty = valid on everything; otherwise da_course_templates ids.
   */
  template_ids: string[] | null;
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
  group_name?: string | null;
  /**
   * Restrict the code to these course types (migration 046). Omit or send an
   * empty array for "valid on everything". Each id must be a real
   * da_course_templates row — create-discount-code rejects anything else.
   */
  template_ids?: string[] | null;
}

/**
 * Payload for the create-discount-code Edge Function in BATCH mode
 * (batch_count > 1). The server generates `batch_count` single-use codes
 * ({PREFIX}-{4 alphanumerics}, prefix from `code` or the group name),
 * forces max_uses=1 on each, and returns the array of inserted rows.
 */
export interface CreateDiscountBatchPayload {
  /** Optional prefix source; the group name is used when omitted. */
  code?: string;
  group_name: string;
  /** 2-200 (1 would be a plain single-code create). */
  batch_count: number;
  type: DiscountType;
  /** Percentage 0-100 when type='percentage'; pence when type='fixed'. */
  value: number;
  valid_from?: string | null;
  valid_until?: string | null;
  is_active?: boolean;
  /** Restrict every code in the batch to these course types (migration 046). */
  template_ids?: string[] | null;
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
  /**
   * Restrict the code to these course types (migration 046). Send null or an
   * empty array to clear the restriction back to "valid on everything". Each
   * id must be a real da_course_templates row — update-discount-code rejects
   * anything else.
   */
  template_ids?: string[] | null;
}
