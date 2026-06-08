import { createHash } from "node:crypto";
import type { Spec } from "./schema";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonical((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** Canonical, key-sorted JSON of any value; stable across key order. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonical(value));
}

/** Canonical, key-sorted JSON of a spec; stable across TOML/JSON authoring and key order. */
export function normalizeSpec(spec: Spec): string {
  return canonicalJson(spec);
}

/** Stable sha256 of the canonical spec, computed over the authored (relative) model path. */
export function hashSpec(spec: Spec): string {
  return createHash("sha256").update(normalizeSpec(spec)).digest("hex");
}
