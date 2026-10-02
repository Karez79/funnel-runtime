// Events of the selected version's catalog beyond the seven base ones (CLAUDE.md 11.2).
// The list comes from the catalog, so a new event of a new version shows up here with
// no dashboard change.
import type { AnalyticsSummary } from '@funnel/shared';
import { formatCount, formatPercent } from '../../lib/format.ts';
import { Table, Td, Th } from '../../ui/Table.tsx';
import styles from './Dashboard.module.css';

export function OtherEvents({ summary }: { summary: AnalyticsSummary }) {
  if (summary.otherEvents.length === 0) {
    return (
      <p className={styles.empty}>
        Version {summary.version} has only the seven base events in its catalog.
      </p>
    );
  }
  return (
    <Table label="Other events">
      <thead>
        <tr>
          <Th>Event</Th>
          <Th numeric>Sessions</Th>
          <Th numeric>Share of CTA sessions</Th>
        </tr>
      </thead>
      <tbody>
        {summary.otherEvents.map((e) => (
          <tr key={e.name}>
            <Td>{e.name}</Td>
            <Td numeric>{formatCount(e.sessions)}</Td>
            <Td numeric>{formatPercent(e.shareOfCta, 1)}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
