import { describe, expect, it } from "vitest";
import { defaultPredictOut } from "./predict";

describe("defaultPredictOut", () => {
  it("derives the prediction output path from the samples file name", () => {
    expect(defaultPredictOut("/work/post.json")).toBe("/work/post.predict.json");
  });
});
