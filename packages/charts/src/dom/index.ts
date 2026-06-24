/**
 * `@mcmcjs/charts/dom`: mount an interactive uPlot chart into a live DOM element from a
 * plain, function-free spec. uPlot is an optional peer dependency, so the caller supplies
 * its constructor (`import uPlot from "uplot"`) or exposes it as a global; this subpath
 * adds no hard dependency to the otherwise dependency-free core. Returns a small handle
 * for updating data, resizing, exporting a PNG, and tearing down.
 */
import type uPlot from "uplot";

type UplotCtor = typeof uPlot;

/** One series, described declaratively; path styles are flags resolved at mount time. */
export interface MountSeries {
  label: string;
  stroke: string;
  fill?: string;
  /** Path style; mapped to the matching `uPlot.paths.*` builder. */
  paths?: "bars" | "stepped";
  dash?: number[];
  width?: number;
}

/** A function-free chart spec: aligned data (row 0 is x) plus per-series styling. */
export interface MountSpec {
  title?: string;
  xLabel?: string;
  yLabel?: string;
  /** `data[0]` is the shared x; `data[1..]` align to `series`. */
  data: number[][];
  series: MountSeries[];
}

export interface MountOptions {
  width?: number;
  height?: number;
  /** The uPlot constructor; falls back to a global `uPlot` when omitted. */
  uPlot?: UplotCtor;
}

/** Imperative handle over a mounted chart. */
export interface PlotHandle {
  /** Replace the chart's data (rows aligned as in `MountSpec.data`). */
  update(data: number[][]): void;
  /** Resize the chart to new pixel dimensions. */
  setSize(width: number, height: number): void;
  /** The chart's backing canvas (for PNG export via `toBlob`). */
  readonly canvas: HTMLCanvasElement;
  /** Remove the chart and release its listeners. */
  destroy(): void;
}

function resolveCtor(opts: MountOptions): UplotCtor {
  const ctor = opts.uPlot ?? (globalThis as { uPlot?: UplotCtor }).uPlot;
  if (!ctor) {
    throw new Error(
      "mountPlot needs the uPlot constructor: pass { uPlot } or load uPlot as a global",
    );
  }
  return ctor;
}

function pathFor(ctor: UplotCtor, s: MountSeries): unknown {
  const paths = (ctor as unknown as { paths?: Record<string, (o: unknown) => unknown> }).paths;
  if (!paths) return undefined;
  if (s.paths === "bars" && paths.bars)
    return paths.bars({ size: [0.85, Number.POSITIVE_INFINITY] });
  if (s.paths === "stepped" && paths.stepped) return paths.stepped({ align: 1 });
  return undefined;
}

/** Mount a chart described by `spec` into `target`, returning an imperative handle. */
export function mountPlot(
  target: HTMLElement,
  spec: MountSpec,
  opts: MountOptions = {},
): PlotHandle {
  const ctor = resolveCtor(opts);
  const height = opts.height ?? 280;
  const widthOf = (): number => opts.width ?? Math.max(320, target.clientWidth || 640);

  const series: Record<string, unknown>[] = [{}];
  for (const s of spec.series) {
    const o: Record<string, unknown> = {
      label: s.label,
      stroke: s.stroke,
      width: s.width ?? 1.5,
    };
    if (s.fill) o.fill = s.fill;
    if (s.dash) o.dash = s.dash;
    const p = pathFor(ctor, s);
    if (p) {
      o.paths = p;
      o.points = { show: false };
    }
    series.push(o);
  }

  const config = {
    title: spec.title,
    width: widthOf(),
    height,
    scales: { x: { time: false } },
    axes: [{ label: spec.xLabel ?? "" }, { label: spec.yLabel ?? "" }],
    series,
    legend: { live: true },
    cursor: { drag: { x: true, y: true, uni: 12 } },
  };

  // The spec types are intentionally looser than uPlot's; it accepts this shape at runtime.
  const u = new ctor(config as unknown as uPlot.Options, spec.data as uPlot.AlignedData, target);
  const onResize = (): void => u.setSize({ width: widthOf(), height });
  if (opts.width === undefined) globalThis.addEventListener?.("resize", onResize);

  return {
    update: (data) => u.setData(data as uPlot.AlignedData),
    setSize: (width, h) => u.setSize({ width, height: h }),
    get canvas() {
      return u.ctx.canvas;
    },
    destroy: () => {
      globalThis.removeEventListener?.("resize", onResize);
      u.destroy();
    },
  };
}
