import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compileStanCode, probeServer } from "../src/compile-client";

const ORIGINAL_FETCH = globalThis.fetch;

describe("compileStanCode", () => {
  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    vi.restoreAllMocks();
  });

  it("POSTs Stan source to /compile with Bearer auth and returns modelId + mainJsUrl", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://stan-wasm.example.com/compile");
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer secret");
      expect(init?.body).toBe("data{}parameters{}model{}");
      return new Response(JSON.stringify({ model_id: "abc123" }), { status: 200 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await compileStanCode({
      serverUrl: "https://stan-wasm.example.com/",
      passcode: "secret",
      stanCode: "data{}parameters{}model{}",
    });

    expect(result.modelId).toBe("abc123");
    expect(result.mainJsUrl).toBe("https://stan-wasm.example.com/download/abc123/main.js");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("omits Authorization header when no passcode is given", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).Authorization).toBeUndefined();
      return new Response(JSON.stringify({ model_id: "no-auth" }), { status: 200 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await compileStanCode({
      serverUrl: "https://stan-wasm.example.com",
      stanCode: "",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("uses main_js_url from the compile response when present", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          model_id: "abc123",
          main_js_url: "https://cdn.example.com/artifacts/abc123/main.js",
        }),
        { status: 200 },
      )) as unknown as typeof fetch;

    const result = await compileStanCode({
      serverUrl: "https://stan-wasm.example.com",
      stanCode: "data{}parameters{}model{}",
    });

    expect(result.modelId).toBe("abc123");
    expect(result.mainJsUrl).toBe("https://cdn.example.com/artifacts/abc123/main.js");
  });

  it("falls back to the derived download URL when main_js_url is empty", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ model_id: "abc123", main_js_url: "" }), {
        status: 200,
      })) as unknown as typeof fetch;

    const result = await compileStanCode({
      serverUrl: "https://stan-wasm.example.com",
      stanCode: "",
    });

    expect(result.mainJsUrl).toBe("https://stan-wasm.example.com/download/abc123/main.js");
  });

  it("throws on non-200 with response text in the message", async () => {
    globalThis.fetch = (async () =>
      new Response("Stan syntax error on line 4", { status: 400 })) as unknown as typeof fetch;

    await expect(compileStanCode({ serverUrl: "https://x", stanCode: "broken" })).rejects.toThrow(
      /HTTP 400.*Stan syntax error/,
    );
  });

  it("throws when response is missing model_id", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({}), { status: 200 })) as unknown as typeof fetch;

    await expect(compileStanCode({ serverUrl: "https://x", stanCode: "" })).rejects.toThrow(
      /model_id/,
    );
  });
});

describe("probeServer", () => {
  beforeEach(() => {});
  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    vi.restoreAllMocks();
  });

  it("returns true for HTTP 200", async () => {
    globalThis.fetch = (async () => new Response("", { status: 200 })) as unknown as typeof fetch;
    await expect(probeServer({ serverUrl: "https://x/" })).resolves.toBe(true);
  });

  it("returns false for HTTP 500", async () => {
    globalThis.fetch = (async () => new Response("", { status: 500 })) as unknown as typeof fetch;
    await expect(probeServer({ serverUrl: "https://x" })).resolves.toBe(false);
  });

  it("returns false on network error", async () => {
    globalThis.fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    await expect(probeServer({ serverUrl: "https://x" })).resolves.toBe(false);
  });
});
