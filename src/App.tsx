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
import { FranchiseeList, FranchiseeDetail } from '@/features/hq/franchisees';
import { TemplatesPage } from '@/features/hq/templates';
import { ActivityPage } from '@/features/hq/activity';
import FranchiseeDashboard from '@/features/franchisee/FranchiseeDashboard';
import { EmptyState } from '@/components/daisy';
import { PageHeader } from '@/components/daisy';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

/**
 * Sibling-coordination placeholder for routes still owned by later
 * waves (Wave 3 territories/bookings, Wave 4 billing).
 */
function ComingSoon({ wave, title }: { wave: string; title: string }) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={title} subtitle={`Coming in ${wave}.`} />
      <EmptyState
        title={`${title} — coming in ${wave}`}
        body="A later wave wires this page. Once that PR merges, this placeholder will be replaced."
      />
    </div>
  );
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

                {/* Wave 2B — Franchisees (real pages) */}
                <Route path="franchisees" element={<FranchiseeList />} />
                <Route path="franchisees/:id" element={<FranchiseeDetail />} />

                {/* Wave 2C — Course templates + activity log (real pages) */}
                <Route
                  path="courses"
                  element={<Navigate to="/hq/courses/templates" replace />}
                />
                <Route path="courses/templates" element={<TemplatesPage />} />
                <Route path="activity" element={<ActivityPage />} />

                {/* Wave 3 — territories, bookings, billing */}
                <Route
                  path="territories"
                  element={<ComingSoon wave="Wave 3" title="Territories" />}
                />
                <Route path="bookings" element={<ComingSoon wave="Wave 3" title="Bookings" />} />
                <Route path="billing" element={<ComingSoon wave="Wave 4" title="Billing" />} />
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
