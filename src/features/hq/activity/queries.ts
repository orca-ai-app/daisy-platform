/**
 * Activity-page-specific helpers. The reusable hook lives in
 * src/lib/queries/activities.ts; this file holds page-only concerns
 * (filter shape, default ranges, distinct-actor lookups, etc).
 */

import { startOfMonth, startOfWeek, subDays } from 'date-fns';
import type { ActivityFilters, ActorType } from '@/lib/queries/activities';

export type DateRangePreset =
  | 'all'
  | 'today'
  | 'this_week'
  | 'this_month'
  | 'last_30_days'
  | 'custom';

export interface ActivityPageFilters {
  actorType: ActorType | 'all';
  entityType: string | 'all';
  range: DateRangePreset;
  search: string;
}

export const DEFAULT_FILTERS: ActivityPageFilters = {
  actorType: 'all',
  entityType: 'all',
  range: 'all',
  search: '',
};

/**
 * Translate the page-level filter shape into the more general
 * `useActivityLog` filter shape.
 */
export function buildActivityFilters(f: ActivityPageFilters): ActivityFilters {
  const filters: ActivityFilters = { limit: 25 };
  if (f.actorType !== 'all') filters.actorType = f.actorType;
  if (f.entityType !== 'all') filters.entityType = f.entityType;
  if (f.search.trim().length > 0) filters.search = f.search.trim();

  const now = new Date();
  switch (f.range) {
    case 'today':
      filters.since = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      break;
    case 'this_week':
      filters.since = startOfWeek(now, { weekStartsOn: 1 }).toISOString();
      break;
    case 'this_month':
      filters.since = startOfMonth(now).toISOString();
      break;
    case 'last_30_days':
      filters.since = subDays(now, 30).toISOString();
      break;
    case 'all':
    case 'custom':
    default:
      // no `since` filter
      break;
  }
  return filters;
}

export const ENTITY_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'All entities' },
  { value: 'course_template', label: 'Course template' },
  { value: 'franchisee', label: 'Franchisee' },
  { value: 'territory', label: 'Territory' },
  { value: 'course_instance', label: 'Course instance' },
  { value: 'booking', label: 'Booking' },
  { value: 'customer', label: 'Customer' },
  { value: 'private_client', label: 'Private client' },
  { value: 'interest_form', label: 'Interest form' },
  { value: 'geocode', label: 'Geocode' },
];

export const ACTOR_TYPE_OPTIONS: { value: ActorType | 'all'; label: string }[] = [
  { value: 'all', label: 'All actors' },
  { value: 'hq', label: 'HQ' },
  { value: 'franchisee', label: 'Franchisee' },
  { value: 'system', label: 'System' },
  { value: 'customer', label: 'Customer' },
];

export const RANGE_OPTIONS: { value: DateRangePreset; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: 'today', label: 'Today' },
  { value: 'this_week', label: 'This week' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_30_days', label: 'Last 30 days' },
];
