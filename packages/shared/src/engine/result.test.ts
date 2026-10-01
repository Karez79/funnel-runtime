import { describe, expect, it, vi } from 'vitest';
import { v1, v2 } from '../../test/fixtures.ts';
import type { Answers } from './conditions.ts';
import { resolveFunnel } from './resolve.ts';
import { computeResult } from './result.ts';

const base: Answers = {
  team_size: 8,
  work_mode: 'remote',
  priorities: ['speed'],
  timezone_span: 'same',
  async_maturity: 'low',
  tool_count: 5,
};

describe('computeResult', () => {
  const a = resolveFunnel(v1(), 'A');

  it.each<[string, Answers, string]>([
    ['remote across time zones', { ...base, timezone_span: 'wide' }, 'async_native'],
    [
      'high async maturity',
      { ...base, work_mode: 'office', async_maturity: 'high' },
      'async_native',
    ],
    ['hybrid', { ...base, work_mode: 'hybrid', office_days: 2 }, 'hybrid_structured'],
    ['office', { ...base, work_mode: 'office', office_days: 4 }, 'office_core'],
    ['no rule matches', base, 'balanced'],
  ])('%s', (_name, answers, expected) => {
    expect(computeResult(a, answers)).toBe(expected);
  });

  it('gives the same result id in variant B, whose order and result texts differ', () => {
    const b = resolveFunnel(v1(), 'B');
    const hybrid = { ...base, work_mode: 'hybrid', office_days: 2 };
    expect(computeResult(b, hybrid)).toBe(computeResult(a, hybrid));
    expect(computeResult(b, hybrid)).toBe('hybrid_structured');
    expect(b.results['hybrid_structured']?.title).not.toBe(a.results['hybrid_structured']?.title);
  });

  it('takes the first matching rule in order', () => {
    const resolved = resolveFunnel(v2(), 'A');
    const answers = { ...base, work_mode: 'hybrid', office_days: 2, meeting_hours: 20 };
    expect(computeResult(resolved, answers)).toBe('meeting_heavy');
    expect(computeResult(resolved, { ...answers, meeting_hours: 5 })).toBe('hybrid_structured');
  });

  it('ignores answers of hidden steps', () => {
    const config = v1();
    config.resultRules.unshift({
      resultId: 'office_core',
      when: { answer: 'office_days', operator: 'gte', value: 3 },
    });
    const resolved = resolveFunnel(config, 'A');
    expect(computeResult(resolved, { ...base, work_mode: 'hybrid', office_days: 4 })).toBe(
      'office_core',
    );
    expect(computeResult(resolved, { ...base, office_days: 4 })).toBe('balanced');
  });

  it('passes the warn callback to rule conditions', () => {
    const config = v1();
    config.resultRules.unshift({
      resultId: 'office_core',
      when: { answer: 'work_mode', operator: 'matches', value: 'x' },
    });
    const warn = vi.fn();
    expect(computeResult(resolveFunnel(config, 'A'), base, { warn })).toBe('balanced');
    expect(warn).toHaveBeenCalledOnce();
  });
});
