export function transform(real: number[] | Float64Array, imag: number[] | Float64Array): void {
  const n = real.length;
  if (n !== imag.length) throw new RangeError("Mismatched lengths");
  if (n === 0) return;
  if ((n & (n - 1)) === 0) transformRadix2(real, imag);
  else transformBluestein(real, imag);
}

export function inverseTransform(
  real: number[] | Float64Array,
  imag: number[] | Float64Array,
): void {
  transform(imag, real);
}

function transformRadix2(real: number[] | Float64Array, imag: number[] | Float64Array): void {
  const n = real.length;
  if (n === 1) return;

  let levels = -1;
  for (let i = 0; i < 32; i++) {
    if (1 << i === n) levels = i;
  }
  if (levels === -1) throw new RangeError("Length is not a power of 2");

  const cosTable = new Array<number>(n / 2);
  const sinTable = new Array<number>(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cosTable[i] = Math.cos((2 * Math.PI * i) / n);
    sinTable[i] = Math.sin((2 * Math.PI * i) / n);
  }

  for (let i = 0; i < n; i++) {
    const j = reverseBits(i, levels);
    if (j > i) {
      let temp = real[i] as number;
      real[i] = real[j] as number;
      real[j] = temp;
      temp = imag[i] as number;
      imag[i] = imag[j] as number;
      imag[j] = temp;
    }
  }

  for (let size = 2; size <= n; size *= 2) {
    const halfsize = size / 2;
    const tablestep = n / size;
    for (let i = 0; i < n; i += size) {
      for (let j = i, k = 0; j < i + halfsize; j++, k += tablestep) {
        const l = j + halfsize;
        const tpre =
          (real[l] as number) * (cosTable[k] as number) +
          (imag[l] as number) * (sinTable[k] as number);
        const tpim =
          -(real[l] as number) * (sinTable[k] as number) +
          (imag[l] as number) * (cosTable[k] as number);
        real[l] = (real[j] as number) - tpre;
        imag[l] = (imag[j] as number) - tpim;
        real[j] = (real[j] as number) + tpre;
        imag[j] = (imag[j] as number) + tpim;
      }
    }
  }
}

function reverseBits(val: number, width: number): number {
  let result = 0;
  for (let i = 0; i < width; i++) {
    result = (result << 1) | (val & 1);
    val >>>= 1;
  }
  return result;
}

function transformBluestein(real: number[] | Float64Array, imag: number[] | Float64Array): void {
  const n = real.length;
  let m = 1;
  while (m < n * 2 + 1) m *= 2;

  const cosTable = new Array<number>(n);
  const sinTable = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const j = (i * i) % (n * 2);
    cosTable[i] = Math.cos((Math.PI * j) / n);
    sinTable[i] = Math.sin((Math.PI * j) / n);
  }

  const areal = zeros(m);
  const aimag = zeros(m);
  for (let i = 0; i < n; i++) {
    areal[i] =
      (real[i] as number) * (cosTable[i] as number) + (imag[i] as number) * (sinTable[i] as number);
    aimag[i] =
      -(real[i] as number) * (sinTable[i] as number) +
      (imag[i] as number) * (cosTable[i] as number);
  }

  const breal = zeros(m);
  const bimag = zeros(m);
  breal[0] = cosTable[0] as number;
  bimag[0] = sinTable[0] as number;
  for (let i = 1; i < n; i++) {
    breal[i] = breal[m - i] = cosTable[i] as number;
    bimag[i] = bimag[m - i] = sinTable[i] as number;
  }

  const creal = new Array<number>(m);
  const cimag = new Array<number>(m);
  convolveComplex(areal, aimag, breal, bimag, creal, cimag);

  for (let i = 0; i < n; i++) {
    real[i] =
      (creal[i] as number) * (cosTable[i] as number) +
      (cimag[i] as number) * (sinTable[i] as number);
    imag[i] =
      -(creal[i] as number) * (sinTable[i] as number) +
      (cimag[i] as number) * (cosTable[i] as number);
  }
}

function convolveComplex(
  xreal: number[],
  ximag: number[],
  yreal: number[],
  yimag: number[],
  outreal: number[],
  outimag: number[],
): void {
  const n = xreal.length;
  xreal = xreal.slice();
  ximag = ximag.slice();
  yreal = yreal.slice();
  yimag = yimag.slice();

  transform(xreal, ximag);
  transform(yreal, yimag);

  for (let i = 0; i < n; i++) {
    const temp =
      (xreal[i] as number) * (yreal[i] as number) - (ximag[i] as number) * (yimag[i] as number);
    ximag[i] =
      (ximag[i] as number) * (yreal[i] as number) + (xreal[i] as number) * (yimag[i] as number);
    xreal[i] = temp;
  }
  inverseTransform(xreal, ximag);

  for (let i = 0; i < n; i++) {
    outreal[i] = (xreal[i] as number) / n;
    outimag[i] = (ximag[i] as number) / n;
  }
}

function zeros(n: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < n; i++) result.push(0);
  return result;
}
