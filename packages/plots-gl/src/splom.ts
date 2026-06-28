/**
 * Interactive scatter-plot matrix (SPLOM) backed by regl (WebGL) for the lower
 * triangle and Canvas2D for the diagonal and upper triangle. The diagonal draws
 * each variable's 1-D KDE curve, the upper triangle a correlation-tinted cell with
 * Pearson r and Spearman rho, and the lower triangle a per-cell WebGL scatter using
 * regl scissor + viewport boxes so each cell clips to its rectangle. Numerics come
 * from `splomData` in `@mcmcjs/plots`.
 */
import type { SplomData } from "@mcmcjs/plots";
import {
  chainColor,
  DEFAULT_CHAIN_COLORS,
  type GlMountOptions,
  type GlPlotHandle,
  hexToVec4,
  type Regl,
  resolveRegl,
} from "./common";

export interface SplomGlOptions extends GlMountOptions {
  /** Pixel size of each matrix cell (default 220). */
  cellSize?: number;
  /** Marker radius in device pixels (default 3). */
  pointSize?: number;
  /** Marker opacity in [0, 1] (default 0.55). */
  pointOpacity?: number;
}

const VERT = `
  precision mediump float;
  attribute vec2 aPosition;
  uniform float uPointSize;
  void main() { gl_Position = vec4(aPosition, 0.0, 1.0); gl_PointSize = uPointSize; }`;

const FRAG = `
  precision mediump float;
  uniform vec4 uColor;
  void main() {
    if (length(gl_PointCoord - vec2(0.5)) > 0.5) discard;
    gl_FragColor = uColor;
  }`;

const BLEND = {
  enable: true,
  func: { srcRGB: "src alpha", dstRGB: "one minus src alpha", srcAlpha: 1, dstAlpha: 1 },
} as const;

interface CellChainBuffer {
  chain: number;
  buf: ReturnType<Regl["buffer"]>;
  count: number;
  color: [number, number, number, number];
}

interface CellGpu {
  row: number;
  col: number;
  chains: CellChainBuffer[];
}

/** Mount an interactive SPLOM into `target`. */
export async function mountSplom(
  target: HTMLElement,
  data: SplomData,
  opts: SplomGlOptions = {},
): Promise<GlPlotHandle> {
  const createRegl = await resolveRegl(opts);
  const colors = opts.chainColors ?? DEFAULT_CHAIN_COLORS;
  const hidden = new Set<number>(opts.hiddenChains ?? []);
  const dpr = globalThis.devicePixelRatio || 1;
  const N = data.vars.length;
  const cellSize = opts.cellSize ?? 220;
  const gap = 6;
  const totalSize = N * cellSize + (N > 1 ? (N - 1) * gap : 0);

  target.style.position = target.style.position || "relative";

  // Canvas2D layer for the diagonal KDE curves and upper-triangle correlation cells.
  const overlay = document.createElement("canvas");
  overlay.width = Math.round(totalSize * dpr);
  overlay.height = Math.round(totalSize * dpr);
  overlay.style.cssText = `position:absolute;top:0;left:0;width:${totalSize}px;height:${totalSize}px;`;
  target.appendChild(overlay);

  // WebGL canvas for the lower-triangle scatter (drawn on top, transparent elsewhere).
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(totalSize * dpr);
  canvas.height = Math.round(totalSize * dpr);
  canvas.style.cssText = `position:absolute;top:0;left:0;width:${totalSize}px;height:${totalSize}px;pointer-events:none;`;
  target.appendChild(canvas);

  const regl = createRegl({
    canvas,
    attributes: { antialias: true, alpha: true, preserveDrawingBuffer: true },
  });

  const drawPoints = regl({
    vert: VERT,
    frag: FRAG,
    attributes: { aPosition: regl.prop<{ position: unknown }, "position">("position") },
    uniforms: {
      uColor: regl.prop<{ color: unknown }, "color">("color"),
      uPointSize: regl.prop<{ pointSize: unknown }, "pointSize">("pointSize"),
    },
    primitive: "points",
    count: regl.prop<{ count: number }, "count">("count"),
    scissor: { enable: true, box: regl.prop<{ scissor: unknown }, "scissor">("scissor") },
    viewport: regl.prop<{ viewport: unknown }, "viewport">("viewport"),
    blend: BLEND,
    depth: { enable: false },
  });

  const pointSize = (opts.pointSize ?? 3) * dpr;
  const pointOpacity = opts.pointOpacity ?? 0.55;

  // Lower-triangle GPU buffers: per cell, per chain, points normalized to [-0.9, 0.9].
  let cells: CellGpu[] = [];
  const buildCells = (): void => {
    for (const cell of cells) for (const ch of cell.chains) ch.buf.destroy();
    cells = [];
    for (const cell of data.cells) {
      const n = Math.min(cell.x.length, cell.y.length, cell.chain.length);
      if (n === 0) continue;
      let minX = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      for (let i = 0; i < n; i++) {
        const xv = cell.x[i] ?? 0;
        const yv = cell.y[i] ?? 0;
        if (xv < minX) minX = xv;
        if (xv > maxX) maxX = xv;
        if (yv < minY) minY = yv;
        if (yv > maxY) maxY = yv;
      }
      const spanX = Math.max(maxX - minX, 1e-9);
      const spanY = Math.max(maxY - minY, 1e-9);

      // Bucket the cell's points by chain index, normalizing to [-0.9, 0.9].
      const byChain = new Map<number, number[]>();
      for (let i = 0; i < n; i++) {
        const ci = cell.chain[i] ?? 0;
        const px = (((cell.x[i] ?? 0) - minX) / spanX) * 2 - 1;
        const py = (((cell.y[i] ?? 0) - minY) / spanY) * 2 - 1;
        const list = byChain.get(ci) ?? [];
        list.push(px * 0.9, py * 0.9);
        byChain.set(ci, list);
      }
      const chains: CellChainBuffer[] = [];
      for (const ci of Array.from(byChain.keys()).sort((a, b) => a - b)) {
        const flat = byChain.get(ci) ?? [];
        const pos = Float32Array.from(flat);
        chains.push({
          chain: ci,
          buf: regl.buffer({ data: pos, type: "float" }),
          count: flat.length / 2,
          color: hexToVec4(chainColor(colors, ci), pointOpacity),
        });
      }
      cells.push({ row: cell.row, col: cell.col, chains });
    }
  };
  buildCells();

  // Canvas2D diagonal KDE + upper-triangle correlation cells.
  const drawOverlay = (): void => {
    const ctx = overlay.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    ctx.scale(dpr, dpr);

    const cellAt = (r: number, c: number): { x: number; y: number } => ({
      x: c * (cellSize + gap),
      y: r * (cellSize + gap),
    });

    // Diagonal: peak-normalized KDE curve per variable.
    data.diagonals.forEach((diag, i) => {
      const { x, y } = cellAt(i, i);
      ctx.strokeStyle = "#cbd5e1";
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, cellSize - 1, cellSize - 1);
      const m = diag.x.length;
      if (m < 2) return;
      const xMin = diag.x[0] ?? 0;
      const xMax = diag.x[m - 1] ?? 1;
      const xSpan = Math.max(xMax - xMin, 1e-9);
      const pad = 8;
      ctx.beginPath();
      for (let k = 0; k < m; k++) {
        const gx = x + pad + (((diag.x[k] ?? 0) - xMin) / xSpan) * (cellSize - 2 * pad);
        const gy = y + cellSize - pad - (diag.density[k] ?? 0) * (cellSize - 2 * pad);
        if (k === 0) ctx.moveTo(gx, gy);
        else ctx.lineTo(gx, gy);
      }
      ctx.strokeStyle = chainColor(colors, 0);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = "#475569";
      ctx.font = "600 12px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(diag.variable, x + cellSize / 2, y + 6, cellSize - 12);
    });

    // Upper triangle: correlation-tinted cell with Pearson r and Spearman rho.
    for (const c of data.corr) {
      const { x, y } = cellAt(c.row, c.col);
      const r = c.pearson;
      const bgRgb = r >= 0 ? "66,133,244" : "234,67,53";
      const bgAlpha = Math.min(Math.abs(r) * 0.45, 0.42);
      ctx.fillStyle = `rgba(${bgRgb},${bgAlpha})`;
      ctx.fillRect(x, y, cellSize, cellSize);
      ctx.strokeStyle = "#cbd5e1";
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, cellSize - 1, cellSize - 1);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = r >= 0 ? "#4285F4" : "#EA4335";
      ctx.font = `700 ${cellSize >= 160 ? 26 : 20}px sans-serif`;
      const rSign = r >= 0 ? "+" : "";
      ctx.fillText(`${rSign}${r.toFixed(3)}`, x + cellSize / 2, y + cellSize / 2 - 8);
      ctx.fillStyle = "#475569";
      ctx.font = "12px sans-serif";
      const rhoSign = c.spearman >= 0 ? "+" : "";
      ctx.fillText(
        `rho = ${rhoSign}${c.spearman.toFixed(3)}`,
        x + cellSize / 2,
        y + cellSize / 2 + 18,
      );
    }

    // Lower-triangle backgrounds (the WebGL canvas draws the points over these).
    for (const cell of data.cells) {
      const { x, y } = cellAt(cell.row, cell.col);
      ctx.strokeStyle = "#cbd5e1";
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, cellSize - 1, cellSize - 1);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  };
  drawOverlay();

  const render = (): void => {
    regl.clear({ color: [0, 0, 0, 0], depth: 1 });
    for (const cell of cells) {
      const px = Math.round(cell.col * (cellSize + gap) * dpr);
      // WebGL y origin is bottom-left; flip from the top-left CSS layout.
      const py = Math.round((totalSize - cell.row * (cellSize + gap) - cellSize) * dpr);
      const pw = Math.round(cellSize * dpr);
      const ph = Math.round(cellSize * dpr);
      const box = { x: px, y: py, width: pw, height: ph };
      for (const ch of cell.chains) {
        if (hidden.has(ch.chain)) continue;
        drawPoints({
          position: { buffer: ch.buf, size: 2 },
          count: ch.count,
          color: ch.color,
          pointSize,
          viewport: box,
          scissor: box,
        });
      }
    }
  };
  render();

  return {
    update: () => {
      buildCells();
      drawOverlay();
      render();
    },
    setSize: () => {
      // The SPLOM uses a fixed cell grid; resizing is a no-op (re-mount to change cellSize).
    },
    setChainVisible: (chain, show) => {
      if (show) hidden.delete(chain);
      else hidden.add(chain);
      render();
    },
    get canvas() {
      return canvas;
    },
    destroy: () => {
      for (const cell of cells) for (const ch of cell.chains) ch.buf.destroy();
      cells = [];
      regl.destroy();
      canvas.remove();
      overlay.remove();
    },
  };
}
