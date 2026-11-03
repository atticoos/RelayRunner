import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isMap, isScalar, parseDocument } from 'yaml';
import { api, git, run, SetupError } from './system.mjs';

const hosted = /^(?:ubuntu-(?:latest|(?:20|22|24|26)\.04(?:-arm)?)|macos-(?:latest|(?:13|14|15|26)(?:-intel)?)|windows-(?:latest|2019|2022|2025))$/;
const route = "${{ github.event_name == 'push' && github.ref_type == 'branch' && github.ref == vars.RUNNERDUTY_REF && vars.RUNNERDUTY_LABEL != '' && vars.RUNNERDUTY_LABEL || '{hosted}' }}";
const managed = /^\$\{\{ github\.event_name == 'push'/;

export function repository(cwd) {
  const root = git(cwd, ['rev-parse', '--show-toplevel']).trim();
  const origin = git(root, ['remote', 'get-url', 'origin']).trim();
  const remote = origin.match(/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w-]+\/[\w.-]+?)\/?$/i);
  if (!remote) throw new SetupError('UNSUPPORTED_REMOTE', 'Use a checkout with a github.com origin.');
  const repo = api(`repos/${remote[1].replace(/\.git$/, '')}`);
  if (repo.visibility !== 'private' || repo.fork || !/^[\w-]+\/[\w.-]+$/.test(repo.full_name)) {
    throw new SetupError('UNSUPPORTED_REPO', 'Setup requires a private, non-fork GitHub repository.');
  }
  return { root, repo: repo.full_name, id: repo.id };
}

export function workflows(root) {
  const files = git(root, ['ls-files', '-z', '--', '.github/workflows']).split('\0')
    .filter(file => /^\.github\/workflows\/[\w.-]+\.ya?ml$/.test(file));
  return [...new Set(files)].flatMap(file => {
    const path = join(root, file);
    try {
      if (!lstatSync(path).isFile() || !lstatSync(join(root, '.github')).isDirectory() ||
          !lstatSync(join(root, '.github/workflows')).isDirectory()) return [];
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    const source = readFileSync(path, 'utf8');
    const doc = parseDocument(source);
    if (doc.errors.length) throw new SetupError('INVALID_WORKFLOW', `Cannot parse ${file}.`);
    const events = doc.get('on');
    const push = isMap(events) ? events.has('push') : events?.items
      ? events.items.some(item => item?.value === 'push') : events === 'push';
    const jobs = doc.get('jobs');
    if (!push || !isMap(jobs) || jobs.anchor) return [];
    return jobs.items.flatMap(({ key, value }) => {
      if (!isScalar(key) || typeof key.value !== 'string' || !isMap(value) || value.anchor) return [];
      const node = value.get('runs-on', true);
      if (!isScalar(node) || typeof node.value !== 'string' || node.anchor || node.tag ||
          !['PLAIN', 'QUOTE_SINGLE', 'QUOTE_DOUBLE'].includes(node.type)) return [];
      const [start, end] = node.range;
      if (/[\r\n]/.test(source.slice(start, end))) return [];
      const fallback = managed.test(node.value)
        ? node.value.match(/\|\| '([^']+)' \}\}$/)?.[1]
        : undefined;
      const alreadySetUp = fallback !== undefined && hosted.test(fallback) &&
        route.replace('{hosted}', fallback) === node.value;
      if (!alreadySetUp && !hosted.test(node.value)) return [];
      const hostedRunner = alreadySetUp ? fallback : node.value;
      return [{ id: `${file}:${key.value}`, file, source, start, end, runsOn: node.value, alreadySetUp, hostedRunner }];
    });
  });
}

function patchFor(file, before, after) {
  const dir = mkdtempSync(join(tmpdir(), 'runnerduty-patch-'));
  try {
    writeFileSync(join(dir, 'before'), before);
    writeFileSync(join(dir, 'after'), after);
    const diff = run('git', ['diff', '--no-index', '--no-color', '--no-ext-diff', '--text', '--', 'before', 'after'], { cwd: dir });
    if (diff.status !== 1 || !diff.stdout.includes('\n@@ ')) {
      throw new SetupError('PATCH_FAILED', `Could not generate patch for ${file}.`);
    }
    return `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n` +
      diff.stdout.slice(diff.stdout.indexOf('\n@@ ') + 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function plan(target, ids) {
  const available = workflows(target.root);
  const selected = [...new Set(ids)].sort().map(id => {
    const job = available.find(candidate => candidate.id === id);
    if (!job) throw new SetupError('INELIGIBLE_JOB', `Job is unavailable or unsupported: ${id}`);
    return job;
  });
  const files = Map.groupBy(selected.filter(job => !job.alreadySetUp), job => job.file);
  const patch = [...files].map(([file, jobs]) => {
    const before = jobs[0].source;
    let after = before;
    for (const { start, end, runsOn } of jobs.sort((a, b) => b.start - a.start)) {
      after = after.slice(0, start) + JSON.stringify(route.replace('{hosted}', runsOn)) + after.slice(end);
    }
    return patchFor(file, before, after);
  }).join('');
  const head = git(target.root, ['rev-parse', 'HEAD']).trim();
  const branch = git(target.root, ['branch', '--show-current']).trim();
  if (!branch) throw new SetupError('DETACHED_HEAD', 'Switch to a named branch before previewing setup.');
  const fingerprint = createHash('sha256').update(JSON.stringify([
    target.repo, head, branch, selected.map(({ id, source }) => [id, source]), patch,
  ])).digest('hex');
  return { repo: target.repo, branch, jobs: selected.map(job => job.id), fingerprint, patch };
}
