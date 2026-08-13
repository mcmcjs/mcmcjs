import { describe, expect, it } from "vitest";
import { assetName, checksumFor, createReporter, pickCliTag, progressLine } from "../src/update";

describe("assetName", () => {
  it("matches the release assets the install script fetches", () => {
    expect(assetName("linux", "x64")).toBe("mcmc-linux-x64.tar.gz");
    expect(assetName("linux", "arm64")).toBe("mcmc-linux-arm64.tar.gz");
    expect(assetName("darwin", "arm64")).toBe("mcmc-darwin-arm64.tar.gz");
    expect(assetName("win32", "x64")).toBe("mcmc-windows-x64.tar.gz");
  });

  it("treats an unknown platform as linux and an unknown cpu as x64", () => {
    expect(assetName("freebsd", "ppc64")).toBe("mcmc-linux-x64.tar.gz");
  });
});

describe("pickCliTag", () => {
  it("takes the newest CLI tag, ignoring the library releases", () => {
    expect(pickCliTag(["@mcmcjs/julia@0.14.1", "mcmcjs@0.26.1", "mcmcjs@0.26.0"])).toBe("0.26.1");
  });

  it("returns nothing when no CLI release is listed", () => {
    expect(pickCliTag(["@mcmcjs/core@0.11.0", ""])).toBeUndefined();
    expect(pickCliTag([])).toBeUndefined();
  });

  it("ignores a tag that is not a plain version", () => {
    expect(pickCliTag(["mcmcjs@0.27.0-beta.1", "mcmcjs@0.26.1"])).toBe("0.26.1");
  });
});

describe("checksumFor", () => {
  const manifest = ["aaa111  mcmc-linux-x64.tar.gz", "bbb222  mcmc-darwin-arm64.tar.gz", ""].join(
    "\n",
  );

  it("finds the sum for one asset", () => {
    expect(checksumFor(manifest, "mcmc-darwin-arm64.tar.gz")).toBe("bbb222");
  });

  it("returns nothing for an asset that is not listed", () => {
    expect(checksumFor(manifest, "mcmc-windows-x64.tar.gz")).toBeUndefined();
    expect(checksumFor("", "mcmc-linux-x64.tar.gz")).toBeUndefined();
  });
});

describe("progressLine", () => {
  it("draws a bar with the percentage and the megabytes", () => {
    expect(progressLine(19_922_944, 39_845_888)).toBe(
      "[############............]  50%  19.0/38.0 MB",
    );
  });

  it("fills at the end and never overshoots", () => {
    expect(progressLine(100, 100)).toContain("100%");
    expect(progressLine(150, 100)).toContain("100%");
    expect(progressLine(150, 100)).not.toContain("150%");
  });

  // A release without a content-length still has to show something moving.
  it("falls back to the size when the total is unknown", () => {
    expect(progressLine(1_048_576, undefined)).toBe("1.0 MB");
  });
});

describe("createReporter", () => {
  const collect = () => {
    const out: string[] = [];
    return { out, write: (text: string) => out.push(text) };
  };

  it("redraws one line on a terminal, padding over the last one", () => {
    const { out, write } = collect();
    const step = createReporter({ write, tty: true });
    step.progress("a longer line");
    step.progress("short");
    step.done();
    expect(out[0]).toBe("\ra longer line");
    expect(out[1]).toBe("\rshort        ");
    expect(out[2]).toBe("\n");
  });

  it("writes no control characters when the output is piped", () => {
    const { out, write } = collect();
    const step = createReporter({ write, tty: false });
    step.line("downloading");
    step.progress("[###...] 50%");
    step.done();
    expect(out).toEqual(["downloading\n"]);
  });

  it("says nothing at all under --json", () => {
    const { out, write } = collect();
    const step = createReporter({ write, tty: true, silent: true });
    step.line("downloading");
    step.progress("50%");
    step.done();
    expect(out).toEqual([]);
  });
});
