import { afterEach, describe, expect, it } from "vitest";
import { shareBaseUrl, useShareExport } from "../src/widget/composables/useShareExport";

const ELEMENTS = [
  {
    type: "node" as const,
    id: "node_mu",
    name: "mu",
    nodeType: "stochastic" as const,
    position: { x: 120, y: 40 },
    distribution: "dnorm",
    param1: "0",
    param2: "0.001",
  },
  {
    type: "node" as const,
    id: "plate_i",
    name: "Plate i",
    nodeType: "plate" as const,
    position: { x: 60, y: 160 },
    loopVariable: "i",
    loopRange: "1:N",
  },
  {
    type: "node" as const,
    id: "node_y",
    name: "y",
    nodeType: "observed" as const,
    position: { x: 120, y: 200 },
    parent: "plate_i",
    indices: "i",
    distribution: "dnorm",
    param1: "mu",
    param2: "1",
    observed: true,
  },
  { type: "edge" as const, id: "edge_mu_y", source: "node_mu", target: "node_y" },
];

const withLocation = (href: string) => {
  const url = new URL(href);
  (globalThis as { window?: unknown }).window = {
    location: { origin: url.origin, pathname: url.pathname, search: url.search },
  };
};

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("shareBaseUrl", () => {
  it("points at the page doing the sharing, without its query", () => {
    withLocation("https://turinglang.org/JuliaBUGS.jl/DoodlePPL/?share=gz_abc");
    expect(shareBaseUrl()).toBe("https://turinglang.org/JuliaBUGS.jl/DoodlePPL/");
  });

  // A preview has to share links to itself, not to the published site, which is
  // not running the code being previewed.
  it("keeps a PR preview's own path", () => {
    withLocation("https://turinglang.org/JuliaBUGS.jl/DoodlePPL/pr-previews/535/");
    expect(shareBaseUrl()).toBe("https://turinglang.org/JuliaBUGS.jl/DoodlePPL/pr-previews/535/");
  });

  it("has no opinion when there is no window", () => {
    expect(shareBaseUrl()).toBe("");
  });
});

describe("share link round trip", () => {
  it("restores every element through minify, compress, decode, and expand", async () => {
    const { compressAndEncode, decodeAndDecompress, minifyGraph, expandGraph } = useShareExport();
    const payload = { v: 2, n: "Demo", e: minifyGraph(ELEMENTS), d: '{"N":3}' };

    const encoded = await compressAndEncode(JSON.stringify(payload));
    const restored = JSON.parse(await decodeAndDecompress(encoded)) as typeof payload;

    expect(restored.n).toBe("Demo");
    expect(restored.d).toBe('{"N":3}');
    expect(expandGraph(restored.e)).toEqual(ELEMENTS);
  });

  it("generates a link the loader can read the payload back out of", async () => {
    withLocation("https://turinglang.org/JuliaBUGS.jl/DoodlePPL/");
    const { shareUrl, generateShareLink, decodeAndDecompress, minifyGraph, expandGraph } =
      useShareExport();

    await generateShareLink({ v: 2, n: "Demo", e: minifyGraph(ELEMENTS) });
    expect(shareUrl.value.startsWith("https://turinglang.org/JuliaBUGS.jl/DoodlePPL/?share=")).toBe(
      true,
    );

    const encoded = new URL(shareUrl.value).searchParams.get("share") as string;
    const restored = JSON.parse(await decodeAndDecompress(encoded)) as { e: unknown[] };
    expect(expandGraph(restored.e as Record<string, unknown>[])).toEqual(ELEMENTS);
  });
});
