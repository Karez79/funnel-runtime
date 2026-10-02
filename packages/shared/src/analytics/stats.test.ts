import { describe, expect, it } from 'vitest';
import {
  compareProportions,
  isSignificant,
  normalCdf,
  requiredPerVariant,
  wilsonInterval,
} from './stats.ts';

describe('normalCdf', () => {
  it('matches standard normal table values', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 6);
    expect(normalCdf(-1.644854)).toBeCloseTo(0.05, 6);
    expect(normalCdf(3)).toBeCloseTo(0.99865, 5);
  });
});

describe('wilsonInterval', () => {
  it('gives the 95% Wilson interval', () => {
    const [low, high] = wilsonInterval(10, 100) ?? [NaN, NaN];
    expect(low).toBeCloseTo(0.05523, 4);
    expect(high).toBeCloseTo(0.17437, 4);
  });

  it('stays inside 0..1 at the edges', () => {
    const [low0] = wilsonInterval(0, 20) ?? [NaN];
    const [, high1] = wilsonInterval(20, 20) ?? [NaN, NaN];
    expect(low0).toBe(0);
    expect(high1).toBeCloseTo(1, 10);
  });

  it('is null without sessions', () => {
    expect(wilsonInterval(0, 0)).toBeNull();
  });
});

describe('compareProportions', () => {
  it('runs a two-sided pooled z-test', () => {
    const result = compareProportions(
      { sessions: 100, conversions: 10 },
      { sessions: 100, conversions: 20 },
    );
    expect(result.diffPoints).toBeCloseTo(10, 10);
    expect(result.pValue).toBeCloseTo(0.0477, 3);
  });

  it('is symmetric in direction', () => {
    const ab = compareProportions(
      { sessions: 80, conversions: 30 },
      { sessions: 90, conversions: 20 },
    );
    const ba = compareProportions(
      { sessions: 90, conversions: 20 },
      { sessions: 80, conversions: 30 },
    );
    expect(ab.pValue).toBeCloseTo(ba.pValue ?? NaN, 12);
    expect(ab.diffPoints).toBeCloseTo(-(ba.diffPoints ?? NaN), 12);
  });

  it('has p = 1 for identical rates and no p without variance', () => {
    expect(
      compareProportions({ sessions: 50, conversions: 5 }, { sessions: 50, conversions: 5 }).pValue,
    ).toBe(1);
    expect(
      compareProportions({ sessions: 10, conversions: 0 }, { sessions: 10, conversions: 0 }).pValue,
    ).toBeNull();
  });

  it('has no result while a variant is empty', () => {
    expect(
      compareProportions({ sessions: 0, conversions: 0 }, { sessions: 10, conversions: 2 }),
    ).toEqual({
      diffPoints: null,
      pValue: null,
    });
  });
});

describe('requiredPerVariant', () => {
  it('estimates sessions per variant for alpha .05 and power .8', () => {
    expect(requiredPerVariant(0.1, 0.2)).toBe(199);
  });

  it('grows as the difference shrinks', () => {
    expect(requiredPerVariant(0.1, 0.12) ?? 0).toBeGreaterThan(3000);
  });

  it('is null when there is no difference to detect', () => {
    expect(requiredPerVariant(0.3, 0.3)).toBeNull();
  });
});

describe('isSignificant', () => {
  it('is true only strictly below alpha .05', () => {
    expect(isSignificant(0.049)).toBe(true);
    expect(isSignificant(0.05)).toBe(false);
    expect(isSignificant(0.2)).toBe(false);
  });

  it('is false without a p-value', () => {
    expect(isSignificant(null)).toBe(false);
  });
});
