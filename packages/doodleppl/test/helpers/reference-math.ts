// Independent brute-force reference densities for the parity fixtures, written
// directly from the model definitions (no shared code with the generator).

export function logSumExp(xs: number[]): number {
  const m = Math.max(...xs);
  if (!Number.isFinite(m)) return m;
  return m + Math.log(xs.reduce((a, x) => a + Math.exp(x - m), 0));
}

export function normalLpdf(x: number, mu: number, sd: number): number {
  const z = (x - mu) / sd;
  return -0.5 * z * z - Math.log(sd) - 0.5 * Math.log(2 * Math.PI);
}

export function expLpdf(x: number, rate: number): number {
  return Math.log(rate) - rate * x;
}

export function softmax(xs: number[]): number[] {
  const lse = logSumExp(xs);
  return xs.map((x) => Math.exp(x - lse));
}

interface MixtureData {
  N: number;
  y: number[];
  w: number[];
}
interface MixturePoint {
  mu: number[];
  sigma: number[];
}

/** Full log density of the mixture fixture with z summed out, in unconstrained space. */
export function mixtureLogDensity(data: MixtureData, p: MixturePoint): number {
  let lp = 0;
  for (let k = 0; k < 2; k++) {
    lp += normalLpdf(p.mu[k] as number, 0, 10);
    // sigma[k] ~ dexp(1) plus the log-Jacobian of the lower-bound (log) transform
    lp += expLpdf(p.sigma[k] as number, 1) + Math.log(p.sigma[k] as number);
  }
  for (let i = 0; i < data.N; i++) {
    const terms = [0, 1].map(
      (k) =>
        Math.log(data.w[k] as number) +
        normalLpdf(data.y[i] as number, p.mu[k] as number, p.sigma[k] as number),
    );
    lp += logSumExp(terms);
  }
  return lp;
}

/** Full log density of the partially observed mixture (missing z summed out). */
export function mixturePartialLogDensity(
  data: MixtureData & { z: (number | null)[] },
  p: MixturePoint,
): number {
  let lp = 0;
  for (let k = 0; k < 2; k++) {
    lp += normalLpdf(p.mu[k] as number, 0, 10);
    lp += expLpdf(p.sigma[k] as number, 1) + Math.log(p.sigma[k] as number);
  }
  for (let i = 0; i < data.N; i++) {
    const z = data.z[i];
    if (z === null || z === undefined) {
      const terms = [0, 1].map(
        (k) =>
          Math.log(data.w[k] as number) +
          normalLpdf(data.y[i] as number, p.mu[k] as number, p.sigma[k] as number),
      );
      lp += logSumExp(terms);
    } else {
      lp +=
        Math.log(data.w[z - 1] as number) +
        normalLpdf(data.y[i] as number, p.mu[z - 1] as number, p.sigma[z - 1] as number);
    }
  }
  return lp;
}

interface HmmData {
  T: number;
  K: number;
  y: number[];
  pi0: number[];
  P: number[][];
}

/**
 * Full log density of the HMM fixture with the state path summed out by the
 * forward algorithm, in unconstrained space (tau is log-transformed).
 */
export function hmmLogDensity(d: HmmData, p: { mu: number[]; tau: number }): number {
  const sd = 1 / Math.sqrt(p.tau);
  let lp = 0;
  for (let k = 0; k < d.K; k++) lp += normalLpdf(p.mu[k] as number, 0, 10);
  // dgamma(1, 1) plus the log-Jacobian of the lower-bound transform
  lp += -p.tau + Math.log(p.tau);

  let alpha = Array.from(
    { length: d.K },
    (_, k) => Math.log(d.pi0[k] as number) + normalLpdf(d.y[0] as number, p.mu[k] as number, sd),
  );
  for (let t = 1; t < d.T; t++) {
    const next = Array.from({ length: d.K }, (_, k) => {
      const acc = Array.from(
        { length: d.K },
        (_, j) => (alpha[j] as number) + Math.log((d.P[j] as number[])[k] as number),
      );
      return logSumExp(acc) + normalLpdf(d.y[t] as number, p.mu[k] as number, sd);
    });
    alpha = next;
  }
  return lp + logSumExp(alpha);
}

/** Exact smoothing marginals p(z[t] = k | y, theta) by forward-backward. */
export function hmmStatePosteriors(d: HmmData, p: { mu: number[]; tau: number }): number[][] {
  const sd = 1 / Math.sqrt(p.tau);
  const emit = (t: number, k: number) => normalLpdf(d.y[t] as number, p.mu[k] as number, sd);
  const fwd: number[][] = [
    Array.from({ length: d.K }, (_, k) => Math.log(d.pi0[k] as number) + emit(0, k)),
  ];
  for (let t = 1; t < d.T; t++) {
    fwd.push(
      Array.from({ length: d.K }, (_, k) => {
        const acc = Array.from(
          { length: d.K },
          (_, j) =>
            ((fwd[t - 1] as number[])[j] as number) + Math.log((d.P[j] as number[])[k] as number),
        );
        return logSumExp(acc) + emit(t, k);
      }),
    );
  }
  const bwd: number[][] = Array.from({ length: d.T }, () => Array.from({ length: d.K }, () => 0));
  for (let t = d.T - 2; t >= 0; t--) {
    for (let j = 0; j < d.K; j++) {
      const acc = Array.from(
        { length: d.K },
        (_, k) =>
          Math.log((d.P[j] as number[])[k] as number) +
          emit(t + 1, k) +
          ((bwd[t + 1] as number[])[k] as number),
      );
      (bwd[t] as number[])[j] = logSumExp(acc);
    }
  }
  return Array.from({ length: d.T }, (_, t) =>
    softmax(
      Array.from(
        { length: d.K },
        (_, k) => ((fwd[t] as number[])[k] as number) + ((bwd[t] as number[])[k] as number),
      ),
    ),
  );
}

interface NestedMixtureData {
  N: number;
  M: number;
  w: number[];
  y: number[][];
}

/** Full log density of the nested-plate mixture with every z[i,j] summed out. */
export function nestedMixtureLogDensity(d: NestedMixtureData, p: { mu: number[] }): number {
  let lp = 0;
  for (let k = 0; k < 2; k++) lp += normalLpdf(p.mu[k] as number, 0, 10);
  for (let i = 0; i < d.N; i++) {
    for (let j = 0; j < d.M; j++) {
      const terms = [0, 1].map(
        (k) =>
          Math.log(d.w[k] as number) +
          normalLpdf((d.y[i] as number[])[j] as number, p.mu[k] as number, 1),
      );
      lp += logSumExp(terms);
    }
  }
  return lp;
}

/** Exact posterior over z[i,j] given the parameters. */
export function nestedMixtureZPosterior(
  d: NestedMixtureData,
  p: { mu: number[] },
  i: number,
  j: number,
): number[] {
  const terms = [0, 1].map(
    (k) =>
      Math.log(d.w[k] as number) +
      normalLpdf((d.y[i] as number[])[j] as number, p.mu[k] as number, 1),
  );
  return softmax(terms);
}

/** Exact per-observation posterior over z given the parameters. */
export function mixtureZPosterior(data: MixtureData, p: MixturePoint, i: number): number[] {
  const terms = [0, 1].map(
    (k) =>
      Math.log(data.w[k] as number) +
      normalLpdf(data.y[i] as number, p.mu[k] as number, p.sigma[k] as number),
  );
  return softmax(terms);
}

interface MixedDagData {
  piX: number[];
  piZ: number[];
  muX: number[];
  tauA: number;
  tauB: number;
  alpha0: number;
  alpha1: number;
  deltaC: number[];
  deltaZ: number[];
  tauD: number;
  D: number;
}
interface MixedDagPoint {
  A: number;
  B: number;
}

function mixedDagConfigLp(d: MixedDagData, p: MixedDagPoint, x: number, z: number, c: number) {
  const pC = 1 / (1 + Math.exp(-(d.alpha0 + d.alpha1 * p.A)));
  let lp = Math.log(d.piX[x - 1] as number) + Math.log(d.piZ[z - 1] as number);
  lp += c === 1 ? Math.log(pC) : Math.log(1 - pC);
  lp += normalLpdf(p.A, d.muX[x - 1] as number, 1 / Math.sqrt(d.tauA));
  lp += normalLpdf(
    d.D,
    p.B + (d.deltaC[c] as number) + (d.deltaZ[z - 1] as number),
    1 / Math.sqrt(d.tauD),
  );
  return lp;
}

/** Full log density of the mixed DAG fixture with X, Z, C summed out (A, B unconstrained). */
export function mixedDagLogDensity(d: MixedDagData, p: MixedDagPoint): number {
  const configs: number[] = [];
  for (const x of [1, 2])
    for (const z of [1, 2])
      for (const c of [0, 1]) {
        configs.push(mixedDagConfigLp(d, p, x, z, c));
      }
  return normalLpdf(p.B, p.A, 1 / Math.sqrt(d.tauB)) + logSumExp(configs);
}

function logChoose(n: number, k: number): number {
  let lp = 0;
  for (let i = 1; i <= k; i++) lp += Math.log(n - k + i) - Math.log(i);
  return lp;
}

export function binomialLpmf(k: number, n: number, p: number): number {
  return logChoose(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p);
}

export function betaLpdf(x: number, a: number, b: number): number {
  const logBeta = lgamma(a) + lgamma(b) - lgamma(a + b);
  return (a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x) - logBeta;
}

// Lanczos approximation, accurate to ~1e-13 for the small shape values used here.
function lgamma(x: number): number {
  const g = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  const z = x - 1;
  let a = 0.99999999999980993;
  for (let i = 0; i < g.length; i++) a += (g[i] as number) / (z + i + 1);
  const t = z + g.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

interface BinMixData {
  N: number;
  y: number[];
  mu0: number;
  delta: number;
}
interface BinMixPoint {
  phi: number;
}

/** Full log density of the binomial mixture with z summed out (phi logit-transformed). */
export function binMixLogDensity(d: BinMixData, p: BinMixPoint): number {
  let lp = betaLpdf(p.phi, 2, 2) + Math.log(p.phi * (1 - p.phi));
  for (let i = 0; i < d.N; i++) {
    const terms = [0, 1, 2, 3].map(
      (k) => binomialLpmf(k, 3, p.phi) + normalLpdf(d.y[i] as number, d.mu0 + d.delta * k, 1),
    );
    lp += logSumExp(terms);
  }
  return lp;
}

/** Exact per-observation posterior over z given phi. */
export function binMixZPosterior(d: BinMixData, p: BinMixPoint, i: number): number[] {
  const terms = [0, 1, 2, 3].map(
    (k) => binomialLpmf(k, 3, p.phi) + normalLpdf(d.y[i] as number, d.mu0 + d.delta * k, 1),
  );
  return softmax(terms);
}

interface ChainDagData {
  piX: number[];
  theta: number[][];
  mu: number[];
  yobs: number;
}
interface ChainDagPoint {
  sigma: number;
}

function chainDagConfigLp(d: ChainDagData, p: ChainDagPoint, x: number, y: number): number {
  return (
    Math.log(d.piX[x - 1] as number) +
    Math.log((d.theta[x - 1] as number[])[y - 1] as number) +
    normalLpdf(d.yobs, d.mu[y - 1] as number, p.sigma)
  );
}

/** Full log density of the chain DAG fixture with X, Y summed out (sigma log-transformed). */
export function chainDagLogDensity(d: ChainDagData, p: ChainDagPoint): number {
  const configs: number[] = [];
  for (const x of [1, 2]) for (const y of [1, 2]) configs.push(chainDagConfigLp(d, p, x, y));
  return expLpdf(p.sigma, 1) + Math.log(p.sigma) + logSumExp(configs);
}

/** Exact joint posterior over (X, Y) configurations given the parameters. */
export function chainDagJointPosterior(d: ChainDagData, p: ChainDagPoint): Map<string, number> {
  const keys: string[] = [];
  const lps: number[] = [];
  for (const x of [1, 2])
    for (const y of [1, 2]) {
      keys.push(`${x},${y}`);
      lps.push(chainDagConfigLp(d, p, x, y));
    }
  const probs = softmax(lps);
  return new Map(keys.map((k, i) => [k, probs[i] as number]));
}

/** Exact joint posterior over (X, Z, C) configurations given the parameters. */
export function mixedDagJointPosterior(d: MixedDagData, p: MixedDagPoint): Map<string, number> {
  const keys: string[] = [];
  const lps: number[] = [];
  for (const x of [1, 2])
    for (const z of [1, 2])
      for (const c of [0, 1]) {
        keys.push(`${x},${z},${c}`);
        lps.push(mixedDagConfigLp(d, p, x, z, c));
      }
  const probs = softmax(lps);
  return new Map(keys.map((k, i) => [k, probs[i] as number]));
}
