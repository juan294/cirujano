import { execFile as execFileCallback } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { canonicalJson, jsonDigest, sha256 } from '@cirujano/core';
import type { CliIo } from '../cli.js';
import type { GitHubPageRunner } from '../github-api.js';
import type { OptimizeArguments } from './arguments.js';
export type { OptimizeArguments } from './arguments.js';
import { readRetainedOptimizationContext, RetainedInputError } from './input-context.js';
export { readRetainedOptimizationInput } from './input-context.js';
import { collectGitHubInput } from './github-read.js';
import { runPropose, readProposalStatus, readDiagnosisContext } from './propose.js';
import { diagnoseOptimization, decodeInferencePreview } from './diagnose.js';
import { decodeInferenceConfig, type InferenceIntent } from './nebius.js';
import { consumePermit, readPrivateJson, scrubOptimizationValue, withOperationStore } from './store.js';

declare const CIRUJANO_TOOL_SOURCE_SHA: string | undefined;
export interface OptimizationService { run(args: OptimizeArguments, io: CliIo): Promise<0 | 1 | 2> }
export interface OptimizationServiceOptions { pageRunner?: GitHubPageRunner; ghPath?: string; fetch?: typeof fetch; apiKey?: string; toolSourceSha?: string; bundleDigest?: string; sourceIdentity?: () => Promise<{ toolSourceSha: string; bundleDigest: string }>; permitLedger?: string }
interface OperationState { schemaVersion: 1; kind: 'optimization-operation'; action: string; status: string; reasonCode: string; nextCommand: string; inputDigest: string | null }
class ServiceError extends Error { constructor(readonly reasonCode: string, readonly code: 1 | 2 = 1) { super(reasonCode); } }
function flag(args: OptimizeArguments, key: string): string { const value = args.flags[key]; if (typeof value !== 'string' || !value) throw new ServiceError('optimization-invalid-arguments', 2); return value; }
function optionalFlag(args: OptimizeArguments, key: string): string | undefined { return args.flags[key] === undefined ? undefined : flag(args, key); }
function emit(args: OptimizeArguments, io: CliIo, status: string, reasonCode: string, nextCommand: string): void {
  const result = { status, reasonCode, nextCommand };
  io.stdout(args.format === 'json' ? `${JSON.stringify(result)}\n` : `${status}: ${reasonCode}\nNext: ${nextCommand}\n`);
}
function missing(error: unknown): boolean { return (error as NodeJS.ErrnoException).code === 'ENOENT'; }
function shellQuote(value: string): string { return `'${value.replace(/'/g, "'\\''")}'`; }
async function optionalJson(path: string): Promise<unknown | null> { try { return await readPrivateJson(path); } catch (error) { if (missing(error)) return null; throw error; } }
async function moduleSourceIdentity(): Promise<{ toolSourceSha: string; bundleDigest: string }> {
  const path = fileURLToPath(import.meta.url);
  const toolSourceSha = typeof CIRUJANO_TOOL_SOURCE_SHA !== 'undefined' && CIRUJANO_TOOL_SOURCE_SHA ? CIRUJANO_TOOL_SOURCE_SHA : (await promisify(execFileCallback)('git', ['-C', dirname(path), 'rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 10000, maxBuffer: 1024 })).stdout.trim();
  return { toolSourceSha, bundleDigest: sha256(await readFile(path)) };
}

/** Commands retain private local state; all outward effects require typed permits. */
export function createOptimizationService(options: OptimizationServiceOptions = {}): OptimizationService {
  return { async run(args, io) {
    const apiKey = options.apiKey ?? process.env['NEBIUS_API_KEY']; const secrets = apiKey ? [apiKey] : [];
    const originalIo = io;
    io = { stdout: text => originalIo.stdout(String(scrubOptimizationValue(text, secrets))), stderr: text => originalIo.stderr(String(scrubOptimizationValue(text, secrets))) };
    const statusCommand = `cirujano optimize status --operation ${shellQuote(typeof args.flags.output === 'string' ? args.flags.output : typeof args.flags.operation === 'string' ? args.flags.operation : '<operation>')} --format ${args.format}`;
    try {
      if (args.action === 'propose') return await runPropose(args, io);
      if (args.action === 'collect') {
        const output = flag(args, 'output'); const rawRuns = args.flags.run;
        if (!Array.isArray(rawRuns) || rawRuns.some(run => !/^[1-9]\d*$/.test(run))) throw new ServiceError('optimization-invalid-arguments', 2);
        const identity = options.toolSourceSha && options.bundleDigest ? { toolSourceSha: options.toolSourceSha, bundleDigest: options.bundleDigest } : await (options.sourceIdentity ?? moduleSourceIdentity)();
        const result = await collectGitHubInput({ repository: flag(args, 'repository'), ref: flag(args, 'ref'), workflow: flag(args, 'workflow'), job: flag(args, 'job'), runs: rawRuns.map(Number) }, { ...options, ...identity });
        if (canonicalJson(scrubOptimizationValue(result.input, secrets)) !== canonicalJson(result.input)) throw new ServiceError('collected-input-scrubbed');
        await withOperationStore(output, async store => {
          await store.writeText('source.json', canonicalJson(result.source));
          await store.writeJson('action-receipt.json', result.receipt);
          await store.writeArtifact('input', result.input);
          await store.writeJson('collection-receipt.json', { schemaVersion: 1, kind: 'collection-receipt', inputDigest: jsonDigest(result.input), sourceManifestDigest: jsonDigest(result.source), actionReceiptDigest: jsonDigest(result.receipt) });
          const state: OperationState = { schemaVersion: 1, kind: 'optimization-operation', action: 'collect', status: result.input.status, reasonCode: result.reasonCode, nextCommand: `cirujano optimize diagnose --input ${shellQuote(join(output, 'input.json'))} --config <config.json> --output <diagnosis-operation>`, inputDigest: jsonDigest(result.input) };
          await store.writeJson('operation.json', state); emit(args, io, state.status, state.reasonCode, state.nextCommand);
        }); return 0;
      }
      if (args.action === 'diagnose') {
        const { input, source, receipt, collectionReceipt } = await readRetainedOptimizationContext(flag(args, 'input')), output = flag(args, 'output');
        let config: unknown;
        try { config = decodeInferenceConfig(await readPrivateJson(flag(args, 'config'))); } catch { throw new ServiceError('invalid-inference-config', 2); }
        const permitPath = optionalFlag(args, 'permit'); const permit = permitPath ? await readPrivateJson(permitPath) : undefined;
        return await withOperationStore(output, async store => {
          if (await optionalJson(join(output, 'intent.json')) !== null) { emit(args, io, 'outcome-unknown', 'existing-inference-intent', statusCommand); return 1; }
          if (await optionalJson(join(output, 'operation.json')) !== null) throw new ServiceError('operation-already-exists');
          await store.writeText('source.json', canonicalJson(source)); await store.writeJson('action-receipt.json', receipt); await store.writeArtifact('input', input); await store.writeJson('collection-receipt.json', collectionReceipt); await store.writeJson('config.json', config);
          let recordedIntent: InferenceIntent | undefined;
          const result = await diagnoseOptimization(input, config, permit, { ...(options.fetch ? { fetch: options.fetch } : {}), ...(apiKey ? { apiKey } : {}), beforePost: async intent => {
            await store.writeJson('intent.json', { ...intent, status: 'intent' }, { secrets });
            recordedIntent = intent;
            await consumePermit({ kind: 'inference', digest: intent.permitDigest, operation: intent.attemptId, maximum: 1, ...(options.permitLedger ? { ledger: options.permitLedger } : {}) });
          } });
          if (result.preview) await store.writeJson('request-preview.json', result.preview);
          if (result.inference) {
            if (canonicalJson(scrubOptimizationValue(result.inference, secrets)) !== canonicalJson(result.inference)) throw new ServiceError('receipt-scrubbed');
            await store.writeArtifact('inference', result.inference, secrets);
          }
          if (result.diagnosis) {
            if (canonicalJson(scrubOptimizationValue(result.diagnosis, secrets)) !== canonicalJson(result.diagnosis)) throw new ServiceError('diagnosis-scrubbed');
            await store.writeArtifact('diagnosis', result.diagnosis, secrets);
          }
          if (recordedIntent) await store.writeJson('intent.json', { ...recordedIntent, status: result.status, reasonCode: result.reasonCode, inferenceReceiptDigest: result.inference ? jsonDigest(result.inference) : null, diagnosisDigest: result.diagnosis ? jsonDigest(result.diagnosis) : null }, { replaceIntent: true });
          const state: OperationState = { schemaVersion: 1, kind: 'optimization-operation', action: 'diagnose', status: result.status, reasonCode: result.reasonCode, nextCommand: result.nextCommand, inputDigest: jsonDigest(input) };
          await store.writeJson('operation.json', state); emit(args, io, state.status, state.reasonCode, state.nextCommand);
          return ['failed', 'outcome-unknown', 'unsupported'].includes(result.status) ? 1 : 0;
        });
      }
      if (args.action === 'status') {
        const directory = flag(args, 'operation'), intent = await optionalJson(join(directory, 'intent.json')), raw = await optionalJson(join(directory, 'operation.json'));
        if (raw === null) {
          const local = await optionalJson(join(directory,'local-stage.json'));
          if(local !== null && intent === null) {
            if(!local || typeof local!=='object' || Array.isArray(local) || canonicalJson(Object.keys(local).sort())!==canonicalJson(['schemaVersion','kind','status','inputDigest'].sort()) || (local as {schemaVersion?:unknown}).schemaVersion!==1 || (local as {kind?:unknown}).kind!=='proposal-stage' || (local as {status?:unknown}).status!=='local-only' || typeof (local as {inputDigest?:unknown}).inputDigest!=='string' || !/^[a-f0-9]{64}$/.test(String((local as {inputDigest?:unknown}).inputDigest))) throw new ServiceError('operation-state-invalid');
            emit(args,io,'failed','interrupted-local-proposal','cirujano --help');return 1;
          }
          emit(args, io, intent === null ? 'failed' : 'outcome-unknown', intent === null ? 'operation-not-found' : 'incomplete-inference-intent', statusCommand); return 1;
        }
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ServiceError('operation-state-invalid');
        if ((raw as {action?:unknown}).action === 'propose') { const state = await readProposalStatus(directory); emit(args,io,state.status,state.reasonCode,state.nextCommand); return 0; }
        const state = raw as OperationState;
        if (state.schemaVersion !== 1 || state.kind !== 'optimization-operation' || Object.keys(state).sort().join(',') !== ['action', 'inputDigest', 'kind', 'nextCommand', 'reasonCode', 'schemaVersion', 'status'].sort().join(',') || !['collect', 'diagnose'].includes(state.action) || !['collected', 'not-run', 'proposal', 'abstain', 'failed', 'outcome-unknown', 'no-change', 'unsupported'].includes(state.status) || typeof state.reasonCode !== 'string' || !/^[a-z][a-z0-9-]{0,100}$/.test(state.reasonCode) || typeof state.nextCommand !== 'string' || (state.nextCommand !== 'cirujano --help' && !state.nextCommand.startsWith('cirujano optimize ')) || state.nextCommand.length > 4096 || /[\u0000-\u001f\u007f]/.test(state.nextCommand) || (state.inputDigest !== null && !/^[a-f0-9]{64}$/.test(state.inputDigest))) throw new ServiceError('operation-state-invalid');
        const { input } = await readRetainedOptimizationContext(join(directory, 'input.json'));
        if (jsonDigest(input) !== state.inputDigest || (state.action === 'collect' && state.status !== input.status)) throw new ServiceError('operation-state-invalid');
        if ((state.status === 'no-change' && input.status !== 'no-change') || (state.status === 'unsupported' && input.status !== 'unsupported')) throw new ServiceError('operation-state-invalid');
        if (state.status === 'not-run') {
          const preview = decodeInferencePreview(await readPrivateJson(join(directory, 'request-preview.json'))), config = decodeInferenceConfig(await readPrivateJson(join(directory, 'config.json')));
          const expected = await diagnoseOptimization(input, config, undefined);
          if (preview.inputDigest !== state.inputDigest || !expected.preview || canonicalJson(preview) !== canonicalJson(expected.preview)) throw new ServiceError('operation-state-invalid');
        }
        if (state.status === 'proposal' || state.status === 'abstain') {
          const diagnosisContext=await readDiagnosisContext(join(directory,'input.json'),join(directory,'diagnosis.json'));
          if(diagnosisContext.diagnosis.status!==state.status) throw new ServiceError('operation-state-invalid');
        }
        emit(args, io, state.status, state.reasonCode, state.nextCommand); return ['failed', 'outcome-unknown', 'unsupported'].includes(state.status) ? 1 : 0;
      }
      emit(args, io, 'failed', 'optimize-stage-unavailable', 'cirujano --help'); return 1;
    } catch (error) {
      const reasonCode = error instanceof RetainedInputError ? 'retained-input-invalid' : error instanceof ServiceError ? error.reasonCode : error instanceof Error && /^(?:permit-exhausted|optimization-symlink|artifact-exists|controller-lock)/.test(error.message) ? error.message.split(':')[0]! : 'optimization-operation-failed';
      emit(args, io, 'failed', reasonCode, statusCommand); return error instanceof ServiceError ? error.code : 1;
    }
  } };
}
