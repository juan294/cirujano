/** Types for `push-classifier.template.mjs`, the one implementation of the classifier rule. */
export interface TemplateContext { eventName: unknown; ref: unknown; sha: unknown; forced: unknown; repository: unknown; repositoryId: unknown; workflowPath: unknown }
export interface TemplateResponse { status: number; body: string }
export interface TemplateClassification { validated: boolean; reasonCode: string; prNumber: number | null; prHeadSha: string | null; prRunId: number | null }
export function classify(context: TemplateContext, get: (path: string) => Promise<TemplateResponse>): Promise<TemplateClassification>;
export function main(env?: Record<string, string | undefined>, fetchImpl?: typeof fetch): Promise<TemplateClassification>;
