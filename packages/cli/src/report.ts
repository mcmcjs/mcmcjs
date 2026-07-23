import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { readLedger, resolveRunRef } from "@mcmcjs/core";
import type { Command } from "commander";
import { locateStore } from "./store-cli";

export const DEFAULT_REPORT_APP = "https://mcmcjs.github.io/mcmcjs/report/";

/** The report-app deep link for one run: the app resolves it from its connected store. */
export function reportUrl(appUrl: string, storeDir: string, runId: string): string {
  const base = appUrl.endsWith("/") ? appUrl : `${appUrl}/`;
  return `${base}#run=${encodeURIComponent(runId)}&store=${encodeURIComponent(resolve(storeDir))}`;
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

export function registerReport(program: Command): void {
  program
    .command("report")
    .summary("open a run in the report web app")
    .helpGroup("Inspect runs:")
    .argument("[ref]", "run ref: latest (default), @N, or a run-id prefix")
    .description(
      "Open a run in the report web app. The app reads the run from your store locally (grant it the .mcmc folder once); nothing is uploaded.",
    )
    .option("--store <dir>", "run store directory (default: nearest .mcmc above cwd)")
    .option("--app-url <url>", "report app URL (default: MCMC_REPORT_APP or the hosted app)")
    .option("--no-open", "print the URL without opening a browser")
    .action((ref: string | undefined, opts: { store?: string; appUrl?: string; open: boolean }) => {
      const storeDir = locateStore(opts.store);
      const entry = resolveRunRef(readLedger(storeDir), ref);
      const url = reportUrl(resolveAppUrl(opts.appUrl), storeDir, entry.id);
      process.stdout.write(`${url}\n`);
      if (opts.open) openInBrowser(url);
    });
}
