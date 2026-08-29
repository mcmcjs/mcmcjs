import { describe, expect, it } from "vitest";
import { parseHash, runHash } from "../src/lib/deeplink";

const BUNDLE = "https://turinglang.org/JuliaBUGS.jl/runs/rats.mcmcrun.json";

describe("parseHash", () => {
  it("reads a run with the store and connect parts a CLI link carries", () => {
    const link = parseHash(
      "#run=r1&store=/home/u/.mcmc&connect=http://127.0.0.1:7788/v1/t/stores/s",
    );
    expect(link).toEqual({
      runId: "r1",
      storePath: "/home/u/.mcmc",
      connect: "http://127.0.0.1:7788/v1/t/stores/s",
      bundle: undefined,
    });
  });

  it("reads a bundle link that names no run", () => {
    expect(parseHash(`#bundle=${encodeURIComponent(BUNDLE)}`)).toEqual({
      runId: undefined,
      storePath: undefined,
      connect: undefined,
      bundle: BUNDLE,
    });
  });

  it("is nothing when neither a run nor a bundle is named", () => {
    expect(parseHash("")).toBeNull();
    expect(parseHash("#")).toBeNull();
    expect(parseHash("#store=/home/u/.mcmc")).toBeNull();
  });
});

describe("runHash", () => {
  it("keeps the bundle URL so the open run stays linkable elsewhere", () => {
    const link = parseHash(`#bundle=${encodeURIComponent(BUNDLE)}`);
    const hash = runHash("r1", link);
    expect(parseHash(`#${hash}`)).toEqual({
      runId: "r1",
      storePath: undefined,
      connect: undefined,
      bundle: BUNDLE,
    });
  });

  it("drops the one-shot store and connect parts", () => {
    const link = parseHash("#run=r1&store=/home/u/.mcmc&connect=http://127.0.0.1:7788/t");
    expect(runHash("r1", link)).toBe("run=r1");
    expect(runHash("r1", null)).toBe("run=r1");
  });
});
