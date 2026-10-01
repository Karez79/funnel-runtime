import { describe, expect, it } from 'vitest';
import { v1, v2 } from '../../test/fixtures.ts';
import { lintConfig, type LintContext } from './lint.ts';
import { isInteractive, isKnownStep, type FunnelConfig } from './schema.ts';

const codes = (config: FunnelConfig, context?: LintContext) =>
  lintConfig(config, context).errors.map((e) => e.code);
const warningCodes = (config: FunnelConfig) => lintConfig(config).warnings.map((w) => w.code);

describe('lintConfig: valid configs', () => {
  it('passes v1 and v2 without errors or warnings', () => {
    expect(lintConfig(v1())).toEqual({ errors: [], warnings: [] });
    expect(lintConfig(v2(), { existing: [{ funnelId: 'workstyle-planner', version: 1 }] })).toEqual(
      {
        errors: [],
        warnings: [],
      },
    );
  });
});

describe('lintConfig: errors', () => {
  it('a sequence step that does not exist', () => {
    const config = v1();
    config.experiment.variants.B.stepSequence.splice(2, 0, 'ghost');
    expect(codes(config)).toContain('missing_step');
  });

  it('the result step is not last, or there are two', () => {
    const notLast = v1();
    notLast.experiment.variants.A.stepSequence.reverse();
    expect(codes(notLast)).toContain('result_position');

    const twice = v1();
    const result = twice.steps['result'];
    if (!result) throw new Error('fixture');
    twice.steps['result2'] = { ...result, id: 'result2' };
    twice.experiment.variants.A.stepSequence.splice(1, 0, 'result2');
    expect(codes(twice)).toContain('result_position');
  });

  it('a step listed twice in a sequence', () => {
    const config = v1();
    config.experiment.variants.A.stepSequence.splice(2, 0, 'team_size');
    expect(codes(config)).toContain('duplicate_step');
  });

  it('a step or result stored under a key different from its id', () => {
    const config = v1();
    const intro = config.steps['intro'];
    const balanced = config.results['balanced'];
    if (!intro || !balanced) throw new Error('fixture');
    intro.id = 'welcome';
    balanced.id = 'neutral';
    expect(codes(config)).toEqual(
      expect.arrayContaining(['step_id_mismatch', 'result_id_mismatch']),
    );
  });

  it('two steps writing the same answer key', () => {
    const config = v1();
    const tools = config.steps['tool_count'];
    if (!tools || !isInteractive(tools)) throw new Error('fixture');
    tools.input.name = 'team_size';
    expect(codes(config)).toContain('duplicate_answer_key');
  });

  it('two steps of one variant writing the same key through an override', () => {
    const config = v1();
    config.experiment.variants.B.stepOverrides['tool_count'] = { input: { name: 'team_size' } };
    const { errors } = lintConfig(config);
    expect(errors.map((e) => e.code)).toEqual(['duplicate_answer_key']);
    expect(errors[0]?.message).toMatch(/^variant B:/);
  });

  it('allows the same answer key on steps of different variants', () => {
    const config = v1();
    const tools = config.steps['tool_count'];
    if (!tools || !isInteractive(tools)) throw new Error('fixture');
    config.steps['tool_count_b'] = { ...tools, id: 'tool_count_b' };
    const seqB = config.experiment.variants.B.stepSequence;
    seqB[seqB.indexOf('tool_count')] = 'tool_count_b';
    expect(lintConfig(config).errors).toEqual([]);
  });

  it('a visibleWhen that depends on a later step in some variant', () => {
    const config = v1();
    const priorities = config.steps['priorities'];
    if (!priorities) throw new Error('fixture');
    // Before timezone_span in A, after it in B: B is fine, A must fail.
    priorities.visibleWhen = { answer: 'timezone_span', operator: 'eq', value: 'global' };
    const { errors } = lintConfig(config);
    expect(errors.map((e) => e.code)).toEqual(['condition_order']);
    expect(errors[0]?.message).toMatch(/variant A.*priorities.*timezone_span/);
  });

  it('a visibleWhen that depends on an answer no step provides', () => {
    const config = v1();
    const office = config.steps['office_days'];
    if (!office) throw new Error('fixture');
    office.visibleWhen = { answer: 'work_style', operator: 'eq', value: 'x' };
    expect(codes(config)).toContain('condition_order');
  });

  it('a visibleWhen introduced by a variant override is checked too', () => {
    const config = v1();
    config.experiment.variants.B.stepOverrides['work_mode'] = {
      visibleWhen: { answer: 'team_size', operator: 'gt', value: 1 },
    };
    expect(codes(config)).toContain('condition_order');
  });

  it('an unknown operator in visibleWhen or result rules', () => {
    const config = v1();
    const rule = config.resultRules[1];
    if (!rule) throw new Error('fixture');
    rule.when = { not: { answer: 'work_mode', operator: 'matches', value: 'x' } };
    expect(codes(config)).toEqual(['unknown_operator']);
  });

  it('result rules and the default point to existing results', () => {
    const config = v1();
    config.defaultResultId = 'nowhere';
    const rule = config.resultRules[0];
    if (!rule) throw new Error('fixture');
    rule.resultId = 'gone';
    expect(codes(config).filter((c) => c === 'unknown_result')).toHaveLength(2);
  });

  it('override keys must exist', () => {
    const config = v1();
    config.experiment.variants.B.stepOverrides['ghost'] = { content: { title: 'x' } };
    config.experiment.variants.B.resultOverrides['nothing'] = { title: 'x' };
    expect(codes(config).filter((c) => c === 'unknown_override')).toHaveLength(2);
  });

  it('an override that breaks a step', () => {
    const config = v1();
    config.experiment.variants.B.stepOverrides['work_mode'] = { input: { options: [] } };
    expect(codes(config)).toContain('invalid_override');
  });

  it('variant weights must be positive', () => {
    const config = v1();
    config.experiment.variants.B.weight = 0;
    expect(codes(config)).toEqual(['variant_weight']);
  });

  it('the catalog keeps all seven base events', () => {
    const config = v1();
    config.events.allowed = config.events.allowed.filter((e) => e.name !== 'back_clicked');
    const { errors } = lintConfig(config);
    expect(errors).toEqual([expect.objectContaining({ code: 'missing_base_event' })]);
    expect(errors[0]?.message).toContain('back_clicked');
  });

  it('an unknown major schema version', () => {
    const config = v1();
    config.schemaVersion = '2.0';
    expect(codes(config)).toEqual(['schema_version']);
    config.schemaVersion = '1.7';
    expect(codes(config)).toEqual([]);
  });

  it('funnelId and version against existing versions', () => {
    const existing = [
      { funnelId: 'workstyle-planner', version: 1 },
      { funnelId: 'workstyle-planner', version: 2 },
    ];
    expect(codes(v1(), { existing })).toEqual(['version_order']);
    expect(codes(v2(), { existing })).toEqual(['version_order']);
    const v3like = v2();
    v3like.version = 3;
    expect(codes(v3like, { existing })).toEqual([]);
    v3like.funnelId = 'other-funnel';
    expect(codes(v3like, { existing })).toEqual(['funnel_id']);
  });
});

describe('lintConfig: warnings', () => {
  it('a step of an unknown type', () => {
    const config = v1();
    config.steps['slider'] = { id: 'slider', type: 'slider', content: {} };
    config.experiment.variants.A.stepSequence.splice(1, 0, 'slider');
    expect(warningCodes(config)).toEqual(['unknown_step_type']);
  });

  it('a step that no variant uses', () => {
    const config = v1();
    config.experiment.variants.A.stepSequence = config.experiment.variants.A.stepSequence.filter(
      (id) => id !== 'tool_count',
    );
    config.experiment.variants.B.stepSequence = config.experiment.variants.B.stepSequence.filter(
      (id) => id !== 'tool_count',
    );
    expect(warningCodes(config)).toEqual(['unused_step']);
  });

  it('a result rule on an answer no step provides', () => {
    const config = v1();
    config.resultRules.push({
      resultId: 'balanced',
      when: { answer: 'mood', operator: 'eq', value: 'x' },
    });
    expect(warningCodes(config)).toEqual(['unknown_answer']);
  });

  it('an operator that cannot match the answer type', () => {
    const config = v1();
    config.resultRules.push(
      { resultId: 'balanced', when: { answer: 'priorities', operator: 'eq', value: 'speed' } },
      { resultId: 'balanced', when: { answer: 'work_mode', operator: 'contains', value: 'x' } },
      { resultId: 'balanced', when: { answer: 'work_mode', operator: 'gt', value: 1 } },
      { resultId: 'balanced', when: { answer: 'priorities', operator: 'contains', value: [] } },
    );
    expect(warningCodes(config)).toEqual(Array(4).fill('operator_type'));
  });

  it('no warning for a rule on an option that only one variant has', () => {
    const config = v1();
    const workMode = config.steps['work_mode'];
    if (!workMode || !isKnownStep(workMode) || workMode.type !== 'single-select') {
      throw new Error('fixture');
    }
    config.experiment.variants.B.stepOverrides['work_mode'] = {
      input: { options: [...workMode.input.options, { value: 'async_first', label: 'Async' }] },
    };
    config.resultRules.push({
      resultId: 'balanced',
      when: { answer: 'work_mode', operator: 'eq', value: 'async_first' },
    });
    expect(lintConfig(config).warnings).toEqual([]);
  });

  it('a compared value that is not an option, or of the wrong kind', () => {
    const config = v1();
    const rules = [
      { answer: 'work_mode', operator: 'eq', value: 'hybird' },
      { answer: 'work_mode', operator: 'in', value: 'hybrid' },
      { answer: 'priorities', operator: 'contains', value: ['speed', 'sped'] },
      { answer: 'team_size', operator: 'eq', value: '12' },
    ];
    for (const when of rules) config.resultRules.push({ resultId: 'balanced', when });
    expect(lintConfig(config).warnings.map((w) => w.message)).toEqual([
      'resultRules[3]: "hybird" is not an option ("work_mode")',
      'resultRules[4]: in needs a list of values ("work_mode")',
      'resultRules[5]: "sped" is not an option ("priorities")',
      'resultRules[6]: compares a number with a non-number ("team_size")',
    ]);
  });
});
