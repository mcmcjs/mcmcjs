import { axisFrame, DotCanvas, extent, fmtNum, linearScale, niceDomain } from "@mcmcjs/charts";
import type { ForestData, TerminalOptions, TraceData } from "./types";

const identity = (text: string): string => text;
const GUTTER = 8;

/** Renders a trace plot (one line per chain) as colored terminal text. */
export function renderTraceTerminal(data: TraceData, opts: TerminalOptions = {}): string {
  const charset = opts.charset ?? "unicode";
  const color = opts.color ?? identity;
  const totalWidth = opts.width ?? 72;
  const height = opts.height ?? 12;
  const plotW = Math.max(8, totalWidth - GUTTER - 2);

  const [rawMin, rawMax] = extent(data.chains.flat());
  const [ymin, ymax] = niceDomain(rawMin, rawMax);
  const canvas = new DotCanvas(plotW, height);
  const scaleX = linearScale([0, Math.max(1, data.nDraws - 1)], [0, canvas.wDots - 1]);
  const scaleY = linearScale([ymin, ymax], [canvas.hDots - 1, 0]);

  data.chains.forEach((series, chain) => {
    for (let i = 1; i < series.length; i++) {
      const prev = series[i - 1];
      const cur = series[i];
      if (prev === undefined || cur === undefined) continue;
      canvas.line(scaleX.map(i - 1), scaleY.map(prev), scaleX.map(i), scaleY.map(cur), chain);
    }
    const first = series[0];
    if (series.length === 1 && first !== undefined) canvas.set(0, scaleY.map(first), chain);
  });

  const rhatStr = Number.isFinite(data.rhat) ? data.rhat.toFixed(3) : "n/a";
  const essStr = Number.isFinite(data.essBulk) ? String(Math.round(data.essBulk)) : "n/a";
  const header = `${data.variable}   R-hat ${rhatStr}   ESS ${essStr}   (${data.nChains} chains x ${data.nDraws} draws)`;

  return axisFrame(canvas.rows(charset, color), {
    width: plotW,
    yMin: ymin,
    yMax: ymax,
    xLeft: "0",
    xRight: String(data.nDraws),
    charset,
    header,
    gutter: GUTTER,
  });
}

/** Renders a forest plot (point estimate + HDI + IQR per variable) as terminal text. */
export function renderForestTerminal(data: ForestData, opts: TerminalOptions = {}): string {
  const charset = opts.charset ?? "unicode";
  const warn = opts.warn ?? identity;
  const totalWidth = opts.width ?? 72;
  if (data.rows.length === 0) return "(no variables)\n";

  const hdiGlyph = charset === "ascii" ? "-" : "─";
  const iqrGlyph = charset === "ascii" ? "=" : "━";
  const meanGlyph = charset === "ascii" ? "*" : "●";

  const labelW = Math.min(20, Math.max(8, ...data.rows.map((r) => r.variable.length)));
  const annot = data.rows.map(
    (r) => `${fmtNum(r.mean)}  [${fmtNum(r.hdi[0])}, ${fmtNum(r.hdi[1])}]`,
  );
  const annotW = Math.max(...annot.map((a) => a.length));
  const axisW = Math.max(12, totalWidth - labelW - annotW - 6);

  let xmin = Number.POSITIVE_INFINITY;
  let xmax = Number.NEGATIVE_INFINITY;
  for (const r of data.rows) {
    xmin = Math.min(xmin, r.hdi[0], r.iqr[0]);
    xmax = Math.max(xmax, r.hdi[1], r.iqr[1]);
  }
  if (!Number.isFinite(xmin) || !Number.isFinite(xmax) || xmin === xmax) {
    xmin = (xmin || 0) - 1;
    xmax = (xmax || 0) + 1;
  }
  const scaleX = linearScale([xmin, xmax], [0, axisW - 1]);
  const col = (v: number): number => Math.max(0, Math.min(axisW - 1, Math.round(scaleX.map(v))));

  const pct = Math.round(data.hdiProb * 100);
  const lines: string[] = [
    `${"parameter".padEnd(labelW)}  ${`mean & ${pct}% HDI`.padEnd(axisW)}  R-hat`,
  ];

  for (let i = 0; i < data.rows.length; i++) {
    const r = data.rows[i];
    if (!r) continue;
    const cells = new Array<string>(axisW).fill(" ");
    const [hl, hh] = [col(r.hdi[0]), col(r.hdi[1])];
    for (let c = hl; c <= hh; c++) cells[c] = hdiGlyph;
    const [il, ih] = [col(r.iqr[0]), col(r.iqr[1])];
    for (let c = il; c <= ih; c++) cells[c] = iqrGlyph;
    cells[col(r.mean)] = meanGlyph;

    const rhatStr = Number.isFinite(r.rhat) ? r.rhat.toFixed(3) : "n/a";
    const rhatCell = r.converged ? rhatStr : warn(`${rhatStr}!`);
    const label = r.variable.length > labelW ? `${r.variable.slice(0, labelW - 1)}…` : r.variable;
    lines.push(`${label.padEnd(labelW)}  ${cells.join("")}  ${rhatCell}   ${annot[i] ?? ""}`);
  }

  return `${lines.join("\n")}\n`;
}
