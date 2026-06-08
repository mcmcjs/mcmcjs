import { z } from "zod";

export const SPEC_SCHEMA_VERSION = "0";

const Backend = z.object({
  id: z.literal("turing"),
  runtime: z.literal("julia").default("julia"),
  /** The juliaup channel the runtime resolves to (e.g. "release", "1.10"). */
  version: z.string().min(1).default("release"),
});

const Sampler = z
  .object({
    algorithm: z.literal("NUTS").default("NUTS"),
    draws: z.number().int().positive(),
    warmup: z.number().int().nonnegative().default(1000),
    chains: z.number().int().positive().default(4),
    adapt_delta: z.number().gt(0).lt(1).default(0.8),
  })
  .strict();

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

export const SpecSchema = z.object({
  schema_version: z.literal(SPEC_SCHEMA_VERSION),
  backend: Backend,
  model: z.discriminatedUnion("kind", [ModelFile]),
  sampler: Sampler,
  data: z.record(z.string(), z.unknown()).default({}),
  output: Output,
  predict: Predict.optional(),
  /** Bounded to the JS-safe integer range so it survives JSON without precision loss. */
  seed: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});

export type Spec = z.infer<typeof SpecSchema>;
