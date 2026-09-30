import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useRole } from './RoleContext';
import { takeReturnTo } from './returnTo';

/**
 * Catch-all callback route used by Supabase magic-link / email-confirm
 * flows. RoleContext processes the session as soon as the URL hash
 * lands; we just wait for it then redirect.
 */
export default function AuthCallback() {
  const navigate = useNavigate();
  const { user, isHQ, notProvisioned, isLoading } = useRole();

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      navigate('/login', { replace: true });
      return;
    }
    if (notProvisioned) {
      navigate('/unauthorized', { replace: true });
      return;
    }
    navigate(takeReturnTo(isHQ), { replace: true });
  }, [user, isHQ, notProvisioned, isLoading, navigate]);

  return (
    <div className="text-daisy-muted flex min-h-screen items-center justify-center">
      Signing you in…
    </div>
  );
}
