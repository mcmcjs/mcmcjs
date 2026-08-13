import { describe, expect, it } from "vitest";
import { assetName, checksumFor, pickCliTag } from "../src/update";

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
