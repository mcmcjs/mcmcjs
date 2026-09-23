import type { NodeSingular, StylesheetStyle } from "cytoscape";
import { describe, expect, it } from "vitest";
import { paperStyles } from "../src/widget/composables/paperStyle";

type Style = Record<string, unknown>;

const node = (data: Record<string, unknown>) =>
  ({ data: (key: string) => data[key] }) as unknown as NodeSingular;

const rule = (dark: boolean, selector: string): Style => {
  const found = paperStyles(dark).find((r) => r.selector === selector) as StylesheetStyle;
  return found.style as Style;
};

const call = (style: Style, key: string, ele: NodeSingular) =>
  (style[key] as (e: NodeSingular) => unknown)(ele);

const decode = (url: string) =>
  new TextDecoder().decode(
    Uint8Array.from(atob(url.replace("data:image/svg+xml;base64,", "")), (c) => c.charCodeAt(0)),
  );

describe("paperStyles", () => {
  const nodes = 'node[nodeType != "plate"]';

  it("draws in dark ink on light paper, and light ink on dark paper", () => {
    expect(rule(false, nodes)["border-color"]).toBe("#111111");
    expect(rule(true, nodes)["border-color"]).toBe("#e5e7eb");
    expect(rule(false, "edge")["line-color"]).toBe("#111111");
    expect(rule(false, 'node[nodeType = "observed"], node[?observed]')["background-color"]).toBe(
      "#cccccc",
    );
  });

  it("sets each name as maths in an image instead of a plain label", () => {
    const style = rule(false, nodes);
    expect(style.label).toBe("");
    const svg = decode(
      call(style, "background-image", node({ name: "mu", indices: "i,j" })) as string,
    );
    expect(svg).toContain('<tspan font-style="italic">μ</tspan>');
    expect(svg).toContain('fill="#111111"');
  });

  it("keeps short names in the standard circle and grows it for a long one", () => {
    const style = rule(false, nodes);
    expect(call(style, "width", node({ name: "x", nodeType: "stochastic" }))).toBe(48);
    const long = call(style, "width", node({ name: "population", nodeType: "stochastic" }));
    expect(long as number).toBeGreaterThan(48);
    expect(call(style, "height", node({ name: "population", nodeType: "stochastic" }))).toBe(long);
    const box = node({ name: "population", nodeType: "constant" });
    expect(call(style, "width", box) as number).toBeGreaterThan(
      call(style, "height", box) as number,
    );
  });

  it("writes a plate's loop in its bottom right corner", () => {
    const style = rule(false, 'node[nodeType = "plate"]');
    expect(style["background-position-x"]).toBe("100%");
    expect(style["background-position-y"]).toBe("100%");
    const svg = decode(
      call(style, "background-image", node({ loopVariable: "i", loopRange: "1:N" })) as string,
    );
    expect(svg).toContain("= 1, …, ");
  });
});
