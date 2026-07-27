// Regenerates public/demo.mcmcrun.json, the sample run on the landing page.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const N_DRAWS = 500;
const N_CHAINS = 4;
const SCHOOLS = 8;
const EFFECTS = [28, 8, -3, 7, -1, 1, 18, 12];
const VARS = ["mu", "tau", ...Array.from({ length: SCHOOLS }, (_, i) => `theta[${i + 1}]`)];
const INTERNALS = ["hamiltonian_energy"];
const PARAMS = [...VARS, ...INTERNALS];

let seed = 20260401;
function rand() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
function randn() {
  return Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
}

const nParams = PARAMS.length;
const flat = new Array(N_DRAWS * nParams * N_CHAINS);
for (let c = 0; c < N_CHAINS; c++) {
  for (let p = 0; p < nParams; p++) {
    const isEnergy = p >= VARS.length;
    const center = isEnergy ? 24 : p === 0 ? 4.4 : p === 1 ? 3.6 : 4 + EFFECTS[p - 2] * 0.18;
    const scale = isEnergy ? 3 : p === 1 ? 2.4 : 4.8;
    let x = center + scale * 0.44 * randn();
    for (let i = 0; i < N_DRAWS; i++) {
      x = center + 0.55 * (x - center) + scale * 0.37 * randn();
      const value = isEnergy ? Math.abs(x - center) + center : p === 1 ? Math.abs(x) : x;
      flat[i + p * N_DRAWS + c * N_DRAWS * nParams] = Math.round(value * 1e5) / 1e5;
    }
  }
}

const modelSource = `using Turing

@model function eight_schools(y, sigma)
    mu ~ Normal(0, 5)
    tau ~ truncated(Cauchy(0, 5); lower=0)
    theta ~ filldist(Normal(mu, tau), length(y))
    y .~ Normal.(theta, sigma)
end

build_model(data) = eight_schools(data["y"], data["sigma"])
`;

const bundle = {
  kind: "mcmcjs-run-bundle",
  schema_version: "0",
  entry: {
    id: "20260401-120000-demo42",
    run_key: "demo",
    spec_hash: "demo",
    status: "ok",
    model_path: "eight_schools.jl",
    data_sha256: "demo",
    seed: 42,
    backend: { id: "turing", version: "release" },
    sampler: {
      algorithm: "NUTS",
      draws: N_DRAWS,
      warmup: 250,
      chains: N_CHAINS,
      adapt_delta: 0.8,
    },
    started_at: "2026-04-01T12:00:00Z",
    elapsed_ms: 4218,
    diagnostics: { converged: true, rhat_max: 1.004, divergences: 0 },
  },
  spec: {
    schema_version: "0",
    seed: 42,
    backend: { id: "turing" },
    model: { kind: "file", path: "./eight_schools.jl" },
    sampler: { draws: N_DRAWS, warmup: 250, chains: N_CHAINS },
    data: {
      y: EFFECTS,
      sigma: [15, 10, 16, 11, 9, 11, 10, 18],
    },
  },
  model_source: modelSource,
  samples: {
    size: [N_DRAWS, nParams, N_CHAINS],
    value_flat: flat,
    parameters: PARAMS,
    name_map: { parameters: VARS, internals: INTERNALS },
  },
};

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "demo.mcmcrun.json");
writeFileSync(out, JSON.stringify(bundle));
console.log("wrote", out, `${(JSON.stringify(bundle).length / 1024).toFixed(0)}kB`);
