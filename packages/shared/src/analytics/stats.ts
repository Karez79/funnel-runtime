// Statistics for the A/B comparison (CLAUDE.md 11.2): Wilson interval for each variant,
// a two-sided two-proportion z-test and the sample size that would make the observed
// difference significant. Closed-form and dependency-free, so the dashboard, `verify`
// and tests get identical numbers. Pure: counts in, numbers out.

/** z for a two-sided 95% interval (alpha = .05). */
const Z_ALPHA = 1.959963984540054;
/** z for power .8 (one-sided beta = .2). */
const Z_BETA = 0.8416212335729143;

/**
 * Complementary error function, Numerical Recipes `erfcc` (Chebyshev fit, relative
 * error below 1.2e-7): far more precise than the p-values the dashboard prints.
 */
function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const poly =
    -z * z -
    1.26551223 +
    t *
      (1.00002368 +
        t *
          (0.37409196 +
            t *
              (0.09678418 +
                t *
                  (-0.18628806 +
                    t *
                      (0.27886807 +
                        t *
                          (-1.13520398 +
                            t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))));
  const value = t * Math.exp(poly);
  return x >= 0 ? value : 2 - value;
}

export function normalCdf(z: number): number {
  return 0.5 * erfc(-z / Math.SQRT2);
}

/** 95% Wilson score interval of `conversions / sessions`; null without sessions. */
export function wilsonInterval(conversions: number, sessions: number): [number, number] | null {
  if (sessions === 0) return null;
  const p = conversions / sessions;
  const z2 = Z_ALPHA * Z_ALPHA;
  const denominator = 1 + z2 / sessions;
  const center = (p + z2 / (2 * sessions)) / denominator;
  const margin =
    (Z_ALPHA * Math.sqrt((p * (1 - p)) / sessions + z2 / (4 * sessions * sessions))) / denominator;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

export interface Counts {
  readonly sessions: number;
  readonly conversions: number;
}

export interface Comparison {
  /** (B − A) in percentage points. */
  readonly diffPoints: number | null;
  /** Two-sided p-value of the pooled z-test; null when it is undefined. */
  readonly pValue: number | null;
}

export function compareProportions(a: Counts, b: Counts): Comparison {
  if (a.sessions === 0 || b.sessions === 0) return { diffPoints: null, pValue: null };
  const pa = a.conversions / a.sessions;
  const pb = b.conversions / b.sessions;
  const diffPoints = (pb - pa) * 100;
  const pooled = (a.conversions + b.conversions) / (a.sessions + b.sessions);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / a.sessions + 1 / b.sessions));
  // All or nothing converted in both variants: no variance, the test says nothing.
  if (se === 0) return { diffPoints, pValue: null };
  const z = Math.abs(pb - pa) / se;
  if (z === 0) return { diffPoints, pValue: 1 };
  return { diffPoints, pValue: Math.min(1, 2 * (1 - normalCdf(z))) };
}

/**
 * Sessions per variant needed to detect the difference between `pa` and `pb` with a
 * two-sided test at alpha .05 and power .8 (normal approximation). Null when the rates
 * are equal: no sample size detects a zero difference.
 */
export function requiredPerVariant(pa: number, pb: number): number | null {
  const delta = Math.abs(pb - pa);
  if (delta === 0) return null;
  const mean = (pa + pb) / 2;
  const root =
    Z_ALPHA * Math.sqrt(2 * mean * (1 - mean)) + Z_BETA * Math.sqrt(pa * (1 - pa) + pb * (1 - pb));
  return Math.ceil((root * root) / (delta * delta));
}
