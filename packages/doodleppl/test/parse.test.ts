import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateBugsModel } from "../src/codegen/bugs";
import type { GraphEdge, GraphElement, GraphNode, UnifiedModelData } from "../src/core/types";
import { validateGraph } from "../src/core/validate";
import { BugsSyntaxError, parseBugs } from "../src/parse";

interface Fixture {
  key: string;
  volume: string;
  name: string;
  program: string;
  data_keys: string[];
  inits_keys: string[];
}

const fixtures: Fixture[] = JSON.parse(
  readFileSync(join(__dirname, "fixtures/bugs-programs.json"), "utf8"),
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
const handDrawn = (name: string): GraphElement[] =>
  (JSON.parse(readFileSync(join(handDir, `${name}.json`), "utf8")) as UnifiedModelData).elements ??
  [];

const nodes = (els: GraphElement[]) => els.filter((e): e is GraphNode => e.type === "node");
const edges = (els: GraphElement[]) => els.filter((e): e is GraphEdge => e.type === "edge");
const named = (els: GraphElement[], name: string) =>
  must(
    nodes(els).find((n) => n.name === name),
    `node ${name}`,
  );
const parsed = (f: Fixture) =>
  parseBugs(f.program, { name: f.name, dataKeys: f.data_keys }).model.elements ?? [];

/**
 * The structure of a graph, independent of ids, positions and plate labels:
 * non-plate nodes keyed by name and subscripts with their type, plates by loop
 * variable, and edges as (source name, target name).
 */
function shape(els: GraphElement[]) {
  const byId = new Map(nodes(els).map((n) => [n.id, n.name]));
  const real = nodes(els).filter((n) => n.nodeType !== "plate");
  // A constant's subscripts are taken from one of its uses, so only its name is structural.
  const label = (n: GraphNode) =>
    n.nodeType === "constant" ? n.name : `${n.name}[${(n.indices ?? "").replace(/\s+/g, "")}]`;
  return {
    names: real.map((n) => n.name).sort(),
    // Hand-drawn graphs have one node per name; generated ones may split a
    // variable by subscript pattern, so the round trip compares by label.
    byName: new Map(real.map((n) => [n.name, n.nodeType])),
    nodes: new Map(real.map((n) => [label(n), n.nodeType])),
    plates: nodes(els)
      .filter((n) => n.nodeType === "plate")
      .map((n) => n.loopVariable)
      .sort(),
    edges: new Set(edges(els).map((e) => `${byId.get(e.source)} -> ${byId.get(e.target)}`)),
  };
}

describe("parseBugs on every registered BUGS example", () => {
  it("has all 50 programs", () => {
    expect(fixtures).toHaveLength(50);
  });

  for (const f of fixtures) {
    it(`${f.volume}.${f.key} parses into a well-formed graph`, () => {
      const els = parsed(f);
      expect(nodes(els).length).toBeGreaterThan(0);
      const ids = new Set(nodes(els).map((n) => n.id));
      expect(ids.size, "node ids are unique").toBe(nodes(els).length);
      for (const e of edges(els)) {
        expect(ids.has(e.source), `edge source ${e.source}`).toBe(true);
        expect(ids.has(e.target), `edge target ${e.target}`).toBe(true);
      }
      const plates = new Set(
        nodes(els)
          .filter((n) => n.nodeType === "plate")
          .map((n) => n.id),
      );
      for (const n of nodes(els))
        if (n.parent) expect(plates.has(n.parent), `${n.name} parent`).toBe(true);
    });
  }

  it("marks a ~ node whose variable is in the data as observed", () => {
    const y = named(parsed(fixture("rats")), "Y");
    expect(y.nodeType).toBe("observed");
    expect(y.observed).toBe(true);
  });
});

describe("parseBugs matches the hand-drawn graphs", () => {
  // These reproduce the hand-drawn graph exactly. The other four differ only by
  // what a person chose to leave out, checked below as a subset.
  const exact = {
    rats: "rats",
    pumps: "pumps",
    seeds: "seeds",
    dyes: "dyes",
    blockers: "blockers",
    salm: "salm",
    equiv: "equiv",
    oxford: "oxford",
    surgical: "surgical_simple",
  };
  const subset = { epil: "epil", mice: "mice", kidney: "kidney" };

  for (const [hand, key] of Object.entries(exact)) {
    it(`${hand}: identical nodes, node types, plates and edges`, () => {
      const a = shape(handDrawn(hand));
      const b = shape(parsed(fixture(key)));
      expect(b.names).toEqual(a.names);
      for (const [name, type] of a.byName) expect(b.byName.get(name), name).toBe(type);
      expect(b.plates).toEqual(a.plates);
      expect([...b.edges].sort()).toEqual([...a.edges].sort());
    });
  }

  for (const [hand, key] of Object.entries(subset)) {
    it(`${hand}: every hand-drawn node and edge is present`, () => {
      const a = shape(handDrawn(hand));
      const b = shape(parsed(fixture(key)));
      for (const name of a.names) expect(b.names, name).toContain(name);
      for (const e of a.edges) expect(b.edges.has(e), e).toBe(true);
    });
  }

  it("covers every hand-drawn fixture", () => {
    const covered = [...Object.keys(exact), ...Object.keys(subset)].map((k) => `${k}.json`).sort();
    expect(readdirSync(handDir).sort()).toEqual(covered);
  });
});

describe("round trip through the codegen", () => {
  // parse -> generate -> parse reaches a fixed point: the generated program has
  // the same graph as the original.
  for (const f of fixtures) {
    it(`${f.key}: the generated program parses to the same graph`, () => {
      const first = parsed(f);
      const second =
        parseBugs(generateBugsModel(first), { dataKeys: f.data_keys }).model.elements ?? [];
      const a = shape(first);
      const b = shape(second);
      expect([...b.nodes.entries()].sort()).toEqual([...a.nodes.entries()].sort());
      expect(b.plates).toEqual(a.plates);
      expect([...b.edges].sort()).toEqual([...a.edges].sort());
    });
  }

  it("passes the graph validator when the data it names is present", () => {
    const rats = fixture("rats");
    const data = Object.fromEntries(rats.data_keys.map((k) => [k, 0]));
    expect(validateGraph(parsed(rats), data)).toEqual([]);
  });
});

describe("syntax the parser must accept", () => {
  const node = (src: string, name: string) => named(parseBugs(src).model.elements ?? [], name);
  const names = (src: string) =>
    nodes(parseBugs(src).model.elements ?? [])
      .map((n) => n.name)
      .sort();

  it("comments, semicolons, and a missing model keyword", () => {
    expect(names("# a comment\nx ~ dnorm(0, 1); y <- x * 2 # trailing\n")).toEqual(["x", "y"]);
  });

  it("scientific notation and dotted names are kept verbatim", () => {
    const n = node("model { alpha.c ~ dnorm(0.0, 1.0E-6) }", "alpha.c");
    expect(n.param1).toBe("0.0");
    expect(n.param2).toBe("1.0E-6");
  });

  it("a link function on the left becomes its inverse on the right", () => {
    expect(node("model { logit(p) <- a + b }", "p").equation).toBe("ilogit(a + b)");
    expect(node("model { log(mu) <- a }", "mu").equation).toBe("exp(a)");
    expect(node("model { cloglog(q) <- a }", "q").equation).toBe("icloglog(a)");
    expect(node("model { probit(r) <- a }", "r").equation).toBe("phi(a)");
  });

  it("censoring fills the censor fields, including an empty upper bound", () => {
    const n = node("model { t ~ dweib(r, mu) C(t.cen, ) }", "t");
    expect(n.censorLower).toBe("t.cen");
    expect(n.censorUpper).toBeUndefined();
    const both = node("model { t ~ dnorm(0, 1) C(lo, hi) }", "t");
    expect([both.censorLower, both.censorUpper]).toEqual(["lo", "hi"]);
  });

  it("truncation is reported, not silently dropped", () => {
    const { warnings } = parseBugs("model { tau ~ dnorm(0, p0) T(0, ) }");
    expect(warnings.map((w) => w.message).join()).toMatch(/T\(\.\.\.\).*dropped/);
  });

  it("empty subscripts, ranges, and computed indices print back as written", () => {
    const n = node(
      "model { for (i in 1:N) { y[i] <- sum(Y[i, ]) + Z[1:j - 1] + mu[group[i], 2] } }",
      "y",
    );
    expect(n.equation).toBe("sum(Y[i, ]) + Z[1:j - 1] + mu[group[i], 2]");
  });

  it("parentheses are preserved from the source", () => {
    expect(node("model { m <- (a + b) * c }", "m").equation).toBe("(a + b) * c");
    expect(node("model { m <- a + (b * c) }", "m").equation).toBe("a + (b * c)");
  });

  it("unary minus and powers", () => {
    expect(node("model { m <- -a^2 }", "m").equation).toBe("-a ^ 2");
    expect(node("model { x ~ dunif(-10, -0.00001) }", "x").param1).toBe("-10");
  });

  it("a variable named true is an ordinary variable", () => {
    expect(names("model { for (i in 1:n) { true[i] ~ dcat(p[]) } }")).toContain("true");
  });

  it("several statements on one line", () => {
    expect(names("model { a ~ dnorm(0, 1) b ~ dnorm(0, 1) c <- a + b }")).toEqual(["a", "b", "c"]);
  });
});

describe("the three complexities", () => {
  it("corner constraints split a variable into a node per subscript pattern", () => {
    const src = "model { alpha[1] <- 0\n for (k in 2:K) { alpha[k] ~ dnorm(0, 1.0E-5) } }";
    const ns = nodes(parseBugs(src).model.elements ?? []).filter((n) => n.name === "alpha");
    expect(ns.map((n) => [n.nodeType, n.indices]).sort()).toEqual([
      ["deterministic", "1"],
      ["stochastic", "k"],
    ]);
  });

  it("a data transform followed by its likelihood is one observed node with both", () => {
    const src = "model { for (i in 1:N) { y[i] <- 1 - Y[i]\n y[i] ~ dbern(p[i]) } }";
    const els = parseBugs(src).model.elements ?? [];
    const y = named(els, "y");
    expect(y.nodeType).toBe("observed");
    expect(y.equation).toBe("1 - Y[i]");
    expect(y.distribution).toBe("dbern");
    expect(generateBugsModel(els)).toMatch(/y\[i\] <- 1 - Y\[i\]\s+y\[i\] ~ dbern\(p\[i\]\)/);
  });

  it("a node that reads itself at another index keeps a self-edge", () => {
    const els = parseBugs("model { for (t in 2:T) { p[t] <- p[t - 1] * q } }").model.elements ?? [];
    const p = named(els, "p");
    expect(edges(els).some((e) => e.source === p.id && e.target === p.id)).toBe(true);
  });

  it("loops over the same variable with different ranges are different plates", () => {
    const src =
      "model { for (k in 1:K) { a[k] ~ dnorm(0, 1) }\n for (k in 2:K) { b[k] ~ dnorm(0, 1) } }";
    const plates = nodes(parseBugs(src).model.elements ?? []).filter((n) => n.nodeType === "plate");
    expect(plates.map((p) => p.loopRange).sort()).toEqual(["1:K", "2:K"]);
  });

  it("nested loops nest their plates", () => {
    const src = "model { for (i in 1:N) { for (j in 1:T) { y[i, j] ~ dnorm(0, 1) } } }";
    const ps = nodes(parseBugs(src).model.elements ?? []).filter((n) => n.nodeType === "plate");
    const outer = must(
      ps.find((p) => p.loopVariable === "i"),
      "plate i",
    );
    const inner = must(
      ps.find((p) => p.loopVariable === "j"),
      "plate j",
    );
    expect(inner.parent).toBe(outer.id);
  });
});

describe("errors", () => {
  it("reports the line of a syntax error", () => {
    const bad = "model {\n  x ~ dnorm(0, 1\n}";
    expect(() => parseBugs(bad)).toThrow(BugsSyntaxError);
    let line = 0;
    try {
      parseBugs(bad);
    } catch (e) {
      line = (e as BugsSyntaxError).line;
    }
    expect(line).toBe(3);
  });

  it("rejects a link function with ~", () => {
    expect(() => parseBugs("model { logit(p) ~ dnorm(0, 1) }")).toThrow(/link/);
  });
});
