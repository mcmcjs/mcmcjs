export type SamplingOpts = {
  num_chains: number;
  num_warmup: number;
  num_samples: number;
  init_radius: number;
  seed?: number;
};

export type StanVariableInputs = Record<string, unknown>;

export type SampleConfig = SamplingOpts & {
  data: string | StanVariableInputs;
  inits?: string | StanVariableInputs | StanVariableInputs[];
  refresh?: number;
};

export type Progress = {
  chain: number;
  iteration: number;
  totalIterations: number;
  percent: number;
  warmup: boolean;
};

export type ConsoleMessage = {
  text: string;
  level: "log" | "error";
};

export type StanRun = {
  draws: number[][];
  paramNames: string[];
  computeTimeSec: number;
  consoleMessages: ConsoleMessage[];
  sampleConfig: SampleConfig;
};

export type SamplerEvent =
  | { type: "progress"; report: Progress }
  | { type: "done"; run: StanRun }
  | { type: "error"; error: string };

export type SamplerListener = (event: SamplerEvent) => void;

export type CompileStatus = "idle" | "compiling" | "ready" | "error";
export type SampleStatus = "idle" | "loading" | "sampling" | "done" | "error";

export type SamplerState = {
  compileStatus: CompileStatus;
  sampleStatus: SampleStatus;
  compileError: string | null;
  sampleError: string | null;
  progress: Progress | null;
  latestRun: StanRun | null;
  consoleMessages: ConsoleMessage[];
  modelId: string | null;
  mainJsUrl: string | null;
};

export type CompileResult = {
  modelId: string;
  mainJsUrl: string;
};

export enum WorkerRequest {
  Load = "load",
  Sample = "sample",
}

export enum WorkerReply {
  ModelLoaded = "modelLoaded",
  ModelLoadError = "modelLoadError",
  Progress = "progress",
  StanReturn = "stanReturn",
}

export type WorkerRequestMessage =
  | { kind: WorkerRequest.Load; url: string }
  | { kind: WorkerRequest.Sample; sampleConfig: SampleConfig };

export type WorkerReplyMessage =
  | { kind: WorkerReply.ModelLoaded; stanVersion: string }
  | { kind: WorkerReply.ModelLoadError; error: string }
  | { kind: WorkerReply.Progress; report: Progress }
  | {
      kind: WorkerReply.StanReturn;
      error: null;
      draws: number[][];
      paramNames: string[];
      consoleMessages: ConsoleMessage[];
      sampleConfig: SampleConfig;
    }
  | { kind: WorkerReply.StanReturn; error: string };
