// "Changes in version N": the diff and lint of a draft against the active version
// (CLAUDE.md 4.7), then "Publish version N". Lint errors block the button, the same rule
// the server enforces on publish.
import type { ConfigChange } from '@funnel/shared';
import { useQuery } from '@tanstack/react-query';
import { apiQuery } from '../../lib/query.ts';
import { Button } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import styles from './VersionsPage.module.css';

function marker(change: ConfigChange): { sign: string; tone: string | undefined } {
  if (change.kind.endsWith('_added')) return { sign: '+', tone: styles.add };
  if (change.kind.endsWith('_removed')) return { sign: '−', tone: styles.del };
  return { sign: '~', tone: styles.mod };
}

export function DiffPanel({
  version,
  draft,
  staying,
  onPublish,
}: {
  version: number | null;
  draft: boolean;
  staying: string;
  onPublish: (version: number) => void;
}) {
  const diff = useQuery({
    ...apiQuery('versionDiff', { params: { v: version ?? 0 }, query: { against: 'active' } }),
    enabled: version !== null,
  });

  if (version === null) {
    return (
      <Card variant="panel" aria-labelledby="diff-title">
        <div className={styles.ph}>
          <h2 id="diff-title">Changes</h2>
        </div>
        <p className={styles.note}>
          No drafts. Upload a config to review its changes against the active version.
        </p>
      </Card>
    );
  }

  const errors = diff.data?.lint.errors ?? [];
  const warnings = diff.data?.lint.warnings ?? [];
  const changes = diff.data?.changes ?? [];
  const v = String(version);

  return (
    <Card variant="panel" aria-labelledby="diff-title">
      <div className={styles.ph}>
        <h2 id="diff-title">Changes in version {v}</h2>
        {diff.data?.against != null && (
          <span className={styles.sub}>against version {diff.data.against}</span>
        )}
      </div>
      {diff.isPending && <p className={styles.note}>Comparing…</p>}
      {diff.isError && (
        <p className={styles.note} role="alert">
          This version cannot be compared or published: {diff.error.message}
        </p>
      )}
      {diff.data && (
        <>
          {changes.length === 0 ? (
            <p className={styles.note}>No changes against the active version.</p>
          ) : (
            <ul className={styles.diff}>
              {changes.map((change) => {
                const { sign, tone } = marker(change);
                return (
                  <li
                    key={`${change.kind}:${change.variant ?? ''}:${change.subject}:${change.message}`}
                  >
                    <b className={tone} aria-hidden="true">
                      {sign}
                    </b>
                    <span>{change.message}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {errors.length > 0 && (
            <div className={styles.lint} role="alert">
              <h3>Blocks publishing</h3>
              <ul>
                {errors.map((e) => (
                  <li key={`${e.code}:${e.message}`}>{e.message}</li>
                ))}
              </ul>
            </div>
          )}
          {warnings.length > 0 && (
            <div className={styles.lint}>
              <h3>Worth a second look</h3>
              <ul>
                {warnings.map((w) => (
                  <li key={`${w.code}:${w.message}`}>{w.message}</li>
                ))}
              </ul>
            </div>
          )}
          {draft && (
            <>
              <p className={styles.note}>
                {errors.length === 0
                  ? `All checks passed. ${staying}`
                  : 'Fix the errors and upload the config again.'}
              </p>
              <Button
                disabled={errors.length > 0}
                onClick={() => {
                  onPublish(version);
                }}
              >
                Publish version {v}
              </Button>
            </>
          )}
        </>
      )}
    </Card>
  );
}
