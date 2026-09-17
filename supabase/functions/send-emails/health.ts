// Email delivery health (migration 057) — runs at the end of every hourly
// send-emails tick.
//
// The 15-16 Sep incident shape: Postmark returned 200 + MessageID and silently
// discarded mail, so rows said 'sent' and nothing failed loudly. The one
// signal that survives that failure mode is the absence of Delivery webhooks:
// a healthy send confirms in seconds, a discarded one never does. This module
// counts 'sent' rows older than 2h with no delivered/bounced event, snapshots
// the result to da_email_health, and escalates to Chris via Pushover —
// deliberately NOT via Postmark, which is the thing being monitored.
//
// A dead cron can't self-report; that hole is covered externally — the
// orca-badge worker treats a snapshot older than ~2h as red.

// deno-lint-ignore-file no-explicit-any

export interface HealthResult {
  state: 'green' | 'amber' | 'red';
  unconfirmed: number;
  failed24h: number;
  bounceRate7d: number;
}

const UNCONFIRMED_GRACE_MS = 2 * 60 * 60_000; // webhook normally arrives in seconds
const LOOKBACK_MS = 48 * 60 * 60_000; // don't scan history forever
const RED_UNCONFIRMED = 3; // 1-2 could be webhook lag; 3+ is a pattern
const AMBER_BOUNCE_PCT = 5;
const REALERT_MS = 24 * 60 * 60_000;
const RETENTION_DAYS = 60;

// Pure signal → state mapping (extracted so the thresholds are unit-tested
// without a live database). Red wins over amber: a discard incident (unconfirmed
// sends or hard failures) must never be softened to amber by a benign bounce rate.
export function computeState(s: {
  unconfirmed: number;
  failed24h: number;
  bounceRate7d: number;
}): HealthResult['state'] {
  let state: HealthResult['state'] = 'green';
  if (s.unconfirmed >= 1 && s.unconfirmed < RED_UNCONFIRMED) state = 'amber';
  if (s.bounceRate7d > AMBER_BOUNCE_PCT) state = 'amber';
  if (s.unconfirmed >= RED_UNCONFIRMED || s.failed24h > 0) state = 'red';
  return state;
}

// Pure transition/escalation logic. Red fires once, then stays quiet for 24h
// (alertedWithin24h) so a persistent incident doesn't spam. Any move off red
// from a red previous state is a recovery, so the all-clear fires once.
export function alertDecision(o: {
  state: HealthResult['state'];
  prevState?: string;
  alertedWithin24h: boolean;
}): { fireRed: boolean; fireAllClear: boolean } {
  if (o.state === 'red') return { fireRed: !o.alertedWithin24h, fireAllClear: false };
  if (o.prevState === 'red') return { fireRed: false, fireAllClear: true };
  return { fireRed: false, fireAllClear: false };
}

async function pushover(title: string, message: string, priority: number): Promise<void> {
  const token = Deno.env.get('PUSHOVER_API_TOKEN') ?? '';
  const user = Deno.env.get('PUSHOVER_USER_KEY') ?? '';
  if (!token || !user) {
    console.error('email-health: PUSHOVER secrets not set, escalation skipped');
    return;
  }
  try {
    const res = await fetch('https://api.pushover.net/1/messages.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, user, title, message, priority }),
    });
    if (!res.ok) console.error('email-health: pushover send failed', res.status);
  } catch (err) {
    console.error('email-health: pushover send threw', String(err));
  }
}

export async function checkEmailHealth(admin: any): Promise<HealthResult | null> {
  try {
    const now = Date.now();

    // Sent rows past the grace window with no delivery/bounce event.
    const sentWindow = await admin
      .from('da_email_sequences')
      .select('id, events:da_email_events ( event_type )')
      .eq('status', 'sent')
      .gte('sent_at', new Date(now - LOOKBACK_MS).toISOString())
      .lte('sent_at', new Date(now - UNCONFIRMED_GRACE_MS).toISOString());
    if (sentWindow.error) throw sentWindow.error;
    const unconfirmed = ((sentWindow.data ?? []) as any[]).filter(
      (r) =>
        !(r.events ?? []).some(
          (e: any) => e.event_type === 'delivered' || e.event_type === 'bounced',
        ),
    ).length;

    const failed = await admin
      .from('da_email_sequences')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'failed')
      .gte('scheduled_for', new Date(now - 24 * 60 * 60_000).toISOString());
    const failed24h = failed.count ?? 0;

    const events7d = await admin
      .from('da_email_events')
      .select('event_type')
      .in('event_type', ['delivered', 'bounced'])
      .gte('occurred_at', new Date(now - 7 * 24 * 60 * 60_000).toISOString());
    const evs = (events7d.data ?? []) as any[];
    const bounced = evs.filter((e) => e.event_type === 'bounced').length;
    const bounceRate7d = evs.length ? Math.round((bounced / evs.length) * 10000) / 100 : 0;

    const lastDelivery = await admin
      .from('da_email_events')
      .select('occurred_at')
      .eq('event_type', 'delivered')
      .order('occurred_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const state = computeState({ unconfirmed, failed24h, bounceRate7d });

    // Previous snapshot drives transition + re-alert decisions.
    const prev = await admin
      .from('da_email_health')
      .select('state, checked_at')
      .order('checked_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const prevState = (prev.data as any)?.state as string | undefined;

    // Only query the re-alert window when we're actually red (cheap otherwise).
    let alertedWithin24h = false;
    if (state === 'red') {
      const lastAlert = await admin
        .from('da_email_health')
        .select('checked_at')
        .eq('alert_sent', true)
        .gte('checked_at', new Date(now - REALERT_MS).toISOString())
        .limit(1)
        .maybeSingle();
      alertedWithin24h = !!lastAlert.data;
    }

    const { fireRed, fireAllClear } = alertDecision({ state, prevState, alertedWithin24h });
    let alertSent = false;
    if (fireRed) {
      await pushover(
        'Daisy email health RED',
        `${unconfirmed} send(s) unconfirmed >2h, ${failed24h} failed in 24h. ` +
          `Check the Postmark dashboard for a banner/limit, then send-emails logs. ` +
          `Emails may be silently not reaching customers.`,
        1,
      );
      alertSent = true;
    }
    if (fireAllClear) {
      await pushover('Daisy email health recovered', 'Deliveries confirming normally again.', 0);
    }

    const insert = await admin.from('da_email_health').insert({
      state,
      unconfirmed_count: unconfirmed,
      failed_24h: failed24h,
      bounce_rate_7d: bounceRate7d,
      last_delivery_at: (lastDelivery.data as any)?.occurred_at ?? null,
      alert_sent: alertSent,
      detail: {
        window_h: LOOKBACK_MS / 3600000,
        checked_sent_rows: (sentWindow.data ?? []).length,
      },
    });
    if (insert.error) throw insert.error;

    // Retention sweep, same run, no extra cron.
    await admin
      .from('da_email_health')
      .delete()
      .lt('checked_at', new Date(now - RETENTION_DAYS * 24 * 60 * 60_000).toISOString());

    return { state, unconfirmed, failed24h, bounceRate7d };
  } catch (err) {
    // Health must never break the send run itself.
    console.error('email-health: check failed', String(err));
    return null;
  }
}
