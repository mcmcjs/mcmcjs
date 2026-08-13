import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { type LedgerEntry, readLedger } from "@mcmcjs/core";
import { assembleBundle } from "./export";

declare const __MCMC_VERSION__: string;

/** The port the app tries first; the rest are only used when it is taken. */
export const DEFAULT_PORT = 7788;
export const PORT_RANGE = 5;
const IDLE_TIMEOUT_MS = 30 * 60_000;
const READY_TIMEOUT_MS = 8_000;
/** Assembled bundles are held for reuse, but a daemon outlives many runs. */
const CACHE_BYTES = 128 * 1024 * 1024;

export interface DaemonState {
  pid: number;
  port: number;
  version: string;
  started_at: string;
}

/** A store the daemon serves, as registered by `mcmc report`. */
export interface StoreRegistration {
  id: string;
  path: string;
  origins: string[];
}

function dataDir(): string {
  const base = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  return join(base, "mcmcjs", "report");
}

export const daemonStatePath = (): string => join(dataDir(), "daemon.json");
export const tokenPath = (): string => join(dataDir(), "token");
export const registryPath = (): string => join(dataDir(), "stores.json");

/** A stable short id for a store, so URLs never carry a filesystem path. */
export function storeId(storePath: string): string {
  return createHash("sha256").update(resolve(storePath)).digest("hex").slice(0, 12);
}

function writeAtomic(path: string, contents: string, mode?: number): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, contents, mode === undefined ? undefined : { mode });
  renameSync(tmp, path);
}

function readJson<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

/**
 * The token the app pairs with. It outlives daemon restarts on purpose: a
 * remembered token is what lets a reloaded tab reconnect on its own.
 */
export function readOrCreateToken(): string {
  const path = tokenPath();
  const existing = existsSync(path) ? readFileSync(path, "utf8").trim() : "";
  if (/^[0-9a-f]{32}$/.test(existing)) return existing;
  const token = randomBytes(16).toString("hex");
  writeAtomic(path, `${token}\n`, 0o600);
  return token;
}

export function readRegistry(): StoreRegistration[] {
  const doc = readJson<StoreRegistration[]>(registryPath());
  return Array.isArray(doc) ? doc.filter((s) => s && typeof s.path === "string") : [];
}

/** Adds (or refreshes) a store and the app origin allowed to read it. */
export function registerStore(storePath: string, origin: string): StoreRegistration {
  const path = resolve(storePath);
  const id = storeId(path);
  const stores = readRegistry().filter((s) => s.id !== id);
  const previous = readRegistry().find((s) => s.id === id);
  const origins = [...new Set([...(previous?.origins ?? []), origin])];
  const entry: StoreRegistration = { id, path, origins };
  writeAtomic(registryPath(), `${JSON.stringify([entry, ...stores], null, 2)}\n`);
  return entry;
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readDaemonState(): DaemonState | undefined {
  const state = readJson<DaemonState>(daemonStatePath());
  if (!state || typeof state.pid !== "number" || typeof state.port !== "number") return undefined;
  return state;
}

async function health(port: number): Promise<{ version: string } | undefined> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(1_500),
    });
    if (!response.ok) return undefined;
    const body = (await response.json()) as { mcmcjs?: boolean; version?: string };
    return body.mcmcjs ? { version: body.version ?? "" } : undefined;
  } catch {
    return undefined;
  }
}

/** The running daemon, if its state file points at a live process that answers. */
export async function findDaemon(): Promise<DaemonState | undefined> {
  const state = readDaemonState();
  if (!state) return undefined;
  if (!isAlive(state.pid)) {
    rmSync(daemonStatePath(), { force: true });
    return undefined;
  }
  return (await health(state.port)) ? state : undefined;
}

export async function stopDaemon(): Promise<"stopped" | "stale" | "none"> {
  const state = readDaemonState();
  if (!state) return "none";
  rmSync(daemonStatePath(), { force: true });
  if (!isAlive(state.pid)) return "stale";
  try {
    process.kill(state.pid, "SIGTERM");
  } catch {
    return "stale";
  }
  return "stopped";
}

/**
 * Returns the running daemon, starting one if needed. A daemon from another
 * version is replaced, so an upgraded CLI never talks to an old protocol.
 */
export async function ensureDaemon(): Promise<DaemonState> {
  const running = await findDaemon();
  if (running) {
    if (running.version === __MCMC_VERSION__) return running;
    await stopDaemon();
  }

  const entry = process.argv[1];
  if (!entry) throw new Error("cannot locate the mcmc entry point");
  const child = spawn(process.execPath, [entry, "__report-daemon"], {
    detached: true,
    stdio: "ignore",
  });
  child.on("error", () => {});
  child.unref();

  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const state = await findDaemon();
    if (state) return state;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(
    `the report server did not start within ${READY_TIMEOUT_MS / 1000}s; run \`mcmc report status\``,
  );
}

interface Route {
  token: string;
  storeId?: string;
  /** "stores", "ledger", or a run id to fetch. */
  kind: "stores" | "ledger" | "run" | "unknown";
  runId?: string;
}

/** Parses /v1/<token>/stores[/<storeId>/{ledger,runs/<runId>}]. */
export function parseRoute(pathname: string): Route | undefined {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "v1" || !parts[1]) return undefined;
  const token = parts[1];
  if (parts[2] !== "stores") return { token, kind: "unknown" };
  if (parts.length === 3) return { token, kind: "stores" };
  const store = parts[3];
  if (parts.length === 4) return { token, storeId: store, kind: "unknown" };
  if (parts[4] === "ledger" && parts.length === 5) {
    return { token, storeId: store, kind: "ledger" };
  }
  if (parts[4] === "runs" && parts[5] && parts.length === 6) {
    return { token, storeId: store, kind: "run", runId: parts[5] };
  }
  return { token, storeId: store, kind: "unknown" };
}

/** Bundle payloads by store and run, evicted oldest-first past the byte cap. */
class BundleCache {
  private readonly entries = new Map<string, string>();
  private bytes = 0;

  get(key: string): string | undefined {
    return this.entries.get(key);
  }

  put(key: string, payload: string): void {
    this.entries.set(key, payload);
    this.bytes += payload.length;
    for (const [oldest, value] of this.entries) {
      if (this.bytes <= CACHE_BYTES) break;
      if (oldest === key) break;
      this.entries.delete(oldest);
      this.bytes -= value.length;
    }
  }
}

export interface ServeOptions {
  port?: number;
  idleMs?: number;
  onIdle?: () => void;
}

/**
 * The store server: read-only GETs on the loopback interface, every path under
 * the paired token, CORS pinned to the origins the CLI registered.
 */
export async function serve(opts: ServeOptions = {}): Promise<{ server: Server; port: number }> {
  const token = readOrCreateToken();
  const cache = new BundleCache();
  let idle: NodeJS.Timeout | undefined;

  const touch = (): void => {
    if (idle) clearTimeout(idle);
    idle = setTimeout(() => {
      server.close();
      opts.onIdle?.();
    }, opts.idleMs ?? IDLE_TIMEOUT_MS);
  };

  const server = createServer((req, res) => {
    touch();
    const origin = req.headers.origin;
    const stores = readRegistry();
    const allowed = origin && stores.some((store) => store.origins.includes(origin));
    // Pinning to the registered app origins means another page can send
    // requests but can never read the reply.
    const cors: Record<string, string> = allowed
      ? {
          "Access-Control-Allow-Origin": origin as string,
          Vary: "Origin",
          // A day-long preflight cache: without it every request re-negotiates.
          "Access-Control-Max-Age": "86400",
          "Access-Control-Allow-Private-Network": "true",
        }
      : { Vary: "Origin" };

    const send = (status: number, body?: string): void => {
      res.writeHead(status, {
        ...cors,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      });
      res.end(body);
    };

    if (req.method === "OPTIONS") {
      res.writeHead(204, { ...cors, "Access-Control-Allow-Methods": "GET" });
      res.end();
      return;
    }
    if (req.method !== "GET") return send(405);

    const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    if (pathname === "/health") {
      return send(200, JSON.stringify({ mcmcjs: true, version: __MCMC_VERSION__ }));
    }

    const route = parseRoute(pathname);
    if (!route || route.token !== token) return send(404);

    if (route.kind === "stores") {
      const listing = stores.map((store) => ({
        id: store.id,
        path: store.path,
        runs: safeLedger(store.path).length,
      }));
      return send(200, JSON.stringify(listing));
    }

    const store = stores.find((s) => s.id === route.storeId);
    if (!store) return send(404);

    if (route.kind === "ledger") {
      return send(200, JSON.stringify([...safeLedger(store.path)].reverse()));
    }
    if (route.kind === "run" && route.runId) {
      const key = `${store.id}/${route.runId}`;
      const cached = cache.get(key);
      if (cached) return send(200, cached);
      const entry = safeLedger(store.path).find((run) => run.id === route.runId);
      if (!entry) return send(404);
      try {
        const payload = JSON.stringify(assembleBundle(store.path, entry));
        cache.put(key, payload);
        return send(200, payload);
      } catch {
        return send(404);
      }
    }
    return send(404);
  });

  const first = opts.port ?? DEFAULT_PORT;
  const port = await listenOnFreePort(server, first, opts.port ? 1 : PORT_RANGE);
  touch();
  return { server, port };
}

function safeLedger(storePath: string): LedgerEntry[] {
  try {
    return readLedger(storePath).runs;
  } catch {
    return [];
  }
}

function listenOnFreePort(server: Server, first: number, tries: number): Promise<number> {
  return new Promise((done, fail) => {
    let attempt = 0;
    const tryPort = (): void => {
      const port = first + attempt;
      server.once("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "EADDRINUSE" && ++attempt < tries) {
          tryPort();
          return;
        }
        fail(
          error.code === "EADDRINUSE"
            ? new Error(`ports ${first}-${first + tries - 1} are all in use`)
            : error,
        );
      });
      server.listen(port, "127.0.0.1", () => {
        // Port 0 asks the OS to choose, so read back what it actually bound.
        const address = server.address();
        done(typeof address === "object" && address ? address.port : port);
      });
    };
    tryPort();
  });
}

/** The detached background process behind `mcmc report`. */
export async function runDaemon(): Promise<void> {
  const quit = (): void => {
    rmSync(daemonStatePath(), { force: true });
    process.exit(0);
  };
  const { port } = await serve({ onIdle: quit });
  const state: DaemonState = {
    pid: process.pid,
    port,
    version: __MCMC_VERSION__,
    started_at: new Date().toISOString(),
  };
  writeAtomic(daemonStatePath(), `${JSON.stringify(state, null, 2)}\n`);
  process.on("SIGTERM", quit);
  process.on("SIGINT", quit);
}

/** The app-facing base URL for one store: everything it needs hangs off this. */
export function storeUrl(port: number, token: string, id: string): string {
  return `http://127.0.0.1:${port}/v1/${token}/stores/${id}`;
}
