import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { readLedger, resolveRunRef } from "@mcmcjs/core";
import type { Command } from "commander";
import {
  ensureDaemon,
  findDaemon,
  readOrCreateToken,
  registerStore,
  runDaemon,
  stopDaemon,
  storeUrl,
} from "./report-daemon";
import { locateStore } from "./store-cli";

export const DEFAULT_REPORT_APP = "https://mcmcjs.github.io/mcmcjs/report/";

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

export function openInBrowser(url: string): void {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  const child = spawn(command, [url], { stdio: "ignore", detached: true, shell: false });
  child.on("error", () => {});
  child.unref();
}

/**
 * Prepares the hosted app to read one run: registers the store and its app
 * origin, makes sure the local store server is up, and builds the deep link.
 * The link carries a stable port and token, so the app can pair once and
 * reconnect by itself afterwards.
 */
export async function stageReport(
  storeDir: string,
  runId: string,
  appUrl: string,
): Promise<string> {
  const origin = new URL(appUrl).origin;
  const store = registerStore(storeDir, origin);
  const daemon = await ensureDaemon();
  // The link points at the run's own bundle. The app derives the store base
  // from it, and an app build from before pairing existed fetches it as-is,
  // so a cached tab still opens the run.
  const connect = `${storeUrl(daemon.port, readOrCreateToken(), store.id)}/runs/${runId}`;
  return reportUrl(appUrl, storeDir, runId, connect);
}

export function registerReport(program: Command): void {
  const report = program
    .command("report")
    .summary("open a run in the report web app")
    .helpGroup("Inspect runs:")
    .argument("[ref]", "run ref: latest (default), @N, or a run-id prefix")
    .description(
      "Open a run in the report web app. The app reads the run from a small server on the loopback interface; nothing leaves this machine.",
    )
    .option("--store <dir>", "run store directory (default: nearest .mcmc above cwd)")
    .option("--app-url <url>", "report app URL (default: MCMC_REPORT_APP or the hosted app)")
    .option("--no-open", "print the URL without opening a browser")
    .option("--no-serve", "print a store-only link without starting the store server")
    .option("--watch", "accepted for compatibility; the store server now runs on its own")
    .action(
      async (
        ref: string | undefined,
        opts: { store?: string; appUrl?: string; open: boolean; serve: boolean },
      ) => {
        const storeDir = locateStore(opts.store);
        const entry = resolveRunRef(readLedger(storeDir), ref);
        const appUrl = resolveAppUrl(opts.appUrl);

        let url = reportUrl(appUrl, storeDir, entry.id);
        if (opts.serve) {
          try {
            url = await stageReport(storeDir, entry.id, appUrl);
          } catch (error) {
            process.stderr.write(
              `warning: could not start the store server: ${(error as Error).message}\n`,
            );
          }
        }

        process.stdout.write(`${url}\n`);
        if (opts.open) openInBrowser(url);
      },
    );

  report
    .command("status")
    .summary("show whether the store server is running")
    .action(async () => {
      const daemon = await findDaemon();
      process.stdout.write(
        daemon
          ? `running on port ${daemon.port} (pid ${daemon.pid}, since ${daemon.started_at})\n`
          : "not running; `mcmc report` starts it\n",
      );
    });

  report
    .command("stop")
    .summary("stop the store server")
    .action(async () => {
      const outcome = await stopDaemon();
      process.stdout.write(
        outcome === "stopped"
          ? "stopped the store server\n"
          : outcome === "stale"
            ? "the store server was already gone; cleared its state\n"
            : "the store server is not running\n",
      );
    });

  program.command("__report-daemon", { hidden: true }).action(runDaemon);
}
