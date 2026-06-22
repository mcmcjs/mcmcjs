/** The outcome of a single inference run. */
export interface FitResult {
  status: "ok" | "error" | "cancelled";
  /** Path to the samples file written on success. */
  samplesFile?: string;
  /** The requested runtime version (e.g. a Julia channel). */
  runtimeRequested: string;
  /** The concrete runtime version that ran, when known. */
  runtimeActual?: string;
  elapsedMs: number;
  /** Where a failed run failed, when the runtime reports it. */
  stage?: "compile" | "sample" | "load_samples" | "predict" | "write" | "spawn" | "worker";
  error?: string;
}
