import { AlertTriangle } from 'lucide-react';
import type { FallbackProps } from 'react-error-boundary';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/**
 * Friendly fallback rendered by the global ErrorBoundary in HQLayout.
 *
 * Sits inside the topbar shell (the boundary wraps the <Outlet />) so the
 * navigation chrome stays usable even when a page throws. Stack traces are
 * never exposed; we surface a truncated error message as a small grey code
 * line so support can ask for it without flooding the screen.
 */
export function ErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'An unexpected error occurred.';
  const truncated = message.length > 200 ? `${message.slice(0, 197)}...` : message;

  const handleReset = () => {
    resetErrorBoundary();
    // Force a fresh render of the route. Caches and lazy chunks may be
    // in a bad state, so a navigation refresh is the safest recovery.
    window.location.reload();
  };

  return (
    <div className="flex min-h-[60vh] items-center justify-center py-12">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
          <div
            className="bg-daisy-primary-tint text-daisy-primary-deep flex h-14 w-14 items-center justify-center rounded-full"
            aria-hidden
          >
            <AlertTriangle className="h-7 w-7" />
          </div>
          <h2 className="font-display text-daisy-ink text-xl font-extrabold">
            Something went wrong
          </h2>
          <p className="text-daisy-muted text-sm">
            This page hit a snag. Reload to try again, or head back to the dashboard.
          </p>
          <div className="flex flex-col gap-2 pt-2 sm:flex-row">
            <Button onClick={handleReset}>Reload page</Button>
            <Button variant="outline" asChild>
              <a href="/hq/dashboard">Back to dashboard</a>
            </Button>
          </div>
          <p className="text-daisy-muted/80 mt-3 max-w-full font-mono text-[11px] break-all">
            {truncated}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default ErrorFallback;
