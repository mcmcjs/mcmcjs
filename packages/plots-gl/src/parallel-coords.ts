/**
 * Interactive parallel-coordinates plot backed by regl (WebGL). One vertical axis
 * per variable and one polyline per sampled draw (colored by chain), rendered as
 * GPU line segments with a view-window transform for pan/zoom over axis indices.
 * Numerics come from `parallelCoordsData` in `@mcmcjs/plots`; this module renders
 * the lines, axis bars, and DOM axis labels.
 */
import type { ParallelCoordsData } from "@mcmcjs/plots";
import {
  chainColor,
  DEFAULT_CHAIN_COLORS,
  type GlMountOptions,
  type GlPlotHandle,
  hexToVec4,
  type Regl,
  resolveRegl,
} from "./common";

export interface ParallelCoordsGlOptions extends GlMountOptions {
  /** Polyline opacity in [0, 1] (default 0.15; low so overlapping lines reveal density). */
  lineOpacity?: number;
}

const X_VIEW_PAD = 0.08;
const INITIAL_VISIBLE_AXES = 6;

const VERT_LINES = `
  precision mediump float;
  attribute vec2 aVert;
  uniform float uXMin;
  uniform float uXSpan;
  void main() {
    float t = uXSpan == 0.0 ? 0.5 : (aVert.x - uXMin) / uXSpan;
    float x = mix(-0.84, 0.84, t);
    float y = mix(-0.82, 0.82, aVert.y);
    gl_Position = vec4(x, y, 0.0, 1.0);
  }`;

const FRAG_LINES = `
  precision mediump float;
  uniform vec4 uColor;
  void main() { gl_FragColor = uColor; }`;

const BLEND = {
  enable: true,
  func: { srcRGB: "src alpha", dstRGB: "one minus src alpha", srcAlpha: 1, dstAlpha: 1 },
} as const;

interface ChainGpu {
  chain: number;
  vertBuf: ReturnType<Regl["buffer"]>;
  drawCount: number;
  color: [number, number, number, number];
  visible: boolean;
}

/** Mount an interactive parallel-coordinates plot into `target`. */
export async function mountParallelCoords(
  target: HTMLElement,
  data: ParallelCoordsData,
  opts: ParallelCoordsGlOptions = {},
): Promise<GlPlotHandle> {
  const createRegl = await resolveRegl(opts);
  const colors = opts.chainColors ?? DEFAULT_CHAIN_COLORS;
  const hidden = new Set<number>(opts.hiddenChains ?? []);
  const lineOpacity = opts.lineOpacity ?? 0.15;
  const dpr = globalThis.devicePixelRatio || 1;
  const N = data.vars.length;
  const width = opts.width ?? Math.max(320, target.clientWidth || 560);
  const height = opts.height ?? 360;

  target.style.position = target.style.position || "relative";

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.cssText = `display:block;width:100%;height:${height}px;`;
  target.appendChild(canvas);

  const labelContainer = document.createElement("div");
  labelContainer.style.cssText =
    "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:hidden;font:11px sans-serif;";
  target.appendChild(labelContainer);

  const regl = createRegl({
    canvas,
    attributes: { antialias: true, alpha: true, preserveDrawingBuffer: true },
  });

  // View state: the world axis-index range mapped to padded NDC. Start slightly
  // zoomed for wide sets so pan/zoom controls have a visible effect.
  let xMinView = 0;
  let xMaxView = Math.max(0, Math.min(N - 1, INITIAL_VISIBLE_AXES - 1));

  const drawLines = regl({
    vert: VERT_LINES,
    frag: FRAG_LINES,
    attributes: { aVert: regl.prop<{ verts: unknown }, "verts">("verts") },
    uniforms: {
      uColor: regl.prop<{ color: unknown }, "color">("color"),
      uXMin: regl.prop<{ xMin: number }, "xMin">("xMin"),
      uXSpan: regl.prop<{ xSpan: number }, "xSpan">("xSpan"),
    },
    primitive: "lines",
    count: regl.prop<{ count: number }, "count">("count"),
    blend: BLEND,
    depth: { enable: false },
  });

  const bound = (k: number): { min: number; max: number } => {
    const b = data.bounds[k];
    return b ? { min: b.min, max: b.max } : { min: 0, max: 1 };
  };

  let chainGpu: ChainGpu[] = [];
  const buildGpu = (): void => {
    for (const d of chainGpu) d.vertBuf.destroy();
    chainGpu = [];
    if (N < 2) return;

    // Group sample lines by chain, then pack each chain's segments into one buffer.
    const perChain = new Map<number, ParallelCoordsData["lines"]>();
    for (const line of data.lines) {
      const list = perChain.get(line.chain) ?? [];
      list.push(line);
      perChain.set(line.chain, list);
    }

    const chainIdxs = Array.from(perChain.keys()).sort((a, b) => a - b);
    for (const ci of chainIdxs) {
      const lines = perChain.get(ci) ?? [];
      const numSegments = lines.length * (N - 1);
      const verts = new Float32Array(numSegments * 4);
      let s = 0;
      for (const line of lines) {
        for (let k = 0; k < N - 1; k++) {
          const b0 = bound(k);
          const b1 = bound(k + 1);
          const raw0 = line.values[k] ?? Number.NaN;
          const raw1 = line.values[k + 1] ?? Number.NaN;
          const norm0 = (raw0 - b0.min) / (b0.max - b0.min);
          const norm1 = (raw1 - b1.min) / (b1.max - b1.min);
          const base = s * 4;
          verts[base + 0] = k;
          verts[base + 1] = norm0;
          verts[base + 2] = k + 1;
          verts[base + 3] = norm1;
          s++;
        }
      }
      chainGpu.push({
        chain: ci,
        vertBuf: regl.buffer({ data: verts, type: "float" }),
        drawCount: numSegments * 2,
        color: hexToVec4(chainColor(colors, ci), lineOpacity),
        visible: !hidden.has(ci),
      });
    }
  };
  buildGpu();

  // Axis bars in world (axis-index) space: a vertical bar at world x = k spanning
  // normalized y [0, 1] (the shader maps y to [-0.82, 0.82]).
  const buildAxisVerts = (): Float32Array => {
    if (N < 1) return new Float32Array(0);
    const out = new Float32Array(N * 4);
    for (let k = 0; k < N; k++) {
      out[k * 4 + 0] = k;
      out[k * 4 + 1] = 0;
      out[k * 4 + 2] = k;
      out[k * 4 + 3] = 1;
    }
    return out;
  };
  let axisBuf = regl.buffer({ data: buildAxisVerts(), type: "float" });
  const gridColor = hexToVec4("#262a3a", 0.8);

  const axisCSSX = (k: number, w: number): number => {
    const span = xMaxView - xMinView;
    const t = span === 0 ? 0.5 : (k - xMinView) / span;
    return (X_VIEW_PAD + t * (1 - 2 * X_VIEW_PAD)) * w;
  };

  const buildLabels = (): void => {
    labelContainer.innerHTML = "";
    const w = canvas.getBoundingClientRect().width || width;
    for (let k = 0; k < N; k++) {
      const cssX = axisCSSX(k, w);
      if (cssX < -40 || cssX > w + 40) continue;
      const raw = data.vars[k] ?? "";
      const label = raw.length > 18 ? `${raw.slice(0, 17)}…` : raw;
      const el = document.createElement("div");
      el.style.cssText = `position:absolute;left:${cssX}px;bottom:4px;transform:translateX(-50%);white-space:nowrap;opacity:0.8;`;
      el.title = raw;
      el.textContent = label;
      labelContainer.appendChild(el);
    }
  };
  buildLabels();

  // Ctrl/Cmd + wheel zooms horizontally, centered on the cursor.
  const zoomViewBy = (factor: number, anchorNDC: number): void => {
    const span = xMaxView - xMinView;
    if (span <= 0) return;
    const anchorWorld = xMinView + ((anchorNDC + 1) / 2) * span;
    const newSpan = Math.max(0.5, Math.min(N - 1, span * factor));
    const leftFrac = (anchorNDC + 1) / 2;
    let newMin = anchorWorld - leftFrac * newSpan;
    let newMax = anchorWorld + (1 - leftFrac) * newSpan;
    if (newMin < 0) {
      newMax -= newMin;
      newMin = 0;
    }
    if (newMax > N - 1) {
      newMin -= newMax - (N - 1);
      newMax = N - 1;
    }
    if (newMin < 0) newMin = 0;
    xMinView = newMin;
    xMaxView = newMax;
    buildLabels();
  };
  const onWheel = (e: WheelEvent): void => {
    if (!e.deltaY) return;
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const w = rect.width || width;
    const ndc = ((e.clientX - rect.left) / Math.max(1, w)) * 2 - 1;
    zoomViewBy(e.deltaY > 0 ? 1.15 : 1 / 1.15, ndc);
  };
  canvas.addEventListener("wheel", onWheel, { passive: false });

  const resetView = (): void => {
    xMinView = 0;
    xMaxView = Math.max(0, Math.min(N - 1, INITIAL_VISIBLE_AXES - 1));
    buildLabels();
  };
  const onDblClick = (e: MouseEvent): void => {
    e.preventDefault();
    resetView();
  };
  canvas.addEventListener("dblclick", onDblClick);

  const frameHandle = regl.frame(() => {
    regl.clear({ color: [0, 0, 0, 0], depth: 1 });
    const span = xMaxView - xMinView;
    if (N >= 1) {
      drawLines({
        verts: { buffer: axisBuf, size: 2 },
        color: gridColor,
        count: N * 2,
        xMin: xMinView,
        xSpan: span,
      });
    }
    for (const d of chainGpu) {
      if (d.drawCount === 0 || !d.visible) continue;
      drawLines({
        verts: { buffer: d.vertBuf, size: 2 },
        color: d.color,
        count: d.drawCount,
        xMin: xMinView,
        xSpan: span,
      });
    }
  });

  const ro = new ResizeObserver(() => {
    const cssW = opts.width ?? (target.clientWidth || width);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(height * dpr);
    regl.poll();
    buildLabels();
  });
  ro.observe(target);

  return {
    update: () => {
      buildGpu();
      axisBuf.destroy();
      axisBuf = regl.buffer({ data: buildAxisVerts(), type: "float" });
      resetView();
    },
    setSize: (w, h) => {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.height = `${h}px`;
      regl.poll();
      buildLabels();
    },
    setChainVisible: (chain, show) => {
      if (show) hidden.delete(chain);
      else hidden.add(chain);
      for (const d of chainGpu) if (d.chain === chain) d.visible = show;
    },
    get canvas() {
      return canvas;
    },
    destroy: () => {
      frameHandle.cancel();
      ro.disconnect();
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("dblclick", onDblClick);
      for (const d of chainGpu) d.vertBuf.destroy();
      chainGpu = [];
      axisBuf.destroy();
      regl.destroy();
      canvas.remove();
      labelContainer.remove();
    },
  };
}
