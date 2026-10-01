import { describe, expect, it } from 'vitest';
import { v1, v2 } from '../../test/fixtures.ts';
import { diffConfigs, type ConfigChange } from './diff.ts';
import { isKnownStep } from './schema.ts';

const summary = (changes: ConfigChange[]) =>
  changes.map((c) => `${c.kind}:${c.variant ?? '-'}:${c.subject}`);

describe('diffConfigs', () => {
  it('finds nothing between a config and itself', () => {
    expect(diffConfigs(v1(), v1())).toEqual([]);
  });

  it('describes v1 → v2', () => {
    const changes = diffConfigs(v1(), v2());
    expect(summary(changes)).toEqual([
      'experiment_changed:-:question-order-and-result-framing-v2',
      'result_added:-:meeting_heavy',
      'rule_added:-:meeting_heavy',
      'step_added:A:meeting_hours',
      'step_added:B:meeting_hours',
      'step_changed:B:intro',
      'step_changed:B:priorities',
      'result_changed:B:async_native',
      'result_changed:B:hybrid_structured',
      'result_changed:B:office_core',
      'result_changed:B:balanced',
    ]);
    const intro = changes.find((c) => c.kind === 'step_changed' && c.subject === 'intro');
    expect(intro?.message).toBe(
      'Variant B: step "intro": content.eyebrow, content.title, content.body, content.primaryActionLabel changed',
    );
  });

  it('reports removed steps, results, rules and events per variant', () => {
    const a = v1();
    const b = v1();
    b.experiment.variants.B.stepSequence = b.experiment.variants.B.stepSequence.filter(
      (id) => id !== 'tool_count',
    );
    delete b.results['office_core'];
    b.resultRules = b.resultRules.filter((r) => r.resultId !== 'office_core');
    b.events.allowed = b.events.allowed.filter((e) => e.name !== 'back_clicked');
    expect(summary(diffConfigs(a, b))).toEqual([
      'result_removed:-:office_core',
      'rule_removed:-:office_core',
      'event_removed:-:back_clicked',
      'step_removed:B:tool_count',
    ]);
  });

  it('reports order, condition, weight, default and event property changes', () => {
    const a = v1();
    const b = v1();
    b.experiment.variants.A.stepSequence = [
      'intro',
      'work_mode',
      'team_size',
      ...a.experiment.variants.A.stepSequence.slice(3),
    ];
    const office = b.steps['office_days'];
    if (!office) throw new Error('fixture');
    office.visibleWhen = { answer: 'team_size', operator: 'gt', value: 5 };
    b.experiment.variants.A.weight = 70;
    b.defaultResultId = 'office_core';
    b.resultRules.reverse();
    b.events.allowed.push({ name: 'recommendation_viewed', properties: ['result_id'] });
    const cta = b.events.allowed.find((e) => e.name === 'cta_clicked');
    if (!cta) throw new Error('fixture');
    cta.properties = ['result_id'];

    const changes = diffConfigs(a, b);
    expect(summary(changes)).toEqual([
      'weight_changed:A:A',
      'rule_order:-:resultRules',
      'default_result_changed:-:office_core',
      'event_changed:-:cta_clicked',
      'event_added:-:recommendation_viewed',
      'step_order:A:sequence',
      'condition_changed:A:office_days',
      'condition_changed:B:office_days',
    ]);
    expect(changes.find((c) => c.kind === 'condition_changed')?.message).toBe(
      'Variant A: step "office_days": visibility condition changed, now depends on team_size',
    );
  });

  it('reports changed input options as a step change', () => {
    const a = v1();
    const b = v1();
    const workMode = b.steps['work_mode'];
    if (!workMode || !isKnownStep(workMode) || workMode.type !== 'single-select') {
      throw new Error('fixture');
    }
    workMode.input.options = [...workMode.input.options, { value: 'field', label: 'In the field' }];
    expect(summary(diffConfigs(a, b))).toEqual([
      'step_changed:A:work_mode',
      'step_changed:B:work_mode',
    ]);
  });

  it('reports a removed condition, an edited base result and an edited rule', () => {
    const a = v1();
    const b = v1();
    const office = b.steps['office_days'];
    const balanced = b.results['balanced'];
    const rule = b.resultRules[1];
    if (!office || !balanced || !rule) throw new Error('fixture');
    delete office.visibleWhen;
    balanced.summary = 'Shorter summary.';
    rule.when = { answer: 'office_days', operator: 'gte', value: 2 };
    const changes = diffConfigs(a, b);
    expect(summary(changes)).toEqual([
      'rule_changed:-:hybrid_structured',
      'condition_changed:A:office_days',
      'result_changed:A:balanced',
      'condition_changed:B:office_days',
      'result_changed:B:balanced',
    ]);
    expect(changes.map((c) => c.message)).toEqual(
      expect.arrayContaining([
        'Result rule #2 for "hybrid_structured" changed, now depends on office_days',
        'Variant A: step "office_days": visibility condition changed, now always shown',
        'Variant A: result "balanced": summary changed',
      ]),
    );
  });

  it('reports event properties added and removed, ignoring their order', () => {
    const a = v1();
    const b = v1();
    const cta = b.events.allowed.find((e) => e.name === 'cta_clicked');
    const viewed = b.events.allowed.find((e) => e.name === 'step_viewed');
    if (!cta || !viewed) throw new Error('fixture');
    cta.properties = ['action', 'source'];
    viewed.properties = [...viewed.properties].reverse();
    expect(diffConfigs(a, b).map((c) => c.message)).toEqual([
      'Event "cta_clicked": properties added source; removed result_id',
    ]);
  });

  it('reports settings outside steps and results, privacy separately', () => {
    const a = v1();
    const b = v1();
    b.session.ttlHours = 1;
    b.progress.excludeTypes = ['result'];
    b.title = 'New title';
    b.events.privacy.storeRawAnswers = true;
    b['futureFlag'] = true;
    b.experiment.variants.B['note'] = 'x';
    const cta = b.events.allowed.find((e) => e.name === 'cta_clicked');
    if (!cta) throw new Error('fixture');
    cta.trigger = 'Changed trigger.';
    expect(summary(diffConfigs(a, b))).toEqual([
      'config_changed:-:title',
      'config_changed:-:session.ttlHours',
      'config_changed:-:progress.excludeTypes',
      'config_changed:-:experiment.variants.B.note',
      'privacy_changed:-:events.privacy.storeRawAnswers',
      'config_changed:-:events.allowed.cta_clicked.trigger',
      'config_changed:-:futureFlag',
    ]);
  });

  it('reports a result named after a built-in object member', () => {
    const a = v1();
    const b = v1();
    const balanced = b.results['balanced'];
    if (!balanced) throw new Error('fixture');
    b.results['constructor'] = { ...balanced, id: 'constructor' };
    expect(summary(diffConfigs(a, b))).toEqual(['result_added:-:constructor']);
    expect(summary(diffConfigs(b, a))).toEqual(['result_removed:-:constructor']);
  });
});
