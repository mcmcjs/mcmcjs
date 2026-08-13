import { spawnSync } from "node:child_process";
import { type Dirent, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  STORE_DIR_NAME,
} from "@mcmcjs/core";
import type { Command } from "commander";
import pc from "picocolors";
import { buildDiagnosticsReport, formatReportTable } from "../diagnose";
import { adapterFor, inspectSource, looksLikeSpec, type ModelSurface } from "../model-file";
import {
  type PlotKind,
  renderTerminalPlot,
  SAMPLES_ONLY_KINDS,
  samplesPlotItems,
  terminalOptions,
} from "../plot";
import { openInBrowser, resolveAppUrl, stageReport } from "../report";
import { selfInvocation } from "../self";
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
      // A Julia project is mostly not models, so the contents decide.
      if (MODEL_EXTENSIONS.includes(ext) && isModelFile(full)) found.push(full);
      else if (SPEC_EXTENSIONS.includes(ext) && isSpecFile(full)) found.push(full);
    }
  };
  walk(root, depth);
  return found;
}

function isSpecFile(path: string): boolean {
  try {
    return looksLikeSpec(readFileSync(path, "utf8"));
  } catch {
    return false;
  }
}

/** A source file worth listing: it declares a model, or adapts one. */
function isModelFile(path: string): boolean {
  const surface = readSurface(path);
  return surface !== undefined && surface.kind !== "none";
}

function readSurface(path: string): ModelSurface | undefined {
  try {
    return inspectSource(path, readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

/**
 * Every run store under `root`, plus the one above it. A `mcmc run` puts its
 * store beside the model, so a repo with an examples directory keeps its runs
 * there rather than at the root.
 */
export function findStores(root: string, depth = SCAN_DEPTH): string[] {
  const stores = new Set<string>();
  const above = findStore(root);
  if (above) stores.add(above);
  const walk = (dir: string, left: number): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === STORE_DIR_NAME) {
        stores.add(join(dir, entry.name));
        continue;
      }
      if (left > 0 && !entry.name.startsWith(".") && !SKIP_DIRS.has(entry.name)) {
        walk(join(dir, entry.name), left - 1);
      }
    }
  };
  walk(root, depth);
  return [...stores];
}

/** The runs of every store, newest first, each remembering where it lives. */
export function runItems(
  stores: readonly { storeDir: string; entries: readonly LedgerEntry[] }[],
): RunItem[] {
  return stores
    .flatMap(({ storeDir, entries }) => entries.map((entry) => ({ storeDir, entry })))
    .sort((a, b) => b.entry.started_at.localeCompare(a.entry.started_at))
    .map(({ storeDir, entry }, i) => ({
      kind: "run" as const,
      ref: `@${i + 1}`,
      entry,
      storeDir,
    }));
}

/** Where a run's model actually is, resolved against its own store. */
export function runModelPath(item: RunItem): string {
  return resolve(dirname(item.storeDir), item.entry.model_path);
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
      // Each run's model path is relative to its own store, which may sit in a
      // subdirectory, so compare resolved paths.
      runs: runs.filter((run) => runModelPath(run) === path).length,
      // A spec is always runnable; a model file needs an entry function.
      ready: languageOf(path) === "spec" || (readSurface(path)?.hasEntry ?? true),
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
  write(pc.dim(`$ mcmc ${args.join(" ")}`));
  const self = selfInvocation(args);
  spawnSync(self.command, self.args, { stdio: "inherit" });
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
async function actOnRun(item: RunItem): Promise<void> {
  const { entry, ref, storeDir } = item;
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

/**
 * Appends the one-line adapter a fit needs, after showing it. The mapping from
 * arguments to data columns is a guess, so it is confirmed, not assumed.
 */
async function addAdapter(path: string): Promise<string | undefined> {
  const source = readFileSync(path, "utf8");
  const adapter = adapterFor(inspectSource(path, source));
  if (!adapter) {
    log.error("cannot work out the model's arguments; add a build_model by hand");
    return undefined;
  }
  const yes = await confirm({
    message: `Append  ${adapter}  to ${path}?`,
    initialValue: true,
  });
  if (cancelled(yes) || !yes) return undefined;
  writeFileSync(path, `${source.replace(/\n*$/, "\n")}\n${adapter}\n`);
  return adapter;
}

async function actOnModel(
  storeDir: string | undefined,
  item: ModelItem,
  runs: readonly RunItem[],
): Promise<void> {
  for (;;) {
    const mine = runs.filter((run) => runModelPath(run) === item.path);
    const action = await select({
      message: `${item.label} ${pc.dim(`${item.language} · esc to go back`)}`,
      showInstructions: false,
      options: [
        ...(item.ready
          ? [{ value: "run", label: "Run it", hint: "fit, diagnose, record" }]
          : [{ value: "adapt", label: "Add a build_model", hint: "makes it runnable" }]),
        { value: "show", label: "Show the file" },
        ...(mine.length > 0 ? [{ value: "runs", label: `Runs (${mine.length})` }] : []),
        { value: "back", label: "Back to the list" },
      ],
    });
    if (cancelled(action) || action === "back") return;
    if (action === "adapt") {
      const added = await addAdapter(item.path);
      if (added) {
        item.ready = true;
        log.success(`added to ${item.label}:  ${added}`);
      }
      continue;
    }
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
      if (chosen) await actOnRun(chosen);
    }
  }
}

export async function browse(opts: { store?: string } = {}): Promise<void> {
  const pinned = opts.store ? locateStore(opts.store) : undefined;
  const root = pinned ? dirname(resolve(pinned)) : process.cwd();
  const models = modelItems(root, scanModels(root), []);
  const stores = () => (pinned ? [pinned] : findStores(root));
  if (stores().length === 0 && models.length === 0) {
    log.warn("no runs and no model files here");
    log.message("Start one with `mcmc init demo`, then `mcmc run demo/model.jl`.");
    return;
  }

  intro(pc.bold("mcmc"));
  const found = stores();
  log.message(
    pc.dim(
      found.length === 1
        ? `store ${found[0]}`
        : found.length > 1
          ? `${found.length} run stores under ${root}`
          : `no run store yet · ${root}`,
    ),
  );

  for (;;) {
    // Re-read every time: a run launched from here creates or fills a store,
    // and it lands beside the model rather than at the root.
    const runs = runItems(
      stores().map((storeDir) => ({ storeDir, entries: readLedger(storeDir).runs })),
    );
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
    if (chosen.kind === "run") await actOnRun(chosen);
    else await actOnModel(pinned, chosen, runs);
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
  const runs = runItems(
    findStores(root).map((storeDir) => ({ storeDir, entries: readLedger(storeDir).runs })),
  );
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
