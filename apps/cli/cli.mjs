#!/usr/bin/env node
import { parseArgs, styleText } from 'node:util';
import { api, git, SetupError } from './system.mjs';
import { repository, workflows, plan } from './workflows.mjs';
import { withRunner } from './runner.mjs';
import { routeJobs } from './routing.mjs';

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
    const valid = command === 'status' ? positionals.length === 1
      : positionals.length === 2 && ['local', 'hosted'].includes(mode);
    if (!valid || values.job || values.approve !== undefined) throw new SetupError('USAGE', usage);
    const result = await routeJobs(repository(values.cwd), mode ?? command);
    if (values.json) {
      console.log(JSON.stringify({ ok: true, ...result }));
    } else {
      console.log(`${result.repo}: ${result.route === 'local' ? `local on ${result.branch}` : 'GitHub-hosted'}`);
      if (result.runner) console.log(`Runner ${result.runner.label}: ${result.runner.status}`);
      else if (command === 'status') console.log('No local runner configured.');
      if (result.warning) console.log(result.warning);
      if (result.queuedJobs) {
        console.log(`Jobs still queued for the local runner: ${result.queuedJobs.length}`);
        for (const job of result.queuedJobs) console.log(`  ${job.name} ${job.url}`);
      }
    }
    return;
  }
  if (positionals.length !== 1 || !['discover', 'preview', 'setup'].includes(command) ||
      (command !== 'discover' && !values.job?.length) || (command === 'setup' && !values.approve)) {
    throw new SetupError('USAGE', usage);
  }
  const target = repository(values.cwd);
  let result;
  if (command === 'discover') {
    result = { repo: target.repo, jobs: workflows(target.root) };
  } else {
    const preview = plan(target, values.job);
    result = preview;
    if (command === 'setup') {
      if (values.approve !== preview.fingerprint) {
        throw new SetupError('STALE_PREVIEW', 'The approved preview differs from the current checkout or selection. Preview again.');
      }
      const check = () => {
        if (plan(target, values.job).fingerprint !== preview.fingerprint) {
          throw new SetupError('STALE_PREVIEW', 'The checkout changed during setup. Preview again.');
        }
        if (preview.patch) git(target.root, ['apply', '--whitespace=nowarn', '--check', '-'], { input: preview.patch });
      };
      check();
      if (preview.patch) {
        const pages = api(`repos/${target.repo}/actions/variables?per_page=100`, ['--paginate', '--slurp']);
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
      result = { ...preview, runner, workflowChanges: preview.patch ? 'applied' : 'already-applied' };
    }
  }

  if (values.json) {
    const output = command === 'discover'
      ? { repo: result.repo, jobs: result.jobs.map(({ id, runsOn, alreadySetUp }) => ({ id, runsOn, alreadySetUp })) }
      : result;
    console.log(JSON.stringify({ ok: true, ...output }));
  } else if (command === 'discover') {
    console.log(result.repo);
    for (const job of result.jobs) {
      const hosted = styleText('cyan', `☁️  GitHub-hosted ${job.hostedRunner}`);
      const local = styleText('green', '💻  local runner');
      const routing = job.alreadySetUp
        ? `${local} for the selected branch when enabled, otherwise ${hosted}`
        : hosted;
      console.log(`  ${job.id} (${routing})`);
    }
  } else if (command === 'preview') {
    console.log(`${result.repo} on ${result.branch}\n${result.patch || 'No workflow changes needed.\n'}\nApproval fingerprint ${result.fingerprint}`);
  } else {
    console.log(`Runner ${result.runner.label} is online for ${result.repo}. Workflow changes ${result.workflowChanges}.\nCommit and push the reviewed workflow changes through your usual Git workflow.`);
  }
}

main().catch(error => {
  const known = error instanceof SetupError || error.code?.startsWith('ERR_PARSE_ARGS');
  const code = error instanceof SetupError ? error.code : known ? 'USAGE' : 'SETUP_FAILED';
  const message = known ? error.message : 'Setup could not complete. Check the checkout and local RunnerDuty state permissions, then retry.';
  if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: false, error: { code, message } }));
  else console.error(message);
  process.exitCode = 1;
});
