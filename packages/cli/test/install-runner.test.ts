import { describe, expect, it, vi } from "vitest";

// installRunner picks a runner by mode; assert it calls the right engine factory.
const created: string[] = [];
vi.mock("@mcmcjs/engine", () => ({
  createRunner: (..._a: unknown[]) => {
    created.push("buffered");
    return async () => "";
  },
  createStreamingRunner: (..._a: unknown[]) => {
    created.push("streaming");
    return async () => "";
  },
}));
vi.mock("../src/install-progress", () => ({
  createCollapsingRunner: (..._a: unknown[]) => {
    created.push("collapsing");
    return async () => "";
  },
}));

const { installRunner } = await import("../src/julia");

describe("installRunner mode selection", () => {
  it("is buffered (silent) under --json", () => {
    created.length = 0;
    installRunner({ label: "x", timeoutMs: 1000, json: true });
    expect(created).toEqual(["buffered"]);
  });

  it("streams raw under --verbose", () => {
    created.length = 0;
    installRunner({ label: "x", timeoutMs: 1000, verbose: true });
    expect(created).toEqual(["streaming"]);
  });

  it("collapses by default", () => {
    created.length = 0;
    installRunner({ label: "x", timeoutMs: 1000 });
    expect(created).toEqual(["collapsing"]);
  });

  it("--json wins over --verbose", () => {
    created.length = 0;
    installRunner({ label: "x", timeoutMs: 1000, json: true, verbose: true });
    expect(created).toEqual(["buffered"]);
  });
});
