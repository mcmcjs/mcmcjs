import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import { drawFigure, registerFigure } from "../src/figure";

const GRAPH = JSON.stringify({
  name: "Demo",
  elements: [
    { id: "mu", name: "mu", type: "node", nodeType: "stochastic", position: { x: 0, y: 0 } },
    {
      id: "plate_i",
      name: "Plate i",
      type: "node",
      nodeType: "plate",
      loopVariable: "i",
      loopRange: "1:N",
    },
    {
      id: "y",
      name: "y",
      type: "node",
      nodeType: "observed",
      parent: "plate_i",
      indices: "i",
      position: { x: 0, y: 120 },
    },
    { id: "e1", type: "edge", source: "mu", target: "y" },
  ],
});

function graphFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "mcmc-figure-"));
  const path = join(dir, "demo.json");
  writeFileSync(path, GRAPH);
  return path;
}

async function run(args: string[]): Promise<string> {
  const program = new Command().exitOverride();
  registerFigure(program);
  let out = "";
  const write = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    out += String(chunk);
    return true;
  });
  try {
    await program.parseAsync(["node", "mcmc", "figure", ...args]);
  } finally {
    write.mockRestore();
  }
  return out;
}

afterEach(() => {
  process.exitCode = undefined;
});

describe("drawFigure", () => {
  it("draws TikZ by default and a standalone document on request", () => {
    const path = graphFile();
    const tikz = drawFigure(path, { format: "tikz" });
    expect(tikz).toContain("\\begin{tikzpicture}");
    expect(tikz).toContain("{$\\mu$}");
    expect(tikz).not.toContain("\\documentclass");
    expect(drawFigure(path, { format: "tikz", standalone: true })).toContain("\\documentclass");
  });

  it("draws SVG", () => {
    expect(drawFigure(graphFile(), { format: "svg" })).toMatch(/^<svg /);
  });
});

describe("mcmc figure", () => {
  it("prints the figure to stdout", async () => {
    const out = await run([graphFile()]);
    expect(out).toContain("\\begin{tikzpicture}");
  });

  it("writes the figure to a file with -o", async () => {
    const path = graphFile();
    const target = join(path, "..", "out", "demo.svg");
    const out = await run([path, "--format", "svg", "-o", target]);
    expect(out).toContain(`wrote ${target}`);
    expect(readFileSync(target, "utf8")).toMatch(/^<svg /);
  });

  it("refuses an unknown format", async () => {
    await expect(run([graphFile(), "--format", "pdf"])).rejects.toThrow(/unknown --format "pdf"/);
  });
});
