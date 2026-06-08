import type { MatrixResult } from "@mcmcjs/julia";
import { describe, expect, it } from "vitest";
import { defaultOut, formatFitResult, formatMatrix, matrixOutDir } from "./fit";

describe("output paths", () => {
  it("derives the single-fit and matrix output paths from the spec name", () => {
    expect(defaultOut("/work/eight-schools.toml")).toBe("/work/eight-schools.samples.json");
    expect(matrixOutDir("/work/eight-schools.toml")).toBe("/work/eight-schools.samples");
  });
});

describe("formatFitResult", () => {
  it("shows the samples file, Julia version, and run record on success", () => {
    const out = formatFitResult(
      {
        status: "ok",
        samplesFile: "/o.json",
        runtimeRequested: "release",
        runtimeActual: "1.12.6",
        elapsedMs: 42,
      },
      "release",
      "/o.json.run.json",
    );
    expect(out).toContain("ok");
    expect(out).toContain("/o.json");
    expect(out).toContain("1.12.6");
    expect(out).toContain("run record");
  });

  it("shows the failing stage and message on error", () => {
    const out = formatFitResult(
      {
        status: "error",
        runtimeRequested: "release",
        elapsedMs: 1,
        stage: "sample",
        error: "diverged",
      },
      "release",
      "/o.json.run.json",
    );
    expect(out).toContain("fit failed");
    expect(out).toContain("sample");
    expect(out).toContain("diverged");
  });
});

describe("formatMatrix", () => {
  const result: MatrixResult = {
    ok: false,
    entries: [
      { version: "1.10", status: "ok", samplesFile: "/d/1.10.samples.json", elapsedMs: 30 },
      { version: "release", status: "error", elapsedMs: 0, error: "not installed" },
    ],
  };

  it("lists each version and an overall verdict", () => {
    const out = formatMatrix(result);
    expect(out).toContain("1.10");
    expect(out).toContain("release");
    expect(out).toContain("not installed");
    expect(out).toContain("some versions failed");
  });
});
