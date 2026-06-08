export const RUN_RECORD_SCHEMA_VERSION = "0";

/** The reproducibility record written beside a samples file as `<out>.run.json`. */
export interface RunRecord {
  schema_version: string;
  spec_hash: string;
  seed: number;
  backend: { id: string; runtime: string };
  /** Requested channel, the concrete version that ran, and the resolved binary path. */
  runtime: { requested: string; actual?: string; path?: string };
  manifest_sha256?: string;
  packages?: Record<string, string>;
  model_sha256?: string;
  data_sha256?: string;
  /** The posterior samples file consumed by a predict run. */
  posterior_samples?: string;
  posterior_samples_sha256?: string;
  samples_file: string;
  started_at: string;
  elapsed_ms: number;
}
