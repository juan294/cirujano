import { sha256 } from './canonical.js';
import { CLASSIFIER_SOURCE } from './push-classifier-source.js';
import { classify, main } from './push-classifier.template.mjs';

/**
 * The validation rule lives once, in `push-classifier.template.mjs`. The workflow step embeds
 * `CLASSIFIER_SOURCE` (the template bytes followed by `await main();`) and collection imports
 * the same module, so both apply the same rule.
 */
export { CLASSIFIER_SOURCE };
export const CLASSIFIER_DIGEST = sha256(CLASSIFIER_SOURCE);

/** `forced` is the push event's flag; anything but `false` is refused. */
export interface PushClassifierContext { eventName: string; ref: string; sha: string; forced: boolean; repository: string; repositoryId: number; workflowPath: string }
export type { TemplateResponse as ClassifierResponse, TemplateClassification as PushClassification } from './push-classifier.template.mjs';
import type { TemplateClassification as PushClassification, TemplateResponse as ClassifierResponse } from './push-classifier.template.mjs';
/** Reads one GitHub REST path relative to the API root. A rejection with name `TimeoutError` is a timeout. */
export type ClassifierGet = (path: string) => Promise<ClassifierResponse>;

/** Plan § Validation rule 1-5. Never throws: any doubt is `validated: false` with a fixed reason code. */
export function classifyPush(context: PushClassifierContext, get: ClassifierGet): Promise<PushClassification> {
  return classify(context, get);
}
/** The workflow step itself: reads the runner environment and appends `validated` and `reason` to `GITHUB_OUTPUT`. */
export function runClassifierStep(env: Record<string, string | undefined>, fetchImpl: typeof fetch): Promise<PushClassification> {
  return main(env, fetchImpl);
}
