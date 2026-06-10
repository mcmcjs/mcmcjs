import { describe, expect, it } from "vitest";
import { parseSamples } from "../src/parse-samples";

describe("parseSamples", () => {
  it("auto-detects MCMCChains JSON", () => {
    const s = parseSamples({
      size: [2, 1, 2],
      value_flat: [1, 2, 1.1, 2.1],
      parameters: ["mu"],
      name_map: { internals: [] },
    });
    expect(s.variables).toEqual(["mu"]);
    expect(s.nChains).toBe(2);
    expect(s.nDraws).toBe(2);
  });

  it("auto-detects ArviZ InferenceData JSON", () => {
    const s = parseSamples({
      posterior: {
        data_vars: {
          mu: {
            dims: ["chain", "draw"],
            data: [
              [1, 2],
              [3, 4],
            ],
          },
        },
      },
    });
    expect(s.variables).toEqual(["mu"]);
    expect(s.nChains).toBe(2);
  });

  it("accepts a JSON string", () => {
    const s = parseSamples(
      '{"posterior":{"data_vars":{"x":{"dims":["chain","draw"],"data":[[1,2]]}}}}',
    );
    expect(s.variables).toEqual(["x"]);
  });

  it("throws on an unrecognized format", () => {
    expect(() => parseSamples({ foo: "bar" })).toThrow(/unrecognized/);
    expect(() => parseSamples(42 as unknown as object)).toThrow(/JSON object/);
  });
});
