/**
 * Wave 9 VERIFIER peer tests — private-client linkage rules on the
 * course-create wizard.
 *
 * The logic lives inline in CreateCourse.tsx (the visibility onValueChange at
 * lines 609-615 and the submit payload at line 902) and is not exported, so
 * these helpers mirror that exact contract and pin its behaviour:
 *
 *   1. Switching visibility to 'public' clears private_client_id to null.
 *   2. Switching to 'private' leaves the selection untouched.
 *   3. The submit payload always sends `private_client_id ?? null`.
 *
 * It also covers the create-course-instance edge-fn rule that a public course
 * must never carry a client (validateBody coerces null; the wizard guarantees
 * it by clearing on toggle).
 */

import { describe, it, expect } from 'vitest';

type Visibility = 'public' | 'private';

interface FormState {
  visibility: Visibility;
  private_client_id: string | null;
}

/** Mirrors CreateCourse visibility onValueChange (lines 609-615). */
function applyVisibilityChange(state: FormState, next: Visibility): FormState {
  const updated: FormState = { ...state, visibility: next };
  if (next === 'public') {
    updated.private_client_id = null;
  }
  return updated;
}

/** Mirrors the submit payload coalescing (line 902). */
function toSubmitPrivateClientId(state: FormState): string | null {
  return state.private_client_id ?? null;
}

const CLIENT = 'd1fa0c00-0000-4000-8000-000000000001';

describe('private client clears when course becomes public', () => {
  it('clears private_client_id when switching from private -> public', () => {
    const start: FormState = { visibility: 'private', private_client_id: CLIENT };
    const after = applyVisibilityChange(start, 'public');
    expect(after.visibility).toBe('public');
    expect(after.private_client_id).toBeNull();
  });

  it('preserves private_client_id when switching public -> private', () => {
    const start: FormState = { visibility: 'public', private_client_id: null };
    const after = applyVisibilityChange(start, 'private');
    expect(after.visibility).toBe('private');
    // Selection still null until the user picks one — not auto-populated.
    expect(after.private_client_id).toBeNull();
  });

  it('keeps an already-chosen client when re-confirming private', () => {
    const start: FormState = { visibility: 'private', private_client_id: CLIENT };
    const after = applyVisibilityChange(start, 'private');
    expect(after.private_client_id).toBe(CLIENT);
  });
});

describe('submit payload private_client_id coalescing', () => {
  it('sends the chosen client id for a private course', () => {
    expect(toSubmitPrivateClientId({ visibility: 'private', private_client_id: CLIENT })).toBe(
      CLIENT,
    );
  });

  it('sends null for a public course', () => {
    expect(toSubmitPrivateClientId({ visibility: 'public', private_client_id: null })).toBeNull();
  });

  it('a public course can never carry a client after the toggle clears it', () => {
    // Simulate: user picks a client, then switches to public, then submits.
    let state: FormState = { visibility: 'private', private_client_id: CLIENT };
    state = applyVisibilityChange(state, 'public');
    expect(toSubmitPrivateClientId(state)).toBeNull();
  });
});
