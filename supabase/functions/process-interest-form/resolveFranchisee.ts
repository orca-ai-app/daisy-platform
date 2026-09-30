// The widget's trainer "Request a class" form sends the trainer's franchisee
// NUMBER (e.g. "0086", "OMG1"), not the uuid. da_interest_forms.franchisee_id
// is a uuid, so the number must be resolved first or the insert 500s. Same
// approach as get-public-courses: a uuid passes through, anything else is
// looked up by da_franchisees.number.

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ResolveResult = { ok: true; id: string | null } | { ok: false; error: string };

/**
 * `lookupByNumber` returns the franchisee uuid for a number, or null when no
 * such franchisee exists. It throws only on a database error.
 */
export async function resolveFranchiseeId(
  raw: string | null,
  lookupByNumber: (num: string) => Promise<string | null>,
): Promise<ResolveResult> {
  if (!raw) return { ok: true, id: null };
  if (UUID_RE.test(raw)) return { ok: true, id: raw };
  const id = await lookupByNumber(raw);
  return id ? { ok: true, id } : { ok: false, error: 'Unknown trainer' };
}
