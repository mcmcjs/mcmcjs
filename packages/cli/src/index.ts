#!/usr/bin/env node
import { createRegistry, createRunner, type EngineContext } from "@mcmcjs/engine";
import { juliaEngine } from "@mcmcjs/julia";
import { Command } from "commander";
import { registerAll } from "./register";
import { maybeNotifyUpdate } from "./update-check";
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
  .version(versionText(__MCMC_VERSION__, __MCMC_META__))
  .showSuggestionAfterError()
  .showHelpAfterError("(run `mcmc --help` to see all commands)")
  .addHelpText(
    "before",
    "\nQuickstart: mcmc setup, then mcmc init demo, then mcmc run demo/model.jl",
  )
  .addHelpText(
    "after",
    "\nRun `mcmc <command> --help` for a command's options (e.g. `mcmc fit --help`)." +
      "\n`julia`, `daemon`, and `runs` group further subcommands; run them bare to explore." +
      "\n\nExit codes: 0 ok or converged, 1 error, 2 ran but did not converge (run, diagnose)." +
      "\n\nDocs: https://github.com/mcmcjs/mcmcjs",
  );

const ctx: EngineContext = { run: createRunner(), platform: process.platform };
const registry = createRegistry("julia");
registry.register(juliaEngine);

registerAll(program, ctx, registry);

if (process.argv[2] !== "__update-check") maybeNotifyUpdate(__MCMC_VERSION__);

// Bare `mcmc` prints the grouped help and exits 0 (a query, not an error).
// A pre-parse guard, not program.action(), which would break --did-you-mean.
if (process.argv.length <= 2) {
  program.outputHelp();
} else {
  program.parseAsync(process.argv).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
