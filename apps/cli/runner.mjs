import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { arch, homedir, platform } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { api, run, SetupError } from './system.mjs';

const runnerEnv = Object.fromEntries(
  ['HOME', 'USER', 'LOGNAME', 'PATH', 'LANG', 'LC_ALL', 'TMPDIR', 'SHELL'].flatMap(key =>
    process.env[key] === undefined ? [] : [[key, process.env[key]]]),
);

async function install(dir, endpoint) {
  const os = { darwin: 'osx', linux: 'linux' }[platform()];
  const architecture = { x64: 'x64', arm64: 'arm64' }[arch()];
  if (!os || !architecture || process.getuid() === 0) {
    throw new SetupError('UNSUPPORTED_MACHINE', 'Run as a regular user on macOS or Linux (x64 or arm64).');
  }
  const download = api(`${endpoint}/downloads`).find(item =>
    item.os === os && item.architecture === architecture);
  if (!download || !/^https:\/\/github\.com\/actions\/runner\/releases\/download\/v[\d.]+\/actions-runner-[\w.-]+\.tar\.gz$/.test(download.download_url) ||
      !/^[a-f\d]{64}$/i.test(download.sha256_checksum)) {
    throw new SetupError('RUNNER_DOWNLOAD', 'GitHub did not provide a supported runner archive with a SHA-256 checksum.');
  }
  const temp = mkdtempSync(join(dir, 'install-'));
  try {
    const archive = join(temp, 'runner.tar.gz');
    const result = run('curl', ['-q', '--fail', '--silent', '--show-error', '--location',
      '--proto', '=https', '--proto-redir', '=https', '--output', archive, download.download_url],
    { env: runnerEnv, timeout: 600_000 });
    if (result.status !== 0) throw new SetupError('RUNNER_DOWNLOAD', 'Runner download failed. Check curl and network access.');
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(archive)) hash.update(chunk);
    if (hash.digest('hex') !== download.sha256_checksum.toLowerCase()) {
      throw new SetupError('RUNNER_CHECKSUM', 'The runner archive failed SHA-256 verification.');
    }
    const unpacked = join(temp, 'runner');
    mkdirSync(unpacked, { mode: 0o700 });
    if (run('tar', ['-xzf', archive, '-C', unpacked], { env: runnerEnv }).status !== 0) {
      throw new SetupError('RUNNER_EXTRACT', 'Could not unpack the runner archive. Check tar and available disk space.');
    }
    renameSync(unpacked, join(dir, 'runner'));
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function runnerDirectory(target) {
  if (!Number.isSafeInteger(target.id)) throw new SetupError('GITHUB_REQUEST_FAILED', 'GitHub returned an invalid repository ID.');
  return resolve(process.env.RUNNERDUTY_HOME || join(homedir(), '.runnerduty'), String(target.id));
}

export function runnerLabel(target) {
  const identity = join(runnerDirectory(target), 'identity');
  if (!existsSync(identity)) return null;
  const label = readFileSync(identity, 'utf8');
  if (!/^runnerduty-[a-f\d-]{36}$/.test(label)) throw new SetupError('RUNNER_STATE', 'Runner identity is invalid.');
  return label;
}

export function registeredRunner(target, label) {
  if (!label) return null;
  return api(`repos/${target.repo}/actions/runners?per_page=100`, ['--paginate', '--slurp'])
    .flatMap(page => page.runners).find(runner => runner.name === label) ?? null;
}

export async function withRunnerLock(target, work) {
  const dir = runnerDirectory(target);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lock = join(dir, 'setup.lock');
  try {
    symlinkSync(String(process.pid), lock);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    throw new SetupError('SETUP_LOCKED', `Setup is locked at ${lock}. If its recorded PID has exited, remove the lock and retry.`);
  }
  try {
    return await work(dir);
  } finally {
    rmSync(lock);
  }
}

export async function withRunner(target, finish) {
  return withRunnerLock(target, async dir => {
    const cwd = join(dir, 'runner');
    const endpoint = `repos/${target.repo}/actions/runners`;
    const identity = join(dir, 'identity');
    if (!existsSync(identity)) {
      writeFileSync(`${identity}.tmp`, `runnerduty-${randomUUID()}`, { mode: 0o600 });
      renameSync(`${identity}.tmp`, identity);
    }
    const label = runnerLabel(target);
    const lookup = () => registeredRunner(target, label);
    const existing = lookup();
    if (!existsSync(cwd)) await install(dir, endpoint);
    const config = join(cwd, '.runner');
    if (!existsSync(config)) {
      if (existing?.status === 'online' || existing?.busy) {
        throw new SetupError('RUNNER_STATE', 'The runner identity is already active. Recover its local configuration before retrying.');
      }
      const { token } = api(`${endpoint}/registration-token`, ['-X', 'POST']);
      if (!token) throw new SetupError('RUNNER_CONFIG', 'GitHub did not provide a registration token.');
      const args = ['--unattended', '--url', `https://github.com/${target.repo}`,
        '--name', label, '--labels', label, '--no-default-labels'];
      if (existing) args.push('--replace');
      const result = run('./config.sh', args, {
        cwd, env: { ...runnerEnv, ACTIONS_RUNNER_INPUT_TOKEN: token }, stdio: 'ignore',
      });
      if (result.status !== 0) {
        throw new SetupError('RUNNER_CONFIG', 'Runner registration failed. Check organization policy and the official runner runtime prerequisites, then retry.');
      }
    } else if (!existing) {
      throw new SetupError('RUNNER_STATE', 'Local configuration exists but GitHub cannot find the runner. Restore or remove the stale local installation before retrying.');
    }

    let runner = lookup();
    if (runner?.status !== 'online') {
      const pidFile = join(dir, 'listener.pid');
      let running = false;
      if (existsSync(pidFile)) {
        const pid = readFileSync(pidFile, 'utf8').trim();
        if (/^[1-9]\d*$/.test(pid)) {
          const result = run('ps', ['-p', pid, '-o', 'command=']);
          running = result.status === 0 && result.stdout.includes(join(cwd, 'run.sh'));
        }
      }
      if (!running) {
        const child = spawn(join(cwd, 'run.sh'), [], { cwd, env: runnerEnv, detached: true, stdio: 'ignore' });
        await new Promise((resolve, reject) => {
          child.once('spawn', resolve);
          child.once('error', () => reject(new SetupError('RUNNER_START', 'Could not start the official runner.')));
        });
        child.unref();
        writeFileSync(pidFile, String(child.pid), { mode: 0o600 });
      }
      for (let attempt = 0; attempt < 20 && runner?.status !== 'online'; attempt++) {
        await sleep(1500);
        runner = lookup();
      }
    }
    if (runner?.status !== 'online' || !runner.labels?.some(item => item.name === label)) {
      throw new SetupError('RUNNER_OFFLINE', `GitHub has not confirmed the runner online with label ${label}. Check runner diagnostics under ${cwd}/_diag and retry.`);
    }
    return finish({ id: runner.id, label, status: runner.status });
  });
}
