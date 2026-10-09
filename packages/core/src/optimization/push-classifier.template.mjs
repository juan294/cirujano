// Cirujano skip-validated-push classifier. Plain ES2022 for Node 22, no dependencies.
// A push is validated only when the merged pull request's CI run of this same workflow
// already tested the exact pushed tree green. Any error, timeout, ambiguity or unexpected
// shape returns validated=false, so the push runs the full suite. It always exits 0. This module
// has no side effects; the embedded step script is this file followed by CLASSIFIER_ENTRY.
import { appendFileSync, readFileSync } from 'node:fs';

const SHA = /^[a-f0-9]{40}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const WORKFLOW_PATH = /^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/;
const CLASSIFIER_JOB_ID = 'cirujano_validated_push';
const PAGE = 100;
const REQUEST_TIMEOUT_MS = 15000;
const DEADLINE_MS = 75000;
const MAX_BODY_CHARS = 8 * 1024 * 1024;

class Refusal extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}
function refuse(reason) { throw new Refusal(reason); }
function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function object(value) { if (!isObject(value)) refuse('api-unexpected-shape'); return value; }
function list(value) { if (!Array.isArray(value)) refuse('api-unexpected-shape'); return value; }
function sha(value) { if (typeof value !== 'string' || !SHA.test(value)) refuse('api-unexpected-shape'); return value; }
function positive(value) { if (!Number.isSafeInteger(value) || value < 1) refuse('api-unexpected-shape'); return value; }
function unvalidated(reasonCode) { return { validated: false, reasonCode, prNumber: null, prHeadSha: null, prRunId: null }; }

/** One GET through the injected reader; every failure becomes a fixed reason code. */
async function read(get, path) {
  let response;
  try { response = await get(path); } catch (error) { refuse(error && error.name === 'TimeoutError' ? 'api-timeout' : 'api-error'); }
  if (!isObject(response) || !Number.isSafeInteger(response.status) || typeof response.body !== 'string') refuse('api-error');
  if (response.status !== 200) refuse(response.status >= 400 && response.status <= 599 ? `api-http-${response.status}` : 'api-unexpected-status');
  try { return JSON.parse(response.body); } catch { refuse('api-malformed-json'); }
}

/**
 * `context`: { eventName, ref, sha, forced, repository, repositoryId, workflowPath }; `forced` is the push
 * event's own flag, and only an explicit `false` is accepted.
 * `get(path)`: resolves `{ status, body }` for a GitHub REST path relative to the API root.
 */
export async function classify(context, get) {
  const outcome = unvalidated('classifier-error');
  try {
    const { eventName, ref, sha: pushSha, forced, repository, repositoryId, workflowPath } = isObject(context) ? context : {};
    if (eventName !== 'push') refuse('not-push-event');
    if (typeof ref !== 'string' || !ref.startsWith('refs/heads/') || ref.length === 'refs/heads/'.length) refuse('not-branch-ref');
    const branch = ref.slice('refs/heads/'.length);
    // A forced push can replace the tree the pull request tested, even on a fast-forward of its head.
    if (forced === true) refuse('forced-push');
    if (forced !== false) refuse('push-event-unreadable');
    if (typeof pushSha !== 'string' || !SHA.test(pushSha) || typeof repository !== 'string' || !REPOSITORY.test(repository) || !Number.isSafeInteger(repositoryId) || repositoryId < 1 || typeof workflowPath !== 'string' || !WORKFLOW_PATH.test(workflowPath)) refuse('invalid-context');
    const repo = `repos/${repository}`;

    // Rule 2: exactly one merged pull request into this branch whose merge commit is this push.
    const pulls = list(await read(get, `${repo}/commits/${pushSha}/pulls?per_page=${PAGE}`));
    if (pulls.length >= PAGE) refuse('pulls-paginated');
    const merged = pulls.map(object).filter(pr => typeof pr.merged_at === 'string' && pr.merged_at !== '' && pr.merge_commit_sha === pushSha && isObject(pr.base) && pr.base.ref === branch);
    if (merged.length === 0) refuse('no-merged-pr');
    if (merged.length > 1) refuse('multiple-merged-prs');
    const pr = merged[0];
    outcome.prNumber = positive(pr.number);
    const head = object(pr.head);
    if (!isObject(head.repo) || head.repo.id !== repositoryId) refuse('fork-pr');
    const headSha = sha(head.sha);
    outcome.prHeadSha = headSha;

    // Rule 3: the pushed tree is the tested head's tree.
    const pushCommit = object(await read(get, `${repo}/git/commits/${pushSha}`));
    const headCommit = pushSha === headSha ? pushCommit : object(await read(get, `${repo}/git/commits/${headSha}`));
    if (pushCommit.sha !== pushSha || headCommit.sha !== headSha) refuse('api-unexpected-shape');
    if (sha(object(pushCommit.tree).sha) !== sha(object(headCommit.tree).sha)) refuse('tree-mismatch');

    // Rule 4: a fast-forward, or the base tip at merge time is an ancestor of the tested head.
    if (pushSha !== headSha) {
      const parents = list(pushCommit.parents);
      if (parents.length === 0) refuse('base-not-ancestor');
      const comparison = object(await read(get, `${repo}/compare/${sha(object(parents[0]).sha)}...${headSha}`));
      if (comparison.status !== 'ahead' && comparison.status !== 'identical') refuse('base-not-ancestor');
    }

    // The pull_request run must be this pull request's: no other pull request may share the tested head.
    const sameHead = pushSha === headSha ? pulls : list(await read(get, `${repo}/commits/${headSha}/pulls?per_page=${PAGE}`));
    if (sameHead.length >= PAGE) refuse('pulls-paginated');
    if (sameHead.map(object).some(other => other.number !== pr.number && isObject(other.head) && other.head.sha === headSha)) refuse('other-pr-at-head');

    // Rule 5: the one pull_request run of this workflow at the tested head, and all its jobs, succeeded.
    const runs = object(await read(get, `${repo}/actions/runs?event=pull_request&head_sha=${headSha}&per_page=${PAGE}`));
    const runList = list(runs.workflow_runs);
    if (runs.total_count !== runList.length || runList.length >= PAGE) refuse('pr-runs-paginated');
    const sameWorkflow = runList.map(object).filter(run => run.path === workflowPath);
    if (sameWorkflow.length === 0) refuse('pr-run-missing');
    if (sameWorkflow.length > 1) refuse('pr-run-ambiguous');
    const run = sameWorkflow[0];
    outcome.prRunId = positive(run.id);
    if (run.event !== 'pull_request' || run.head_sha !== headSha || !isObject(run.head_repository) || run.head_repository.id !== repositoryId) refuse('pr-run-identity');
    // When the run names its pull requests, it must name only this one (GitHub may leave the list empty).
    if (Array.isArray(run.pull_requests) && run.pull_requests.some(other => !isObject(other) || other.number !== pr.number || !isObject(other.base) || other.base.ref !== branch)) refuse('pr-run-identity');
    if (run.status !== 'completed' || run.conclusion !== 'success') refuse('pr-run-not-successful');
    const jobs = object(await read(get, `${repo}/actions/runs/${run.id}/jobs?filter=latest&per_page=${PAGE}`));
    const jobList = list(jobs.jobs);
    if (jobs.total_count !== jobList.length || jobList.length >= PAGE) refuse('pr-jobs-paginated');
    // A pull_request run reports the push-only classifier job (at most one) as skipped; every other job must pass.
    const all = jobList.map(object), classifierJobs = all.filter(job => job.name === CLASSIFIER_JOB_ID), tested = all.filter(job => job.name !== CLASSIFIER_JOB_ID);
    if (tested.length === 0) refuse('pr-jobs-empty');
    if (classifierJobs.length > 1 || classifierJobs.some(job => job.conclusion !== 'skipped') || tested.some(job => job.status !== 'completed' || job.conclusion !== 'success')) refuse('pr-job-not-successful');

    outcome.validated = true;
    outcome.reasonCode = 'validated';
  } catch (error) {
    outcome.reasonCode = error instanceof Refusal ? error.reason : 'classifier-error';
  }
  return outcome;
}

function append(path, text) {
  try { if (path) appendFileSync(path, text); } catch { /* A missing output leaves validated unset, so the guarded jobs run. */ }
}

/** The workflow step: reads the runner environment, writes `validated` and `reason`, never throws. */
export async function main(env = process.env, fetchImpl = globalThis.fetch) {
  let result = unvalidated('invalid-context');
  try {
    const repository = env.GITHUB_REPOSITORY || '', workflowRef = env.GITHUB_WORKFLOW_REF || '', api = env.GITHUB_API_URL || '', token = env.GH_TOKEN || '';
    const at = workflowRef.lastIndexOf('@');
    const workflowPath = workflowRef.startsWith(`${repository}/`) && at > repository.length + 1 ? workflowRef.slice(repository.length + 1, at) : '';
    if (/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:\/[A-Za-z0-9._~-]+)*$/.test(api) && token && typeof fetchImpl === 'function') {
      const deadline = AbortSignal.timeout(DEADLINE_MS);
      const get = async path => {
        const response = await fetchImpl(`${api}/${path}`, {
          headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
          redirect: 'error',
          signal: AbortSignal.any([deadline, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
        });
        const body = await response.text();
        if (body.length > MAX_BODY_CHARS) throw new Error('response too large');
        return { status: response.status, body };
      };
      let forced;
      try { forced = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH || '', 'utf8')).forced; } catch { forced = undefined; }
      result = await classify({ eventName: env.GITHUB_EVENT_NAME, ref: env.GITHUB_REF, sha: env.GITHUB_SHA, forced, repository, repositoryId: Number(env.GITHUB_REPOSITORY_ID), workflowPath }, get);
    }
  } catch {
    result = unvalidated('classifier-error');
  }
  append(env.GITHUB_OUTPUT, `validated=${result.validated ? 'true' : 'false'}\nreason=${result.reasonCode}\n`);
  append(env.GITHUB_STEP_SUMMARY, result.validated
    ? `Cirujano: pull request #${result.prNumber} already tested this exact tree green; the duplicate jobs are skipped.\n`
    : `Cirujano: not validated (${result.reasonCode}); the full suite runs.\n`);
  console.log(`cirujano-classifier validated=${result.validated} reason=${result.reasonCode}`);
  return result;
}
