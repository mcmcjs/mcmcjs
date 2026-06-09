import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResolvedSpec } from "@mcmcjs/core";
import type { FitRunner } from "@mcmcjs/engine";
import { describe, expect, it } from "vitest";
import { predictData, runPredict } from "./predict";

const SAMPLES = JSON.stringify({
  size: [1, 1, 1],
  value_flat: [0.5],
  parameters: ["y[1]"],
  name_map: { parameters: ["y[1]"], internals: [] },
});
const PROVENANCE = JSON.stringify({ julia_version: "1.12.6", packages: {}, manifest_sha256: "x" });

function spec(): ResolvedSpec {
  return {
    schema_version: "0",
    backend: { id: "turing", runtime: "julia", version: "release" },
    model: { kind: "file", path: "./m.jl", entry: "build_model" },
    sampler: { algorithm: "NUTS", draws: 1, warmup: 1, chains: 1, adapt_delta: 0.8 },
    data: { J: 2, y: [1, 2], sigma: [1, 1] },
    output: { format: "mcmcchains-json" },
    predict: { targets: ["y"] },
    seed: 42,
    specPath: "/x/m.toml",
    modelPath: "/x/m.jl",
    specHash: "h",
  };
}

const out = (): string => join(mkdtempSync(join(tmpdir(), "mcmcjs-predict-test-")), "ppc.json");

function postFile(): string {
  const path = join(mkdtempSync(join(tmpdir(), "mcmcjs-post-")), "post.json");
  writeFileSync(path, SAMPLES);
  return path;
}

describe("predictData", () => {
  it("blanks a vector target to nulls and keeps the rest", () => {
    const data = predictData(spec());
    expect(data.J).toBe(2);
    expect(data.sigma).toEqual([1, 1]);
    expect(data.y).toEqual([null, null]);
  });

  it("blanks a scalar target to a single null", () => {
    const s = spec();
    s.data = { ...s.data, y: 5 };
    expect(predictData(s).y).toBeNull();
  });

  it("preserves nested shape when blanking a matrix target", () => {
    const s = spec();
    s.data = {
      ...s.data,
      y: [
        [1, 2],
        [3, 4],
      ],
    };
    expect(predictData(s).y).toEqual([
      [null, null],
      [null, null],
    ]);
  });

  it("applies predict.data overrides before blanking", () => {
    const s = spec();
    s.predict = { targets: ["y"], data: { sigma: [2, 2] } };
    const data = predictData(s);
    expect(data.sigma).toEqual([2, 2]);
    expect(data.y).toEqual([null, null]);
  });
});

describe("runPredict", () => {
  it("requests predict mode and records the posterior file", async () => {
    const outPath = out();
    const samplesPath = postFile();
    let argv: string[] = [];
    const spawn: FitRunner = async (_command, args) => {
      argv = args;
      writeFileSync(outPath, SAMPLES);
      return { stdout: PROVENANCE, stderr: "", code: 0 };
    };
    const result = await runPredict(
      spec(),
      { command: "/bin/julia", args: [] },
      { spawn, projectDir: "/proj", outPath, samplesPath },
    );

    expect(result.status).toBe("ok");
    const request = JSON.parse(readFileSync(argv.at(-1) as string, "utf8"));
    expect(request.mode).toBe("predict");
    expect(request.backend).toEqual({ id: "turing" });
    expect(request.samples).toBe(samplesPath);
    expect(request.predict.targets).toEqual(["y"]);
    expect(request.data.y).toEqual([null, null]);

    const record = JSON.parse(readFileSync(`${outPath}.run.json`, "utf8"));
    expect(record.posterior_samples).toBe(samplesPath);
    expect(typeof record.posterior_samples_sha256).toBe("string");
  });

  it("reports the driver stage on failure", async () => {
    const outPath = out();
    const spawn: FitRunner = async () => ({
      stdout: "",
      stderr: JSON.stringify({ error: "no variables predicted", stage: "predict" }),
      code: 1,
    });
    const result = await runPredict(
      spec(),
      { command: "/bin/julia", args: [] },
      { spawn, projectDir: "/proj", outPath, samplesPath: "/nope.json" },
    );
    expect(result.status).toBe("error");
    expect(result.stage).toBe("predict");
    expect(result.error).toContain("no variables predicted");
  });

  it("errors at the write stage when the output does not parse", async () => {
    const outPath = out();
    const spawn: FitRunner = async () => {
      writeFileSync(outPath, "{not valid mcmcchains}");
      return { stdout: PROVENANCE, stderr: "", code: 0 };
    };
    const result = await runPredict(
      spec(),
      { command: "/bin/julia", args: [] },
      { spawn, projectDir: "/proj", outPath, samplesPath: postFile() },
    );
    expect(result.status).toBe("error");
    expect(result.stage).toBe("write");
    expect(result.error).toMatch(/did not parse/);
  });

  it("errors when the driver exits cleanly but writes no artifact", async () => {
    const outPath = out();
    const spawn: FitRunner = async () => ({ stdout: PROVENANCE, stderr: "", code: 0 });
    const result = await runPredict(
      spec(),
      { command: "/bin/julia", args: [] },
      { spawn, projectDir: "/proj", outPath, samplesPath: postFile() },
    );
    expect(result.status).toBe("error");
    expect(existsSync(`${outPath}.run.json`)).toBe(false);
  });
});
