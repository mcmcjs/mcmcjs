import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { GraphElement, GraphNode } from "../src/core/types";
import { parseBugs } from "../src/parse";
import { applyLayout, layoutGraph, nodeLabel, renderGraphSvg } from "../src/render";

interface Fixture {
  key: string;
  program: string;
  data_keys: string[];
}

const fixtures: Fixture[] = JSON.parse(
  readFileSync(join(__dirname, "fixtures/bugs-programs.json"), "utf8"),
);

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`missing ${what}`);
  return value;
}
const program = (key: string) =>
  must(
    fixtures.find((f) => f.key === key),
    key,
  );
const graphOf = (key: string): GraphElement[] => {
  const f = program(key);
  return parseBugs(f.program, { dataKeys: f.data_keys }).model.elements ?? [];
};

describe("layoutGraph", () => {
  it("places every node and plate with a finite position and size", () => {
    const layout = layoutGraph(graphOf("rats"));
    expect(layout.nodes.length + layout.plates.length).toBe(
      graphOf("rats").filter((e) => e.type === "node").length,
    );
    for (const p of [...layout.nodes, ...layout.plates]) {
      for (const v of [p.x, p.y, p.width, p.height]) expect(Number.isFinite(v)).toBe(true);
      expect(p.width).toBeGreaterThan(0);
      expect(p.height).toBeGreaterThan(0);
    }
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });

  it("a plate encloses each of its members", () => {
    const layout = layoutGraph(graphOf("rats"));
    for (const plate of layout.plates) {
      const members = layout.nodes.filter((n) => n.node.parent === plate.node.id);
      expect(members.length).toBeGreaterThan(0);
      for (const m of members) {
        expect(m.x - m.width / 2).toBeGreaterThanOrEqual(plate.x - plate.width / 2);
        expect(m.x + m.width / 2).toBeLessThanOrEqual(plate.x + plate.width / 2);
        expect(m.y - m.height / 2).toBeGreaterThanOrEqual(plate.y - plate.height / 2);
        expect(m.y + m.height / 2).toBeLessThanOrEqual(plate.y + plate.height / 2);
      }
    }
  });

  it("nested plates come outermost first, and the inner one sits inside the outer", () => {
    const layout = layoutGraph(graphOf("rats"));
    const [outer, inner] = layout.plates;
    expect(inner?.node.parent).toBe(outer?.node.id);
    expect(must(inner, "inner").x - must(inner, "inner").width / 2).toBeGreaterThanOrEqual(
      must(outer, "outer").x - must(outer, "outer").width / 2,
    );
  });

  it("routes every edge, including a self-edge", () => {
    const els = graphOf("eye_tracking");
    const layout = layoutGraph(els);
    expect(layout.edges.length).toBe(els.filter((e) => e.type === "edge").length);
    const self = layout.edges.find((e) => e.edge.source === e.edge.target);
    expect(self, "eye_tracking has a lagged node").toBeDefined();
    expect(must(self, "self edge").points.length).toBeGreaterThan(1);
  });

  it("lays out all 50 examples without throwing", () => {
    for (const f of fixtures) {
      const els = parseBugs(f.program, { dataKeys: f.data_keys }).model.elements ?? [];
      expect(() => layoutGraph(els), f.key).not.toThrow();
    }
  });

  it("applyLayout writes integer positions onto every node", () => {
    const els = graphOf("pumps");
    const placed = applyLayout(els, layoutGraph(els));
    for (const e of placed) {
      if (e.type !== "node") continue;
      const pos = must((e as GraphNode).position, e.id);
      expect(Number.isInteger(pos.x)).toBe(true);
      expect(Number.isInteger(pos.y)).toBe(true);
    }
  });
});

describe("renderGraphSvg", () => {
  const svg = (key: string, theme?: "tokens" | "light" | "dark") =>
    renderGraphSvg(layoutGraph(graphOf(key)), theme ? { theme } : {});

  it("is a single well-formed svg element with a matching viewBox", () => {
    const s = svg("rats");
    expect(s.startsWith("<svg ")).toBe(true);
    expect(s.trimEnd().endsWith("</svg>")).toBe(true);
    const m = /width="(\d+)" height="(\d+)" viewBox="0 0 (\d+) (\d+)"/.exec(s);
    expect(m?.[1]).toBe(m?.[3]);
    expect(m?.[2]).toBe(m?.[4]);
  });

  it("draws one label per node using its name and subscripts", () => {
    const els = graphOf("rats");
    const s = svg("rats");
    for (const n of els) {
      if (n.type !== "node" || n.nodeType === "plate") continue;
      expect(s).toContain(`>${nodeLabel(n)}</text>`);
    }
  });

  it("uses the theme tokens by default and concrete colours for light and dark", () => {
    expect(svg("pumps")).toContain("var(--mcmc-fg,");
    expect(svg("pumps")).toContain("var(--mcmc-bg,");
    expect(svg("pumps", "light")).not.toContain("var(");
    expect(svg("pumps", "dark")).not.toContain("var(");
    expect(svg("pumps", "dark")).toContain("#1b1b1b");
  });

  it("distinguishes node kinds: shaded observed, dashed deterministic, boxed constants", () => {
    const s = svg("rats", "light");
    expect(s).toMatch(/<ellipse[^>]*fill="#dcdcdc"/);
    expect(s).toMatch(/<ellipse[^>]*stroke-dasharray/);
    expect(s).toMatch(/<rect[^>]*stroke="#222"/);
  });

  it("labels each plate with its loop", () => {
    expect(svg("rats")).toContain("for i in 1:N");
    expect(svg("rats")).toContain("for j in 1:T");
  });

  it("escapes names that would break markup", () => {
    const els = parseBugs("model { a.b ~ dnorm(0, 1)\n c <- a.b < 2 }").model.elements ?? [];
    const s = renderGraphSvg(layoutGraph(els));
    expect(s).not.toContain("<2");
    expect(s).toContain("a.b");
  });
});
