import { compileStanCode } from "./compile-client";
import {
  type CompileResult,
  type SampleConfig,
  type SamplerListener,
  type StanRun,
  WorkerReply,
  type WorkerReplyMessage,
  WorkerRequest,
} from "./types";

export interface StanSamplerOptions {
  compileServerUrl: string;
  passcode?: string;
  getAuthToken?: () => Promise<string>;
  workerUrl?: string | URL;
}

const defaultWorkerUrl = (): URL => {
  try {
    return new URL("./worker.js", import.meta.url);
  } catch {
    throw new Error(
      '@mcmcjs/stan-wasm could not resolve its worker URL automatically. Pass `workerUrl` explicitly to the StanSampler constructor (e.g. import workerUrl from "@mcmcjs/stan-wasm/worker?url" in Vite).',
    );
  }
};

const calculateRefreshRate = (cfg: SampleConfig): number => {
  const total = (cfg.num_warmup + cfg.num_samples) * cfg.num_chains;
  const twoHalfPercent = Math.floor(total / 40);
  const nearestTen = Math.round(twoHalfPercent / 10) * 10;
  return Math.max(15, nearestTen);
};

export class StanSampler {
  readonly #compileServerUrl: string;
  readonly #passcode: string | undefined;
  readonly #getAuthToken: (() => Promise<string>) | undefined;
  readonly #workerUrl: string | URL;

  #worker: Worker | null = null;
  #lastCompile: CompileResult | null = null;
  #samplingStartTimeSec: number = 0;

  #loadResolve: (() => void) | null = null;
  #loadReject: ((err: Error) => void) | null = null;
  #sampleResolve: ((run: StanRun) => void) | null = null;
  #sampleReject: ((err: Error) => void) | null = null;
  #activeListener: SamplerListener | null = null;

  constructor(opts: StanSamplerOptions) {
    this.#compileServerUrl = opts.compileServerUrl;
    this.#passcode = opts.passcode;
    this.#getAuthToken = opts.getAuthToken;
    this.#workerUrl = opts.workerUrl ?? defaultWorkerUrl();
  }

  get isReady(): boolean {
    return this.#worker !== null && this.#lastCompile !== null;
  }

  get lastCompile(): CompileResult | null {
    return this.#lastCompile;
  }

  async compile(stanCode: string, signal?: AbortSignal): Promise<CompileResult> {
    this.#teardown(new Error("Superseded by a new compile()"));
    const result = await compileStanCode({
      serverUrl: this.#compileServerUrl,
      passcode: this.#passcode,
      getAuthToken: this.#getAuthToken,
      stanCode,
      signal,
    });
    await this.#startWorker(result.mainJsUrl);
    this.#lastCompile = result;
    return result;
  }

  sample(config: SampleConfig, listener?: SamplerListener): Promise<StanRun> {
    if (!this.#worker) {
      return Promise.reject(
        new Error("No model loaded — call compile() and await it before sample()"),
      );
    }
    if (this.#sampleResolve !== null) {
      return Promise.reject(new Error("A sampling run is already in progress on this sampler"));
    }
    return new Promise<StanRun>((resolve, reject) => {
      this.#sampleResolve = resolve;
      this.#sampleReject = reject;
      this.#activeListener = listener ?? null;
      this.#samplingStartTimeSec = performance.now() / 1000;
      const fullConfig: SampleConfig = {
        ...config,
        seed: config.seed ?? Math.floor(Math.random() * 2 ** 32),
        refresh: config.refresh ?? calculateRefreshRate(config),
      };
      this.#worker?.postMessage({ kind: WorkerRequest.Sample, sampleConfig: fullConfig });
    });
  }

  cancel(): void {
    this.#teardown(new Error("Cancelled"));
  }

  #teardown(rejectionReason: Error): void {
    if (this.#worker) {
      this.#worker.terminate();
      this.#worker = null;
    }
    this.#loadReject?.(rejectionReason);
    this.#sampleReject?.(rejectionReason);
    this.#loadResolve = null;
    this.#loadReject = null;
    this.#sampleResolve = null;
    this.#sampleReject = null;
    this.#activeListener = null;
    this.#lastCompile = null;
  }

  #startWorker(url: string): Promise<void> {
    const worker = new Worker(this.#workerUrl, { type: "module" });
    this.#worker = worker;
    worker.onmessage = (event: MessageEvent<WorkerReplyMessage>) => {
      this.#onWorkerMessage(event.data);
    };
    worker.onerror = (event: ErrorEvent) => {
      const message = event.message || "Worker error";
      const err = new Error(`Stan WASM worker error: ${message}`);
      if (this.#loadReject) {
        this.#loadReject(err);
        this.#loadResolve = null;
        this.#loadReject = null;
      } else if (this.#sampleReject) {
        this.#sampleReject(err);
        this.#sampleResolve = null;
        this.#sampleReject = null;
        this.#activeListener = null;
      }
    };
    return new Promise<void>((resolve, reject) => {
      this.#loadResolve = resolve;
      this.#loadReject = reject;
      worker.postMessage({ kind: WorkerRequest.Load, url });
    });
  }

  #onWorkerMessage(msg: WorkerReplyMessage): void {
    switch (msg.kind) {
      case WorkerReply.ModelLoaded: {
        const resolve = this.#loadResolve;
        this.#loadResolve = null;
        this.#loadReject = null;
        resolve?.();
        break;
      }
      case WorkerReply.ModelLoadError: {
        const reject = this.#loadReject;
        this.#loadResolve = null;
        this.#loadReject = null;
        reject?.(new Error(`Stan WASM model load failed: ${msg.error}`));
        break;
      }
      case WorkerReply.Progress: {
        this.#activeListener?.({ type: "progress", report: msg.report });
        break;
      }
      case WorkerReply.StanReturn: {
        const resolve = this.#sampleResolve;
        const reject = this.#sampleReject;
        const listener = this.#activeListener;
        this.#sampleResolve = null;
        this.#sampleReject = null;
        this.#activeListener = null;
        if (msg.error !== null) {
          listener?.({ type: "error", error: msg.error });
          reject?.(new Error(`Stan sampling failed: ${msg.error}`));
        } else {
          const run: StanRun = {
            draws: msg.draws,
            paramNames: msg.paramNames,
            computeTimeSec: performance.now() / 1000 - this.#samplingStartTimeSec,
            consoleMessages: msg.consoleMessages,
            sampleConfig: msg.sampleConfig,
          };
          listener?.({ type: "done", run });
          resolve?.(run);
        }
        break;
      }
    }
  }
}
