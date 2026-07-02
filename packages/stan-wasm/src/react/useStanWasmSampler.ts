import { useCallback, useEffect, useReducer, useRef } from "react";
import { StanSampler, type StanSamplerOptions } from "../sampler";

const REACT_FALLBACK_WORKER_URL = (() => {
  try {
    return new URL("../worker.js", import.meta.url).href;
  } catch {
    return undefined;
  }
})();

import type {
  ConsoleMessage,
  Progress,
  SampleConfig,
  SamplerEvent,
  SamplerListener,
  SamplerState,
  StanRun,
} from "../types";

type Action =
  | { type: "compile:start" }
  | { type: "compile:done"; modelId: string; mainJsUrl: string }
  | { type: "compile:error"; error: string }
  | { type: "sample:start" }
  | { type: "sample:progress"; progress: Progress }
  | { type: "sample:done"; run: StanRun }
  | { type: "sample:error"; error: string }
  | { type: "reset" };

const initialState: SamplerState = {
  compileStatus: "idle",
  sampleStatus: "idle",
  compileError: null,
  sampleError: null,
  progress: null,
  latestRun: null,
  consoleMessages: [],
  modelId: null,
  mainJsUrl: null,
};

const reducer = (state: SamplerState, action: Action): SamplerState => {
  switch (action.type) {
    case "compile:start":
      return {
        ...state,
        compileStatus: "compiling",
        compileError: null,
        sampleStatus: "idle",
        sampleError: null,
        progress: null,
        modelId: null,
        mainJsUrl: null,
      };
    case "compile:done":
      return {
        ...state,
        compileStatus: "ready",
        modelId: action.modelId,
        mainJsUrl: action.mainJsUrl,
      };
    case "compile:error":
      return {
        ...state,
        compileStatus: "error",
        compileError: action.error,
      };
    case "sample:start":
      return {
        ...state,
        sampleStatus: "sampling",
        sampleError: null,
        progress: null,
        latestRun: null,
        consoleMessages: [],
      };
    case "sample:progress":
      return { ...state, progress: action.progress };
    case "sample:done":
      return {
        ...state,
        sampleStatus: "done",
        latestRun: action.run,
        consoleMessages: action.run.consoleMessages,
      };
    case "sample:error":
      return { ...state, sampleStatus: "error", sampleError: action.error };
    case "reset":
      return initialState;
    default:
      return state;
  }
};

export interface UseStanWasmSamplerReturn {
  state: SamplerState;
  compile: (stanCode: string) => Promise<void>;
  sample: (config: SampleConfig, listener?: SamplerListener) => Promise<StanRun>;
  cancel: () => void;
}

export function useStanWasmSampler(opts: StanSamplerOptions): UseStanWasmSamplerReturn {
  const [state, dispatch] = useReducer(reducer, initialState);
  const samplerRef = useRef<StanSampler | null>(null);
  const { compileServerUrl, passcode } = opts;
  const workerUrl = opts.workerUrl ?? REACT_FALLBACK_WORKER_URL;

  useEffect(() => {
    const sampler = new StanSampler({ compileServerUrl, passcode, workerUrl });
    samplerRef.current = sampler;
    return () => {
      sampler.cancel();
      if (samplerRef.current === sampler) {
        samplerRef.current = null;
      }
    };
  }, [compileServerUrl, passcode, workerUrl]);

  const compile = useCallback(async (stanCode: string) => {
    const sampler = samplerRef.current;
    if (!sampler) throw new Error("Sampler not yet initialised");
    dispatch({ type: "compile:start" });
    try {
      const result = await sampler.compile(stanCode);
      dispatch({
        type: "compile:done",
        modelId: result.modelId,
        mainJsUrl: result.mainJsUrl,
      });
    } catch (err) {
      dispatch({
        type: "compile:error",
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }, []);

  const sample = useCallback(async (config: SampleConfig, listener?: SamplerListener) => {
    const sampler = samplerRef.current;
    if (!sampler) throw new Error("Sampler not yet initialised");
    dispatch({ type: "sample:start" });
    const wrappedListener: SamplerListener = (event: SamplerEvent) => {
      if (event.type === "progress") {
        dispatch({ type: "sample:progress", progress: event.report });
      }
      listener?.(event);
    };
    try {
      const run = await sampler.sample(config, wrappedListener);
      dispatch({ type: "sample:done", run });
      return run;
    } catch (err) {
      dispatch({
        type: "sample:error",
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }, []);

  const cancel = useCallback(() => {
    samplerRef.current?.cancel();
    dispatch({ type: "reset" });
  }, []);

  return { state, compile, sample, cancel };
}

export type { ConsoleMessage, SamplerState };
