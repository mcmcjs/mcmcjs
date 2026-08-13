import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Command } from "commander";
import pc from "picocolors";
import { installKind } from "./self";
import { isNewer } from "./update-check";

const REPO = "mcmcjs/mcmcjs";
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases?per_page=50`;
const REGISTRY_URL = "https://registry.npmjs.org/mcmcjs/latest";
const FETCH_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;

/** The release asset for this platform, matching what the install script fetches. */
export function assetName(platform = process.platform, arch = process.arch): string {
  const os = platform === "darwin" ? "darwin" : platform === "win32" ? "windows" : "linux";
  const cpu = arch === "arm64" ? "arm64" : "x64";
  return `mcmc-${os}-${cpu}.tar.gz`;
}

/** The newest mcmcjs CLI version on GitHub Releases; the tags name the package. */
export function pickCliTag(tags: readonly string[]): string | undefined {
  for (const tag of tags) {
    const match = /^mcmcjs@(\d+\.\d+\.\d+)$/.exec(tag);
    if (match) return match[1];
  }
  return undefined;
}

async function latestFromReleases(): Promise<string | undefined> {
  const response = await fetch(RELEASES_API, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) return undefined;
  const releases = (await response.json()) as { tag_name?: string }[];
  return pickCliTag(releases.map((release) => release.tag_name ?? ""));
}

async function latestFromNpm(): Promise<string | undefined> {
  const response = await fetch(REGISTRY_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) return undefined;
  const doc = (await response.json()) as { version?: string };
  return doc.version;
}

/** The checksum recorded for one asset in a release's checksums.txt. */
export function checksumFor(manifest: string, asset: string): string | undefined {
  for (const line of manifest.split("\n")) {
    const [sum, name] = line.trim().split(/\s+/);
    if (name === asset && sum) return sum;
  }
  return undefined;
}

async function download(url: string, timeoutMs = DOWNLOAD_TIMEOUT_MS): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

export interface Reporter {
  /** A step that has started. */
  line: (text: string) => void;
  /** A line that replaces itself on a terminal. */
  progress: (text: string) => void;
  /** Ends a progress line so the next output starts clean. */
  done: () => void;
}

/**
 * Step output for the update. On a terminal the download redraws one line; a
 * pipe or a log gets each step once, with no control characters.
 */
export function createReporter(opts: {
  write: (text: string) => void;
  tty: boolean;
  silent?: boolean;
}): Reporter {
  if (opts.silent) return { line: () => {}, progress: () => {}, done: () => {} };
  let width = 0;
  return {
    line: (text) => opts.write(`${text}\n`),
    progress: (text) => {
      if (!opts.tty) return;
      opts.write(`\r${text.padEnd(width)}`);
      width = text.length;
    },
    done: () => {
      if (opts.tty && width > 0) opts.write("\n");
      width = 0;
    },
  };
}

const BAR_WIDTH = 24;

/** `[####....] 45%  17.2/38.0 MB`, or just the size when the length is unknown. */
export function progressLine(received: number, total: number | undefined): string {
  const mb = (bytes: number) => (bytes / 1_048_576).toFixed(1);
  if (!total) return `${mb(received)} MB`;
  const fraction = Math.min(1, received / total);
  const filled = Math.round(fraction * BAR_WIDTH);
  const bar = "#".repeat(filled) + ".".repeat(BAR_WIDTH - filled);
  return `[${bar}] ${String(Math.round(fraction * 100)).padStart(3)}%  ${mb(received)}/${mb(total)} MB`;
}

/**
 * Downloads while reporting progress. A ~38 MB release over a slow link is a
 * long silence otherwise, and a silent CLI looks hung.
 */
async function downloadWithProgress(
  url: string,
  onProgress: (line: string) => void,
  timeoutMs = DOWNLOAD_TIMEOUT_MS,
): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  const length = Number(response.headers.get("content-length"));
  const total = Number.isFinite(length) && length > 0 ? length : undefined;
  if (!response.body) return Buffer.from(await response.arrayBuffer());

  const chunks: Buffer[] = [];
  let received = 0;
  let lastReport = 0;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
    received += chunk.byteLength;
    // Redrawing per chunk floods a pipe; twice a second reads as live.
    const now = Date.now();
    if (now - lastReport > 500) {
      lastReport = now;
      onProgress(progressLine(received, total));
    }
  }
  onProgress(progressLine(received, total ?? received));
  return Buffer.concat(chunks);
}

/**
 * Replaces the running binary with `version` from the release. The new file is
 * written beside the old one and renamed over it, which is the only way to
 * swap an executable that is currently running.
 */
async function replaceBinary(target: string, base: string, step: Reporter): Promise<void> {
  const asset = assetName();
  const dir = mkdtempSync(join(tmpdir(), "mcmc-update-"));
  try {
    const archive = await downloadWithProgress(`${base}/${asset}`, (line) =>
      step.progress(`  ${line}`),
    );
    step.done();
    step.line("verifying the checksum");
    try {
      const manifest = (await download(`${base}/checksums.txt`, FETCH_TIMEOUT_MS)).toString("utf8");
      const want = checksumFor(manifest, asset);
      const got = createHash("sha256").update(archive).digest("hex");
      if (want && want !== got) {
        throw new Error(`checksum mismatch for ${asset} (expected ${want}, got ${got})`);
      }
    } catch (error) {
      // A missing checksums.txt is not fatal; a mismatch is.
      if (/checksum mismatch/.test((error as Error).message)) throw error;
    }

    step.line("unpacking");
    const archivePath = join(dir, asset);
    writeFileSync(archivePath, archive);
    const untar = spawnSync("tar", ["-xzf", archivePath, "-C", dir], { stdio: "ignore" });
    if (untar.status !== 0) throw new Error("could not unpack the release (tar failed)");

    const staged = join(dir, process.platform === "win32" ? "mcmc.exe" : "mcmc");
    step.line(`replacing ${target}`);
    // Stage beside the target, not in the temp dir: a rename cannot cross
    // filesystems, and /tmp is usually its own mount.
    const beside = `${target}.new`;
    try {
      copyFileSync(staged, beside);
      chmodSync(beside, 0o755);
      renameSync(beside, target);
    } catch (error) {
      rmSync(beside, { force: true });
      throw error;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function registerUpdate(program: Command, currentVersion: string): void {
  program
    .command("update")
    .summary("update mcmc to the latest release")
    .helpGroup("Toolchain:")
    .description(
      "Update this copy of mcmc in place. A binary install is replaced from the latest GitHub release; an npm install is updated with npm.",
    )
    .option("--check", "report whether a newer version exists, without changing anything")
    .option("--force", "reinstall the latest version even when it is already current")
    .option("--json", "print the result as JSON")
    .action(async (opts: { check?: boolean; force?: boolean; json?: boolean }) => {
      const kind = installKind();
      const latest = await (kind === "binary" ? latestFromReleases() : latestFromNpm());
      if (!latest) {
        throw new Error("could not reach the release index; try again, or reinstall by hand");
      }
      const outdated = isNewer(latest, currentVersion);

      if (opts.json) {
        process.stdout.write(
          `${JSON.stringify({ install: kind, current: currentVersion, latest, outdated }, null, 2)}\n`,
        );
        if (opts.check || (!outdated && !opts.force)) return;
      } else if (opts.check) {
        process.stdout.write(
          outdated
            ? `mcmcjs ${latest} is available (you have ${currentVersion})\n`
            : `mcmcjs ${currentVersion} is the latest\n`,
        );
        return;
      } else if (!outdated && !opts.force) {
        process.stdout.write(`mcmcjs ${currentVersion} is already the latest\n`);
        return;
      }

      const say = (line: string) => {
        if (!opts.json) process.stdout.write(`${line}\n`);
      };

      if (kind === "npm") {
        say(`Updating to ${latest} with npm...`);
        const result = spawnSync("npm", ["install", "-g", `mcmcjs@${latest}`], {
          stdio: "inherit",
        });
        if (result.status !== 0) {
          throw new Error(
            "npm install failed. If it was a permissions error, set a user npm prefix (npm config set prefix ~/.npm-global) or re-run with sudo.",
          );
        }
        say(`${pc.green("updated")} to mcmcjs ${latest}`);
        return;
      }

      // The binary replaces itself, so the path is process.execPath.
      const target = process.execPath;
      const step = createReporter({
        write: (text) => process.stdout.write(text),
        tty: process.stdout.isTTY === true,
        silent: opts.json,
      });
      step.line(`downloading mcmcjs ${latest} (${assetName()})`);
      await replaceBinary(
        target,
        `https://github.com/${REPO}/releases/download/mcmcjs@${latest}`,
        step,
      );
      say(`${pc.green("updated")} ${target} to mcmcjs ${latest}`);
      say(pc.dim("run `hash -r` if your shell still remembers an older path"));
    });
}
