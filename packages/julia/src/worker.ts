import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, rmdirSync, rmSync, statSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { join } from "node:path";
import type { ResolvedSpec } from "@mcmcjs/core";
import type { FitResult } from "@mcmcjs/engine";
import { parseDrawBatchLine, parseProgressLine } from "@mcmcjs/engine";
import { type FitIo, finalizeOkFit, fitRequest, runFit } from "./fit";
import { sha256, sharedTmpParent, toStage, workerPath } from "./runner-common";

const START_WAIT_MS = 180_000;
const CONNECT_TIMEOUT_MS = 1_000;
const STOP_ACK_TIMEOUT_MS = 3_000;

/** Same 30-minute budget as the one-shot driver; MCMC_WORKER_TIMEOUT_MS overrides. */
function fitInactivityTimeoutMs(): number {
  const fromEnv = Number(process.env.MCMC_WORKER_TIMEOUT_MS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 30 * 60_000;
}

/** A hung worker is not retried; the fit is reported failed instead. */
class WorkerTimeoutError extends Error {}

/** Where worker sockets live; runtime dir when available, the shared tmp parent otherwise. */
export function workersDir(): string {
  const runtime = process.env.XDG_RUNTIME_DIR;
  const dir = runtime ? join(runtime, "mcmcjs") : join(sharedTmpParent(), "workers");
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

/**
 * Serializes cold starts: only one invocation spawns a worker per socket path;
 * the rest poll the socket. A stale lock (a dead spawner) is taken over.
 */
function acquireStartLock(socketPath: string): boolean {
  const lock = `${socketPath}.start`;
  try {
    mkdirSync(lock);
    return true;
  } catch {
    try {
      if (Date.now() - statSync(lock).mtimeMs > START_WAIT_MS) {
        rmdirSync(lock);
        mkdirSync(lock);
        return true;
      }
    } catch {}
    return false;
  }
}

function releaseStartLock(socketPath: string): void {
  try {
    rmdirSync(`${socketPath}.start`);
  } catch {}
}

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

  let spawnFailure: Error | undefined;
  const startedHere = acquireStartLock(path);
  if (startedHere) {
    try {
      rmSync(path, { force: true });
      notify?.("starting the Julia worker (first use loads Turing, can take a minute)...");
      const child = spawn(
        resolved.command,
        [...resolved.args, "--startup-file=no", `--project=${projectDir}`, workerPath(), path],
        { detached: true, stdio: "ignore" },
      );
      child.on("error", (error) => {
        spawnFailure = error;
      });
      child.on("exit", (code) => {
        if (code !== 0 && code !== null) {
          spawnFailure = new Error(`the worker exited with code ${code} before serving`);
        }
      });
      child.unref();
    } catch (error) {
      releaseStartLock(path);
      throw error;
    }
  }

  try {
    const deadline = Date.now() + START_WAIT_MS;
    for (;;) {
      if (spawnFailure) throw spawnFailure;
      try {
        return await connectOnce(path);
      } catch {}
      if (Date.now() > deadline) throw new Error("the Julia worker did not start in time");
      await delay(250);
    }
  } finally {
    if (startedHere) releaseStartLock(path);
  }
}

/**
 * Streams progress lines to onProgress and resolves with the final result
 * line. The inactivity deadline (reset by every byte the worker sends, so
 * healthy long fits survive on their progress stream) rejects with
 * WorkerTimeoutError rather than hanging forever on a wedged worker.
 */
function readWorkerResponse(
  sock: Socket,
  onProgress?: FitIo["onProgress"],
  onDraws?: FitIo["onDraws"],
  inactivityMs = fitInactivityTimeoutMs(),
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let pending = "";
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      sock.setTimeout(0);
      fn();
    };
    sock.setTimeout(inactivityMs, () => {
      const error = new WorkerTimeoutError(
        `the worker sent nothing for ${Math.round(inactivityMs / 60_000)} minutes`,
      );
      settle(() => {
        sock.destroy();
        reject(error);
      });
    });
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
        const batch = parseDrawBatchLine(line);
        if (batch) {
          onDraws?.(batch);
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
  const final = await readWorkerResponse(sock, io.onProgress, io.onDraws);
  const elapsedMs = Math.round(performance.now() - start);

  if (final.ok !== true) {
    // "worker" is the worker's own protocol failure, not a model failure;
    // throwing hands the fit to the one-shot driver.
    if (final.stage === "worker") throw new Error(String(final.error ?? "worker error"));
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
 * one-shot driver on worker-infrastructure failures. Two exceptions never fall
 * back: a fit that genuinely failed (model error) is returned, and a hung
 * worker (timeout) is reported rather than silently re-run for another
 * half hour.
 */
export async function runFitAuto(
  spec: ResolvedSpec,
  resolved: { command: string; args: string[] },
  io: FitIo & { daemon?: boolean; notify?: (line: string) => void },
): Promise<FitResult> {
  if (io.daemon && process.platform !== "win32") {
    const start = performance.now();
    try {
      return await runFitViaWorker(spec, resolved, io);
    } catch (error) {
      if (error instanceof WorkerTimeoutError) {
        return {
          status: "error",
          runtimeRequested: spec.backend.version,
          elapsedMs: Math.round(performance.now() - start),
          stage: "worker",
          error: `${error.message}; the worker may be wedged, try mcmc daemon stop`,
        };
      }
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

export type StopOutcome = "stopped" | "stale" | "pending";

/**
 * Asks one worker to shut down. "stopped": acknowledged and gone. "stale": the
 * socket was dead and its file was removed. "pending": the worker is busy with
 * a fit; the stop request is queued and honored when the fit finishes, so the
 * live socket file is left alone.
 */
export async function stopWorker(socket: string): Promise<StopOutcome> {
  let sock: Socket;
  try {
    sock = await connectOnce(socket);
  } catch {
    rmSync(socket, { force: true });
    return "stale";
  }
  const acked = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), STOP_ACK_TIMEOUT_MS);
    const finish = (ok: boolean) => {
      clearTimeout(timer);
      resolve(ok);
    };
    // Without a flowing readable side the worker's FIN is never surfaced.
    sock.resume();
    sock.on("close", () => finish(true));
    sock.on("error", () => finish(false));
    sock.write('{"mcmcjs":"stop"}\n');
  });
  sock.destroy();
  if (!acked) return "pending";
  rmSync(socket, { force: true });
  return "stopped";
}
