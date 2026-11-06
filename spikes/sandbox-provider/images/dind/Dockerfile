# The runner image (../runner) plus Docker. Cloudflare Containers aren't privileged and have no
# iptables, so entry.sh starts dockerd with iptables off and tries rootless mode if that fails.
# Inner containers need --network=host. Expected to break `services:` and `container:` jobs.
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

RUN install -m 0755 -d /etc/apt/keyrings \
 && curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc \
 && echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu noble stable" > /etc/apt/sources.list.d/docker.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends containerd.io docker-ce-cli uidmap iproute2 \
 && rm -rf /var/lib/apt/lists/*
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      docker-ce docker-buildx-plugin docker-ce-rootless-extras \
 && rm -rf /var/lib/apt/lists/* \
 && usermod -aG docker runner

COPY entry.sh /usr/local/bin/entry.sh
CMD ["/usr/local/bin/entry.sh"]
