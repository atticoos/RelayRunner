#!/usr/bin/env node
import { parseArgs, styleText } from 'node:util';
import { api, git, SetupError } from './system.ts';
import type { ActionsVariable } from './system.ts';
import { repository, workflows, plan } from './workflows.ts';
import { withRunner } from './runner.ts';
import { routeJobs } from './routing.ts';

const usage = `runnerduty discover [--cwd PATH] [--json]
runnerduty preview --job PATH:JOB [--job PATH:JOB ...] [--cwd PATH] [--json]
runnerduty setup --job PATH:JOB [--job PATH:JOB ...] --approve FINGERPRINT [--cwd PATH] [--json]
runnerduty switch <local|hosted> [--cwd PATH] [--json]
runnerduty status [--cwd PATH] [--json]`;

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      cwd: { type: 'string', default: process.cwd() },
      job: { type: 'string', multiple: true },
      approve: { type: 'string' },
      json: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [command, mode] = positionals;
  if (values.help || !command) {
    console.log(usage);
    return;
  }
  const routing = command === 'switch' || command === 'status';
  if (routing) {
    const routeMode = command === 'status' && positionals.length === 1 ? 'status'
      : command === 'switch' && positionals.length === 2 && (mode === 'local' || mode === 'hosted') ? mode : null;
    if (!routeMode || values.job || values.approve !== undefined) throw new SetupError('USAGE', usage);
    const result = await routeJobs(repository(values.cwd), routeMode);
    if (values.json) {
      console.log(JSON.stringify({ ok: true, ...result }));
    } else {
      console.log(`${result.repo}: ${result.route === 'local' ? `local on ${result.branch}` : 'GitHub-hosted'}`);
      if (result.runner) console.log(`Runner ${result.runner.label}: ${result.runner.status}`);
      else if (command === 'status') console.log('No local runner configured.');
      if ('warning' in result) console.log(result.warning);
      if ('queuedJobs' in result && result.queuedJobs) {
        console.log(`Jobs still queued for the local runner: ${result.queuedJobs.length}`);
        for (const job of result.queuedJobs) console.log(`  ${job.name} ${job.url}`);
      }
    }
    return;
  }
  if (positionals.length !== 1 || !['discover', 'preview', 'setup'].includes(command)) {
    throw new SetupError('USAGE', usage);
  }
  const jobs = values.job;
  if ((command !== 'discover' && !jobs?.length) || (command === 'setup' && !values.approve)) {
    throw new SetupError('USAGE', usage);
  }
  const target = repository(values.cwd);
  if (command === 'discover') {
    const discovered = workflows(target.root);
    if (values.json) {
      const output = discovered.map(({ id, runsOn, alreadySetUp }) => ({ id, runsOn, alreadySetUp }));
      console.log(JSON.stringify({ ok: true, repo: target.repo, jobs: output }));
    } else {
      console.log(target.repo);
      for (const job of discovered) {
        const hosted = styleText('cyan', `☁️  GitHub-hosted ${job.hostedRunner}`);
        const local = styleText('green', '💻  local runner');
        const routing = job.alreadySetUp
          ? `${local} for the selected branch when enabled, otherwise ${hosted}`
          : hosted;
        console.log(`  ${job.id} (${routing})`);
      }
    }
    return;
  }

  const selected = jobs ?? [];
  const preview = plan(target, selected);
  if (command === 'preview') {
    if (values.json) console.log(JSON.stringify({ ok: true, ...preview }));
    else console.log(`${preview.repo} on ${preview.branch}\n${preview.patch || 'No workflow changes needed.\n'}\nApproval fingerprint ${preview.fingerprint}`);
    return;
  }

  if (values.approve !== preview.fingerprint) {
    throw new SetupError('STALE_PREVIEW', 'The approved preview differs from the current checkout or selection. Preview again.');
  }
  const check = () => {
    if (plan(target, selected).fingerprint !== preview.fingerprint) {
      throw new SetupError('STALE_PREVIEW', 'The checkout changed during setup. Preview again.');
    }
    if (preview.patch) git(target.root, ['apply', '--whitespace=nowarn', '--check', '-'], { input: preview.patch });
  };
  check();
  if (preview.patch) {
    const pages = api<{ variables: ActionsVariable[] }[]>(`repos/${target.repo}/actions/variables?per_page=100`, ['--paginate', '--slurp']);
    if (pages.some(page => page.variables.some(variable =>
      ['RUNNERDUTY_REF', 'RUNNERDUTY_LABEL'].includes(variable.name) && variable.value))) {
      throw new SetupError('ROUTE_CONFIGURED', 'Clear the existing RunnerDuty routing variables before setting up more jobs.');
    }
  }
  const runner = await withRunner(target, online => {
    check();
    if (preview.patch) git(target.root, ['apply', '--whitespace=nowarn', '-'], { input: preview.patch });
    return online;
  });
  const workflowChanges = preview.patch ? 'applied' : 'already-applied';
  if (values.json) console.log(JSON.stringify({ ok: true, ...preview, runner, workflowChanges }));
  else console.log(`Runner ${runner.label} is online for ${preview.repo}. Workflow changes ${workflowChanges}.\nCommit and push the reviewed workflow changes through your usual Git workflow.`);
}

main().catch(error => {
  const known = error instanceof SetupError || error.code?.startsWith('ERR_PARSE_ARGS');
  const code = error instanceof SetupError ? error.code : known ? 'USAGE' : 'SETUP_FAILED';
  const message = known ? error.message : 'Setup could not complete. Check the checkout and local RunnerDuty state permissions, then retry.';
  if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: false, error: { code, message } }));
  else console.error(message);
  process.exitCode = 1;
});
