# @mcmcjs/doodleppl

## 0.6.0

### Minor Changes

- 22e7013: Marginalize chain-structured discrete latents: a variable seeded at one index and defined one step back over a plate is summed out by a forward recursion over the previous state, and recovered in generated quantities by forward filtering and backward sampling.

## 0.5.0

### Minor Changes

- 2074154: Validate index-range overlap between nodes that share a variable name, mirroring the BUGS rule that several statements may define one variable only over disjoint ranges; seeded recursions such as a pinned first element beside a plate over 2:N stay valid.

## 0.4.0

### Minor Changes

- 170c5b0: Marginalize discrete latents inside nested plates: the enumeration opens one loop per enclosing plate, multi-index references such as z[i,j] are substituted, and recovery declares a matching multi-dimensional array.

## 0.3.1

### Patch Changes

- cd064f1: Count distribution inputs correctly when a parent is referenced nested inside a parameter expression (for example mu[z[i]]), which previously reported a spurious parameter-count mismatch.

## 0.3.0

### Minor Changes

- bd0610f: Generate marginalized Stan code for discrete latent variables: dcat, dbern, and dbin latents (iid in a plate, or scalar DAGs) are summed out with log_sum_exp via frontier-based variable elimination instead of emitting a warning, observed discrete vectors with missing entries marginalize just the missing ones when data is passed to the generator, and recovered in generated quantities from their exact conditional posterior; unsupported structures (chains, infinite support, unresolvable support sizes) keep the warning comment with the reason.

## 0.2.2

### Patch Changes

- 7919d5e: Fix the generated JuliaBUGS run script erroring on models with inits: `initialize!` was called on the gradient-wrapped model (a MethodError in JuliaBUGS 0.15), and the inits never reached NUTS anyway. The script now initializes the plain model, wraps it with the AD type afterwards, and passes the transformed-space vector to `sample` via `initial_params`.

## 0.2.1

### Patch Changes

- c6f2c64: Republish under a fresh version: 0.2.0 was published and unpublished during an earlier version correction, and npm permanently refuses reuse of such versions, which also left mcmcjs 0.15.6 pointing at a nonexistent dependency.

## 0.2.0

### Minor Changes

- a9fb706: Author the run scripts as `.tpl` templates (inlined at build time) and modernize the JuliaBUGS run script to the v0.15 API: a callable `@bugs` model definition with an `AutoMooncake` AD backend, `initialize!` for inits, and FlexiChains output, replacing the removed `LogDensityProblemsAD`/`ADgradient`/`getparams` pattern.

## 0.1.0

### Minor Changes

- Debut as `@mcmcjs/doodleppl`. The package was previously published as `@mcmcjs/doodlebugs`; it is renamed because it generates code for multiple probabilistic programming languages, and its source is organized into tiers: a `core/` layer (graph types, schema, catalog, validation, topological sort) and a `codegen/` layer (per-target generators: BUGS, Stan, and the JuliaBUGS run-script). It exposes a `@mcmcjs/doodleppl/core` subpath for the graph domain layer and a `@mcmcjs/doodleppl/stan` subpath for the Stan target.
- 9f8c973: Add the JuliaBUGS standalone-script generator (`generateStandaloneScript`), ported from the editor and verified byte-for-byte against its output on the bundled example graphs, alongside reference fixtures that also pin `generateBugsModel` to the editor's exact output.
- 25eb23b: Port the BUGS distribution catalog (26 distributions with parameter metadata), the built-in function set, and the graph validator (`validateGraph`) from the editor, so validation and authoring metadata live in the shared core.
- 9fc2bf3: Initial release: parse DoodleBUGS graphs and generate BUGS model code (graph data model, topological sort, and the graph-to-`model { ... }` codegen ported from the editor), so the codegen has one shared home.
- 514a2e5: Add zod schemas for the graph format (`UnifiedModelDataSchema` and friends) and publish a generated JSON Schema artifact at `@mcmcjs/doodlebugs/graph.schema.json` so any consumer can validate graphs without importing the package.
- 3008951: Add the Stan generator as a `./stan` subpath export (model code, data and inits JSON, and a CmdStanPy run script), ported from the editor and verified byte-for-byte against its output on the twelve bundled example graphs.
