import type { EngineContext, EngineRegistry } from "@mcmcjs/engine";
import type { Command } from "commander";
import { registerConvert } from "./convert";
import { registerDaemon } from "./daemon";
import { registerDiagnose } from "./diagnose";
import { registerDoctor } from "./doctor";
import { registerEngines } from "./engines";
import { registerExport } from "./export";
import { registerFit } from "./fit";
import { registerInit } from "./init";
import { registerJulia } from "./julia";
import { registerPlot } from "./plot";
import { registerPredict } from "./predict";
import { registerRun } from "./run";
import { registerRuns } from "./runs";
import { registerSandbox } from "./sandbox";
import { registerSetup } from "./setup";
import { registerShow } from "./show";
import { registerSummary } from "./summary";
import { registerUpdateCheck } from "./update-check";

/**
 * Registers every command on the program. The call order sets the `--help`
 * render order: each helpGroup section appears in first-seen order, and the
 * commands within a section in this order. Shared by the CLI entry and the
 * help test so the test asserts the real wiring, not a duplicate list.
 */
export function registerAll(program: Command, ctx: EngineContext, registry: EngineRegistry): void {
  registerRun(program, ctx);
  registerFit(program, ctx);
  registerPredict(program, ctx);
  registerRuns(program);
  registerShow(program);
  registerDiagnose(program);
  registerSummary(program);
  registerPlot(program);
  registerExport(program);
  registerInit(program);
  registerSandbox(program);
  registerConvert(program);
  registerSetup(program);
  registerDoctor(program, registry, ctx);
  registerEngines(program, registry, ctx);
  registerJulia(program, ctx);
  registerDaemon(program);
  registerUpdateCheck(program);
}
