// Table view of the journey (CLAUDE.md 11.2): exact numbers per step for checking
// against the generator, the same metrics the rings summarise.
import type { AnalyticsSummary } from '@funnel/shared';
import { formatCount, formatPercent } from '../../lib/format.ts';
import { Table, Td, Th } from '../../ui/Table.tsx';
import { humanize, type ShownVariant } from './journey.ts';
import styles from './Journey.module.css';

type Metrics = AnalyticsSummary['steps'][number]['metrics']['all'];
const COLUMNS = [
  ['Reached', (m: Metrics) => formatCount(m.reached)],
  ['Completed', (m: Metrics) => formatCount(m.completed)],
  ['Pass rate', (m: Metrics) => formatPercent(m.passRate, 1)],
  ['Dropped here', (m: Metrics) => formatCount(m.droppedHere)],
  ['Came back', (m: Metrics) => formatCount(m.cameBack)],
] as const;

export function JourneyTable({
  summary,
  variant,
}: {
  summary: AnalyticsSummary;
  variant: ShownVariant;
}) {
  const variants = variant === 'all' ? (['A', 'B'] as const) : [variant];
  return (
    <Table label="Steps of the funnel with exact numbers">
      <thead>
        <tr>
          <Th>Step</Th>
          {COLUMNS.flatMap(([label]) =>
            variants.map((v) => (
              <Th key={`${label}${v}`} numeric>
                {label} <span className={v === 'A' ? styles.vA : styles.vB}>{v}</span>
              </Th>
            )),
          )}
        </tr>
      </thead>
      <tbody>
        {summary.steps.map((step) => (
          <tr key={step.stepId}>
            <Td>
              {humanize(step.stepId)}
              {step.condition !== null && <span className={styles.tag}>{step.condition}</span>}
            </Td>
            {COLUMNS.flatMap(([label, format]) =>
              variants.map((v) => {
                const m = step.metrics[v];
                return (
                  <Td key={`${label}${v}`} numeric>
                    {m ? format(m) : '–'}
                  </Td>
                );
              }),
            )}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
