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
