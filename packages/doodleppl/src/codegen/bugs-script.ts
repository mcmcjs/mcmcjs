// Standalone JuliaBUGS run-script generation, ported from the editor's
// useBugsCodeGenerator. Formats the model data and inits as Julia NamedTuple
// literals and wraps the generated BUGS model code in a runnable script.

// Render a Julia NamedTuple field name.
// With replace_period=true (string-mode @bugs), the parser converts dots to underscores,
// so we must also use underscores in the data/inits NamedTuple keys to match.
function juliaFieldLiteral(name: string): string {
  // After the dot to underscore replacement the result is always a valid Julia identifier
  return String(name).replace(/\./g, "_");
}

function isScalarOrMissing(x: unknown): boolean {
  return x === null || x === undefined || typeof x === "number";
}

function isVectorLike(v: unknown): v is (number | null)[] {
  return Array.isArray(v) && v.every(isScalarOrMissing);
}

function isMatrixLike(v: unknown): v is (number | null)[][] {
  if (!Array.isArray(v) || v.length === 0) return false;
  const rows = v as unknown[];
  const firstRow = rows[0];
  if (!Array.isArray(firstRow)) return false;
  const cols = (firstRow as unknown[]).length;
  return rows.every(
    (r) =>
      Array.isArray(r) &&
      (r as unknown[]).length === cols &&
      (r as unknown[]).every(isScalarOrMissing),
  );
}

function formatNumber(n: number): string {
  if (Number.isNaN(n)) return "NaN";
  if (!Number.isFinite(n)) return n > 0 ? "Inf" : "-Inf";
  return `${n}`;
}

function formatScalar(v: number | null | undefined): string {
  if (v === null || v === undefined) return "missing";
  return formatNumber(v);
}

function formatVector(arr: (number | null)[]): string {
  return `[${arr.map(formatScalar).join(", ")}]`;
}

function formatMatrix(mat: (number | null)[][]): string {
  const rows = mat.map((row) => row.map(formatScalar).join(" ")).join("\n        ");
  return `[\n        ${rows}\n    ]`;
}

function formatValue(v: unknown): string {
  if (v === null) return "missing";
  if (typeof v === "number") return formatNumber(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "string") return JSON.stringify(v);
  if (isMatrixLike(v)) return formatMatrix(v as (number | null)[][]);
  if (isVectorLike(v)) return formatVector(v as (number | null)[]);
  if (Array.isArray(v)) return `[${(v as unknown[]).map(formatValue).join(", ")}]`;
  if (v && typeof v === "object") return JSON.stringify(v);
  return "nothing";
}

function buildNamedTupleLiteral(obj: Record<string, unknown>): string {
  const entries = Object.entries(obj).map(
    ([k, val]) => `  ${juliaFieldLiteral(k)} = ${formatValue(val)}`,
  );
  if (!entries.length) return "()";
  const body = entries.join(",\n");
  const trailingComma = entries.length === 1 ? "," : "";
  return `(\n${body}${trailingComma}\n)`;
}

export interface StandaloneGeneratorSettings {
  n_samples: number;
  n_adapts: number;
  n_chains: number;
  seed?: number | null;
}

export interface StandaloneScriptInput {
  modelCode: string;
  data: Record<string, unknown>;
  inits: Record<string, unknown>;
  settings: StandaloneGeneratorSettings;
}

/** Build a runnable JuliaBUGS script around generated BUGS model code. */
export function generateStandaloneScript(input: StandaloneScriptInput): string {
  const { modelCode, data, inits, settings } = input;

  const dataLiteral = buildNamedTupleLiteral(data);
  const initsLiteral = buildNamedTupleLiteral(inits);

  const nSamples = settings?.n_samples ?? 1000;
  const nAdapts = settings?.n_adapts ?? 1000;
  const nChains = settings?.n_chains ?? 1;
  const seed = settings?.seed;
  const seedLiteral =
    typeof seed === "number" ? String(seed) : seed == null ? "nothing" : JSON.stringify(seed);

  const hasCensoring = /\bC\(/.test(String(modelCode));
  const censoredImport = hasCensoring ? "\nusing Distributions: censored" : "";
  const censoredPrimitive = hasCensoring
    ? "\n# Register censored() as a valid BUGS primitive\nJuliaBUGS.@bugs_primitive censored\n"
    : "";

  return `using JuliaBUGS, AbstractMCMC, AdvancedHMC, LogDensityProblems, LogDensityProblemsAD, MCMCChains, ReverseDiff, Random${censoredImport}

data = ${dataLiteral}

inits = ${initsLiteral}
${censoredPrimitive}
model_def = JuliaBUGS.@bugs("""
${modelCode}
""", true, false)

# Compile the model
model = JuliaBUGS.compile(model_def, data, inits)
ad_model = ADgradient(:ReverseDiff, model)
ld_model = AbstractMCMC.LogDensityModel(ad_model)

# Sampling parameters
n_samples, n_adapts = ${nSamples}, ${nAdapts}
n_chains = ${nChains}
seed = ${seedLiteral}

seed_val = tryparse(Int, string(seed))
rng = seed === nothing ? Random.default_rng() : (seed_val === nothing ? Random.default_rng() : Random.MersenneTwister(seed_val))

initial_θ = try; JuliaBUGS.getparams(model); catch; zeros(LogDensityProblems.dimension(ad_model)); end

# Sample
if n_chains > 1 && Threads.nthreads() > 1
    chain = AbstractMCMC.sample(
        rng, ld_model, NUTS(0.65), MCMCThreads(), n_samples, n_chains;
        chain_type = Chains, n_adapts = n_adapts, init_params = initial_θ,
        discard_initial = n_adapts, progress = false,
    )
elseif n_chains > 1
    chain = AbstractMCMC.sample(
        rng, ld_model, NUTS(0.65), MCMCSerial(), n_samples, n_chains;
        chain_type = Chains, n_adapts = n_adapts, init_params = initial_θ,
        discard_initial = n_adapts, progress = false,
    )
else
    chain = AbstractMCMC.sample(
        rng, ld_model, NUTS(0.65), n_samples;
        chain_type = Chains, n_adapts = n_adapts, init_params = initial_θ,
        discard_initial = n_adapts, progress = false,
    )
end

describe(chain)
`;
}
