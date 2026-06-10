import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GraphElementSchema, graphJsonSchema, UnifiedModelDataSchema } from "../src/schema";

const FIXTURES = fileURLToPath(new URL("./fixtures", import.meta.url));

describe("UnifiedModelDataSchema", () => {
  it("accepts every bundled example graph", () => {
    for (const file of readdirSync(join(FIXTURES, "examples"))) {
      const doc = JSON.parse(readFileSync(join(FIXTURES, "examples", file), "utf8"));
      const result = UnifiedModelDataSchema.safeParse(doc);
      expect(result.success, `${file}: ${result.error?.message}`).toBe(true);
    }
  });

  it("rejects a node with an unknown nodeType and an edge without a target", () => {
    expect(
      GraphElementSchema.safeParse({ id: "a", name: "a", type: "node", nodeType: "magic" }).success,
    ).toBe(false);
    expect(GraphElementSchema.safeParse({ id: "e", type: "edge", source: "a" }).success).toBe(
      false,
    );
  });

  it("keeps editor-only keys (positions, styles) instead of rejecting them", () => {
    const parsed = UnifiedModelDataSchema.parse({
      name: "x",
      elements: [
        {
          id: "a",
          name: "a",
          type: "node",
          nodeType: "constant",
          position: { x: 1, y: 2 },
          style: { color: "red" },
        },
      ],
    });
    expect(parsed.elements).toHaveLength(1);
  });
});

describe("graphJsonSchema", () => {
  it("produces a JSON Schema document describing the graph format", () => {
    const schema = graphJsonSchema();
    expect(schema.$schema).toContain("json-schema.org");
    expect(JSON.stringify(schema)).toContain("nodeType");
  });
});
