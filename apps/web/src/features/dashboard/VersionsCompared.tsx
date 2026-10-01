// KPIs of every published version side by side (CLAUDE.md 11.2). Step data is not
// compared: versions have different steps.
import type { AnalyticsSummary } from '@funnel/shared';
import { formatCount, formatPercent } from '../../lib/format.ts';
import { Pill } from '../../ui/Pill.tsx';
import { Table, Td, Th } from '../../ui/Table.tsx';

export function VersionsCompared({ summary }: { summary: AnalyticsSummary }) {
  return (
    <Table label="Versions compared">
      <thead>
        <tr>
          <Th>Version</Th>
          <Th numeric>Started</Th>
          <Th numeric>Result rate</Th>
          <Th numeric>CTA CTR</Th>
          <Th numeric>Started → CTA</Th>
          <Th numeric>In progress</Th>
        </tr>
      </thead>
      <tbody>
        {summary.versions.map((v) => (
          <tr key={v.version} aria-current={v.version === summary.version ? 'true' : undefined}>
            <Td>
              <b>{v.version}</b> {v.active && <Pill tone="black">Active</Pill>}
            </Td>
            <Td numeric>{formatCount(v.kpis.started)}</Td>
            <Td numeric>{formatPercent(v.kpis.resultRate, 1)}</Td>
            <Td numeric>{formatPercent(v.kpis.ctaCtr, 1)}</Td>
            <Td numeric>{formatPercent(v.kpis.startedToCta, 1)}</Td>
            <Td numeric>{formatCount(v.kpis.inProgress)}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
