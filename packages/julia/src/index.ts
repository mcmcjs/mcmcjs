export type { DoctorReport } from "./doctor";
export { runDoctor } from "./doctor";
export { juliaEngine } from "./engine";
export type { CommandRunner, ToolInfo } from "./environment";
export { detectJulia, detectJuliaup } from "./environment";
export type { FitIo } from "./fit";
export { runFit } from "./fit";
export { ensureProject, managedProjectDir } from "./project";
export type {
  InstallCommand,
  SetupOptions,
  SetupResult,
  SetupStep,
  SetupStepResult,
  StepStatus,
} from "./setup";
export { juliaupInstallCommand, planSetup, runSetup } from "./setup";
export {
  addVersion,
  assertVersionsInstalled,
  gcVersions,
  listVersions,
  removeVersion,
  resolveVersion,
  setDefaultVersion,
  updateVersion,
} from "./versions";
