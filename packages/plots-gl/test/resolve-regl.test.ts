import type { Scatter3dData } from "@mcmcjs/plots";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveRegl } from "../src/common";
import { mountScatter3d } from "../src/scatter3d";

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

const EMPTY_DATA: Scatter3dData = {
  kind: "scatter3d",
  varX: "x",
  varY: "y",
  varZ: "z",
  nChains: 0,
  bbox: { minX: 0, maxX: 1, minY: 0, maxY: 1, minZ: 0, maxZ: 1 },
  chains: [],
};

describe("resolveRegl", () => {
  it("returns an injected factory verbatim without importing regl", async () => {
    const fake = vi.fn();
    const resolved = await resolveRegl({ regl: fake as never });
    expect(resolved).toBe(fake);
  });

  it("throws a clear error when regl cannot be loaded and no factory is passed", async () => {
    // Force the dynamic `import("regl")` to fail so we exercise the error path even
    // though regl is installed as a devDependency in this workspace.
    vi.doMock("regl", () => {
      throw new Error("module not found");
    });
    await expect(resolveRegl({})).rejects.toThrow(
      "@mcmcjs/plots-gl needs regl: install it or pass { regl }",
    );
  });
});

describe("mountScatter3d", () => {
  it("rejects with the clear error when regl is absent and no factory is passed", async () => {
    vi.doMock("regl", () => {
      throw new Error("module not found");
    });
    const target = { appendChild: vi.fn(), clientWidth: 0 } as unknown as HTMLElement;
    await expect(mountScatter3d(target, EMPTY_DATA)).rejects.toThrow(
      "@mcmcjs/plots-gl needs regl: install it or pass { regl }",
    );
  });
});
