/**
 * Shared presentation helpers for the broadcasts pages: status → StatusPill
 * variant maps, human audience summaries and date formatting.
 */

import type { StatusVariant } from '@/components/daisy';
import type {
  BroadcastAudienceConfig,
  BroadcastAudienceType,
  BroadcastStatus,
  RecipientStatus,
} from './queries';

export const BROADCAST_STATUS_LABEL: Record<BroadcastStatus, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  sending: 'Sending',
  sent: 'Sent',
  failed: 'Failed',
};

/** Map broadcast statuses onto the existing StatusPill palette. */
export const BROADCAST_STATUS_VARIANT: Record<BroadcastStatus, StatusVariant> = {
  draft: 'manual',
  scheduled: 'pending',
  sending: 'reserved',
  sent: 'active',
  failed: 'failed',
};

export const RECIPIENT_STATUS_LABEL: Record<RecipientStatus, string> = {
  pending: 'Pending',
  sent: 'Sent',
  failed: 'Failed',
  skipped: 'Skipped',
};

export const RECIPIENT_STATUS_VARIANT: Record<RecipientStatus, StatusVariant> = {
  pending: 'pending',
  sent: 'paid',
  failed: 'failed',
  skipped: 'not-connected',
};

export const AUDIENCE_TYPE_LABEL: Record<BroadcastAudienceType, string> = {
  customers_all: 'All opted-in customers',
  customers_franchisee: 'Customers of selected franchisees',
  franchisees_all: 'All active franchisees',
  franchisees_selected: 'Selected franchisees',
  list: 'A saved list',
};

/**
 * Human summary of a broadcast's audience for tables and confirm dialogs,
 * e.g. "All opted-in customers", "Customers of 2 franchisees",
 * "List: Spring offer".
 */
export function describeAudience(
  type: BroadcastAudienceType,
  config: BroadcastAudienceConfig,
  listNamesById: Record<string, string> = {},
): string {
  switch (type) {
    case 'customers_all':
      return 'All opted-in customers';
    case 'customers_franchisee': {
      const n = config.franchisee_ids?.length ?? 0;
      return `Customers of ${n} franchisee${n === 1 ? '' : 's'}`;
    }
    case 'franchisees_all':
      return 'All active franchisees';
    case 'franchisees_selected': {
      const n = config.franchisee_ids?.length ?? 0;
      return `${n} selected franchisee${n === 1 ? '' : 's'}`;
    }
    case 'list': {
      const name = config.list_id ? listNamesById[config.list_id] : undefined;
      return name ? `List: ${name}` : 'List';
    }
  }
}

/** Franchisee audiences never touch the customer suppression list. */
export function isFranchiseeAudience(type: BroadcastAudienceType): boolean {
  return type === 'franchisees_all' || type === 'franchisees_selected';
}

const DATE_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  return DATE_TIME.format(new Date(iso));
}

const DATE_ONLY = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  return DATE_ONLY.format(new Date(iso));
}
