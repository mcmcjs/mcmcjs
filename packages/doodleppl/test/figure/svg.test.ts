import { describe, expect, it } from "vitest";
import { figureLayout } from "../../src/figure/layout";
import { figureSvg, layoutToSvg } from "../../src/figure/svg";
import { hospitals } from "./helpers";

const PX = 96 / 2.54;

const attrs = (tag: string) =>
  Object.fromEntries([...tag.matchAll(/([A-Za-z0-9-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));

describe("figureSvg", () => {
  const layout = figureLayout(hospitals());
  const svg = layoutToSvg(layout);

  it("is one standalone black-and-white SVG", () => {
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
    const colours = new Set(
      [...svg.matchAll(/(?:fill|stroke)="(#[0-9a-f]{3,6})"/g)].map((m) => m[1]),
    );
    for (const c of colours) expect(["#000", "#fff", "#ccc", "#666"]).toContain(c);
  });

  it("draws the node kinds differently", () => {
    // Four plain circles, one shaded observed circle, two rings for the deterministic node.
    expect(svg.match(/<circle [^>]*fill="#fff"/g)).toHaveLength(4);
    expect(svg.match(/<circle [^>]*fill="#ccc"/g)).toHaveLength(1);
    expect(svg.match(/<circle [^>]*fill="none"/g)).toHaveLength(1);
    // The plate outline plus the constant's square, besides the page background.
    expect(svg.match(/<rect [^>]*stroke=/g)).toHaveLength(2);
  });

  it("sets Greek names as letters and indices as subscripts", () => {
    expect(svg).toContain('<tspan font-style="italic">μ</tspan>');
    expect(svg).toMatch(
      /<tspan font-style="italic">b<\/tspan><tspan dy="0.3em" font-size="70%"><tspan font-style="italic">i<\/tspan><\/tspan>/,
    );
    expect(svg).toContain("= 1, …, ");
  });

  it("ends every arrow on the outline of the node it points at", () => {
    // Lines come out in edge order, so each line can be checked against its target.
    const lines = (svg.match(/<line [^>]*>/g) ?? []).map(attrs);
    expect(lines).toHaveLength(layout.edges.length);
    layout.edges.forEach((edge, i) => {
      const target = layout.nodes.find((n) => n.id === edge.to) as (typeof layout.nodes)[number];
      const line = lines[i] as Record<string, string>;
      const d = Math.hypot(Number(line.x2) - target.x * PX, Number(line.y2) - target.y * PX);
      const radius = (layout.nodeSize * PX) / 2;
      if (target.kind === "deterministic") expect(d, edge.to).toBeCloseTo(radius + 1.5, 1);
      else if (target.kind !== "constant") expect(d, edge.to).toBeCloseTo(radius, 1);
    });
  });

  it("widens a box to fit a long name", () => {
    const doc = hospitals();
    const n = doc.elements?.find((el) => el.id === "n");
    if (n) n.name = "population";
    const box = (s: string) => attrs(s.match(/<rect [^>]*stroke="#000"[^>]*>/)?.[0] ?? "");
    const wide = figureSvg(doc);
    const short = box(svg);
    const long = box(wide);
    expect(short.width).toBe(short.height);
    expect(Number(long.width)).toBeGreaterThan(Number(long.height));
    expect(long.height).toBe(short.height);
    // The canvas grows so the wider box is not cut off.
    const [vx, , vw] = (attrs(wide.slice(0, wide.indexOf(">"))).viewBox ?? "")
      .split(" ")
      .map(Number);
    expect(Number(long.x)).toBeGreaterThanOrEqual(vx as number);
    expect(Number(long.x) + Number(long.width)).toBeLessThanOrEqual(
      (vx as number) + (vw as number),
    );
  });

  it("escapes the graph name", () => {
    const doc = { ...hospitals(), name: "A < B & C" };
    expect(figureSvg(doc)).toContain("<title>A &lt; B &amp; C</title>");
  });
});
