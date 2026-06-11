import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isNewer,
  isStale,
  readUpdateCache,
  updateNote,
  writeUpdateCache,
} from "../src/update-check";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mcmcjs-update-test-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("isNewer", () => {
  it("compares plain x.y.z versions numerically", () => {
    expect(isNewer("0.7.0", "0.6.0")).toBe(true);
    expect(isNewer("0.6.10", "0.6.9")).toBe(true);
    expect(isNewer("1.0.0", "0.9.9")).toBe(true);
    expect(isNewer("0.6.0", "0.6.0")).toBe(false);
    expect(isNewer("0.5.9", "0.6.0")).toBe(false);
  });

  it("treats unparsable versions as not newer", () => {
    expect(isNewer("0.7.0-beta.1", "0.6.0")).toBe(false);
    expect(isNewer("garbage", "0.6.0")).toBe(false);
    expect(isNewer("0.7.0", "workspace:*")).toBe(false);
  });
});

describe("isStale", () => {
  const now = Date.parse("2026-06-11T12:00:00.000Z");

  it("is stale without a cache or past a day", () => {
    expect(isStale(undefined, now)).toBe(true);
    expect(isStale({ checked_at: "2026-06-09T12:00:00.000Z", latest: "0.6.0" }, now)).toBe(true);
    expect(isStale({ checked_at: "not a date", latest: "0.6.0" }, now)).toBe(true);
  });

  it("is fresh within a day", () => {
    expect(isStale({ checked_at: "2026-06-11T02:00:00.000Z", latest: "0.6.0" }, now)).toBe(false);
  });
});

describe("update cache io", () => {
  it("round-trips and rejects malformed content", () => {
    const path = join(dir, "nested", "update-check.json");
    expect(readUpdateCache(path)).toBeUndefined();
    writeUpdateCache({ checked_at: "2026-06-11T00:00:00.000Z", latest: "0.7.0" }, path);
    expect(readUpdateCache(path)).toEqual({
      checked_at: "2026-06-11T00:00:00.000Z",
      latest: "0.7.0",
    });
  });
});

describe("updateNote", () => {
  it("names both versions and the update command", () => {
    const note = updateNote("0.7.0", "0.6.0");
    expect(note).toContain("mcmcjs 0.7.0 is available");
    expect(note).toContain("you have 0.6.0");
    expect(note).toContain("npm install -g mcmcjs");
  });
});
