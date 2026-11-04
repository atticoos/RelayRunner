import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { arch, tmpdir, platform } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "vitest";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("./cli.ts", import.meta.url));
const workflow = ".github/workflows/ci.yml";
const original = `name: Checks
on: [workflow_dispatch, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest # keep this comment
    steps: [{run: echo hello}]
  lint:
    runs-on: ubuntu-24.04
  matrix:
    runs-on: \${{ matrix.os }}
`;

function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "relayrunner-test-"));
  t.onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, "bin");
  const cwd = join(dir, "repo");
  const state = join(dir, "state");
  mkdirSync(bin);
  mkdirSync(join(cwd, ".github/workflows"), { recursive: true });
  writeFileSync(join(cwd, workflow), original);
  const git = (...args: string[]) => execFileSync("git", args, { cwd, stdio: "ignore" });
  git("init", "-b", "main");
  git("remote", "add", "origin", "git@github.com:owner/project.git");
  git("add", ".");
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.com",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-m",
    "fixture",
  );
  const executable = (name: string, content: string) =>
    writeFileSync(join(bin, name), content, { mode: 0o700 });
  const checksum = createHash("sha256").update("fixture archive").digest("hex");
  executable(
    "gh",
    `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const endpoint = process.argv[5];
const dir = process.env.RELAYRUNNER_HOME + '/42';
const runner = dir + '/runner';
let result;
if (process.env.DENY || (process.env.DENY_REGISTER && endpoint.endsWith('/registration-token'))) {
  console.error('gh: Forbidden (HTTP 403)');
  process.exit(1);
}
if (endpoint.endsWith('/registration-token')) {
  fs.appendFileSync(dir + '/registrations', 'registered\\n');
  result = { token: 'fixture-private-token' };
} else if (endpoint.endsWith('/downloads')) {
  result = [{ os: '${platform() === "darwin" ? "osx" : "linux"}', architecture: '${arch()}',
    download_url: 'https://github.com/actions/runner/releases/download/v2.1.0/actions-runner-test.tar.gz',
    sha256_checksum: '${checksum}' }];
} else if (endpoint.includes('/runners?')) {
  const runners = [];
  if (fs.existsSync(runner + '/.runner')) {
    const name = fs.readFileSync(runner + '/.runner', 'utf8').trim();
    runners.push({ id: 19, name, labels: [{name}], status: fs.existsSync(runner + '/online') ? 'online' : 'offline' });
  }
  result = [{ runners }];
} else if (endpoint.includes('/variables?')) {
  const file = dir + '/variables.json';
  const values = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : {};
  result = [{ variables: Object.entries(values).map(([name, value]) => ({ name, value })) }];
} else if (endpoint.includes('/actions/variables')) {
  const file = dir + '/variables.json';
  const values = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : {};
  const args = process.argv.slice(6);
  const name = args[1] === 'POST' ? args[3].slice(5) : endpoint.split('/').at(-1);
  if (args[1] === 'DELETE') delete values[name];
  else values[name] = args.at(-1).slice(6);
  fs.writeFileSync(file, JSON.stringify(values));
  process.exit(0);
} else if (endpoint.includes('/runs/123/jobs?')) {
  const label = fs.readFileSync(dir + '/identity', 'utf8');
  result = [{ jobs: [
    { id: 1, name: 'test', status: 'queued', labels: [label], html_url: 'https://github.com/owner/project/actions/runs/123/job/1' },
    { id: 2, name: 'other', status: 'queued', labels: ['ubuntu-latest'] },
    { id: 3, name: 'running', status: 'in_progress', labels: [label] },
  ] }];
} else if (endpoint.includes('/runs?')) {
  result = [{ workflow_runs: endpoint.includes('status=in_progress') ? [{ id: 123 }] : [] }];
} else {
  result = { id: 42, full_name: 'owner/project', visibility: 'private', fork: false };
}
console.log(JSON.stringify(result));
`,
  );
  executable(
    "curl",
    `#!/bin/sh
while [ "$1" != "--output" ]; do shift; done
printf 'fixture archive' > "$2"
`,
  );
  executable(
    "tar",
    `#!/bin/sh
cat > "$4/config.sh" <<'CONFIG'
#!/bin/sh
[ "$ACTIONS_RUNNER_INPUT_TOKEN" = fixture-private-token ] || exit 3
[ -z "$GH_TOKEN" ] || exit 4
while [ "$1" != "--name" ]; do shift; done
printf '%s' "$2" > .runner
echo "$ACTIONS_RUNNER_INPUT_TOKEN"
CONFIG
cat > "$4/run.sh" <<'RUN'
#!/bin/sh
[ -z "$ACTIONS_RUNNER_INPUT_TOKEN$GH_TOKEN" ] || exit 5
touch online
RUN
chmod +x "$4/config.sh" "$4/run.sh"
`,
  );
  const invoke = (args: string[], env: NodeJS.ProcessEnv = {}, json = true) => {
    const processResult = spawnSync(process.execPath, [cli, ...args, ...(json ? ["--json"] : [])], {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        RELAYRUNNER_HOME: state,
        GH_TOKEN: "fake-gh-token",
        ...env,
      },
    });
    assert.equal(processResult.stderr, "");
    assert.doesNotMatch(processResult.stdout, /fixture-private-token|fake-gh-token/);
    return {
      status: processResult.status,
      result: json ? JSON.parse(processResult.stdout) : processResult.stdout,
    };
  };
  return { cwd, state, invoke };
}

const selection = ["--job", `${workflow}:test`];

test("discovers and previews selected jobs in a workflow without a push trigger without modifying the checkout", (t) => {
  const { cwd, state, invoke } = fixture(t);
  const { result } = invoke(["discover"]);
  assert.deepEqual(
    result.jobs.map((job: { id: string | number }) => job.id),
    [`${workflow}:test`, `${workflow}:lint`],
  );
  const preview = invoke(["preview", ...selection]);
  assert.equal(preview.status, 0);
  assert.match(
    preview.result.patch,
    /\+    runs-on: "\$\{\{ vars\.RELAYRUNNER_LABEL \|\| 'ubuntu-latest' \}\}" # keep this comment/,
  );
  assert.doesNotMatch(preview.result.patch, /^[-+].*ubuntu-24\.04/m);
  const text = invoke(["discover"], {}, false);
  assert.equal(text.status, 0);
  assert.match(text.result, /ci\.yml:test \(☁️  GitHub-hosted ubuntu-latest\)/);
  assert.equal(readFileSync(join(cwd, workflow), "utf8"), original);
  assert.equal(existsSync(state), false);
  assert.equal(
    invoke(["setup", ...selection, "--approve", "wrong"]).result.error.code,
    "STALE_PREVIEW",
  );
  assert.equal(invoke(["discover"], { DENY: "1" }).result.error.code, "GITHUB_ACCESS");
  assert.equal(existsSync(state), false);
});

test(
  "registers, starts, confirms online, applies the patch, and reuses registration on retry",
  {
    skip:
      process.getuid?.() === 0 ||
      !["darwin", "linux"].includes(platform()) ||
      !["arm64", "x64"].includes(arch()),
  },
  (t) => {
    const { cwd, state, invoke } = fixture(t);
    const preview = () => invoke(["preview", ...selection]).result;
    const setup = (fingerprint: string) =>
      invoke(["setup", ...selection, "--approve", fingerprint]);
    const before = preview();
    const denied = invoke(["setup", ...selection, "--approve", before.fingerprint], {
      DENY_REGISTER: "1",
    });
    assert.equal(denied.result.error.code, "GITHUB_ACCESS");
    assert.equal(readFileSync(join(cwd, workflow), "utf8"), original);
    const identity = readFileSync(join(state, "42/identity"), "utf8");
    const first = setup(before.fingerprint);
    assert.equal(first.status, 0, JSON.stringify(first.result));
    assert.equal(first.result.workflowChanges, "applied");
    assert.equal(first.result.runner.status, "online");
    assert.match(identity, /^relayrunner-/);
    assert.equal(first.result.runner.label, identity);
    const source = readFileSync(join(cwd, workflow), "utf8");
    assert.doesNotMatch(source, /RELAYRUNNER_REF/);
    const discovery = invoke(["discover"], {}, false);
    assert.equal(discovery.status, 0);
    assert.match(
      discovery.result,
      /ci\.yml:test \(💻  local runner .* otherwise ☁️  GitHub-hosted ubuntu-latest\)/,
    );
    assert.match(source, /runs-on: ubuntu-24\.04/);
    assert.equal(setup(before.fingerprint).result.error.code, "STALE_PREVIEW");
    const after = preview();
    assert.equal(after.patch, "");
    const retry = setup(after.fingerprint);
    assert.equal(retry.result.workflowChanges, "already-applied");
    assert.deepEqual(retry.result.runner, first.result.runner);
    assert.equal(readFileSync(join(state, "42/registrations"), "utf8"), "registered\n");
  },
);

test("switches a configured repository to local and restores hosted while the runner is offline", (t) => {
  const { cwd, state, invoke } = fixture(t);
  const label = "relayrunner-12345678-1234-1234-1234-123456789abc";
  const runner = join(state, "42/runner");
  mkdirSync(runner, { recursive: true });
  writeFileSync(join(state, "42/identity"), label);
  writeFileSync(join(runner, ".runner"), label);
  assert.equal(invoke(["status"]).result.route, "hosted");
  assert.equal(invoke(["switch", "local"]).result.error.code, "RUNNER_OFFLINE");

  const { patch } = invoke(["preview", ...selection]).result;
  execFileSync("git", ["apply", "-"], { cwd, input: patch });
  writeFileSync(join(runner, "online"), "");
  const variables = join(state, "42/variables.json");
  writeFileSync(variables, JSON.stringify({ RELAYRUNNER_REF: "refs/heads/main" }));
  assert.equal(invoke(["switch", "local"]).result.route, "local");
  assert.deepEqual(JSON.parse(readFileSync(variables, "utf8")), { RELAYRUNNER_LABEL: label });

  execFileSync("git", ["switch", "-q", "--detach"], { cwd });
  assert.equal(invoke(["switch", "local"]).result.route, "local");
  const status = invoke(["status"]).result;
  assert.equal(status.route, "local");
  assert.deepEqual(status.runner, { label, status: "online" });

  rmSync(join(runner, "online"));
  const hosted = invoke(["switch", "hosted"]).result;
  assert.equal(hosted.route, "hosted");
  assert.deepEqual(
    hosted.queuedJobs.map((job: { id: string | number }) => job.id),
    [1],
  );
  assert.equal(invoke(["switch", "hosted"]).result.route, "hosted");
  assert.equal(invoke(["status"]).result.runner.status, "offline");
  writeFileSync(join(runner, "online"), "");
  assert.equal(invoke(["switch", "local"]).result.route, "local");
});
