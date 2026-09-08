import * as core from '@actions/core';
import * as github from '@actions/github';
import { parseGithubJobs, summarizeBillableMinutes } from '@cirujano/core';

import { ActionInputError, resolveInputs } from './inputs.js';

export async function runAction(): Promise<void> {
  try {
    const { githubToken, runId } = resolveInputs((name) => core.getInput(name), github.context.runId);
    const octokit = github.getOctokit(githubToken);
    const { owner, repo } = github.context.repo;

    const jobs = await octokit.paginate(octokit.rest.actions.listJobsForWorkflowRun, {
      owner,
      repo,
      run_id: runId,
      per_page: 100,
    });
    const summary = summarizeBillableMinutes(parseGithubJobs({ jobs }));

    core.setOutput('billable-minutes', String(summary.billableMinutes));
    core.setOutput('job-count', String(summary.measuredJobs));
    core.info(
      `Run ${runId}: ${summary.billableMinutes} billable minutes across ${summary.measuredJobs} jobs`
      + (summary.skippedJobs > 0 ? ` (${summary.skippedJobs} not yet complete)` : ''),
    );
  } catch (error) {
    if (error instanceof ActionInputError) {
      core.setFailed(`Invalid input: ${error.message}`);
      return;
    }
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}
