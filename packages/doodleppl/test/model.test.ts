import { describe, expect, it } from "vitest";
import { getElements, parseModelData, parseUnifiedModel } from "../src/core/model";

const GRAPH = JSON.stringify({
  name: "demo",
  elements: [{ id: "mu", name: "mu", type: "node", nodeType: "stochastic" }],
  dataContent: JSON.stringify({ data: { N: 3, y: [1, 2, 3] }, inits: { mu: 0 } }),
  version: 1,
});

describe("parseUnifiedModel", () => {
  it("parses a saved graph", () => {
    const model = parseUnifiedModel(GRAPH);
    expect(model.name).toBe("demo");
    expect(getElements(model)).toHaveLength(1);
  });

  it("reads the legacy graphJSON alias", () => {
    const model = parseUnifiedModel(
      JSON.stringify({
        name: "x",
        graphJSON: [{ id: "a", name: "a", type: "node", nodeType: "constant" }],
      }),
    );
    expect(getElements(model)).toHaveLength(1);
  });

  it("rejects invalid JSON and graphs with no elements", () => {
    expect(() => parseUnifiedModel("{not json")).toThrow(/invalid graph JSON/);
    expect(() => parseUnifiedModel(JSON.stringify({ name: "x", elements: [] }))).toThrow(
      /no elements/,
    );
  });
});

describe("parseModelData", () => {
  it("parses data and inits from the stringified dataContent blob", () => {
    const { data, inits } = parseModelData(parseUnifiedModel(GRAPH));
    expect(data).toEqual({ N: 3, y: [1, 2, 3] });
    expect(inits).toEqual({ mu: 0 });
  });

  it("falls back to legacy inline data/inits", () => {
    const model = { name: "x", elements: [], data: { J: 8 }, inits: { mu: 1 } };
    expect(parseModelData(model)).toEqual({ data: { J: 8 }, inits: { mu: 1 } });
  });

  it("defaults missing parts to empty objects", () => {
    expect(parseModelData({ name: "x", dataContent: JSON.stringify({ data: { N: 1 } }) })).toEqual({
      data: { N: 1 },
      inits: {},
    });
  });
});
