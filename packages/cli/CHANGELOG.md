# mcmcjs

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
