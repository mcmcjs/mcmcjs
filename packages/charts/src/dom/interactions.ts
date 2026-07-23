/**
 * Optional, tree-shakeable interaction plugins for {@link mountPlot}: a hover-reveal
 * modebar (pan toggle, axis-zoom selector, zoom in/out, reset, PNG export), cursor
 * wheel-zoom and drag-pan, and a custom hover tooltip with colored series swatches.
 *
 * They are wired inside `mountPlot` and gated by {@link InteractionOptions}, so the
 * default chart stays bare uPlot and none of this lands in a consumer's bundle unless
 * the flags are set. Window-level listeners are tracked and removed on `dispose()`.
 */
import type uPlot from "uplot";

/** Flags controlling which interaction plugins `mountPlot` wires up. */
/** An extra modebar button: an inline SVG icon, a tooltip, and a click handler. */
export interface ModebarButton {
  icon: string;
  title: string;
  onClick: () => void;
}

export interface InteractionOptions {
  /** Preset: enable modebar + tooltip + wheel-zoom + pan at once (default false). */
  interactive?: boolean;
  /** Hover-reveal toolbar (pan, axis-zoom, zoom, reset, PNG). Defaults to `interactive`. */
  modebar?: boolean;
  /** Extra buttons appended to the modebar, after the built-in ones. */
  modebarButtons?: ModebarButton[];
  /** Custom hover tooltip with colored swatches. Defaults to `interactive`. */
  tooltip?: boolean;
  /** Ctrl/Cmd + wheel zoom centered at the cursor. Defaults to `interactive`. */
  wheelZoom?: boolean;
  /** Drag-to-pan (shift/middle-drag, or left-drag in pan mode). Defaults to `interactive`. */
  pan?: boolean;
  /** Uniformly subsample each series to at most this many points (keeps x-alignment). */
  downsample?: number;
  /** Color scheme for tooltip / modebar chrome (default "light"). */
  theme?: "light" | "dark";
}

interface InteractionContext {
  series: { label: string; color: string }[];
  xLabel: string;
  title: string;
  background?: string;
}

interface ChartTheme {
  text: string;
  chromeBg: string;
  hover: string;
  border: string;
  sep: string;
  active: string;
  activeTint: string;
  tooltipBg: string;
  tooltipText: string;
  tooltipMuted: string;
  tooltipSep: string;
  tooltipBorder: string;
}

function resolveTheme(mode: "light" | "dark"): ChartTheme {
  if (mode === "dark") {
    return {
      text: "#e8eaf0",
      chromeBg: "rgba(14,16,26,0.93)",
      hover: "rgba(255,255,255,0.12)",
      border: "rgba(255,255,255,0.12)",
      sep: "rgba(255,255,255,0.14)",
      active: "rgba(99,179,237,0.18)",
      activeTint: "#63b3ed",
      tooltipBg: "#1c1e2b",
      tooltipText: "#e8eaf0",
      tooltipMuted: "rgba(255,255,255,0.5)",
      tooltipSep: "rgba(255,255,255,0.08)",
      tooltipBorder: "rgba(255,255,255,0.12)",
    };
  }
  return {
    text: "#1a1a1a",
    chromeBg: "rgba(255,255,255,0.93)",
    hover: "rgba(0,0,0,0.08)",
    border: "rgba(0,0,0,0.12)",
    sep: "rgba(0,0,0,0.14)",
    active: "rgba(59,130,246,0.15)",
    activeTint: "#2563eb",
    tooltipBg: "#ffffff",
    tooltipText: "#1a1a1a",
    tooltipMuted: "rgba(0,0,0,0.45)",
    tooltipSep: "rgba(0,0,0,0.08)",
    tooltipBorder: "rgba(0,0,0,0.12)",
  };
}

/** Adaptive number formatter: more decimals for small values, fewer for large. */
function fmt(v: number): string {
  if (!Number.isFinite(v)) return "-";
  const abs = Math.abs(v);
  if (abs >= 10000) return v.toFixed(0);
  if (abs >= 100) return v.toFixed(1);
  return v.toFixed(4);
}

type ZoomAxis = "xy" | "x" | "y";
interface PlotState {
  panMode: boolean;
  zoomAxis: ZoomAxis;
}
const PLOT_STATE = new WeakMap<uPlot, PlotState>();
function plotState(u: uPlot): PlotState {
  let s = PLOT_STATE.get(u);
  if (!s) {
    s = { panMode: false, zoomAxis: "xy" };
    PLOT_STATE.set(u, s);
  }
  return s;
}

function setScaleRange(u: uPlot, key: string, min: number | null, max: number | null): void {
  (u.setScale as unknown as (k: string, l: { min: number | null; max: number | null }) => void)(
    key,
    { min, max },
  );
}

function resetScales(u: uPlot): void {
  for (const key of Object.keys(u.scales)) setScaleRange(u, key, null, null);
  u.setData(u.data);
}

function zoomBy(u: uPlot, factor: number, axis: ZoomAxis): void {
  const sx = u.scales.x;
  if (axis !== "y" && sx && sx.min != null && sx.max != null) {
    const c = (sx.min + sx.max) / 2;
    const h = ((sx.max - sx.min) / 2) * factor;
    setScaleRange(u, "x", c - h, c + h);
  }
  const sy = u.scales.y;
  if (axis !== "x" && sy && sy.min != null && sy.max != null) {
    const c = (sy.min + sy.max) / 2;
    const h = ((sy.max - sy.min) / 2) * factor;
    setScaleRange(u, "y", c - h, c + h);
  }
}

function triggerDownload(href: string, name: string): void {
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

const ICON = {
  pan: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/></svg>`,
  zoomOut: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>`,
  zoomIn: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>`,
  reset: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.51"/></svg>`,
  download: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
};

function baseBtn(title: string, t: ChartTheme, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.title = title;
  b.dataset.active = "false";
  b.style.cssText = `display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border:0;background:transparent;color:${t.text};border-radius:50%;cursor:pointer;transition:background 140ms ease,color 140ms ease,transform 80ms ease;pointer-events:auto;flex-shrink:0;`;
  b.addEventListener("mouseenter", () => {
    if (b.dataset.active !== "true") b.style.background = t.hover;
  });
  b.addEventListener("mouseleave", () => {
    if (b.dataset.active !== "true") {
      b.style.background = "transparent";
      b.style.transform = "";
    }
  });
  for (const ev of ["mousedown", "pointerdown", "dblclick"]) {
    b.addEventListener(ev, (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    });
  }
  b.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });
  return b;
}

function iconBtn(
  svg: string,
  title: string,
  t: ChartTheme,
  onClick: () => void,
): HTMLButtonElement {
  const b = baseBtn(title, t, onClick);
  b.innerHTML = svg;
  return b;
}

function textBtn(
  label: string,
  title: string,
  t: ChartTheme,
  onClick: () => void,
): HTMLButtonElement {
  const b = baseBtn(title, t, onClick);
  b.textContent = label;
  b.style.font = `600 11px ui-sans-serif,system-ui,sans-serif`;
  b.style.width = label.length > 1 ? "30px" : "24px";
  return b;
}

function setBtnActive(b: HTMLButtonElement, active: boolean, t: ChartTheme): void {
  b.dataset.active = active ? "true" : "false";
  b.style.background = active ? t.active : "transparent";
  b.style.color = active ? t.activeTint : t.text;
}

function sep(t: ChartTheme): HTMLDivElement {
  const s = document.createElement("div");
  s.style.cssText = `width:1px;height:13px;margin:0 2px;background:${t.sep};flex-shrink:0;`;
  return s;
}

function modebarPlugin(
  t: ChartTheme,
  ctx: InteractionContext,
  background: string,
  extraButtons: ModebarButton[],
): uPlot.Plugin {
  return {
    hooks: {
      ready: (u: uPlot) => {
        const state = plotState(u);
        const parent = (u.over ?? u.root) as HTMLElement;
        if (getComputedStyle(parent).position === "static") parent.style.position = "relative";

        const bar = document.createElement("div");
        bar.className = "mcmc-modebar";
        bar.style.cssText = `position:absolute;top:8px;right:10px;z-index:200;display:flex;align-items:center;gap:1px;padding:3px 4px;border-radius:100px;background:${t.chromeBg};box-shadow:0 4px 20px rgba(0,0,0,0.16),0 1px 6px rgba(0,0,0,0.10);backdrop-filter:blur(10px) saturate(160%);opacity:0;pointer-events:none;user-select:none;transition:opacity 180ms ease,transform 180ms ease;transform:translateY(2px);`;
        bar.addEventListener("pointerdown", (e) => e.stopPropagation());
        bar.addEventListener("mousedown", (e) => e.stopPropagation());

        let panBtn: HTMLButtonElement;
        const setPan = (active: boolean): void => {
          state.panMode = active;
          setBtnActive(panBtn, active, t);
          if (u.over) u.over.style.cursor = active ? "grab" : "";
        };
        panBtn = iconBtn(ICON.pan, "Pan (drag to pan)", t, () => setPan(!state.panMode));

        const axisBtns = [
          textBtn("X", "Zoom x-axis", t, () => setAxis("x")),
          textBtn("Y", "Zoom y-axis", t, () => setAxis("y")),
          textBtn("XY", "Zoom both axes", t, () => setAxis("xy")),
        ];
        const axisKeys: ZoomAxis[] = ["x", "y", "xy"];
        const setAxis = (axis: ZoomAxis): void => {
          state.zoomAxis = axis;
          axisBtns.forEach((b, i) => {
            setBtnActive(b, axisKeys[i] === axis, t);
          });
        };
        setAxis(state.zoomAxis);

        const zoomOut = iconBtn(ICON.zoomOut, "Zoom out", t, () => zoomBy(u, 1.4, state.zoomAxis));
        const zoomIn = iconBtn(ICON.zoomIn, "Zoom in", t, () => zoomBy(u, 1 / 1.4, state.zoomAxis));
        const reset = iconBtn(ICON.reset, "Reset axes", t, () => {
          setPan(false);
          resetScales(u);
        });
        const png = iconBtn(ICON.download, "Download PNG", t, () => {
          const name = `${ctx.title.replace(/[^a-z0-9_.-]+/gi, "_") || "plot"}.png`;
          const src = u.ctx.canvas;
          const out = document.createElement("canvas");
          out.width = src.width;
          out.height = src.height;
          const c = out.getContext("2d");
          if (!c) return;
          c.fillStyle = background;
          c.fillRect(0, 0, out.width, out.height);
          c.drawImage(src, 0, 0);
          triggerDownload(out.toDataURL("image/png"), name);
        });

        const extras = extraButtons.map((btn) => iconBtn(btn.icon, btn.title, t, btn.onClick));
        bar.append(
          panBtn,
          sep(t),
          ...axisBtns,
          sep(t),
          zoomOut,
          zoomIn,
          sep(t),
          reset,
          sep(t),
          png,
          ...(extras.length ? [sep(t), ...extras] : []),
        );
        parent.appendChild(bar);
        const show = (): void => {
          bar.style.opacity = "1";
          bar.style.pointerEvents = "auto";
          bar.style.transform = "translateY(0)";
        };
        const hide = (): void => {
          bar.style.opacity = "0";
          bar.style.pointerEvents = "none";
          bar.style.transform = "translateY(2px)";
        };
        parent.addEventListener("mouseenter", show);
        parent.addEventListener("mouseleave", hide);
      },
    },
  };
}

function interactionPlugin(
  opts: { wheelZoom: boolean; pan: boolean },
  teardowns: (() => void)[],
): uPlot.Plugin {
  return {
    hooks: {
      ready: (u: uPlot) => {
        const over = u.over;
        if (!over) return;
        const state = plotState(u);

        if (opts.wheelZoom) {
          const onWheel = (e: WheelEvent): void => {
            if (!e.deltaY || (!e.ctrlKey && !e.metaKey)) return;
            e.preventDefault();
            const f = e.deltaY > 0 ? 1.15 : 1 / 1.15;
            const rect = over.getBoundingClientRect();
            if (state.zoomAxis !== "x") {
              const sc = u.scales.y;
              if (sc && sc.min != null && sc.max != null) {
                const cv = u.posToVal(e.clientY - rect.top, "y");
                const min = cv - (cv - sc.min) * f;
                const max = cv + (sc.max - cv) * f;
                if (min < max) setScaleRange(u, "y", min, max);
              }
            }
            if (state.zoomAxis !== "y") {
              const sc = u.scales.x;
              if (!sc || sc.min == null || sc.max == null) return;
              const cv = u.posToVal(e.clientX - rect.left, "x");
              const min = cv - (cv - sc.min) * f;
              const max = cv + (sc.max - cv) * f;
              if (min >= max) return;
              const sy = u.scales.y;
              if (sy && sy.min != null && sy.max != null) setScaleRange(u, "y", sy.min, sy.max);
              setScaleRange(u, "x", min, max);
            }
          };
          over.addEventListener("wheel", onWheel, { passive: false });
          teardowns.push(() => over.removeEventListener("wheel", onWheel));
        }

        if (opts.pan) {
          let panning = false;
          let sx = 0;
          let sy = 0;
          let rx: { min: number; max: number } | null = null;
          let ry: { min: number; max: number } | null = null;
          const shouldPan = (e: MouseEvent): boolean =>
            e.button === 1 || (e.button === 0 && (e.shiftKey || state.panMode));
          const onDown = (e: MouseEvent): void => {
            if (!shouldPan(e)) return;
            e.preventDefault();
            e.stopPropagation();
            const scx = u.scales.x;
            if (!scx || scx.min == null || scx.max == null) return;
            panning = true;
            sx = e.clientX;
            sy = e.clientY;
            rx = { min: scx.min, max: scx.max };
            const scy = u.scales.y;
            ry = scy && scy.min != null && scy.max != null ? { min: scy.min, max: scy.max } : null;
            over.style.cursor = "grabbing";
          };
          const onMove = (e: MouseEvent): void => {
            if (!panning || !rx) return;
            const ratio = (u as unknown as { pxRatio?: number }).pxRatio ?? 1;
            const dx = e.clientX - sx;
            const vx = (rx.max - rx.min) / Math.max(1, u.bbox.width / ratio);
            setScaleRange(u, "x", rx.min - dx * vx, rx.max - dx * vx);
            if (ry) {
              const dy = e.clientY - sy;
              const vy = (ry.max - ry.min) / Math.max(1, u.bbox.height / ratio);
              setScaleRange(u, "y", ry.min + dy * vy, ry.max + dy * vy);
            }
          };
          const onUp = (): void => {
            if (!panning) return;
            panning = false;
            ry = null;
            over.style.cursor = state.panMode ? "grab" : "";
          };
          over.addEventListener("mousedown", onDown, true);
          window.addEventListener("mousemove", onMove);
          window.addEventListener("mouseup", onUp);
          teardowns.push(() => {
            over.removeEventListener("mousedown", onDown, true);
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
          });
        }

        const onDbl = (e: MouseEvent): void => {
          e.preventDefault();
          resetScales(u);
        };
        over.addEventListener("dblclick", onDbl);
        teardowns.push(() => over.removeEventListener("dblclick", onDbl));
      },
    },
  };
}

function tooltipPlugin(t: ChartTheme, ctx: InteractionContext): uPlot.Plugin {
  let tip: HTMLDivElement | null = null;
  return {
    hooks: {
      ready: (u: uPlot) => {
        tip = document.createElement("div");
        tip.style.cssText = `position:absolute;pointer-events:none;z-index:100;background:${t.tooltipBg};border:1px solid ${t.tooltipBorder};border-radius:7px;padding:8px 11px;font:12px ui-sans-serif,system-ui,sans-serif;color:${t.tooltipText};white-space:nowrap;display:none;box-shadow:0 4px 16px rgba(0,0,0,0.4);line-height:1.5;`;
        u.over.appendChild(tip);
      },
      setCursor: (u: uPlot) => {
        if (!tip) return;
        const idx = u.cursor.idx;
        const cx = u.cursor.left ?? -1;
        const cy = u.cursor.top ?? -1;
        const xArr = u.data[0] as ArrayLike<number> | undefined;
        const xVal = idx == null || idx < 0 ? null : xArr?.[idx];
        if (idx == null || idx < 0 || cx < 0 || xVal == null) {
          tip.style.display = "none";
          return;
        }
        let html = `<div style="color:${t.tooltipMuted};font-size:10px;margin-bottom:4px">${ctx.xLabel}: ${fmt(xVal)}</div><div style="border-top:1px solid ${t.tooltipSep};padding-top:3px">`;
        for (let si = 0; si < ctx.series.length; si++) {
          const info = ctx.series[si];
          if (!info) continue;
          const yArr = u.data[si + 1] as ArrayLike<number | null> | undefined;
          const val = yArr?.[idx];
          if (val == null) continue;
          html += `<div style="display:flex;align-items:center;gap:6px;margin-top:2px"><span style="display:inline-block;width:8px;height:8px;background:${info.color};border-radius:50%;flex-shrink:0"></span><span style="color:${t.tooltipMuted}">${info.label}</span><strong style="margin-left:auto;padding-left:8px">${fmt(val)}</strong></div>`;
        }
        html += `</div>`;
        tip.innerHTML = html;
        const tw = tip.offsetWidth || 160;
        const th = tip.offsetHeight || 80;
        const uw = u.over.offsetWidth;
        const uh = u.over.offsetHeight;
        let tx = cx + 14;
        if (tx + tw > uw - 4) tx = cx - tw - 14;
        let ty = cy - th / 2;
        ty = Math.max(4, Math.min(ty, uh - th - 4));
        tip.style.left = `${tx}px`;
        tip.style.top = `${ty}px`;
        tip.style.display = "block";
      },
    },
  };
}

/**
 * Resolve {@link InteractionOptions} into uPlot plugins (pushed into `plugins`) and
 * return a `dispose()` that removes any window-level listeners the plugins registered.
 */
export function attachInteractions(
  plugins: unknown[],
  opts: InteractionOptions,
  ctx: InteractionContext,
): { dispose(): void } {
  const on = opts.interactive ?? false;
  const modebar = opts.modebar ?? on;
  const tooltip = opts.tooltip ?? on;
  const wheelZoom = opts.wheelZoom ?? on;
  const pan = opts.pan ?? on;
  const teardowns: (() => void)[] = [];

  if (modebar || tooltip || wheelZoom || pan) {
    const t = resolveTheme(opts.theme ?? "light");
    if (tooltip) plugins.push(tooltipPlugin(t, ctx));
    if (wheelZoom || pan) plugins.push(interactionPlugin({ wheelZoom, pan }, teardowns));
    if (modebar)
      plugins.push(modebarPlugin(t, ctx, ctx.background ?? "#ffffff", opts.modebarButtons ?? []));
  }

  return {
    dispose: () => {
      for (const fn of teardowns) fn();
    },
  };
}

/** Uniformly subsample aligned data to at most `max` columns, preserving x-alignment. */
export function downsampleAligned(data: (number | null)[][], max: number): (number | null)[][] {
  const x = data[0];
  if (!x || x.length <= max || max < 2) return data;
  const step = (x.length - 1) / (max - 1);
  const idx = new Array<number>(max);
  for (let i = 0; i < max; i++) idx[i] = Math.round(i * step);
  return data.map((row) => idx.map((j) => row[j] ?? null));
}

/** Largest-Triangle-Three-Buckets downsampler for a single (x, y) series. */
export function lttb(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  threshold: number,
): { xs: Float64Array; ys: Float64Array } {
  const n = Math.min(xs.length, ys.length);
  if (threshold >= n || threshold < 3) {
    return { xs: Float64Array.from(xs as number[]), ys: Float64Array.from(ys as number[]) };
  }
  const outX = new Float64Array(threshold);
  const outY = new Float64Array(threshold);
  const xn = xs as ArrayLike<number>;
  const yn = ys as ArrayLike<number>;
  outX[0] = xn[0] as number;
  outY[0] = yn[0] as number;
  outX[threshold - 1] = xn[n - 1] as number;
  outY[threshold - 1] = yn[n - 1] as number;
  const every = (n - 2) / (threshold - 2);
  let a = 0;
  for (let i = 0; i < threshold - 2; i++) {
    const rangeStart = Math.floor((i + 1) * every) + 1;
    const rangeEnd = Math.min(Math.floor((i + 2) * every) + 1, n);
    let avgX = 0;
    let avgY = 0;
    for (let j = rangeStart; j < rangeEnd; j++) {
      avgX += xn[j] as number;
      avgY += yn[j] as number;
    }
    const len = rangeEnd - rangeStart;
    if (len > 0) {
      avgX /= len;
      avgY /= len;
    }
    const rangeOffs = Math.floor(i * every) + 1;
    const rangeTo = Math.floor((i + 1) * every) + 1;
    const ax = xn[a] as number;
    const ay = yn[a] as number;
    let maxArea = -1;
    let nextA = rangeOffs;
    for (let j = rangeOffs; j < rangeTo; j++) {
      const area =
        Math.abs((ax - avgX) * ((yn[j] as number) - ay) - (ax - (xn[j] as number)) * (avgY - ay)) *
        0.5;
      if (area > maxArea) {
        maxArea = area;
        nextA = j;
      }
    }
    outX[i + 1] = xn[nextA] as number;
    outY[i + 1] = yn[nextA] as number;
    a = nextA;
  }
  return { xs: outX, ys: outY };
}
