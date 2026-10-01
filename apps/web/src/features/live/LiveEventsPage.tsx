// Live events (CLAUDE.md 11.1): every ingest result as it happens, newest on top, with
// its status: stored, ignored duplicate or rejected with the reason. Seeing a resent
// batch come back as "duplicate" here is the quickest proof that deduplication works.
// Filters (status, session id) live in the URL, so the bell and the palette link here.
import { useSearchParams } from 'react-router';
import { formatTime } from '../../lib/format.ts';
import { Card } from '../../ui/Card.tsx';
import { Chip } from '../../ui/Chip.tsx';
import { PageHeader } from '../../ui/PageHeader.tsx';
import { Pill } from '../../ui/Pill.tsx';
import { Mono, Table, Td, Th, VariantText } from '../../ui/Table.tsx';
import styles from './LiveEventsPage.module.css';
import { useLiveStream, type LiveRow } from './useLiveStream.ts';

const STATUS_FILTERS = [
  { value: null, label: 'All' },
  { value: 'accepted', label: 'Stored' },
  { value: 'duplicate', label: 'Ignored duplicates' },
  { value: 'rejected', label: 'Rejected' },
] as const;

function Status({ row }: { row: LiveRow }) {
  if (row.status === 'accepted') return <Pill tone="blue">Stored</Pill>;
  if (row.status === 'duplicate') return <Pill tone="outline">Ignored duplicate</Pill>;
  return <Pill tone="coral">Rejected: {(row.reason ?? 'invalid').replaceAll('_', ' ')}</Pill>;
}

export function LiveEventsPage() {
  const [params, setParams] = useSearchParams();
  const live = useLiveStream();
  const status = params.get('status');
  const session = (params.get('session') ?? '').trim().toLowerCase();

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  const shown = live.rows.filter(
    (r) =>
      (status === null || r.status === status) &&
      (session === '' || (r.sessionId ?? '').toLowerCase().startsWith(session)),
  );

  const subtitle = live.paused
    ? `Paused${live.buffered > 0 ? `, ${String(live.buffered)} new` : ''}`
    : live.connection === 'open'
      ? `Streaming, ${String(shown.length)} events in this view`
      : live.connection === 'connecting'
        ? 'Connecting…'
        : 'Reconnecting…';

  return (
    <>
      <PageHeader
        title="Live events"
        subtitle={
          <span className={styles.status} aria-live="polite">
            {subtitle}
          </span>
        }
      >
        {STATUS_FILTERS.map((f) => (
          <Chip
            key={f.label}
            on={status === f.value}
            aria-pressed={status === f.value}
            onClick={() => {
              setParam('status', f.value);
            }}
          >
            {f.label}
          </Chip>
        ))}
        <Chip icon="pause" on={live.paused} aria-pressed={live.paused} onClick={live.togglePause}>
          {live.paused ? 'Resume' : 'Pause'}
        </Chip>
      </PageHeader>
      <Card variant="panel" aria-label="Incoming events">
        <label className={styles.search}>
          <span>Session</span>
          <input
            type="search"
            placeholder="Filter by session id"
            value={params.get('session') ?? ''}
            spellCheck={false}
            onChange={(e) => {
              setParam('session', e.currentTarget.value);
            }}
          />
        </label>
        {shown.length === 0 ? (
          <p className={styles.empty}>
            {live.rows.length === 0
              ? 'No events yet. Open the funnel in another tab or run the generator; events appear here as they are received.'
              : 'No events match these filters.'}
          </p>
        ) : (
          <Table label="Incoming events, newest first">
            <thead>
              <tr>
                <Th>Received</Th>
                <Th>Session</Th>
                <Th>Event</Th>
                <Th>Step</Th>
                <Th>Version</Th>
                <Th>Variant</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody className={styles.stream}>
              {shown.map((r) => (
                <tr key={r.key}>
                  <Td>
                    <Mono>{formatTime(r.receivedAt)}</Mono>
                  </Td>
                  <Td>
                    <Mono>
                      <span title={r.sessionId ?? undefined}>{r.sessionId?.slice(-8) ?? '–'}</span>
                    </Mono>
                  </Td>
                  <Td>{r.name ?? '–'}</Td>
                  <Td>{r.stepId ?? '–'}</Td>
                  <Td>{r.version ?? '–'}</Td>
                  <Td>
                    <VariantText variant={r.variant} />
                  </Td>
                  <Td>
                    <Status row={r} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
