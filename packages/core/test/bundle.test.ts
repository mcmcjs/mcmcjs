import { describe, expect, it } from "vitest";
import { parseRunBundle, RUN_BUNDLE_KIND, RUN_BUNDLE_SCHEMA_VERSION } from "../src/store/bundle";

const bundle = {
  kind: RUN_BUNDLE_KIND,
  schema_version: RUN_BUNDLE_SCHEMA_VERSION,
  entry: { id: "20260723-000000-abc123" },
  spec: { data: { N: 2 } },
  model_source: "using Turing",
  samples: { size: [1, 1, 1] },
};

describe("parseRunBundle", () => {
  it("round-trips a valid bundle", () => {
    const parsed = parseRunBundle(JSON.stringify(bundle));
    expect(parsed.entry.id).toBe("20260723-000000-abc123");
    expect(parsed.model_source).toBe("using Turing");
  });

  it("rejects other JSON with a clear kind error", () => {
    expect(() => parseRunBundle('{"foo":1}')).toThrow(/not a run bundle/);
    expect(() => parseRunBundle("nope")).toThrow(/not valid JSON/);
  });

  it("names the missing field", () => {
    const { model_source, ...partial } = bundle;
    void model_source;
    expect(() => parseRunBundle(JSON.stringify(partial))).toThrow(/model_source/);
  });
});
