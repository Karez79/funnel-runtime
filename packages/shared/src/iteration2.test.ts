// Second iteration (CLAUDE.md 13.2 Phase 7): funnel-v3 checked against the engine, lint,
// diff and event catalog as they were at the end of the first iteration. Nothing in
// packages/shared was changed for v3; these tests record that the existing code already
// handles the new branch, the removed step, the new result and the new event.
import { describe, expect, it } from 'vitest';
import { v2, v3 } from '../test/fixtures.ts';
import { diffConfigs } from './config/diff.ts';
import { lintConfig } from './config/lint.ts';
import type { Answers } from './engine/conditions.ts';
import { effectiveAnswers, nextStep, progress, visiblePath } from './engine/navigation.ts';
import { resolveFunnel } from './engine/resolve.ts';
import { computeResult } from './engine/result.ts';
import { validateAnswer } from './engine/validation.ts';
import { catalogEvent, filterProperties } from './events/catalog.ts';

const FUNNEL = 'workstyle-planner';
const a = resolveFunnel(v3(), 'A');
const b = resolveFunnel(v3(), 'B');

const compliance: Answers = {
  team_size: 40,
  work_mode: 'hybrid',
  priorities: ['speed', 'compliance'],
  security_constraints: 'regulated',
  timezone_span: 'same',
  office_days: 2,
  meeting_hours: 5,
  async_maturity: 'medium',
  tool_count: 6,
};

describe('v3 on upload: lint and diff against the active v2', () => {
  it('has no lint errors and three warnings for an admin to read', () => {
    const report = lintConfig(v3(), {
      existing: [
        { funnelId: FUNNEL, version: 1 },
        { funnelId: FUNNEL, version: 2 },
      ],
      previous: v2(),
    });
    expect(report.errors).toEqual([]);
    expect(report.warnings.map((w) => w.message)).toEqual([
      'Result "regulated_scale" added',
      'Event "recommendation_expanded" added',
      'Variant B: step "tool_count" removed',
    ]);
  });

  it('diff v2 → v3 lists the new branch, the removed step, the new result and event', () => {
    const changes = diffConfigs(v2(), v3()).map(
      (c) => `${c.kind}:${c.variant ?? '-'}:${c.subject}`,
    );
    expect(changes).toEqual(
      expect.arrayContaining([
        'experiment_changed:-:question-order-and-result-framing-v3',
        'result_added:-:regulated_scale',
        'rule_added:-:regulated_scale',
        'event_added:-:recommendation_expanded',
        'step_added:A:security_constraints',
        'step_added:B:security_constraints',
        'step_removed:B:tool_count',
        'step_changed:A:priorities',
      ]),
    );
  });
});

describe('v3 compliance branch through the existing engine', () => {
  it('`contains` opens security_constraints only when compliance is chosen', () => {
    expect(visiblePath(a, compliance)).toContain('security_constraints');
    expect(visiblePath(a, { ...compliance, priorities: ['speed'] })).not.toContain(
      'security_constraints',
    );
    expect(nextStep(b, compliance, 'priorities')).toBe('security_constraints');
    expect(nextStep(b, { ...compliance, priorities: ['focus'] }, 'priorities')).toBe('office_days');
  });

  it('the new option and the follow-up answer validate', () => {
    const priorities = a.steps['priorities'];
    const security = a.steps['security_constraints'];
    if (!priorities || !security) throw new Error('v3 steps');
    expect(validateAnswer(priorities, ['compliance'])).toEqual({ ok: true });
    expect(validateAnswer(security, 'regulated')).toEqual({ ok: true });
    expect(validateAnswer(security, 'secret')).toMatchObject({ ok: false, code: 'invalidOption' });
  });

  it('the compliance path counts one more question in the progress', () => {
    const without = { ...compliance, priorities: ['speed'] };
    expect(progress(a, compliance, 'team_size').total).toBe(
      progress(a, without, 'team_size').total + 1,
    );
  });

  it('regulated_scale wins first; a hidden security answer is ignored', () => {
    expect(computeResult(a, compliance)).toBe('regulated_scale');
    expect(computeResult(b, compliance)).toBe('regulated_scale');
    const changedMind = { ...compliance, priorities: ['speed'] };
    expect(effectiveAnswers(a, changedMind)).not.toHaveProperty('security_constraints');
    expect(computeResult(a, changedMind)).toBe('hybrid_structured');
  });

  it('variant B has no tool_count and its own result framing', () => {
    expect(b.sequence).not.toContain('tool_count');
    expect(a.sequence).toContain('tool_count');
    expect(b.results['regulated_scale']?.cta.action).toBe('expand_recommendation');
    expect(b.results['regulated_scale']?.title).not.toBe(a.results['regulated_scale']?.title);
  });
});

describe('v3 event catalog', () => {
  it('lists recommendation_expanded with result_id, action and source only', () => {
    const definition = catalogEvent(a.eventCatalog, 'recommendation_expanded');
    if (!definition) throw new Error('v3 catalog has recommendation_expanded');
    expect(
      filterProperties(definition, {
        result_id: 'regulated_scale',
        action: 'expand_recommendation',
        source: 'cta',
        security_constraints: 'regulated',
      }),
    ).toEqual({
      properties: { result_id: 'regulated_scale', action: 'expand_recommendation', source: 'cta' },
      dropped: ['security_constraints'],
    });
    expect(catalogEvent(resolveFunnel(v2(), 'B').eventCatalog, 'recommendation_expanded')).toBe(
      undefined,
    );
  });
});
