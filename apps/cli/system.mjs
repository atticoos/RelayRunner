import { spawnSync } from 'node:child_process';

export class SetupError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: 120_000,
    ...options,
  });
}

export function git(cwd, args, options) {
  const result = run('git', args, { cwd, ...options });
  if (result.status !== 0) {
    throw new SetupError('GIT_FAILED', `git ${args[0]} failed. Check the checkout and preview again.`);
  }
  return result.stdout;
}

export function api(endpoint, args = []) {
  const { GH_DEBUG, DEBUG, ...env } = process.env;
  const result = run('gh', ['api', '--hostname', 'github.com', endpoint, ...args], {
    env: { ...env, GH_PROMPT_DISABLED: '1' },
  });
  if (result.error?.code === 'ENOENT') {
    throw new SetupError('MISSING_GH', 'Install the GitHub CLI and make it available on PATH.');
  }
  if (result.status !== 0) {
    const status = result.stderr?.match(/HTTP (\d{3})/)?.[1];
    if (['401', '403', '404'].includes(status) ||
        /auth login|no oauth token|token invalid|requires authentication/i.test(result.stderr ?? '')) {
      throw new SetupError('GITHUB_ACCESS', 'Use an authorized GitHub CLI session with access to this private repository. Runner setup requires repository administration access and must be allowed by organization policy.');
    }
    throw new SetupError('GITHUB_REQUEST_FAILED', 'GitHub API request failed. Check network access and retry.');
  }
  return JSON.parse(result.stdout);
}
