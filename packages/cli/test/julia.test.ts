import { createRunner, type EngineContext } from "@mcmcjs/engine";
import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { formatVersions, registerJulia } from "../src/julia";

describe("registerJulia --json wiring", () => {
  it("keeps --json off the julia parent so it reaches the version subcommands", () => {
    // A parent `--json` option is consumed at the julia level and never reaches
    // the dispatched subcommand, silently breaking `mcmc julia version * --json`.
    const program = new Command();
    const ctx: EngineContext = { run: createRunner(), platform: process.platform };
    registerJulia(program, ctx);
    const julia = program.commands.find((c) => c.name() === "julia");
    expect(julia).toBeDefined();
    expect(julia?.options.some((o) => o.long === "--json")).toBe(false);
    // version and its status default own --json so the flag forwards to them.
    const version = julia?.commands.find((c) => c.name() === "version");
    const status = version?.commands.find((c) => c.name() === "status");
    expect(status?.options.some((o) => o.long === "--json")).toBe(true);
  });
});

describe("formatVersions", () => {
  it("marks the default and lists each installed version", () => {
    const out = formatVersions([
      { id: "release", version: "1.12.6", path: "/x/release", isDefault: true },
      { id: "1.10", version: "1.10.5", path: "/x/1.10", isDefault: false },
    ]);
    expect(out).toContain("release");
    expect(out).toContain("1.10.5");
    expect(out).toContain("*");
  });

  it("guides the user when nothing is installed", () => {
    expect(formatVersions([])).toContain("mcmc julia version add");
  });
});
