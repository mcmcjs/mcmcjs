import { type DoctorReport, runDoctor } from "./doctor";
import { type CommandRunner, createRunner, type ToolInfo } from "./environment";

/** The official juliaup install script, piped to a shell by the install step. */
const JULIAUP_INSTALL_URL = "https://install.julialang.org";

/** An executable and its arguments, run directly (no shell word-splitting). */
export interface InstallCommand {
  command: string;
  args: string[];
}

/**
 * The command that installs juliaup on the given platform, or null when
 * automatic install is not yet supported there.
 */
export function juliaupInstallCommand(platform: NodeJS.Platform): InstallCommand | null {
  if (platform === "win32") {
    // TODO: install juliaup on Windows via winget or the Microsoft Store.
    return null;
  }
  return { command: "sh", args: ["-c", `curl -fsSL ${JULIAUP_INSTALL_URL} | sh -s -- --yes`] };
}

/** A single provisioning step needed to make the toolchain ready. */
export interface SetupStep {
  tool: "juliaup" | "julia";
  /** A short description of what the step does. */
  label: string;
  /** The command to run, or null when the step cannot be performed automatically. */
  command: InstallCommand | null;
}

/** The ordered steps needed to reach a ready toolchain, given the current state. */
export function planSetup(report: DoctorReport, platform: NodeJS.Platform): SetupStep[] {
  if (report.julia.found) return [];
  if (report.juliaup.found) {
    return [
      {
        tool: "julia",
        label: "install the latest stable Julia via juliaup",
        command: { command: report.juliaup.path ?? "juliaup", args: ["add", "release"] },
      },
    ];
  }
  return [
    {
      tool: "juliaup",
      label: "install juliaup (this also installs Julia)",
      command: juliaupInstallCommand(platform),
    },
  ];
}

export type StepStatus = "ran" | "skipped" | "failed" | "unsupported";

export interface SetupStepResult extends SetupStep {
  status: StepStatus;
  /** Error detail when the step failed. */
  detail?: string;
}

export interface SetupResult {
  juliaup: ToolInfo;
  julia: ToolInfo;
  /** True when Julia is available after setup. */
  ready: boolean;
  steps: SetupStepResult[];
}

export interface SetupOptions {
  /** Runs detection commands. Injectable for tests. */
  runner?: CommandRunner;
  /** Runs install steps, which may take several minutes. Injectable for tests. */
  installer?: CommandRunner;
  /** Target platform; defaults to the current process platform. */
  platform?: NodeJS.Platform;
  /** Plan the steps but do not run them. */
  dryRun?: boolean;
}

/** Installs the Julia toolchain (juliaup and Julia) needed for inference. */
export async function runSetup(options: SetupOptions = {}): Promise<SetupResult> {
  const {
    runner,
    installer = createRunner(15 * 60_000),
    platform = process.platform,
    dryRun = false,
  } = options;

  const before = await runDoctor(runner);
  if (before.ready) return { ...before, steps: [] };

  const plan = planSetup(before, platform);

  if (dryRun) {
    return {
      ...before,
      steps: plan.map((step) => ({ ...step, status: step.command ? "skipped" : "unsupported" })),
    };
  }

  const steps: SetupStepResult[] = [];
  for (const step of plan) {
    if (!step.command) {
      steps.push({ ...step, status: "unsupported" });
      continue;
    }
    try {
      await installer(step.command.command, step.command.args);
      steps.push({ ...step, status: "ran" });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      steps.push({ ...step, status: "failed", detail });
    }
  }

  const after = await runDoctor(runner);
  return { juliaup: after.juliaup, julia: after.julia, ready: after.ready, steps };
}
