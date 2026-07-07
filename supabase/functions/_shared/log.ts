// System logging for edge functions (migration 035, da_system_logs).
//
// da_activities is the BUSINESS audit trail (who did what); da_system_logs is
// the DEBUG trail (what went wrong and why). Every function generates a short
// request id at entry, includes it in every error response body
// ({ error, request_id }), and logs failures here — so "it didn't work
// (ref 3f9c2a)" from a franchisee maps straight to rows on /hq/system-logs.
//
// logSystem() must never take a request down: it swallows its own failures
// and falls back to console.

// deno-lint-ignore-file no-explicit-any

export function newRequestId(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface SystemLogEntry {
  level: 'info' | 'warn' | 'error';
  source: string; // edge function name
  requestId?: string;
  actor?: string;
  entityType?: string;
  entityId?: string;
  message: string;
  context?: Record<string, unknown>;
}

export async function logSystem(admin: any, entry: SystemLogEntry): Promise<void> {
  try {
    const res = await admin.from('da_system_logs').insert({
      level: entry.level,
      source: entry.source,
      request_id: entry.requestId ?? null,
      actor: entry.actor ?? null,
      entity_type: entry.entityType ?? null,
      entity_id: entry.entityId ?? null,
      message: entry.message.slice(0, 500),
      context: entry.context ?? null,
    });
    if (res.error) console.error('logSystem insert failed', res.error, entry.message);
  } catch (err) {
    console.error('logSystem threw', err, entry.message);
  }
}
