import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalJson, CLASSIFIER_JOB_ID, decodePushArtifact, gitBlobSha, jsonDigest, PUSH_FAMILY, type PushCohortManifest } from '@cirujano/core';
import type { GitHubPageRunner } from '../github-api.js';
import type { GitHubBinaryRunner } from './measure.js';
import type { GitHubMutationRunner } from './publish.js';
import { branch, eligibleWorkflow, repository, workflow } from './push-collect.test-helper.js';
import { command, pushVerificationFixture } from './push-verify.test-helper.js';
import { createOptimizationService } from './service.js';
import { readPrivateJson } from './store.js';

const prefix = `repos/${repository}`, sha = (seed: number) => seed.toString(16).padStart(40, '0');
interface Job { id: number; name: string; conclusion: string; minutes: number; completedAt?: string }
/** A completed job that ran `minutes` billed minutes (ending 30 s into the last one), or a skipped one. */
function job(runId: number, headSha: string, entry: Job) {
  const started = Date.parse('2026-10-10T10:00:00Z'), completed = entry.conclusion === 'skipped' ? started : started + (entry.minutes - 1) * 60_000 + 30_000;
  return { id: entry.id, name: entry.name, run_id: runId, run_attempt: 1, head_sha: headSha, status: 'completed', conclusion: entry.conclusion, started_at: new Date(started).toISOString().replace('.000Z', 'Z'), completed_at: entry.completedAt ?? new Date(completed).toISOString().replace('.000Z', 'Z') };
}

/**
 * A verified push proposal plus a synthetic GitHub with three baseline and three candidate merged-PR pushes
 * and one direct control push on the matrix workflow, all mutable before `measure` runs.
 */
export async function pushMeasurementFixture() {
  const f = await pushVerificationFixture();
  if (await f.verify() !== 0) throw new Error(f.output.join(''));
  const sandboxPath = join(f.verified, 'sandbox.json'), sandbox = decodePushArtifact('sandbox', await readPrivateJson(sandboxPath)), p = f.proposal.provenance;
  const input = decodePushArtifact('input', await readPrivateJson(join(f.directory, 'proposed', 'input.json')));
  const entries: PushCohortManifest['entries'] = [
    ...[0, 1, 2].map(index => ({ role: 'baseline' as const, pushRunId: 1001 + index, attempt: 1, headSha: sha(1001 + index), prNumber: 101 + index, prRunId: 2001 + index })),
    ...[0, 1, 2].map(index => ({ role: 'candidate' as const, pushRunId: 1101 + index, attempt: 1, headSha: sha(1101 + index), prNumber: 111 + index, prRunId: 2101 + index })),
    { role: 'control', pushRunId: 1201, attempt: 1, headSha: sha(1201), prNumber: null, prRunId: null },
  ];
  const cohort: PushCohortManifest = { schemaVersion: 1, kind: 'push-measurement-cohort', family: PUSH_FAMILY, provenance: p, proposalDigest: jsonDigest(f.proposal), sandboxDigest: jsonDigest(sandbox), candidateSha: f.candidateSha, recordedAt: '2026-10-09T00:00:00Z', entries };
  const workflows = new Map<string, string>([[p.baseSha, eligibleWorkflow], [f.candidateSha, f.candidate]]);
  const pushJobs = new Map<number, Job[]>(), prJobs = new Map<number, Job[]>(), logs = new Map<number, string>(), pulls = new Map<number, Record<string, unknown>>();
  entries.forEach((entry, index) => {
    const base = entry.role === 'baseline', id = entry.pushRunId * 10;
    workflows.set(entry.headSha, base ? eligibleWorkflow : f.candidate);
    const legs = (conclusion: string, second: number) => [{ id: id + 1, name: 'test (20)', conclusion, minutes: 6 }, { id: id + 2, name: 'test (22)', conclusion, minutes: second }];
    const classifier = { id, name: CLASSIFIER_JOB_ID, conclusion: 'success', minutes: 1 };
    pushJobs.set(entry.pushRunId, base ? legs('success', 5 + index) : entry.role === 'candidate' ? [classifier, { id: id + 1, name: 'test', conclusion: 'skipped', minutes: 0 }] : [classifier, ...legs('success', 6)]);
    logs.set(id, `2026-10-10T10:00:01.0000000Z ##[group]Run node --input-type=module <<'CIRUJANO_CLASSIFIER'\n2026-10-10T10:00:02.0000000Z cirujano-classifier validated=${entry.role === 'candidate'} reason=${entry.role === 'candidate' ? 'validated' : 'no-merged-pr'}\n`);
    if (entry.prNumber === null || entry.prRunId === null) return;
    pulls.set(entry.prNumber, { number: entry.prNumber, merged: true, merge_commit_sha: entry.headSha, base: { ref: branch }, head: { sha: sha(entry.prRunId), repo: { id: p.repositoryId } } });
    prJobs.set(entry.prRunId, [{ id: entry.prRunId * 10 + 1, name: 'test (20)', conclusion: 'success', minutes: 6 }, { id: entry.prRunId * 10 + 2, name: 'test (22)', conclusion: 'success', minutes: 6 }, ...(base ? [] : [{ id: entry.prRunId * 10, name: CLASSIFIER_JOB_ID, conclusion: 'skipped', minutes: 0 }])]);
  });
  // Phase 7 pins publication branches at the base and the candidate; the integration branch has moved on.
  const trees = new Map<string, string>();
  for (const entry of entries) if (entry.role === 'candidate') { trees.set(entry.headSha, sha(entry.pushRunId + 50_000)); trees.set(sha(entry.prRunId!), sha(entry.pushRunId + 50_000)); }
  const refs = new Map<string, string>([['cirujano/base', p.baseSha], ['cirujano/skip-validated-push', f.candidateSha]]), opened: Record<string, unknown>[] = [], posts: unknown[] = [];
  const respond = (endpoint: string): unknown => {
    if (endpoint === prefix) return { id: p.repositoryId, full_name: repository, fork: false, private: false };
    const contents = new RegExp(`^${prefix}/contents/${workflow.replace(/[./]/g, '\\$&')}\\?ref=([a-f0-9]{40})$`).exec(endpoint);
    if (contents) { const text = workflows.get(contents[1]!)!; return { type: 'file', path: workflow, encoding: 'base64', content: Buffer.from(text).toString('base64'), sha: gitBlobSha(text), size: Buffer.byteLength(text) }; }
    const pushRun = /\/actions\/runs\/(\d+)\/attempts\/1(\/jobs\?per_page=100&page=1)?$/.exec(endpoint), entry = pushRun ? entries.find(row => row.pushRunId === Number(pushRun[1])) : undefined;
    if (pushRun && entry) return pushRun[2] ? { total_count: pushJobs.get(entry.pushRunId)!.length, jobs: pushJobs.get(entry.pushRunId)!.map(row => job(entry.pushRunId, entry.headSha, row)) } : { id: entry.pushRunId, run_attempt: 1, head_sha: entry.headSha, path: workflow, event: 'push', head_branch: branch, status: 'completed', repository: { id: p.repositoryId, full_name: repository }, head_repository: { id: p.repositoryId, full_name: repository, fork: false } };
    const prRun = /\/actions\/runs\/(\d+)(\/attempts\/1\/jobs\?per_page=100&page=1)?$/.exec(endpoint), prRunId = Number(prRun?.[1]);
    if (prRun && prJobs.has(prRunId)) return prRun[2] ? { total_count: prJobs.get(prRunId)!.length, jobs: prJobs.get(prRunId)!.map(row => job(prRunId, sha(prRunId), row)) } : { id: prRunId, run_attempt: 1, event: 'pull_request', path: workflow, head_sha: sha(prRunId), status: 'completed', repository: { id: p.repositoryId }, head_repository: { id: p.repositoryId } };
    const pull = /\/pulls\/(\d+)$/.exec(endpoint);
    if (pull && pulls.has(Number(pull[1]))) return pulls.get(Number(pull[1]));
    if (pull) return opened.find(row => row.number === Number(pull[1]));
    const ref = new RegExp(`^${prefix}/git/ref/heads/(.+)$`).exec(endpoint);
    if (ref) return { ref: `refs/heads/${ref[1]}`, object: { type: 'commit', sha: refs.get(ref[1]!) } };
    if (endpoint === `${prefix}/git/commits/${p.baseSha}`) return { sha: p.baseSha, tree: { sha: input.structuralFacts.treeSha } };
    const commit = new RegExp(`^${prefix}/git/commits/([a-f0-9]{40})$`).exec(endpoint);
    if (commit && trees.has(commit[1]!)) return { sha: commit[1], tree: { sha: trees.get(commit[1]!) } };
    if (endpoint === `${prefix}/compare/${p.baseSha}...${f.candidateSha}`) return { status: 'ahead', base_commit: { sha: p.baseSha }, merge_base_commit: { sha: p.baseSha }, files: [{ filename: workflow, status: 'modified', sha: gitBlobSha(f.candidate) }] };
    if (endpoint === `${prefix}/pulls?state=all&per_page=100&page=1`) return opened;
    throw new Error(`unhandled owned GitHub read ${endpoint}`);
  };
  const pageRunner: GitHubPageRunner = async (_command, args) => ({ stdout: JSON.stringify(respond(args.find(value => value.startsWith('repos/'))!)) });
  const binaryRunner: GitHubBinaryRunner = async (_command, args) => ({ stdout: Buffer.from(logs.get(Number(/\/actions\/jobs\/(\d+)\/logs$/.exec(args.find(value => value.startsWith('repos/'))!)![1]))!) });
  const mutationRunner: GitHubMutationRunner = async (_command, args, settings) => {
    const body = JSON.parse(settings.input) as Record<string, unknown>; posts.push({ args, body });
    const number = 7; opened.push({ number, state: 'open', merged: false, merged_at: null, html_url: `https://github.com/${repository}/pull/${number}`, body: body.body, auto_merge: null, base: { ref: body.base, sha: refs.get(String(body.base)), repo: { id: p.repositoryId, full_name: repository } }, head: { ref: body.head, sha: refs.get(String(body.head)), repo: { id: p.repositoryId, full_name: repository } } });
    return { stdout: JSON.stringify(opened.at(-1)) };
  };
  const service = createOptimizationService({ pageRunner, binaryRunner, mutationRunner, now: () => Date.parse('2026-10-10T12:00:00Z'), permitLedger: join(f.directory, 'publication-ledger') });
  const cohortPath = join(f.directory, 'cohort.json'), measured = join(f.directory, 'measured'), reported = join(f.directory, 'reported');
  const proposalPath = join(f.directory, 'proposed', 'proposal.json');
  const measure = async () => { await writeFile(cohortPath, canonicalJson(cohort)); return service.run(command('measure', { proposal: proposalPath, sandbox: sandboxPath, cohort: cohortPath, output: measured }), f.io); };
  const report = () => service.run(command('report', { proposal: proposalPath, sandbox: sandboxPath, measurement: join(measured, 'measurement.json'), output: reported, 'base-ref': 'cirujano/base', 'head-ref': 'cirujano/skip-validated-push' }), f.io);
  return { ...f, p, input, sandbox, sandboxPath, cohort, entries, workflows, pushJobs, prJobs, logs, pulls, trees, refs, opened, posts, service, measured, reported, proposalPath, measure, report };
}
