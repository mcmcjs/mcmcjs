#!/usr/bin/env sh
# Build the workspace, pack the publishable packages, and install them into a
# throwaway prefix — then drop into a shell where `mcmc` behaves exactly as it
# would for a real user (`npm install`). This never touches your dev node_modules,
# and the sandbox is removed automatically when you exit.
#
#   pnpm sandbox
#
# Note: `fit`/`predict` will additionally require Julia (via `mcmc setup`) once
# those commands land; `diagnose`/`convert` work with Node alone.
set -e

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"

echo "Building workspace packages..."
pnpm build

SANDBOX=$(mktemp -d "${TMPDIR:-/tmp}/mcmcjs-sandbox.XXXXXX")
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

echo
echo "  mcmcjs sandbox ready — an isolated install of your local build."
echo "  The 'mcmc' command is on PATH. Try:  mcmc --help"
echo "  Type 'exit' to leave; the sandbox is removed automatically."
echo

(cd "$SANDBOX" && exec "${SHELL:-sh}") || true
rm -rf "$SANDBOX"
echo "Removed sandbox $SANDBOX"
