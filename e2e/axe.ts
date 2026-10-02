// One axe check for every e2e that scans a screen (CLAUDE.md 10): WCAG 2.x A/AA tags,
// serious and critical violations fail, no rule is disabled. Each node is reported with its
// HTML and axe's summary (contrast ratio and colours), so a CI failure says what to fix.
import { AxeBuilder } from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

export async function audit(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  const blocking = violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({
      rule: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.map(
        (node) => `${node.target.join(' ')}: ${node.html} ${node.failureSummary ?? ''}`,
      ),
    }));
  expect(blocking).toEqual([]);
}
