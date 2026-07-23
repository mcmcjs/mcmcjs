import { describe, expect, it } from "vitest";
import { candidateDescents, descend, pathSegments } from "../src/lib/locate";

function fakeDir(name: string, children: Record<string, unknown> = {}): unknown {
  return {
    name,
    kind: "directory",
    getDirectoryHandle(child: string) {
      const next = children[child];
      if (!next) return Promise.reject(new Error("NotFoundError"));
      return Promise.resolve(next);
    },
  };
}

describe("pathSegments", () => {
  it("splits an absolute path and drops empties", () => {
    expect(pathSegments("/home/user/project/.mcmc")).toEqual(["home", "user", "project", ".mcmc"]);
  });
});

describe("candidateDescents", () => {
  it("yields the remaining segments below every name match, shortest first", () => {
    const path = "/home/user/work/user/project/.mcmc";
    expect(candidateDescents("user", path)).toEqual([
      ["project", ".mcmc"],
      ["work", "user", "project", ".mcmc"],
    ]);
  });

  it("is empty when the name never appears", () => {
    expect(candidateDescents("elsewhere", "/home/user/.mcmc")).toEqual([]);
  });
});

describe("descend", () => {
  it("walks nested directories and returns null on a missing segment", async () => {
    const store = fakeDir(".mcmc");
    const root = fakeDir("work", {
      project: fakeDir("project", { ".mcmc": store }),
    }) as FileSystemDirectoryHandle;
    expect(await descend(root, ["project", ".mcmc"])).toBe(store);
    expect(await descend(root, ["missing", ".mcmc"])).toBeNull();
    expect(await descend(root, [])).toBe(root);
  });
});
