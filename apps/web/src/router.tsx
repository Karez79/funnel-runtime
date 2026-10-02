// Route table (React Router data mode). Funnel at / and /s/:stepId, admin under /admin.
import { createBrowserRouter } from 'react-router';
import { FunnelPage } from './features/funnel/FunnelPage.tsx';
import { PreviewPage } from './features/funnel/PreviewPage.tsx';

/** Nothing to show while the admin chunk loads (it is small and same-origin). */
function AdminLoading() {
  return null;
}

export const router = createBrowserRouter([
  // One layout route, so the funnel stays mounted while the URL moves between steps.
  { element: <FunnelPage />, children: [{ path: '/' }, { path: '/s/:stepId' }] },
  // In-memory preview of any version: no session, no events (11.1).
  { path: '/admin/preview/:version', element: <PreviewPage /> },
  {
    path: '/admin',
    // The admin is loaded on demand: the funnel bundle never carries the dashboard.
    HydrateFallback: AdminLoading,
    lazy: async () => ({
      Component: (await import('./features/admin-shell/AdminLayout.tsx')).AdminLayout,
    }),
    children: [
      {
        index: true,
        lazy: async () => ({
          Component: (await import('./features/dashboard/DashboardPage.tsx')).DashboardPage,
        }),
      },
      {
        path: 'versions',
        lazy: async () => ({
          Component: (await import('./features/versions/VersionsPage.tsx')).VersionsPage,
        }),
      },
      {
        path: 'live',
        lazy: async () => ({
          Component: (await import('./features/live/LiveEventsPage.tsx')).LiveEventsPage,
        }),
      },
    ],
  },
]);
