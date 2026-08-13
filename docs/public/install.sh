#!/bin/sh
# Install the mcmcjs CLI:
#   curl -fsSL https://mcmcjs.github.io/install.sh | sh
#
# Downloads a single-file `mcmc` binary from the project's GitHub Releases. The
# binary needs no Node.js and no npm; Julia or CmdStan are installed later by
# `mcmc setup`. Set MCMC_INSTALL_DIR to choose where it lands (default
# ~/.local/bin) and MCMC_VERSION to pin a release (default: the latest).
set -eu

REPO="mcmcjs/mcmcjs"
INSTALL_DIR="${MCMC_INSTALL_DIR:-$HOME/.local/bin}"
VERSION="${MCMC_VERSION:-latest}"

say() { printf '%s\n' "$1"; }
fail() { printf 'mcmcjs install: %s\n' "$1" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || fail "curl is required."

case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=darwin ;;
  *)
    fail "unsupported OS $(uname -s). On Windows, download mcmc-windows-x64.tar.gz from
                    https://github.com/$REPO/releases, or install with npm: npm install -g mcmcjs"
    ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=x64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) fail "unsupported architecture $(uname -m)." ;;
esac
asset="mcmc-$os-$arch.tar.gz"

command -v tar >/dev/null 2>&1 || fail "tar is required."

# An existing install is reported, never silently replaced or shadowed.
# `command -v` skips a broken symlink, which is exactly the leftover worth
# naming, so walk PATH as well.
existing=$(command -v mcmc 2>/dev/null || true)
if [ -z "$existing" ]; then
  old_ifs=$IFS
  IFS=:
  for dir in $PATH; do
    [ -n "$dir" ] || continue
    if [ "$dir/mcmc" != "$INSTALL_DIR/mcmc" ] && { [ -e "$dir/mcmc" ] || [ -L "$dir/mcmc" ]; }; then
      existing="$dir/mcmc"
      break
    fi
  done
  IFS=$old_ifs
fi
if [ -n "$existing" ] && [ "$existing" != "$INSTALL_DIR/mcmc" ]; then
  say "Note: mcmc is already installed at $existing"
  # npm links its global bin at a symlink into node_modules, so resolve first.
  target=$existing
  if command -v readlink >/dev/null 2>&1; then
    target=$(readlink -f "$existing" 2>/dev/null || echo "$existing")
  fi
  case "$target" in
    *node_modules*)
      say "      That copy came from npm. Remove it with: npm rm -g mcmcjs"
      ;;
  esac
  say "      This installer writes to $INSTALL_DIR/mcmc; whichever comes first on PATH wins."
  say ""
fi

# The repo's "latest release" may be one of the libraries, which ship no binary,
# so ask for the newest mcmcjs@ tag specifically. The version published beside
# this script is the fallback for a rate-limited API.
if [ "$VERSION" = latest ]; then
  VERSION=$(curl -fsSL "https://api.github.com/repos/$REPO/releases?per_page=50" 2>/dev/null |
    grep -o '"tag_name": *"mcmcjs@[^"]*"' | head -1 | sed 's/.*mcmcjs@//; s/"$//')
fi
if [ -z "${VERSION:-}" ] || [ "$VERSION" = latest ]; then
  VERSION=$(curl -fsSL "https://mcmcjs.github.io/latest.txt" 2>/dev/null | tr -d '\r\n ')
fi
[ -n "$VERSION" ] || fail "could not look up the latest version; set MCMC_VERSION=x.y.z"
base="https://github.com/$REPO/releases/download/mcmcjs@$VERSION"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

say "Downloading $asset..."
curl -fsSL "$base/$asset" -o "$tmp/$asset" ||
  fail "could not download $base/$asset (no build for this platform, or the release is missing)"

# Checksums ship with the release; verify when a tool for it exists.
if curl -fsSL "$base/checksums.txt" -o "$tmp/checksums.txt" 2>/dev/null; then
  if command -v sha256sum >/dev/null 2>&1; then
    want=$(grep " $asset\$" "$tmp/checksums.txt" | awk '{print $1}')
    got=$(sha256sum "$tmp/$asset" | awk '{print $1}')
  elif command -v shasum >/dev/null 2>&1; then
    want=$(grep " $asset\$" "$tmp/checksums.txt" | awk '{print $1}')
    got=$(shasum -a 256 "$tmp/$asset" | awk '{print $1}')
  else
    want=""; got=""
  fi
  if [ -n "$want" ] && [ "$want" != "$got" ]; then
    fail "checksum mismatch for $asset (expected $want, got $got)"
  fi
fi

tar -xzf "$tmp/$asset" -C "$tmp" || fail "could not unpack $asset"
[ -f "$tmp/mcmc" ] || fail "$asset did not contain an mcmc binary"

mkdir -p "$INSTALL_DIR"
chmod +x "$tmp/mcmc"
# Replacing a running binary fails on some systems; move the old one aside.
rm -f "$INSTALL_DIR/mcmc.old"
[ -f "$INSTALL_DIR/mcmc" ] && mv "$INSTALL_DIR/mcmc" "$INSTALL_DIR/mcmc.old" 2>/dev/null || true
mv "$tmp/mcmc" "$INSTALL_DIR/mcmc" ||
  fail "could not write $INSTALL_DIR/mcmc. Set MCMC_INSTALL_DIR to a writable directory."
rm -f "$INSTALL_DIR/mcmc.old"

say ""
# Unpiped on purpose: the binary prints its wordmark when stdout is a terminal,
# and a pipe would hide it.
"$INSTALL_DIR/mcmc" --version 2>/dev/null || say "Installed mcmc"
say ""
say "Installed to $INSTALL_DIR/mcmc"
# A shell that ran an older mcmc has cached its path and will keep using it,
# even when that file is gone ("No such file or directory" for a path you did
# not type). Cheap to mention, baffling to debug.
say "If your shell still runs an older mcmc, run: hash -r"

# Say plainly what will actually run, rather than assuming this one won.
resolved=$(command -v mcmc 2>/dev/null || true)
case ":$PATH:" in
  *":$INSTALL_DIR:"*)
    if [ -n "$resolved" ] && [ "$resolved" != "$INSTALL_DIR/mcmc" ]; then
      say "Warning: \`mcmc\` still resolves to $resolved, which comes earlier on PATH."
      say "         Remove that copy, or put $INSTALL_DIR ahead of it."
    fi
    ;;
  *)
    say ""
    say "Add it to your PATH:"
    say "  export PATH=\"$INSTALL_DIR:\$PATH\""
    ;;
esac

say ""
say "Next steps:"
say "  mcmc setup             # install Julia (or --engine stan for CmdStan)"
say "  mcmc init demo         # seed an example model"
say "  mcmc run demo/model.jl # fit, diagnose, record"
