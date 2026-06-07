import { type CommandRunner, detectJulia, detectJuliaup, type ToolInfo } from "./environment";

/** A summary of the Julia toolchain available for inference. */
export interface DoctorReport {
  juliaup: ToolInfo;
  julia: ToolInfo;
  /** True when Julia itself is available (the minimum needed to run inference). */
  ready: boolean;
}

/** Detects the installed Julia toolchain and reports whether inference can run. */
export async function runDoctor(runner?: CommandRunner): Promise<DoctorReport> {
  const [juliaup, julia] = await Promise.all([detectJuliaup(runner), detectJulia(runner)]);
  return { juliaup, julia, ready: julia.found };
}
