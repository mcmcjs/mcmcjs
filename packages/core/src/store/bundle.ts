import type { LedgerEntry } from "./ledger";

export const RUN_BUNDLE_KIND = "mcmcjs-run-bundle";
export const RUN_BUNDLE_SCHEMA_VERSION = "0";

/**
 * A self-contained, portable run: everything the report app needs to render a
 * full report from one file, with no access to the store it came from.
 */
export interface RunBundle {
  kind: typeof RUN_BUNDLE_KIND;
  schema_version: string;
  entry: LedgerEntry;
  /** The spec as parsed JSON (data inline), not TOML. */
  spec: Record<string, unknown>;
  model_source: string;
  /** The samples file content (MCMCChains-JSON wire object). */
  samples: Record<string, unknown>;
}

/** Parses and structurally validates a run bundle from JSON text. */
export function parseRunBundle(text: string): RunBundle {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`run bundle is not valid JSON: ${(error as Error).message}`);
  }
  const bundle = value as Partial<RunBundle>;
  if (bundle?.kind !== RUN_BUNDLE_KIND) {
    throw new Error(`not a run bundle (expected kind "${RUN_BUNDLE_KIND}")`);
  }
  if (typeof bundle.schema_version !== "string") {
    throw new Error("run bundle is missing schema_version");
  }
  for (const field of ["entry", "spec", "samples"] as const) {
    if (typeof bundle[field] !== "object" || bundle[field] === null) {
      throw new Error(`run bundle is missing ${field}`);
    }
  }
  if (typeof bundle.model_source !== "string") {
    throw new Error("run bundle is missing model_source");
  }
  return bundle as RunBundle;
}
