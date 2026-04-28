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
  course_instance: 'course',
  booking: 'booking',
  customer: 'customer',
  private_client: 'private client',
  interest_form: 'interest form',
  geocode: 'geocode lookup',
};

const ACTION_VERBS: Record<string, string> = {
  template_updated: 'updated template',
  template_created: 'created template',
  template_deactivated: 'deactivated template',
  franchisee_created: 'created franchisee',
  franchisee_updated: 'updated franchisee',
  territory_assigned: 'assigned territory',
  territory_vacated: 'vacated territory',
  course_created: 'created course',
  course_cancelled: 'cancelled course',
  booking_created: 'created booking',
  booking_cancelled: 'cancelled booking',
  geocode: 'geocoded postcode',
  interest_form_status_changed: 'updated interest form',
};

/**
 * Build a human-readable summary of an activity row.
 *
 * Prefers the `description` column when present (the Edge Function writes a
 * pre-formatted string at insert time). Falls back to entity_type + action +
 * metadata when the row didn't get a description (e.g. legacy rows or third-
 * party inserts).
 */
export function formatActivityDescription(row: ActivityRow): string {
  if (row.description && row.description.trim().length > 0) {
    return row.description;
  }

  const entityLabel = ENTITY_LABELS[row.entity_type] ?? row.entity_type;
  const verb = ACTION_VERBS[row.action] ?? row.action.replace(/_/g, ' ');

  // If metadata has a `name` or `template_name`, use it.
  const meta = row.metadata as Record<string, unknown> | null;
  const subject =
    (meta && typeof meta.name === 'string' && meta.name) ||
    (meta && typeof meta.template_name === 'string' && meta.template_name) ||
    null;

  if (subject) {
    return `${verb}: ${subject}`;
  }

  return `${verb} (${entityLabel})`;
}
