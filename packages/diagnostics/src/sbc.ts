/**
 * Simulation-based calibration statistics, after Talts, Betancourt, Simpson,
 * Vehtari and Gelman (2018). Given ranks of prior draws within their posterior
 * samples across simulated datasets, a calibrated sampler yields uniform
 * ranks; departures are detected with a chi-square test over binned ranks.
 */

// Lanczos approximation, g = 7, n = 9 (double precision).
const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
  1.5056327351493116e-7,
];

function gammaLn(x: number): number {
  if (x < 0.5) {
    // Reflection: gamma(x) gamma(1-x) = pi / sin(pi x).
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - gammaLn(1 - x);
  }
  const z = x - 1;
  let acc = LANCZOS[0] as number;
  for (let i = 1; i < LANCZOS.length; i++) acc += (LANCZOS[i] as number) / (z + i);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(acc);
}

// Regularized lower incomplete gamma P(a, x) by series expansion (x < a + 1).
function lowerSeries(a: number, x: number): number {
  let term = 1 / a;
  let sum = term;
  for (let n = 1; n < 500; n++) {
    term *= x / (a + n);
    sum += term;
    if (Math.abs(term) < Math.abs(sum) * 1e-15) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - gammaLn(a));
}

// Regularized upper incomplete gamma Q(a, x) by continued fraction (x >= a + 1).
function upperContinuedFraction(a: number, x: number): number {
  const tiny = 1e-300;
  let b = x + 1 - a;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-15) break;
  }
  return h * Math.exp(-x + a * Math.log(x) - gammaLn(a));
}

/** Survival function of the chi-square distribution: P(X > statistic). */
export function chiSquarePValue(statistic: number, dof: number): number {
  if (!(dof > 0)) return Number.NaN;
  if (statistic <= 0) return 1;
  const a = dof / 2;
  const x = statistic / 2;
  return x < a + 1 ? 1 - lowerSeries(a, x) : upperContinuedFraction(a, x);
}

export interface SbcUniformity {
  /** Bin edges over the rank range, proportional expected counts. */
  bins: number;
  counts: number[];
  expected: number[];
  statistic: number;
  dof: number;
  pValue: number;
}

/**
 * Chi-square uniformity check for SBC ranks. Ranks take values 0..nPossible-1;
 * they are binned (default: one bin per ~5 simulations, at most 20) and tested
 * against the uniform expectation, with expected counts proportional to bin
 * width when nPossible does not divide evenly.
 */
export function sbcUniformity(
  ranks: ArrayLike<number>,
  nPossible: number,
  opts: { bins?: number } = {},
): SbcUniformity {
  const n = ranks.length;
  if (n === 0) throw new Error("sbc needs at least one simulation");
  if (nPossible < 2) throw new Error("sbc needs at least two possible ranks");
  const bins = Math.max(2, Math.min(opts.bins ?? Math.min(20, Math.floor(n / 5)), nPossible));

  const counts = new Array<number>(bins).fill(0);
  const width = new Array<number>(bins).fill(0);
  const binOf = (r: number) => Math.min(bins - 1, Math.floor((r * bins) / nPossible));
  for (let r = 0; r < nPossible; r++) {
    width[binOf(r)] = (width[binOf(r)] as number) + 1;
  }
  for (let i = 0; i < n; i++) {
    const r = ranks[i] as number;
    if (!Number.isInteger(r) || r < 0 || r >= nPossible) {
      throw new Error(`rank ${r} is outside 0..${nPossible - 1}`);
    }
    counts[binOf(r)] = (counts[binOf(r)] as number) + 1;
  }

  const expected = width.map((w) => (n * w) / nPossible);
  let statistic = 0;
  for (let b = 0; b < bins; b++) {
    const e = expected[b] as number;
    statistic += ((counts[b] as number) - e) ** 2 / e;
  }
  const dof = bins - 1;
  return { bins, counts, expected, statistic, dof, pValue: chiSquarePValue(statistic, dof) };
}
