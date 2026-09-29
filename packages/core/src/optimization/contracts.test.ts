import { describe, expect, it } from 'vitest';
import { assertSameProvenance, decodeArtifact, decodeProvenance } from './contracts.js';
import { jsonDigest } from './canonical.js';

import { provenance } from './optimization.test-helper.js';
describe('strict artifact provenance', () => {
  it('round trips complete provenance', () => expect(decodeProvenance(provenance)).toEqual(provenance));
  it.each(['repositoryId', 'baseSha', 'workflowHash', 'verificationProfileHash', 'bundleDigest'])('requires %s', (key) => {
    const value: Record<string, unknown> = { ...provenance }; delete value[key];
    expect(() => decodeProvenance(value)).toThrow();
  });
  it('rejects stale identities, extras and unknown schema versions', () => {
    expect(() => assertSameProvenance(provenance, { ...provenance, lockfileHash: '9'.repeat(64) })).toThrow();
    expect(() => decodeProvenance({ ...provenance, extra: true })).toThrow();
    expect(() => decodeArtifact('diagnosis', { schemaVersion: 2 })).toThrow();
  });
  it('binds every diagnosis operation to known evidence and exact target', () => {
    const value = { schemaVersion: 1, kind: 'diagnosis', provenance, status: 'proposal', reason: 'Cache an expensive install', uncertainty: 'No measured saving yet', evidenceIds: ['install:1'], operation: { type: 'enable-pnpm-cache', jobId: 'test', stepIndex: 2 }, promptVersion: '1', schemaVersionId: '1', inferenceReceiptDigest: '3'.repeat(64) };
    expect(decodeArtifact('diagnosis', value)).toEqual(value);
    expect(() => decodeArtifact('diagnosis', { ...value, operation: { ...value.operation, script: 'echo unsafe' } })).toThrow();
    expect(() => decodeArtifact('diagnosis', { ...value, operation: { ...value.operation, jobId: 'other' } })).toThrow();
    expect(() => decodeArtifact('diagnosis', { ...value, evidenceIds: ['install:1', 'install:1'] })).toThrow();
    expect(jsonDigest(value)).not.toBe(jsonDigest({ ...value, reason: 'Changed' }));
  });
});

import type { ArtifactMap, VerificationProfile } from './contracts.js';
import { decodeQualityEvidence, decodeVerificationProfile, validateDiagnosisEvidence } from './contracts.js';
import { sha256 } from './canonical.js';
const timestamp='2026-09-29T00:00:00Z';
const profile:VerificationProfile={ schemaVersion:1, commands:[['pnpm','test']],testReportPath:'test.json',coverageReportPath:'coverage.json',nodeVersion:'22.20.0',pnpmVersion:'10.11.0',timeoutSeconds:600,sourcePaths:['package.json','pnpm-lock.yaml','src/a.ts'] };
const quality={ commandDigest:'a'.repeat(64),tests:[{id:'suite:case',outcome:'passed' as const}],coverage:[{path:'src/a.ts',statements:1,coveredStatements:1,branches:0,coveredBranches:0,functions:1,coveredFunctions:1,lines:1,coveredLines:1}] };
const baseline={runId:1,attempt:1,jobId:1,headSha:provenance.baseSha,conclusion:'success' as const,startedAt:timestamp,completedAt:timestamp,elapsedMs:0,installStepNumber:4,installElapsedMs:0,runnerLabels:['ubuntu-24.04'],runnerImage:'ubuntu24-20260929',requiredChecks:['test']};
const input={schemaVersion:1 as const,kind:'input' as const,provenance,status:'collected' as const,baselines:[baseline],structuralFacts:{nodeVersion:'22.20.0'},evidence:{'install:1':'install timing'},operations:[{type:'enable-pnpm-cache' as const,jobId:'test',stepIndex:2}],requiredChecks:['test']};
const candidate={candidateSha:'4'.repeat(40),patchHash:'5'.repeat(64)};
const artifacts:ArtifactMap={
  input,
  diagnosis:{schemaVersion:1,kind:'diagnosis',provenance,status:'proposal',reason:'cache install',uncertainty:'sample only',evidenceIds:['install:1'],operation:input.operations[0]!,promptVersion:'1',schemaVersionId:'1',inferenceReceiptDigest:'3'.repeat(64)},
  inference:{schemaVersion:1,kind:'inference',provenance,requestedModel:'nvidia/nvidia-nemotron-3-nano-30b-a3b',returnedModel:'nvidia/nvidia-nemotron-3-nano-30b-a3b',endpointHost:'api.tokenfactory.nebius.com',completionId:'completion-1',requestHash:'1'.repeat(64),responseHash:'2'.repeat(64),startedAt:timestamp,completedAt:timestamp,latencyMs:0,finishReason:'stop',usage:{promptTokens:2,completionTokens:3,totalTokens:5},quoteIdentity:null,costStatus:'unavailable',cost:null,status:'completed'},
  proposal:{schemaVersion:1,kind:'proposal',provenance,...candidate,candidateWorkflowHash:'6'.repeat(64),status:'proposed',operation:input.operations[0]!,beforeStructuralDigest:'1'.repeat(64),afterStructuralDigest:'1'.repeat(64),permittedDiff:{cache:'pnpm',cacheDependencyPath:'pnpm-lock.yaml'},preconditions:['root lockfile'],verificationProfile:profile,diagnosisDigest:'2'.repeat(64)},
  sandbox:{schemaVersion:1,kind:'sandbox',provenance,...candidate,proposalDigest:'1'.repeat(64),status:'sandbox-verified',image:{uuid:'01234567-89ab-cdef-0123-456789abcdef',digest:'1'.repeat(64),recipeHash:'2'.repeat(64),manifestHash:'3'.repeat(64)},operations:[{id:'base-1',status:'SUCCESS',role:'base',exitCode:0,signal:null,timedOut:false,truncated:false},{id:'candidate-1',status:'SUCCESS',role:'candidate',exitCode:0,signal:null,timedOut:false,truncated:false}],networkEnabled:false,baseQuality:quality,candidateQuality:quality,startedAt:timestamp,completedAt:timestamp,elapsedMs:0,usage:null,truncated:false,cleanupState:'disposable-confirmed',retainedImage:true},
  measurement:{schemaVersion:1,kind:'measurement',provenance,...candidate,proposalDigest:'1'.repeat(64),sandboxDigest:'2'.repeat(64),cohortDigest:'3'.repeat(64),status:'no-improvement',samples:[],baselineMinutes:0,candidateMinutes:0,baselineMedianMs:0,candidateMedianMs:0,maximumQueueMs:0,maximumEndToEndMs:0,limits:['no live samples'],claimLevel:'none',githubListSavingUsd:0},
  report:{schemaVersion:1,kind:'report',provenance,...candidate,proposalDigest:'1'.repeat(64),sandboxDigest:'2'.repeat(64),measurementDigest:'3'.repeat(64),status:'no-improvement',markdown:'No improvement',markdownHash:sha256('No improvement'),marker:'cirujano-1',baseRef:'develop',headRef:'candidate'},
  publication:{schemaVersion:1,kind:'publication',provenance,...candidate,reportHash:'1'.repeat(64),authorizationDigest:'2'.repeat(64),repository:provenance.repository,baseRef:'develop',headRef:'candidate',baseSha:provenance.baseSha,headSha:candidate.candidateSha,marker:'cirujano-1',status:'published',number:1,url:'https://github.com/public-example/benchmark/pull/1'},
};
describe('all-stage decoders and recovery boundaries',()=>{
  for (const kind of Object.keys(artifacts) as (keyof ArtifactMap)[]) {
    it(`decodes complete ${kind} and rejects extras/missing/version drift`,()=>{
      expect(decodeArtifact(kind,artifacts[kind]).kind).toBe(kind);
      expect(()=>decodeArtifact(kind,{...artifacts[kind],extra:true})).toThrow();
      expect(()=>decodeArtifact(kind,{...artifacts[kind],schemaVersion:99})).toThrow();
      const missing={...artifacts[kind]} as Record<string,unknown>;delete missing.provenance;
      expect(()=>decodeArtifact(kind,missing)).toThrow();
    });
  }
  it('rejects model attacks and unsupported operations independently',()=>{
    validateDiagnosisEvidence(artifacts.diagnosis,input);
    expect(()=>validateDiagnosisEvidence({...artifacts.diagnosis,evidenceIds:['unknown']},input)).toThrow();
    expect(()=>validateDiagnosisEvidence(artifacts.diagnosis,{...input,operations:[]})).toThrow();
    expect(()=>decodeArtifact('diagnosis',{...artifacts.diagnosis,status:'abstain'})).toThrow();
    expect(()=>decodeArtifact('inference',{...artifacts.inference,usage:{promptTokens:1,completionTokens:1,totalTokens:1}})).toThrow();
    expect(()=>decodeArtifact('inference',{...artifacts.inference,costStatus:'known'})).toThrow();
  });
  it('rejects weak quality, incomplete sandbox cleanup and unconfirmed publication',()=>{
    expect(()=>decodeQualityEvidence({...quality,tests:[...quality.tests,...quality.tests]})).toThrow();
    expect(()=>decodeQualityEvidence({...quality,coverage:[{...quality.coverage[0],coveredStatements:2}]})).toThrow();
    expect(()=>decodeArtifact('sandbox',{...artifacts.sandbox,cleanupState:'unknown'})).toThrow();
    expect(()=>decodeArtifact('sandbox',{...artifacts.sandbox,baseQuality:null})).toThrow();
    expect(()=>decodeArtifact('publication',{...artifacts.publication,url:null})).toThrow();
    expect(()=>decodeVerificationProfile({...profile,timeoutSeconds:601})).toThrow();
    expect(()=>decodeVerificationProfile({...profile,commands:[]})).toThrow();
    expect(()=>decodeVerificationProfile({...profile,sourcePaths:['../secret']})).toThrow();
  });
  it('rejects false timestamps, unsafe scalars and negative metrics',()=>{
    expect(()=>decodeArtifact('inference',{...artifacts.inference,startedAt:'2026-02-30T00:00:00Z'})).toThrow();
    expect(()=>decodeArtifact('inference',{...artifacts.inference,latencyMs:-1})).toThrow();
    expect(()=>decodeArtifact('input',{...input,structuralFacts:{unsafe:[]}})).toThrow();
    expect(()=>decodeArtifact('input',{...input,structuralFacts:{unsafe:'\0'}})).toThrow();
  });
});

describe('reviewed immutable success requirements',()=>{
  it('binds proposed candidate workflow bytes before a commit exists',()=>{
    expect(decodeArtifact('proposal',{...artifacts.proposal,candidateWorkflowHash:'6'.repeat(64)})).toHaveProperty('candidateWorkflowHash');
    expect(()=>decodeArtifact('proposal',{...artifacts.proposal,candidateWorkflowHash:'bad'})).toThrow();
  });
  it('requires timed baselines, checks and exactly the provenance-bound operation for collected inputs',()=>{
    expect(()=>decodeArtifact('input',{...input,baselines:[]})).toThrow();
    expect(()=>decodeArtifact('input',{...input,requiredChecks:[]})).toThrow();
    expect(()=>decodeArtifact('input',{...input,operations:[]})).toThrow();
    expect(()=>decodeArtifact('input',{...input,operations:[{...input.operations[0],jobId:'other'}]})).toThrow();
    expect(()=>decodeArtifact('input',{...input,baselines:[{...baseline,requiredChecks:[]}]})).toThrow();
    expect(decodeArtifact('input',{...input,status:'unsupported',operations:[],baselines:[]}).status).toBe('unsupported');
  });
  it('permits an uncommitted proposal and rejects invented downstream candidate identity',()=>{
    expect(decodeArtifact('proposal',{...artifacts.proposal,candidateSha:null}).candidateSha).toBeNull();
    expect(()=>decodeArtifact('sandbox',{...artifacts.sandbox,candidateSha:null})).toThrow();
  });
  it('rejects mismatched baseline source, duplicate attempts and inconsistent timestamps',()=>{
    expect(()=>decodeArtifact('input',{...input,baselines:[{...baseline,headSha:'9'.repeat(40)}]})).toThrow();
    expect(()=>decodeArtifact('input',{...input,baselines:[baseline,baseline]})).toThrow();
    expect(()=>decodeArtifact('input',{...input,baselines:[{...baseline,elapsedMs:1}]})).toThrow();
    expect(()=>decodeArtifact('inference',{...artifacts.inference,latencyMs:1})).toThrow();
  });
  it('requires paired quality, exact versions, model identity and actual report readback',()=>{
    expect(()=>decodeArtifact('sandbox',{...artifacts.sandbox,operations:artifacts.sandbox.operations.map(op=>({...op,role:'base'}))})).toThrow();
    expect(()=>decodeArtifact('sandbox',{...artifacts.sandbox,completedAt:null})).toThrow();
    expect(()=>decodeArtifact('sandbox',{...artifacts.sandbox,baseQuality:{...quality,tests:[]}})).toThrow();
    expect(()=>decodeVerificationProfile({...profile,nodeVersion:'22'})).toThrow();
    expect(()=>decodeArtifact('inference',{...artifacts.inference,returnedModel:'other'})).toThrow();
    expect(()=>decodeArtifact('inference',{...artifacts.inference,finishReason:'length'})).toThrow();
    expect(()=>decodeArtifact('report',{...artifacts.report,markdown:'tamper'})).toThrow();
    expect(()=>decodeArtifact('publication',{...artifacts.publication,number:2})).toThrow();
  });
});

import { decodeActionReceipt, decodeSourceManifest } from './contracts.js';
import { readFileSync } from 'node:fs';
describe('official receipt and exact source manifest',()=>{
  it('requires the independently captured official receipt',()=>{
    const receipt=JSON.parse(readFileSync(new URL('../../fixtures/optimization/setup-node-receipt.json',import.meta.url),'utf8'));
    expect(decodeActionReceipt(receipt).releaseId).toBe(353541365);
    expect(()=>decodeActionReceipt({...receipt,commitSha:'a'.repeat(40)})).toThrow();
    expect(()=>decodeActionReceipt({...receipt,inputs:[]})).toThrow();
  });
  it('binds source bytes, profile, lockfile and sorted tree digest',()=>{
    const files=[{path:provenance.workflowPath,mode:'100644',bytesBase64:Buffer.from('workflow').toString('base64'),hash:sha256('workflow')},{path:'pnpm-lock.yaml',mode:'100644',bytesBase64:Buffer.from('lock').toString('base64'),hash:sha256('lock')},{path:'.cirujano/optimization-profile.json',mode:'100644',bytesBase64:Buffer.from('profile').toString('base64'),hash:sha256('profile')}];
    const tree=files.filter(file=>file.path!==provenance.workflowPath).map(({path,mode,hash})=>({path,mode,hash})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
    const value={schemaVersion:1,provenance:{...provenance,workflowBlobSha:gitBlobSha('workflow'),workflowHash:sha256('workflow'),lockfileHash:sha256('lock'),verificationProfileHash:sha256('profile'),sourceTreeDigest:jsonDigest(tree)},profilePath:'.cirujano/optimization-profile.json',files};
    expect(decodeSourceManifest(value).files).toHaveLength(3);
    expect(()=>decodeSourceManifest({...value,files:files.slice(0,2)})).toThrow();
    expect(()=>decodeSourceManifest({...value,files:files.map(file=>({...file,mode:'120000'}))})).toThrow();
    expect(()=>decodeSourceManifest({...value,files:[{...files[0],bytesBase64:'bad'},...files.slice(1)]})).toThrow();
    expect(()=>decodeSourceManifest({...value,provenance:{...value.provenance,sourceTreeDigest:'1'.repeat(64)}})).toThrow();
  });
});

import { gitBlobSha } from './canonical.js';
it('supports bounded real source bytes and rejects forged Git blobs and credential files',()=>{
  const big='x'.repeat(9000);
  const files=[{path:provenance.workflowPath,mode:'100644',bytesBase64:Buffer.from('workflow').toString('base64'),hash:sha256('workflow')},{path:'pnpm-lock.yaml',mode:'100644',bytesBase64:Buffer.from(big).toString('base64'),hash:sha256(big)},{path:'.cirujano/optimization-profile.json',mode:'100644',bytesBase64:Buffer.from('profile').toString('base64'),hash:sha256('profile')}];
  const tree=files.filter(file=>file.path!==provenance.workflowPath).map(({path,mode,hash})=>({path,mode,hash})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  const value={schemaVersion:1,provenance:{...provenance,workflowBlobSha:gitBlobSha('workflow'),workflowHash:sha256('workflow'),lockfileHash:sha256(big),verificationProfileHash:sha256('profile'),sourceTreeDigest:jsonDigest(tree)},profilePath:'.cirujano/optimization-profile.json',files};
  expect(decodeSourceManifest(value).files[1]?.bytesBase64.length).toBeGreaterThan(8192);
  expect(()=>decodeSourceManifest({...value,provenance:{...value.provenance,workflowBlobSha:'f'.repeat(40)}})).toThrow();
  expect(()=>decodeSourceManifest({...value,files:[...files,{path:'.env',mode:'100644',hash:sha256('a'),bytesBase64:'YQ=='}]})).toThrow();
  const forbidden=[...files,{path:'.git/config',mode:'100644',hash:sha256('a'),bytesBase64:'YQ=='}];
  const forbiddenTree=forbidden.filter(file=>file.path!==provenance.workflowPath).map(({path,mode,hash})=>({path,mode,hash})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  expect(()=>decodeSourceManifest({...value,provenance:{...value.provenance,sourceTreeDigest:jsonDigest(forbiddenTree)},files:forbidden})).toThrow();
});
