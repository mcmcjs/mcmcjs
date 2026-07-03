import { createRegistry, type EngineContext } from "@mcmcjs/engine";
import { juliaEngine } from "@mcmcjs/julia";
import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { registerAll } from "../src/register";

// Build the program through the SAME registerAll the CLI uses, so a new command
// added there is exercised here automatically (no duplicated registration list).
function build(): Command {
  const program = new Command();
  const ctx: EngineContext = { run: async () => "", platform: process.platform };
  const registry = createRegistry("julia");
  registry.register(juliaEngine);
  registerAll(program, ctx, registry);
  return program;
}

const GROUPS: Record<string, string> = {
  run: "Run inference:",
  fit: "Run inference:",
  predict: "Run inference:",
  runs: "Inspect runs:",
  show: "Inspect runs:",
  diagnose: "Inspect runs:",
  summary: "Inspect runs:",
  samples: "Inspect runs:",
  plot: "Inspect runs:",
  export: "Inspect runs:",
  init: "Start a project:",
  sandbox: "Start a project:",
  convert: "Start a project:",
  setup: "Toolchain:",
  doctor: "Toolchain:",
  engines: "Toolchain:",
  julia: "Toolchain:",
  stan: "Toolchain:",
  daemon: "Toolchain:",
};

describe("mcmc --help grouping", () => {
  const program = build();
  // Hidden internals (e.g. __update-check) are not in --help; only group the rest.
  const visible = program.commands.filter((c) => !c.name().startsWith("_"));

  it("assigns every visible top-level command to a known functional group", () => {
    expect(visible.length).toBeGreaterThan(0);
    for (const cmd of visible) {
      const name = cmd.name();
      // A new command that forgets .helpGroup() (or a missing GROUPS entry) fails here.
      expect(GROUPS[name], `command '${name}' has no expected help group`).toBeDefined();
      expect(cmd.helpGroup()).toBe(GROUPS[name]);
    }
  });

  it("renders the four section headings, in order", () => {
    const help = program.helpInformation();
    const at = ["Run inference:", "Inspect runs:", "Start a project:", "Toolchain:"].map((h) =>
      help.indexOf(h),
    );
    expect(at.every((i) => i >= 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });
});
