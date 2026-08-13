import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_REPORT_APP, reportUrl, resolveAppUrl } from "../src/report";
import {
  parseRoute,
  readOrCreateToken,
  registerStore,
  serve,
  storeId,
  storeUrl,
} from "../src/report-daemon";

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

describe("storeId", () => {
  it("is stable per absolute path and differs between stores", () => {
    expect(storeId("/tmp/a/.mcmc")).toBe(storeId("/tmp/a/.mcmc"));
    expect(storeId("/tmp/a/.mcmc")).not.toBe(storeId("/tmp/b/.mcmc"));
    expect(storeId("/tmp/a/.mcmc")).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe("parseRoute", () => {
  it("reads the store, ledger, and run paths", () => {
    expect(parseRoute("/v1/tok/stores")).toEqual({ token: "tok", kind: "stores" });
    expect(parseRoute("/v1/tok/stores/abc/ledger")).toEqual({
      token: "tok",
      storeId: "abc",
      kind: "ledger",
    });
    expect(parseRoute("/v1/tok/stores/abc/runs/r1")).toEqual({
      token: "tok",
      storeId: "abc",
      kind: "run",
      runId: "r1",
    });
  });

  it("rejects anything outside the versioned tree", () => {
    expect(parseRoute("/")).toBeUndefined();
    expect(parseRoute("/health")).toBeUndefined();
    expect(parseRoute("/v2/tok/stores")).toBeUndefined();
    expect(parseRoute("/v1/tok/other")?.kind).toBe("unknown");
    expect(parseRoute("/v1/tok/stores/abc/runs")?.kind).toBe("unknown");
  });
});

const ORIGIN = "https://app.example";
const OTHER_ORIGIN = "https://evil.example";

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

function makeStore(): string {
  const storeDir = mkdtempSync(join(tmpdir(), "mcmc-report-store-"));
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
  return storeDir;
}

describe("the store server", () => {
  let home: string;
  let storeDir: string;

  beforeEach(() => {
    // Point the daemon's state, token, and registry at a scratch data dir.
    home = mkdtempSync(join(tmpdir(), "mcmc-report-home-"));
    process.env.XDG_DATA_HOME = home;
    storeDir = makeStore();
  });

  afterEach(() => {
    delete process.env.XDG_DATA_HOME;
    rmSync(home, { recursive: true, force: true });
    rmSync(storeDir, { recursive: true, force: true });
  });

  it("serves the registered store's ledger and runs under the paired token", async () => {
    const store = registerStore(storeDir, ORIGIN);
    const { server, port } = await serve({ port: 0 });
    const base = storeUrl(port, readOrCreateToken(), store.id);

    const preflight = await fetch(base, { method: "OPTIONS", headers: { Origin: ORIGIN } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(preflight.headers.get("access-control-allow-private-network")).toBe("true");
    // Without a cached preflight every request re-negotiates, which is what
    // made the first connection feel broken.
    expect(preflight.headers.get("access-control-max-age")).toBe("86400");

    const ledger = await fetch(`${base}/ledger`, { headers: { Origin: ORIGIN } });
    expect(ledger.status).toBe(200);
    expect(((await ledger.json()) as { id: string }[])[0]?.id).toBe(entry.id);

    const bundle = await fetch(`${base}/runs/${entry.id}`, { headers: { Origin: ORIGIN } });
    expect(bundle.status).toBe(200);
    expect(((await bundle.json()) as { kind: string }).kind).toBe("mcmcjs-run-bundle");

    expect((await fetch(`${base}/runs/nope`)).status).toBe(404);
    server.close();
  });

  it("lists every registered store, so a reconnecting app needs no link", async () => {
    const store = registerStore(storeDir, ORIGIN);
    const { server, port } = await serve({ port: 0 });
    const response = await fetch(`http://127.0.0.1:${port}/v1/${readOrCreateToken()}/stores`, {
      headers: { Origin: ORIGIN },
    });
    const listing = (await response.json()) as { id: string; path: string; runs: number }[];
    expect(listing).toEqual([{ id: store.id, path: storeDir, runs: 1 }]);
    server.close();
  });

  it("answers /health without a token so the CLI can probe it", async () => {
    const { server, port } = await serve({ port: 0 });
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { mcmcjs: boolean }).mcmcjs).toBe(true);
    server.close();
  });

  it("refuses a wrong token and anything that is not a GET", async () => {
    registerStore(storeDir, ORIGIN);
    const { server, port } = await serve({ port: 0 });
    expect((await fetch(`http://127.0.0.1:${port}/v1/nope/stores`)).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${port}/health`, { method: "POST" })).status).toBe(405);
    server.close();
  });

  it("never grants CORS to an origin the CLI did not register", async () => {
    registerStore(storeDir, ORIGIN);
    const { server, port } = await serve({ port: 0 });
    const response = await fetch(`http://127.0.0.1:${port}/v1/${readOrCreateToken()}/stores`, {
      headers: { Origin: OTHER_ORIGIN },
    });
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    server.close();
  });

  it("shuts down after the idle window", async () => {
    const closed = new Promise<void>((done) => {
      serve({ port: 0, idleMs: 30, onIdle: () => done() }).then(({ server }) => {
        server.on("close", () => {});
      });
    });
    await expect(closed).resolves.toBeUndefined();
  });
});
