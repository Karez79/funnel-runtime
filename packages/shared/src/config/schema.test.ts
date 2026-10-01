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

  it('rejects a known step type with a malformed input', () => {
    const raw = rawV1Clone();
    const config = v1();
    const steps = {
      ...config.steps,
      work_mode: { ...config.steps['work_mode'], input: { name: 'work_mode', options: 'nope' } },
    };
    expect(parseConfig({ ...raw, steps }).ok).toBe(false);
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
