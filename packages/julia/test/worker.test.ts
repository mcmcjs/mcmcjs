import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResolvedSpec } from "@mcmcjs/core";
import type { FitProgress } from "@mcmcjs/engine";
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

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mcmcjs-worker-test-"));
});

afterEach(async () => {
  if (server) await new Promise((resolve) => server?.close(resolve));
  server = undefined;
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
        JSON.stringify({
          ok: true,
          provenance: { julia_version: "1.12.6", packages: { Turing: "0.45.0" } },
        }),
      ];
    });

    const events: FitProgress[] = [];
    const result = await runFitViaWorker(
      spec(dir),
      { command: "/bin/julia", args: [] },
      {
        spawn: async () => ({ stdout: "", stderr: "", code: 1 }),
        projectDir: "/proj",
        outPath,
        recordPath: join(dir, "run.json"),
        onProgress: (p) => events.push(p),
      },
    );

    expect(result.status).toBe("ok");
    expect(result.runtimeActual).toBe("1.12.6");
    expect(events).toEqual([{ chain: 1, of: 1, fraction: 0.5, done: false }]);
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
