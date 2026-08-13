import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatInstall } from "../src/doctor";
import { COMPILED, copiesOnPath, installKind, selfInvocation } from "../src/self";

describe("selfInvocation", () => {
  it("re-invokes the npm build through node and the entry script", () => {
    const self = selfInvocation(["__report-daemon"]);
    expect(self.command).toBe(process.execPath);
    expect(self.args).toEqual([process.argv[1], "__report-daemon"]);
  });

  it("knows it is not a compiled binary under the test build", () => {
    expect(COMPILED).toBe(false);
    expect(installKind()).toBe("npm");
  });
});

describe("copiesOnPath", () => {
  const exec = (paths: string[]) => (candidate: string) => paths.includes(candidate);

  it("lists each directory's copy in PATH order", () => {
    const path = ["/a/bin", "/b/bin", "/c/bin"].join(delimiter);
    const found = copiesOnPath(path, exec([join("/a/bin", "mcmc"), join("/c/bin", "mcmc")]));
    expect(found).toEqual([join("/a/bin", "mcmc"), join("/c/bin", "mcmc")]);
  });

  it("ignores empty entries and repeated directories", () => {
    const path = ["/a/bin", "", "/a/bin"].join(delimiter);
    expect(copiesOnPath(path, exec([join("/a/bin", "mcmc")]))).toEqual([join("/a/bin", "mcmc")]);
  });

  it("returns nothing when PATH is unset or holds no copy", () => {
    expect(copiesOnPath(undefined, () => false)).toEqual([]);
    expect(copiesOnPath("/a/bin", () => false)).toEqual([]);
  });
});

describe("formatInstall", () => {
  it("names the running copy and how it was installed", () => {
    expect(formatInstall(["/home/u/.local/bin/mcmc"], "binary")).toBe(
      "install: standalone binary at /home/u/.local/bin/mcmc",
    );
    expect(formatInstall(["/usr/lib/node_modules/.bin/mcmc"], "npm")).toContain("npm package");
  });

  it("warns about a second copy and says which one wins", () => {
    const text = formatInstall(["/home/u/.local/bin/mcmc", "/usr/bin/mcmc"], "binary");
    expect(text).toContain("another mcmc is on PATH at /usr/bin/mcmc");
    expect(text).toContain("the one above wins");
  });

  it("copes with no copy on PATH at all", () => {
    expect(formatInstall([], "npm")).toBe("install: npm package");
  });
});
