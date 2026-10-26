import { OptimizationInputError } from './canonical.js';

/** The job id of the generated classifier; no guarded job may use it. */
export const CLASSIFIER_JOB_ID = 'cirujano_validated_push';
/** A whole GitHub job id, capped at 100 characters. */
export const JOB_ID = /^[A-Za-z_][A-Za-z0-9_-]{0,99}$/;
/** Valid job ids, strictly sorted (so unique), and never the classifier. */
export function isGuardedJobSet(ids: readonly unknown[]): ids is readonly string[] {
  return ids.every((id, index) => typeof id === 'string' && JOB_ID.test(id) && id !== CLASSIFIER_JOB_ID && (index === 0 || (ids[index - 1] as string) < id));
}

/**
 * The guard written to each guarded job's `if`: it keeps the default success semantics for the
 * original needs, runs unless the classifier succeeded and said `validated`, and keeps the
 * original condition (text without `${{ }}`) as the last operand.
 */
export function guardExpression(needs: readonly string[], original: string | null): string {
  if (!isGuardedJobSet(needs)) throw new OptimizationInputError('guard-needs');
  return ['!cancelled()', ...needs.map(need => `needs.${need}.result == 'success'`), `(needs.${CLASSIFIER_JOB_ID}.result != 'success' || needs.${CLASSIFIER_JOB_ID}.outputs.validated != 'true')`, ...(original === null ? [] : [`(${original})`])].join(' && ');
}
