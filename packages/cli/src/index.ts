#!/usr/bin/env node
import { createRegistry, createRunner, type EngineContext } from "@mcmcjs/engine";
import { juliaEngine } from "@mcmcjs/julia";
import { Command } from "commander";
import { registerDiagnose } from "./diagnose";
import { registerDoctor } from "./doctor";
import { registerEngines } from "./engines";
import { registerFit } from "./fit";
import { registerJulia } from "./julia";
import { registerPredict } from "./predict";
import { registerSetup } from "./setup";

declare const __MCMC_VERSION__: string;

const program = new Command();
program
  .name("mcmc")
  .description(
    "Command-line tools for Bayesian modelling, MCMC inference, and post-inference diagnostics",
  )
  .version(__MCMC_VERSION__);

const ctx: EngineContext = { run: createRunner(), platform: process.platform };
const registry = createRegistry("julia");
registry.register(juliaEngine);

registerSetup(program);
registerDoctor(program, registry, ctx);
registerFit(program, ctx);
registerPredict(program, ctx);
registerDiagnose(program);
registerEngines(program, registry, ctx);
registerJulia(program, ctx);

program.parseAsync(process.argv).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
