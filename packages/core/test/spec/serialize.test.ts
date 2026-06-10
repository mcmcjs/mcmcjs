import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSpec } from "../../src/spec/parse";
import { serializeSpecToml } from "../../src/spec/serialize";

describe("serializeSpecToml", () => {
  it("emits TOML that parseSpec reads back, preserving data arrays and matrices", () => {
    const toml = serializeSpecToml({
      schema_version: "0",
      seed: 7,
      backend: { id: "juliabugs" },
      model: { kind: "file", path: "./m.jl" },
      sampler: { algorithm: "NUTS", draws: 500 },
      data: {
        N: 2,
        y: [1, 2],
        x: [
          [1, 2],
          [3, 4],
        ],
      },
    });
    const dir = mkdtempSync(join(tmpdir(), "mcmcjs-serialize-"));
    const path = join(dir, "spec.toml");
    writeFileSync(path, toml);

    const spec = parseSpec(path);
    expect(spec.backend.id).toBe("juliabugs");
    expect(spec.sampler.draws).toBe(500);
    expect(spec.data).toEqual({
      N: 2,
      y: [1, 2],
      x: [
        [1, 2],
        [3, 4],
      ],
    });
  });
});
