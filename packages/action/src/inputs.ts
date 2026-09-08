export interface ActionInputs {
  githubToken: string;
  runId: number;
}

export class ActionInputError extends Error {
  override readonly name = 'ActionInputError';
}

const RUN_ID_PATTERN = /^[1-9][0-9]{0,18}$/u;

/**
 * Resolve and validate the Action inputs. `run-id` falls back to the current
 * run so the Action can measure the workflow that invoked it; any other value
 * must be a positive integer. An empty token fails closed.
 */
export function resolveInputs(
  getInput: (name: string) => string,
  currentRunId: number,
): ActionInputs {
  const githubToken = getInput('github-token').trim();
  if (githubToken.length === 0) {
    throw new ActionInputError('github-token is required.');
  }

  const rawRunId = getInput('run-id').trim();
  if (rawRunId.length === 0) {
    if (!Number.isInteger(currentRunId) || currentRunId <= 0) {
      throw new ActionInputError('run-id is required when no current workflow run is available.');
    }
    return { githubToken, runId: currentRunId };
  }
  if (!RUN_ID_PATTERN.test(rawRunId)) {
    throw new ActionInputError(`run-id must be a positive integer, received "${rawRunId}".`);
  }
  return { githubToken, runId: Number(rawRunId) };
}
