#!/usr/bin/env sh
# Build the workspace, pack the publishable packages, and install them into a
# throwaway prefix — then drop into a shell where `mcmc` behaves exactly as it
# would for a real user (`npm install`). The prefix lives under the shared
# ${TMPDIR:-/tmp}/mcmcjs parent, is seeded with the example model, and a
# `mcmcjs-sandbox` symlink appears in the directory you ran this from. Leaving
# the shell (exit or Ctrl+D) removes the sandbox and the symlink; so does the
# script dying, via the EXIT trap.
#
#   pnpm sandbox            # isolated install of the local build
#   pnpm sandbox --strict   # also a fresh Julia depot/managed env inside the sandbox
set -e

STRICT=""
[ "$1" = "--strict" ] && STRICT=1

INVOKED_DIR=$(pwd)
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"

echo "Building workspace packages..."
# append-only so the parallel per-package tsup logs stack instead of garbling.
pnpm --reporter=append-only build

PARENT="${TMPDIR:-/tmp}/mcmcjs-$(id -u)"
mkdir -p "$PARENT"
SANDBOX=$(mktemp -d "$PARENT/sandbox-dev-XXXXXX")
LINK="$INVOKED_DIR/mcmcjs-sandbox"

cleanup() {
  rm -rf "$SANDBOX"
  [ -L "$LINK" ] && rm -f "$LINK"
  echo "Removed sandbox $SANDBOX"
}
trap cleanup EXIT

echo "Packing publishable packages..."
pnpm -r pack --pack-destination "$SANDBOX" >/dev/null
rm -f "$SANDBOX"/mcmcjs-monorepo-*.tgz # drop the private workspace root

echo "Installing into an isolated prefix at $SANDBOX ..."
(
  cd "$SANDBOX"
  npm init -y >/dev/null 2>&1
  npm install ./*.tgz >/dev/null 2>&1
)
PATH="$SANDBOX/node_modules/.bin:$PATH"
export PATH
# You are testing this local build on purpose; don't nag to `npm install -g`
# the published release (which would replace the very thing under test).
MCMC_NO_UPDATE_CHECK=1
export MCMC_NO_UPDATE_CHECK

cp "$ROOT"/packages/cli/templates/* "$SANDBOX/"
ln -sfn "$SANDBOX" "$LINK"

if [ -n "$STRICT" ]; then
  # Redirect every mcmcjs/Julia state path into the sandbox: a fresh, no-Julia
  # environment that vanishes with the sandbox. HOME so juliaup installs into
  # the sandbox's ~/.juliaup; PATH so its shim is found once installed.
  mkdir -p "$SANDBOX/env/data" "$SANDBOX/env/cache" "$SANDBOX/env/julia-depot" \
    "$SANDBOX/env/juliaup" "$SANDBOX/env/home"
  mkdir -p -m 700 "$SANDBOX/env/run"
  HOME="$SANDBOX/env/home"; XDG_DATA_HOME="$SANDBOX/env/data"; XDG_CACHE_HOME="$SANDBOX/env/cache"
  XDG_RUNTIME_DIR="$SANDBOX/env/run"; JULIA_DEPOT_PATH="$SANDBOX/env/julia-depot"
  JULIAUP_DEPOT_PATH="$SANDBOX/env/juliaup"
  PATH="$HOME/.juliaup/bin:$PATH"
  export HOME XDG_DATA_HOME XDG_CACHE_HOME XDG_RUNTIME_DIR JULIA_DEPOT_PATH JULIAUP_DEPOT_PATH PATH
fi

echo
echo "  mcmcjs sandbox ready — an isolated install of your local build."
echo "  Seeded with model.jl, data.csv, run_without_mcmcjs.jl."
echo "  Symlinked at $LINK"
[ -n "$STRICT" ] && echo "  strict: no Julia here yet, run 'mcmc setup' first (installs into the sandbox)."
echo "  Try:  mcmc run model.jl --data data.csv"
echo "  Type 'exit' (or Ctrl+D) to leave; the sandbox and symlink are removed."
echo

(cd "$SANDBOX" && exec "${SHELL:-sh}") || true
