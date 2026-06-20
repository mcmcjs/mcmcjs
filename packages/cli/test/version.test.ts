import { describe, expect, it } from "vitest";
import { versionText } from "../src/version";

const META = {
  description: "Command-line tools for Bayesian modelling and MCMC inference.",
  authorName: "Shravan Goswami",
  authorUrl: "https://shravangoswami.com",
  license: "MIT",
  homepage: "https://github.com/mcmcjs/mcmcjs",
  year: 2026,
};

describe("versionText", () => {
  it("puts a parseable version on the first line (GNU style)", () => {
    const first = versionText("0.9.0", META).split("\n")[0] ?? "";
    expect(first).toBe("mcmc (mcmcjs) 0.9.0");
    // The semver is recoverable from line 1, as scripts expect.
    expect(first.match(/\d+\.\d+\.\d+/)?.[0]).toBe("0.9.0");
  });

  it("includes description, copyright with year, license, and homepage", () => {
    const text = versionText("0.9.0", META);
    expect(text).toContain(META.description);
    expect(text).toContain(
      "Copyright © 2026 Shravan Goswami <https://shravangoswami.com>. MIT license.",
    );
    expect(text).toContain("https://github.com/mcmcjs/mcmcjs");
  });

  it("omits the author URL when absent", () => {
    const text = versionText("1.0.0", { ...META, authorUrl: undefined });
    expect(text).toContain("Copyright © 2026 Shravan Goswami. MIT license.");
    expect(text).not.toContain("<");
  });
});
