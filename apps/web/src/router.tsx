// Route table (React Router data mode). Funnel at / and /s/:stepId, admin under /admin.
import { createBrowserRouter } from 'react-router';
import { AdminLayout } from './features/admin-shell/AdminLayout.tsx';
import { FunnelPage } from './features/funnel/FunnelPage.tsx';
import { PreviewPage } from './features/funnel/PreviewPage.tsx';

export const router = createBrowserRouter([
  // One layout route, so the funnel stays mounted while the URL moves between steps.
  { element: <FunnelPage />, children: [{ path: '/' }, { path: '/s/:stepId' }] },
  // In-memory preview of any version: no session, no events (11.1).
  { path: '/admin/preview/:version', element: <PreviewPage /> },
  { path: '/admin/*', element: <AdminLayout /> },
]);
