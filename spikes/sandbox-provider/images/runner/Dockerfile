# The GitHub Actions runner on Ubuntu 24.04, baked in so a job doesn't download ~230 MB first.
# Like GitHub's hosted images it runs as `runner` with passwordless sudo.
FROM ubuntu:24.04

ARG RUNNER_VERSION=2.338.0
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl git jq procps sudo unzip zip xz-utils python3 build-essential \
 && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --shell /bin/bash runner \
 && echo "runner ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/runner

WORKDIR /home/runner
RUN curl -fsSL "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz" \
      | tar xz \
 && ./bin/installdependencies.sh \
 && rm -rf /var/lib/apt/lists/* \
 && chown -R runner:runner /home/runner

COPY entry.sh /usr/local/bin/entry.sh
CMD ["/usr/local/bin/entry.sh"]
