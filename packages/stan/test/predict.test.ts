import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSamples, type ResolvedSpec, type Samples } from "@mcmcjs/core";
import { describe, expect, it } from "vitest";
import { modelCacheDir } from "../src/compile";
import type { CmdStanInstall } from "../src/environment";
import { fittedParamsCsv, matchesTarget, predictData, runPredict } from "../src/predict";
import type { StanSpawn } from "../src/runner";

const GQ_HEADER = "y_rep.1,y_rep.2,log_lik";

function makeSpec(dir: string, targets: string[]): ResolvedSpec {
  const modelPath = join(dir, "model.stan");
  writeFileSync(modelPath, "// gq model\n");
  return {
    schema_version: "0",
    backend: { id: "stan", runtime: "cmdstan", version: "installed" },
    model: { kind: "file", path: "./model.stan", entry: "build_model" },
    sampler: { algorithm: "NUTS", draws: 3, warmup: 1, chains: 2, adapt_delta: 0.8 },
    data: { N: 2 },
    output: { format: "mcmcchains-json" },
    seed: 7,
    predict: { targets },
    specPath: join(dir, "spec.toml"),
    modelPath,
    specHash: "hash",
  } as ResolvedSpec;
}

function writePosterior(dir: string): string {
  // 2 chains x 3 draws of theta: chain 0 = [1,2,3], chain 1 = [4,5,6].
  const path = join(dir, "samples.json");
  writeFileSync(
    path,
    JSON.stringify({
      size: [3, 1, 2],
      value_flat: [1, 2, 3, 4, 5, 6],
      parameters: ["theta"],
      name_map: { parameters: ["theta"], internals: [] },
    }),
  );
  return path;
}

function seedCompileCache(spec: ResolvedSpec, cacheRoot: string): void {
  const source = readFileSync(spec.modelPath, "utf8");
  const dir = modelCacheDir(source, "2.39.0", cacheRoot);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "model"), "");
  writeFileSync(join(dir, ".ok"), "");
}

const install: CmdStanInstall = { version: "2.39.0", home: "/x/cmdstan-2.39.0" };

/** A generate_quantities fake writing one gq row per fitted draw. */
function fakeGq(opts?: { noGqBlock?: boolean }): StanSpawn {
  return async (_command, args) => {
    if (opts?.noGqBlock) {
      return { code: 1, stderr: "Model doesn't generate any quantities of interest.\n" };
    }
    expect(args[0]).toBe("generate_quantities");
    const fitted = args.find((a) => a.startsWith("fitted_params="))?.slice(14) as string;
    const out = args.find((a) => a.startsWith("file=") && a.includes("gq_"))?.slice(5) as string;
    const id = Number(args.find((a) => a.startsWith("id="))?.slice(3));
    const rows = readFileSync(fitted, "utf8").trim().split("\n").slice(1);
    const gqRows = rows.map((row, r) => `${Number(row) * 10},${Number(row) * 100},${id + r}`);
    writeFileSync(out, `# model = m\n${GQ_HEADER}\n${gqRows.join("\n")}\n`);
    return { code: 0, stderr: "" };
  };
}

describe("predictData", () => {
  it("merges predict.data over data without blanking targets", () => {
    const dir = mkdtempSync(join(tmpdir(), "stan-predict-"));
    const spec = makeSpec(dir, ["y_rep"]);
    spec.predict = { targets: ["y_rep"], data: { N: 5 } };
    expect(predictData(spec)).toEqual({ N: 5 });
  });
});

describe("fittedParamsCsv", () => {
  it("writes one Stan CSV per chain with parameter columns in Stan notation", () => {
    const samples: Samples = {
      variables: ["theta", "beta[2]"],
      nChains: 2,
      nDraws: 2,
      draws: new Map([
        ["theta", new Float64Array([1, 2, 3, 4])],
        ["beta[2]", new Float64Array([5, Number.NEGATIVE_INFINITY, 7, 8])],
      ]),
      sampleStats: new Map(),
    };
    expect(fittedParamsCsv(samples, 0)).toBe("theta,beta.2\n1,5\n2,-inf\n");
    expect(fittedParamsCsv(samples, 1)).toBe("theta,beta.2\n3,7\n4,8\n");
  });
});

describe("matchesTarget", () => {
  it("matches base names and their scalarized elements only", () => {
    expect(matchesTarget("y_rep", ["y_rep"])).toBe(true);
    expect(matchesTarget("y_rep[3]", ["y_rep"])).toBe(true);
    expect(matchesTarget("y_replica", ["y_rep"])).toBe(false);
  });
});

describe("runPredict", () => {
  it("runs gq per chain and writes the target variables as a samples file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stan-predict-"));
    const spec = makeSpec(dir, ["y_rep"]);
    const cacheRoot = join(dir, "cache");
    seedCompileCache(spec, cacheRoot);
    const samplesPath = writePosterior(dir);
    const outPath = join(dir, "predict.json");

    const result = await runPredict(spec, install, {
      outPath,
      samplesPath,
      spawn: fakeGq(),
      compile: { cacheRoot },
    });
    expect(result.status).toBe("ok");
    expect(result.runtimeActual).toBe("2.39.0");

    const predictive = parseSamples(readFileSync(outPath, "utf8"));
    expect(predictive.nChains).toBe(2);
    expect(predictive.nDraws).toBe(3);
    expect([...predictive.variables].sort()).toEqual(["y_rep[1]", "y_rep[2]"]);
    // log_lik is generated but filtered out by the targets.
    expect(Array.from(predictive.draws.get("y_rep[1]") ?? [])).toEqual([10, 20, 30, 40, 50, 60]);

    const record = JSON.parse(readFileSync(`${outPath}.run.json`, "utf8"));
    expect(record.posterior_samples).toBe(samplesPath);
    expect(record.runtime.actual).toBe("2.39.0");
  });

  it("explains a model without a generated quantities block", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stan-predict-"));
    const spec = makeSpec(dir, ["y_rep"]);
    const cacheRoot = join(dir, "cache");
    seedCompileCache(spec, cacheRoot);
    const result = await runPredict(spec, install, {
      outPath: join(dir, "predict.json"),
      samplesPath: writePosterior(dir),
      spawn: fakeGq({ noGqBlock: true }),
      compile: { cacheRoot },
    });
    expect(result.status).toBe("error");
    expect(result.stage).toBe("predict");
    expect(result.error).toContain("generated quantities block");
  });

  it("lists available quantities when no target matches", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stan-predict-"));
    const spec = makeSpec(dir, ["z"]);
    const cacheRoot = join(dir, "cache");
    seedCompileCache(spec, cacheRoot);
    const result = await runPredict(spec, install, {
      outPath: join(dir, "predict.json"),
      samplesPath: writePosterior(dir),
      spawn: fakeGq(),
      compile: { cacheRoot },
    });
    expect(result.status).toBe("error");
    expect(result.error).toContain("y_rep");
    expect(result.error).toContain("log_lik");
  });
});
