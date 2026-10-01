import type { contract } from '@funnel/shared';
import type { z } from 'zod';
import { formatDateTime } from '../../lib/format.ts';
import styles from './VersionsPage.module.css';

type Activation = z.output<typeof contract.listVersions.response>['activations'][number];

function describe(a: Activation): string {
  const v = String(a.version);
  if (a.action === 'publish') return `Version ${v} published`;
  if (a.action === 'rollback') return `Rolled back to version ${v}`;
  return `Version ${v} activated`;
}

/** The append-only journal, newest first: the active version is the first line. */
export function ActivationHistory({ activations }: { activations: readonly Activation[] }) {
  if (activations.length === 0) return <p className={styles.note}>No version is active yet.</p>;
  return (
    <ol className={styles.hist}>
      {activations.map((a) => (
        <li key={a.id}>
          <span>
            {describe(a)}
            {a.note ? <span className={styles.histNote}> · {a.note}</span> : null}
          </span>
          <time dateTime={a.createdAt}>{formatDateTime(a.createdAt)}</time>
        </li>
      ))}
    </ol>
  );
}
