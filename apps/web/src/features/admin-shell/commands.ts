// Commands of the ⌘K palette. Publishing and rolling back always go through the Versions
// page and its confirmation dialog (`?publish=N`, `?rollback=1`): the palette never
// changes the active version silently.
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { apiQuery } from '../../lib/query.ts';
import type { Command } from '../../ui/CommandPalette.tsx';
import { ADMIN_PAGES } from './pages.ts';

/** A session id or a prefix of one (uuid v7, hex with dashes). */
const SESSION_QUERY = /^[0-9a-f][0-9a-f-]{3,35}$/i;

export function usePaletteCommands(): (query: string) => readonly Command[] {
  const navigate = useNavigate();
  const versions = useQuery(apiQuery('listVersions', {}));
  const go = (to: string) => () => {
    void navigate(to, { viewTransition: true });
  };

  const list = versions.data?.versions ?? [];
  const drafts = list.filter((v) => v.state === 'draft').sort((a, b) => b.version - a.version);
  const previous = versions.data?.activations[0]?.fromVersion ?? null;

  const pages: Command[] = ADMIN_PAGES.map((page) => ({
    id: `go:${page.to}`,
    group: 'Go to',
    label: page.label,
    icon: page.icon,
    run: go(page.to),
  }));
  const actions: Command[] = [
    ...drafts.map((v) => ({
      id: `publish:${String(v.version)}`,
      group: 'Actions',
      label: `Publish version ${String(v.version)}`,
      icon: 'upload' as const,
      run: go(`/admin/versions?publish=${String(v.version)}`),
    })),
    ...(previous === null
      ? []
      : [
          {
            id: 'rollback',
            group: 'Actions',
            label: `Roll back to version ${String(previous)}`,
            icon: 'undo' as const,
            run: go('/admin/versions?rollback=1'),
          },
        ]),
    ...(['A', 'B'] as const).map((variant) => ({
      id: `open:${variant}`,
      group: 'Actions',
      label: `Open funnel as variant ${variant}`,
      icon: 'eye' as const,
      run: () => {
        window.open(`/?variant=${variant}`, '_blank', 'noopener');
      },
    })),
  ];

  return (query) => [
    ...pages,
    ...actions,
    ...(SESSION_QUERY.test(query)
      ? [
          {
            id: `session:${query}`,
            group: 'Sessions',
            label: `Find session ${query}`,
            icon: 'arrow' as const,
            always: true,
            run: go(`/admin/live?session=${encodeURIComponent(query)}`),
          },
        ]
      : []),
  ];
}
