# The runner image for container runners (src/durable-objects/container-runner.ts). It's GitHub's
# official runner image, which runs as the `runner` user in /home/runner. The container starts with
# a one-job JIT config in RUNNER_JIT_CONFIG, takes one job and exits, which stops the container.
# `latest` follows the runner's releases: GitHub stops sending jobs to old runner versions.
FROM ghcr.io/actions/actions-runner:latest
CMD ["/bin/sh", "-c", "exec ./run.sh --jitconfig \"$RUNNER_JIT_CONFIG\""]
