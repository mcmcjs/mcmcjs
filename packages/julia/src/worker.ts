import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResolvedSpec } from "@mcmcjs/core";
import type { FitResult } from "@mcmcjs/engine";
import { parseProgressLine } from "@mcmcjs/engine";
import { type FitIo, finalizeOkFit, fitRequest, runFit } from "./fit";
import { sha256, toStage, workerPath } from "./runner-common";

const START_WAIT_MS = 180_000;
const CONNECT_TIMEOUT_MS = 1_000;

/** Where worker sockets live; runtime dir when available, the shared tmp parent otherwise. */
export function workersDir(): string {
  const runtime = process.env.XDG_RUNTIME_DIR;
  const dir = runtime ? join(runtime, "mcmcjs") : join(tmpdir(), "mcmcjs", "workers");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/** One worker per (Julia binary, project env) pair, named by a key hash. */
export function workerSocketPath(command: string, projectDir: string): string {
  return join(workersDir(), `worker-${sha256(`${command}\n${projectDir}`).slice(0, 12)}.sock`);
}

function connectOnce(path: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const sock = createConnection(path);
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error("connect timeout"));
    }, CONNECT_TIMEOUT_MS);
    sock.once("connect", () => {
      clearTimeout(timer);
      resolve(sock);
    });
    sock.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Connects to the keyed worker, starting one (detached) if none answers. */
export async function ensureWorker(
  resolved: { command: string; args: string[] },
  projectDir: string,
  notify?: (line: string) => void,
): Promise<Socket> {
  const path = workerSocketPath(resolved.command, projectDir);
  try {
    return await connectOnce(path);
  } catch {}
  rmSync(path, { force: true });
  notify?.("starting the Julia worker (first use loads Turing, can take a minute)...");
  const child = spawn(
    resolved.command,
    [...resolved.args, "--startup-file=no", `--project=${projectDir}`, workerPath(), path],
    { detached: true, stdio: "ignore" },
  );
  child.unref();
  const deadline = Date.now() + START_WAIT_MS;
  for (;;) {
    try {
      return await connectOnce(path);
    } catch {}
    if (Date.now() > deadline) throw new Error("the Julia worker did not start in time");
    await delay(250);
  }
}

/** Streams progress lines to onProgress and resolves with the final result line. */
function readWorkerResponse(
  sock: Socket,
  onProgress?: FitIo["onProgress"],
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let pending = "";
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };
    sock.on("data", (chunk: Buffer) => {
      pending += chunk.toString("utf8");
      for (;;) {
        const at = pending.indexOf("\n");
        if (at === -1) break;
        const line = pending.slice(0, at).trim();
        pending = pending.slice(at + 1);
        if (!line) continue;
        const progress = parseProgressLine(line);
        if (progress) {
          onProgress?.(progress);
          continue;
        }
        try {
          const doc = JSON.parse(line) as Record<string, unknown>;
          settle(() => {
            sock.end();
            resolve(doc);
          });
          return;
        } catch {}
      }
    });
    sock.on("error", (error) => settle(() => reject(error)));
    sock.on("close", () => settle(() => reject(new Error("worker closed the connection"))));
  });
}

/** Runs one fit through the persistent worker. Throws on worker-infrastructure failure. */
export async function runFitViaWorker(
  spec: ResolvedSpec,
  resolved: { command: string; args: string[] },
  io: FitIo & { notify?: (line: string) => void },
): Promise<FitResult> {
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const sock = await ensureWorker(resolved, io.projectDir, io.notify);
  sock.write(`${JSON.stringify(fitRequest(spec, io.outPath))}\n`);
  const final = await readWorkerResponse(sock, io.onProgress);
  const elapsedMs = Math.round(performance.now() - start);

  if (final.ok !== true) {
    return {
      status: "error",
      runtimeRequested: spec.backend.version,
      elapsedMs,
      stage: toStage(final.stage),
      error: String(final.error ?? "worker error"),
    };
  }
  return finalizeOkFit(
    spec,
    resolved,
    io,
    final.provenance as Record<string, unknown> | undefined,
    startedAt,
    elapsedMs,
  );
}

/**
 * Runs a fit through the worker when asked (and possible), falling back to the
 * one-shot driver on any worker-infrastructure failure. A fit that genuinely
 * fails (model error, divergence at compile) is returned, not retried.
 */
export async function runFitAuto(
  spec: ResolvedSpec,
  resolved: { command: string; args: string[] },
  io: FitIo & { daemon?: boolean; notify?: (line: string) => void },
): Promise<FitResult> {
  if (io.daemon && process.platform !== "win32") {
    try {
      return await runFitViaWorker(spec, resolved, io);
    } catch (error) {
      io.notify?.(
        `worker unavailable (${(error as Error).message}); falling back to a one-shot run`,
      );
    }
  }
  return runFit(spec, resolved, io);
}

export interface WorkerStatus {
  socket: string;
  alive: boolean;
}

/** Lists known worker sockets and whether each answers. */
export async function listWorkers(): Promise<WorkerStatus[]> {
  const dir = workersDir();
  const sockets = readdirSync(dir).filter((f) => f.startsWith("worker-") && f.endsWith(".sock"));
  const statuses: WorkerStatus[] = [];
  for (const name of sockets) {
    const socket = join(dir, name);
    let alive = false;
    try {
      const sock = await connectOnce(socket);
      sock.destroy();
      alive = true;
    } catch {}
    statuses.push({ socket, alive });
  }
  return statuses;
}

/** Asks one worker to shut down; removes the socket file either way. */
export async function stopWorker(socket: string): Promise<boolean> {
  let stopped = false;
  try {
    const sock = await connectOnce(socket);
    sock.write('{"mcmcjs":"stop"}\n');
    await new Promise<void>((resolve) => {
      const finish = () => resolve();
      sock.on("close", finish);
      sock.on("error", finish);
      setTimeout(finish, 3_000);
    });
    stopped = true;
  } catch {}
  if (existsSync(socket)) rmSync(socket, { force: true });
  return stopped;
}
