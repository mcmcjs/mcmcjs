# mcmcjs

## 0.32.3

### Patch Changes

- f56ec5e: Republish the site when a release bumps the CLI, so the version the installer falls back to follows the release instead of the next docs change
- Updated dependencies [5512a24]
- Updated dependencies [0f5d921]
  - @mcmcjs/julia@0.16.0

## 0.32.2

### Patch Changes

- d802b67: `mcmc diagnose` no longer tells a healthy single-chain run that its sampler never moved. R-hat and ESS need two chains to compare, so a one-chain run now says exactly that and points at `--chains 2`, while a genuinely stuck sampler keeps its own note. The report also carries the chain count it diagnosed.
- Updated dependencies [d802b67]
- Updated dependencies [d802b67]
  - @mcmcjs/diagnostics@0.9.0
  - @mcmcjs/plots@0.8.3

## 0.32.1

### Patch Changes

- d8c976f: Depend on a version of `@mcmcjs/doodleppl` that actually exports `discreteLatentNames`: 0.32.0 imported it from the unreleased source, so an installed CLI failed at startup
- Updated dependencies [d8c976f]
  - @mcmcjs/doodleppl@0.7.0

## 0.32.0

### Minor Changes

- 2ac2ead: Add `--evaluation-mode` to select how a JuliaBUGS model evaluates its log density (graph, generated, or marginalized), overriding the model file's own choice
- c7139a3: mcmc convert now emits a JuliaBUGS model that enables auto-marginalization when the graph has discrete latents, so such a model fits with NUTS instead of failing on an integer gradient, and the latents come back in the chain.

### Patch Changes

- c7139a3: Treat a variable that is constant across every draw as neutral for the convergence verdict rather than as a failure, since R-hat and ESS are undefined for it; a run whose every variable is constant still counts as not converged.
- 2ac2ead: Treat a variable as undiagnosable, and so neutral in the convergence verdict, whenever R-hat and ESS are undefined for want of variation rather than for unusable draws: a recovered discrete latent that sits on one value in one chain and moves once in another has a non-zero standard deviation but still no R-hat
- 2ac2ead: Say plainly when a run's every variable is constant, so a table of n/a diagnostics reads as a sampler that never moved rather than a diagnostics failure
- Updated dependencies [2ac2ead]
- Updated dependencies [c7139a3]
- Updated dependencies [2ac2ead]
- Updated dependencies [2ac2ead]
- Updated dependencies [2ac2ead]
- Updated dependencies [2ac2ead]
- Updated dependencies [2ac2ead]
  - @mcmcjs/julia@0.15.0
  - @mcmcjs/diagnostics@0.8.0
  - @mcmcjs/plots@0.8.2
  - @mcmcjs/core@0.12.0
  - @mcmcjs/stan@0.1.6

## 0.31.4

### Patch Changes

- Updated dependencies [22e7013]
  - @mcmcjs/doodleppl@0.6.0

## 0.31.3

### Patch Changes

- Updated dependencies [2074154]
  - @mcmcjs/doodleppl@0.5.0

## 0.31.2

### Patch Changes

- Updated dependencies [170c5b0]
  - @mcmcjs/doodleppl@0.4.0

## 0.31.1

### Patch Changes

- Updated dependencies [cd064f1]
  - @mcmcjs/doodleppl@0.3.1

## 0.31.0

### Minor Changes

- 89e2521: mcmc convert gains a --stan flag that emits a Stan program and a fit-able stan-backend spec from a DoodleBUGS graph, next to the existing JuliaBUGS target.

### Patch Changes

- Updated dependencies [bd0610f]
  - @mcmcjs/doodleppl@0.3.0

## 0.30.0

### Minor Changes

- d25890d: The MCP server moves to the v2 SDK: one server now answers both the current protocol and 2025-era clients, and every tool declares an output schema and returns structured content, so an assistant reads typed fields instead of re-parsing a blob. `mcmc update` shows what it is doing: a download progress bar on a terminal, one line per step when piped, and silence under `--json`.

## 0.29.0

### Minor Changes

- 82e3277: Drive mcmcjs from an AI assistant: `mcmc mcp` runs an MCP server exposing run, diagnose, summary, runs, loo, compare, sbc, and doctor as tools, and `mcmc skill install` writes a skill teaching the model-file contract and the check-before-you-trust workflow. Both ship inside the CLI, so there is nothing extra to install and the tools cannot drift from the commands they wrap.

## 0.28.3

### Patch Changes

- 347fac0: The site moved to https://mcmcjs.github.io/, so the install and uninstall commands, the report app URL, and the update notice all point there.

## 0.28.2

### Patch Changes

- 88755cc: `mcmc update` no longer fails with EXDEV when the temp directory and the install directory are on different filesystems, which is the normal case for /tmp and ~/.local/bin. The new binary is staged beside the old one and renamed over it.

## 0.28.1

### Patch Changes

- 7079c74: The browser now finds runs wherever they were recorded. `mcmc run` puts its store beside the model, so a run launched from a subdirectory used to leave the list reading "Runs 0"; every store under the project is read now, newest run first, and each one opens against its own store. An exported run bundle is also no longer mistaken for a spec just because it carries a schema_version.

## 0.28.0

### Minor Changes

- 370b71d: Add `mcmc update`, which updates this copy in place: a binary install replaces itself from the latest release after checking the download against the release checksums, and an npm install goes through npm. `--check` only reports, `--force` reinstalls the current version to repair one. `mcmc --version` now draws the wordmark for a person at a terminal, keeping the parseable version on line 1 for scripts.

## 0.27.0

### Minor Changes

- 165c7cd: The browser now lists only files that really declare a model: a Julia file needs a `@model` or a `build_model`, a Stan file needs a `model` or `parameters` block, and `@model` inside a comment or docstring does not count, so a Julia library no longer shows every source file as a model. A model with no entry function is marked `needs a build_model` and can have the missing line added for it, and `mcmc run` prints the same suggestion when a fit fails for want of one.

## 0.26.1

### Patch Changes

- 4a8b644: The install script now points out that a shell caches the path of the mcmc it ran before (so an older copy keeps running until `hash -r`), and finds leftover copies that a plain lookup skips. A matching uninstall script removes the binary, and optionally the cached driver and report server state, leaving your runs and Julia alone.

## 0.26.0

### Minor Changes

- 5e35943: Install without npm: `curl -fsSL https://mcmcjs.github.io/mcmcjs/install.sh | sh` fetches a single-file `mcmc` binary that carries its own runtime, the example templates, and the Julia driver, so it needs neither Node.js nor npm. The script verifies release checksums and reports an existing install rather than silently shadowing it, and `mcmc doctor` now names the copy that is running and warns when a second one is on PATH.

### Patch Changes

- Updated dependencies [5e35943]
  - @mcmcjs/julia@0.14.1

## 0.25.1

### Patch Changes

- 76cf1a3: The report handoff link now points at the run's own bundle, so a report app still cached from an earlier version opens the run instead of failing with a 404, and the store server gives up its port when its state file disappears with a discarded sandbox.

## 0.25.0

### Minor Changes

- eef1c54: Add mcmc browse, an interactive browser over the project's runs and model files: filter as you type, then read a run's summary, diagnostics, per-variable traces, and plots, launch or repeat a fit, or delete a run; bare `mcmc` opens it when a terminal is attached and still prints the help otherwise.
- 5ffbcae: The report app now pairs with the CLI instead of being handed a one-shot link: `mcmc report` runs a background store server on a stable port with a token the app remembers, so a reloaded or bookmarked tab reconnects on its own and lists every store you have reported from. The server caches preflights, idles out after 30 minutes, and is managed with `mcmc report status` and `mcmc report stop`; `mcmc run --report` opens a finished run straight away.
- 1ace7d2: mcmc run with no input now offers the project's model files to pick from when a terminal is attached, and still fails with a clear message when piped.

## 0.24.0

### Minor Changes

- eaae25c: mcmc run accepts the full sampler surface: --algorithm now covers ESS, SMC, PG, Gibbs, and External, and --parallel adds distributed for one worker process per chain on the turing backend.
- 60ee073: Add mcmc sbc, the simulation-based calibration check: parameters drawn from the prior, datasets simulated through the model, each one refit, and the true parameters' posterior ranks tested for uniformity, with a rank histogram and a chi-square verdict per parameter. mcmc run gains --parallel for threaded chains.

### Patch Changes

- Updated dependencies [60ee073]
- Updated dependencies [eaae25c]
- Updated dependencies [60ee073]
- Updated dependencies [eaae25c]
- Updated dependencies [60ee073]
  - @mcmcjs/core@0.11.0
  - @mcmcjs/diagnostics@0.7.0
  - @mcmcjs/julia@0.14.0
  - @mcmcjs/plots@0.8.1
  - @mcmcjs/stan@0.1.5

## 0.23.0

### Minor Changes

- ce4801f: `mcmc run` gains `--algorithm` (NUTS, HMC, HMCDA, MH, Prior), --thin, and --adtype; mcmc export materializes the cached loglik.json; and mcmc plot gains the loo-pit calibration check via --loglik.

### Patch Changes

- Updated dependencies [ce4801f]
- Updated dependencies [ce4801f]
- Updated dependencies [ce4801f]
- Updated dependencies [ce4801f]
- Updated dependencies [ce4801f]
  - @mcmcjs/core@0.10.0
  - @mcmcjs/diagnostics@0.6.0
  - @mcmcjs/julia@0.13.0
  - @mcmcjs/plots@0.8.0
  - @mcmcjs/stan@0.1.4

## 0.22.0

### Minor Changes

- c29759c: Complete the model-checking workflow: mcmc run --prior draws from the prior, mcmc loo estimates out-of-sample fit with PSIS-LOO and WAIC (pointwise log-likelihood computed once and cached in the run directory, or read from Stan log_lik columns), mcmc compare ranks runs by elpd with paired-difference errors, and mcmc plot gains ppc-density and ppc-stat kinds with an --observed flag.

### Patch Changes

- Updated dependencies [c29759c]
- Updated dependencies [c29759c]
- Updated dependencies [c29759c]
- Updated dependencies [c29759c]
  - @mcmcjs/core@0.9.0
  - @mcmcjs/diagnostics@0.5.0
  - @mcmcjs/julia@0.12.0
  - @mcmcjs/plots@0.7.0
  - @mcmcjs/stan@0.1.3

## 0.21.0

### Minor Changes

- 0ad5194: `mcmc report` now serves the whole run store over the loopback handoff (the linked run, the ledger, and any run by id), and a new `--watch` flag keeps the server up so the report app can browse every run without file pickers.

## 0.20.1

### Patch Changes

- Updated dependencies [6c68892]
  - @mcmcjs/plots@0.6.3

## 0.20.0

### Minor Changes

- 3376401: mcmc report opens a run in the report web app, mcmc export gains a bundle kind that writes a portable single-file run, and every successful mcmc run prints its report link.

### Patch Changes

- Updated dependencies [3376401]
  - @mcmcjs/core@0.8.0
  - @mcmcjs/julia@0.11.3
  - @mcmcjs/plots@0.6.2
  - @mcmcjs/stan@0.1.2

## 0.19.2

### Patch Changes

- @mcmcjs/plots@0.6.1

## 0.19.1

### Patch Changes

- Updated dependencies [7d83dc5]
  - @mcmcjs/plots@0.6.0

## 0.19.0

### Minor Changes

- b361256: mcmc plot gains --kind corner, a PairPlots.jl-style corner plot with sigma contours, layered marginals, quantile titles, and a --truth flag for reference lines.

### Patch Changes

- Updated dependencies [b361256]
- Updated dependencies [8b3551f]
  - @mcmcjs/plots@0.5.0

## 0.18.2

### Patch Changes

- Updated dependencies [885bf43]
  - @mcmcjs/julia@0.11.2

## 0.18.1

### Patch Changes

- Updated dependencies [5593cd1]
  - @mcmcjs/julia@0.11.1

## 0.18.0

### Minor Changes

- 621aa32: mcmc fit --verbose now streams the sampler's raw output live instead of a progress bar, matching how it already shows raw install and precompile output.

### Patch Changes

- Updated dependencies [84fd81b]
- Updated dependencies [81fe2b2]
- Updated dependencies [84fd81b]
  - @mcmcjs/engine@0.6.0
  - @mcmcjs/julia@0.11.0
  - @mcmcjs/stan@0.1.1

## 0.17.0

### Minor Changes

- 079b540: mcmc predict now supports the JuliaBUGS backend, completing predict coverage across all three backends.

### Patch Changes

- Updated dependencies [86a6841]
- Updated dependencies [079b540]
  - @mcmcjs/julia@0.10.0

## 0.16.0

### Minor Changes

- bde15df: Bare `mcmc doctor` now reports every engine's toolchain as titled sections (exit 0 when at least one engine is ready); `--engine <id>` keeps the flat single-engine format.
- 5409664: Stan reaches full command parity: `mcmc predict` works for Stan specs via generated quantities, `mcmc stan version list/add/remove` manages CmdStan installs, `mcmc fit --versions` runs a spec across CmdStan versions, `mcmc sandbox --strict` now isolates CmdStan alongside Julia, the sandbox and `mcmc init` templates include a Stan model, and a `.stan` model named next to a Julia-backend spec runs on the Stan engine with the spec's settings.
- 10c2959: Stan support across the CLI: `mcmc run model.stan` fits through a local CmdStan with the full store/diagnose workflow, `mcmc fit` accepts Stan specs, `mcmc setup --engine stan` provisions CmdStan, and `doctor`/`engines` report the Stan toolchain.

### Patch Changes

- Updated dependencies [824bf3c]
- Updated dependencies [cd96f4d]
- Updated dependencies [84cfd6b]
- Updated dependencies [4cec81d]
- Updated dependencies [2d321f0]
  - @mcmcjs/core@0.7.0
  - @mcmcjs/stan@0.1.0
  - @mcmcjs/julia@0.9.1
  - @mcmcjs/plots@0.4.2

## 0.15.8

### Patch Changes

- Updated dependencies [7919d5e]
  - @mcmcjs/doodleppl@0.2.2

## 0.15.7

### Patch Changes

- Updated dependencies [c6f2c64]
  - @mcmcjs/doodleppl@0.2.1

## 0.15.6

### Patch Changes

- Updated dependencies [a9fb706]
- Updated dependencies [dacb976]
  - @mcmcjs/doodleppl@0.2.0
  - @mcmcjs/julia@0.9.0

## 0.15.5

### Patch Changes

- Updated dependencies [8c57520]
  - @mcmcjs/julia@0.8.0

## 0.15.4

### Patch Changes

- Point at the renamed codegen package.
  - @mcmcjs/doodleppl@0.1.0

## 0.15.2

### Patch Changes

- @mcmcjs/plots@0.4.1

## 0.15.1

### Patch Changes

- Updated dependencies [d136f5e]
  - @mcmcjs/plots@0.4.0

## 0.15.0

### Minor Changes

- 14156c3: `mcmc plot --kind` gains `violin`, `chain-intervals`, and `chain-intervals-all`.
- e14778c: `mcmc plot` gains a `parallel-coords` kind that renders a parallel-coordinates plot over all (or selected) variables in terminal, SVG, and HTML.
- 196793d: Add a `samples` command to export raw draws in a portable format: chain-major `{ chain_1: { variable: [...] } }` JSON (`--to json`, default) or MCMCChains JSON (`--to mcmcchains-json`), with `--stdin`, `--warmup`, `--store`, and `-o/--out`.
- c017f6b: `mcmc plot --kind` gains `ecdf`, `cumulative-mean`, and `running-rhat`.
- 5e84c07: `mcmc plot` gains a `scatter` kind and a `--color-by <var>` option that shades a two-variable scatter by a third variable via viridis (svg/html).
- 521ee6c: `mcmc plot` gains a `splom` kind that renders a scatter-plot matrix over all (or selected) variables in terminal, SVG, and HTML.
- 5695135: Add `--stdin` (read samples from standard input) and `--warmup <n>` (discard the first n draws of each chain before computing) to `diagnose` and `plot`.
- 464d21f: Add a `summary` command: a focused posterior stats table (mean, std, mcse, ess_bulk, ess_tail, r_hat, hdi) with `--json`, `--stdin`, `--warmup`, `--store`, and `--var` filtering.
- 0af8047: `mcmc plot --kind` gains `summary-table` and `diagnostics-heatmap`.

### Patch Changes

- Updated dependencies [e2a349c]
- Updated dependencies [e2a349c]
- Updated dependencies [e2a349c]
- Updated dependencies [d76de33]
- Updated dependencies [25f73ff]
- Updated dependencies [af59faf]
- Updated dependencies [41b85d6]
- Updated dependencies [0af8047]
- Updated dependencies [14156c3]
- Updated dependencies [e14778c]
- Updated dependencies [c017f6b]
- Updated dependencies [5e84c07]
- Updated dependencies [d62059c]
- Updated dependencies [521ee6c]
- Updated dependencies [0af8047]
  - @mcmcjs/core@0.6.0
  - @mcmcjs/diagnostics@0.4.0
  - @mcmcjs/plots@0.3.0
  - @mcmcjs/julia@0.7.1

## 0.14.0

### Minor Changes

- 06f6b25: `mcmc plot --format html` writes a self-contained interactive HTML page (uPlot inlined, pan/zoom, in-browser PNG/SVG export) that opens offline with no network access.

### Patch Changes

- Updated dependencies [43fd233]
  - @mcmcjs/plots@0.2.0

## 0.13.0

### Minor Changes

- 22f607a: Add `mcmc plot [target]`, which renders MCMC diagnostic plots in the terminal for a run ref (latest, @N, id prefix) or a samples file, reusing the same resolution as `mcmc diagnose`. Supports `--kind trace|forest` (default forest), `--var` to filter parameters, `--ascii` for plain glyphs, `--hdi-prob`, `--width`/`--height`, `-o/--out` to write to a file, and `--json` to emit the underlying plot data.
- cee37af: `mcmc plot` gains `--kind density` and `--kind histogram` (rendered per variable), plus `--bins` to override histogram bin selection.
- 0921877: `mcmc plot --kind energy` renders the HMC/NUTS energy diagnostic (marginal vs transition energy, with E-BFMI) in the terminal or as SVG, completing the plot-type set.
- e9cd91b: `mcmc plot --kind pair --var x y` renders the joint scatter of two variables (terminal or SVG), with divergent transitions highlighted in the SVG output.
- b382de5: `mcmc plot` gains `--kind rank` and `--kind autocorr` (per variable), with `--max-lag` for autocorrelation and `--bins` also applying to rank.
- 3b8c131: `mcmc plot` gains `--format svg` for publication-quality export: it renders trace/density/histogram/autocorr/forest as SVG and, with multiple variables, stacks them into one document. Use `-o file.svg` to save (headless/CI friendly).

### Patch Changes

- af55da5: `mcmc plot --kind rank --format svg` is now supported (rank rounds out the SVG plot set).
- Updated dependencies [b382de5]
- Updated dependencies [cee37af]
- Updated dependencies [0921877]
- Updated dependencies [f61cb7b]
- Updated dependencies [22f607a]
- Updated dependencies [e9cd91b]
- Updated dependencies [b382de5]
- Updated dependencies [af55da5]
- Updated dependencies [3b8c131]
  - @mcmcjs/diagnostics@0.3.0
  - @mcmcjs/plots@0.1.0

## 0.12.0

### Minor Changes

- 6a34d34: Ctrl+C during sampling now cancels the fit gracefully: `mcmc run` and `mcmc fit` stop the Julia process promptly, record the run as `cancelled` (shown in `mcmc runs`/`mcmc show`), and exit 130, instead of leaving a runtime process behind. `--draws-out` is noted as skipped when a run is reused.
- 4f29e06: Add `mcmc run --stream-out <file>`, which streams sampled draws as NDJSON (one batch per line) as the run produces them. Pass `-` to stream to stdout (with the run report routed to stderr) for piping into another process.

### Patch Changes

- b3b932b: Model data (inline, `--data`, or a spec `data_file`) is now validated as canonical numeric data: non-numeric, missing, or ragged values are rejected with a clear error. Data loading moved into `@mcmcjs/core`.
- 5dd628c: Default runs now target the pinned Julia version for reproducibility, and provisioning instantiates the shipped, resolved package set. Pass `--julia-version` to run on another channel.
- Updated dependencies [a647be4]
- Updated dependencies [80f5fab]
- Updated dependencies [99e5581]
- Updated dependencies [b3b932b]
- Updated dependencies [b38a4e5]
- Updated dependencies [5af3509]
- Updated dependencies [32a5ac5]
- Updated dependencies [469da2e]
- Updated dependencies [3d7186c]
- Updated dependencies [f7648a9]
- Updated dependencies [6d66bd2]
  - @mcmcjs/core@0.5.0
  - @mcmcjs/engine@0.5.0
  - @mcmcjs/julia@0.7.0

## 0.11.0

### Minor Changes

- 67ca21c: Restructure `mcmc --help` and make bare invocations friendly. The command list is now grouped under functional headings (Run inference, Inspect runs, Start a project, Toolchain) with terse summaries, and the help carries a quickstart line, an exit-code legend, and a docs link. Bare `mcmc` now prints that grouped help and exits 0 instead of erroring. Bare `mcmc julia` (and `mcmc julia version`) now shows the Julia version status and exits 0, consistent with `mcmc runs` and `mcmc daemon`.

### Patch Changes

- f69bd3e: Make `mcmc --help` self-explanatory: a footer now tells users to run `mcmc <command> --help` for a command's options, notes that `[options]` marks commands that take flags, and points out that `julia`, `daemon`, and `runs` group further subcommands. Mistyped or missing commands now suggest the closest match ("Did you mean fit?") and point at `mcmc --help`.

## 0.10.0

### Minor Changes

- fe09171: Add `mcmc init [dir]` — a non-interactive scaffold that seeds a directory with a runnable example model, data, and README, then exits (no shell, no prompts, works under piped stdio). This is the agent- and CI-friendly counterpart to `mcmc sandbox`: refuses a non-empty directory unless `--force`, supports `--json`, and pairs with `mcmc run`. The `mcmc sandbox` non-TTY error now points scripts and agents to it.
- 5114d0f: Fix `mcmc sandbox` exit handling and make the keep decision scriptable. Ctrl+C or Ctrl+D at the keep prompt no longer kills the process mid-decision and orphans the temp directory silently; it now leaves the sandbox in place and prints where it is (a panic key never deletes). The prompt wording is clearer (Enter or n deletes, y keeps), and new flags pre-decide without prompting: `--keep`, `--delete`, and `--keep-dir <path>` / `--name <n>` to keep and relocate the sandbox (copied then removed, so it works across filesystems).
- 0b69530: `mcmc --version` now prints GNU-style multi-line output: the version on the first line (`mcmc (mcmcjs) X.Y.Z`, still machine-parseable with `head -1`), followed by the one-line description, copyright with the build year, license, and homepage. The metadata is baked in at build time, so the published binary carries it with no runtime package.json. (The update-available note still appears separately on stderr for TTY sessions.)

## 0.9.0

### Minor Changes

- c0ae99c: `mcmc run model.jl` now picks up a sibling data file automatically: with no `--data` and no spec, it uses `<model>.csv`, `data.csv`, or `data.json` from the model's directory (a note says which; `--data` still overrides). A missing `--data`/`data_file` path now fails with a clear "data file not found" message, and a fit that fails reading data fields with no data provided prints a hint pointing at `--data`. The sandbox's seeded model runs with a bare `mcmc run model.jl`.

### Patch Changes

- acacc1a: Ctrl+C during a fit or install now aborts cleanly: the Julia process group is killed and the CLI exits 130, rather than the run continuing in the background. The live install region is erased before exit so the terminal is left clean.
- Updated dependencies [acacc1a]
  - @mcmcjs/engine@0.4.0
  - @mcmcjs/julia@0.6.1

## 0.8.0

### Minor Changes

- 30382bf: Show the long install/precompile output live but clean up after it: by default a TTY keeps a small fixed region (a spinner with the current phase and elapsed time, above the last few real output lines) that is erased once the step finishes, so the firehose is visible while it runs and gone when it is done; a non-TTY prints one line per phase. Failures still print the captured output tail so the real error stays visible. `--verbose` (on run/fit/predict/setup and julia version add/remove/update/gc) keeps the full raw stream on screen, and `--json` stays silent.

## 0.7.0

### Minor Changes

- 9cdac38: Treat --data (and a spec's data_file) as a reference: the data is loaded for the fit but recorded by path + file hash, and the frozen spec in the run store references the file instead of inlining a copy, so large datasets no longer bloat the store.
- e11251f: Stream live logs during the long phases instead of a static line: mcmc setup now shows juliaup's install output, and the "Preparing the Julia environment" step streams Pkg resolve/precompile output (both on stderr, so --json stays clean). A "starting Julia and loading Turing" indicator fills the brief silent gap before per-chain sampling progress.
- c678c9f: Pin and compare package versions: `[backend.packages]` in a spec, `--package name=version` on run (repeatable, flags win), and `mcmc fit --package-versions Turing=0.44,0.45` to run a spec across versions of a managed package, each in its own environment.
- fd302ac: Add `mcmc sandbox --strict` (and `pnpm sandbox --strict`): a fully isolated sandbox that redirects the managed environment, Julia/juliaup depots, caches, and worker sockets inside the throwaway directory, so it starts with no Julia installed and `mcmc setup` provisions a fresh toolchain that vanishes on exit.

### Patch Changes

- 3e6ab56: Fix mcmc fit --versions across Julia versions: each version now provisions its own managed environment, so a Manifest resolved by one Julia no longer fails to precompile under another.
- b2fda34: Polish the live-logs work from review: the "starting" indicator is a plain newline-terminated line (no parked cursor, so it never garbles the daemon's worker notice on a shared terminal) and names the actual backend (Turing.jl or JuliaBUGS); and mcmc julia version add/remove/update/gc now stream juliaup's install output live like mcmc setup.
- cf7f6d2: Harden the package-pin and matrix features from review: reject version strings that could inject Julia code (only safe version-spec characters allowed), make mcmc fit --versions honor a spec's package pins and record file-data references per version, reject --versions with --package-versions together, fail fast on unmanaged/unsafe pins, isolate juliaup under HOME in --strict sandboxes, and stop leaking the resolved dataFilePath into exported specs.
- Updated dependencies [9cdac38]
- Updated dependencies [c678c9f]
- Updated dependencies [e11251f]
- Updated dependencies [9cdac38]
- Updated dependencies [c678c9f]
- Updated dependencies [3e6ab56]
- Updated dependencies [cf7f6d2]
  - @mcmcjs/core@0.4.0
  - @mcmcjs/engine@0.3.0
  - @mcmcjs/julia@0.6.0

## 0.6.0

### Minor Changes

- 2a6e611: Show live per-chain sampling progress during run and fit, add --daemon (persistent Julia worker, 10x faster warm refits) with a daemon status/stop command group, and add mcmc sandbox: a throwaway shell seeded with a working example that is deleted on exit unless you choose to keep it.
- 65484ab: Rework run around the hidden .mcmc run store: no more scaffolded model.toml or sibling samples files, settings flags always win over an optional spec, unchanged model+data+settings reuse the previous run (--refit to force), and new runs, show, and export commands plus diagnose defaulting to the latest run make the store the way to track models.
- bbbc3bd: Notify about newer releases: a daily background check against the npm registry caches the latest version, and interactive commands end with a dim note when an update is available (stderr only, skipped without a TTY, in CI, and with MCMC_NO_UPDATE_CHECK=1).

### Patch Changes

- Updated dependencies [65484ab]
- Updated dependencies [65484ab]
- Updated dependencies [2a6e611]
- Updated dependencies [2a6e611]
  - @mcmcjs/core@0.3.0
  - @mcmcjs/julia@0.5.0
  - @mcmcjs/engine@0.2.0

## 0.5.1

### Patch Changes

- Updated dependencies [eaf569f]
  - @mcmcjs/julia@0.4.0

## 0.5.0

### Minor Changes

- 2ac0dc3: Add `mcmc run`, the zero-config front door: point it at a model file (`mcmc run model.jl --data data.csv`), an existing spec, or a DoodleBUGS graph, and it scaffolds a default spec when needed (backend detected from the model, data loaded from JSON or CSV, seed drawn once and saved), prints it, then fits and diagnoses in one command. `--init` stops after writing the spec for editing; an existing spec is reused on reruns.

## 0.4.0

### Minor Changes

- 864fc0d: Add `mcmc convert <graph.json>`: turn a DoodleBUGS graph into an idiomatic JuliaBUGS model file and a fit-able spec (backend `juliabugs` with the extracted `[data]`), so a graph can go straight to `mcmc fit`.
- 3ef8723: `mcmc diagnose` now reports divergent draws and fails the verdict when they exceed `--max-divergences` (default 0).
- 8173a7f: Add `mcmc fit --versions a,b,c` to run the same spec across multiple Julia versions, with `--keep-going`.
- 25eba55: Add the `mcmc fit` command, which runs Turing inference from a spec file and writes a samples file plus a reproducibility record.
- 7af7cfd: Add the `mcmc julia version` command group and `mcmc engines`, and route `mcmc doctor` through the engine registry.
- 5c3b6aa: Add the `mcmc predict` command, drawing posterior-predictive samples from a fitted model and its samples file.

### Patch Changes

- 088da28: Show the Julia environment-preparation notice across all fit and predict paths (including env healing and the version matrix), and fail fast when predicting with a non-Turing backend.
- Updated dependencies [84910a9]
- Updated dependencies [4205801]
- Updated dependencies [ebc1a69]
- Updated dependencies [d81dd1a]
- Updated dependencies [15681e8]
- Updated dependencies [9f8c973]
- Updated dependencies [25eb23b]
- Updated dependencies [9fc2bf3]
- Updated dependencies [514a2e5]
- Updated dependencies [3008951]
- Updated dependencies [a1324b3]
- Updated dependencies [31e9b46]
- Updated dependencies [2c53eb2]
- Updated dependencies [ea72662]
- Updated dependencies [956c62a]
- Updated dependencies [431d520]
- Updated dependencies [83e99b4]
- Updated dependencies [2fc817d]
- Updated dependencies [b69b192]
  - @mcmcjs/core@0.2.0
  - @mcmcjs/diagnostics@0.2.0
  - @mcmcjs/doodlebugs@0.1.0
  - @mcmcjs/engine@0.1.0
  - @mcmcjs/julia@0.3.0

## 0.3.0

### Minor Changes

- 3025e8f: Add the `mcmc setup` command, which installs the Julia toolchain (juliaup and Julia) needed for inference.

### Patch Changes

- Updated dependencies [f94d19a]
  - @mcmcjs/julia@0.2.0

## 0.2.0

### Minor Changes

- 4cf6c51: Add the `mcmc doctor` command, which reports the installed Julia toolchain (juliaup and Julia).

### Patch Changes

- Updated dependencies [4cf6c51]
  - @mcmcjs/julia@0.1.0

## 0.1.0

### Minor Changes

- 6a95dfb: Initial release: the `mcmc` command-line tool with `mcmc diagnose`, a convergence report (R-hat, ESS, MCSE, HDI) from a samples file, with a human-readable table and `--json`, `--rhat-max`/`--ess-min`/`--hdi-prob` options, and a 0/1/2 exit-code contract.

### Patch Changes

- Updated dependencies [6a95dfb]
- Updated dependencies [6a95dfb]
  - @mcmcjs/core@0.1.0
  - @mcmcjs/diagnostics@0.1.0
