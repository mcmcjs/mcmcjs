import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { delimiter, join, sep } from "node:path";

declare const __MCMC_COMPILED__: boolean;

/**
 * True in the single-file binary, false when running from the npm package.
 * Stamped at build time rather than sniffed, so the two builds never disagree.
 */
export const COMPILED: boolean =
  typeof __MCMC_COMPILED__ === "undefined" ? false : __MCMC_COMPILED__;

/**
 * How to re-invoke this CLI as a child process. The npm build runs a script
 * through node; the binary is its own entry point and has no script path (its
 * `process.argv[1]` points inside the embedded filesystem).
 */
export function selfInvocation(args: readonly string[]): { command: string; args: string[] } {
  if (COMPILED) return { command: process.execPath, args: [...args] };
  const entry = process.argv[1];
  if (!entry) throw new Error("cannot locate the mcmc entry point");
  return { command: process.execPath, args: [entry, ...args] };
}

/** How this copy was installed, for messages that differ by install method. */
export function installKind(): "binary" | "npm" {
  return COMPILED ? "binary" : "npm";
}

/**
 * Every `mcmc` on PATH, in the order the shell would find them. Two copies is
 * a normal accident (installed once with npm, once with the install script)
 * and silently running the older one is the confusing part, so `mcmc doctor`
 * names them.
 */
export function copiesOnPath(
  pathValue: string | undefined = process.env.PATH,
  isExecutable: (path: string) => boolean = defaultIsExecutable,
  name = "mcmc",
): string[] {
  const seen = new Set<string>();
  const found: string[] = [];
  for (const dir of (pathValue ?? "").split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, name);
    if (seen.has(candidate) || !isExecutable(candidate)) continue;
    seen.add(candidate);
    found.push(candidate);
  }
  return found;
}

function defaultIsExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** True when the path looks like something npm linked into place. */
export function looksLikeNpm(path: string): boolean {
  const target = (() => {
    try {
      return realpathSync(path);
    } catch {
      return path;
    }
  })();
  return target.includes(`${sep}node_modules${sep}`);
}
