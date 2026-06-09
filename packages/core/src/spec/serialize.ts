import { stringify } from "smol-toml";

/** Serialize a spec object to TOML text (the inverse of `parseSpec`'s TOML read). */
export function serializeSpecToml(spec: Record<string, unknown>): string {
  return stringify(spec);
}
