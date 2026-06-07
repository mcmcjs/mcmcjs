export type { DoctorReport } from "./doctor";
export { runDoctor } from "./doctor";
export type { CommandRunner, ToolInfo } from "./environment";
export { detectJulia, detectJuliaup } from "./environment";
export type {
  InstallCommand,
  SetupOptions,
  SetupResult,
  SetupStep,
  SetupStepResult,
  StepStatus,
} from "./setup";
export { juliaupInstallCommand, planSetup, runSetup } from "./setup";
