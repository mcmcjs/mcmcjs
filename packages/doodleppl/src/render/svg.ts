// Draw a laid-out graph as SVG, in the WinBUGS Doodle idiom: stochastic nodes
// are ellipses, observed ones shaded, deterministic ones dashed, constants
// rectangles; plates are rounded boxes labelled with their loop.

import type { Layout, PlacedNode, Point } from "./layout";
import { nodeLabel } from "./layout";

export type SvgTheme = "tokens" | "light" | "dark";

export interface SvgOptions {
  /**
   * `tokens` (default) colours through `var(--mcmc-fg)` and `var(--mcmc-bg)`,
   * so a page themes the drawing with CSS. A rasterizer cannot resolve those,
   * so PNG output picks `light` or `dark` for concrete colours.
   */
  theme?: SvgTheme;
  fontFamily?: string;
}

interface Palette {
  fg: string;
  bg: string;
  muted: string;
  observed: string;
  plate: string;
}

const palette = (theme: SvgTheme): Palette => {
  if (theme === "light")
    return { fg: "#222", bg: "#fff", muted: "#777", observed: "#dcdcdc", plate: "#f3f3f3" };
  if (theme === "dark")
    return {
      fg: "#e6e6e6",
      bg: "#1b1b1b",
      muted: "#9a9a9a",
      observed: "#3a3a3a",
      plate: "#262626",
    };
  return {
    fg: "var(--mcmc-fg,#222)",
    bg: "var(--mcmc-bg,#fff)",
    muted: "var(--mcmc-muted,#777)",
    observed: "var(--mcmc-observed,#dcdcdc)",
    plate: "var(--mcmc-plate,#f3f3f3)",
  };
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const f = (n: number) => n.toFixed(1);

function shape(p: PlacedNode, c: Palette): string {
  const { node } = p;
  const rx = p.width / 2;
  const ry = p.height / 2;
  if (node.nodeType === "constant") {
    return `<rect x="${f(p.x - rx)}" y="${f(p.y - ry)}" width="${f(p.width)}" height="${f(p.height)}" fill="${c.bg}" stroke="${c.fg}" stroke-width="1.5"/>`;
  }
  const fill = node.nodeType === "observed" ? c.observed : c.bg;
  const dash = node.nodeType === "deterministic" ? ' stroke-dasharray="5 3"' : "";
  return `<ellipse cx="${f(p.x)}" cy="${f(p.y)}" rx="${f(rx)}" ry="${f(ry)}" fill="${fill}" stroke="${c.fg}" stroke-width="1.5"${dash}/>`;
}

function path(points: Point[]): string {
  if (points.length === 0) return "";
  const [first, ...rest] = points;
  if (!first) return "";
  return `M ${f(first.x)} ${f(first.y)} ${rest.map((q) => `L ${f(q.x)} ${f(q.y)}`).join(" ")}`;
}

export function renderGraphSvg(layout: Layout, options: SvgOptions = {}): string {
  const c = palette(options.theme ?? "tokens");
  const font = options.fontFamily ?? "system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  const w = Math.ceil(layout.width);
  const h = Math.ceil(layout.height);
  const deterministic = new Set(
    layout.nodes.filter((n) => n.node.nodeType === "deterministic").map((n) => n.node.id),
  );

  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${esc(font)}" font-size="13">`,
  );
  out.push(
    `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${c.fg}"/></marker></defs>`,
  );
  out.push(`<rect width="100%" height="100%" fill="${c.bg}"/>`);

  for (const p of layout.plates) {
    const x = p.x - p.width / 2;
    const y = p.y - p.height / 2;
    out.push(
      `<rect x="${f(x)}" y="${f(y)}" width="${f(p.width)}" height="${f(p.height)}" rx="8" fill="${c.plate}" stroke="${c.muted}" stroke-width="1"/>`,
    );
    const loop = `for ${p.node.loopVariable ?? ""} in ${p.node.loopRange ?? ""}`;
    out.push(
      `<text x="${f(x + p.width - 8)}" y="${f(y + p.height - 8)}" text-anchor="end" fill="${c.muted}" font-size="11">${esc(loop)}</text>`,
    );
  }

  for (const e of layout.edges) {
    const d = path(e.points);
    if (!d) continue;
    const dash = deterministic.has(e.edge.target) ? ' stroke-dasharray="5 3"' : "";
    out.push(
      `<path d="${d}" fill="none" stroke="${c.fg}" stroke-width="1.3" marker-end="url(#arrow)"${dash}/>`,
    );
  }

  for (const p of layout.nodes) {
    out.push(shape(p, c));
    out.push(
      `<text x="${f(p.x)}" y="${f(p.y)}" text-anchor="middle" dominant-baseline="central" fill="${c.fg}">${esc(nodeLabel(p.node))}</text>`,
    );
  }

  out.push("</svg>");
  return `${out.join("\n")}\n`;
}
