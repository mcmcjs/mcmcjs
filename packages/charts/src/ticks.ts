/**
 * "Nice" axis tick values across [min, max] — roughly `count` ticks at
 * human-friendly 1/2/5 x 10^k steps. Returns [min] for a zero-width range.
 */
export function ticks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) return [min];
  const step0 = (max - min) / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(step0));
  const norm = step0 / mag;
  const nice = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  const step = nice * mag;
  const start = Math.ceil(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step * 1e-9; v += step) {
    out.push(Number(v.toPrecision(12)));
  }
  return out;
}
