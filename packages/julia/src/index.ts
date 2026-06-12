export type { DoctorReport } from "./doctor";
export { runDoctor } from "./doctor";
export { juliaEngine } from "./engine";
export type { CommandRunner, ToolInfo } from "./environment";
export { detectJulia, detectJuliaup } from "./environment";
export type { FitIo } from "./fit";
export { runFit } from "./fit";
export type { PredictIo } from "./predict";
export { predictData, runPredict } from "./predict";
export type { PackagePins } from "./project";
export { ensureProject, managedProjectDir, managedProjectReady, validatePins } from "./project";
export type { MatrixEntry, MatrixIo, MatrixResult } from "./run-matrix";
export { runMatrix } from "./run-matrix";
export { sharedTmpParent } from "./runner-common";
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
export type { WorkerStatus } from "./worker";
export { listWorkers, runFitAuto, stopWorker } from "./worker";
