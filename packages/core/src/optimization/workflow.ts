import { isAlias, isMap, isScalar, isSeq, parseAllDocuments, visit } from 'yaml';
import { jsonDigest, OptimizationInputError, sha256 } from './canonical.js';
import { decodeProvenance, decodeActionReceipt } from './contracts.js';
import type { ActionReceipt, CacheOperation, Provenance } from './contracts.js';
export interface WorkflowEvidence { provenance: Provenance; receipt: ActionReceipt; rootLockfile: boolean; timedBaseline: boolean; requiredChecks: string[]; verificationProfilePresent: boolean }
export interface WorkflowEligibility { status: 'eligible' | 'no-change' | 'unsupported'; reason: string; operations: CacheOperation[]; protectedDigest: string | null; structuralFacts: Record<string,string|number|boolean> }
function record(value:unknown): Record<string,unknown> { if (!value || typeof value!=='object' || Array.isArray(value)) throw new OptimizationInputError('Expected YAML mapping'); return value as Record<string,unknown>; }
function parse(source:string): Record<string,unknown> {
  if (Buffer.byteLength(source)>256*1024) throw new OptimizationInputError('yaml-size');
  const documents=parseAllDocuments(source,{version:'1.2',uniqueKeys:true,strict:true,keepSourceTokens:true});
  if (documents.length!==1 || !documents[0] || documents[0].errors.length || documents[0].warnings.length) throw new OptimizationInputError('yaml-parse');
  const document=documents[0]!;
  visit(document,(_,node) => {
    if (isAlias(node)) throw new OptimizationInputError('yaml-alias');
    if (node && typeof node==='object' && 'tag' in node && node.tag) throw new OptimizationInputError('yaml-tag');
    if ((isMap(node)||isSeq(node)||isScalar(node)) && !node.range) throw new OptimizationInputError('yaml-range');
    if (isMap(node)) for (const pair of node.items) if (!isScalar(pair.key) || typeof pair.key.value!=='string') throw new OptimizationInputError('yaml-key');
  });
  return record(document.toJS({maxAliasCount:0}));
}
/** All collection and patch consumers use the same strict YAML interpretation. */
export function parseWorkflowSource(source:string):Record<string,unknown> { return parse(source); }
export function protectedWorkflowDigest(source:string,jobId:string,stepIndex:number):string {
  const workflow=parse(source); const job=record(record(workflow.jobs)[jobId]);
  if (!Array.isArray(job.steps) || !job.steps[stepIndex]) throw new OptimizationInputError('Missing selected workflow step');
  const step=record(job.steps[stepIndex]);const inputs=record(step.with);
  delete inputs.cache;delete inputs['cache-dependency-path'];
  return jsonDigest(workflow);
}
function allStrings(value:unknown):string[] {
  if (typeof value==='string') return [value]; if (Array.isArray(value)) return value.flatMap(allStrings);
  if (value && typeof value==='object') return Object.values(value).flatMap(allStrings); return [];
}
function permissionReadOnly(value:unknown):boolean { if (!value || typeof value!=='object' || Array.isArray(value)) return false; const entries=Object.entries(value);return entries.length>0 && entries.every(([,permission])=>permission==='read'||permission==='none'); }
export function inspectWorkflow(source:string,evidence:WorkflowEvidence):WorkflowEligibility {
  decodeProvenance(evidence.provenance);
  if (sha256(source)!==evidence.provenance.workflowHash) throw new OptimizationInputError('Immutable workflow hash mismatch');
  const refuse=(reason:string,status:'unsupported'|'no-change'='unsupported'):WorkflowEligibility => ({status,reason,operations:[],protectedDigest:null,structuralFacts:{}});
  let workflow:Record<string,unknown>;
  try { workflow=parse(source); } catch (error) { if (error instanceof OptimizationInputError) return refuse(error.message); throw error; }
  try {
    const jobs=record(workflow.jobs), job=record(jobs[evidence.provenance.jobId]);
    const earlySteps=Array.isArray(job.steps)?job.steps.map(record):[];
    const earlySelected=earlySteps[evidence.provenance.stepIndex];
    if (earlySelected && typeof earlySelected.uses==='string' && /^actions\/setup-node@/.test(earlySelected.uses) && earlySelected.with && 'cache' in record(earlySelected.with)) return refuse('already-cached','no-change');
    decodeActionReceipt(evidence.receipt);
    for (const scope of [workflow,job]) { const defaults=record(scope.defaults??{}); if (defaults.run && 'working-directory' in record(defaults.run)) return refuse('working-directory'); }
    function secretKeys(value:unknown):boolean { if (Array.isArray(value)) return value.some(secretKeys); if (value && typeof value==='object') return Object.entries(value).some(([key,entry])=> /(?:^|_)(?:token|password|secret|api_key|auth)(?:$|_)/i.test(key) || key==='_authToken' || secretKeys(entry)); return false; }
    if (secretKeys(job) || secretKeys(workflow.env)) return refuse('secret-bearing-configuration');
    if (!Array.isArray(job.steps)) return refuse('reusable-job');
    if ('strategy' in job) return refuse('matrix');
    if ('container' in job || 'services' in job) return refuse('container-or-services');
    if (typeof job['runs-on']!=='string' || !/^ubuntu-(?:latest|\d\d\.04)$/.test(job['runs-on'])) return refuse('unsupported-runner');
    if (!permissionReadOnly(job.permissions??workflow.permissions)) return refuse('permissions-not-read-only');
    if (allStrings(workflow.on).includes('pull_request_target') || (typeof workflow.on==='object' && workflow.on!==null && 'pull_request_target' in workflow.on)) return refuse('pull-request-target');
    if (allStrings(workflow).some(value => /\bsteps\s*(?:\.|\[)|\btoJSON\s*\(\s*steps\b|\$\{\{[^}]*\bsteps\b/.test(value))) return refuse('steps-context-consumer');
    if (allStrings(workflow).some(value => /\bsecrets\s*(?:\.|\[)|(?:NODE_AUTH_TOKEN|NPM_TOKEN|_authToken)/.test(value))) return refuse('secret-bearing-configuration');
    const steps=job.steps.map(record),index=evidence.provenance.stepIndex,selected=steps[index];
    if (!selected) return refuse('missing-selected-step');
    if ('id' in selected) return refuse('selected-step-id');
    if ('if' in selected || 'env' in selected || 'continue-on-error' in selected) return refuse('conditional-setup');
    if (typeof selected.uses!=='string' || selected.uses!==`actions/setup-node@${evidence.receipt.commitSha}` || evidence.receipt.repository!=='actions/setup-node' || evidence.receipt.immutable!==true || !/^[a-f0-9]{40}$/.test(evidence.receipt.commitSha) || !evidence.receipt.inputs.includes('cache') || !evidence.receipt.inputs.includes('cache-dependency-path')) return refuse('unverified-setup-node');
    const inputs=record(selected.with);
    if ('cache' in inputs) return refuse('already-cached','no-change');
    if (inputs['package-manager-cache']===false || inputs['package-manager-cache']==='false') return refuse('cache-disabled');
    if ('cache-dependency-path' in inputs) return refuse('unknown-dependency-path');
    if (Object.keys(inputs).some(key=>['registry-url','scope','token','mirror','mirror-token'].includes(key))) return refuse('secret-bearing-configuration');
    if (Object.keys(inputs).some(key=>!['node-version','architecture','check-latest','package-manager-cache'].includes(key))) return refuse('unsupported-node-input');
    if (typeof inputs['node-version']!=='string' || !/^\d+\.\d+\.\d+$/.test(inputs['node-version']) || allStrings(inputs).some(value=>value.includes('${{'))) return refuse('non-exact-runtime');
    if (inputs['check-latest']===true || inputs['check-latest']==='true') return refuse('non-exact-runtime');
    const pnpm=steps.findIndex(step=>typeof step.uses==='string'&&/^pnpm\/action-setup@[a-f0-9]{40}$/.test(step.uses));
    if (pnpm<0 || pnpm>=index) return refuse('pnpm-setup-order');
    const pnpmInputs=record(steps[pnpm]!.with);
    if (typeof pnpmInputs.version!=='string' || !/^\d+\.\d+\.\d+$/.test(pnpmInputs.version) || Object.keys(pnpmInputs).some(key=>key!=='version') || 'if' in steps[pnpm]!) return refuse('non-exact-pnpm');
    const checkout=steps.findIndex(step=>typeof step.uses==='string'&&/^actions\/checkout@[a-f0-9]{40}$/.test(step.uses));
    if (checkout<0 || checkout>=pnpm || 'if' in steps[checkout]! || (steps[checkout]!.with && Object.keys(record(steps[checkout]!.with)).some(key=>['repository','ref','path','token','ssh-key'].includes(key)))) return refuse('alternate-checkout');
    const installs=steps.filter(step=>typeof step.run==='string'&&/\bpnpm\s+(?:install|i)\b/.test(step.run));
    if (installs.length!==1 || installs[0]!.run!=='pnpm install --frozen-lockfile' || 'if' in installs[0]! || 'working-directory' in installs[0]! || 'working-directory' in record(job.defaults??{})) return refuse('unsupported-install-command');
    if (steps.indexOf(installs[0]!)<=index) return refuse('install-order');
    if (!evidence.rootLockfile) return refuse('unknown-dependency-path');
    if (!evidence.timedBaseline) return refuse('no-timed-baseline');
    if (!evidence.requiredChecks.length || new Set(evidence.requiredChecks).size!==evidence.requiredChecks.length) return refuse('missing-required-checks');
    if (!evidence.verificationProfilePresent) return refuse('missing-verification-profile');
    const structuralFacts={jobId:evidence.provenance.jobId,stepIndex:index,nodeVersion:inputs['node-version'],pnpmVersion:pnpmInputs.version,runner:job['runs-on'] as string,rootLockfile:true};
    return {status:'eligible',reason:'eligible',operations:[{type:'enable-pnpm-cache',jobId:evidence.provenance.jobId,stepIndex:index}],protectedDigest:protectedWorkflowDigest(source,evidence.provenance.jobId,index),structuralFacts};
  } catch (error) { if (error instanceof OptimizationInputError) return refuse('unsupported-workflow-shape');throw error; }
}
