import { RUN_BUNDLE_KIND, RUN_BUNDLE_SCHEMA_VERSION } from "@mcmcjs/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyBundleUrl, fetchBundle, MAX_BUNDLE_BYTES } from "../src/lib/remote";

const BASE = "https://mcmcjs.github.io/report/";

function classify(raw: string) {
  return classifyBundleUrl(raw, BASE);
}

describe("classifyBundleUrl", () => {
  it("opens a documentation site we publish for without asking", () => {
    expect(classify("https://turinglang.org/JuliaBUGS.jl/runs/rats.json")).toEqual({
      url: "https://turinglang.org/JuliaBUGS.jl/runs/rats.json",
      origin: "https://turinglang.org",
      trusted: true,
    });
  });

  it("trusts the app's own origin, including a relative link", () => {
    expect(classify("./demo.mcmcrun.json")?.trusted).toBe(true);
    expect(classify("./demo.mcmcrun.json")?.url).toBe(
      "https://mcmcjs.github.io/report/demo.mcmcrun.json",
    );
  });

  it("trusts loopback so a local preview can be pointed at the hosted app", () => {
    expect(classify("http://127.0.0.1:8000/run.json")?.trusted).toBe(true);
    expect(classify("http://localhost:8000/run.json")?.trusted).toBe(true);
  });

  it("allows any other https origin, but never silently", () => {
    const source = classify("https://example.com/run.json");
    expect(source).toEqual({
      url: "https://example.com/run.json",
      origin: "https://example.com",
      trusted: false,
    });
  });

  it("judges trust on the parsed origin, not on the look of the link", () => {
    expect(classify("https://turinglang.org.example.com/run.json")?.trusted).toBe(false);
    expect(classify("https://turinglang.org@example.com/run.json")?.origin).toBe(
      "https://example.com",
    );
    expect(classify("https://turinglang.org@example.com/run.json")?.trusted).toBe(false);
  });

  it("refuses anything that is not a fetchable https URL", () => {
    expect(classify("javascript:alert(1)")).toBeNull();
    expect(classify("data:application/json,{}")).toBeNull();
    expect(classify("http://example.com/run.json")).toBeNull();
    expect(classify("file:///etc/passwd")).toBeNull();
  });

  it("resolves a value that is not a URL against the app's own origin", () => {
    expect(classify("not a url")?.url).toBe("https://mcmcjs.github.io/report/not%20a%20url");
  });
});

const BUNDLE = JSON.stringify({
  kind: RUN_BUNDLE_KIND,
  schema_version: RUN_BUNDLE_SCHEMA_VERSION,
  entry: { id: "r1" },
  spec: {},
  model_source: "model { }",
  samples: {},
});

function respond(
  body: string,
  init: { ok?: boolean; status?: number; url?: string; headers?: Record<string, string> } = {},
): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    url: init.url ?? "https://turinglang.org/run.json",
    headers: new Headers(init.headers ?? {}),
    body: new Blob([body]).stream(),
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

const SOURCE = {
  url: "https://turinglang.org/run.json",
  origin: "https://turinglang.org",
  trusted: true,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchBundle", () => {
  it("parses a bundle the origin serves", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond(BUNDLE)));
    const bundle = await fetchBundle(SOURCE);
    expect(bundle.entry.id).toBe("r1");
  });

  it("omits credentials", async () => {
    const fetcher = vi.fn().mockResolvedValue(respond(BUNDLE));
    vi.stubGlobal("fetch", fetcher);
    await fetchBundle(SOURCE);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: "omit" });
  });

  it("reports a failed status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond("", { ok: false, status: 404 })));
    await expect(fetchBundle(SOURCE)).rejects.toThrow("returned 404");
  });

  it("refuses a redirect off the origin the reader agreed to", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(respond(BUNDLE, { url: "https://example.com/run.json" })),
    );
    await expect(fetchBundle(SOURCE)).rejects.toThrow("redirected to https://example.com");
  });

  it("refuses a declared length over the cap without reading the body", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          respond(BUNDLE, { headers: { "content-length": String(MAX_BUNDLE_BYTES + 1) } }),
        ),
    );
    await expect(fetchBundle(SOURCE)).rejects.toThrow("larger than");
  });

  it("gives up on a body that runs past the cap while it streams", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond("x".repeat(MAX_BUNDLE_BYTES + 1))));
    await expect(fetchBundle(SOURCE)).rejects.toThrow("larger than");
  });

  it("reports a body that is not a run bundle", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond('{"kind":"something else"}')));
    await expect(fetchBundle(SOURCE)).rejects.toThrow("not a run bundle");
  });
});
