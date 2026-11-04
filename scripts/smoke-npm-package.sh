#!/usr/bin/env bash
set -euo pipefail

tarball="${1:-}"
if [[ -n "$tarball" && "$tarball" != /* ]]; then
  tarball="$PWD/$tarball"
fi

cd "$(dirname "$0")/../apps/cli"
smoke_dir="$(mktemp -d)"
trap 'rm -rf "$smoke_dir"' EXIT

if [[ -z "$tarball" ]]; then
  pnpm pack --pack-destination "$smoke_dir"
  tarballs=("$smoke_dir"/relayrunner-*.tgz)
  tarball="${tarballs[0]}"
fi
prefix="$smoke_dir/relayrunner-install"
npm install --global --prefix "$prefix" "$tarball"
export PATH="$prefix/bin:$PATH"

relayrunner --help
