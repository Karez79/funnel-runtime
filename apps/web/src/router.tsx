// Route table (React Router data mode). Funnel at / and /s/:stepId, admin under /admin.
import { createBrowserRouter } from 'react-router';
import { AdminLayout } from './features/admin-shell/AdminLayout.tsx';
import { DashboardPage } from './features/dashboard/DashboardPage.tsx';
import { FunnelPage } from './features/funnel/FunnelPage.tsx';
import { LiveEventsPage } from './features/live/LiveEventsPage.tsx';
import { VersionsPage } from './features/versions/VersionsPage.tsx';

export const router = createBrowserRouter([
  { path: '/', element: <FunnelPage /> },
  { path: '/s/:stepId', element: <FunnelPage /> },
  {
    path: '/admin',
    element: <AdminLayout />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'versions', element: <VersionsPage /> },
      { path: 'live', element: <LiveEventsPage /> },
    ],
  },
]);
