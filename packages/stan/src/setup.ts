import { existsSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";
import type { CommandRunner, ToolInfo } from "@mcmcjs/engine";
import { createRunner } from "@mcmcjs/engine";
import { runDoctor, type StanDoctorReport } from "./doctor";
import { managedStanRoot, PINNED_CMDSTAN_VERSION } from "./environment";

/** An executable and its arguments, run directly (no shell word-splitting). */
export interface InstallCommand {
  command: string;
  args: string[];
}

/** A single provisioning step needed to make the toolchain ready. */
export interface SetupStep {
  tool: "toolchain" | "cmdstan" | "build";
  label: string;
  /** The command to run, or null when the step cannot be performed automatically. */
  command: InstallCommand | null;
}

function releaseUrl(version: string): string {
  return `https://github.com/stan-dev/cmdstan/releases/download/v${version}/cmdstan-${version}.tar.gz`;
}

/** POSIX single-quoting: safe against $, backticks, spaces, and quotes. */
function shq(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** The managed home a given CmdStan version installs into. */
export function managedCmdStanHome(version: string): string {
  return join(managedStanRoot(), `cmdstan-${version}`);
}

/** The ordered steps needed to reach a ready toolchain, given the current state. */
export function planSetup(
  report: StanDoctorReport,
  platform: NodeJS.Platform,
  version: string = PINNED_CMDSTAN_VERSION,
): SetupStep[] {
  const steps: SetupStep[] = [];

  if (!report.make.found || !report.cxx.found) {
    const missing = [
      ...(report.make.found ? [] : ["make"]),
      ...(report.cxx.found ? [] : ["a C++ compiler (g++ or clang++)"]),
    ].join(" and ");
    // System package managers vary too much to script; report what is missing.
    steps.push({
      tool: "toolchain",
      label: `install ${missing} with your system package manager`,
      command: null,
    });
  }

  if (report.cmdstan.found && report.cmdstan.version === version) return steps;

  const home = managedCmdStanHome(version);
  const posix = platform !== "win32";
  // The tarball extracts into a staging dir and moves into place atomically, so
  // a partial download is never mistaken for an install on the next run.
  if (!existsSync(join(home, "makefile"))) {
    const root = shq(managedStanRoot());
    const staging = shq(join(managedStanRoot(), `.download-${version}`));
    const finalHome = shq(home);
    const extracted = shq(join(managedStanRoot(), `.download-${version}`, `cmdstan-${version}`));
    steps.push({
      tool: "cmdstan",
      label: `download CmdStan ${version}`,
      command: posix
        ? {
            command: "sh",
            args: [
              "-c",
              `rm -rf ${staging} && mkdir -p ${staging} && curl -fsSL ${shq(releaseUrl(version))} | tar -xz -C ${staging} && rm -rf ${finalHome} && mv ${extracted} ${finalHome} && rm -rf ${staging} && mkdir -p ${root}`,
            ],
          }
        : null,
    });
  }
  // `make build` compiles stanc/main.o/precompiled headers; it is idempotent,
  // so a partially built install just resumes. stansummary is one of the last
  // artifacts, so its presence marks a completed build.
  if (!existsSync(join(home, "bin", "stansummary"))) {
    steps.push({
      tool: "build",
      label: `build CmdStan ${version} (one-time, a few minutes)`,
      command: posix
        ? { command: "make", args: ["-C", home, "build", `-j${cpus().length}`] }
        : null,
    });
  }
  return steps;
}

export type StepStatus = "ran" | "skipped" | "failed" | "unsupported";

export interface SetupStepResult extends SetupStep {
  status: StepStatus;
  /** Error detail when the step failed. */
  detail?: string;
}

export interface StanSetupResult {
  cmdstan: ToolInfo;
  stanc: ToolInfo;
  make: ToolInfo;
  cxx: ToolInfo;
  /** True when a Stan fit can run after setup. */
  ready: boolean;
  steps: SetupStepResult[];
}

export interface StanSetupOptions {
  /** Runs detection commands. Injectable for tests. */
  runner?: CommandRunner;
  /** Runs install steps, which may take several minutes. Injectable for tests. */
  installer?: CommandRunner;
  /** Target platform; defaults to the current process platform. */
  platform?: NodeJS.Platform;
  /** Plan the steps but do not run them. */
  dryRun?: boolean;
  /** CmdStan version to provision; defaults to the pinned version. */
  version?: string;
}

function validateVersion(version: string): void {
  if (!/^\d+\.\d+\.\d+(-rc\d+)?$/.test(version)) {
    throw new Error(
      `invalid CmdStan version: "${version}" (expected e.g. ${PINNED_CMDSTAN_VERSION})`,
    );
  }
}

/** Installs the CmdStan toolchain needed for Stan inference. */
export async function runSetup(options: StanSetupOptions = {}): Promise<StanSetupResult> {
  const {
    runner,
    installer = createRunner(30 * 60_000),
    platform = process.platform,
    dryRun = false,
    version = PINNED_CMDSTAN_VERSION,
  } = options;
  validateVersion(version);

  const before = await runDoctor(runner);
  const plan = planSetup(before, platform, version);
  const strip = ({ install: _install, ...report }: StanDoctorReport) => report;
  if (plan.length === 0) return { ...strip(before), steps: [] };

  if (dryRun) {
    return {
      ...strip(before),
      steps: plan.map((step) => ({ ...step, status: step.command ? "skipped" : "unsupported" })),
    };
  }

  const steps: SetupStepResult[] = [];
  let failed = false;
  for (const step of plan) {
    if (!step.command) {
      steps.push({ ...step, status: "unsupported" });
      failed = failed || step.tool === "toolchain";
      continue;
    }
    if (failed) {
      steps.push({ ...step, status: "skipped" });
      continue;
    }
    try {
      await installer(step.command.command, step.command.args);
      steps.push({ ...step, status: "ran" });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      steps.push({ ...step, status: "failed", detail });
      failed = true;
    }
  }

  const after = await runDoctor(runner);
  return { ...strip(after), steps };
}
