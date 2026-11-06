#!/bin/bash
# Starts a Docker daemon, then runs one job with the JIT config the Worker passed in.
set -uo pipefail
echo "[rr-sandbox] container up at $(date -u +%FT%T.%3NZ) $(nproc) cpu, $(free -m | awk '/Mem/ {print $2}') MiB, $(df -h / | awk 'NR==2 {print $2}') disk"

wait_for_docker() {
  for _ in $(seq 1 30); do
    if DOCKER_HOST="$1" docker version >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}

# Rootful first, with no iptables (the container has none).
dockerd --iptables=false --ip6tables=false >/var/log/dockerd.log 2>&1 &
if wait_for_docker unix:///var/run/docker.sock; then
  echo "[rr-sandbox] dockerd (rootful, no iptables) is up"
  docker_host=unix:///var/run/docker.sock
else
  echo "[rr-sandbox] rootful dockerd failed:"; tail -n 20 /var/log/dockerd.log
  pkill dockerd || true
  # Rootless, as runner. Needs subuid/subgid ranges.
  grep -q '^runner:' /etc/subuid || echo "runner:100000:65536" >> /etc/subuid
  grep -q '^runner:' /etc/subgid || echo "runner:100000:65536" >> /etc/subgid
  runner_uid=$(id -u runner)
  mkdir -p "/run/user/$runner_uid" && chown runner:runner "/run/user/$runner_uid"
  runuser -u runner -- env XDG_RUNTIME_DIR="/run/user/$runner_uid" \
    dockerd-rootless.sh --iptables=false --ip6tables=false >/var/log/dockerd-rootless.log 2>&1 &
  docker_host="unix:///run/user/$runner_uid/docker.sock"
  if wait_for_docker "$docker_host"; then
    echo "[rr-sandbox] dockerd (rootless) is up"
  else
    echo "[rr-sandbox] rootless dockerd failed too, running the job without Docker:"
    tail -n 20 /var/log/dockerd-rootless.log
  fi
fi

config="$JIT_CONFIG"
unset JIT_CONFIG
cd /home/runner
status=0
runuser -u runner -- env DOCKER_HOST="$docker_host" ./run.sh --jitconfig "$config" || status=$?
echo "[rr-sandbox] runner exited $status at $(date -u +%FT%T.%3NZ)"
exit "$status"
