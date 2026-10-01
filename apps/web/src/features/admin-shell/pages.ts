import type { IconName } from '../../ui/Icon.tsx';

/** Admin pages in navigation order: one list for the tabs, the rail and the palette. */
export const ADMIN_PAGES: readonly {
  to: string;
  label: string;
  icon: IconName;
  /** Match the path exactly (the dashboard is the index route). */
  end: boolean;
}[] = [
  { to: '/admin', label: 'Analytics', icon: 'chart', end: true },
  { to: '/admin/versions', label: 'Versions', icon: 'layers', end: false },
  { to: '/admin/live', label: 'Live events', icon: 'pulse', end: false },
];
