import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type GraphOptions, loadGraph, renderGraph } from "../src/graph";

const RATS = `model {
  for (i in 1:N) {
    for (j in 1:T) {
      Y[i, j] ~ dnorm(mu[i, j], tau.c)
      mu[i, j] <- alpha[i] + beta[i] * (x[j] - xbar)
    }
    alpha[i] ~ dnorm(alpha.c, alpha.tau)
    beta[i] ~ dnorm(beta.c, beta.tau)
  }
  tau.c ~ dgamma(0.001, 0.001)
  sigma <- 1 / sqrt(tau.c)
  alpha.c ~ dnorm(0.0, 1.0E-6)
  alpha.tau ~ dgamma(0.001, 0.001)
  beta.c ~ dnorm(0.0, 1.0E-6)
  beta.tau ~ dgamma(0.001, 0.001)
  alpha0 <- alpha.c - xbar * beta.c
}
`;

const opts = (over: Partial<GraphOptions> = {}): GraphOptions => ({
  format: "svg",
  theme: "tokens",
  direction: "TB",
  scale: 1,
  ...over,
});

function write(name: string, text: string): string {
  const dir = mkdtempSync(join(tmpdir(), "mcmc-graph-"));
  const file = join(dir, name);
  writeFileSync(file, text);
  return file;
}

describe("loadGraph", () => {
  it("parses a BUGS file and names the model after it", () => {
    const { model, warnings } = loadGraph(write("rats.bugs", RATS), ["Y", "x", "xbar", "N", "T"]);
    expect(model.name).toBe("rats");
    expect(warnings).toEqual([]);
    const y = model.elements?.find((e) => e.type === "node" && e.name === "Y");
    expect(y && "nodeType" in y ? y.nodeType : undefined).toBe("observed");
  });

  it("reads a graph document as-is when given .json", () => {
    const doc = { name: "Demo", elements: [] };
    const { model } = loadGraph(write("demo.json", JSON.stringify(doc)));
    expect(model).toEqual(doc);
  });

  it("surfaces the parser's warnings", () => {
    const { warnings } = loadGraph(write("t.bugs", "model { x ~ dnorm(0, 1) T(0, ) }"));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toMatch(/T\(\.\.\.\)/);
  });
});

describe("renderGraph", () => {
  const model = () => loadGraph(write("rats.bugs", RATS), ["Y", "x", "xbar", "N", "T"]).model;

  it("svg: a themed drawing with a label per node and a plate per loop", async () => {
    const svg = (await renderGraph(model(), opts())) as string;
    expect(svg).toMatch(/^<svg /);
    expect(svg).toContain("var(--mcmc-fg,");
    for (const label of ["alpha[i]", "Y[i, j]", "alpha0", "xbar"])
      expect(svg).toContain(`>${label}</text>`);
    expect(svg).toContain("for i in 1:N");
    expect(svg).toContain("for j in 1:T");
  });

  it("json: the same document with a position on every node", async () => {
    const out = JSON.parse((await renderGraph(model(), opts({ format: "json" }))) as string);
    expect(out.name).toBe("rats");
    for (const e of out.elements) if (e.type === "node") expect(e.position).toBeDefined();
  });

  it("png: rasterizes when the optional binding is present, otherwise says how to get one", async () => {
    let available = true;
    try {
      await import("@resvg/resvg-js");
    } catch {
      available = false;
    }
    const run = renderGraph(model(), opts({ format: "png", scale: 1 }));
    if (available) {
      const png = (await run) as Uint8Array;
      // PNG signature.
      expect([...png.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    } else {
      await expect(run).rejects.toThrow(/--format svg/);
    }
  });

  it("png uses concrete colours, never CSS variables", async () => {
    // The rasterizer path picks a concrete theme; check the SVG it would rasterize.
    const svg = (await renderGraph(model(), opts({ theme: "light" }))) as string;
    expect(svg).not.toContain("var(");
  });
});
