#!/usr/bin/env node
import { createRegistry, createRunner, type EngineContext } from "@mcmcjs/engine";
import { juliaEngine } from "@mcmcjs/julia";
import { Command } from "commander";
import { registerConvert } from "./convert";
import { registerDaemon } from "./daemon";
import { registerDiagnose } from "./diagnose";
import { registerDoctor } from "./doctor";
import { registerEngines } from "./engines";
import { registerExport } from "./export";
import { registerFit } from "./fit";
import { registerInit } from "./init";
import { registerJulia } from "./julia";
import { registerPredict } from "./predict";
import { registerRun } from "./run";
import { registerRuns } from "./runs";
import { registerSandbox } from "./sandbox";
import { registerSetup } from "./setup";
import { registerShow } from "./show";
import { maybeNotifyUpdate, registerUpdateCheck } from "./update-check";
import { type VersionMeta, versionText } from "./version";

declare const __MCMC_VERSION__: string;
declare const __MCMC_META__: VersionMeta;

// Exit quietly when stdout closes early (e.g. piped through `head`),
// preserving any exit code the command already decided on.
process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EPIPE") process.exit(process.exitCode ?? 0);
  throw error;
});

const program = new Command();
program
  .name("mcmc")
  .description(
    "Command-line tools for Bayesian modelling, MCMC inference, and post-inference diagnostics",
  )
  .version(versionText(__MCMC_VERSION__, __MCMC_META__));

const ctx: EngineContext = { run: createRunner(), platform: process.platform };
const registry = createRegistry("julia");
registry.register(juliaEngine);

registerSetup(program);
registerDoctor(program, registry, ctx);
registerFit(program, ctx);
registerPredict(program, ctx);
registerConvert(program);
registerInit(program);
registerRun(program, ctx);
registerRuns(program);
registerShow(program);
registerExport(program);
registerDiagnose(program);
registerEngines(program, registry, ctx);
registerJulia(program, ctx);
registerDaemon(program);
registerSandbox(program);
registerUpdateCheck(program);

if (process.argv[2] !== "__update-check") maybeNotifyUpdate(__MCMC_VERSION__);

program.parseAsync(process.argv).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
