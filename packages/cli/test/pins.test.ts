import { computeRunKey } from "@mcmcjs/core";
import { describe, expect, it } from "vitest";
import { parsePackageVersions } from "../src/fit";
import { mergePins, parsePackagePins } from "../src/run";

describe("parsePackagePins", () => {
  it("parses repeated name=version flags", () => {
    expect(parsePackagePins(["Turing=0.45", "MCMCChains=7.0"])).toEqual({
      Turing: "0.45",
      MCMCChains: "7.0",
    });
  });

  it("is undefined with no flags", () => {
    expect(parsePackagePins(undefined)).toBeUndefined();
    expect(parsePackagePins([])).toBeUndefined();
  });

  it("rejects malformed entries", () => {
    expect(() => parsePackagePins(["Turing"])).toThrow(/name=version/);
    expect(() => parsePackagePins(["=0.45"])).toThrow(/name=version/);
    expect(() => parsePackagePins(["Turing="])).toThrow(/name=version/);
  });
});

describe("mergePins", () => {
  it("lets flag pins win over spec pins", () => {
    expect(mergePins({ Turing: "0.44" }, { Turing: "0.45" })).toEqual({ Turing: "0.45" });
    expect(mergePins({ Turing: "0.44" }, { MCMCChains: "7.0" })).toEqual({
      Turing: "0.44",
      MCMCChains: "7.0",
    });
  });

  it("is undefined when nothing is pinned", () => {
    expect(mergePins(undefined, undefined)).toBeUndefined();
  });
});

describe("parsePackageVersions", () => {
  it("parses a name=v1,v2 matrix arg", () => {
    expect(parsePackageVersions("Turing=0.44,0.45")).toEqual({
      name: "Turing",
      versions: ["0.44", "0.45"],
    });
  });

  it("rejects malformed args", () => {
    expect(() => parsePackageVersions("Turing")).toThrow(/name=v1,v2/);
    expect(() => parsePackageVersions("Turing=")).toThrow(/no versions/);
  });
});

describe("run key with package pins", () => {
  const base = {
    backend: { id: "turing", version: "release" },
    model_sha256: "m",
    entry: "build_model",
    sampler: { algorithm: "NUTS", draws: 1000, warmup: 1000, chains: 4, adapt_delta: 0.8 },
    data_sha256: "d",
  };

  it("is unchanged when no pins are present (caching preserved)", () => {
    expect(computeRunKey({ ...base, packages: undefined })).toBe(computeRunKey(base));
  });

  it("changes when a pin changes", () => {
    const a = computeRunKey({ ...base, packages: { Turing: "0.45" } });
    const b = computeRunKey({ ...base, packages: { Turing: "0.44" } });
    expect(a).not.toBe(b);
    expect(a).not.toBe(computeRunKey(base));
  });
});
