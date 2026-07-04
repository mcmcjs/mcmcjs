import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StanSampler } from "../src/sampler";
import { WorkerReply, WorkerRequest, type WorkerRequestMessage } from "../src/types";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_WORKER = globalThis.Worker;

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  posted: WorkerRequestMessage[] = [];

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(msg: WorkerRequestMessage): void {
    this.posted.push(msg);
    if (msg.kind === WorkerRequest.Load) {
      queueMicrotask(() => {
        this.onmessage?.({
          data: { kind: WorkerReply.ModelLoaded, stanVersion: "test" },
        } as MessageEvent);
      });
    }
  }

  terminate(): void {}
}

describe("StanSampler.compile", () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    globalThis.Worker = FakeWorker as unknown as typeof Worker;
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    globalThis.Worker = ORIGINAL_WORKER;
    vi.restoreAllMocks();
  });

  it("threads getAuthToken to the compile request and loads the returned main_js_url", async () => {
    const getAuthToken = vi.fn(async () => "sampler-token");
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer sampler-token");
      return new Response(
        JSON.stringify({
          model_id: "abc123",
          main_js_url: "https://cdn.example.com/artifacts/abc123/main.js",
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const sampler = new StanSampler({
      compileServerUrl: "https://stan-wasm.example.com",
      getAuthToken,
      workerUrl: "worker.js",
    });
    const result = await sampler.compile("data{}parameters{}model{}");

    expect(getAuthToken).toHaveBeenCalledOnce();
    expect(result.mainJsUrl).toBe("https://cdn.example.com/artifacts/abc123/main.js");
    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0]?.posted[0]).toEqual({
      kind: WorkerRequest.Load,
      url: "https://cdn.example.com/artifacts/abc123/main.js",
    });
    expect(sampler.isReady).toBe(true);
  });
});
