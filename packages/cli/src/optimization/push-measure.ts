import { basename, dirname, join } from 'node:path';
import { assertPushMeasuredEvidence, canonicalJson, CLASSIFIER_JOB_ID, comparePushMeasurement, decodePushCohortManifest, gitBlobSha, jsonDigest, parseWorkflowSource, sha256, type GitHubPricing, type PushCohortEntry, type PushCohortManifest, type PushComparisonInputs, type PushMeasurementArtifact, type PushRunEvidence, type PushRunJob } from '@cirujano/core';
import { positiveInteger, record, text } from '../github-api.js';
import { githubGet, githubPaged } from './github-read.js';
import { binary, type MeasurementDisposition, type MeasurementOptions } from './measure.js';
import { copyPushProposalContext, readPushProposalContext, type PushProposalContext } from './push-propose.js';
import { readPushSandboxContext, retainPushSandboxEvidence, type PushSandboxContext } from './push-verify.js';
import { readPrivateJson, readPushArtifact, withOperationStore } from './store.js';

interface PushMeasurementIntent { schemaVersion: 1; kind: 'measurement-intent'; cohortDigest: string; proposalDigest: string; sandboxDigest: string; startedAt: string }
interface PushMeasurementEvidence { schemaVersion: 1; kind: 'push-measurement-evidence'; visibility: 'public' | 'private'; pricing: GitHubPricing | null; runs: PushRunEvidence[] }
export interface PushMeasurementContext { context: PushProposalContext; pair: PushSandboxContext; cohort: PushCohortManifest; comparison: PushComparisonInputs; measurement: PushMeasurementArtifact; intent: PushMeasurementIntent; evidence: PushMeasurementEvidence }

function exact(value: unknown, keys: string[]): Record<string, unknown> { canonicalJson(value); if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) throw new Error('measurement-companion-invalid'); return value as Record<string, unknown>; }
function check(condition: boolean, reason: string): void { if (!condition) throw new Error(reason); }
const VERDICT = /^\S+ cirujano-classifier validated=(true|false) reason=([a-z0-9][a-z0-9-]{0,63})$/gm;

/** The workflow file at one commit, read through the contents API and checked against its own blob id. */
async function workflowAt(context: PushProposalContext, sha: string, options: MeasurementOptions): Promise<{ hash: string; jobs: Record<string, unknown> }> {
  const p = context.proposal.provenance, file = await githubGet(`repos/${p.repository}/contents/${p.workflowPath.split('/').map(encodeURIComponent).join('/')}?ref=${sha}`, options);
  check(file.type === 'file' && file.path === p.workflowPath && file.encoding === 'base64' && typeof file.content === 'string', 'measurement-workflow-identity');
  const bytes = Buffer.from(String(file.content).replace(/\n/g, ''), 'base64');
  check(gitBlobSha(bytes) === file.sha && bytes.length === file.size, 'measurement-workflow-hash');
  const jobs = record(record(parseWorkflowSource(bytes.toString('utf8')), 'workflow').jobs, 'workflow jobs');
  // GitHub lists jobs by display name; one displayed as the classifier would be read as the classifier.
  check(Object.entries(jobs).every(([id, job]) => id === CLASSIFIER_JOB_ID || record(job, 'workflow job').name !== CLASSIFIER_JOB_ID), 'measurement-job-name-collision');
  return { hash: sha256(bytes), jobs };
}
/** GitHub names a job by its `name` (or id), and a matrix leg `name (values)`; each GitHub job must map to exactly one workflow job. */
function jobIdFor(name: string, jobs: Record<string, unknown>): string {
  const matches = Object.entries(jobs).filter(([id, job]) => {
    const display = record(job, 'workflow job').name ?? id;
    check(typeof display === 'string' && !display.includes('${{'), 'measurement-job-name-expression');
    return name === display || name.startsWith(`${display as string} (`);
  });
  check(matches.length === 1, 'measurement-job-mapping'); return matches[0]![0];
}
async function runJobs(endpoint: string, runId: number, attempt: number, headSha: string, options: MeasurementOptions): Promise<Record<string, unknown>[]> {
  const jobs = await githubPaged(endpoint, 'jobs', options);
  for (const job of jobs) check(job.run_id === runId && job.run_attempt === attempt && job.head_sha === headSha && job.status === 'completed', 'measurement-job-identity');
  check(new Set(jobs.map(job => job.name)).size === jobs.length, 'measurement-job-inventory');
  return jobs;
}
/** A job time as the core comparison accepts it: absent, or an exact UTC timestamp. */
function nullableTime(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  check(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) && new Date(value).toISOString().replace('.000Z', 'Z') === value.replace('.000Z', 'Z'), 'measurement-job-timing');
  return value as string;
}
async function treeOf(prefix: string, sha: string, options: MeasurementOptions): Promise<string> {
  const commit = await githubGet(`${prefix}/git/commits/${sha}`, options); check(commit.sha === sha, 'measurement-commit-identity');
  return text(record(commit.tree, 'commit tree').sha, 'tree sha');
}

/** Everything one cohort entry needs, read from GitHub; the core comparison judges it. */
async function runEvidence(entry: PushCohortEntry, context: PushProposalContext, options: MeasurementOptions): Promise<PushRunEvidence> {
  const p = context.proposal.provenance, prefix = `repos/${p.repository}`;
  const run = await githubGet(`${prefix}/actions/runs/${entry.pushRunId}/attempts/${entry.attempt}`, options), repo = record(run.repository, 'run repo'), head = record(run.head_repository, 'head repo');
  check(run.id === entry.pushRunId && run.run_attempt === entry.attempt && run.head_sha === entry.headSha && run.path === p.workflowPath && run.event === 'push' && run.head_branch === p.integrationBranch && run.status === 'completed' && repo.id === p.repositoryId && repo.full_name === p.repository && head.id === p.repositoryId && head.fork === false, 'measurement-run-identity');
  const workflow = await workflowAt(context, entry.headSha, options);
  const raw = await runJobs(`${prefix}/actions/runs/${entry.pushRunId}/attempts/${entry.attempt}/jobs`, entry.pushRunId, entry.attempt, entry.headSha, options);
  const jobs: PushRunJob[] = raw.map(job => ({ jobId: jobIdFor(text(job.name, 'job name'), workflow.jobs), name: String(job.name), conclusion: typeof job.conclusion === 'string' ? job.conclusion : null, startedAt: nullableTime(job.started_at), completedAt: nullableTime(job.completed_at) }));
  let classifier: PushRunEvidence['classifier'] = null;
  const classifierJobs = jobs.filter(job => job.jobId === CLASSIFIER_JOB_ID);
  if (classifierJobs.length === 1 && classifierJobs[0]!.conclusion === 'success') {
    const id = positiveInteger(raw[jobs.indexOf(classifierJobs[0]!)]!.id, 'job id');
    const logs = new TextDecoder('utf8', { fatal: true }).decode(await binary(`${prefix}/actions/jobs/${id}/logs`, 4 * 1024 * 1024, options));
    const verdicts = [...logs.replace(/\r/g, '').matchAll(VERDICT)];
    check(verdicts.length === 1, 'measurement-classifier-verdict');
    classifier = { validated: verdicts[0]![1] === 'true', reasonCode: verdicts[0]![2]! };
  } else if (classifierJobs.length) classifier = { validated: false, reasonCode: 'classifier-not-successful' };
  let prJobs: PushRunEvidence['prJobs'] = [];
  if (entry.prNumber !== null && entry.prRunId !== null) {
    const pull = await githubGet(`${prefix}/pulls/${entry.prNumber}`, options), base = record(pull.base, 'pull base'), prHead = record(pull.head, 'pull head'), prHeadRepo = record(prHead.repo, 'pull head repo');
    check(pull.number === entry.prNumber && pull.merged === true && pull.merge_commit_sha === entry.headSha && base.ref === p.integrationBranch && prHeadRepo.id === p.repositoryId, 'measurement-pull-identity');
    const prSha = text(prHead.sha, 'pull head sha'), prRun = await githubGet(`${prefix}/actions/runs/${entry.prRunId}`, options), prRepo = record(prRun.repository, 'pr run repo'), prRunHead = record(prRun.head_repository, 'pr run head repo');
    const prAttempt = positiveInteger(prRun.run_attempt, 'pr run attempt');
    check(prRun.id === entry.prRunId && prRun.event === 'pull_request' && prRun.path === p.workflowPath && prRun.head_sha === prSha && prRun.status === 'completed' && prRepo.id === p.repositoryId && prRunHead.id === p.repositoryId, 'measurement-pr-run-identity');
    // Independent of the classifier: a validated push must carry exactly the tree its PR run tested.
    if (classifier?.validated) check(await treeOf(prefix, entry.headSha, options) === await treeOf(prefix, prSha, options), 'measurement-tree-mismatch');
    // A pull_request run reports the push-only classifier as skipped; it is not part of the PR's coverage.
    prJobs = (await runJobs(`${prefix}/actions/runs/${entry.prRunId}/attempts/${prAttempt}/jobs`, entry.prRunId, prAttempt, prSha, options)).filter(job => job.name !== CLASSIFIER_JOB_ID).map(job => ({ name: text(job.name, 'pr job name'), conclusion: text(job.conclusion, 'pr job conclusion') }));
  }
  return { ...entry, workflowHash: workflow.hash, classifier, jobs, prJobs };
}

/** `optimize measure` for a push proposal: read-only GitHub reads of the fixed cohort, then the per-push gate. */
export async function runPushMeasure(proposalPath: string, sandboxPath: string, cohortRaw: unknown, output: string, options: MeasurementOptions = {}): Promise<MeasurementDisposition> {
  let context: PushProposalContext, pair: PushSandboxContext, cohort: PushCohortManifest;
  try {
    context = await readPushProposalContext(proposalPath); pair = await readPushSandboxContext(sandboxPath); cohort = decodePushCohortManifest(cohortRaw);
    check(pair.sandbox.status === 'sandbox-verified' && jsonDigest(pair.context.proposal) === jsonDigest(context.proposal) && cohort.proposalDigest === jsonDigest(context.proposal) && cohort.sandboxDigest === jsonDigest(pair.sandbox) && cohort.candidateSha === pair.sandbox.candidateSha && canonicalJson(cohort.provenance) === canonicalJson(context.proposal.provenance) && Date.parse(cohort.recordedAt) <= (options.now ?? Date.now)(), 'measurement-input-drift');
  } catch { return { status: 'rejected', reasonCode: 'measurement-input-rejected', artifactPath: null }; }
  try {
    return await withOperationStore(output, async store => {
      await copyPushProposalContext(store, context); await retainPushSandboxEvidence(store, sandboxPath, pair); await store.writeJson('cohort.json', cohort);
      const intent: PushMeasurementIntent = { schemaVersion: 1, kind: 'measurement-intent', cohortDigest: jsonDigest(cohort), proposalDigest: jsonDigest(context.proposal), sandboxDigest: jsonDigest(pair.sandbox), startedAt: new Date((options.now ?? Date.now)()).toISOString() };
      await store.writeJson('intent.json', intent);
      const p = context.proposal.provenance, repository = await githubGet(`repos/${p.repository}`, options);
      check(repository.id === p.repositoryId && repository.full_name === p.repository && typeof repository.private === 'boolean', 'measurement-repository-drift');
      // The base and candidate commits hold exactly the collected and the proposed workflow bytes.
      check((await workflowAt(context, p.baseSha, options)).hash === p.workflowHash && (await workflowAt(context, pair.sandbox.candidateSha, options)).hash === context.proposal.candidateWorkflowHash, 'measurement-source-drift');
      const runs: PushRunEvidence[] = [], errors: { pushRunId: number; attempt: number; reason: string }[] = [];
      for (const entry of cohort.entries) { try { runs.push(await runEvidence(entry, context, options)); } catch (error) { errors.push({ pushRunId: entry.pushRunId, attempt: entry.attempt, reason: error instanceof Error && /^[a-z-]+$/.test(error.message) ? error.message : 'measurement-read-incomplete' }); } }
      if (errors.length) { await store.writeJson('measurement-incomplete.json', { schemaVersion: 1, kind: 'measurement-incomplete', cohortDigest: jsonDigest(cohort), runs, errors }); return { status: 'failed', reasonCode: 'measurement-evidence-incomplete', artifactPath: null } as MeasurementDisposition; }
      const evidence: PushMeasurementEvidence = { schemaVersion: 1, kind: 'push-measurement-evidence', visibility: repository.private ? 'private' : 'public', pricing: options.pricing ?? null, runs };
      const measurement = comparePushMeasurement({ input: context.input, proposal: context.proposal, sandbox: pair.sandbox, cohort, runs, visibility: evidence.visibility, pricing: evidence.pricing });
      await store.writeJson('measurement-evidence.json', evidence); await store.writeArtifact('measurement', measurement);
      await store.writeJson('measurement-receipt.json', { schemaVersion: 1, kind: 'measurement-receipt', intentDigest: jsonDigest(intent), evidenceDigest: jsonDigest(evidence), measurementDigest: jsonDigest(measurement) });
      await store.writeJson('operation.json', { schemaVersion: 1, kind: 'optimization-operation', action: 'measure', status: measurement.status, reasonCode: measurement.status, inputDigest: jsonDigest(context.input), nextCommand: 'cirujano --help' });
      return { status: measurement.status, reasonCode: measurement.status, artifactPath: join(store.directory, 'measurement.json') };
    });
  } catch { return { status: 'failed', reasonCode: 'measurement-stage-interrupted', artifactPath: null }; }
}

/** Re-reads a retained push measurement and recomputes the comparison from its retained evidence. */
export async function readPushMeasurementContext(path: string): Promise<PushMeasurementContext> {
  const directory = dirname(path); check(basename(path) === 'measurement.json', 'measurement-filename');
  const context = await readPushProposalContext(join(directory, 'proposal.json')), intent = exact(await readPrivateJson(join(directory, 'intent.json')), ['schemaVersion', 'kind', 'cohortDigest', 'proposalDigest', 'sandboxDigest', 'startedAt']) as unknown as PushMeasurementIntent;
  // The retained journal names its artifact; the sandbox reader then checks the whole journal.
  const sandboxName = record(await readPrivateJson(join(directory, 'sandbox-evidence', 'intent.json')), 'sandbox journal').latestArtifact;
  check(typeof sandboxName === 'string' && /^sandbox(?:-[a-f0-9]{64})?\.json$/.test(sandboxName), 'measurement-sandbox-name');
  const pair = await readPushSandboxContext(join(directory, 'sandbox-evidence', sandboxName as string)), cohort = decodePushCohortManifest(await readPrivateJson(join(directory, 'cohort.json'))), measurement = await readPushArtifact('measurement', path);
  const evidence = exact(await readPrivateJson(join(directory, 'measurement-evidence.json'), 8 * 1024 * 1024), ['schemaVersion', 'kind', 'visibility', 'pricing', 'runs']) as unknown as PushMeasurementEvidence;
  const receipt = exact(await readPrivateJson(join(directory, 'measurement-receipt.json')), ['schemaVersion', 'kind', 'intentDigest', 'evidenceDigest', 'measurementDigest']);
  check(intent.schemaVersion === 1 && intent.kind === 'measurement-intent' && Number.isFinite(Date.parse(intent.startedAt)) && Date.parse(intent.startedAt) >= Date.parse(cohort.recordedAt) && intent.cohortDigest === jsonDigest(cohort) && intent.proposalDigest === jsonDigest(context.proposal) && intent.sandboxDigest === jsonDigest(pair.sandbox) && jsonDigest(pair.context.proposal) === jsonDigest(context.proposal)
    && evidence.schemaVersion === 1 && evidence.kind === 'push-measurement-evidence' && receipt.schemaVersion === 1 && receipt.kind === 'measurement-receipt' && receipt.intentDigest === jsonDigest(intent) && receipt.evidenceDigest === jsonDigest(evidence) && receipt.measurementDigest === jsonDigest(measurement), 'measurement-receipt-drift');
  const comparison: PushComparisonInputs = { input: context.input, proposal: context.proposal, sandbox: pair.sandbox, cohort, runs: evidence.runs, visibility: evidence.visibility, pricing: evidence.pricing };
  assertPushMeasuredEvidence(comparison, measurement);
  return { context, pair, cohort, comparison, measurement, intent, evidence };
}
