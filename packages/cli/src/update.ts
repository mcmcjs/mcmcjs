import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
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

/**
 * Replaces the running binary with `version` from the release. The new file is
 * written beside the old one and renamed over it, which is the only way to
 * swap an executable that is currently running.
 */
async function replaceBinary(target: string, base: string): Promise<void> {
  const asset = assetName();
  const dir = mkdtempSync(join(tmpdir(), "mcmc-update-"));
  try {
    const archive = await download(`${base}/${asset}`);
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

    const archivePath = join(dir, asset);
    writeFileSync(archivePath, archive);
    const untar = spawnSync("tar", ["-xzf", archivePath, "-C", dir], { stdio: "ignore" });
    if (untar.status !== 0) throw new Error("could not unpack the release (tar failed)");

    const staged = join(dir, process.platform === "win32" ? "mcmc.exe" : "mcmc");
    chmodSync(staged, 0o755);
    renameSync(staged, target);
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
      say(`Downloading mcmcjs ${latest}...`);
      await replaceBinary(target, `https://github.com/${REPO}/releases/download/mcmcjs@${latest}`);
      say(`${pc.green("updated")} ${target} to mcmcjs ${latest}`);
      say(pc.dim("run `hash -r` if your shell still remembers an older path"));
    });
}
