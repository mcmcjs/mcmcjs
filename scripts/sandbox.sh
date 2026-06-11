#!/usr/bin/env sh
# Build the workspace, pack the publishable packages, and install them into a
# throwaway prefix — then drop into a shell where `mcmc` behaves exactly as it
# would for a real user (`npm install`). The prefix lives under the shared
# ${TMPDIR:-/tmp}/mcmcjs parent, is seeded with the example model, and a
# `mcmcjs-sandbox` symlink appears in the directory you ran this from. Leaving
# the shell (exit or Ctrl+D) removes the sandbox and the symlink; so does the
# script dying, via the EXIT trap.
#
#   pnpm sandbox
set -e

INVOKED_DIR=$(pwd)
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"

echo "Building workspace packages..."
pnpm build

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

cp "$ROOT"/packages/cli/templates/* "$SANDBOX/"
ln -sfn "$SANDBOX" "$LINK"

echo
echo "  mcmcjs sandbox ready — an isolated install of your local build."
echo "  Seeded with model.jl, data.csv, run_without_mcmcjs.jl."
echo "  Symlinked at $LINK"
echo "  Try:  mcmc run model.jl --data data.csv"
echo "  Type 'exit' (or Ctrl+D) to leave; the sandbox and symlink are removed."
echo

(cd "$SANDBOX" && exec "${SHELL:-sh}") || true
