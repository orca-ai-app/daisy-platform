/**
 * Browser logger for the Daisy portal.
 *
 * - Mirrors every event to the console with a `[daisy]` prefix.
 * - Keeps the last 50 events in a ring buffer persisted to sessionStorage
 *   (`daisy_debug`) — support path: open the console, run `__daisyDebug()`.
 * - Ships warn/error events to the public `log-client-event` Edge Function
 *   (batched: 2s debounce, `pagehide` flush via sendBeacon, max 5 events per
 *   session) so they land in da_system_logs for /hq/system-logs.
 * - Never throws: a logging failure must never break the page it's logging.
 */

type LogLevel = 'info' | 'warn' | 'error';
type LogContext = Record<string, unknown>;

interface RingEvent {
  ts: string;
  level: LogLevel;
  message: string;
  route: string;
  context?: LogContext;
}

interface ShipEvent {
  level: 'warn' | 'error';
  source: 'browser:portal';
  message: string;
  request_id?: string;
  actor?: string;
  context: LogContext;
}

const RING_KEY = 'daisy_debug';
const SHIPPED_KEY = 'daisy_debug_shipped';
const RING_MAX = 50;
const SHIP_CAP = 5;
const FLUSH_DELAY_MS = 2_000;

const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

/** Short client-side reference shown to users and stamped on shipped events. */
export function newClientRef(): string {
  return Math.random().toString(16).slice(2, 8).padEnd(6, '0');
}

/** Pull a `request_id` off an error thrown by an Edge Function caller. */
export function extractRequestId(error: unknown): string | null {
  if (error && typeof error === 'object') {
    const id = (error as { request_id?: unknown }).request_id;
    if (typeof id === 'string' && id.length > 0) return id;
  }
  return null;
}

// The auth store is imported lazily (dynamic import) so the logger can be
// pulled in from anywhere — including the store's own dependencies — without
// creating an import cycle.
type AuthStoreModule = typeof import('@/stores/authStore');
let authStore: AuthStoreModule['useAuthStore'] | null = null;
if (typeof window !== 'undefined') {
  void import('@/stores/authStore')
    .then((m) => {
      authStore = m.useAuthStore;
    })
    .catch(() => {});
}

function currentActor(): string | undefined {
  try {
    return authStore?.getState().franchisee?.id ?? undefined;
  } catch {
    return undefined;
  }
}

function loadRing(): RingEvent[] {
  try {
    const raw = window.sessionStorage.getItem(RING_KEY);
    const parsed = raw ? (JSON.parse(raw) as RingEvent[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const ring: RingEvent[] = typeof window !== 'undefined' ? loadRing() : [];

function persistRing(): void {
  try {
    window.sessionStorage.setItem(RING_KEY, JSON.stringify(ring));
  } catch {
    // sessionStorage full or unavailable — the in-memory buffer still works.
  }
}

// --- shipping ---------------------------------------------------------------

const queue: ShipEvent[] = [];
let flushTimer: number | null = null;

function shippedCount(): number {
  try {
    return Number(window.sessionStorage.getItem(SHIPPED_KEY) ?? '0') || 0;
  } catch {
    return 0;
  }
}

function bumpShippedCount(): void {
  try {
    window.sessionStorage.setItem(SHIPPED_KEY, String(shippedCount() + 1));
  } catch {
    // Best effort — worst case we ship a few extra events.
  }
}

function flush(viaBeacon = false): void {
  if (queue.length === 0) return;
  const events = queue.splice(0, queue.length);
  try {
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/log-client-event`;
    const payload = JSON.stringify({ events });
    if (viaBeacon && typeof navigator.sendBeacon === 'function') {
      // text/plain keeps the beacon a "simple" CORS request — a JSON
      // content type would demand a preflight the browser can't finish
      // during pagehide. The edge function parses the body as JSON anyway.
      navigator.sendBeacon(url, new Blob([payload], { type: 'text/plain;charset=UTF-8' }));
    } else {
      void fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    // Shipping is fire-and-forget.
  }
}

function enqueue(event: ShipEvent): void {
  if (shippedCount() >= SHIP_CAP) return;
  bumpShippedCount();
  queue.push(event);
  if (flushTimer !== null) window.clearTimeout(flushTimer);
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    flush();
  }, FLUSH_DELAY_MS);
}

// --- core -------------------------------------------------------------------

function log(level: LogLevel, message: string, context?: LogContext): void {
  try {
    console[level]('[daisy]', message, context ?? '');
    if (typeof window === 'undefined') return;

    const route = window.location.pathname;
    ring.push({ ts: new Date().toISOString(), level, message, route, context });
    if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX);
    persistRing();

    if (level === 'warn' || level === 'error') {
      const requestId = typeof context?.request_id === 'string' ? context.request_id : undefined;
      enqueue({
        level,
        source: 'browser:portal',
        message: message.slice(0, 500),
        request_id: requestId,
        actor: currentActor(),
        context: {
          route,
          version: APP_VERSION,
          userAgent: window.navigator.userAgent,
          ...context,
        },
      });
    }
  } catch {
    // The logger must never throw.
  }
}

export const logger = {
  info: (message: string, context?: LogContext) => log('info', message, context),
  warn: (message: string, context?: LogContext) => log('warn', message, context),
  error: (message: string, context?: LogContext) => log('error', message, context),
};

// --- global hooks (installed once per page) ----------------------------------

declare global {
  interface Window {
    __daisyDebug?: () => void;
    __daisyLoggerInstalled?: boolean;
  }
}

if (typeof window !== 'undefined' && !window.__daisyLoggerInstalled) {
  window.__daisyLoggerInstalled = true;

  window.__daisyDebug = () => {
    console.table(ring);
  };

  window.addEventListener('error', (event) => {
    logger.error(`Uncaught error: ${event.message}`, {
      file: event.filename,
      line: event.lineno,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const message = reason instanceof Error ? reason.message : String(reason);
    logger.error(`Unhandled rejection: ${message}`, {
      request_id: extractRequestId(reason) ?? undefined,
    });
  });

  window.addEventListener('pagehide', () => flush(true));
}
