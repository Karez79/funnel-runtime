// Funnel analytics (CLAUDE.md 10, 11.2). Every number comes from one call to
// /api/analytics/summary, computed by the shared aggregator; this page only lays it out.
import type { AnalyticsSummary } from '@funnel/shared';
import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { formatSessions } from '../../lib/format.ts';
import { apiQuery } from '../../lib/query.ts';
import { Card } from '../../ui/Card.tsx';
import { Icon, type IconName } from '../../ui/Icon.tsx';
import { iconButtonClass } from '../../ui/iconButtonClass.ts';
import { Chip, ChipSelect } from '../../ui/Chip.tsx';
import { Notch, NotchButton } from '../../ui/Notch.tsx';
import { PageHeader } from '../../ui/PageHeader.tsx';
import { SegmentedControl } from '../../ui/SegmentedControl.tsx';
import { AbPanel } from './AbPanel.tsx';
import styles from './Dashboard.module.css';
import { DataQuality } from './DataQuality.tsx';
import { JourneyMap } from './JourneyMap.tsx';
import { JourneyTable } from './JourneyTable.tsx';
import { KpiCards } from './KpiCards.tsx';
import { OtherEvents } from './OtherEvents.tsx';
import { PERIODS, useDashboardFilters, type DashboardFilters } from './useDashboardFilters.ts';
import { VersionsCompared } from './VersionsCompared.tsx';

const ALL_CAMPAIGNS = '';

/** Round outlined icon link in a panel header (reference `.ph .acts`). */
function PanelLink({ to, icon, label }: { to: string; icon: IconName; label: string }) {
  return (
    <span className={styles.phEnd}>
      <Link
        to={to}
        viewTransition
        className={iconButtonClass(false, 'sm')}
        aria-label={label}
        title={label}
      >
        <Icon name={icon} />
      </Link>
    </span>
  );
}

function Panel({
  title,
  id,
  actions,
  children,
}: {
  title: string;
  id: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card variant="panel" aria-labelledby={id}>
      <div className={styles.ph}>
        <h2 id={id}>{title}</h2>
        {actions}
      </div>
      {children}
    </Card>
  );
}

function Filters({
  filters,
  summary,
}: {
  filters: DashboardFilters;
  summary: AnalyticsSummary | undefined;
}) {
  const options = useQuery(apiQuery('analyticsFilters', {}));
  const versions = options.data?.versions ?? [];
  const shown = summary?.version ?? null;
  return (
    <>
      {[...versions].reverse().map((v) => (
        <Chip
          key={v.version}
          on={v.version === shown}
          aria-pressed={v.version === shown}
          onClick={() => {
            filters.setVersion(v.version);
          }}
        >
          Version {v.version}
        </Chip>
      ))}
      <ChipSelect
        label="Campaign"
        icon="filter"
        value={filters.campaign ?? ALL_CAMPAIGNS}
        options={[
          { value: ALL_CAMPAIGNS, label: 'All campaigns' },
          ...(options.data?.campaigns ?? []).map((c) => ({ value: c, label: c })),
        ]}
        onChange={(c) => {
          filters.setCampaign(c === ALL_CAMPAIGNS ? null : c);
        }}
      />
      <ChipSelect
        label="Period"
        icon="calendar"
        value={filters.period}
        options={PERIODS.map((p) => ({ value: p.value, label: p.label }))}
        onChange={filters.setPeriod}
      />
      <Chip on={filters.includeQa} aria-pressed={filters.includeQa} onClick={filters.toggleQa}>
        Include QA sessions
      </Chip>
    </>
  );
}

function Sources({ summary, filters }: { summary: AnalyticsSummary; filters: DashboardFilters }) {
  if (summary.sources.length === 0) return null;
  return (
    <Notch label="Filter by traffic source">
      {summary.sources.map(({ source, sessions }) => (
        <NotchButton
          key={source ?? 'none'}
          short={source === null ? '—' : source.charAt(0).toUpperCase()}
          title={`${source ?? 'No UTM source'}, ${formatSessions(sessions)}`}
          count={sessions}
          pressed={source !== null && source === filters.source}
          muted={source === null}
          disabled={source === null}
          tone={filters.variant === 'B' ? 'b' : 'a'}
          onClick={() => {
            filters.toggleSource(source);
          }}
        />
      ))}
    </Notch>
  );
}

function Journey({ summary, filters }: { summary: AnalyticsSummary; filters: DashboardFilters }) {
  const [view, setView] = useState<'journey' | 'table'>('journey');
  const preview = useQuery(
    apiQuery('previewVersion', {
      params: { v: summary.version },
      query: { variant: filters.variant === 'B' ? 'B' : 'A' },
    }),
  );
  const titles: Record<string, string> = {};
  for (const [id, step] of Object.entries(preview.data?.funnel.steps ?? {})) {
    const title = step.content.title;
    if (title !== undefined) titles[id] = title;
  }
  return (
    <Card variant="panel" aria-labelledby="journey-title" className={styles.journeyPanel}>
      <Sources summary={summary} filters={filters} />
      <div className={styles.ph}>
        <h2 id="journey-title">Funnel journey</h2>
        <SegmentedControl
          label="Variant"
          value={filters.variant}
          options={[
            { value: 'all', label: 'Both' },
            { value: 'A', label: 'A' },
            { value: 'B', label: 'B' },
          ]}
          onChange={filters.setVariant}
        />
        <span className={styles.phEnd}>
          <SegmentedControl
            label="View"
            value={view}
            options={[
              { value: 'journey', label: 'Journey' },
              { value: 'table', label: 'Table' },
            ]}
            onChange={setView}
          />
        </span>
      </div>
      {view === 'journey' ? (
        <JourneyMap summary={summary} variant={filters.variant} titles={titles} />
      ) : (
        <JourneyTable summary={summary} variant={filters.variant} />
      )}
    </Card>
  );
}

export function DashboardPage() {
  const filters = useDashboardFilters();
  const summary = useQuery({
    ...apiQuery('analyticsSummary', { query: filters.query }),
    placeholderData: (previous) => previous,
  });
  const data = summary.data;

  return (
    <>
      <PageHeader
        title="Funnel analytics"
        subtitle={data ? `Unique sessions, version ${String(data.version)}` : 'Unique sessions'}
      >
        <Filters filters={filters} summary={data} />
      </PageHeader>

      {summary.isPending && <p className={styles.empty}>Loading analytics…</p>}
      {summary.isError && (
        <p className={styles.empty} role="alert">
          Analytics could not be loaded. {summary.error.message}
        </p>
      )}
      {data && (
        <div className={summary.isPlaceholderData ? styles.stale : undefined}>
          {data.kpis.all.started === 0 && (
            <p className={styles.notice}>
              No sessions for these filters yet. <a href="/">Open the funnel</a>, run{' '}
              <code>pnpm generate</code> or widen the filters.{' '}
              <Link to="/admin/live">Live events</Link> shows traffic as it arrives.
            </p>
          )}
          <KpiCards summary={data} />
          <Journey summary={data} filters={filters} />
          <div className={styles.grid2}>
            <Panel
              title="Data quality"
              id="dq-title"
              actions={
                <PanelLink
                  to="/admin/live?status=rejected"
                  icon="pulse"
                  label="Open rejected events"
                />
              }
            >
              <DataQuality summary={data} />
            </Panel>
            <Panel
              title="A/B test, started to CTA"
              id="ab-title"
              actions={<PanelLink to="/admin/versions" icon="layers" label="Open versions" />}
            >
              <AbPanel experiment={data.experiment} />
            </Panel>
            <Panel
              title="Versions compared"
              id="vc-title"
              actions={<PanelLink to="/admin/versions" icon="layers" label="Open versions" />}
            >
              <VersionsCompared summary={data} />
            </Panel>
            <Panel
              title="Other events"
              id="oe-title"
              actions={<PanelLink to="/admin/live" icon="pulse" label="Open live events" />}
            >
              <OtherEvents summary={data} />
            </Panel>
          </div>
        </div>
      )}
    </>
  );
}
