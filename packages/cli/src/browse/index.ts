import { spawnSync } from "node:child_process";
import { type Dirent, existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { confirm, intro, isCancel, log, outro, select } from "@clack/prompts";
import {
  findStore,
  type LedgerEntry,
  parseSamples,
  readLedger,
  removeLedgerEntries,
  runDir,
  type Samples,
} from "@mcmcjs/core";
import type { Command } from "commander";
import pc from "picocolors";
import { buildDiagnosticsReport, formatReportTable } from "../diagnose";
import {
  type PlotKind,
  renderTerminalPlot,
  SAMPLES_ONLY_KINDS,
  samplesPlotItems,
  terminalOptions,
} from "../plot";
import { openInBrowser, resolveAppUrl, stageReport } from "../report";
import { formatRunDetail, readRecord } from "../show";
import { locateStore } from "../store-cli";
import { buildSummaryRows, formatSummaryTable } from "../summary";
import { pick, type Scope } from "./picker";
import {
  languageOf,
  type ModelItem,
  modelPickables,
  type RunItem,
  runPickables,
  variablePickables,
  variableRows,
} from "./rows";

const MODEL_EXTENSIONS = [".jl", ".stan"];
const SPEC_EXTENSIONS = [".toml", ".json"];
const SCAN_DEPTH = 3;
const SCAN_LIMIT = 200;
const SKIP_DIRS = new Set(["node_modules", ".git", ".mcmc", "dist", "build", "target"]);

/** Model files and specs under the project root, nearest first. */
export function scanModels(root: string, depth = SCAN_DEPTH): string[] {
  const found: string[] = [];
  const walk = (dir: string, left: number): void => {
    if (found.length >= SCAN_LIMIT) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= SCAN_LIMIT) return;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (left > 0 && !entry.name.startsWith(".") && !SKIP_DIRS.has(entry.name)) {
          walk(full, left - 1);
        }
        continue;
      }
      if (entry.name.startsWith(".")) continue;
      const dot = entry.name.lastIndexOf(".");
      const ext = dot === -1 ? "" : entry.name.slice(dot);
      if (MODEL_EXTENSIONS.includes(ext)) found.push(full);
      else if (SPEC_EXTENSIONS.includes(ext) && isSpecFile(full)) found.push(full);
    }
  };
  walk(root, depth);
  return found;
}

function isSpecFile(path: string): boolean {
  try {
    return readFileSync(path, "utf8").includes("schema_version");
  } catch {
    return false;
  }
}

export function runItems(entries: readonly LedgerEntry[]): RunItem[] {
  return [...entries]
    .reverse()
    .map((entry, i) => ({ kind: "run" as const, ref: `@${i + 1}`, entry }));
}

export function modelItems(
  root: string,
  paths: readonly string[],
  runs: readonly RunItem[],
): ModelItem[] {
  return paths.map((path) => {
    const label = relative(root, path).split(sep).join("/");
    return {
      kind: "model" as const,
      path,
      label,
      language: languageOf(path),
      runs: runs.filter((run) => run.entry.model_path === label).length,
    };
  });
}

function samplesOf(storeDir: string, entry: LedgerEntry): Samples {
  const file = join(runDir(storeDir, entry.id), "samples.json");
  if (!existsSync(file)) throw new Error(`run ${entry.id} recorded no draws`);
  return parseSamples(readFileSync(file, "utf8"));
}

function write(text: string): void {
  process.stdout.write(`\n${text.replace(/\n+$/, "")}\n`);
}

function cancelled<T>(value: T | symbol): value is symbol {
  return isCancel(value);
}

/** Runs a command in a fresh process so it owns the terminal while it works. */
function runCommand(args: string[]): void {
  const argv = process.argv[1];
  if (!argv) throw new Error("cannot locate the mcmc entry point");
  write(pc.dim(`$ mcmc ${args.join(" ")}`));
  spawnSync(process.execPath, [argv, ...args], { stdio: "inherit" });
}

async function exploreVariables(samples: Samples): Promise<void> {
  const rows = variablePickables(variableRows(samples));
  const term = terminalOptions({});
  for (;;) {
    const chosen = await pick<(typeof rows)[number]["value"]>(
      [{ label: "Variables", items: rows, empty: "no variables" }],
      { escape: "back" },
    );
    if (!chosen) return;
    for (const kind of ["trace", "density"] as PlotKind[]) {
      write(
        renderTerminalPlot(
          kind,
          samplesPlotItems(kind, samples, { variables: [chosen.variable] }),
          term,
        ),
      );
    }
  }
}

/** Asks for one variable by name; used by the plots that take a fixed number. */
async function chooseVariable(samples: Samples, message: string): Promise<string | undefined> {
  const chosen = await select({
    message,
    showInstructions: false,
    maxItems: 12,
    options: samples.variables.map((value) => ({ value, label: value })),
  });
  return cancelled(chosen) ? undefined : (chosen as string);
}

async function choosePlot(samples: Samples): Promise<void> {
  const kind = await select({
    message: "Which plot?",
    showInstructions: false,
    maxItems: 12,
    options: [
      ...SAMPLES_ONLY_KINDS.map((value) => ({ value: value as string, label: value })),
      { value: "back", label: "Back" },
    ],
    initialValue: "trace",
  });
  if (cancelled(kind) || kind === "back") return;

  // pair and scatter plot exactly two variables against each other.
  let variables: string[] | undefined;
  if (kind === "pair" || kind === "scatter") {
    const x = await chooseVariable(samples, "Horizontal variable");
    if (!x) return;
    const y = await chooseVariable(samples, "Vertical variable");
    if (!y) return;
    variables = [x, y];
  }

  const term = terminalOptions({});
  try {
    write(
      renderTerminalPlot(
        kind as PlotKind,
        samplesPlotItems(kind as PlotKind, samples, variables ? { variables } : {}),
        term,
      ),
    );
  } catch (error) {
    log.error((error as Error).message);
  }
}

/** Actions on one run; returns to the list when the user backs out. */
async function actOnRun(storeDir: string, item: RunItem): Promise<void> {
  const { entry, ref } = item;
  const dir = runDir(storeDir, entry.id);
  for (;;) {
    const action = await select({
      message: `${ref} ${pc.dim(`${entry.id} · esc to go back`)}`,
      showInstructions: false,
      options: [
        { value: "summary", label: "Summary", hint: "posterior mean, sd, HDI" },
        { value: "diagnose", label: "Diagnostics", hint: "R-hat, ESS, MCSE" },
        { value: "variables", label: "Variables", hint: "per-variable traces" },
        { value: "plot", label: "Plots" },
        { value: "detail", label: "Settings and artifacts" },
        { value: "report", label: "Open in the report app" },
        { value: "rerun", label: "Run again", hint: "same settings, fresh fit" },
        { value: "delete", label: "Delete" },
        { value: "back", label: "Back to the list" },
      ],
    });
    if (cancelled(action) || action === "back") return;
    try {
      if (action === "summary")
        write(formatSummaryTable(buildSummaryRows(samplesOf(storeDir, entry))));
      if (action === "diagnose") {
        write(formatReportTable(buildDiagnosticsReport(samplesOf(storeDir, entry))));
      }
      if (action === "variables") await exploreVariables(samplesOf(storeDir, entry));
      if (action === "plot") await choosePlot(samplesOf(storeDir, entry));
      if (action === "detail") write(formatRunDetail(entry, dir, readRecord(dir)));
      if (action === "report") {
        const url = await stageReport(storeDir, entry.id, resolveAppUrl());
        openInBrowser(url);
        log.success("opening the report in your browser");
        // Printed too: a sandbox or an SSH session has no browser to open.
        write(pc.dim(url));
      }
      if (action === "rerun") {
        runCommand(["run", join(dir, "spec.toml"), "--store", storeDir, "--refit"]);
        return;
      }
      if (action === "delete") {
        const yes = await confirm({ message: `Delete run ${entry.id}?`, initialValue: false });
        if (cancelled(yes) || !yes) continue;
        removeLedgerEntries(storeDir, new Set([entry.id]));
        rmSync(dir, { recursive: true, force: true });
        log.success(`deleted ${entry.id}`);
        return;
      }
    } catch (error) {
      log.error((error as Error).message);
    }
  }
}

async function actOnModel(
  storeDir: string | undefined,
  item: ModelItem,
  runs: readonly RunItem[],
): Promise<void> {
  for (;;) {
    const mine = runs.filter((run) => run.entry.model_path === item.label);
    const action = await select({
      message: `${item.label} ${pc.dim(`${item.language} · esc to go back`)}`,
      showInstructions: false,
      options: [
        { value: "run", label: "Run it", hint: "fit, diagnose, record" },
        { value: "show", label: "Show the file" },
        ...(mine.length > 0 ? [{ value: "runs", label: `Runs (${mine.length})` }] : []),
        { value: "back", label: "Back to the list" },
      ],
    });
    if (cancelled(action) || action === "back") return;
    if (action === "run") {
      // With no store yet, `run` creates one beside the model.
      runCommand(["run", item.path, ...(storeDir ? ["--store", storeDir] : [])]);
      return;
    }
    if (action === "show") {
      try {
        write(pc.dim(item.path));
        write(readFileSync(item.path, "utf8"));
      } catch (error) {
        log.error((error as Error).message);
      }
    }
    if (action === "runs") {
      const chosen = await pick<RunItem>(
        [{ label: "Runs", items: runPickables(mine), empty: "no runs yet" }],
        { escape: "back" },
      );
      if (chosen && storeDir) await actOnRun(storeDir, chosen);
    }
  }
}

export async function browse(opts: { store?: string } = {}): Promise<void> {
  let storeDir = opts.store ? locateStore(opts.store) : findStore(process.cwd());
  const root = storeDir ? dirname(resolve(storeDir)) : process.cwd();
  const models = modelItems(root, scanModels(root), []);
  if (!storeDir && models.length === 0) {
    log.warn("no runs and no model files here");
    log.message("Start one with `mcmc init demo`, then `mcmc run demo/model.jl`.");
    return;
  }

  intro(pc.bold("mcmc"));
  log.message(pc.dim(storeDir ? `store ${storeDir}` : `no run store yet · ${root}`));

  for (;;) {
    // A run launched from here creates the store, so keep looking until it exists.
    if (!storeDir) storeDir = findStore(root);
    const runs = storeDir ? runItems(readLedger(storeDir).runs) : [];
    const scopes: [Scope<RunItem>, Scope<ModelItem>] = [
      {
        label: "Runs",
        items: runPickables(runs),
        empty: "no runs yet; pick a model and run it",
      },
      {
        label: "Models",
        items: modelPickables(modelItems(root, scanModels(root), runs)),
        empty: "no model files here",
      },
    ];
    const chosen = await pick<RunItem | ModelItem>(
      scopes as unknown as Scope<RunItem | ModelItem>[],
    );
    if (!chosen) break;
    if (chosen.kind === "run" && storeDir) await actOnRun(storeDir, chosen);
    else if (chosen.kind === "model") await actOnModel(storeDir, chosen, runs);
  }
  outro(pc.dim("bye"));
}

/** True when a person is at the keyboard, so the browser can take over. */
export function interactive(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

/**
 * Offers the project's model files when a command was given none. Returns
 * undefined when nothing is found or the user backs out, so the caller can
 * fall back to its own error.
 */
export async function pickModel(root = process.cwd()): Promise<string | undefined> {
  if (!interactive()) return undefined;
  const storeDir = findStore(root);
  const runs = storeDir ? runItems(readLedger(storeDir).runs) : [];
  const models = modelItems(root, scanModels(root), runs);
  if (models.length === 0) return undefined;
  const chosen = await pick<ModelItem>(
    [{ label: "Models", items: modelPickables(models), empty: "no model files here" }],
    { escape: "cancel" },
  );
  return chosen?.path;
}

export function registerBrowse(program: Command): void {
  program
    .command("browse")
    .summary("explore runs and models interactively")
    .helpGroup("Inspect runs:")
    .description(
      "Browse the project's runs and model files: filter as you type, then read a run's summary, diagnostics, variables, and plots, or launch a new fit.",
    )
    .option("--store <dir>", "run store directory (default: nearest .mcmc above cwd)")
    .action(async (opts: { store?: string }) => {
      if (!interactive()) {
        throw new Error("mcmc browse needs an interactive terminal");
      }
      await browse(opts);
    });
}
