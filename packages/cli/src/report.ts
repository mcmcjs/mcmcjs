import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { readLedger, resolveRunRef } from "@mcmcjs/core";
import type { Command } from "commander";
import { assembleBundle } from "./export";
import { locateStore } from "./store-cli";

export const DEFAULT_REPORT_APP = "https://mcmcjs.github.io/mcmcjs/report/";
const SERVE_TIMEOUT_MS = 120_000;

/** The report-app deep link for one run: the app resolves it from its connected store. */
export function reportUrl(
  appUrl: string,
  storeDir: string,
  runId: string,
  connect?: string,
): string {
  const base = appUrl.endsWith("/") ? appUrl : `${appUrl}/`;
  const hash = [
    `run=${encodeURIComponent(runId)}`,
    `store=${encodeURIComponent(resolve(storeDir))}`,
    ...(connect ? [`connect=${encodeURIComponent(connect)}`] : []),
  ].join("&");
  return `${base}#${hash}`;
}

export function resolveAppUrl(flag?: string): string {
  return flag ?? process.env.MCMC_REPORT_APP ?? DEFAULT_REPORT_APP;
}

function openInBrowser(url: string): void {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  const child = spawn(command, [url], { stdio: "ignore", detached: true, shell: false });
  child.on("error", () => {});
  child.unref();
}

export interface StoreServerOptions {
  /** Keep serving until the process is stopped instead of the default window. */
  persistent?: boolean;
}

/**
 * Serves the run store on the loopback interface: the linked run at /<token>,
 * the ledger at /<token>/ledger, and any run at /<token>/run/<id>. The app
 * browses the store with no file-picker interaction; CORS is pinned to the app
 * origin and every path carries the single-use session token.
 */
export function serveStore(
  storeDir: string,
  linkedRunId: string,
  appOrigin: string,
  onDone: () => void,
  opts: StoreServerOptions = {},
): Promise<{ url: string; server: Server }> {
  const token = randomBytes(16).toString("hex");
  const bundles = new Map<string, string>();
  const bundleFor = (id: string): string | null => {
    const cached = bundles.get(id);
    if (cached) return cached;
    const entry = readLedger(storeDir).runs.find((r) => r.id === id);
    if (!entry) return null;
    try {
      const payload = JSON.stringify(assembleBundle(storeDir, entry));
      bundles.set(id, payload);
      return payload;
    } catch {
      return null;
    }
  };

  const server = createServer((req, res) => {
    const cors = {
      "Access-Control-Allow-Origin": appOrigin,
      Vary: "Origin",
    };
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        ...cors,
        "Access-Control-Allow-Methods": "GET",
        "Access-Control-Allow-Private-Network": "true",
      });
      res.end();
      return;
    }
    const path = req.url ?? "";
    if (req.method !== "GET" || !path.startsWith(`/${token}`)) {
      res.writeHead(404, cors);
      res.end();
      return;
    }
    const rest = path.slice(token.length + 1);
    const json = (body: string): void => {
      res.writeHead(200, { ...cors, "Content-Type": "application/json" });
      res.end(body);
    };
    if (rest === "" || rest === "/") {
      const payload = bundleFor(linkedRunId);
      if (payload) json(payload);
      else {
        res.writeHead(404, cors);
        res.end();
      }
      return;
    }
    if (rest === "/ledger") {
      json(JSON.stringify([...readLedger(storeDir).runs].reverse()));
      return;
    }
    if (rest.startsWith("/run/")) {
      const payload = bundleFor(rest.slice(5));
      if (payload) json(payload);
      else {
        res.writeHead(404, cors);
        res.end();
      }
      return;
    }
    res.writeHead(404, cors);
    res.end();
  });

  if (!opts.persistent) {
    const timeout = setTimeout(() => {
      server.close();
      onDone();
    }, SERVE_TIMEOUT_MS);
    timeout.unref();
  }
  return new Promise((resolvePort) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolvePort({ url: `http://127.0.0.1:${port}/${token}`, server });
    });
  });
}

export function registerReport(program: Command): void {
  program
    .command("report")
    .summary("open a run in the report web app")
    .helpGroup("Inspect runs:")
    .argument("[ref]", "run ref: latest (default), @N, or a run-id prefix")
    .description(
      "Open a run in the report web app. The run is handed to the app over the loopback interface; nothing leaves this machine.",
    )
    .option("--store <dir>", "run store directory (default: nearest .mcmc above cwd)")
    .option("--app-url <url>", "report app URL (default: MCMC_REPORT_APP or the hosted app)")
    .option("--no-open", "print the URL without opening a browser")
    .option("--no-serve", "print a store-only link without serving the store")
    .option("--watch", "keep serving the store until stopped, for browsing every run")
    .action(
      async (
        ref: string | undefined,
        opts: { store?: string; appUrl?: string; open: boolean; serve: boolean; watch?: boolean },
      ) => {
        const storeDir = locateStore(opts.store);
        const entry = resolveRunRef(readLedger(storeDir), ref);
        const appUrl = resolveAppUrl(opts.appUrl);

        let connect: string | undefined;
        if (opts.serve) {
          try {
            const handoff = await serveStore(storeDir, entry.id, new URL(appUrl).origin, () => {}, {
              persistent: opts.watch,
            });
            connect = handoff.url;
          } catch (error) {
            process.stderr.write(
              `warning: could not stage the run for direct handoff: ${(error as Error).message}\n`,
            );
          }
        }

        const url = reportUrl(appUrl, storeDir, entry.id, connect);
        process.stdout.write(`${url}\n`);
        if (connect && !process.env.MCMC_REPORT_QUIET) {
          process.stderr.write(
            opts.watch
              ? "serving the store to the report app until stopped (Ctrl+C)...\n"
              : "serving the store to the report app for 2 min...\n",
          );
        }
        if (opts.open) openInBrowser(url);
      },
    );
}
