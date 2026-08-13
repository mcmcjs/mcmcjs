#!/bin/sh
# Remove the mcmcjs CLI installed by install.sh:
#   curl -fsSL https://mcmcjs.github.io/uninstall.sh | sh
#
# Removes the binary and, with --all, the cached Julia driver and the report
# server's state. Your runs are not touched: they live in each project's .mcmc
# directory. A copy installed with npm is reported, not removed, because that
# is npm's to undo (npm rm -g mcmcjs).
set -eu

INSTALL_DIR="${MCMC_INSTALL_DIR:-$HOME/.local/bin}"
ALL=""
for arg in "$@"; do
  case "$arg" in
    --all) ALL=1 ;;
    -h | --help)
      printf 'usage: uninstall.sh [--all]\n  --all  also remove cached state (driver cache, report server state)\n'
      exit 0
      ;;
    *) printf 'mcmcjs uninstall: unknown option %s\n' "$arg" >&2; exit 2 ;;
  esac
done

say() { printf '%s\n' "$1"; }
removed=""

# Stop the report server first: it is the only thing that keeps running.
if [ -x "$INSTALL_DIR/mcmc" ]; then
  "$INSTALL_DIR/mcmc" report stop >/dev/null 2>&1 || true
fi

if [ -f "$INSTALL_DIR/mcmc" ]; then
  rm -f "$INSTALL_DIR/mcmc"
  say "Removed $INSTALL_DIR/mcmc"
  removed=1
else
  say "No binary at $INSTALL_DIR/mcmc (set MCMC_INSTALL_DIR if you installed elsewhere)"
fi

if [ -n "$ALL" ]; then
  data="${XDG_DATA_HOME:-$HOME/.local/share}/mcmcjs/report"
  cache="${XDG_CACHE_HOME:-$HOME/.cache}/mcmcjs"
  for dir in "$data" "$cache"; do
    if [ -d "$dir" ]; then
      rm -rf "$dir"
      say "Removed $dir"
      removed=1
    fi
  done
  say "Left alone: Julia itself (juliaup), CmdStan, and every project's .mcmc runs."
else
  say "Cached state kept; pass --all to remove the driver cache and report server state."
fi

# Any other copy on PATH is worth naming, so `mcmc` disappearing is no surprise.
old_ifs=$IFS
IFS=:
for dir in $PATH; do
  [ -n "$dir" ] || continue
  [ "$dir/mcmc" = "$INSTALL_DIR/mcmc" ] && continue
  if [ -e "$dir/mcmc" ] || [ -L "$dir/mcmc" ]; then
    target=$dir/mcmc
    if command -v readlink >/dev/null 2>&1; then
      target=$(readlink -f "$dir/mcmc" 2>/dev/null || echo "$dir/mcmc")
    fi
    case "$target" in
      *node_modules*) say "Another mcmc is at $dir/mcmc (npm). Remove it with: npm rm -g mcmcjs" ;;
      *) say "Another mcmc is at $dir/mcmc" ;;
    esac
  fi
done
IFS=$old_ifs

[ -n "$removed" ] && say "Run \`hash -r\` so your shell forgets the old path."
exit 0
