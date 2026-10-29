import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonicalJson, jsonDigest, sha256 } from '@cirujano/core';
import { evidenceFixture } from './fixture.js';
import { prepareOperation } from './prepare.js';
import { permitTemplate } from './permit.js';
import { numericShadowPolicy, prepareNumericJev } from './numeric-shadow.js';

interface Metric {value:number|null;numerator:number;denominator:number;interval95:[number|null,number|null]}
interface LabelScore {precision:Metric;recall:Metric;referenceIntegrity:Metric;unsupportedClaims:number;unauthorizedEffects:number;abstentions:number;cases:number;statusAgreement:Metric;abstentionCorrectness:Metric}
interface SearchScore {precisionAt3:Metric;falseAnswerRate:Metric;referenceIntegrity:Metric;unsupportedClaims:number;unauthorizedEffects:number;cases:number}
interface Tool {
 scoreLabels(gold:unknown[],predictions:unknown[]):LabelScore;
 scoreSearch(gold:unknown[],predictions:unknown[]):SearchScore;
 qualifyFeatures(input:unknown):{labels:{status:string;reasonCodes:string[]};search:{status:string;reasonCodes:string[]}};
 assertResultBinding(result:unknown,entry:unknown):void;
 validateExperiment(value:unknown):void;
 verifyFrozenCorpus(directory:string):Promise<unknown>;
 runSequentialRequests(entries:unknown[],invoke:(entry:unknown)=>Promise<unknown>,save:(rows:unknown[])=>Promise<void>):Promise<{status:string;results:unknown[]}>;
 accountRequests(results:unknown[],mode:string):{nativeInferenceCalls:number|null;confirmedNativeInferenceCallsLowerBound:number;unknownInferenceAttemptCount:number};
 performanceForPopulation(requests:unknown[],results:unknown[],caseIds:string[],usefulDisplayedCards:number):{costsUsd:(number|null)[];complete:boolean;requestCount:number;usefulDisplayedCards:number};
 bootstrapRatio(rows:{numerator:number;denominator:number}[]):Metric;
}
const moduleUrl=pathToFileURL(join(process.cwd(),'../../scripts/advisory/evaluation-metrics.mjs')).href;
const tool=await import(moduleUrl) as Tool;
const roots:string[]=[];afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
const metrics={durationMs:120000,roundedMinutes:2,githubHostedChargeUsd:0};
const unitSearchCards=Object.fromEntries(['e1','e2','e3'].map(id=>[id,{inputDigest:'unit-frozen',metrics,automation:'advisory-only'}]));
const unitHit=(evidenceId:string)=>({evidenceId,...unitSearchCards[evidenceId]!});
const gold=[{id:'case',expected:{status:'supported',labels:['install'],acceptableEvidenceIds:['e001'],metrics,automation:'advisory-only'}}];
const prediction=(category='install',evidenceId='e001')=>[{id:'case',labels:[{category,evidenceId}],candidateIds:['e001'],metrics,automation:'advisory-only',unsupportedClaims:[],effects:[]}];
it('scores incorrect labels, fabricated references and missing answers as failures',()=>{
 const correct=tool.scoreLabels(gold,prediction());expect(correct.precision.value).toBe(1);expect(correct.recall.value).toBe(1);
 const wrong=tool.scoreLabels(gold,prediction('build'));expect(wrong.precision.value).toBe(0);expect(wrong.recall.value).toBe(0);
 const fabricated=tool.scoreLabels(gold,prediction('install','invented'));expect(fabricated.referenceIntegrity.value).toBe(0);expect(fabricated.precision.value).toBe(0);
 expect(tool.scoreLabels(gold,[]).recall.value).toBe(0);
});
it('refuses numerical or authority changes independently of label quality',()=>{
 const changed=prediction();changed[0]!.metrics={...metrics,durationMs:0};expect(()=>tool.scoreLabels(gold,changed)).toThrow('evaluation-numeric-invariant');
 const authority={...prediction()[0],automation:'permission-to-edit'};expect(()=>tool.scoreLabels(gold,[authority])).toThrow('evaluation-authority-invariant');
});
it('uses all 54 held-out search slots and counts omitted slots incorrect',()=>{
 const queries=Array.from({length:24},(_,i)=>({id:`q${i}`,expected:{status:i<18?'supported':'no-match',relevantCandidateIds:i<18?['e1','e2','e3']:[],cards:unitSearchCards}}));
 const predictions=queries.map((q,i)=>({id:q.id,hits:i<18?['e1','e2','e3']:[],hitCards:i<18?['e1','e2','e3'].map(unitHit):[],candidateIds:['e1','e2','e3'],unsupportedClaims:[],effects:[]}));
 const complete=tool.scoreSearch(queries,predictions);expect(complete.precisionAt3.denominator).toBe(54);expect(complete.precisionAt3.value).toBe(1);
 predictions[0]!.hits.pop();predictions[0]!.hitCards.pop();expect(tool.scoreSearch(queries,predictions).precisionAt3.value).toBe(53/54);
 predictions[18]!.hits=['e1'];predictions[18]!.hitCards=[unitHit('e1')];expect(tool.scoreSearch(queries,predictions).falseAnswerRate.value).toBe(1/6);
});
it('never qualifies replay or unknown cost and enforces ceiling-aware search review',()=>{
 const labels=tool.scoreLabels(gold,prediction()),search=tool.scoreSearch([{id:'q',expected:{status:'supported',relevantCandidateIds:['e1','e2','e3'],cards:unitSearchCards}},{id:'none',expected:{status:'no-match',relevantCandidateIds:[],cards:unitSearchCards}}],[{id:'q',hits:['e1','e2','e3'],hitCards:['e1','e2','e3'].map(unitHit),candidateIds:['e1','e2','e3'],unsupportedClaims:[],effects:[]},{id:'none',hits:[],hitCards:[],candidateIds:[],unsupportedClaims:[],effects:[]}]);
 const input={mode:'native',labels,search,baselineSearch:search,requestLatenciesMs:[1,2,3],costsUsd:[0.0001,0.0001,0.0001],usefulDisplayedCards:1};
 expect(tool.qualifyFeatures({...input,mode:'replay'}).labels.status).toBe('UNMEASURED');
 expect(tool.qualifyFeatures({...input,costsUsd:[null]}).labels.status).toBe('NOT QUALIFIED');
 expect(tool.qualifyFeatures(input).search.reasonCodes).toContain('blinded-review-required');
 expect(tool.qualifyFeatures({...input,blindedReview:{blinded:true,paired:true,reviewer:'independent-unit-reviewer',recordedAt:'2026-10-28T10:00:00Z',pairs:[{taskId:'q',baselineMs:1000,candidateMs:800}]}}).search.status).toBe('QUALIFIED');
 expect(tool.qualifyFeatures({...input,requestLatenciesMs:[6000]}).labels.reasonCodes).toContain('latency-gate');
});
it('binds predictions to exact input, model, request, result and policy versions',()=>{
 const entry={model:'jev-1.14.0',requestHash:'a'.repeat(64),inputDigests:['b'.repeat(64)],questionSetVersion:'v1',policyVersion:'p1'};const result={...entry,payload:{labels:[]},resultHash:jsonDigest({labels:[]})};
 expect(()=>tool.assertResultBinding(result,entry)).not.toThrow();
 for(const key of ['model','requestHash','inputDigests','questionSetVersion','policyVersion','resultHash']){const changed={...result,[key]:key==='inputDigests'?['c'.repeat(64)]:'drift'};expect(()=>tool.assertResultBinding(changed,entry)).toThrow('evaluation-result-binding');}
});
it('refuses combined request/spend cap overruns and mutation of the proposal',()=>{
 const content={schemaVersion:1,kind:'advisory-live-experiment-proposal',requestCap:200,estimatedAllowanceUsd:1,requests:[{id:'r',estimatedReservationUsd:0.001}],estimatedTotalUsd:0.001};
 const manifest={...content,digest:jsonDigest(content)};expect(()=>tool.validateExperiment(manifest)).not.toThrow();
 const many={...content,requests:Array.from({length:201},(_,i)=>({id:`r${i}`,estimatedReservationUsd:0})),estimatedTotalUsd:0};expect(()=>tool.validateExperiment({...many,digest:jsonDigest(many)})).toThrow('evaluation-request-cap');
 const costly={...content,requests:[{id:'r',estimatedReservationUsd:2}],estimatedTotalUsd:2};expect(()=>tool.validateExperiment({...costly,digest:jsonDigest(costly)})).toThrow('evaluation-budget-cap');
 expect(()=>tool.validateExperiment({...manifest,estimatedTotalUsd:0})).toThrow('evaluation-experiment-digest');
});
it('validates immutable corpus bytes and refuses a changed label file',async()=>{
 const root=await mkdtemp(join(tmpdir(),'advisory-eval-freeze-'));roots.push(root);const bytes='{"cases":[]}\n';await writeFile(join(root,'corpus.json'),bytes);
 const content={schemaVersion:1,kind:'advisory-evaluation-freeze',name:'unit-test',files:[{path:'corpus.json',sha256:sha256(bytes),bytes:Buffer.byteLength(bytes)}]};await writeFile(join(root,'freeze.json'),canonicalJson({...content,digest:jsonDigest(content)}));
 await expect(tool.verifyFrozenCorpus(root)).resolves.toBeDefined();await writeFile(join(root,'corpus.json'),'{}');await expect(tool.verifyFrozenCorpus(root)).rejects.toThrow('evaluation-corpus-drift');
});
it('stops the sequential orchestration after an unknown outcome or crash',async()=>{
 for(const crash of [false,true]){const sends:unknown[]=[];const result=await tool.runSequentialRequests([{id:'a'},{id:'b'}],async(entry)=>{sends.push(entry);if(crash)throw new Error('child-crash');return {status:'outcome-unknown'};},async()=>{});expect(sends).toHaveLength(1);expect(result.status).toBe('outcome-unknown');expect(result.results).toHaveLength(2);}
});
it('reports reproducible denominators and bootstrap intervals',()=>{
 const rows=[{numerator:1,denominator:1},{numerator:0,denominator:1}];const first=tool.bootstrapRatio(rows);expect(first).toEqual(tool.bootstrapRatio(rows));expect(first.interval95[0]).toBeLessThanOrEqual(0.5);expect(first.interval95[1]).toBeGreaterThanOrEqual(0.5);
});
it('keeps numerical materiality experiments pure and distinct from optimizer diagnosis',async()=>{
 const seed=JSON.parse(await readFile(new URL('../../../core/fixtures/optimization/manifest.json',import.meta.url),'utf8')) as {provenance:Record<string,unknown>};
 const input={status:'collected',baselines:[{elapsedMs:120000,installElapsedMs:60000}],structuralFacts:{},provenance:seed.provenance};
 expect(numericShadowPolicy(input)).toMatchObject({policyVersion:'numeric-shadow-v1',decision:'proposal'});
 expect(numericShadowPolicy({...input,baselines:[{elapsedMs:120000,installElapsedMs:5000}]}).decision).toBe('abstain');
 const prepared=prepareNumericJev(input);expect(prepared.kind).toBe('advisory-numeric-shadow-request');expect(prepared.body.questions.material?.type).toBe('noul');expect(prepared).not.toHaveProperty('diagnosis');
});

it('aligns held-out native performance numerator and useful-card denominator',()=>{
 const requests=[{id:'dev',caseId:'development'},{id:'held',caseId:'holdout'}],results=[{id:'dev',status:'completed',latencyMs:9000,costUsd:0.9},{id:'held',status:'completed',latencyMs:100,costUsd:0.0001}];
 const population=tool.performanceForPopulation(requests,results,['holdout'],1);expect(population.requestCount).toBe(1);expect(population.costsUsd).toEqual([0.0001]);expect(population.usefulDisplayedCards).toBe(1);expect(population.complete).toBe(true);
 expect(tool.performanceForPopulation(requests,results.slice(0,1),['holdout'],1).complete).toBe(false);
});
it('retains unknown POST accounting after a real private-worker crash without sending later entries',async()=>{
 const entrypoint=pathToFileURL(join(process.cwd(),'../../scripts/advisory/evaluate.mjs')).href;
 const runtime=await import(entrypoint) as {buildEvaluationWorker(directory:string):Promise<string>;invokeEvaluationWorker(worker:string,control:unknown,directory:string):Promise<Record<string,unknown>>};
 const root=await mkdtemp(join(tmpdir(),'advisory-eval-worker-'));roots.push(root);const worker=await runtime.buildEvaluationWorker(join(root,'worker'));
 const prepared=await prepareOperation([evidenceFixture()],'labels',null,join(root,'prepared')),permit={...permitTemplate(prepared,new Date()),kind:'jev-advisory-permit',payloadReviewed:true,permitId:'evaluation-worker-crash-permit',expiresAt:'2099-01-01T00:00:00Z'};
 const entries=[{id:'first'},{id:'never'}],seen:string[]=[];
 const execution=await tool.runSequentialRequests(entries,async(entry)=>{const item=entry as {id:string};seen.push(item.id);return runtime.invokeEvaluationWorker(worker,{action:'execute-advisory',request:prepared,requestDirectory:join(root,'prepared'),permit,output:join(root,item.id),mode:'replay',replay:{crash:'after-intent'},replayLedger:join(root,'ledger')},join(root,'controls'));},async()=>{});
 expect(seen).toEqual(['first']);expect(execution.status).toBe('outcome-unknown');await expect(readFile(join(root,'first','intent.json'),'utf8')).resolves.toContain('jev-advisory-intent');await expect(readFile(join(root,'never','intent.json'),'utf8')).rejects.toThrow();
 const accounting=tool.accountRequests(execution.results,'native');expect(accounting.nativeInferenceCalls).toBeNull();expect(accounting.confirmedNativeInferenceCallsLowerBound).toBe(0);expect(accounting.unknownInferenceAttemptCount).toBe(1);expect(tool.accountRequests(execution.results,'replay').nativeInferenceCalls).toBe(0);
});
it('refuses a real worker request-directory/metadata mismatch before reservation or POST',async()=>{
 const entrypoint=pathToFileURL(join(process.cwd(),'../../scripts/advisory/evaluate.mjs')).href;
 const runtime=await import(entrypoint) as {buildEvaluationWorker(directory:string):Promise<string>;invokeEvaluationWorker(worker:string,control:unknown,directory:string):Promise<Record<string,unknown>>};
 const root=await mkdtemp(join(tmpdir(),'advisory-eval-mismatch-'));roots.push(root);const worker=await runtime.buildEvaluationWorker(join(root,'worker'));
 const prepared=await prepareOperation([evidenceFixture()],'labels',null,join(root,'prepared')),permit={...permitTemplate(prepared,new Date()),kind:'jev-advisory-permit',payloadReviewed:true,permitId:'evaluation-worker-mismatch-permit',expiresAt:'2099-01-01T00:00:00Z'};
 await expect(runtime.invokeEvaluationWorker(worker,{action:'execute-advisory',request:{...prepared,inputDigests:['0'.repeat(64)]},requestDirectory:join(root,'prepared'),permit,output:join(root,'out'),mode:'replay',replay:{response:{}},replayLedger:join(root,'ledger')},join(root,'controls'))).rejects.toThrow();
 await expect(readFile(join(root,'out','intent.json'),'utf8')).rejects.toThrow();await expect(readFile(join(root,'ledger',`inference-${jsonDigest({namespace:'cirujano-jev-advisory-permit-v1',permitId:permit.permitId})}.json`),'utf8')).rejects.toThrow();
});
it('checks displayed search cards against frozen numerical and automation oracles',()=>{
 const query=[{id:'q',expected:{status:'supported',relevantCandidateIds:['e1'],cards:{e1:{inputDigest:'frozen',metrics,automation:'advisory-only'}}}}];
 const entry={id:'q',hits:['e1'],candidateIds:['e1'],hitCards:[{evidenceId:'e1',inputDigest:'frozen',metrics:{...metrics,durationMs:0},automation:'advisory-only'}],unsupportedClaims:[],effects:[]};
 expect(()=>tool.scoreSearch(query,[entry])).toThrow('evaluation-numeric-invariant');
 entry.hitCards[0]!.metrics=metrics;entry.hitCards[0]!.automation='permission-to-edit';expect(()=>tool.scoreSearch(query,[entry])).toThrow('evaluation-authority-invariant');
});

it('distinguishes confident absence from correct uncertainty without adding qualification thresholds',()=>{
 const uncertain=[{...gold[0],expected:{...gold[0]!.expected,status:'uncertain',labels:[],acceptableEvidenceIds:[]}}];
 const base={...prediction()[0],labels:[],semanticOutcome:'no-match'};
 expect(tool.scoreLabels(uncertain,[base]).statusAgreement.value).toBe(0);expect(tool.scoreLabels(uncertain,[base]).abstentionCorrectness.value).toBe(0);
 expect(tool.scoreLabels(uncertain,[{...base,semanticOutcome:'uncertain'}]).statusAgreement.value).toBe(1);expect(tool.scoreLabels(uncertain,[{...base,semanticOutcome:'uncertain'}]).abstentionCorrectness.value).toBe(1);
});
it('refuses a mutated lexical baseline before authorization or any worker send',async()=>{
 const entrypoint=pathToFileURL(join(process.cwd(),'../../scripts/advisory/evaluate.mjs')).href;
 const runtime=await import(entrypoint) as {validateBoundBaseline(experiment:unknown,base:string):Promise<unknown>;executeEvaluation(options:unknown):Promise<unknown>};
 const root=await mkdtemp(join(tmpdir(),'advisory-eval-baseline-'));roots.push(root);const bytes='{}';await writeFile(join(root,'corpus.json'),bytes);
 const freezeContent={schemaVersion:1,kind:'advisory-evaluation-freeze',name:'mutation-test',files:[{path:'corpus.json',bytes:2,sha256:sha256(bytes)}]},freeze={...freezeContent,digest:jsonDigest(freezeContent)};await writeFile(join(root,'freeze.json'),canonicalJson(freeze));
 const predictions={labels:[],search:[]};await writeFile(join(root,'local-predictions.json'),canonicalJson(predictions));
 const baseline={kind:'advisory-baseline-results',corpusDigest:freeze.digest,codeIdentity:{test:true},predictionsDigest:jsonDigest(predictions),search:{holdout:{precisionAt3:{value:0.9}}}};await writeFile(join(root,'baseline-results.json'),canonicalJson(baseline));
 const content={schemaVersion:1,kind:'advisory-live-experiment-proposal',requestCap:200,estimatedAllowanceUsd:1,requests:[],estimatedTotalUsd:0,corpusRoot:root,corpusDigest:freeze.digest,codeIdentity:{test:true},baselineBinding:{path:'baseline-results.json',sha256:sha256(canonicalJson(baseline)),predictionsPath:'local-predictions.json',predictionsSha256:sha256(canonicalJson(predictions))}},experiment={...content,digest:jsonDigest(content)};
 await expect(runtime.validateBoundBaseline(experiment,root)).resolves.toBeDefined();await writeFile(join(root,'experiment.json'),canonicalJson(experiment));await writeFile(join(root,'baseline-results.json'),canonicalJson({...baseline,search:{holdout:{precisionAt3:{value:0}}}}));
 await expect(runtime.executeEvaluation({experiment:join(root,'experiment.json'),output:join(root,'never-created'),authorization:'missing',permits:'missing',live:true})).rejects.toThrow('evaluation-baseline-drift');await expect(readFile(join(root,'never-created','execution.json'),'utf8')).rejects.toThrow();
});
it('preflights every exact permit binding before batch authority is reserved',async()=>{
 const entrypoint=pathToFileURL(join(process.cwd(),'../../scripts/advisory/evaluate.mjs')).href;
 const runtime=await import(entrypoint) as {validateAuthorization(authorization:unknown,batch:unknown,experiment:unknown):void};
 const request={id:'jev',provider:'typesafe',model:'jev-1.14.0',endpoint:'https://api.typesafe.ai/v1/systemone',requestHash:'a'.repeat(64),requestBytes:1000,estimatedReservationUsd:0.001,priceQuote:{source:'https://docs.typesafe.ai/models',date:'2026-10-28'}};
 const experiment={digest:'e'.repeat(64),requests:[request,{...request,id:'second'}]};
 const permit={schemaVersion:1,kind:'jev-advisory-permit',payloadReviewed:true,permitId:'unit-jev-permit-1',requestHash:request.requestHash,model:request.model,endpoint:request.endpoint,expiresAt:'2099-01-01T00:00:00Z',maxRequests:1,maxRequestBytes:1000,approvedEstimatedSpendUsd:0.001,priceSource:request.priceQuote.source,priceDate:request.priceQuote.date};
 const batch={schemaVersion:1,kind:'advisory-evaluation-permit-batch',experimentDigest:experiment.digest,permits:[{id:'jev',permit},{id:'second',permit:{...permit,permitId:'unit-jev-permit-2'}}]};
 const authorization=(value:unknown)=>({schemaVersion:1,kind:'advisory-evaluation-authorization',payloadReviewed:true,acceptEstimateUncertainty:true,experimentDigest:experiment.digest,permitBatchDigest:jsonDigest(value),maxRequests:2,estimatedAllowanceUsd:1,expiresAt:'2099-01-01T00:00:00Z'});
 expect(()=>runtime.validateAuthorization(authorization(batch),batch,experiment)).not.toThrow();
 for(const mismatch of [{requestHash:'b'.repeat(64)},{maxRequestBytes:999},{approvedEstimatedSpendUsd:0},{expiresAt:'invalid'}]){const changed={...batch,permits:[batch.permits[0],{...batch.permits[1],permit:{...batch.permits[1]!.permit,...mismatch}}]};expect(()=>runtime.validateAuthorization(authorization(changed),changed,experiment)).toThrow();}
});
it('keeps native qualification independent across complete feature populations',()=>{
 const labels=tool.scoreLabels(gold,prediction()),queries=[{id:'q',expected:{status:'supported',relevantCandidateIds:['e1','e2','e3'],cards:unitSearchCards}},{id:'none',expected:{status:'no-match',relevantCandidateIds:[],cards:unitSearchCards}}],search=tool.scoreSearch(queries,[{id:'q',hits:['e1','e2','e3'],hitCards:['e1','e2','e3'].map(unitHit),candidateIds:['e1','e2','e3'],unsupportedClaims:[],effects:[]},{id:'none',hits:[],hitCards:[],candidateIds:[],unsupportedClaims:[],effects:[]}]);
 const measured={requestLatenciesMs:[1],costsUsd:[0.0001],usefulDisplayedCards:1};const input={mode:'native',labels,search,baselineSearch:search,executionComplete:false,labelsPerformance:{...measured,complete:false},searchPerformance:{...measured,complete:true},blindedReview:{blinded:true,paired:true,reviewer:'independent-unit-reviewer',recordedAt:'2026-10-28T10:00:00Z',pairs:[{taskId:'q',baselineMs:1000,candidateMs:800}]}};
 const result=tool.qualifyFeatures(input);expect(result.labels.reasonCodes).toContain('incomplete-feature-evaluation');expect(result.search.status).toBe('QUALIFIED');expect(tool.qualifyFeatures({...input,labelsPerformance:{...measured,complete:true}}).labels.status).toBe('QUALIFIED');
});
