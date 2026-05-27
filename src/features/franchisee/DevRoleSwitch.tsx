import { useNavigate } from 'react-router';
import { Repeat } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';

/**
 * DEV-ONLY role switch (Wave 6 SCAFFOLD).
 *
 * Renders a floating pill that flips the signed-in user's `is_hq` flag in the
 * auth store so Chris can test the franchisee portal from an HQ login without
 * a second account. Strictly gated behind `import.meta.env.DEV` so it is
 * tree-shaken out of production builds and never ships.
 *
 * It mutates ONLY the in-memory Zustand state via `setFranchisee` (which
 * re-derives `isHQ`); it does not touch the database. A page refresh re-runs
 * RoleContext hydration and restores the real role from `da_franchisees`.
 *
 * Mounted from both HQLayout and FranchiseeLayout so the switch is reachable
 * from either side.
 */
export function DevRoleSwitch() {
  const navigate = useNavigate();
  const franchisee = useAuthStore((s) => s.franchisee);
  const isHQ = useAuthStore((s) => s.isHQ);
  const setFranchisee = useAuthStore((s) => s.setFranchisee);

  if (!import.meta.env.DEV) return null;
  if (!franchisee) return null;

  const toFranchisee = isHQ;
  const label = toFranchisee ? 'Switch to franchisee' : 'Switch to HQ';

  function handleClick() {
    if (!franchisee) return;
    const nextIsHQ = !toFranchisee;
    setFranchisee({ ...franchisee, is_hq: nextIsHQ });
    navigate(nextIsHQ ? '/hq/dashboard' : '/franchisee/dashboard');
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="shadow-lift fixed right-4 bottom-4 z-[60] inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-100 px-4 py-2 text-sm font-bold text-amber-900 transition-colors hover:bg-amber-200"
      title="Dev only — flips your role in memory; refresh to restore"
    >
      <Repeat aria-hidden className="h-4 w-4" />
      {label}
    </button>
  );
}

export default DevRoleSwitch;
