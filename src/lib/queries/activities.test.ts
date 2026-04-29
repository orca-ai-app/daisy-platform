import { describe, it, expect } from 'vitest';
import { formatActivityDescription, type ActivityRow } from './activities';

function row(overrides: Partial<ActivityRow>): ActivityRow {
  return {
    id: 'a1',
    created_at: '2026-04-28T10:00:00Z',
    actor_type: 'hq',
    actor_id: null,
    entity_type: 'franchisee',
    entity_id: 'e1',
    action: 'noop',
    metadata: null,
    description: null,
    ...overrides,
  };
}

describe('formatActivityDescription', () => {
  it('prefers the description column when present', () => {
    expect(
      formatActivityDescription(row({ description: 'Pre-formatted by the edge function' })),
    ).toBe('Pre-formatted by the edge function');
  });

  it('templates: maps template_updated to "updated course template"', () => {
    expect(
      formatActivityDescription(
        row({ entity_type: 'course_template', action: 'template_updated' }),
      ),
    ).toBe('updated course template');
  });

  it('course instances: distinguishes updated from cancelled', () => {
    const updated = formatActivityDescription(
      row({ entity_type: 'course_instance', action: 'course_instance_updated' }),
    );
    const cancelled = formatActivityDescription(
      row({ entity_type: 'course_instance', action: 'course_instance_cancelled' }),
    );
    expect(updated).toBe('updated course session');
    expect(cancelled).toBe('cancelled course session');
    expect(updated).not.toBe(cancelled);
  });

  it('interest forms: interest_form_updated reads as "updated enquiry"', () => {
    expect(
      formatActivityDescription(
        row({ entity_type: 'interest_form', action: 'interest_form_updated' }),
      ),
    ).toBe('updated enquiry');
  });

  it('territories: each verb has a distinct phrase', () => {
    expect(
      formatActivityDescription(row({ entity_type: 'territory', action: 'territory_assigned' })),
    ).toBe('assigned territory');
    expect(
      formatActivityDescription(row({ entity_type: 'territory', action: 'territory_reassigned' })),
    ).toBe('reassigned territory');
    expect(
      formatActivityDescription(row({ entity_type: 'territory', action: 'territory_unassigned' })),
    ).toBe('unassigned territory');
    expect(
      formatActivityDescription(
        row({ entity_type: 'territory', action: 'territory_status_changed' }),
      ),
    ).toBe('changed territory status');
  });

  it('franchisees: franchisee_created reads as "onboarded new franchisee"', () => {
    expect(
      formatActivityDescription(row({ entity_type: 'franchisee', action: 'franchisee_created' })),
    ).toBe('onboarded new franchisee');
  });

  it('franchisees: franchisee_updated reads as "updated franchisee"', () => {
    expect(
      formatActivityDescription(row({ entity_type: 'franchisee', action: 'franchisee_updated' })),
    ).toBe('updated franchisee');
  });

  it('appends a metadata subject when one of the known keys is set', () => {
    expect(
      formatActivityDescription(
        row({
          entity_type: 'course_template',
          action: 'template_updated',
          metadata: { name: 'Baby First Aid' },
        }),
      ),
    ).toBe('updated course template: Baby First Aid');

    expect(
      formatActivityDescription(
        row({
          entity_type: 'territory',
          action: 'territory_assigned',
          metadata: { postcode_prefix: 'SE15' },
        }),
      ),
    ).toBe('assigned territory: SE15');
  });

  it('falls through generically for unknown verbs (no description, no verb match)', () => {
    expect(
      formatActivityDescription(
        row({ entity_type: 'booking', action: 'something_we_did_not_plan' }),
      ),
    ).toBe('performed something we did not plan on booking');
  });

  it('uses the description column even when verb would also match', () => {
    expect(
      formatActivityDescription(
        row({
          entity_type: 'course_instance',
          action: 'course_instance_cancelled',
          description: 'Cancelled "Baby First Aid" on 4 May - trainer unavailable',
        }),
      ),
    ).toBe('Cancelled "Baby First Aid" on 4 May - trainer unavailable');
  });
});
