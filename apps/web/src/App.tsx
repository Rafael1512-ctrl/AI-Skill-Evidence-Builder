import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';

import { ProtectedRoute } from './components/ProtectedRoute.js';
import { AuthProvider } from './lib/auth.js';
import { AdminPage } from './pages/AdminPage.js';
import { AuditPage } from './pages/AuditPage.js';
import { CreditsPage } from './pages/CreditsPage.js';
import { EnhancePage } from './pages/EnhancePage.js';
import { HomePage } from './pages/HomePage.js';
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
            <Route path="/audit" element={<AuditPage />} />
            <Route path="/credits" element={<CreditsPage />} />
            <Route path="/testimonials" element={<TestimonialsPage />} />
            <Route
              path="/admin"
              element={
                <ProtectedRoute>
                  <AdminPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/enhance"
              element={
                <ProtectedRoute>
                  <EnhancePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/profile"
              element={
                <ProtectedRoute>
                  <ProfilePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/screening"
              element={
                <ProtectedRoute>
                  <ScreeningPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/screening/:jobId"
              element={
                <ProtectedRoute>
                  <ScreeningJobPage />
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
