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
import { TerritoryRequestsPage } from '@/features/hq/territory-requests';
import { RouteLoadingSkeleton } from '@/components/daisy';
import { FranchiseeLayout } from '@/features/franchisee/FranchiseeLayout';
import FranchiseeDashboard from '@/features/franchisee/Dashboard';
import FranchiseeProfile from '@/features/franchisee/Profile';
import FranchiseeTerritories from '@/features/franchisee/Territories';

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
const MedicalDeclarationsList = lazy(() =>
  import('@/features/hq/medical-declarations').then((m) => ({
    default: m.MedicalDeclarationsList,
  })),
);
const EmailsPage = lazy(() =>
  import('@/features/hq/emails').then((m) => ({ default: m.EmailsPage })),
);
const EmailEditorPage = lazy(() =>
  import('@/features/hq/emails').then((m) => ({ default: m.EmailEditorPage })),
);
const MediaLibraryPage = lazy(() =>
  import('@/features/hq/emails').then((m) => ({ default: m.MediaLibraryPage })),
);
const InstancesList = lazy(() =>
  import('@/features/hq/courses/instances').then((m) => ({ default: m.InstancesList })),
);
const InstanceDetail = lazy(() =>
  import('@/features/hq/courses/instances').then((m) => ({ default: m.InstanceDetail })),
);

/*
 * Wave 7 (M2): franchisee course-management pages. Lazy-loaded — the list
 * carries a month calendar and the create wizard pulls in the territory map /
 * geocode flow, so they stay off the dashboard's critical path.
 */
const FranchiseeCoursesList = lazy(() => import('@/features/franchisee/courses/CoursesList'));
const FranchiseeCreateCourse = lazy(() => import('@/features/franchisee/courses/CreateCourse'));
const FranchiseeCourseDetail = lazy(() => import('@/features/franchisee/courses/CourseDetail'));
const FranchiseeEditCourse = lazy(() => import('@/features/franchisee/courses/EditCourse'));

/*
 * Wave 9 (M2): discount codes (9B) and private clients (9C). Both are simple
 * DataTable + dialog pages; lazy-loaded to keep them off the dashboard's
 * critical path, matching the Wave 7 course pages.
 */
const FranchiseeDiscountsList = lazy(() => import('@/features/franchisee/discounts/DiscountsList'));
const FranchiseeClientsList = lazy(() => import('@/features/franchisee/clients/ClientsList'));

/*
 * Wave 11: franchisee customers view. Lazy-loaded — simple DataTable page.
 */
const FranchiseeCustomersList = lazy(() => import('@/features/franchisee/customers/CustomersList'));

/*
 * Wave 8 (M2): Stripe Connect / payments hub (8A). Lazy-loaded — the page is
 * reached from the Payments nav link and also serves as the Account Link
 * `return_url` / `refresh_url` landing (it reads `?success` / `?refresh` query
 * params; query params do not change the matched route, so no extra route is
 * needed). 8B's "Generate payment link" UI lives inside Wave 7's CourseDetail.
 */
const FranchiseePaymentsPage = lazy(() =>
  import('@/features/franchisee/payments').then((m) => ({ default: m.PaymentsPage })),
);

/*
 * Wave 9A (M2): franchisee bookings list + detail. Lazy-loaded — sits behind
 * the Bookings nav link and is only reached after several interactions.
 */
const FranchiseeBookingsList = lazy(() => import('@/features/franchisee/bookings/BookingsList'));
const FranchiseeBookingDetail = lazy(() => import('@/features/franchisee/bookings/BookingDetail'));

// 5-minute staleTime by default — Daisy's data (franchisees, territories,
// templates, billing runs) all change on a human timescale, not a real-time
// one. The previous 30s was triggering refetches on almost every interaction
// in long-lived sessions. Individual queries can override via their own
// staleTime if they need fresher data.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      staleTime: 5 * 60_000,
      gcTime: 30 * 60_000,
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
                  path="medical"
                  element={
                    <LazyRoute>
                      <MedicalDeclarationsList />
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

                {/* Emails: booking-journey templates, editor + media library.
                    `media` must precede `:templateKey` so it isn't swallowed
                    by the param route. */}
                <Route
                  path="emails"
                  element={
                    <LazyRoute>
                      <EmailsPage />
                    </LazyRoute>
                  }
                />
                <Route
                  path="emails/media"
                  element={
                    <LazyRoute>
                      <MediaLibraryPage />
                    </LazyRoute>
                  }
                />
                <Route
                  path="emails/:templateKey"
                  element={
                    <LazyRoute>
                      <EmailEditorPage />
                    </LazyRoute>
                  }
                />

                {/* Wave 3C: Interest form queue */}
                <Route path="interest-forms" element={<InterestFormsPage />} />
                <Route path="territory-requests" element={<TerritoryRequestsPage />} />

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

              {/* Wave 6 (M2): franchisee portal shell wraps every nested route. */}
              <Route
                path="/franchisee"
                element={
                  <RequireRole franchisee>
                    <FranchiseeLayout />
                  </RequireRole>
                }
              >
                <Route index element={<Navigate to="/franchisee/dashboard" replace />} />
                <Route path="dashboard" element={<FranchiseeDashboard />} />
                <Route path="profile" element={<FranchiseeProfile />} />
                <Route path="territories" element={<FranchiseeTerritories />} />

                {/* Wave 7 (M2): course management. `new` must precede `:id`
                    so it isn't swallowed by the param route. */}
                <Route
                  path="courses"
                  element={
                    <LazyRoute>
                      <FranchiseeCoursesList />
                    </LazyRoute>
                  }
                />
                <Route
                  path="courses/new"
                  element={
                    <LazyRoute>
                      <FranchiseeCreateCourse />
                    </LazyRoute>
                  }
                />
                <Route
                  path="courses/:id"
                  element={
                    <LazyRoute>
                      <FranchiseeCourseDetail />
                    </LazyRoute>
                  }
                />
                <Route
                  path="courses/:id/edit"
                  element={
                    <LazyRoute>
                      <FranchiseeEditCourse />
                    </LazyRoute>
                  }
                />

                {/* Wave 9 (M2): discount codes (9B) + private clients (9C). */}
                <Route
                  path="discounts"
                  element={
                    <LazyRoute>
                      <FranchiseeDiscountsList />
                    </LazyRoute>
                  }
                />
                <Route
                  path="clients"
                  element={
                    <LazyRoute>
                      <FranchiseeClientsList />
                    </LazyRoute>
                  }
                />

                {/* Wave 11: customers view (RLS-scoped da_customers). */}
                <Route
                  path="customers"
                  element={
                    <LazyRoute>
                      <FranchiseeCustomersList />
                    </LazyRoute>
                  }
                />

                {/* Wave 8 (M2): Stripe Connect / payments hub (8A). Also the
                    Account Link return/refresh landing — the page reads
                    `?success` / `?refresh` query params off this same route. */}
                <Route
                  path="payments"
                  element={
                    <LazyRoute>
                      <FranchiseePaymentsPage />
                    </LazyRoute>
                  }
                />

                {/* Wave 9A (M2): franchisee bookings list + detail. */}
                <Route
                  path="bookings"
                  element={
                    <LazyRoute>
                      <FranchiseeBookingsList />
                    </LazyRoute>
                  }
                />
                <Route
                  path="bookings/:id"
                  element={
                    <LazyRoute>
                      <FranchiseeBookingDetail />
                    </LazyRoute>
                  }
                />
              </Route>

              <Route path="*" element={<Navigate to="/login" replace />} />
            </Routes>
            <Toaster richColors position="top-right" />
          </TooltipProvider>
        </RoleContextProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
