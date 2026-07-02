/// <reference lib="webworker" />

import StanModel from "tinystan";
import {
  type ConsoleMessage,
  type Progress,
  WorkerReply,
  type WorkerReplyMessage,
  WorkerRequest,
  type WorkerRequestMessage,
} from "./types";

declare const self: DedicatedWorkerGlobalScope;

const postReply = (message: WorkerReplyMessage) => self.postMessage(message);

let model: StanModel | null = null;
let consoleMessages: ConsoleMessage[] = [];

const parseProgress = (msg: string): Progress => {
  let normalized = msg;
  if (normalized.startsWith("Iteration:")) {
    normalized = `Chain [1] ${normalized}`;
  }
  normalized = normalized.replace(/\[|\]/g, "");
  const parts = normalized.split(/\s+/);
  const chain = Number.parseInt(parts[1] ?? "0", 10);
  const iteration = Number.parseInt(parts[3] ?? "0", 10);
  const totalIterations = Number.parseInt(parts[5] ?? "0", 10);
  const percentRaw = parts[6] ?? "0%";
  const percent = Number.parseInt(percentRaw.slice(0, -1), 10);
  const warmup = parts[7] === "(Warmup)";
  return { chain, iteration, totalIterations, percent, warmup };
};

const progressPrintCallback = (msg: string) => {
  if (!msg) return;
  consoleMessages.push({ text: msg, level: "log" });
  if (msg.includes("Iteration:")) {
    postReply({ kind: WorkerReply.Progress, report: parseProgress(msg) });
  }
};

const errorPrintCallback = (msg: string) => {
  consoleMessages.push({ text: msg, level: "error" });
};

const normalizeInits = (
  raw: unknown,
): string | Record<string, unknown> | Record<string, unknown>[] | undefined => {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === "string") return raw;
  return raw as Record<string, unknown> | Record<string, unknown>[];
};

self.onmessage = async (event: MessageEvent<WorkerRequestMessage>) => {
  const data = event.data;
  if (!data || typeof data !== "object" || !("kind" in data)) return;

  switch (data.kind) {
    case WorkerRequest.Load: {
      try {
        const mod = await import(/* @vite-ignore */ data.url);
        model = await StanModel.load(mod.default, progressPrintCallback, errorPrintCallback);
        const stanVersion =
          typeof model.stanVersion === "function" ? model.stanVersion() : "unknown";
        postReply({ kind: WorkerReply.ModelLoaded, stanVersion });
      } catch (err) {
        postReply({
          kind: WorkerReply.ModelLoadError,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      break;
    }

    case WorkerRequest.Sample: {
      if (!model) {
        postReply({
          kind: WorkerReply.StanReturn,
          error: "Model not loaded — call compile() and await it before sample()",
        });
        return;
      }
      consoleMessages = [];
      try {
        const cfg = data.sampleConfig;
        const inits = normalizeInits(cfg.inits);
        const tinystanArgs: Record<string, unknown> = { ...cfg };
        if (inits === undefined) {
          delete tinystanArgs.inits;
        } else {
          tinystanArgs.inits = inits;
        }
        const { paramNames, draws } = model.sample(tinystanArgs);
        postReply({
          kind: WorkerReply.StanReturn,
          error: null,
          draws,
          paramNames,
          consoleMessages,
          sampleConfig: cfg,
        });
      } catch (err) {
        postReply({
          kind: WorkerReply.StanReturn,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      break;
    }
  }
};
