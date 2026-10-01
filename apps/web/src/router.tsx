// Route table (React Router data mode). Funnel at / and /s/:stepId, admin under /admin.
import { createBrowserRouter } from 'react-router';
import { AdminLayout } from './features/admin-shell/AdminLayout.tsx';
import { FunnelPage } from './features/funnel/FunnelPage.tsx';

export const router = createBrowserRouter([
  // One layout route, so the funnel stays mounted while the URL moves between steps.
  { element: <FunnelPage />, children: [{ path: '/' }, { path: '/s/:stepId' }] },
  { path: '/admin/*', element: <AdminLayout /> },
]);
