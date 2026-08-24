import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useRole } from './RoleContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';

/**
 * Google-only sign-in. Every franchisee and HQ email is a daisyfirstaid.com
 * Google Workspace account (or a Gmail), so a single "Sign in with Google"
 * button is the whole login: no passwords to remember or reset, and the
 * on_auth_user_created trigger links a first-time login to the franchisee row
 * by email automatically. Kept deliberately to one button to be foolproof.
 */
export default function LoginPage() {
  const navigate = useNavigate();
  const { user, isHQ, notProvisioned, isLoading } = useRole();
  const [googleSubmitting, setGoogleSubmitting] = useState(false);

  // If already logged in, redirect to the right place.
  useEffect(() => {
    if (isLoading) return;
    if (!user) return;
    if (notProvisioned) {
      navigate('/unauthorized', { replace: true });
      return;
    }
    navigate(isHQ ? '/hq/dashboard' : '/franchisee/dashboard', { replace: true });
  }, [user, isHQ, notProvisioned, isLoading, navigate]);

  const onGoogle = async () => {
    setGoogleSubmitting(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      setGoogleSubmitting(false);
      toast.error(error.message);
    }
    // On success the browser is redirected to Google, so no further state to clear.
  };

  return (
    <div className="bg-daisy-bg flex min-h-screen items-center justify-center p-6">
      <Card className="shadow-lift w-full max-w-md">
        <CardHeader className="items-center text-center">
          <img
            src="/daisy-logo.png"
            alt="Daisy First Aid"
            className="mb-3 h-14 w-auto"
            draggable={false}
          />
          <CardDescription>Sign in to your portal</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Button
            type="button"
            variant="outline"
            disabled={googleSubmitting}
            onClick={() => void onGoogle()}
            className="border-daisy-line h-11 w-full justify-center gap-3 bg-white font-semibold"
          >
            <GoogleLogo />
            {googleSubmitting ? 'Redirecting…' : 'Sign in with Google'}
          </Button>
          <p className="text-daisy-muted text-center text-xs leading-snug">
            Use your daisyfirstaid.com Google account. There is no password to remember. If you
            cannot get in, contact HQ and we will sort it.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function GoogleLogo() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09Z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.25 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.43.34-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.78.43 3.46 1.18 4.94l3.66-2.84Z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z"
        fill="#EA4335"
      />
    </svg>
  );
}
