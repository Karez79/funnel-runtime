// Route table (React Router data mode). Funnel at / and /s/:stepId, admin under /admin.
import { createBrowserRouter } from 'react-router';
import { AdminLayout } from './features/admin-shell/AdminLayout.tsx';
import { FunnelPage } from './features/funnel/FunnelPage.tsx';

export const router = createBrowserRouter([
  { path: '/', element: <FunnelPage /> },
  { path: '/s/:stepId', element: <FunnelPage /> },
  { path: '/admin/*', element: <AdminLayout /> },
]);
