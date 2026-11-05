import { useLocation } from 'react-router-dom';

import { AdminAiUsagePage } from './admin/AdminAiUsagePage.js';
import { AdminBillingPage } from './admin/AdminBillingPage.js';
import { AdminDashboardPage } from './admin/AdminDashboardPage.js';
import { AdminReportsPage } from './admin/AdminReportsPage.js';
import { AdminScreeningPage } from './admin/AdminScreeningPage.js';
import { AdminSettingsPage } from './admin/AdminSettingsPage.js';
import { AdminUsersPage } from './admin/AdminUsersPage.js';

/**
 * Admin route dispatcher.
 *
 * Each section has its own URL so filters, pagination and operational bookmarks survive reloads.
 * The shared `AdminShell` in `App` handles the role gate before this component renders.
 */
export function AdminPage() {
  const { pathname } = useLocation();

  if (pathname.startsWith('/admin/reports')) return <AdminReportsPage />;
  if (pathname.startsWith('/admin/users')) return <AdminUsersPage />;
  if (pathname.startsWith('/admin/billing')) return <AdminBillingPage />;
  if (pathname.startsWith('/admin/ai-usage')) return <AdminAiUsagePage />;
  if (pathname.startsWith('/admin/screening')) return <AdminScreeningPage />;
  if (pathname.startsWith('/admin/settings')) return <AdminSettingsPage />;
  return <AdminDashboardPage />;
}
