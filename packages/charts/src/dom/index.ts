/**
 * `@mcmcjs/charts/dom`: mount an interactive uPlot chart into a live DOM element from a
 * plain, function-free spec. uPlot is an optional peer dependency, so the caller supplies
 * its constructor (`import uPlot from "uplot"`) or exposes it as a global; this subpath
 * adds no hard dependency to the otherwise dependency-free core. Returns a small handle
 * for toggling series, updating data, resizing, exporting a PNG, and tearing down.
 */
import type uPlot from "uplot";
import { attachInteractions, downsampleAligned, type InteractionOptions } from "./interactions";

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
  /** Initial visibility (default true); maps to uPlot series `show`. */
  show?: boolean;
  /** Marks a series as a real chain vs a guide line, for consumers that subset chains. */
  role?: "chain" | "reference";
}

/** A horizontal (or vertical) guide line drawn over the plot, not a data series. */
export interface RefLine {
  value: number;
  label?: string;
  stroke?: string;
  dash?: number[];
  /** Axis the line is constant on (default "y": a horizontal line at `value`). */
  axis?: "x" | "y";
}

/** A function-free chart spec: aligned data (row 0 is x) plus per-series styling. */
export interface MountSpec {
  title?: string;
  xLabel?: string;
  yLabel?: string;
  /** `data[0]` is the shared x; `data[1..]` align to `series` (null = gap). */
  data: (number | null)[][];
  series: MountSeries[];
  /** Guide lines (e.g. an R-hat threshold) drawn over the plot, kept out of `series`. */
  refLines?: RefLine[];
}

export interface MountOptions extends InteractionOptions {
  width?: number;
  height?: number;
  /** The uPlot constructor; falls back to a global `uPlot` when omitted. */
  uPlot?: UplotCtor;
  /** Background painted behind the plot and into exported PNGs (default transparent / white). */
  background?: string;
  /** Device-pixel ratio for crisp lines under zoom (default `max(2, devicePixelRatio)`). */
  pxRatio?: number;
}

/** Imperative handle over a mounted chart. */
export interface PlotHandle {
  /** Replace the chart's data (rows aligned as in `MountSpec.data`). */
  update(data: (number | null)[][]): void;
  /** Resize the chart to new pixel dimensions. */
  setSize(width: number, height: number): void;
  /** Show or hide one series by its 0-based index into `MountSpec.series`. */
  setSeriesVisible(seriesIndex: number, show: boolean): void;
  /** Export the current plot as a PNG blob (background filled so it is not transparent). */
  toPng(): Promise<Blob>;
  /** The chart's backing canvas. */
  readonly canvas: HTMLCanvasElement;
  /** The underlying uPlot instance (escape hatch for advanced use). */
  readonly uplot: uPlot;
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

/** uPlot draw plugin that paints guide lines from `refLines` (kept out of the data series). */
export function refLinePlugin(refLines: RefLine[]): { hooks: { draw: (u: uPlot) => void } } {
  return {
    hooks: {
      draw: (u: uPlot) => {
        const ctx = u.ctx;
        const view = u as unknown as {
          bbox: { left: number; top: number; width: number; height: number };
          valToPos: (v: number, scale: string, canvasPixels?: boolean) => number;
        };
        const { left, top, width, height } = view.bbox;
        ctx.save();
        ctx.lineWidth = 1;
        for (const r of refLines) {
          ctx.strokeStyle = r.stroke ?? "#9ca3af";
          ctx.setLineDash(r.dash ?? [4, 4]);
          ctx.beginPath();
          if ((r.axis ?? "y") === "y") {
            const y = Math.round(view.valToPos(r.value, "y", true)) + 0.5;
            ctx.moveTo(left, y);
            ctx.lineTo(left + width, y);
          } else {
            const x = Math.round(view.valToPos(r.value, "x", true)) + 0.5;
            ctx.moveTo(x, top);
            ctx.lineTo(x, top + height);
          }
          ctx.stroke();
        }
        ctx.restore();
      },
    },
  };
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
      show: s.show ?? true,
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

  const plugins: unknown[] = [];
  if (spec.refLines && spec.refLines.length > 0) plugins.push(refLinePlugin(spec.refLines));
  const interactions = attachInteractions(plugins, opts, {
    series: spec.series.map((s) => ({ label: s.label, color: s.stroke })),
    xLabel: spec.xLabel ?? "x",
    title: spec.title ?? "plot",
    background: opts.background,
  });

  const prep = (data: (number | null)[][]): (number | null)[][] =>
    opts.downsample && opts.downsample > 0 ? downsampleAligned(data, opts.downsample) : data;

  // Render at >= 2x the device pixel ratio so canvas lines stay crisp under browser zoom.
  const dpr = (globalThis as { devicePixelRatio?: number }).devicePixelRatio || 1;
  const config = {
    title: spec.title,
    width: widthOf(),
    height,
    // `pxRatio` is a runtime uPlot option not yet in its .d.ts; it is carried on the loose config.
    pxRatio: opts.pxRatio ?? Math.max(2, dpr),
    scales: { x: { time: false } },
    axes: [{ label: spec.xLabel ?? "" }, { label: spec.yLabel ?? "" }],
    series,
    legend: { live: true },
    cursor: { drag: { x: true, y: true, uni: 12 } },
    plugins,
  };

  // The spec types are intentionally looser than uPlot's; it accepts this shape at runtime.
  const u = new ctor(
    config as unknown as uPlot.Options,
    prep(spec.data) as uPlot.AlignedData,
    target,
  );

  // Keep the chart sized to its container. Prefer a ResizeObserver (catches container
  // resizes, not just window resizes), debounced with rAF; fall back to window resize.
  const resizeTo = (): void => u.setSize({ width: widthOf(), height });
  let stopObserving: () => void = () => undefined;
  if (opts.width === undefined) {
    const RO = (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    if (RO) {
      let raf = 0;
      const ro = new RO(() => {
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(resizeTo);
      });
      ro.observe(target);
      stopObserving = () => {
        if (raf) cancelAnimationFrame(raf);
        ro.disconnect();
      };
    } else {
      globalThis.addEventListener?.("resize", resizeTo);
      stopObserving = () => globalThis.removeEventListener?.("resize", resizeTo);
    }
  }

  return {
    update: (data) => u.setData(prep(data) as uPlot.AlignedData),
    setSize: (width, h) => u.setSize({ width, height: h }),
    setSeriesVisible: (seriesIndex, show) => {
      (u as unknown as { setSeries: (i: number, o: { show: boolean }) => void }).setSeries(
        seriesIndex + 1,
        { show },
      );
    },
    toPng: () => exportPng(u.ctx.canvas, opts.background ?? "#ffffff"),
    get canvas() {
      return u.ctx.canvas;
    },
    get uplot() {
      return u;
    },
    destroy: () => {
      stopObserving();
      interactions.dispose();
      u.destroy();
    },
  };
}

function exportPng(src: HTMLCanvasElement, background: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const out = document.createElement("canvas");
    out.width = src.width;
    out.height = src.height;
    const ctx = out.getContext("2d");
    if (!ctx) {
      reject(new Error("toPng: no 2d context"));
      return;
    }
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(src, 0, 0);
    out.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("toPng: toBlob failed"))),
      "image/png",
    );
  });
}

export type { InteractionOptions } from "./interactions";
