/**
 * VERIFIER peer test — queued emails follow the class (October batch).
 *
 * The functions import Deno-only modules, so these checks read the source to
 * pin the wiring; the timing rules themselves are unit-tested in
 * _shared/reanchor.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const fns = join(dirname(fileURLToPath(import.meta.url)), '..');
const transfer = readFileSync(join(fns, 'transfer-booking/index.ts'), 'utf8');
const update = readFileSync(join(fns, 'update-course-instance/index.ts'), 'utf8');

describe('transfer-booking: reminders follow the booking', () => {
  it('moves reminders whether or not the customer is notified', () => {
    const call = transfer.indexOf('await moveReminders(');
    const notify = transfer.indexOf('if (notifyCustomer) {');
    expect(call).toBeGreaterThan(-1);
    // Not inside the notify branch: it runs first, unconditionally.
    expect(call).toBeLessThan(notify);
  });

  it('re-anchors pending rows and adds missing pre-class reminders', () => {
    expect(transfer).toMatch(/applyReanchor\(admin, planReanchor\(rows, cls, now\)\)/);
    expect(transfer).toMatch(/online \? PRE_CLASS_KEYS : \['day_before_reminder'\]/);
  });

  it("an order's lead moving hands the lead to a line still on the old course", () => {
    expect(transfer).toMatch(/update\(\{ order_id: newLead\.id \}\)/);
    expect(transfer).toMatch(/startTime: source\.start_time/);
  });

  it('refuses to move a line of an unpaid order', () => {
    expect(transfer).toMatch(/booking\.order_id && booking\.payment_status === 'pending'/);
  });
});

describe('update-course-instance: re-dating moves queued emails', () => {
  it('re-anchors when the date or either time changes, using the saved row', () => {
    expect(update).toMatch(
      /\['event_date', 'start_time', 'end_time'\]\.some\(\(k\) => k in changedFields\)/,
    );
    expect(update).toMatch(/eventDate: updatedRow\.event_date as string/);
    expect(update).toMatch(
      /\.in\('template_key', \[\.\.\.PRE_CLASS_KEYS, \.\.\.POST_COURSE_KEYS\]\)/,
    );
    expect(update).toMatch(/\.eq\('status', 'pending'\)/);
  });
});
