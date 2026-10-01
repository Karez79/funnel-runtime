import type { VersionSummary } from '@funnel/shared';
import { Link } from 'react-router';
import { formatCount, formatDateTime } from '../../lib/format.ts';
import { Button } from '../../ui/Button.tsx';
import { Pill } from '../../ui/Pill.tsx';
import { Mono, Table, Td, Th } from '../../ui/Table.tsx';
import { VisuallyHidden } from '../../ui/VisuallyHidden.tsx';
import styles from './VersionsPage.module.css';

function Status({ version }: { version: VersionSummary }) {
  if (version.active) return <Pill tone="black">Active</Pill>;
  if (version.state === 'published') return <Pill tone="blue">Published</Pill>;
  return <Pill tone="dashed">Draft</Pill>;
}

export function VersionsTable({
  versions,
  previous,
  reviewed,
  onReview,
  onRollback,
  onActivate,
}: {
  versions: readonly VersionSummary[];
  /** The version a rollback returns to (the journal's last `fromVersion`). */
  previous: number | null;
  reviewed: number | null;
  onReview: (version: number) => void;
  onRollback: (version: number) => void;
  onActivate: (version: number) => void;
}) {
  const newestFirst = [...versions].sort((a, b) => b.version - a.version);
  return (
    <Table label="All versions">
      <thead>
        <tr>
          <Th>Version</Th>
          <Th>Status</Th>
          <Th>Release note</Th>
          <Th>Activated</Th>
          <Th numeric>In progress</Th>
          <Th numeric>Sessions</Th>
          <Th>
            <VisuallyHidden>Actions</VisuallyHidden>
          </Th>
        </tr>
      </thead>
      <tbody>
        {newestFirst.map((v) => (
          <tr key={v.version} aria-current={v.version === reviewed ? 'true' : undefined}>
            <Td>
              <b>{v.version}</b>
            </Td>
            <Td>
              <Status version={v} />
            </Td>
            <Td>
              <span className={styles.noteCell}>{v.releaseNote ?? v.title}</span>
            </Td>
            <Td>
              <Mono>{v.activatedAt ? formatDateTime(v.activatedAt) : '–'}</Mono>
            </Td>
            <Td numeric>{v.state === 'draft' ? '–' : formatCount(v.activeSessions)}</Td>
            <Td numeric>{formatCount(v.totalSessions)}</Td>
            <Td numeric>
              <span className={styles.rowActions}>
                {v.state === 'draft' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      onReview(v.version);
                    }}
                  >
                    Review changes
                  </Button>
                )}
                {!v.active && v.state === 'published' && v.version === previous && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      onRollback(v.version);
                    }}
                  >
                    Roll back to version {v.version}
                  </Button>
                )}
                {!v.active && v.state === 'published' && v.version !== previous && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      onActivate(v.version);
                    }}
                  >
                    Activate version {v.version}
                  </Button>
                )}
                <Link
                  className={styles.preview}
                  to={`/admin/preview/${String(v.version)}?variant=A`}
                >
                  Preview
                </Link>
              </span>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
