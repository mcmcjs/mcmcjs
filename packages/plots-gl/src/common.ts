/**
 * Shared plumbing for the WebGL renderers: the imperative handle they return,
 * optional-peer resolution of `regl`, a default chain palette, and color helpers.
 * `regl` is never imported for value; it is only used as a type and loaded at runtime
 * via a dynamic import or an injected factory, so this package adds no hard dependency.
 */
import type REGL from "regl";

/** The `regl` constructor: `regl(options) -> Regl`. Matches `(await import("regl")).default`. */
export type ReglFactory = (options: REGL.InitializationOptions) => REGL.Regl;

/** A live `regl` instance. */
export type Regl = REGL.Regl;

/** Options accepted by every renderer for supplying `regl` and sizing the canvas. */
export interface GlMountOptions {
  /** The `regl` factory; falls back to a dynamic `import("regl")` when omitted. */
  regl?: ReglFactory;
  /** Canvas CSS width in pixels (defaults to the target's measured width). */
  width?: number;
  /** Canvas CSS height in pixels. */
  height?: number;
  /** Per-chain colors as `#rrggbb` hex strings; cycles when there are more chains than colors. */
  chainColors?: readonly string[];
  /** Chain ids hidden on first render; toggle later via `setChainVisible`. */
  hiddenChains?: readonly number[];
}

/** Imperative handle over a mounted WebGL plot. */
export interface GlPlotHandle {
  /** Rebuild GPU buffers and labels from the current data (no-op data is re-read by the caller). */
  update(): void;
  /** Resize the backing canvas to new CSS pixel dimensions. */
  setSize(width: number, height: number): void;
  /** Show or hide every series belonging to a chain id (drives click-to-toggle legends). */
  setChainVisible(chain: number, show: boolean): void;
  /** The backing canvas (for PNG export via `toDataURL`/`toBlob`). */
  readonly canvas: HTMLCanvasElement;
  /** Cancel the render loop, detach listeners, and release GPU resources. */
  destroy(): void;
}

/** Default chain palette (matches `@mcmcjs/charts` PALETTE) used when `chainColors` is omitted. */
export const DEFAULT_CHAIN_COLORS = [
  "#1f77b4",
  "#ff7f0e",
  "#2ca02c",
  "#d62728",
  "#9467bd",
  "#8c564b",
  "#17becf",
] as const;

/**
 * Resolve the `regl` factory: prefer `opts.regl`, else dynamic-import the optional peer.
 * Throws a clear error when neither is available so consumers know to install `regl`
 * or inject a factory.
 */
export async function resolveRegl(opts: { regl?: ReglFactory }): Promise<ReglFactory> {
  if (opts.regl) return opts.regl;
  try {
    const mod = (await import("regl")) as { default?: ReglFactory };
    const factory = mod.default ?? (mod as unknown as ReglFactory);
    if (typeof factory === "function") return factory;
  } catch {
    // fall through to the explicit error below
  }
  throw new Error("@mcmcjs/plots-gl needs regl: install it or pass { regl }");
}

/** Convert a `#rgb`/`#rrggbb` hex color and an alpha into a regl `vec4` in [0, 1]. */
export function hexToVec4(hex: string, alpha: number): [number, number, number, number] {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const n = Number.parseInt(full, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, alpha];
}

/** Pick the chain color at index `i`, cycling through `colors`. */
export function chainColor(colors: readonly string[], i: number): string {
  return colors[i % colors.length] ?? "#1f77b4";
}
