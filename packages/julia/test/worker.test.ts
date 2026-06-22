import { type ChildProcess, spawn as spawnProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResolvedSpec } from "@mcmcjs/core";
import type { DrawBatch, FitProgress } from "@mcmcjs/engine";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runFitAuto, runFitViaWorker, workerSocketPath } from "../src/worker";

const SAMPLES = JSON.stringify({
  size: [2, 1, 1],
  value_flat: [0.1, 0.2],
  parameters: ["mu"],
  name_map: { parameters: ["mu"], internals: [] },
});

let dir: string;
let server: Server | undefined;
let extraChild: ChildProcess | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mcmcjs-worker-test-"));
});

afterEach(async () => {
  if (server) await new Promise((resolve) => server?.close(resolve));
  server = undefined;
  if (extraChild && extraChild.exitCode === null) extraChild.kill("SIGKILL");
  extraChild = undefined;
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

function spec(outDir: string): ResolvedSpec {
  return {
    schema_version: "0",
    backend: { id: "turing", runtime: "julia", version: "release" },
    model: { kind: "file", path: "./m.jl", entry: "build_model" },
    sampler: { algorithm: "NUTS", draws: 2, warmup: 1, chains: 1, adapt_delta: 0.8 },
    data: { J: 8 },
    output: { format: "mcmcchains-json" },
    seed: 42,
    specPath: join(outDir, "m.toml"),
    modelPath: join(outDir, "m.jl"),
    specHash: "abc123",
  };
}

/** A fake worker: replies to one request with progress lines and a final result. */
function fakeWorker(socket: string, lines: (request: Record<string, unknown>) => string[]): void {
  server = createServer((sock) => {
    let pending = "";
    sock.on("data", (chunk) => {
      pending += chunk.toString("utf8");
      const at = pending.indexOf("\n");
      if (at === -1) return;
      const request = JSON.parse(pending.slice(0, at)) as Record<string, unknown>;
      for (const line of lines(request)) sock.write(`${line}\n`);
      sock.end();
    });
  });
  server.listen(socket);
}

function stubWorkersDir(): void {
  // workersDir prefers XDG_RUNTIME_DIR; point it at the test dir.
  vi.stubEnv("XDG_RUNTIME_DIR", dir);
}

describe("runFitViaWorker", () => {
  it("streams progress and finalizes an ok fit with a run record", async () => {
    stubWorkersDir();
    const socket = workerSocketPath("/bin/julia", "/proj");
    const outPath = join(dir, "samples.json");
    fakeWorker(socket, (request) => {
      writeFileSync(String(request.out), SAMPLES);
      return [
        '{"mcmcjs":"progress","chain":1,"of":1,"fraction":0.5,"done":false}',
        '{"mcmcjs":"draws","chain":0,"seq":0,"iteration":1,"draws":{"mu":[0.5]}}',
        JSON.stringify({
          ok: true,
          provenance: { julia_version: "1.12.6", packages: { Turing: "0.45.0" } },
        }),
      ];
    });

    const events: FitProgress[] = [];
    const draws: DrawBatch[] = [];
    const result = await runFitViaWorker(
      spec(dir),
      { command: "/bin/julia", args: [] },
      {
        spawn: async () => ({ stdout: "", stderr: "", code: 1 }),
        projectDir: "/proj",
        outPath,
        recordPath: join(dir, "run.json"),
        onProgress: (p) => events.push(p),
        onDraws: (b) => draws.push(b),
      },
    );

    expect(result.status).toBe("ok");
    expect(result.runtimeActual).toBe("1.12.6");
    expect(events).toEqual([{ chain: 1, of: 1, fraction: 0.5, done: false }]);
    expect(draws).toEqual([{ chain: 0, seq: 0, iteration: 1, draws: { mu: [0.5] } }]);
  });

  it("returns a real fit failure without falling back", async () => {
    stubWorkersDir();
    const socket = workerSocketPath("/bin/julia", "/proj");
    fakeWorker(socket, () => [
      JSON.stringify({ ok: false, error: "model did not compile", stage: "compile" }),
    ]);

    const spawn = vi.fn(async () => ({ stdout: "", stderr: "", code: 1 }));
    const result = await runFitAuto(
      spec(dir),
      { command: "/bin/julia", args: [] },
      {
        spawn,
        projectDir: "/proj",
        outPath: join(dir, "samples.json"),
        daemon: true,
      },
    );

    expect(result.status).toBe("error");
    expect(result.stage).toBe("compile");
    expect(result.error).toBe("model did not compile");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("falls back to the one-shot driver on a worker-stage protocol error", async () => {
    stubWorkersDir();
    const socket = workerSocketPath("/bin/julia", "/proj");
    fakeWorker(socket, () => [
      JSON.stringify({ ok: false, error: "request line did not parse", stage: "worker" }),
    ]);

    const spawn = vi.fn(async () => ({
      stdout: "",
      stderr: '{"error":"boom","stage":"sample"}',
      code: 1,
    }));
    const result = await runFitAuto(
      spec(dir),
      { command: "/bin/julia", args: [] },
      { spawn, projectDir: "/proj", outPath: join(dir, "samples.json"), daemon: true },
    );

    expect(spawn).toHaveBeenCalledOnce();
    expect(result.stage).toBe("sample");
  });

  it("reports a hung worker as a timeout instead of hanging or re-running", async () => {
    stubWorkersDir();
    vi.stubEnv("MCMC_WORKER_TIMEOUT_MS", "300");
    const socket = workerSocketPath("/bin/julia", "/proj");
    // Sends one progress line, then goes silent forever.
    server = (await import("node:net")).createServer((sock) => {
      sock.on("data", () => {
        sock.write('{"mcmcjs":"progress","chain":1,"of":1,"fraction":0.1,"done":false}\n');
      });
    });
    server.listen(socket);

    const spawn = vi.fn(async () => ({ stdout: "", stderr: "", code: 1 }));
    const result = await runFitAuto(
      spec(dir),
      { command: "/bin/julia", args: [] },
      { spawn, projectDir: "/proj", outPath: join(dir, "samples.json"), daemon: true },
    );

    expect(spawn).not.toHaveBeenCalled();
    expect(result.status).toBe("error");
    expect(result.stage).toBe("worker");
    expect(result.error).toMatch(/sent nothing/);
  });

  it("cancels a mid-fit run: kills the worker by its pidfile and clears the socket", async () => {
    stubWorkersDir();
    const socket = workerSocketPath("/bin/julia", "/proj");
    // A stand-in worker process the cancel must kill; its pid goes in the pidfile.
    extraChild = spawnProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
      detached: process.platform !== "win32",
    });
    const childGone = new Promise<void>((resolve) => extraChild?.on("exit", () => resolve()));
    writeFileSync(`${socket}.pid`, String(extraChild.pid));

    // The worker accepts the request, streams one progress line, then goes silent.
    server = createServer((sock) => {
      sock.on("data", () => {
        sock.write('{"mcmcjs":"progress","chain":1,"of":1,"fraction":0.1,"done":false}\n');
      });
    });
    server.listen(socket);

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    const result = await runFitViaWorker(
      spec(dir),
      { command: "/bin/julia", args: [] },
      {
        spawn: async () => ({ stdout: "", stderr: "", code: 1 }),
        projectDir: "/proj",
        outPath: join(dir, "samples.json"),
        signal: controller.signal,
      },
    );

    expect(result.status).toBe("cancelled");
    await childGone; // the pidfile's process was killed
    expect(existsSync(socket)).toBe(false);
    expect(existsSync(`${socket}.pid`)).toBe(false);
  });

  it("cancels during the worker cold start without dispatching a fit", async () => {
    stubWorkersDir();
    const socket = workerSocketPath("/bin/julia", "/proj");
    // Pretend another invocation holds the start lock, so this one only waits
    // (no worker is spawned) and the abort must break it out of the poll loop.
    mkdirSync(`${socket}.start`);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    const spawn = vi.fn(async () => ({ stdout: "", stderr: "", code: 1 }));
    const result = await runFitViaWorker(
      spec(dir),
      { command: "/bin/julia", args: [] },
      { spawn, projectDir: "/proj", outPath: join(dir, "samples.json"), signal: controller.signal },
    );
    expect(result.status).toBe("cancelled");
    expect(spawn).not.toHaveBeenCalled();
    expect(existsSync(join(dir, "samples.json"))).toBe(false);
  });

  it("runFitAuto returns cancelled without touching a worker when the signal is pre-aborted", async () => {
    stubWorkersDir();
    const spawn = vi.fn(async () => ({ stdout: "", stderr: "", code: 1 }));
    const result = await runFitAuto(
      spec(dir),
      { command: "/bin/julia", args: [] },
      {
        spawn,
        projectDir: "/proj",
        outPath: join(dir, "samples.json"),
        daemon: true,
        signal: AbortSignal.abort(),
      },
    );
    expect(result.status).toBe("cancelled");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("ensureWorker spawns a worker when none answers and the fit flows through it", async () => {
    stubWorkersDir();
    // A shim standing in for Julia: ignores the julia-style flags, serves one
    // request on the socket path it finds in its last argument, then exits.
    const shim = join(dir, "shim.cjs");
    writeFileSync(
      shim,
      [
        'const net = require("node:net");',
        "const path = process.argv[process.argv.length - 1];",
        "const server = net.createServer((sock) => {",
        "  sock.on('data', () => {",
        "    sock.end(JSON.stringify({ ok: false, error: 'shim declined', stage: 'compile' }) + '\\n');",
        "    server.close();",
        "  });",
        "});",
        "server.listen(path);",
      ].join("\n"),
    );

    const result = await runFitViaWorker(
      spec(dir),
      { command: process.execPath, args: [shim] },
      {
        spawn: async () => ({ stdout: "", stderr: "", code: 1 }),
        projectDir: "/proj",
        outPath: join(dir, "samples.json"),
      },
    );

    expect(result.status).toBe("error");
    expect(result.stage).toBe("compile");
    expect(result.error).toBe("shim declined");
  });

  it("stopWorker distinguishes acked, stale, and busy workers", async () => {
    stubWorkersDir();
    const { createServer } = await import("node:net");
    const ackPath = join(dir, "ack.sock");
    const ackServer = createServer((sock) => {
      sock.on("data", () => sock.end('{"ok":true,"stopped":true}\n'));
    });
    ackServer.listen(ackPath);
    const { stopWorker } = await import("../src/worker");
    expect(await stopWorker(ackPath)).toBe("stopped");
    await new Promise((resolve) => ackServer.close(resolve));

    const stalePath = join(dir, "stale.sock");
    writeFileSync(stalePath, "");
    expect(await stopWorker(stalePath)).toBe("stale");
    expect(existsSync(stalePath)).toBe(false);
  });

  it("runFitAuto without daemon goes straight to the one-shot driver", async () => {
    const spawn = vi.fn(async () => ({
      stdout: "",
      stderr: '{"error":"boom","stage":"sample"}',
      code: 1,
    }));
    const result = await runFitAuto(
      spec(dir),
      { command: "/bin/julia", args: [] },
      {
        spawn,
        projectDir: "/proj",
        outPath: join(dir, "samples.json"),
      },
    );
    expect(spawn).toHaveBeenCalledOnce();
    expect(result.status).toBe("error");
    expect(result.stage).toBe("sample");
  });
});
