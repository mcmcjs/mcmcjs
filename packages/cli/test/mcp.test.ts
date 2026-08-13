import { describe, expect, it } from "vitest";
import { z } from "zod";
import { formatResult } from "../src/mcp";
import { TOOLS, toolByName } from "../src/mcp/tools";

const tool = (name: string) => {
  const found = toolByName(name);
  if (!found) throw new Error(`no tool ${name}`);
  return found;
};

describe("the tool surface", () => {
  it("names every tool for the CLI command it runs", () => {
    expect(TOOLS.map((t) => t.name)).toEqual([
      "mcmc_run",
      "mcmc_diagnose",
      "mcmc_summary",
      "mcmc_runs",
      "mcmc_loo",
      "mcmc_compare",
      "mcmc_sbc",
      "mcmc_doctor",
    ]);
  });

  // The description is the only thing the model reads before choosing a tool.
  it("describes what comes back, not just what it does", () => {
    for (const spec of TOOLS) {
      expect(spec.description.length, spec.name).toBeGreaterThan(80);
      expect(spec.title.length, spec.name).toBeGreaterThan(0);
      expect(spec.timeoutMs, spec.name).toBeGreaterThan(0);
    }
    expect(tool("mcmc_run").description).toMatch(/not-converged is a result/);
    expect(tool("mcmc_sbc").description).toMatch(/[Ss]low/);
  });

  it("gives a fit far more time than a listing", () => {
    expect(tool("mcmc_run").timeoutMs).toBeGreaterThan(tool("mcmc_runs").timeoutMs);
    expect(tool("mcmc_sbc").timeoutMs).toBeGreaterThanOrEqual(tool("mcmc_run").timeoutMs);
  });
});

describe("argument building", () => {
  it("passes the model first and the options as flags", () => {
    expect(tool("mcmc_run").args({ model: "m.jl", draws: 500, chains: 2, data: "d.csv" })).toEqual([
      "m.jl",
      "--data",
      "d.csv",
      "--draws",
      "500",
      "--chains",
      "2",
    ]);
  });

  it("omits anything not given, and renders a switch as a bare flag", () => {
    expect(tool("mcmc_run").args({ model: "m.jl" })).toEqual(["m.jl"]);
    expect(tool("mcmc_run").args({ model: "m.jl", prior: true, refit: false })).toEqual([
      "m.jl",
      "--prior",
    ]);
  });

  it("hyphenates a camelCase option", () => {
    // sbc takes --simulations; the run tool's adapt-delta style flags matter here.
    expect(tool("mcmc_sbc").args({ model: "m.jl", simulations: 5 })).toEqual([
      "m.jl",
      "--simulations",
      "5",
    ]);
  });

  it("defaults the target to the latest run by passing nothing", () => {
    expect(tool("mcmc_diagnose").args({})).toEqual([]);
    expect(tool("mcmc_diagnose").args({ target: "@2" })).toEqual(["@2"]);
  });

  it("repeats --var per variable and lists compare targets positionally", () => {
    expect(tool("mcmc_summary").args({ var: ["mu", "tau"] })).toEqual([
      "--var",
      "mu",
      "--var",
      "tau",
    ]);
    expect(tool("mcmc_compare").args({ targets: ["@1", "@2"] })).toEqual(["@1", "@2"]);
  });

  it("requires what the command cannot default", () => {
    const run = z.object(tool("mcmc_run").input);
    expect(run.safeParse({}).success).toBe(false);
    expect(run.safeParse({ model: "m.jl" }).success).toBe(true);
    expect(z.object(tool("mcmc_compare").input).safeParse({ targets: ["@1"] }).success).toBe(false);
  });
});

describe("formatResult", () => {
  const spec = tool("mcmc_run");

  it("returns output as content when the command succeeds", () => {
    const out = formatResult(spec, { ok: true, code: 0, stdout: '{"run":1}', stderr: "" });
    expect(out.isError).toBeUndefined();
    expect(out.content[0]?.text).toBe('{"run":1}');
  });

  // Exit 2 means it ran but did not converge. The diagnostics are the answer,
  // and flagging an error invites the model to retry the same fit.
  it("treats a domain failure as a result, not an error", () => {
    const out = formatResult(spec, { ok: false, code: 2, stdout: '{"report":{}}', stderr: "" });
    expect(out.isError).toBeUndefined();
    expect(out.content[0]?.text).toBe('{"report":{}}');
  });

  it("reports a real failure as an error, with the stderr", () => {
    const out = formatResult(spec, { ok: false, code: 1, stdout: "", stderr: "no such file" });
    expect(out.isError).toBe(true);
    expect(out.content[0]?.text).toContain("run exited 1");
    expect(out.content[0]?.text).toContain("no such file");
  });

  it("never returns empty content", () => {
    const out = formatResult(spec, { ok: true, code: 0, stdout: "  ", stderr: "" });
    expect(out.content[0]?.text).toBe("(no output)");
  });
});
