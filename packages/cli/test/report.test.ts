import { describe, expect, it } from "vitest";
import { DEFAULT_REPORT_APP, reportUrl, resolveAppUrl } from "../src/report";

describe("reportUrl", () => {
  it("deep-links the run id and store path in the hash", () => {
    const url = reportUrl("https://example.com/report", "/tmp/store/.mcmc", "20260723-1-ab");
    expect(url).toBe("https://example.com/report/#run=20260723-1-ab&store=%2Ftmp%2Fstore%2F.mcmc");
  });
});

describe("resolveAppUrl", () => {
  it("prefers the flag, then the environment, then the hosted app", () => {
    expect(resolveAppUrl("http://localhost:5173")).toBe("http://localhost:5173");
    process.env.MCMC_REPORT_APP = "https://self-hosted.example";
    expect(resolveAppUrl()).toBe("https://self-hosted.example");
    delete process.env.MCMC_REPORT_APP;
    expect(resolveAppUrl()).toBe(DEFAULT_REPORT_APP);
  });
});
