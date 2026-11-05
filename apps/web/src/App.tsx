import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';

import { CreditsRoute } from './components/CreditsRoute.js';
import { AdminShell } from './components/AdminShell.js';
import { DashboardShell, WorkspaceShell } from './components/DashboardShell.js';
import { ProtectedRoute } from './components/ProtectedRoute.js';
import { AuthProvider } from './lib/auth.js';
import { AdminPage } from './pages/AdminPage.js';
import { AuditDetailPage } from './pages/AuditDetailPage.js';
import { AuditHistoryPage } from './pages/AuditHistoryPage.js';
import { AuditPage } from './pages/AuditPage.js';
import { EnhancementDetailPage } from './pages/EnhancementDetailPage.js';
import { EnhancementHistoryPage } from './pages/EnhancementHistoryPage.js';
import { EnhancePage } from './pages/EnhancePage.js';
import { HrdDashboardPage } from './pages/HrdDashboardPage.js';
import { HomePage } from './pages/HomePage.js';
import { JobSeekerDashboardPage } from './pages/JobSeekerDashboardPage.js';
import { ProfilePage } from './pages/ProfilePage.js';
import { ScreeningJobPage } from './pages/ScreeningJobPage.js';
import { ScreeningPage } from './pages/ScreeningPage.js';
import { SignInPage } from './pages/SignInPage.js';
import { TestimonialsPage } from './pages/TestimonialsPage.js';

function NotFoundPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold">Halaman tidak ditemukan</h1>
      <Link to="/" className="text-sm font-medium text-[var(--color-brand)]">
        Kembali ke beranda
      </Link>
    </main>
  );
}

/**
 * Application root: providers, then routes.
 *
 * The query client is created per app instance so tests get isolation, and
 * `AuthProvider` sits inside it because the session is derived from `GET /api/profile`.
 */
export function App() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/signin" element={<SignInPage />} />
            <Route
              path="/audit"
              element={
                <ProtectedRoute>
                  <DashboardShell role="job-seeker">
                    <AuditPage />
                  </DashboardShell>
                </ProtectedRoute>
              }
            />
            <Route
              path="/audit/history"
              element={
                <ProtectedRoute>
                  <DashboardShell role="job-seeker">
                    <AuditHistoryPage />
                  </DashboardShell>
                </ProtectedRoute>
              }
            />
            <Route
              path="/audit/history/:analysisId"
              element={
                <ProtectedRoute>
                  <DashboardShell role="job-seeker">
                    <AuditDetailPage />
                  </DashboardShell>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/job-seeker"
              element={
                <ProtectedRoute>
                  <DashboardShell role="job-seeker">
                    <JobSeekerDashboardPage />
                  </DashboardShell>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/hrd"
              element={
                <ProtectedRoute>
                  <DashboardShell role="hrd">
                    <HrdDashboardPage />
                  </DashboardShell>
                </ProtectedRoute>
              }
            />
            <Route path="/credits" element={<CreditsRoute />} />
            <Route path="/testimonials" element={<TestimonialsPage />} />
            <Route
              path="/admin"
              element={
                <ProtectedRoute>
                  <AdminShell>
                    <AdminPage />
                  </AdminShell>
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/reports"
              element={
                <ProtectedRoute>
                  <AdminShell>
                    <AdminPage />
                  </AdminShell>
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/users"
              element={
                <ProtectedRoute>
                  <AdminShell>
                    <AdminPage />
                  </AdminShell>
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/billing"
              element={
                <ProtectedRoute>
                  <AdminShell>
                    <AdminPage />
                  </AdminShell>
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/ai-usage"
              element={
                <ProtectedRoute>
                  <AdminShell>
                    <AdminPage />
                  </AdminShell>
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/screening"
              element={
                <ProtectedRoute>
                  <AdminShell>
                    <AdminPage />
                  </AdminShell>
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/settings"
              element={
                <ProtectedRoute>
                  <AdminShell>
                    <AdminPage />
                  </AdminShell>
                </ProtectedRoute>
              }
            />
            <Route
              path="/enhance"
              element={
                <ProtectedRoute>
                  <DashboardShell role="job-seeker">
                    <EnhancePage />
                  </DashboardShell>
                </ProtectedRoute>
              }
            />
            <Route
              path="/enhance/history"
              element={
                <ProtectedRoute>
                  <DashboardShell role="job-seeker">
                    <EnhancementHistoryPage />
                  </DashboardShell>
                </ProtectedRoute>
              }
            />
            <Route
              path="/enhance/history/:enhancementId"
              element={
                <ProtectedRoute>
                  <DashboardShell role="job-seeker">
                    <EnhancementDetailPage />
                  </DashboardShell>
                </ProtectedRoute>
              }
            />
            <Route
              path="/profile"
              element={
                <ProtectedRoute>
                  <WorkspaceShell>
                    <ProfilePage />
                  </WorkspaceShell>
                </ProtectedRoute>
              }
            />
            <Route
              path="/screening"
              element={
                <ProtectedRoute>
                  <DashboardShell role="hrd">
                    <ScreeningPage />
                  </DashboardShell>
                </ProtectedRoute>
              }
            />
            <Route
              path="/screening/:jobId"
              element={
                <ProtectedRoute>
                  <DashboardShell role="hrd">
                    <ScreeningJobPage />
                  </DashboardShell>
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
