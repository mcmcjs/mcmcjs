import { z } from "zod";

export const SPEC_SCHEMA_VERSION = "0";

/**
 * The default juliaup channel a fit runs on. Pinned to a specific Julia version
 * (not a moving channel like "release") so a run reproduces the committed,
 * resolved package set the toolchain ships. Override per spec or with
 * `--julia-version` to run on another channel.
 */
export const DEFAULT_JULIA_CHANNEL = "1.12.6";

/**
 * The default CmdStan channel: "installed" resolves to whatever CmdStan the
 * machine already has (newest managed or `~/.cmdstan` install). A concrete
 * version is frozen into the run when the fit resolves it.
 */
export const DEFAULT_CMDSTAN_CHANNEL = "installed";

const Backend = z
  .object({
    id: z.enum(["turing", "juliabugs", "stan"]),
    runtime: z.enum(["julia", "cmdstan"]).optional(),
    /** The runtime version request: a juliaup channel, or a CmdStan version. */
    version: z.string().min(1).optional(),
    /**
     * Optional version pins for managed Julia packages, by name (e.g.
     * `{ Turing = "0.45" }`). Pinned packages provision into their own managed
     * environment, so different pins can be compared without interfering.
     */
    packages: z.record(z.string(), z.string().min(1)).optional(),
  })
  .transform((b) => {
    const stan = b.id === "stan";
    return {
      ...b,
      runtime: b.runtime ?? (stan ? ("cmdstan" as const) : ("julia" as const)),
      version: b.version ?? (stan ? DEFAULT_CMDSTAN_CHANNEL : DEFAULT_JULIA_CHANNEL),
    };
  })
  .superRefine((b, ctx) => {
    const expected = b.id === "stan" ? "cmdstan" : "julia";
    if (b.runtime !== expected) {
      ctx.addIssue({
        code: "custom",
        path: ["runtime"],
        message: `backend "${b.id}" runs on the "${expected}" runtime, not "${b.runtime}"`,
      });
    }
    if (b.packages && b.runtime !== "julia") {
      ctx.addIssue({
        code: "custom",
        path: ["packages"],
        message: "package pins apply to the julia runtime only",
      });
    }
  });

interface ParamRules {
  algorithm: string;
  step_size?: number;
  leapfrog_steps?: number;
  lambda?: number;
  particles?: number;
  slice_width?: number;
}

/** Per-algorithm parameter rules, shared by the sampler and its Gibbs blocks. */
function samplerParamIssues(s: ParamRules): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  if (s.algorithm === "HMC") {
    if (s.step_size === undefined)
      issues.push({ path: "step_size", message: "HMC requires step_size" });
    if (s.leapfrog_steps === undefined) {
      issues.push({ path: "leapfrog_steps", message: "HMC requires leapfrog_steps" });
    }
  } else {
    if (s.step_size !== undefined) {
      issues.push({ path: "step_size", message: "step_size applies to HMC only" });
    }
    if (s.leapfrog_steps !== undefined) {
      issues.push({ path: "leapfrog_steps", message: "leapfrog_steps applies to HMC only" });
    }
  }
  if (s.algorithm === "HMCDA") {
    if (s.lambda === undefined) issues.push({ path: "lambda", message: "HMCDA requires lambda" });
  } else if (s.lambda !== undefined) {
    issues.push({ path: "lambda", message: "lambda applies to HMCDA only" });
  }
  if (s.algorithm === "PG") {
    if (s.particles === undefined) {
      issues.push({ path: "particles", message: "PG requires particles" });
    }
  } else if (s.particles !== undefined) {
    issues.push({ path: "particles", message: "particles applies to PG only" });
  }
  if (s.algorithm === "Slice") {
    if (s.slice_width === undefined) {
      issues.push({ path: "slice_width", message: "Slice requires slice_width" });
    }
  } else if (s.slice_width !== undefined) {
    issues.push({ path: "slice_width", message: "slice_width applies to Slice only" });
  }
  return issues;
}

const GibbsBlock = z
  .object({
    /** Model variables this block updates, by base name. */
    variables: z.array(z.string().min(1)).min(1),
    algorithm: z.enum(["NUTS", "HMC", "HMCDA", "MH", "PG", "ESS", "Slice"]).default("NUTS"),
    adapt_delta: z.number().gt(0).lt(1).default(0.8),
    step_size: z.number().positive().optional(),
    leapfrog_steps: z.number().int().positive().optional(),
    lambda: z.number().positive().optional(),
    particles: z.number().int().positive().optional(),
    slice_width: z.number().positive().optional(),
  })
  .strict()
  .superRefine((b, ctx) => {
    for (const { path, message } of samplerParamIssues(b)) {
      ctx.addIssue({ code: "custom", path: [path], message });
    }
  });

/** Samplers that take an AD backend: gradient-based, or wrappers that may hold one. */
const ADTYPE_ALGORITHMS = new Set(["NUTS", "HMC", "HMCDA", "Gibbs", "External"]);

/** What the juliabugs backend can run as its sampler, and as one Gibbs block. */
const JULIABUGS_ALGORITHMS = new Set(["NUTS", "HMC", "HMCDA", "MH", "Slice", "Gibbs", "Prior"]);
const JULIABUGS_BLOCK_ALGORITHMS = new Set(["NUTS", "HMC", "HMCDA", "MH", "Slice"]);

/** JuliaBUGS samplers that propose in the evaluation environment, discrete latents included. */
const ENV_ALGORITHMS = new Set(["MH", "Gibbs"]);

const Sampler = z
  .object({
    /**
     * "Prior" draws from the prior instead of running MCMC; "Gibbs" composes
     * per-variable blocks; "External" wraps a sampler the model file exports
     * as MCMC_SAMPLER.
     */
    algorithm: z
      .enum([
        "NUTS",
        "HMC",
        "HMCDA",
        "MH",
        "ESS",
        "SMC",
        "PG",
        "Slice",
        "Gibbs",
        "External",
        "Prior",
      ])
      .default("NUTS"),
    draws: z.number().int().positive(),
    /** NUTS/HMCDA adaptation steps; burn-in discarded for the other samplers (SMC excepted). */
    warmup: z.number().int().nonnegative().default(1000),
    chains: z.number().int().positive().default(4),
    adapt_delta: z.number().gt(0).lt(1).default(0.8),
    /** Leapfrog integrator step size (HMC only; NUTS and HMCDA adapt theirs). */
    step_size: z.number().positive().optional(),
    /** Leapfrog steps per proposal (HMC only). */
    leapfrog_steps: z.number().int().positive().optional(),
    /** Target simulation length (HMCDA only). */
    lambda: z.number().positive().optional(),
    /** Particle count (PG only). */
    particles: z.number().int().positive().optional(),
    /** Initial slice window width (Slice only). */
    slice_width: z.number().positive().optional(),
    /** Gibbs blocks, one per [[sampler.blocks]] table (Gibbs only). */
    blocks: z.array(GibbsBlock).min(1).optional(),
    /** Keep every thin-th draw. */
    thin: z.number().int().positive().default(1),
    /** "threads": concurrent chains in one process; "distributed": one worker process per chain (Turing only). */
    parallel: z.enum(["serial", "threads", "distributed"]).default("serial"),
    /** AD backend for gradient-based samplers (default: the backend's own default). */
    adtype: z.enum(["forwarddiff", "reversediff", "mooncake"]).optional(),
    /** Named starting values per variable, replicated across chains. */
    initial_params: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .superRefine((s, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });
    for (const { path, message } of samplerParamIssues(s)) issue(path, message);
    if (s.algorithm === "Gibbs") {
      if (s.blocks === undefined) {
        issue("blocks", "Gibbs composes per-variable blocks; add [[sampler.blocks]] tables");
      }
    } else if (s.blocks !== undefined) {
      issue("blocks", "blocks apply to Gibbs only");
    }
    if (!ADTYPE_ALGORITHMS.has(s.algorithm) && s.adtype !== undefined) {
      issue("adtype", `adtype does not apply to ${s.algorithm}: it has no gradient`);
    }
    if (s.algorithm === "Prior") {
      if (s.thin !== 1) issue("thin", "prior draws are independent; thinning does not apply");
      if (s.parallel !== "serial") {
        issue("parallel", "prior sampling is a single ancestral pass; parallel does not apply");
      }
      if (s.initial_params !== undefined) {
        issue("initial_params", "prior draws are independent; initial_params does not apply");
      }
    }
  });

const ModelFile = z.object({
  kind: z.literal("file"),
  /** Path to the model file, resolved relative to the spec file's directory. */
  path: z.string().min(1),
  entry: z.string().min(1).default("build_model"),
  /**
   * How a JuliaBUGS model evaluates its log density: "graph" walks the node
   * graph, "generated" compiles a specialised function, "marginalized" sums the
   * discrete latents out exactly. Unset leaves the model file's own choice.
   */
  evaluation_mode: z.enum(["graph", "generated", "marginalized"]).optional(),
});

const Output = z
  .object({ format: z.literal("mcmcchains-json").default("mcmcchains-json") })
  .default({ format: "mcmcchains-json" });

const Predict = z
  .object({
    /** Outcome variables to predict, by base name (e.g. "y"); blanked to missing. */
    targets: z.array(z.string().min(1)).min(1),
    /** Optional data overrides applied on top of [data] for the prediction. */
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type PredictSpec = z.infer<typeof Predict>;

export const SpecSchema = z
  .object({
    schema_version: z.literal(SPEC_SCHEMA_VERSION),
    backend: Backend,
    model: z.discriminatedUnion("kind", [ModelFile]),
    sampler: Sampler,
    data: z.record(z.string(), z.unknown()).default({}),
    /**
     * Path to a data file (.csv / .json), relative to the spec's directory,
     * loaded in place of inline `[data]`. The reference (path + hash), not the
     * contents, is recorded in the run, so large datasets are not copied into
     * the spec or the run store.
     */
    data_file: z.string().min(1).optional(),
    output: Output,
    predict: Predict.optional(),
    /** Bounded to the JS-safe integer range so it survives JSON without precision loss. */
    seed: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  })
  .refine((s) => !(s.data_file && Object.keys(s.data).length > 0), {
    message: "set either inline [data] or data_file, not both",
    path: ["data_file"],
  })
  .superRefine((s, ctx) => {
    const issue = (path: string[], message: string) =>
      ctx.addIssue({ code: "custom", path, message });
    const algorithm = s.sampler.algorithm;
    if (s.backend.id === "stan") {
      if (algorithm !== "NUTS") {
        issue(["sampler", "algorithm"], `the stan backend supports NUTS only, not ${algorithm}`);
      }
      if (s.sampler.adtype !== undefined) {
        issue(["sampler", "adtype"], "adtype is a Julia concern; Stan compiles its own gradients");
      }
      if (s.sampler.initial_params !== undefined) {
        issue(
          ["sampler", "initial_params"],
          "initial_params is not supported for the stan backend",
        );
      }
      if (s.sampler.parallel !== "serial") {
        issue(["sampler", "parallel"], "parallel chains are not supported for the stan backend");
      }
    }
    if (s.backend.id === "juliabugs") {
      if (!JULIABUGS_ALGORITHMS.has(algorithm)) {
        issue(
          ["sampler", "algorithm"],
          `the juliabugs backend supports ${[...JULIABUGS_ALGORITHMS].join(", ")}, not ${algorithm}`,
        );
      }
      for (const [i, block] of (s.sampler.blocks ?? []).entries()) {
        if (!JULIABUGS_BLOCK_ALGORITHMS.has(block.algorithm)) {
          issue(
            ["sampler", "blocks", String(i), "algorithm"],
            `a juliabugs Gibbs block supports ${[...JULIABUGS_BLOCK_ALGORITHMS].join(", ")}, not ${block.algorithm}`,
          );
        }
      }
      if (s.sampler.parallel === "distributed") {
        issue(
          ["sampler", "parallel"],
          "distributed chains are Turing-only; the juliabugs backend supports serial or threads",
        );
      }
      // Prior sampling walks the graph ancestrally, so no log density is evaluated.
      if (algorithm === "Prior" && s.model.evaluation_mode !== undefined) {
        issue(
          ["model", "evaluation_mode"],
          "prior draws are one ancestral pass; evaluation_mode does not apply",
        );
      }
      // The environment-based samplers move the discrete latents themselves, so
      // marginalizing them out of the log density would double-count them.
      if (s.model.evaluation_mode === "marginalized" && ENV_ALGORITHMS.has(algorithm)) {
        issue(
          ["model", "evaluation_mode"],
          `${algorithm} samples the discrete latents itself; marginalized applies to the gradient samplers`,
        );
      }
      // JuliaBUGS's generated log density mutates arrays in place, which only
      // Mooncake among our AD backends differentiates through; the others make
      // it warn and fall back to graph evaluation.
      if (s.model.evaluation_mode === "generated" && s.sampler.adtype !== "mooncake") {
        issue(
          ["model", "evaluation_mode"],
          "generated needs sampler.adtype = mooncake; the other backends cannot differentiate it",
        );
      }
    } else {
      if (s.model.evaluation_mode !== undefined) {
        issue(
          ["model", "evaluation_mode"],
          `evaluation_mode is a JuliaBUGS concern; the ${s.backend.id} backend has no equivalent`,
        );
      }
      // Whole or per block, SliceSampling is reachable on turing only as an
      // External sampler the model file exports.
      if (s.backend.id === "turing") {
        const reason =
          "Slice is a juliabugs sampler; on turing reach SliceSampling through External";
        if (algorithm === "Slice") issue(["sampler", "algorithm"], reason);
        for (const [i, block] of (s.sampler.blocks ?? []).entries()) {
          if (block.algorithm === "Slice") {
            issue(["sampler", "blocks", String(i), "algorithm"], reason);
          }
        }
      }
    }
  });

export type Spec = z.infer<typeof SpecSchema>;
