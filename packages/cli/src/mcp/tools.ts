import { z } from "zod";

/**
 * The tools the MCP server exposes, as data. Each one names the CLI command it
 * runs and how its arguments map to flags, so the wiring is one table rather
 * than a function per tool, and the whole surface can be tested without a
 * transport.
 *
 * Descriptions are prompt engineering: they say what comes back and how to read
 * it, because the model plans its next call from this text alone.
 */
export interface ToolSpec {
  name: string;
  title: string;
  description: string;
  /** The `mcmc` subcommand, plus any fixed arguments. */
  command: string[];
  input: z.ZodRawShape;
  /** Builds the argument list from validated input. */
  args: (input: Record<string, unknown>) => string[];
  /** Fits can take minutes; a listing cannot. */
  timeoutMs: number;
  /**
   * The shape of the JSON the command prints, so a client gets typed data
   * rather than a blob to re-parse. Loose on purpose: these describe the
   * fields worth acting on, and the CLI is free to print more.
   */
  output: z.ZodType;
  /** Commands that print a bare array are wrapped under this key. */
  outputKey?: string;
}

/** Only the fields an agent decides on; the rest passes through. */
const DIAGNOSTICS = z.looseObject({
  converged: z.boolean().describe("whether every threshold passed"),
  variables: z.array(
    z.looseObject({
      variable: z.string(),
      mean: z.number(),
      rhat: z.number(),
      essBulk: z.number(),
    }),
  ),
});

const target = z
  .string()
  .optional()
  .describe("run ref (latest, @N, or an id prefix) or a samples file; default: the latest run");
const store = z.string().optional().describe("run store directory; default: the nearest .mcmc");

/** Appends `--flag value` for each option that was given. */
function flags(input: Record<string, unknown>, names: readonly string[]): string[] {
  const out: string[] = [];
  for (const name of names) {
    const value = input[name];
    if (value === undefined || value === null || value === false) continue;
    const flag = `--${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
    if (value === true) out.push(flag);
    else out.push(flag, String(value));
  }
  return out;
}

const MINUTE = 60_000;

export const TOOLS: ToolSpec[] = [
  {
    name: "mcmc_run",
    title: "Fit a model",
    description:
      "Fit a model file (.jl for Turing or JuliaBUGS, .stan for Stan) or a spec, and record the run. Returns the run id, the effective spec, and the convergence report: R-hat, ESS, MCSE, and divergences per variable, plus a verdict. A verdict of not-converged is a result, not an error: read the diagnostics and change the model or the sampler settings. The model file must define build_model(data), which is called with the data table.",
    command: ["run"],
    input: {
      model: z.string().describe("path to the model file, spec, or graph"),
      data: z.string().optional().describe("data file (.json object or .csv columns)"),
      draws: z.number().int().positive().optional().describe("posterior draws (default 1000)"),
      warmup: z.number().int().nonnegative().optional().describe("warmup iterations"),
      chains: z.number().int().positive().optional().describe("chains (default 4)"),
      seed: z.number().int().nonnegative().optional().describe("random seed, for a repeatable fit"),
      algorithm: z
        .string()
        .optional()
        .describe("NUTS | HMC | HMCDA | MH | ESS | SMC | PG | Gibbs | External | Prior"),
      prior: z.boolean().optional().describe("draw from the prior instead of fitting"),
      refit: z.boolean().optional().describe("fit again even when nothing changed"),
      store,
    },
    args: (input) => [
      String(input.model),
      ...flags(input, [
        "data",
        "draws",
        "warmup",
        "chains",
        "seed",
        "algorithm",
        "prior",
        "refit",
        "store",
      ]),
    ],
    timeoutMs: 30 * MINUTE,
    output: z.looseObject({
      run: z.looseObject({ id: z.string(), dir: z.string(), cached: z.boolean() }),
      report: DIAGNOSTICS,
    }),
  },
  {
    name: "mcmc_diagnose",
    title: "Check convergence",
    description:
      "Convergence diagnostics for a recorded run or a samples file: split R-hat, bulk and tail ESS, MCSE, HDI, and divergences, with a pass or fail verdict. Use this to decide whether a fit can be trusted before reading its estimates.",
    command: ["diagnose"],
    input: { target, store },
    args: (input) => [...(input.target ? [String(input.target)] : []), ...flags(input, ["store"])],
    timeoutMs: 2 * MINUTE,
    output: DIAGNOSTICS,
  },
  {
    name: "mcmc_summary",
    title: "Summarise the posterior",
    description:
      "Posterior summary for a run: mean, standard deviation, MCSE, ESS, R-hat, and the HDI per variable. Read the diagnostics first; a summary of an unconverged fit is misleading.",
    command: ["summary"],
    input: {
      target,
      var: z.array(z.string()).optional().describe("restrict to these variables"),
      store,
    },
    args: (input) => [
      ...(input.target ? [String(input.target)] : []),
      ...((input.var as string[] | undefined)?.flatMap((v) => ["--var", v]) ?? []),
      ...flags(input, ["store"]),
    ],
    timeoutMs: 2 * MINUTE,
    outputKey: "variables",
    output: z.looseObject({
      variables: z.array(
        z.looseObject({
          variable: z.string(),
          mean: z.number(),
          std: z.number(),
          r_hat: z.number(),
          hdi: z.array(z.number()),
        }),
      ),
    }),
  },
  {
    name: "mcmc_runs",
    title: "List recorded runs",
    description:
      "Every run in the project's store, newest first, with its model, sampler settings, verdict, and age. Use it to find the ref of an earlier run to inspect or compare.",
    command: ["runs", "list"],
    input: { store },
    args: (input) => flags(input, ["store"]),
    timeoutMs: MINUTE,
    outputKey: "runs",
    output: z.looseObject({
      runs: z.array(
        z.looseObject({
          id: z.string(),
          status: z.string().describe("ok, failed, or cancelled"),
          model_path: z.string(),
          started_at: z.string(),
        }),
      ),
    }),
  },
  {
    name: "mcmc_loo",
    title: "Estimate out-of-sample fit",
    description:
      "PSIS-LOO cross-validation and WAIC for a run, with Pareto k diagnostics. A high k means the estimate for that observation is unreliable. Needs a model whose log-likelihood can be computed.",
    command: ["loo"],
    input: { target, store },
    args: (input) => [...(input.target ? [String(input.target)] : []), ...flags(input, ["store"])],
    timeoutMs: 15 * MINUTE,
    output: z.looseObject({
      label: z.string(),
      elpd_loo: z.number().describe("higher is better"),
      elpd_loo_se: z.number(),
      p_loo: z.number().describe("effective number of parameters"),
      reliable: z.boolean().describe("false when a Pareto k is too high to trust"),
    }),
  },
  {
    name: "mcmc_compare",
    title: "Rank models",
    description:
      "Rank two or more runs by expected out-of-sample predictive fit (elpd), with standard errors on the differences. Compare only models fitted to the same observations.",
    command: ["compare"],
    input: {
      targets: z.array(z.string()).min(2).describe("two or more run refs or samples files"),
      store,
    },
    args: (input) => [...(input.targets as string[]), ...flags(input, ["store"])],
    timeoutMs: 15 * MINUTE,
    outputKey: "models",
    output: z.looseObject({
      models: z.array(
        z.looseObject({
          rank: z.number().describe("1 is the best fit"),
          label: z.string(),
          elpd_loo: z.number(),
        }),
      ),
    }),
  },
  {
    name: "mcmc_sbc",
    title: "Check calibration",
    description:
      "Simulation-based calibration: draw parameters from the prior, simulate datasets, refit each, and test that the true values' posterior ranks are uniform. This is the check that catches a model that samples cleanly but encodes the wrong thing. Slow: each simulation is a full fit, so keep the count small unless asked otherwise.",
    command: ["sbc"],
    input: {
      model: z.string().describe("model file or spec with a [predict] block"),
      simulations: z.number().int().positive().optional().describe("datasets to fit (default 20)"),
      draws: z.number().int().positive().optional().describe("posterior draws per refit"),
      chains: z.number().int().positive().optional().describe("chains per refit"),
      data: z.string().optional().describe("data file supplying the covariates"),
    },
    args: (input) => [
      String(input.model),
      ...flags(input, ["simulations", "draws", "chains", "data"]),
    ],
    timeoutMs: 60 * MINUTE,
    output: z.looseObject({
      calibrated: z.boolean().describe("false means the ranks are not uniform"),
      simulations: z.number(),
      parameters: z.array(
        z.looseObject({
          name: z.string(),
          pValue: z.number().describe("small means the model is miscalibrated"),
        }),
      ),
    }),
  },
  {
    name: "mcmc_doctor",
    title: "Check the toolchain",
    description:
      "Whether an inference toolchain is installed and ready (Julia via juliaup, or CmdStan). Run this first when a fit fails to start; `mcmc setup` installs what is missing, but that takes minutes and is left to the user.",
    command: ["doctor"],
    input: {},
    args: () => [],
    timeoutMs: 2 * MINUTE,
    outputKey: "engines",
    output: z.looseObject({
      engines: z.array(
        z.looseObject({
          engineId: z.string(),
          ready: z.boolean().describe("false means `mcmc setup` has to run first"),
        }),
      ),
    }),
  },
];

export function toolByName(name: string): ToolSpec | undefined {
  return TOOLS.find((tool) => tool.name === name);
}
