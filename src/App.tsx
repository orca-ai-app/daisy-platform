import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { RoleContextProvider } from '@/features/auth/RoleContext';
import { RequireRole } from '@/features/auth/RequireRole';
import LoginPage from '@/features/auth/LoginPage';
import AuthCallback from '@/features/auth/AuthCallback';
import Unauthorized from '@/features/auth/Unauthorized';
import { HQLayout } from '@/features/hq/HQLayout';
import Dashboard from '@/features/hq/Dashboard';
import { FranchiseeList, FranchiseeDetail, NewFranchiseePage } from '@/features/hq/franchisees';
import { TemplatesPage } from '@/features/hq/templates';
import { ActivityPage } from '@/features/hq/activity';
import { InterestFormsPage } from '@/features/hq/interest-forms';
import { RouteLoadingSkeleton } from '@/components/daisy';
import FranchiseeDashboard from '@/features/franchisee/FranchiseeDashboard';

/*
 * Wave 5A code-split: the three heaviest pages each pull in a sizeable
 * dependency (Recharts, jsPDF/html2canvas, Google Maps loader). Lazy-loading
 * them moves those bundles off the critical path so the initial route
 * (login + dashboard) drops below the 500 KB warning threshold.
 *
 * We also lazy the bookings list/detail and course-instances list/detail —
 * they sit behind several clicks from the dashboard and are happy to
 * stream in.
 */
const ReportsPage = lazy(() =>
  import('@/features/hq/reports').then((m) => ({ default: m.ReportsPage })),
);
const BillingPage = lazy(() =>
  import('@/features/hq/billing').then((m) => ({ default: m.BillingPage })),
);
const BillingRunDetail = lazy(() =>
  import('@/features/hq/billing').then((m) => ({ default: m.BillingRunDetail })),
);
const TerritoriesPage = lazy(() =>
  import('@/features/hq/territories').then((m) => ({ default: m.TerritoriesPage })),
);
const BookingsList = lazy(() =>
  import('@/features/hq/bookings').then((m) => ({ default: m.BookingsList })),
);
const BookingDetail = lazy(() =>
  import('@/features/hq/bookings').then((m) => ({ default: m.BookingDetail })),
);
const InstancesList = lazy(() =>
  import('@/features/hq/courses/instances').then((m) => ({ default: m.InstancesList })),
);
const InstanceDetail = lazy(() =>
  import('@/features/hq/courses/instances').then((m) => ({ default: m.InstanceDetail })),
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

/** Wraps lazy routes in Suspense + the standard skeleton fallback. */
function LazyRoute({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<RouteLoadingSkeleton />}>{children}</Suspense>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <RoleContextProvider>
          <TooltipProvider>
            <Routes>
              <Route path="/" element={<Navigate to="/login" replace />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/auth/callback" element={<AuthCallback />} />
              <Route path="/unauthorized" element={<Unauthorized />} />

              {/* HQ: sticky topbar shell wraps every nested route. */}
              <Route
                path="/hq"
                element={
                  <RequireRole hq>
                    <HQLayout />
                  </RequireRole>
                }
              >
                <Route index element={<Navigate to="/hq/dashboard" replace />} />
                <Route path="dashboard" element={<Dashboard />} />

                {/* Wave 2B: Franchisees (real pages); Wave 4A adds /new + edit dialog */}
                <Route path="franchisees" element={<FranchiseeList />} />
                <Route path="franchisees/new" element={<NewFranchiseePage />} />
                <Route path="franchisees/:id" element={<FranchiseeDetail />} />

                {/* Wave 2C: Course templates + activity log (real pages) */}
                <Route path="courses" element={<Navigate to="/hq/courses/templates" replace />} />
                <Route path="courses/templates" element={<TemplatesPage />} />
                {/* Wave 4B: Course instances list + detail (HQ override) */}
                <Route
                  path="courses/instances"
                  element={
                    <LazyRoute>
                      <InstancesList />
                    </LazyRoute>
                  }
                />
                <Route
                  path="courses/instances/:id"
                  element={
                    <LazyRoute>
                      <InstanceDetail />
                    </LazyRoute>
                  }
                />
                <Route path="activity" element={<ActivityPage />} />

                {/* Wave 3A: Territories (real page, lazy-loaded for the Maps lib) */}
                <Route
                  path="territories"
                  element={
                    <LazyRoute>
                      <TerritoriesPage />
                    </LazyRoute>
                  }
                />

                {/* Wave 3B: Bookings list + detail (real pages) */}
                <Route
                  path="bookings"
                  element={
                    <LazyRoute>
                      <BookingsList />
                    </LazyRoute>
                  }
                />
                <Route
                  path="bookings/:id"
                  element={
                    <LazyRoute>
                      <BookingDetail />
                    </LazyRoute>
                  }
                />

                {/* Wave 3B: Reports (Recharts) reachable from the Dashboard's
                    Network revenue KPI card; not in topbar nav. */}
                <Route
                  path="reports"
                  element={
                    <LazyRoute>
                      <ReportsPage />
                    </LazyRoute>
                  }
                />

                {/* Wave 3C: Interest form queue */}
                <Route path="interest-forms" element={<InterestFormsPage />} />

                {/* Wave 4C: Billing preview + accountant export (jsPDF + html2canvas) */}
                <Route
                  path="billing"
                  element={
                    <LazyRoute>
                      <BillingPage />
                    </LazyRoute>
                  }
                />
                <Route
                  path="billing/:run_id"
                  element={
                    <LazyRoute>
                      <BillingRunDetail />
                    </LazyRoute>
                  }
                />
              </Route>

              <Route
                path="/franchisee/dashboard"
                element={
                  <RequireRole franchisee>
                    <FranchiseeDashboard />
                  </RequireRole>
                }
              />
              <Route path="*" element={<Navigate to="/login" replace />} />
            </Routes>
            <Toaster richColors position="top-right" />
          </TooltipProvider>
        </RoleContextProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
