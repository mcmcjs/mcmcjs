import type { Engine, EngineContext, HealthReport } from "@mcmcjs/engine";
import { runDoctor } from "./doctor";

export const stanEngine: Engine = {
  id: "stan",
  displayName: "Stan (CmdStan)",
  capabilities: { setup: true, versions: false, fit: true, predict: false },
  async doctor(ctx: EngineContext): Promise<HealthReport> {
    const report = await runDoctor(ctx.run);
    const missingToolchain = !report.make.found || !report.cxx.found;
    return {
      engineId: "stan",
      ready: report.ready,
      tools: [
        { name: "cmdstan", ...report.cmdstan },
        { name: "stanc", ...report.stanc },
        { name: "make", ...report.make },
        { name: "c++", ...report.cxx },
      ],
      hint: report.ready
        ? undefined
        : missingToolchain
          ? "Stan models compile with the system toolchain; install make and a C++ compiler (g++ or clang++), then run `mcmc setup --engine stan`."
          : "CmdStan not found. Run `mcmc setup --engine stan`.",
    };
  },
};
