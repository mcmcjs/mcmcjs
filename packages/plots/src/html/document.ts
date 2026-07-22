/**
 * `buildHtmlDocument` emits a single self-contained, dependency-free HTML file:
 * the MIT-licensed uPlot bundle and CSS are inlined, the plot specs are embedded as
 * JSON, and a small bootstrap rehydrates them into interactive charts in the browser
 * (pan/zoom, legend, and per-plot PNG/SVG export). It opens offline with no network.
 */

import { attachSvgTips, SVG_TIPS_CSS } from "@mcmcjs/charts/dom";
import { UPLOT_CSS, UPLOT_JS, UPLOT_VERSION } from "./uplot-assets.generated";
import { type HtmlItem, htmlItemFor, type PlotData } from "./uplot-spec";

export interface HtmlDocumentOptions {
  /** Document and header title. */
  title?: string;
  /** Subtitle line under the header (e.g. the run id). */
  subtitle?: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Embed JSON inside a <script type="application/json"> without it closing the tag early. */
function embedJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

const LIGHT_TOKENS = `
  --mcmc-bg: #ffffff; --mcmc-fg: #111827; --mcmc-muted: #6b7280; --mcmc-grid: #e5e7eb;
  --mcmc-tip-bg: #ffffff; --mcmc-tip-fg: #1a1a1a; --mcmc-tip-border: rgba(0,0,0,0.12);
  --mcmc-axis: #111827; --mcmc-plot-grid: rgba(0,0,0,0.07); --mcmc-fg-soft: rgba(0,0,0,0.5);
  --page-bg: #fafafa; --page-fg: #111; --card-bg: #ffffff; --card-border: #e5e7eb;
  --btn-bg: #f3f4f6; --btn-fg: #111; --btn-border: #d1d5db; --btn-hover: #e5e7eb;
`;
const DARK_TOKENS = `
  --mcmc-bg: #171a21; --mcmc-fg: #e6e6e6; --mcmc-muted: #9ca3af; --mcmc-grid: #2c3340;
  --mcmc-tip-bg: #1c1e2b; --mcmc-tip-fg: #e8eaf0; --mcmc-tip-border: rgba(255,255,255,0.12);
  --mcmc-axis: #e6e6e6; --mcmc-plot-grid: rgba(255,255,255,0.09); --mcmc-fg-soft: rgba(255,255,255,0.55);
  --page-bg: #0f1115; --page-fg: #e6e6e6; --card-bg: #171a21; --card-border: #262b35;
  --btn-bg: #232834; --btn-fg: #e6e6e6; --btn-border: #39414f; --btn-hover: #2c3340;
`;
const THEME_TOKENS = `
:root { ${LIGHT_TOKENS} }
@media (prefers-color-scheme: dark) { :root { ${DARK_TOKENS} } }
:root[data-theme="light"] { ${LIGHT_TOKENS} }
:root[data-theme="dark"] { ${DARK_TOKENS} }
`;

const STYLE = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  margin: 0; padding: 24px;
  font: 14px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  background: var(--page-bg); color: var(--page-fg);
}
header { max-width: 1100px; margin: 0 auto 20px; }
header h1 { font-size: 20px; margin: 0 0 4px; }
header p { margin: 0; color: var(--mcmc-muted); }
main { max-width: 1100px; margin: 0 auto; display: grid; gap: 20px; }
.card { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 10px; overflow: hidden; }
.bar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px; border-bottom: 1px solid var(--card-border);
}
.bar .label { font-weight: 600; font-size: 13px; }
.btn {
  font: inherit; font-size: 12px; cursor: pointer;
  background: var(--btn-bg); color: var(--btn-fg); border: 1px solid var(--btn-border);
  border-radius: 6px; padding: 4px 10px;
}
.btn:hover { background: var(--btn-hover); }
.plot { padding: 12px; overflow-x: auto; }
.plot svg { max-width: 100%; height: auto; }
.u-title { font-weight: 600; }
`;

// Runs in the browser. Plain ES5-ish JS (no template literals, no `${...}`) so it can
// live in a TS template literal verbatim. Reads the embedded specs and mounts charts.
const BOOTSTRAP = `
(function () {
  var DATA = JSON.parse(document.getElementById("mcmc-plot-data").textContent);
  var root = document.getElementById("mcmc-plots");

  function el(tag, cls) { var n = document.createElement(tag); if (cls) n.className = cls; return n; }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = el("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 0);
  }

  function exportCanvas(canvas, filename) {
    var out = el("canvas");
    out.width = canvas.width; out.height = canvas.height;
    var ctx = out.getContext("2d");
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(canvas, 0, 0);
    out.toBlob(function (blob) { downloadBlob(blob, filename); }, "image/png");
  }

  function exportSvg(svg, filename) {
    downloadBlob(new Blob([svg], { type: "image/svg+xml" }), filename);
  }

  function pathFor(spec) {
    if (spec.paths === "bars" && uPlot.paths.bars) return uPlot.paths.bars({ size: [0.85, Infinity] });
    if (spec.paths === "stepped" && uPlot.paths.stepped) return uPlot.paths.stepped({ align: 1 });
    return null;
  }

  function refLinePlugin(refLines) {
    return { hooks: { draw: function (u) {
      var ctx = u.ctx;
      ctx.save();
      ctx.lineWidth = 1;
      for (var i = 0; i < refLines.length; i++) {
        var r = refLines[i];
        ctx.strokeStyle = r.stroke || "#9ca3af";
        ctx.setLineDash(r.dash || [4, 4]);
        var y = Math.round(u.valToPos(r.value, "y", true)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(u.bbox.left, y);
        ctx.lineTo(u.bbox.left + u.bbox.width, y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.restore();
    } } };
  }

  function themeColors() {
    var cs = getComputedStyle(document.documentElement);
    return {
      axis: cs.getPropertyValue("--mcmc-axis").trim() || "#111827",
      grid: cs.getPropertyValue("--mcmc-plot-grid").trim() || "rgba(0,0,0,0.07)"
    };
  }

  function mountUplot(host, spec) {
    var t = themeColors();
    var series = [{}];
    for (var i = 0; i < spec.series.length; i++) {
      var s = spec.series[i];
      var o = { label: s.label, stroke: s.stroke, width: s.width != null ? s.width : 1.5 };
      if (s.fill) o.fill = s.fill;
      if (s.dash) o.dash = s.dash;
      var p = pathFor(s);
      if (p) { o.paths = p; o.points = { show: false }; }
      series.push(o);
    }
    var plugins = [];
    if (spec.refLines && spec.refLines.length) plugins.push(refLinePlugin(spec.refLines));
    function width() { return Math.max(320, host.clientWidth - 24); }
    var opts = {
      width: width(), height: 280,
      scales: { x: { time: false } },
      axes: [
        { label: spec.xLabel || "", stroke: t.axis, grid: { stroke: t.grid }, ticks: { stroke: t.grid } },
        { label: spec.yLabel || "", stroke: t.axis, grid: { stroke: t.grid }, ticks: { stroke: t.grid } }
      ],
      series: series,
      legend: { live: true },
      cursor: { drag: { x: true, y: true, uni: 12 } },
      plugins: plugins
    };
    var u = new uPlot(opts, spec.data, host);
    window.addEventListener("resize", function () { u.setSize({ width: width(), height: 280 }); });
    return u;
  }

  var mounted = [];
  for (var i = 0; i < DATA.items.length; i++) {
    var item = DATA.items[i];
    var card = el("section", "card");
    var bar = el("div", "bar");
    var label = el("span", "label");
    label.textContent = (item.spec ? item.spec.title : item.title) + "  -  " + item.kind;
    var btn = el("button", "btn");
    var plot = el("div", "plot");
    bar.appendChild(label); bar.appendChild(btn);
    card.appendChild(bar); card.appendChild(plot); root.appendChild(card);

    if (item.mode === "uplot") {
      var entry = { host: plot, spec: item.spec, u: mountUplot(plot, item.spec) };
      mounted.push(entry);
      btn.textContent = "Save PNG";
      (function (entry, name) {
        btn.addEventListener("click", function () { exportCanvas(entry.u.ctx.canvas, name); });
      })(entry, "mcmc-" + item.kind + "-" + i + ".png");
    } else {
      plot.innerHTML = item.svg;
      btn.textContent = "Save SVG";
      (function (svg, name) {
        btn.addEventListener("click", function () { exportSvg(svg, name); });
      })(item.svg, "mcmc-" + item.kind + "-" + i + ".svg");
    }
  }

  if (window.__mcmcAttachSvgTips) window.__mcmcAttachSvgTips(root);

  var scheme = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  if (scheme && scheme.addEventListener) {
    scheme.addEventListener("change", function () {
      for (var m = 0; m < mounted.length; m++) {
        mounted[m].u.destroy();
        mounted[m].host.innerHTML = "";
        mounted[m].u = mountUplot(mounted[m].host, mounted[m].spec);
      }
    });
  }
})();
`;

/**
 * Render one or more plot data objects into a complete, offline-capable HTML document.
 * uPlot-friendly kinds become interactive charts; forest and pair plots embed their SVG.
 */
export function buildHtmlDocument(data: PlotData[], opts: HtmlDocumentOptions = {}): string {
  const title = opts.title ?? "MCMC plots";
  const items: HtmlItem[] = data.map(htmlItemFor);
  const safeJs = UPLOT_JS.replace(/<\/script/gi, "<\\/script");
  const subtitle = opts.subtitle
    ? `<p>${escapeHtml(opts.subtitle)}</p>`
    : `<p>${items.length} plot${items.length === 1 ? "" : "s"}, uPlot ${UPLOT_VERSION}</p>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="mcmcjs">
<title>${escapeHtml(title)}</title>
<style>${UPLOT_CSS}</style>
<style>${THEME_TOKENS}</style>
<style>${STYLE}</style>
<style>${SVG_TIPS_CSS}</style>
</head>
<body>
<header>
<h1>${escapeHtml(title)}</h1>
${subtitle}
</header>
<main id="mcmc-plots"></main>
<script type="application/json" id="mcmc-plot-data">${embedJson({ items })}</script>
<script>${safeJs}</script>
<script>window.__mcmcAttachSvgTips = ${attachSvgTips.toString()};</script>
<script>${BOOTSTRAP}</script>
</body>
</html>
`;
}
