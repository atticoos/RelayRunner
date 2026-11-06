# The GitHub Actions runner on Ubuntu 24.04, baked in so a job doesn't download ~230 MB first.
# Like GitHub's hosted images it runs as `runner` with passwordless sudo.
FROM ubuntu:24.04

ARG RUNNER_VERSION=2.338.0
ENV DEBIAN_FRONTEND=noninteractive

# Layers are kept under ~250 MB: pushes of larger ones to Cloudflare's registry failed
# ("use of closed network connection") from a laptop.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl git jq procps sudo unzip zip xz-utils python3 \
 && rm -rf /var/lib/apt/lists/*
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential \
 && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --shell /bin/bash runner \
 && echo "runner ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/runner

# The runner tarball in three pieces (one download each), extracted as `runner` so no chown
# layer copies it again. The Alpine Node builds are left out: jobs run on Ubuntu.
WORKDIR /home/runner
USER runner
ENV RUNNER_URL=https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz
RUN curl -fsSL "$RUNNER_URL" | tar xz --exclude='./externals/*'
RUN curl -fsSL "$RUNNER_URL" | tar xz ./externals/node20
RUN curl -fsSL "$RUNNER_URL" | tar xz ./externals/node24
USER root
RUN ./bin/installdependencies.sh && rm -rf /var/lib/apt/lists/*

COPY entry.sh /usr/local/bin/entry.sh
CMD ["/usr/local/bin/entry.sh"]
