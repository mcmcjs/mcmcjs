import { describe, expect, it } from "vitest";
import { DEFAULT_REPORT_APP, reportUrl, resolveAppUrl, serveBundleOnce } from "../src/report";

describe("reportUrl", () => {
  it("deep-links the run id and store path in the hash", () => {
    const url = reportUrl("https://example.com/report", "/tmp/store/.mcmc", "20260723-1-ab");
    expect(url).toBe("https://example.com/report/#run=20260723-1-ab&store=%2Ftmp%2Fstore%2F.mcmc");
  });

  it("appends the loopback handoff when serving", () => {
    const url = reportUrl("https://example.com/report", "/s", "id1", "http://127.0.0.1:9/t");
    expect(url).toContain("&connect=http%3A%2F%2F127.0.0.1%3A9%2Ft");
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

describe("serveBundleOnce", () => {
  it("answers the preflight, serves the token once, then closes", async () => {
    let done = false;
    const { url, server } = await serveBundleOnce('{"ok":true}', "https://app.example", () => {
      done = true;
    });

    const preflight = await fetch(url, { method: "OPTIONS" });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("https://app.example");
    expect(preflight.headers.get("access-control-allow-private-network")).toBe("true");

    const miss = await fetch(new URL("/wrong", url));
    expect(miss.status).toBe(404);

    const hit = await fetch(url);
    expect(hit.status).toBe(200);
    expect(await hit.json()).toEqual({ ok: true });

    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(done).toBe(true);
    expect(server.listening).toBe(false);
  });
});
