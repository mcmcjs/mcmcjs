import { describe, expect, it } from "vitest";
import { parseObservedData } from "../src/observed";

describe("observed data", () => {
  it("keeps model term names and array values", () => {
    expect(
      parseObservedData(
        JSON.stringify({ schema_version: 1, terms: [{ name: "y", value: [1, 2] }] }),
      ),
    ).toEqual({ schema_version: 1, terms: [{ name: "y", value: [1, 2] }] });
  });

  it("rejects duplicate sites and values that cannot represent observations", () => {
    expect(() =>
      parseObservedData(
        JSON.stringify({
          schema_version: 1,
          terms: [
            { name: "y", value: 1 },
            { name: "y", value: 2 },
          ],
        }),
      ),
    ).toThrow(/duplicate/);
    expect(() =>
      parseObservedData(JSON.stringify({ schema_version: 1, terms: [{ name: "y", value: null }] })),
    ).toThrow(/invalid/);
  });
});
