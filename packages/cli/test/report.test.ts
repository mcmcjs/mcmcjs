import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_REPORT_APP, reportUrl, resolveAppUrl, serveStore } from "../src/report";

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

describe("serveStore", () => {
  it("serves the linked run, the ledger, and any run under the token", async () => {
    const storeDir = mkdtempSync(join(tmpdir(), "mcmc-report-store-"));
    const entry = {
      id: "20260724-000000-aa1122",
      run_key: "k",
      spec_hash: "h",
      status: "ok",
      model_path: "m.jl",
      data_sha256: "d",
      seed: 1,
      backend: { id: "turing", version: "release" },
      sampler: { algorithm: "NUTS", draws: 2, warmup: 1, chains: 1, adapt_delta: 0.8 },
      started_at: new Date().toISOString(),
      elapsed_ms: 10,
    };
    writeFileSync(
      join(storeDir, "index.json"),
      JSON.stringify({ schema_version: "0", runs: [entry] }),
    );
    const dir = join(storeDir, "runs", entry.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "m.jl"), "using Turing\n");
    writeFileSync(
      join(dir, "spec.toml"),
      [
        'schema_version = "0"',
        "seed = 1",
        "[backend]",
        'id = "turing"',
        "[model]",
        'kind = "file"',
        'path = "./m.jl"',
        "[sampler]",
        "draws = 2",
        "warmup = 1",
        "chains = 1",
        "[data]",
        "y = [1.0, 2.0]",
      ].join("\n"),
    );
    writeFileSync(
      join(dir, "samples.json"),
      JSON.stringify({
        size: [2, 1, 1],
        value_flat: [1, 2],
        parameters: ["p"],
        name_map: { parameters: ["p"], internals: [] },
      }),
    );

    const { url, server } = await serveStore(storeDir, entry.id, "https://app.example", () => {});

    const preflight = await fetch(url, { method: "OPTIONS" });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("https://app.example");
    expect(preflight.headers.get("access-control-allow-private-network")).toBe("true");

    expect((await fetch(new URL("/wrong", url))).status).toBe(404);

    const linked = await fetch(url);
    expect(linked.status).toBe(200);
    const bundle = (await linked.json()) as { kind: string; entry: { id: string } };
    expect(bundle.kind).toBe("mcmcjs-run-bundle");
    expect(bundle.entry.id).toBe(entry.id);

    const ledger = await fetch(`${url}/ledger`);
    expect(ledger.status).toBe(200);
    expect(((await ledger.json()) as { id: string }[])[0]?.id).toBe(entry.id);

    const byId = await fetch(`${url}/run/${entry.id}`);
    expect(byId.status).toBe(200);
    expect((await fetch(`${url}/run/nope`)).status).toBe(404);

    server.close();
    rmSync(storeDir, { recursive: true, force: true });
  });
});
