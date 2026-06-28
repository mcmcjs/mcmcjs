/**
 * Interactive 3D scatter (point cloud) backed by regl (WebGL). Mirrors the
 * `@mcmcjs/charts/dom` mount pattern: it attaches a canvas to `target`, starts a
 * spherical orbit-camera render loop, and returns a handle for resizing, updating,
 * and teardown. The renderer-agnostic numerics come from `scatter3dData` in
 * `@mcmcjs/plots`; this module only renders and handles interaction.
 */
import type { Scatter3dData } from "@mcmcjs/plots";
import {
  chainColor,
  DEFAULT_CHAIN_COLORS,
  type GlMountOptions,
  type GlPlotHandle,
  hexToVec4,
  type Regl,
  resolveRegl,
} from "./common";
import { mat4LookAt, mat4Multiply, mat4Perspective, projectPt } from "./mat4";

export interface Scatter3dGlOptions extends GlMountOptions {
  /** Point radius in device pixels (default 5). */
  pointSize?: number;
  /** Point fill opacity in [0, 1] (default 0.85). */
  pointOpacity?: number;
}

const VERT_POINTS = `
  precision mediump float;
  attribute vec3 position;
  uniform mat4 uMVP;
  uniform float uPointSize;
  void main() {
    gl_Position = uMVP * vec4(position, 1.0);
    gl_PointSize = uPointSize;
  }`;

const FRAG_POINTS = `
  precision mediump float;
  uniform vec4 uColor;
  void main() {
    if (length(gl_PointCoord - vec2(0.5)) > 0.5) discard;
    gl_FragColor = uColor;
  }`;

const VERT_LINES = `
  precision mediump float;
  attribute vec3 position;
  attribute vec4 aColor;
  uniform mat4 uMVP;
  varying vec4 vColor;
  void main() { gl_Position = uMVP * vec4(position, 1.0); vColor = aColor; }`;

const FRAG_LINES = `
  precision mediump float;
  varying vec4 vColor;
  void main() { gl_FragColor = vColor; }`;

const BLEND = {
  enable: true,
  func: { srcRGB: "src alpha", dstRGB: "one minus src alpha", srcAlpha: 1, dstAlpha: 1 },
} as const;

interface ChainEntry {
  buf: ReturnType<Regl["buffer"]>;
  count: number;
  chain: number;
  color: [number, number, number, number];
  visible: boolean;
  normX: Float32Array;
  normY: Float32Array;
  normZ: Float32Array;
  rawX: number[];
  rawY: number[];
  rawZ: number[];
}

/** Mount an interactive 3D scatter into `target`. */
export async function mountScatter3d(
  target: HTMLElement,
  data: Scatter3dData,
  opts: Scatter3dGlOptions = {},
): Promise<GlPlotHandle> {
  const createRegl = await resolveRegl(opts);
  const colors = opts.chainColors ?? DEFAULT_CHAIN_COLORS;
  const hidden = new Set<number>(opts.hiddenChains ?? []);
  const dpr = globalThis.devicePixelRatio || 1;
  const width = opts.width ?? Math.max(320, target.clientWidth || 560);
  const height = opts.height ?? 360;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.cssText = "display:block;width:100%;height:100%;cursor:default;";
  target.appendChild(canvas);

  const regl = createRegl({ canvas, attributes: { antialias: true, alpha: true } });

  // Spherical orbit camera.
  const FOV = Math.PI / 4;
  const PHI_LIMIT = Math.PI / 2 - 0.05;
  let theta = 0.6;
  let phi = 0.4;
  let radius = 3.2;
  const setRadius = (next: number): void => {
    radius = Math.max(1.2, Math.min(20, next));
  };
  const getEye = (): [number, number, number] => {
    const cp = Math.cos(phi);
    return [radius * Math.sin(theta) * cp, radius * Math.sin(phi), radius * Math.cos(theta) * cp];
  };

  const drawPoints = regl({
    vert: VERT_POINTS,
    frag: FRAG_POINTS,
    attributes: { position: regl.prop<{ position: unknown }, "position">("position") },
    uniforms: {
      uMVP: regl.prop<{ mvp: unknown }, "mvp">("mvp"),
      uColor: regl.prop<{ color: unknown }, "color">("color"),
      uPointSize: regl.prop<{ pointSize: unknown }, "pointSize">("pointSize"),
    },
    primitive: "points",
    count: regl.prop<{ count: number }, "count">("count"),
    blend: BLEND,
    depth: { enable: true, mask: false },
  });

  // Axis lines: red X, green Y, blue Z (each from origin to 1.2 along its axis).
  const axisPosBuf = regl.buffer({
    data: new Float32Array([0, 0, 0, 1.2, 0, 0, 0, 0, 0, 0, 1.2, 0, 0, 0, 0, 0, 0, 1.2]),
    type: "float",
  });
  const axisColBuf = regl.buffer({
    data: new Float32Array([
      1, 0.3, 0.3, 0.8, 1, 0.3, 0.3, 0.8, 0.3, 1, 0.3, 0.8, 0.3, 1, 0.3, 0.8, 0.4, 0.6, 1, 0.8, 0.4,
      0.6, 1, 0.8,
    ]),
    type: "float",
  });
  const drawAxes = regl({
    vert: VERT_LINES,
    frag: FRAG_LINES,
    attributes: {
      position: { buffer: axisPosBuf, size: 3 },
      aColor: { buffer: axisColBuf, size: 4 },
    },
    uniforms: { uMVP: regl.prop<{ mvp: unknown }, "mvp">("mvp") },
    primitive: "lines",
    count: 6,
    blend: BLEND,
    depth: { enable: true, mask: true },
  });

  const pointSize = (opts.pointSize ?? 5) * dpr;
  const pointOpacity = opts.pointOpacity ?? 0.85;

  let entries: ChainEntry[] = [];
  const buildEntries = (): void => {
    for (const e of entries) e.buf.destroy();
    entries = data.chains.map((c, i) => {
      const len = c.normX.length;
      const pos = new Float32Array(len * 3);
      const nx = Float32Array.from(c.normX);
      const ny = Float32Array.from(c.normY);
      const nz = Float32Array.from(c.normZ);
      for (let k = 0; k < len; k++) {
        pos[k * 3] = nx[k] ?? 0;
        pos[k * 3 + 1] = ny[k] ?? 0;
        pos[k * 3 + 2] = nz[k] ?? 0;
      }
      return {
        buf: regl.buffer({ data: pos, type: "float" }),
        count: len,
        chain: c.chain ?? i,
        color: hexToVec4(chainColor(colors, c.chain ?? i), pointOpacity),
        visible: !hidden.has(c.chain ?? i),
        normX: nx,
        normY: ny,
        normZ: nz,
        rawX: c.rawX,
        rawY: c.rawY,
        rawZ: c.rawZ,
      };
    });
  };
  buildEntries();

  let currentMvp: Float32Array | null = null;

  const frameHandle = regl.frame((ctx) => {
    const w = ctx.drawingBufferWidth;
    const h = ctx.drawingBufferHeight;
    const [ex, ey, ez] = getEye();
    const aspect = w > 0 && h > 0 ? w / h : 1;
    const mvp = mat4Multiply(mat4Perspective(FOV, aspect, 0.01, 50), mat4LookAt(ex, ey, ez));
    currentMvp = mvp;
    regl.clear({ color: [0, 0, 0, 0], depth: 1 });
    drawAxes({ mvp });
    for (const e of entries) {
      if (e.count === 0 || !e.visible) continue;
      drawPoints({
        position: { buffer: e.buf, size: 3 },
        count: e.count,
        color: e.color,
        mvp,
        pointSize,
      });
    }
  });

  // Pointer interaction: drag orbits, Ctrl/Cmd + wheel zooms.
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  const onDown = (e: PointerEvent): void => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent): void => {
    if (!dragging) return;
    theta -= (e.clientX - lastX) * 0.012;
    phi = Math.max(-PHI_LIMIT, Math.min(PHI_LIMIT, phi + (e.clientY - lastY) * 0.012));
    lastX = e.clientX;
    lastY = e.clientY;
  };
  const onUp = (): void => {
    dragging = false;
  };
  const onWheel = (e: WheelEvent): void => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setRadius(radius * (1 + e.deltaY * 0.001));
  };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointerleave", onUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });

  // Hover tooltip: CPU-project every visible point via the current MVP and show the
  // nearest within HIT_THRESHOLD CSS px (raw coords, for display).
  const HIT_THRESHOLD = 20;
  target.style.position = target.style.position || "relative";
  const tip = document.createElement("div");
  tip.style.cssText =
    "position:absolute;pointer-events:none;z-index:10;display:none;white-space:nowrap;padding:6px 9px;border-radius:6px;background:rgba(20,22,30,0.92);color:#e8eaf0;font:11px sans-serif;box-shadow:0 4px 16px rgba(0,0,0,0.3);";
  target.appendChild(tip);

  const onHover = (e: MouseEvent): void => {
    const m = currentMvp;
    if (!m || dragging) {
      tip.style.display = "none";
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    let bestDist = HIT_THRESHOLD;
    let best: ChainEntry | null = null;
    let bestIdx = -1;
    for (const entry of entries) {
      if (!entry.visible || entry.count === 0) continue;
      for (let k = 0; k < entry.count; k++) {
        const p = projectPt(
          m,
          entry.normX[k] ?? 0,
          entry.normY[k] ?? 0,
          entry.normZ[k] ?? 0,
          rect.width,
          rect.height,
        );
        if (!p) continue;
        const d = Math.hypot(p[0] - mx, p[1] - my);
        if (d < bestDist) {
          bestDist = d;
          best = entry;
          bestIdx = k;
        }
      }
    }
    if (!best || bestIdx < 0) {
      tip.style.display = "none";
      return;
    }
    const fmt = (v: number): string => (Math.abs(v) >= 0.01 ? v.toFixed(3) : v.toExponential(2));
    tip.textContent = `chain ${best.chain} | ${data.varX} ${fmt(best.rawX[bestIdx] ?? 0)} ${data.varY} ${fmt(best.rawY[bestIdx] ?? 0)} ${data.varZ} ${fmt(best.rawZ[bestIdx] ?? 0)}`;
    tip.style.left = `${mx + 14}px`;
    tip.style.top = `${my}px`;
    tip.style.display = "block";
  };
  const onHoverLeave = (): void => {
    tip.style.display = "none";
  };
  canvas.addEventListener("mousemove", onHover);
  canvas.addEventListener("mouseleave", onHoverLeave);

  // Resize: resync the canvas pixel size; regl.poll() updates the viewport.
  const ro = new ResizeObserver(() => {
    const cssW = opts.width ?? (target.clientWidth || width);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(height * dpr);
    regl.poll();
  });
  ro.observe(target);

  return {
    update: () => buildEntries(),
    setSize: (w, h) => {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      regl.poll();
    },
    setChainVisible: (chain, show) => {
      if (show) hidden.delete(chain);
      else hidden.add(chain);
      for (const e of entries) if (e.chain === chain) e.visible = show;
    },
    get canvas() {
      return canvas;
    },
    destroy: () => {
      frameHandle.cancel();
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointerleave", onUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("mousemove", onHover);
      canvas.removeEventListener("mouseleave", onHoverLeave);
      for (const e of entries) e.buf.destroy();
      entries = [];
      axisPosBuf.destroy();
      axisColBuf.destroy();
      regl.destroy();
      canvas.remove();
      tip.remove();
    },
  };
}

/**
 * Project a chain's stored NDC point to CSS pixels via a view-projection matrix.
 * Exposed for hosts that want CPU-side hover hit-testing (nearest projected point).
 */
export function projectScatterPoint(
  mvp: Float32Array,
  nx: number,
  ny: number,
  nz: number,
  cssW: number,
  cssH: number,
): [number, number] | null {
  return projectPt(mvp, nx, ny, nz, cssW, cssH);
}
