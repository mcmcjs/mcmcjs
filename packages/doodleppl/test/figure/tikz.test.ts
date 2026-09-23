import { describe, expect, it } from "vitest";
import { figureTikz } from "../../src/figure/tikz";
import { hospitals, nested } from "./helpers";

describe("figureTikz", () => {
  const tikz = figureTikz(hospitals());

  it("draws each node with the style of its kind and a typeset label", () => {
    expect(tikz).toMatch(/\\node\[stochastic\] \(n\d+\) at \([\d.-]+,[\d.-]+\) \{\$\\mu\$\};/);
    expect(tikz).toMatch(/\\node\[deterministic\] \(n\d+\) at .* \{\$p_\{i\}\$\};/);
    expect(tikz).toMatch(/\\node\[constant\] \(n\d+\) at .* \{\$n_\{i\}\$\};/);
    expect(tikz).toMatch(/\\node\[observed\] \(n\d+\) at .* \{\$r_\{i\}\$\};/);
  });

  it("draws one arrow per edge between the generated node names", () => {
    const arrows = tikz.match(/\\draw\[edge\] \(n\d+\) -- \(n\d+\);/g) ?? [];
    expect(arrows).toHaveLength(5);
  });

  it("labels a plate with its loop", () => {
    expect(tikz).toMatch(/\\draw\[plate\] \([\d.-]+,[\d.-]+\) rectangle \([\d.-]+,[\d.-]+\);/);
    expect(tikz).toContain("{$i = 1, \\ldots, N$}");
  });

  it("flips the y axis, so a parent above its child in the editor stays above it", () => {
    const y = (label: string) =>
      Number(new RegExp(`at \\([\\d.-]+,([\\d.-]+)\\) \\{\\$${label}\\$\\}`).exec(tikz)?.[1]);
    expect(y("\\\\mu")).toBeGreaterThan(y("b_\\{i\\}"));
  });

  it("never uses a document id with a dot as a TikZ node name", () => {
    const out = figureTikz(nested());
    expect(out).not.toContain("node_alpha.c");
    expect(out).toContain("{$\\alpha_{c}$}");
    expect(out).toContain("{$j = 1, \\ldots, T$}");
  });

  it("is a bare picture by default and a compilable document with standalone", () => {
    expect(tikz.trimStart().startsWith("%")).toBe(true);
    expect(tikz).not.toContain("\\documentclass");
    const doc = figureTikz(hospitals(), { standalone: true });
    expect(doc.startsWith("\\documentclass[tikz,border=4pt]{standalone}")).toBe(true);
    expect(doc).toContain("\\usetikzlibrary{arrows.meta}");
    expect(doc.trimEnd().endsWith("\\end{document}")).toBe(true);
  });
});
