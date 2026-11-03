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
  tarballs=("$smoke_dir"/runnerduty-*.tgz)
  tarball="${tarballs[0]}"
fi
prefix="$smoke_dir/runnerduty-install"
npm install --global --prefix "$prefix" "$tarball"
cmp ../../skills/runnerduty/SKILL.md "$(npm root --global --prefix "$prefix")/runnerduty/dist/SKILL.md"
# Serve fixture repository metadata without GitHub credentials.
stub_bin="$smoke_dir/bin"
mkdir -p "$stub_bin"
cat > "$stub_bin/gh" <<'EOF'
#!/bin/sh
test "$*" = 'api --hostname github.com repos/example/runnerduty-smoke' || exit 1
echo '{"visibility":"private","fork":false,"full_name":"example/runnerduty-smoke","id":1}'
EOF
chmod +x "$stub_bin/gh"
export PATH="$prefix/bin:$stub_bin:$PATH"

fixture="$smoke_dir/fixture"
mkdir -p "$fixture"
cd "$fixture"
git init --initial-branch=main
git remote add origin https://github.com/example/runnerduty-smoke.git
mkdir -p .github/workflows
cat > .github/workflows/ci.yml <<'EOF'
name: CI
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: echo smoke
EOF
git add .github/workflows/ci.yml
git -c user.name=CI -c user.email=ci@example.com commit -m "Add smoke workflow"

runnerduty --help
runnerduty discover | grep -F '.github/workflows/ci.yml:test'
runnerduty preview --job .github/workflows/ci.yml:test | grep -F 'Approval fingerprint'
runnerduty discover --cwd "$fixture" --json | node -e 'const result = JSON.parse(require("node:fs").readFileSync(0)); if (!result.ok || result.jobs[0]?.id !== ".github/workflows/ci.yml:test") process.exit(1)'
runnerduty preview --cwd "$fixture" --job .github/workflows/ci.yml:test --json | node -e 'const result = JSON.parse(require("node:fs").readFileSync(0)); if (!result.ok || !result.fingerprint || !result.patch) process.exit(1)'
test -z "$(git status --porcelain)"
