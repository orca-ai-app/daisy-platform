import { Skeleton } from '@/components/ui/skeleton';

/**
 * Suspense fallback for lazy-loaded HQ routes.
 *
 * Mirrors the standard HQ page layout (header, then a stack of cards) so
 * the topbar height and main content area don't shift while the chunk
 * downloads. Used by App.tsx for the three heaviest routes that pull in
 * Recharts, jsPDF/html2canvas and the Google Maps lib.
 */
export function RouteLoadingSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 pb-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
      <Skeleton className="h-[320px] w-full" />
      <Skeleton className="h-[200px] w-full" />
    </div>
  );
}

export default RouteLoadingSkeleton;
