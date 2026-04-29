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
import { InstancesList, InstanceDetail } from '@/features/hq/courses/instances';
import { ActivityPage } from '@/features/hq/activity';
import { TerritoriesPage } from '@/features/hq/territories';
import { BookingsList, BookingDetail } from '@/features/hq/bookings';
import { ReportsPage } from '@/features/hq/reports';
import { InterestFormsPage } from '@/features/hq/interest-forms';
import { BillingPage, BillingRunDetail } from '@/features/hq/billing';
import FranchiseeDashboard from '@/features/franchisee/FranchiseeDashboard';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

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

              {/* HQ — sticky topbar shell wraps every nested route. */}
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

                {/* Wave 2B — Franchisees (real pages); Wave 4A adds /new + edit dialog */}
                <Route path="franchisees" element={<FranchiseeList />} />
                <Route path="franchisees/new" element={<NewFranchiseePage />} />
                <Route path="franchisees/:id" element={<FranchiseeDetail />} />

                {/* Wave 2C — Course templates + activity log (real pages) */}
                <Route path="courses" element={<Navigate to="/hq/courses/templates" replace />} />
                <Route path="courses/templates" element={<TemplatesPage />} />
                {/* Wave 4B — Course instances list + detail (HQ override) */}
                <Route path="courses/instances" element={<InstancesList />} />
                <Route path="courses/instances/:id" element={<InstanceDetail />} />
                <Route path="activity" element={<ActivityPage />} />

                {/* Wave 3A — Territories (real page) */}
                <Route path="territories" element={<TerritoriesPage />} />

                {/* Wave 3B — Bookings list + detail (real pages) */}
                <Route path="bookings" element={<BookingsList />} />
                <Route path="bookings/:id" element={<BookingDetail />} />

                {/* Wave 3B — Reports (reachable from the Dashboard's
                    Network revenue KPI card; not in topbar nav). */}
                <Route path="reports" element={<ReportsPage />} />

                {/* Wave 3C — Interest form queue */}
                <Route path="interest-forms" element={<InterestFormsPage />} />

                {/* Wave 4C — Billing preview + accountant export */}
                <Route path="billing" element={<BillingPage />} />
                <Route path="billing/:run_id" element={<BillingRunDetail />} />
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
