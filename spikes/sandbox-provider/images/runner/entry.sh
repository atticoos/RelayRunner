#!/bin/bash
# Runs one job with the JIT config the Worker passed in, then exits, which ends the container.
set -euo pipefail
echo "[rr-sandbox] container up at $(date -u +%FT%T.%3NZ) $(nproc) cpu, $(free -m | awk '/Mem/ {print $2}') MiB, $(df -h / | awk 'NR==2 {print $2}') disk"
config="$JIT_CONFIG"
unset JIT_CONFIG
cd /home/runner
status=0
runuser -u runner -- ./run.sh --jitconfig "$config" || status=$?
echo "[rr-sandbox] runner exited $status at $(date -u +%FT%T.%3NZ)"
exit "$status"
