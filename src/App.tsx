import { BrowserRouter, Routes, Route, Navigate } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { RoleContextProvider } from '@/features/auth/RoleContext'
import { RequireRole } from '@/features/auth/RequireRole'
import LoginPage from '@/features/auth/LoginPage'
import AuthCallback from '@/features/auth/AuthCallback'
import Unauthorized from '@/features/auth/Unauthorized'
import HQDashboard from '@/features/hq/HQDashboard'
import FranchiseeDashboard from '@/features/franchisee/FranchiseeDashboard'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
})

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
              <Route
                path="/hq/dashboard"
                element={
                  <RequireRole hq>
                    <HQDashboard />
                  </RequireRole>
                }
              />
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
  )
}
