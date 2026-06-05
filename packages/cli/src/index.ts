#!/usr/bin/env node
import { Command } from "commander";
import { registerDiagnose } from "./diagnose";

declare const __MCMC_VERSION__: string;

const program = new Command();
program
  .name("mcmc")
  .description(
    "Command-line tools for Bayesian modelling, MCMC inference, and post-inference diagnostics",
  )
  .version(__MCMC_VERSION__);

registerDiagnose(program);

program.parseAsync(process.argv).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
