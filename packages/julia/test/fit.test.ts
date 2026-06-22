import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResolvedSpec } from "@mcmcjs/core";
import type { FitRunner } from "@mcmcjs/engine";
import { describe, expect, it } from "vitest";
import { runFit } from "../src/fit";

const SAMPLES = JSON.stringify({
  size: [2, 1, 1],
  value_flat: [0.1, 0.2],
  parameters: ["mu"],
  name_map: { parameters: ["mu"], internals: [] },
});

const PROVENANCE = JSON.stringify({
  julia_version: "1.12.6",
  packages: { Turing: "0.45.0" },
  manifest_sha256: "deadbeef",
});

function spec(): ResolvedSpec {
  return {
    schema_version: "0",
    backend: { id: "turing", runtime: "julia", version: "release" },
    model: { kind: "file", path: "./m.jl", entry: "build_model" },
    sampler: { algorithm: "NUTS", draws: 2, warmup: 1, chains: 1, adapt_delta: 0.8 },
    data: { J: 8 },
    output: { format: "mcmcchains-json" },
    seed: 42,
    specPath: "/x/m.toml",
    modelPath: "/x/m.jl",
    specHash: "abc123",
  };
}

const out = (): string => join(mkdtempSync(join(tmpdir(), "mcmcjs-fit-test-")), "out.json");

describe("runFit", () => {
  it("writes a samples file and run record, and reports ok", async () => {
    const outPath = out();
    let argv: string[] = [];
    let request: Record<string, unknown> = {};
    // The request file only exists while the driver runs; read it like the driver would.
    const spawn: FitRunner = async (_command, args) => {
      argv = args;
      request = JSON.parse(readFileSync(args.at(-1) as string, "utf8"));
      writeFileSync(outPath, SAMPLES);
      return { stdout: PROVENANCE, stderr: "", code: 0 };
    };
    const result = await runFit(
      spec(),
      { command: "/bin/julia", args: [] },
      { spawn, projectDir: "/proj", outPath },
    );

    expect(result.status).toBe("ok");
    expect(result.runtimeActual).toBe("1.12.6");
    expect(argv).toContain("--project=/proj");
    expect(argv.some((a) => a.endsWith("driver.jl"))).toBe(true);
    expect(argv.at(-1)?.endsWith("request.json")).toBe(true);
    expect(existsSync(argv.at(-1) as string)).toBe(false);

    expect(request.backend).toEqual({ id: "turing" });
    expect(request.model).toEqual({ file: "/x/m.jl", entry: "build_model" });
    expect(request.seed).toBe(42);
    expect(request.out).toBe(outPath);
    expect(request.data).toEqual({ J: 8 });

    const record = JSON.parse(readFileSync(`${outPath}.run.json`, "utf8"));
    expect(record.schema_version).toBe("0");
    expect(record.spec_hash).toBe("abc123");
    expect(record.runtime.actual).toBe("1.12.6");
    expect(record.packages.Turing).toBe("0.45.0");
  });

  it("reports the driver stage and message on failure", async () => {
    const outPath = out();
    const spawn: FitRunner = async () => ({
      stdout: "",
      stderr: JSON.stringify({ error: "model failed to compile", stage: "compile" }),
      code: 1,
    });
    const result = await runFit(
      spec(),
      { command: "/bin/julia", args: [] },
      { spawn, projectDir: "/proj", outPath },
    );

    expect(result.status).toBe("error");
    expect(result.stage).toBe("compile");
    expect(result.error).toContain("model failed");
    expect(existsSync(`${outPath}.run.json`)).toBe(false);
  });

  it("errors when the driver exits cleanly but writes no artifact", async () => {
    const outPath = out();
    const spawn: FitRunner = async () => ({ stdout: PROVENANCE, stderr: "", code: 0 });
    const result = await runFit(
      spec(),
      { command: "/bin/julia", args: [] },
      { spawn, projectDir: "/proj", outPath },
    );
    expect(result.status).toBe("error");
    expect(existsSync(`${outPath}.run.json`)).toBe(false);
  });

  it("reports cancelled when the runner returns cancelled, and passes the signal through", async () => {
    const outPath = out();
    const controller = new AbortController();
    let sawSignal: AbortSignal | undefined;
    const spawn: FitRunner = async (_command, _args, opts) => {
      sawSignal = opts?.signal;
      return { stdout: "", stderr: "", code: 1, cancelled: true };
    };
    const result = await runFit(
      spec(),
      { command: "/bin/julia", args: [] },
      { spawn, projectDir: "/proj", outPath, signal: controller.signal },
    );
    expect(result.status).toBe("cancelled");
    expect(sawSignal).toBe(controller.signal);
    expect(existsSync(`${outPath}.run.json`)).toBe(false);
  });

  it("reports cancelled without spawning when the signal is already aborted", async () => {
    const outPath = out();
    let spawned = false;
    const spawn: FitRunner = async () => {
      spawned = true;
      return { stdout: "", stderr: "", code: 0 };
    };
    const result = await runFit(
      spec(),
      { command: "/bin/julia", args: [] },
      { spawn, projectDir: "/proj", outPath, signal: AbortSignal.abort() },
    );
    expect(result.status).toBe("cancelled");
    expect(spawned).toBe(false);
  });

  it("errors at the write stage when the artifact does not parse", async () => {
    const outPath = out();
    const spawn: FitRunner = async () => {
      writeFileSync(outPath, "{not valid mcmcchains}");
      return { stdout: PROVENANCE, stderr: "", code: 0 };
    };
    const result = await runFit(
      spec(),
      { command: "/bin/julia", args: [] },
      { spawn, projectDir: "/proj", outPath },
    );
    expect(result.status).toBe("error");
    expect(result.stage).toBe("write");
    expect(result.error).toMatch(/did not parse/);
  });
});
