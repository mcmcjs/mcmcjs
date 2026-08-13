import { describe, expect, it } from "vitest";
import { banner, bannerWidth } from "../src/logo";
import { versionText } from "../src/version";

const META = {
  description: "Command-line tools for Bayesian modelling and MCMC inference.",
  authorName: "Shravan Goswami",
  license: "MIT",
  homepage: "https://github.com/mcmcjs/mcmcjs",
  year: 2026,
};

describe("banner", () => {
  it("spells the wordmark in rows of equal width", () => {
    const lines = banner({ color: false, trace: false }).split("\n");
    expect(lines).toHaveLength(3);
    const widths = new Set(lines.map((line) => line.length));
    expect(widths.size).toBe(1);
    expect(lines[0]?.trim().startsWith("█▀▄▀█")).toBe(true);
  });

  it("adds the trace line unless asked not to", () => {
    expect(banner({ color: false }).split("\n")).toHaveLength(4);
    expect(banner({ color: false, trace: false }).split("\n")).toHaveLength(3);
  });

  it("indents every line the same way", () => {
    for (const line of banner({ color: false, indent: "    " }).split("\n")) {
      expect(line.startsWith("    ")).toBe(true);
    }
  });

  it("measures one row without the indent", () => {
    // M C M C, each letter plus a separating space.
    expect(bannerWidth()).toBe(5 + 1 + 3 + 1 + 5 + 1 + 3);
    expect(banner({ color: false, indent: "" }).split("\n")[0]).toHaveLength(bannerWidth());
  });
});

describe("versionText with the wordmark", () => {
  it("keeps the parseable version on line 1", () => {
    const lines = versionText("1.2.3", META, true).split("\n");
    expect(lines[0]).toBe("mcmc (mcmcjs) 1.2.3");
  });

  it("still carries the description, copyright, and homepage", () => {
    const text = versionText("1.2.3", META, true);
    expect(text).toContain(META.description);
    expect(text).toContain("MIT license");
    expect(text).toContain(META.homepage);
  });

  it("leaves output for scripts exactly as it was", () => {
    expect(versionText("1.2.3", META)).toBe(versionText("1.2.3", META, false));
    expect(versionText("1.2.3", META).split("\n")).toHaveLength(4);
  });
});
