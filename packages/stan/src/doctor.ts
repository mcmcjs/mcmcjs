import type { CommandRunner, ToolInfo } from "@mcmcjs/engine";
import {
  type CmdStanInstall,
  detectCxx,
  detectMake,
  detectStanc,
  listCmdStanInstalls,
} from "./environment";

/** A summary of the Stan toolchain available for inference. */
export interface StanDoctorReport {
  cmdstan: ToolInfo;
  stanc: ToolInfo;
  make: ToolInfo;
  cxx: ToolInfo;
  /** The install a fit would use, when one exists. */
  install?: CmdStanInstall;
  /** True when a fit can compile and sample: CmdStan plus the build toolchain. */
  ready: boolean;
}

/** Detects the installed Stan toolchain and reports whether inference can run. */
export async function runDoctor(runner?: CommandRunner): Promise<StanDoctorReport> {
  const install = listCmdStanInstalls()[0];
  const cmdstan: ToolInfo = install
    ? { found: true, version: install.version, path: install.home }
    : { found: false };
  const [stanc, make, cxx] = await Promise.all([
    detectStanc(install, runner),
    detectMake(runner),
    detectCxx(runner),
  ]);
  return {
    cmdstan,
    stanc,
    make,
    cxx,
    install,
    ready: cmdstan.found && make.found && cxx.found,
  };
}
