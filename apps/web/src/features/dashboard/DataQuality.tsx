// Data quality (CLAUDE.md 11.2): what ingest ignored, handled or rejected, and whether
// the numbers match the generator's ground truth. Duplicates and rejections cover all
// traffic in the period (ingest rows have no session context, docs/ANALYTICS.md).
import type { AnalyticsSummary } from '@funnel/shared';
import { formatCount } from '../../lib/format.ts';
import { Pill } from '../../ui/Pill.tsx';
import { Table, Td, Th } from '../../ui/Table.tsx';
import { humanize } from './journey.ts';

export function DataQuality({ summary }: { summary: AnalyticsSummary }) {
  const q = summary.dataQuality;
  const truth = summary.groundTruthMatches;
  return (
    <Table label="Data quality">
      <thead>
        <tr>
          <Th>Check</Th>
          <Th numeric>Events</Th>
          <Th>Status</Th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <Td>Duplicate event_id (all traffic)</Td>
          <Td numeric>{formatCount(q.duplicates)}</Td>
          <Td>
            <Pill tone="outline">Ignored</Pill>
          </Td>
        </tr>
        <tr>
          <Td>Arrived out of order</Td>
          <Td numeric>{formatCount(q.outOfOrder)}</Td>
          <Td>
            <Pill tone="blue">Handled</Pill>
          </Td>
        </tr>
        <tr>
          <Td>Context differs from the session</Td>
          <Td numeric>{formatCount(q.contextMismatch)}</Td>
          <Td>
            <Pill tone="blue">Handled</Pill>
          </Td>
        </tr>
        {q.rejected.length === 0 ? (
          <tr>
            <Td>Rejected (all traffic)</Td>
            <Td numeric>0</Td>
            <Td>
              <Pill tone="outline">None</Pill>
            </Td>
          </tr>
        ) : (
          q.rejected.map((r) => (
            <tr key={r.reason}>
              <Td>Rejected: {humanize(r.reason).toLowerCase()}</Td>
              <Td numeric>{formatCount(r.count)}</Td>
              <Td>
                <Pill tone="coral">Rejected</Pill>
              </Td>
            </tr>
          ))
        )}
        <tr>
          <Td>Matches generator ground truth</Td>
          <Td numeric>–</Td>
          <Td>
            {truth === null ? (
              <Pill tone="dashed">Not run</Pill>
            ) : truth ? (
              <Pill tone="black">Yes</Pill>
            ) : (
              <Pill tone="coral">No</Pill>
            )}
          </Td>
        </tr>
      </tbody>
    </Table>
  );
}
