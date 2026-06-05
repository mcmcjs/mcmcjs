/**
 * Low-level math primitives — zero external dependencies.
 */

/** Inverse normal CDF via Acklam's rational approximation. Max error < 1.15e-9. */
export function _norminvcdf(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p === 0.5) return 0;

  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2,
    -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
    -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783,
  ];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];

  const pLow = 0.02425;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      ((((((c[0] as number) * q + (c[1] as number)) * q + (c[2] as number)) * q +
        (c[3] as number)) *
        q +
        (c[4] as number)) *
        q +
        (c[5] as number)) /
      (((((d[0] as number) * q + (d[1] as number)) * q + (d[2] as number)) * q + (d[3] as number)) *
        q +
        1)
    );
  }
  if (p <= 1 - pLow) {
    const q = p - 0.5,
      r = q * q;
    return (
      (((((((a[0] as number) * r + (a[1] as number)) * r + (a[2] as number)) * r +
        (a[3] as number)) *
        r +
        (a[4] as number)) *
        r +
        (a[5] as number)) *
        q) /
      ((((((b[0] as number) * r + (b[1] as number)) * r + (b[2] as number)) * r +
        (b[3] as number)) *
        r +
        (b[4] as number)) *
        r +
        1)
    );
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return (
    -(
      (((((c[0] as number) * q + (c[1] as number)) * q + (c[2] as number)) * q + (c[3] as number)) *
        q +
        (c[4] as number)) *
        q +
      (c[5] as number)
    ) /
    (((((d[0] as number) * q + (d[1] as number)) * q + (d[2] as number)) * q + (d[3] as number)) *
      q +
      1)
  );
}

/** Normal CDF via Abramowitz & Stegun 26.2.17. Max error < 7.5e-8. */
export function _normcdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const p =
    1 -
    0.3989422804014327 *
      Math.exp(-(x * x) / 2) *
      t *
      (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? p : 1 - p;
}

/** Regularised incomplete beta inverse via Halley's method. */
export function _betainvcdf(p: number, a: number, b: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  let x = _betaInitGuess(p, a, b);
  for (let iter = 0; iter < 64; iter++) {
    const fx = _betainc(x, a, b) - p;
    const dfx = _betaPDF(x, a, b);
    if (dfx === 0 || !Number.isFinite(dfx)) break;
    const d2fx = dfx * ((a - 1) / x - (b - 1) / (1 - x));
    const step = fx / (dfx * (1 - (fx * d2fx) / (2 * dfx * dfx)));
    x = Math.max(1e-15, Math.min(1 - 1e-15, x - step));
    if (Math.abs(step) < 1e-12 * x) break;
  }
  return x;
}

function _betaInitGuess(p: number, a: number, b: number): number {
  const mean = a / (a + b);
  const v = (a * b) / ((a + b) ** 2 * (a + b + 1));
  return Math.max(1e-6, Math.min(1 - 1e-6, mean + Math.sqrt(v) * _norminvcdf(p)));
}

function _betaPDF(x: number, a: number, b: number): number {
  if (x <= 0 || x >= 1) return 0;
  return Math.exp((a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x) - _logBeta(a, b));
}

function _betainc(x: number, a: number, b: number): number {
  return x < (a + 1) / (a + b + 2) ? _betaincCF(x, a, b) : 1 - _betaincCF(1 - x, b, a);
}

function _betaincCF(x: number, a: number, b: number): number {
  const FPMIN = 1e-300;
  const lbeta = _logBeta(a, b);
  const qab = a + b,
    qap = a + 1,
    qam = a - 1;
  let c = 1,
    d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 200; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 3e-14) break;
  }
  return (Math.exp(a * Math.log(x) + b * Math.log(1 - x) - lbeta) * h) / a;
}

function _logBeta(a: number, b: number): number {
  return _logGamma(a) + _logGamma(b) - _logGamma(a + b);
}

export function _logGamma(x: number): number {
  // Lanczos approximation coefficients (Numerical Recipes §6.1, g=5, n=6).
  const c = [
    76.18009172947146,
    // biome-ignore lint/correctness/noPrecisionLoss: intentional high-precision Lanczos coefficient; runtime rounds to nearest float64
    -86.50532032941677,
    24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let y = x,
    tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (const ci of c) {
    y += 1;
    ser += ci / y;
  }
  // biome-ignore lint/correctness/noPrecisionLoss: sqrt(2π) — same rationale as above
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

export function _nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}
