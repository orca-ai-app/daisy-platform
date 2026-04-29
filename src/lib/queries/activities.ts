/**
 * Shared TanStack Query hook + helpers for `da_activities`.
 *
 * Reference: docs/PRD-technical.md §4.15.
 *
 * Used by:
 *  - HQDashboard recent activity panel (Agent 2A)
 *  - HQ activity log page (Agent 2C, /hq/activity)
 *  - Future franchisee detail timelines and per-entity audit views
 */

import { useInfiniteQuery, type UseInfiniteQueryResult } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type ActorType = 'hq' | 'franchisee' | 'system' | 'customer';

export interface ActivityRow {
  id: string;
  created_at: string;
  actor_type: ActorType;
  actor_id: string | null;
  entity_type: string;
  entity_id: string;
  action: string;
  metadata: Record<string, unknown> | null;
  description: string | null;
}

export interface ActivityFilters {
  entityType?: string;
  entityId?: string;
  actorType?: ActorType;
  /** ISO timestamp; rows newer than `since` only. */
  since?: string;
  /** Free-text search over the `description` column. */
  search?: string;
  /** Page size. Defaults to 25. */
  limit?: number;
}

interface ActivityPage {
  rows: ActivityRow[];
  nextOffset: number | null;
}

const DEFAULT_LIMIT = 25;

async function fetchActivityPage(filters: ActivityFilters, offset: number): Promise<ActivityPage> {
  const limit = filters.limit ?? DEFAULT_LIMIT;
  let query = supabase
    .from('da_activities')
    .select(
      'id, created_at, actor_type, actor_id, entity_type, entity_id, action, metadata, description',
    )
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (filters.entityType) query = query.eq('entity_type', filters.entityType);
  if (filters.entityId) query = query.eq('entity_id', filters.entityId);
  if (filters.actorType) query = query.eq('actor_type', filters.actorType);
  if (filters.since) query = query.gte('created_at', filters.since);
  if (filters.search && filters.search.trim().length > 0) {
    // Postgres ILIKE; escape `%` and `_` so the user's free text doesn't
    // accidentally turn into a wildcard.
    const safe = filters.search.replace(/[%_]/g, (c) => `\\${c}`);
    query = query.ilike('description', `%${safe}%`);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`useActivityLog: ${error.message}`);
  }

  const rows = (data ?? []) as ActivityRow[];
  // If we got a full page, assume there might be more.
  const nextOffset = rows.length === limit ? offset + limit : null;
  return { rows, nextOffset };
}

/**
 * Paginated, infinite-query hook for `da_activities`.
 *
 * The `data.pages` array contains one `{ rows, nextOffset }` page per fetch.
 * Flatten with `data.pages.flatMap(p => p.rows)` for rendering.
 */
export function useActivityLog(
  filters: ActivityFilters = {},
): UseInfiniteQueryResult<{ pages: ActivityPage[]; pageParams: number[] }, Error> {
  return useInfiniteQuery({
    queryKey: ['activities', filters],
    queryFn: ({ pageParam }) => fetchActivityPage(filters, pageParam ?? 0),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
  });
}

// ---------------------------------------------------------------------------
// formatActivityDescription
// ---------------------------------------------------------------------------

const ENTITY_LABELS: Record<string, string> = {
  course_template: 'course template',
  franchisee: 'franchisee',
  territory: 'territory',
  course_instance: 'course session',
  booking: 'booking',
  customer: 'customer',
  private_client: 'private client',
  interest_form: 'enquiry',
  geocode: 'geocode lookup',
  billing_run: 'billing run',
};

/**
 * Verb phrases for every audit action emitted by the Edge Functions.
 *
 * Keep this in sync with the values written by:
 *  - update-template (Wave 2C)
 *  - create-franchisee + update-franchisee (Wave 4A)
 *  - assign-territory (Wave 3A)
 *  - update-interest-form (Wave 3C)
 *  - update-course-instance + cancel-course-instance (Wave 4B)
 *  - preview-billing-run (Wave 4C, no-op for activity since it's read-only)
 *
 * Wave 5A disambiguation: course_instance_updated must read as a
 * different action from template_updated, and territory verbs need
 * natural-language phrasing rather than the raw enum names.
 */
const ACTION_VERBS: Record<string, string> = {
  // Templates (Wave 2C)
  template_created: 'created course template',
  template_updated: 'updated course template',
  template_deactivated: 'deactivated course template',
  // Franchisees (Wave 2B + Wave 4A)
  franchisee_created: 'onboarded new franchisee',
  franchisee_updated: 'updated franchisee',
  // Territories (Wave 3A)
  territory_assigned: 'assigned territory',
  territory_reassigned: 'reassigned territory',
  territory_unassigned: 'unassigned territory',
  territory_status_changed: 'changed territory status',
  territory_vacated: 'vacated territory',
  // Course instances (Wave 4B)
  course_created: 'created course session',
  course_cancelled: 'cancelled course session',
  course_instance_updated: 'updated course session',
  course_instance_cancelled: 'cancelled course session',
  // Bookings (Wave 3B + Wave 4)
  booking_created: 'created booking',
  booking_cancelled: 'cancelled booking',
  booking_refunded: 'refunded booking',
  // Interest forms (Wave 3C)
  interest_form_created: 'received enquiry',
  interest_form_updated: 'updated enquiry',
  interest_form_status_changed: 'updated enquiry status',
  // Misc
  geocode: 'geocoded postcode',
};

/**
 * Build a human-readable summary of an activity row.
 *
 * Lookup order:
 *  1. `description` column when present (Edge Functions write a
 *     pre-formatted string at insert time).
 *  2. Verb table above + metadata subject.
 *  3. Generic "performed {action} on {entity_type}" fall-through.
 */
export function formatActivityDescription(row: ActivityRow): string {
  if (row.description && row.description.trim().length > 0) {
    return row.description;
  }

  const verb = ACTION_VERBS[row.action];
  const entityLabel = ENTITY_LABELS[row.entity_type] ?? row.entity_type;

  // Pull a human-friendly subject from common metadata keys.
  const meta = row.metadata as Record<string, unknown> | null;
  const subject =
    (meta && typeof meta.name === 'string' && meta.name) ||
    (meta && typeof meta.template_name === 'string' && meta.template_name) ||
    (meta && typeof meta.postcode_prefix === 'string' && meta.postcode_prefix) ||
    (meta && typeof meta.postcode === 'string' && meta.postcode) ||
    null;

  if (verb) {
    return subject ? `${verb}: ${subject}` : verb;
  }

  // Unknown verb: use a friendly generic. Avoid leaking the raw enum.
  const friendlyAction = row.action.replace(/_/g, ' ');
  return `performed ${friendlyAction} on ${entityLabel}`;
}
