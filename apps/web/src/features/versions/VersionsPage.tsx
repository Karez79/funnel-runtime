// Versions (CLAUDE.md 6.1, 11.1): every stored version with its sessions, the activation
// journal, config upload as a draft, review of a draft (diff + lint against the active
// version) and publish / roll back / activate behind a confirmation that says how many
// sessions stay where they are. Nothing changes the active version without a dialog.
import type { VersionSummary } from '@funnel/shared';
import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { errorDetails } from '../../lib/api.ts';
import { apiQuery } from '../../lib/query.ts';
import { Button } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { ConfirmDialog } from '../../ui/Dialog.tsx';
import { Icon } from '../../ui/Icon.tsx';
import { PageHeader } from '../../ui/PageHeader.tsx';
import { Toast } from '../../ui/Toast.tsx';
import { ActivationHistory } from './ActivationHistory.tsx';
import { DiffPanel } from './DiffPanel.tsx';
import { useVersionActions } from './useVersionActions.ts';
import styles from './VersionsPage.module.css';
import { VersionsTable } from './VersionsTable.tsx';

/** A rollback always targets the journal's previous version at the time it is shown. */
type Pending = { kind: 'publish' | 'activate'; version: number } | { kind: 'rollback' };

const sessions = (n: number) => `${String(n)} ${n === 1 ? 'session' : 'sessions'}`;

/** What happens to sessions in progress: the sentence of every confirmation (6.1). */
function stayingText(active: VersionSummary | undefined, target: number): string {
  if (!active) return `New sessions will start on version ${String(target)}.`;
  const from = String(active.version);
  return (
    `New sessions will start on version ${String(target)}. ` +
    `The ${sessions(active.activeSessions)} in progress on version ${from} will finish on version ${from}.`
  );
}

export function VersionsPage() {
  const list = useQuery(apiQuery('listVersions', {}));
  const [params, setParams] = useSearchParams();
  const [selected, setSelected] = useState<number | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const actions = useVersionActions({
    onRollbackRequest: () => {
      setPending({ kind: 'rollback' });
    },
    onPublished: () => {
      setSelected(null);
    },
    onUploaded: setSelected,
  });
  const fileInput = useRef<HTMLInputElement>(null);

  const versions = list.data?.versions ?? [];
  const active = versions.find((v) => v.active);
  const previous = list.data?.activations[0]?.fromVersion ?? null;
  const drafts = versions.filter((v) => v.state === 'draft');

  // Commands from the palette arrive as `?publish=N` / `?rollback=1` (admin-shell) and
  // open the same confirmation as the buttons; closing it clears the URL.
  const publishParam = Number(params.get('publish'));
  const publishable = drafts.some((d) => d.version === publishParam);
  const fromUrl: Pending | null = publishable
    ? { kind: 'publish', version: publishParam }
    : params.has('rollback')
      ? { kind: 'rollback' }
      : null;
  const reviewed =
    selected ?? (publishable ? publishParam : null) ?? drafts.at(-1)?.version ?? null;
  const candidate = list.data ? (pending ?? fromUrl) : null;
  // The version a confirmation would switch to; a rollback without a previous one has none.
  const target =
    candidate === null ? null : candidate.kind === 'rollback' ? previous : candidate.version;
  const shown = candidate !== null && target !== null ? { kind: candidate.kind, target } : null;
  const close = () => {
    setPending(null);
    if (fromUrl) setParams({}, { replace: true });
  };

  const confirm = () => {
    if (!shown) return;
    if (shown.kind === 'publish') actions.publish.mutate(shown.target);
    if (shown.kind === 'rollback') actions.rollback.mutate();
    if (shown.kind === 'activate') actions.activate.mutate(shown.target);
    close();
  };

  const uploadIssues =
    errorDetails('uploadVersion', 'unprocessable', actions.upload.error)?.issues ?? [];

  const verb = {
    publish: 'Publish version',
    rollback: 'Roll back to version',
    activate: 'Activate version',
  };
  const dialogLabel = shown ? `${verb[shown.kind]} ${String(shown.target)}` : '';

  return (
    <>
      <PageHeader
        title="Versions"
        subtitle="New sessions start on the active version. Started sessions finish on their own."
      >
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className={styles.file}
          aria-label="Config file"
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            if (file) actions.upload.mutate(file);
            e.currentTarget.value = '';
          }}
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            fileInput.current?.click();
          }}
          disabled={actions.upload.isPending}
        >
          <Icon name="upload" />
          Upload config
        </Button>
      </PageHeader>

      {uploadIssues.length > 0 && (
        <Card variant="panel" className={styles.issues} role="alert">
          <h2>The config was not stored</h2>
          <ul>
            {uploadIssues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </Card>
      )}

      <div className={styles.grid}>
        <Card variant="panel" aria-labelledby="versions-title">
          <div className={styles.ph}>
            <h2 id="versions-title">All versions</h2>
          </div>
          {list.isPending && <p className={styles.note}>Loading versions…</p>}
          {list.isError && <p className={styles.note}>Versions could not be loaded.</p>}
          {list.data && (
            <VersionsTable
              versions={versions}
              previous={previous}
              reviewed={reviewed}
              onReview={setSelected}
              onRollback={() => {
                setPending({ kind: 'rollback' });
              }}
              onActivate={(version) => {
                setPending({ kind: 'activate', version });
              }}
            />
          )}
          <div className={styles.ph}>
            <h2>Activation history</h2>
          </div>
          <ActivationHistory activations={list.data?.activations ?? []} />
        </Card>

        <DiffPanel
          version={reviewed}
          draft={versions.find((v) => v.version === reviewed)?.state === 'draft'}
          staying={reviewed === null ? '' : stayingText(active, reviewed)}
          onPublish={(version) => {
            setPending({ kind: 'publish', version });
          }}
        />
      </div>

      <ConfirmDialog
        open={shown !== null}
        title={`${dialogLabel}?`}
        confirmLabel={dialogLabel}
        onConfirm={confirm}
        onCancel={close}
      >
        <p>
          {shown ? stayingText(active, shown.target) : ''}
          {shown?.kind === 'publish' ? ' You can roll back at any time.' : ''}
        </p>
      </ConfirmDialog>
      <Toast message={actions.toast} onClose={actions.closeToast} />
    </>
  );
}
