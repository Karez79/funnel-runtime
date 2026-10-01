import { describe, expect, it } from 'vitest';
import { rawV1Clone, rawV2, v1 } from '../../test/fixtures.ts';
import { answerKey, isKnownStep, parseConfig } from './schema.ts';

describe('parseConfig', () => {
  it('accepts both first-iteration configs', () => {
    expect(parseConfig(rawV1Clone()).ok).toBe(true);
    expect(parseConfig(rawV2).ok).toBe(true);
  });

  it('keeps unknown top-level fields so future configs still load', () => {
    const raw = { ...rawV1Clone(), futureFeature: { enabled: true } };
    const res = parseConfig(raw);
    expect(res.ok && res.config['futureFeature']).toEqual({ enabled: true });
  });

  it('rejects a config without required fields with readable issues', () => {
    const raw = rawV1Clone();
    delete raw['funnelId'];
    const res = parseConfig(raw);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.issues.join('\n')).toMatch(/funnelId/);
  });

  it('rejects a known step type with a malformed input and points at the broken field', () => {
    const raw = rawV1Clone();
    const config = v1();
    const steps = {
      ...config.steps,
      work_mode: { ...config.steps['work_mode'], input: { name: 'work_mode', options: 'nope' } },
    };
    const res = parseConfig({ ...raw, steps });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.issues).toEqual([
      expect.stringMatching(/^steps\.work_mode\.input\.options: /),
    ]);
  });

  it('accepts a step of an unknown future type', () => {
    const raw = rawV1Clone();
    const steps = {
      ...v1().steps,
      slider: { id: 'slider', type: 'slider', content: { title: 'New' } },
    };
    const res = parseConfig({ ...raw, steps });
    expect(res.ok).toBe(true);
    const slider = res.ok ? res.config.steps['slider'] : undefined;
    expect(slider && isKnownStep(slider)).toBe(false);
  });

  it('parses nested all/any/not conditions', () => {
    const raw = rawV1Clone();
    const config = v1();
    const steps = {
      ...config.steps,
      office_days: {
        ...config.steps['office_days'],
        visibleWhen: {
          not: { any: [{ all: [{ answer: 'work_mode', operator: 'eq', value: 'remote' }] }] },
        },
      },
    };
    expect(parseConfig({ ...raw, steps }).ok).toBe(true);
  });

  it.each([
    ['two groups in one node', { all: [{ answer: 'a', operator: 'eq', value: 1 }], any: [] }],
    ['a leaf with a stray key', { answer: 'a', operator: 'eq', value: 1, not: {} }],
    ['an unknown group key', { one: [] }],
  ])('rejects a condition node with %s instead of dropping keys', (_name, visibleWhen) => {
    const raw = rawV1Clone();
    const steps = { ...v1().steps, office_days: { ...v1().steps['office_days'], visibleWhen } };
    expect(parseConfig({ ...raw, steps }).ok).toBe(false);
  });

  it('parses an unknown operator (lint rejects it) and an exists leaf without value', () => {
    const raw = rawV1Clone();
    const steps = {
      ...v1().steps,
      office_days: {
        ...v1().steps['office_days'],
        visibleWhen: {
          all: [
            { answer: 'work_mode', operator: 'matches', value: 'h' },
            { answer: 'work_mode', operator: 'exists' },
          ],
        },
      },
    };
    const res = parseConfig({ ...raw, steps });
    expect(res.ok && res.config.steps['office_days']?.visibleWhen).toEqual(
      steps.office_days.visibleWhen,
    );
  });

  it('keeps unknown fields inside steps and results', () => {
    const raw = rawV1Clone();
    const config = v1();
    const steps = { ...config.steps, intro: { ...config.steps['intro'], media: { src: 'x.png' } } };
    const results = {
      ...config.results,
      balanced: { ...config.results['balanced'], badge: 'new' },
    };
    const res = parseConfig({ ...raw, steps, results });
    expect(res.ok && res.config.steps['intro']?.['media']).toEqual({ src: 'x.png' });
    expect(res.ok && res.config.results['balanced']?.['badge']).toBe('new');
  });

  it('applies defaults for optional sections', () => {
    const raw = rawV1Clone();
    delete raw['progress'];
    delete raw['resultRules'];
    const res = parseConfig(raw);
    expect(res.ok && res.config.progress.excludeTypes).toEqual(['info', 'result']);
    expect(res.ok && res.config.resultRules).toEqual([]);
  });

  it('rejects a variant other than A and B', () => {
    const raw = rawV1Clone();
    const experiment = v1().experiment;
    const variants = { ...experiment.variants, C: experiment.variants.A };
    expect(parseConfig({ ...raw, experiment: { ...experiment, variants } }).ok).toBe(false);
  });

  it('rejects a malformed condition node', () => {
    const raw = rawV1Clone();
    const steps = {
      ...v1().steps,
      office_days: { ...v1().steps['office_days'], visibleWhen: { all: 'x' } },
    };
    expect(parseConfig({ ...raw, steps }).ok).toBe(false);
  });
});

describe('answerKey', () => {
  it('uses input.name for interactive steps and the id otherwise', () => {
    const config = v1();
    const workMode = config.steps['work_mode'];
    const intro = config.steps['intro'];
    expect(workMode && answerKey(workMode)).toBe('work_mode');
    expect(intro && answerKey(intro)).toBe('intro');
  });
});
