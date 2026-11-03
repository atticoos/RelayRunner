import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { arch, tmpdir, platform } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('./cli.mjs', import.meta.url));
const workflow = '.github/workflows/ci.yml';
const original = `name: Checks
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest # keep this comment
    steps: [{run: echo hello}]
  lint:
    runs-on: ubuntu-24.04
  matrix:
    runs-on: \${{ matrix.os }}
`;

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'runnerduty-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, 'bin');
  const cwd = join(dir, 'repo');
  const state = join(dir, 'state');
  mkdirSync(bin);
  mkdirSync(join(cwd, '.github/workflows'), { recursive: true });
  writeFileSync(join(cwd, workflow), original);
  const git = (...args) => execFileSync('git', args, { cwd, stdio: 'ignore' });
  git('init', '-b', 'main');
  git('remote', 'add', 'origin', 'git@github.com:owner/project.git');
  git('add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture');
  const executable = (name, content) => writeFileSync(join(bin, name), content, { mode: 0o700 });
  const checksum = createHash('sha256').update('fixture archive').digest('hex');
  executable('gh', `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const endpoint = process.argv[5];
const dir = process.env.RUNNERDUTY_HOME + '/42';
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
  result = [{ os: '${platform() === 'darwin' ? 'osx' : 'linux'}', architecture: '${arch()}',
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
  result = [{ variables: [] }];
} else {
  result = { id: 42, full_name: 'owner/project', visibility: 'private', fork: false };
}
console.log(JSON.stringify(result));
`);
  executable('curl', `#!/bin/sh
while [ "$1" != "--output" ]; do shift; done
printf 'fixture archive' > "$2"
`);
  executable('tar', `#!/bin/sh
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
`);
  const invoke = (args, env = {}) => {
    const processResult = spawnSync(process.execPath, [cli, ...args, '--json'], {
      cwd, encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, RUNNERDUTY_HOME: state,
        GH_TOKEN: 'fake-gh-token', ...env },
    });
    assert.equal(processResult.stderr, '');
    assert.doesNotMatch(processResult.stdout, /fixture-private-token|fake-gh-token/);
    return { status: processResult.status, result: JSON.parse(processResult.stdout) };
  };
  return { cwd, state, invoke };
}

const selection = ['--job', `${workflow}:test`];

test('discovers and previews selected push jobs without modifying the checkout', t => {
  const { cwd, state, invoke } = fixture(t);
  const { result } = invoke(['discover']);
  assert.deepEqual(result.jobs.map(job => job.id), [`${workflow}:test`, `${workflow}:lint`]);
  const preview = invoke(['preview', ...selection]);
  assert.equal(preview.status, 0);
  assert.match(preview.result.patch, /\+    runs-on: ".*github.event_name == 'push'.*'ubuntu-latest'.*" # keep this comment/);
  assert.doesNotMatch(preview.result.patch, /^[-+].*ubuntu-24\.04/m);
  assert.equal(readFileSync(join(cwd, workflow), 'utf8'), original);
  assert.equal(existsSync(state), false);
  assert.equal(invoke(['setup', ...selection, '--approve', 'wrong']).result.error.code, 'STALE_PREVIEW');
  assert.equal(invoke(['discover'], { DENY: '1' }).result.error.code, 'GITHUB_ACCESS');
  assert.equal(existsSync(state), false);
});

test('registers, starts, confirms online, applies the patch, and reuses registration on retry', {
  skip: process.getuid?.() === 0 || !['darwin', 'linux'].includes(platform()) || !['arm64', 'x64'].includes(arch()),
}, t => {
  const { cwd, state, invoke } = fixture(t);
  const preview = () => invoke(['preview', ...selection]).result;
  const setup = fingerprint => invoke(['setup', ...selection, '--approve', fingerprint]);
  const before = preview();
  const denied = invoke(['setup', ...selection, '--approve', before.fingerprint], { DENY_REGISTER: '1' });
  assert.equal(denied.result.error.code, 'GITHUB_ACCESS');
  assert.equal(readFileSync(join(cwd, workflow), 'utf8'), original);
  const identity = readFileSync(join(state, '42/identity'), 'utf8');
  const first = setup(before.fingerprint);
  assert.equal(first.status, 0, JSON.stringify(first.result));
  assert.equal(first.result.workflowChanges, 'applied');
  assert.equal(first.result.runner.status, 'online');
  assert.match(identity, /^runnerduty-/);
  assert.equal(first.result.runner.label, identity);
  const source = readFileSync(join(cwd, workflow), 'utf8');
  assert.match(source, /RUNNERDUTY_REF/);
  assert.match(source, /runs-on: ubuntu-24\.04/);
  assert.equal(setup(before.fingerprint).result.error.code, 'STALE_PREVIEW');
  const after = preview();
  assert.equal(after.patch, '');
  const retry = setup(after.fingerprint);
  assert.equal(retry.result.workflowChanges, 'already-applied');
  assert.deepEqual(retry.result.runner, first.result.runner);
  assert.equal(readFileSync(join(state, '42/registrations'), 'utf8'), 'registered\n');
});
