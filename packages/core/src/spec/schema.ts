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

const Sampler = z
  .object({
    /** "Prior" draws from the prior instead of running MCMC (no warmup or adaptation). */
    algorithm: z.enum(["NUTS", "HMC", "HMCDA", "MH", "Prior"]).default("NUTS"),
    draws: z.number().int().positive(),
    /** NUTS/HMCDA adaptation steps; burn-in discarded for MH and HMC. */
    warmup: z.number().int().nonnegative().default(1000),
    chains: z.number().int().positive().default(4),
    adapt_delta: z.number().gt(0).lt(1).default(0.8),
    /** Leapfrog integrator step size (HMC only; NUTS and HMCDA adapt theirs). */
    step_size: z.number().positive().optional(),
    /** Leapfrog steps per proposal (HMC only). */
    leapfrog_steps: z.number().int().positive().optional(),
    /** Target simulation length (HMCDA only). */
    lambda: z.number().positive().optional(),
    /** Keep every thin-th draw. */
    thin: z.number().int().positive().default(1),
    /** "threads" samples chains concurrently on Julia threads (one process). */
    parallel: z.enum(["serial", "threads"]).default("serial"),
    /** AD backend for gradient-based samplers (default: the backend's own default). */
    adtype: z.enum(["forwarddiff", "reversediff", "mooncake"]).optional(),
    /** Named starting values per variable, replicated across chains. */
    initial_params: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .superRefine((s, ctx) => {
    const gradient = s.algorithm === "NUTS" || s.algorithm === "HMC" || s.algorithm === "HMCDA";
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });
    if (s.algorithm === "HMC") {
      if (s.step_size === undefined) issue("step_size", "HMC requires step_size");
      if (s.leapfrog_steps === undefined) issue("leapfrog_steps", "HMC requires leapfrog_steps");
    } else {
      if (s.step_size !== undefined) issue("step_size", "step_size applies to HMC only");
      if (s.leapfrog_steps !== undefined) {
        issue("leapfrog_steps", "leapfrog_steps applies to HMC only");
      }
    }
    if (s.algorithm === "HMCDA") {
      if (s.lambda === undefined) issue("lambda", "HMCDA requires lambda");
    } else if (s.lambda !== undefined) {
      issue("lambda", "lambda applies to HMCDA only");
    }
    if (!gradient && s.adtype !== undefined) {
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
      if (algorithm !== "NUTS" && algorithm !== "Prior") {
        issue(
          ["sampler", "algorithm"],
          `the juliabugs backend supports NUTS and Prior only, not ${algorithm}`,
        );
      }
      if (s.sampler.adtype !== undefined) {
        issue(["sampler", "adtype"], "a JuliaBUGS model chooses its adtype in the model file");
      }
      if (s.sampler.initial_params !== undefined) {
        issue(
          ["sampler", "initial_params"],
          "initial_params is not supported for the juliabugs backend",
        );
      }
    }
  });

export type Spec = z.infer<typeof SpecSchema>;
