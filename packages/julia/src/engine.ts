import type { Engine, EngineContext, HealthReport } from "@mcmcjs/engine";
import { runDoctor } from "./doctor";

const JULIAUP_URL = "https://github.com/JuliaLang/juliaup";

export const juliaEngine: Engine = {
  id: "julia",
  displayName: "Julia",
  capabilities: { setup: true, versions: true, fit: true, predict: true },
  async doctor(ctx: EngineContext): Promise<HealthReport> {
    const report = await runDoctor(ctx.run);
    return {
      engineId: "julia",
      ready: report.ready,
      tools: [
        { name: "juliaup", ...report.juliaup },
        { name: "julia", ...report.julia },
      ],
      hint: report.ready
        ? undefined
        : `Julia not found. Install it with juliaup (${JULIAUP_URL}), or run \`mcmc setup\`.`,
    };
  },
};
