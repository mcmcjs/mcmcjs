/**
 * Viridis colormap (matplotlib/D3 perceptually-uniform sequential ramp). A generic,
 * dependency-free helper: map a normalized [0, 1] value to an RGB triple, a hex string,
 * or a bare `r,g,b` CSS fragment. Out-of-range inputs clamp to the endpoints.
 */

/** The 16 anchor stops of the viridis ramp (0..255 per channel), dark to bright. */
export const VIRIDIS_STOPS: readonly [number, number, number][] = [
  [68, 1, 84],
  [70, 23, 104],
  [71, 44, 122],
  [65, 63, 133],
  [58, 82, 139],
  [50, 101, 142],
  [42, 120, 142],
  [34, 140, 141],
  [32, 159, 136],
  [34, 176, 120],
  [51, 193, 99],
  [74, 208, 76],
  [104, 222, 53],
  [140, 234, 38],
  [179, 244, 38],
  [253, 231, 37],
];

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Maps `t` in [0, 1] to a viridis `[r, g, b]` triple (0..255), clamping out-of-range `t`. */
export function viridisRgb(t: number): [number, number, number] {
  const n = VIRIDIS_STOPS.length - 1;
  const s = clamp01(t) * n;
  const lo = Math.floor(s);
  const hi = Math.min(lo + 1, n);
  const f = s - lo;
  const c0 = VIRIDIS_STOPS[lo] ?? VIRIDIS_STOPS[0] ?? [0, 0, 0];
  const c1 = VIRIDIS_STOPS[hi] ?? VIRIDIS_STOPS[n] ?? [0, 0, 0];
  return [
    Math.round((c0[0] ?? 0) + ((c1[0] ?? 0) - (c0[0] ?? 0)) * f),
    Math.round((c0[1] ?? 0) + ((c1[1] ?? 0) - (c0[1] ?? 0)) * f),
    Math.round((c0[2] ?? 0) + ((c1[2] ?? 0) - (c0[2] ?? 0)) * f),
  ];
}

/** Maps `t` in [0, 1] to a `#rrggbb` viridis hex string. */
export function viridisHex(t: number): string {
  const [r, g, b] = viridisRgb(t);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Maps `t` in [0, 1] to a bare `r,g,b` fragment (e.g. for `rgba(${...},0.5)`). */
export function viridisCss(t: number): string {
  const [r, g, b] = viridisRgb(t);
  return `${r},${g},${b}`;
}

// Wong (2011) colorblind-safe palette in Makie's order: blue, orange, green,
// reddish purple, sky blue, vermilion, yellow.
export const WONG_COLORS = [
  "#0072b2",
  "#e69f00",
  "#009e73",
  "#cc79a7",
  "#56b4e9",
  "#d55e00",
  "#f0e442",
] as const;

/** The Wong palette color for series `i`, cycling past the palette length. */
export function wongColor(i: number): string {
  return WONG_COLORS[
    ((i % WONG_COLORS.length) + WONG_COLORS.length) % WONG_COLORS.length
  ] as string;
}
