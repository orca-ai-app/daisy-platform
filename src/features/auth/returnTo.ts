/**
 * Remember where a signed-out visitor was heading, so a link to a Help
 * section (or any portal page) lands there after Google sign-in rather than
 * on the dashboard (Reka, 30 Sep 2026). sessionStorage survives the OAuth
 * round trip in the same tab.
 */
const KEY = 'daisy.returnTo';

export function rememberReturnTo(path: string): void {
  try {
    sessionStorage.setItem(KEY, path);
  } catch {
    /* storage blocked: fall back to the dashboard */
  }
}

/**
 * The remembered path if it belongs to this user's side of the portal, else
 * the dashboard. Clears it either way. Only same-site paths are accepted.
 */
export function takeReturnTo(isHQ: boolean): string {
  const home = isHQ ? '/hq/dashboard' : '/franchisee/dashboard';
  let saved: string | null = null;
  try {
    saved = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
  } catch {
    return home;
  }
  if (!saved || !saved.startsWith('/') || saved.startsWith('//')) return home;
  const prefix = isHQ ? '/hq/' : '/franchisee/';
  return saved.startsWith(prefix) ? saved : home;
}
