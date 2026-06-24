/** A linear map from a data domain to a pixel/cell range, with inverse. */
export interface Scale {
  map(value: number): number;
  invert(position: number): number;
}

/**
 * A linear scale. A zero-width domain maps everything to the range start, so a
 * constant series still renders (rather than dividing by zero).
 */
export function linearScale(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  return {
    map: (value) => (span === 0 ? r0 : r0 + ((value - d0) / span) * (r1 - r0)),
    invert: (position) => (r1 === r0 ? d0 : d0 + ((position - r0) / (r1 - r0)) * span),
  };
}

/** Pads a [min, max] domain by a fraction, with a fallback when min === max. */
export function niceDomain(min: number, max: number, pad = 0.05): [number, number] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) return [min - 1, max + 1];
  const margin = (max - min) * pad;
  return [min - margin, max + margin];
}
