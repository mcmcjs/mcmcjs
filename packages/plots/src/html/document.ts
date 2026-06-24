/**
 * `buildHtmlDocument` emits a single self-contained, dependency-free HTML file:
 * the MIT-licensed uPlot bundle and CSS are inlined, the plot specs are embedded as
 * JSON, and a small bootstrap rehydrates them into interactive charts in the browser
 * (pan/zoom, legend, and per-plot PNG/SVG export). It opens offline with no network.
 */

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

const STYLE = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  margin: 0; padding: 24px;
  font: 14px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  background: #fafafa; color: #111;
}
@media (prefers-color-scheme: dark) {
  body { background: #0f1115; color: #e6e6e6; }
  .card { background: #171a21; border-color: #262b35; }
  .bar { border-color: #262b35; }
  .btn { background: #232834; color: #e6e6e6; border-color: #39414f; }
  .btn:hover { background: #2c3340; }
}
header { max-width: 1100px; margin: 0 auto 20px; }
header h1 { font-size: 20px; margin: 0 0 4px; }
header p { margin: 0; color: #6b7280; }
main { max-width: 1100px; margin: 0 auto; display: grid; gap: 20px; }
.card { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden; }
.bar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px; border-bottom: 1px solid #e5e7eb;
}
.bar .label { font-weight: 600; font-size: 13px; }
.btn {
  font: inherit; font-size: 12px; cursor: pointer;
  background: #f3f4f6; color: #111; border: 1px solid #d1d5db;
  border-radius: 6px; padding: 4px 10px;
}
.btn:hover { background: #e5e7eb; }
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

  function mountUplot(host, spec) {
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
    function width() { return Math.max(320, host.clientWidth - 24); }
    var opts = {
      width: width(), height: 280,
      scales: { x: { time: false } },
      axes: [{ label: spec.xLabel || "" }, { label: spec.yLabel || "" }],
      series: series,
      legend: { live: true },
      cursor: { drag: { x: true, y: true, uni: 12 } }
    };
    var u = new uPlot(opts, spec.data, host);
    window.addEventListener("resize", function () { u.setSize({ width: width(), height: 280 }); });
    return u;
  }

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
      var u = mountUplot(plot, item.spec);
      btn.textContent = "Save PNG";
      (function (u, name) {
        btn.addEventListener("click", function () { exportCanvas(u.ctx.canvas, name); });
      })(u, "mcmc-" + item.kind + "-" + i + ".png");
    } else {
      plot.innerHTML = item.svg;
      btn.textContent = "Save SVG";
      (function (svg, name) {
        btn.addEventListener("click", function () { exportSvg(svg, name); });
      })(item.svg, "mcmc-" + item.kind + "-" + i + ".svg");
    }
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
<style>${STYLE}</style>
</head>
<body>
<header>
<h1>${escapeHtml(title)}</h1>
${subtitle}
</header>
<main id="mcmc-plots"></main>
<script type="application/json" id="mcmc-plot-data">${embedJson({ items })}</script>
<script>${safeJs}</script>
<script>${BOOTSTRAP}</script>
</body>
</html>
`;
}
