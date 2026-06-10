import { describe, expect, it } from "vitest";
import { timeAgo } from "../src/store-cli";

describe("timeAgo", () => {
  const now = Date.parse("2026-06-11T12:00:00.000Z");

  it("buckets recent times", () => {
    expect(timeAgo("2026-06-11T11:59:30.000Z", now)).toBe("just now");
    expect(timeAgo("2026-06-11T11:55:00.000Z", now)).toBe("5m ago");
    expect(timeAgo("2026-06-11T10:00:00.000Z", now)).toBe("2h ago");
    expect(timeAgo("2026-06-08T12:00:00.000Z", now)).toBe("3d ago");
  });

  it("falls back to the date for old runs and to the input when unparseable", () => {
    expect(timeAgo("2025-01-01T00:00:00.000Z", now)).toBe("2025-01-01");
    expect(timeAgo("not-a-date", now)).toBe("not-a-date");
  });
});
