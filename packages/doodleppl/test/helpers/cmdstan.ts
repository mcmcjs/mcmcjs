// CmdStan driver for the parity suite. Requires CMDSTAN_HOME (or the default
// ~/.cmdstan/cmdstan-<ver> layout) and is only exercised when DOODLEPPL_PARITY=1.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

export function cmdstanHome(): string {
  if (process.env.CMDSTAN_HOME) return process.env.CMDSTAN_HOME;
  const root = join(homedir(), ".cmdstan");
  if (existsSync(root)) {
    const versions = readdirSync(root)
      .filter((d) => d.startsWith("cmdstan-"))
      .sort();
    const latest = versions[versions.length - 1];
    if (latest) return join(root, latest);
  }
  throw new Error("CmdStan not found; set CMDSTAN_HOME");
}

const workDir = join(tmpdir(), "doodleppl-parity");

/** Compile a Stan program, cached by content hash. Returns the binary path. */
export function compileModel(name: string, code: string): string {
  mkdirSync(workDir, { recursive: true });
  const hash = createHash("sha256").update(code).digest("hex").slice(0, 12);
  const base = join(workDir, `${name}_${hash}`);
  if (!existsSync(base)) {
    writeFileSync(`${base}.stan`, code);
    execFileSync("make", [base], { cwd: cmdstanHome(), stdio: "pipe" });
  }
  return base;
}

export interface LogProbResult {
  lp: number;
  gradient: Record<string, number>;
}

/** Run CmdStan's log_prob method at one constrained parameter point. */
export function logProb(
  binary: string,
  data: Record<string, unknown>,
  point: Record<string, unknown>,
): LogProbResult {
  const tag = createHash("sha256")
    .update(JSON.stringify([binary, data, point]))
    .digest("hex")
    .slice(0, 12);
  const dataFile = join(workDir, `data_${tag}.json`);
  const pointFile = join(workDir, `point_${tag}.json`);
  const outFile = join(workDir, `lp_${tag}.csv`);
  writeFileSync(dataFile, JSON.stringify(data));
  writeFileSync(pointFile, JSON.stringify(point));
  execFileSync(
    binary,
    [
      "log_prob",
      `constrained_params=${pointFile}`,
      "jacobian=1",
      "data",
      `file=${dataFile}`,
      "output",
      `file=${outFile}`,
      "sig_figs=18",
    ],
    { stdio: "pipe" },
  );
  const rows = readFileSync(outFile, "utf8")
    .split("\n")
    .filter((l) => l.length > 0 && !l.startsWith("#"));
  const header = (rows[0] as string).split(",");
  const values = (rows[1] as string).split(",").map(Number);
  const byName = new Map(header.map((h, i) => [h, values[i] as number]));
  const gradient: Record<string, number> = {};
  for (const [h, v] of byName) {
    if (!h.startsWith("g_")) continue;
    // Gradient columns are g_<param> with subscripts flattened by dots: g_mu.1 -> mu[1]
    gradient[h.slice(2).replace(/\.(\d+)/g, "[$1]")] = v;
  }
  return { lp: byName.get("lp__") as number, gradient };
}

export interface SampleResult {
  columns: Map<string, number[]>;
}

/** Run NUTS and return all posterior draw columns keyed by flattened name. */
export function sample(
  binary: string,
  data: Record<string, unknown>,
  opts: { warmup: number; draws: number; seed: number },
): SampleResult {
  const tag = createHash("sha256")
    .update(JSON.stringify([binary, data, opts]))
    .digest("hex")
    .slice(0, 12);
  const dataFile = join(workDir, `sdata_${tag}.json`);
  const outFile = join(workDir, `fit_${tag}.csv`);
  writeFileSync(dataFile, JSON.stringify(data));
  execFileSync(
    binary,
    [
      "sample",
      `num_warmup=${opts.warmup}`,
      `num_samples=${opts.draws}`,
      "data",
      `file=${dataFile}`,
      "random",
      `seed=${opts.seed}`,
      "output",
      `file=${outFile}`,
      "sig_figs=10",
    ],
    { stdio: "pipe" },
  );
  const rows = readFileSync(outFile, "utf8")
    .split("\n")
    .filter((l) => l.length > 0 && !l.startsWith("#"));
  const header = (rows[0] as string).split(",").map((h) => h.replace(/\.(\d+)/g, "[$1]"));
  const columns = new Map<string, number[]>(header.map((h) => [h, []]));
  for (const row of rows.slice(1)) {
    const vals = row.split(",").map(Number);
    header.forEach((h, i) => {
      columns.get(h)?.push(vals[i] as number);
    });
  }
  return { columns };
}
