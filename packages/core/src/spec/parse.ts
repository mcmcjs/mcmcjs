import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parse as parseToml } from "smol-toml";
import { ZodError } from "zod";
import { hashSpec } from "./normalize";
import { type Spec, SpecSchema } from "./schema";

export interface ResolvedSpec extends Spec {
  /** Absolute path to the spec file. */
  specPath: string;
  /** Absolute path to the model file (model.path resolved against the spec's directory). */
  modelPath: string;
  /** Absolute path to the data file when the spec references one (data_file). */
  dataFilePath?: string;
  /** sha256 of the canonical spec, over the authored (relative) model path. */
  specHash: string;
}

function parseDocument(path: string, text: string): unknown {
  const isToml = path.endsWith(".toml");
  if (!isToml && !path.endsWith(".json")) {
    throw new Error(`unsupported spec extension (expected .toml or .json): ${path}`);
  }
  try {
    return isToml ? parseToml(text) : JSON.parse(text);
  } catch (error) {
    throw new Error(`invalid spec ${path}: ${(error as Error).message}`);
  }
}

/** Reads, validates, and resolves a spec file, producing absolute model paths. */
export function parseSpec(path: string): ResolvedSpec {
  const document = parseDocument(path, readFileSync(path, "utf8"));
  let spec: Spec;
  try {
    spec = SpecSchema.parse(document);
  } catch (error) {
    if (error instanceof ZodError) {
      const detail = error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      throw new Error(`invalid spec ${path}: ${detail}`);
    }
    throw error;
  }
  const specPath = resolve(path);
  return {
    ...spec,
    specPath,
    modelPath: resolve(dirname(specPath), spec.model.path),
    dataFilePath: spec.data_file ? resolve(dirname(specPath), spec.data_file) : undefined,
    specHash: hashSpec(spec),
  };
}
