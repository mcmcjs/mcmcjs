import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { GraphEdge, GraphElement, GraphNode, UnifiedModelData } from "../src/core/types";
import { graphFromStanAst, parseSexp } from "../src/parse/stan";

interface Fixture {
  key: string;
  name: string;
  data_keys: string[];
  program: string;
  ast: string | null;
}

const fixtures: Fixture[] = JSON.parse(
  readFileSync(join(__dirname, "fixtures/stan-asts.json"), "utf8"),
);
const handDir = join(__dirname, "fixtures/hand");

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`missing ${what}`);
  return value;
}
const fixture = (key: string) =>
  must(
    fixtures.find((f) => f.key === key),
    `fixture ${key}`,
  );
const nodes = (els: GraphElement[]) => els.filter((e): e is GraphNode => e.type === "node");
const edges = (els: GraphElement[]) => els.filter((e): e is GraphEdge => e.type === "edge");
const named = (els: GraphElement[], name: string) =>
  must(
    nodes(els).find((n) => n.name === name),
    `node ${name}`,
  );
const graphOf = (f: Fixture) =>
  graphFromStanAst(must(f.ast ?? undefined, `${f.key} ast`), {
    name: f.name,
    data: Object.fromEntries(f.data_keys.map((k) => [k, 0])),
  });
const edgeNames = (els: GraphElement[]) => {
  const byId = new Map(nodes(els).map((n) => [n.id, n.name]));
  return new Set(edges(els).map((e) => `${byId.get(e.source)} -> ${byId.get(e.target)}`));
};

describe("parseSexp", () => {
  it("reads nested lists and atoms", () => {
    expect(parseSexp("(a (b c) ((d)) e)")).toEqual(["a", ["b", "c"], [["d"]], "e"]);
  });
  it("keeps quoted strings whole and rejects an unbalanced input", () => {
    expect(parseSexp('(x "a (b) c")')).toEqual(["x", '"a (b) c"']);
    expect(() => parseSexp("(a (b")).toThrow(/unbalanced/);
  });
});

describe("graphFromStanAst on every fixture", () => {
  it("has all 17 programs with an AST", () => {
    expect(fixtures).toHaveLength(17);
    expect(fixtures.every((f) => f.ast)).toBe(true);
  });

  for (const f of fixtures) {
    it(`${f.key} yields a well-formed graph`, () => {
      const els = graphOf(f).model.elements ?? [];
      expect(nodes(els).length).toBeGreaterThan(0);
      const ids = new Set(nodes(els).map((n) => n.id));
      expect(ids.size).toBe(nodes(els).length);
      for (const e of edges(els)) {
        expect(ids.has(e.source), e.source).toBe(true);
        expect(ids.has(e.target), e.target).toBe(true);
      }
      const plates = new Set(
        nodes(els)
          .filter((n) => n.nodeType === "plate")
          .map((n) => n.id),
      );
      for (const n of nodes(els)) if (n.parent) expect(plates.has(n.parent), n.name).toBe(true);
    });
  }
});

describe("eight schools", () => {
  const { model, warnings } = graphOf(fixture("eight_schools"));
  const els = model.elements ?? [];

  it("draws the hierarchy: mu and tau feed theta, theta and sigma feed y", () => {
    expect(named(els, "mu").nodeType).toBe("stochastic");
    expect(named(els, "tau").nodeType).toBe("stochastic");
    expect(named(els, "theta").nodeType).toBe("stochastic");
    expect(named(els, "y").nodeType).toBe("observed");
    expect(named(els, "sigma").nodeType).toBe("constant");
    const e = edgeNames(els);
    for (const want of ["mu -> theta", "tau -> theta", "theta -> y", "sigma -> y"])
      expect(e.has(want), want).toBe(true);
  });

  it("puts the vectorised statements in a plate over J", () => {
    const plate = must(
      nodes(els).find((n) => n.nodeType === "plate"),
      "plate",
    );
    expect(plate.loopRange).toBe("1:J");
    expect(named(els, "theta").parent).toBe(plate.id);
    expect(named(els, "y").parent).toBe(plate.id);
    expect(named(els, "theta").indices).toBe(plate.loopVariable);
  });

  it("carries the distribution and parameters as written", () => {
    const theta = named(els, "theta");
    expect(theta.distribution).toBe("normal");
    expect([theta.param1, theta.param2]).toEqual(["mu", "tau"]);
    expect(warnings.filter((w) => !/flat prior/.test(w.message))).toEqual([]);
  });
});

describe("the probe program, one construct at a time", () => {
  const { model, warnings } = graphOf(fixture("probe"));
  const els = model.elements ?? [];

  it("data that is read is a constant; a ~ on data is observed; sizes and bounds are not drawn", () => {
    for (const c of ["g", "x"]) expect(named(els, c).nodeType).toBe("constant");
    expect(named(els, "y").nodeType).toBe("observed");
    // N and K only size declarations and bound loops, as in the hand-drawn BUGS graphs.
    expect(nodes(els).some((n) => n.name === "N" || n.name === "K")).toBe(false);
  });

  it("a for loop is a plate holding its statements", () => {
    const plate = must(
      nodes(els).find((n) => n.nodeType === "plate" && n.loopVariable === "n"),
      "plate n",
    );
    expect(plate.loopRange).toBe("1:N");
    expect(named(els, "y").parent).toBe(plate.id);
    expect(named(els, "y").indices).toBe("n");
  });

  it("an assignment in transformed parameters is deterministic with its equation printed in Stan syntax", () => {
    const m = named(els, "m");
    expect(m.nodeType).toBe("deterministic");
    expect(m.equation).toBe("mu + a[g[n]] * x[n]");
    const e = edgeNames(els);
    for (const want of ["mu -> m", "a -> m", "g -> m", "x -> m", "m -> y", "sigma -> y"])
      expect(e.has(want), want).toBe(true);
  });

  it("a vectorised parameter statement gets a plate inferred from its declared size", () => {
    const a = named(els, "a");
    expect(a.nodeType).toBe("stochastic");
    const plate = must(
      nodes(els).find((n) => n.id === a.parent),
      "plate for a",
    );
    expect(plate.loopRange).toBe("1:K");
    expect(a.indices).toBe(plate.loopVariable);
  });

  it("a generated quantity with an initial value is deterministic", () => {
    expect(named(els, "s2").nodeType).toBe("deterministic");
    expect(named(els, "s2").equation).toBe("sigma ^ 2");
  });

  it("target += is reported, not drawn", () => {
    expect(warnings.some((w) => /target \+=/.test(w.message))).toBe(true);
    expect(nodes(els).some((n) => /target/.test(n.name))).toBe(false);
  });
});

describe("round trip from the bundled graphs through the Stan codegen", () => {
  // generateStanModel(G) parsed back must contain every node and edge of G.
  // Types may differ (the codegen puts deterministic nodes in transformed
  // parameters, data becomes observed), so this checks names and edges.
  const hand = [
    "blockers",
    "dyes",
    "epil",
    "equiv",
    "kidney",
    "mice",
    "oxford",
    "pumps",
    "rats",
    "salm",
    "seeds",
    "surgical",
  ];
  for (const key of hand) {
    it(`${key}: every node and edge of the drawn graph is present`, () => {
      const drawn: UnifiedModelData = JSON.parse(
        readFileSync(join(handDir, `${key}.json`), "utf8"),
      );
      const source = drawn.elements ?? [];
      const back = graphOf(fixture(key)).model.elements ?? [];
      // Stan identifiers cannot contain dots, so the codegen writes tau.c as tau_c.
      const stanName = (s: string) => s.replace(/\./g, "_");
      const names = new Set(nodes(back).map((n) => n.name));
      for (const n of nodes(source)) {
        if (n.nodeType === "plate") continue;
        expect(names.has(stanName(n.name)), n.name).toBe(true);
      }
      const e = edgeNames(back);
      for (const want of edgeNames(source)) expect(e.has(stanName(want)), want).toBe(true);
    });
  }
});
