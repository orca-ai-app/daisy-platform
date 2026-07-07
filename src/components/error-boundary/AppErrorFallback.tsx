import { AlertTriangle } from 'lucide-react';
import type { FallbackProps } from 'react-error-boundary';
import { Button } from '@/components/ui/button';

/**
 * Full-page fallback for the app-level ErrorBoundary in App.tsx (the layouts
 * carry their own inner boundaries for route content — this one catches
 * everything outside them: providers, layout chrome, login).
 *
 * The ref is stamped onto the error object by the boundary's onError handler
 * (see handleAppError in App.tsx) so the value shown here matches the one
 * logged to da_system_logs via the browser logger.
 */
export function AppErrorFallback({ error }: FallbackProps) {
  const ref = (error as { __daisyRef?: string } | null)?.__daisyRef ?? 'unknown';

  return (
    <div className="bg-daisy-bg flex min-h-screen items-center justify-center p-6">
      <div className="border-daisy-line-soft bg-daisy-paper shadow-card flex w-full max-w-md flex-col items-center gap-4 rounded-[12px] border p-8 text-center">
        <div
          className="bg-daisy-primary-tint text-daisy-primary-deep flex h-14 w-14 items-center justify-center rounded-full"
          aria-hidden
        >
          <AlertTriangle className="h-7 w-7" />
        </div>
        <h1 className="font-display text-daisy-ink text-xl font-extrabold">
          Something went wrong (ref {ref})
        </h1>
        <p className="text-daisy-muted text-sm">
          Refresh to continue. If it keeps happening, quote the ref above to support.
        </p>
        <Button className="mt-1" onClick={() => window.location.reload()}>
          Refresh
        </Button>
      </div>
    </div>
  );
}

export default AppErrorFallback;
