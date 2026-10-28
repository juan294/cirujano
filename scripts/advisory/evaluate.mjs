#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, chmod, realpath } from 'node:fs/promises';
import { cpus, totalmem, platform, arch } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { canonicalJson, jsonDigest, parseStrictJson, safeRelativePath, sha256 } from '../../packages/core/dist/index.js';
import { compareNumericOutcomes } from './numeric-comparison.mjs';
import { accountRequests, assertNumericInvariant, assertResultBinding, EVALUATION_VERSION, percentile, performanceForPopulation, qualifyFeatures, runSequentialRequests, scoreLabels, scoreSearch, validateExperiment, verifyFrozenCorpus } from './evaluation-metrics.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url)),cli=join(root,'packages/cli/dist/bin.js'),exec=promisify(execFile),require=createRequire(join(root,'packages/cli/package.json'));
const JEV_MODEL='jev-1.14.0',JEV_ENDPOINT='https://api.typesafe.ai/v1/systemone',NEMOTRON_MODEL='nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B',NEMOTRON_ENDPOINT='https://api.tokenfactory.nebius.com/v1/chat/completions';
const nebiusQuote={source:'https://tokenfactory.nebius.com/api/public/models_info',date:'2026-10-28',inputUsdPerMillion:0.06,outputUsdPerMillion:0.24};
const fail=code=>{throw new Error(code);};
async function json(path,max=16*1024*1024){return parseStrictJson(await readFile(path,'utf8'),max);}
async function save(path,value){await writeFile(path,canonicalJson(value)+'\n',{mode:0o600});}
async function command(args,{parse=true,allowFailure=false}={}){
 try{const result=await exec(process.execPath,args,{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024,timeout:120000});return parse?parseStrictJson(result.stdout,32*1024*1024):result.stdout;}
 catch(error){if(allowFailure)return null;if(error?.killed)fail('evaluation-subprocess-timeout');fail('evaluation-subprocess-failed');}
}
async function dedicatedOutput(path){
 const output=resolve(path),parent=dirname(output),resolved=await realpath(parent);
 const normalized=process.platform==='darwin'?parent.replace(/^\/var(?=\/)/u,'/private/var').replace(/^\/tmp(?=\/)/u,'/private/tmp'):parent;
 if(resolved!==normalized||output===parent)fail('evaluation-unsafe-output');await mkdir(output,{mode:0o700});return output;
}
export async function buildEvaluationWorker(directory){
 await mkdir(directory,{recursive:true,mode:0o700});const output=join(directory,'evaluation-worker.mjs'),{build}=require('esbuild');
 await build({entryPoints:[join(root,'packages/cli/src/advisory/evaluation-runtime.ts')],bundle:true,platform:'node',target:'node22',format:'esm',outfile:output,logLevel:'silent',banner:{js:"import {createRequire} from 'node:module';const require=createRequire(import.meta.url);"}});await chmod(output,0o600);return realpath(output);
}
export async function invokeEvaluationWorker(worker,control,directory){
 await mkdir(directory,{recursive:true,mode:0o700});const path=join(directory,`control-${randomUUID()}.json`);await save(path,control);return command([worker,path]);
}
async function identity(worker){return {evaluatorVersion:EVALUATION_VERSION,cliBundleHash:sha256(await readFile(cli)),workerBundleHash:sha256(await readFile(worker)),evaluatorHash:sha256(await readFile(fileURLToPath(import.meta.url))),metricsHash:sha256(await readFile(join(root,'scripts/advisory/evaluation-metrics.mjs'))),numericComparisonHash:sha256(await readFile(join(root,'scripts/advisory/numeric-comparison.mjs')))};}
function inputs(paths,corpusRoot){return paths.flatMap(path=>['--input',join(corpusRoot,safeRelativePath(path))]);}
function entryMetadata(id,feature,caseId,path,prepared){return {id,feature,caseId,kind:'advisory',provider:'typesafe',model:JEV_MODEL,endpoint:JEV_ENDPOINT,requestHash:prepared.requestHash,requestBytes:prepared.requestBytes,inputDigests:prepared.inputDigests,questionSetVersion:prepared.questionSetVersion,policyVersion:prepared.policyVersion,estimatedReservationUsd:prepared.estimatedReservationUsd,preparedPath:path,requestBodyPath:join(path,'body.json'),requestArtifactPath:join(path,'prepared.json'),maxRequestBytes:32768,maxResponseBytes:262144,deadlineMs:15000,priceQuote:prepared.priceQuote};}
function labelPrediction(item,report,prepared,semantic=false){
 const card=report.payload.cards[0];if(!card||report.payload.cards.length!==1)fail('evaluation-label-card-inventory');
 const labels=semantic?(card.semanticLabels??[]).filter(l=>l.support==='supported').map(l=>({category:l.category,evidenceId:l.excerptId})):card.steps.filter(s=>['install','build','test'].includes(s.category)).map(s=>({category:s.category,evidenceId:prepared?.mapping.find(e=>e.sourceIndex===s.sourceIndex)?.id??'unmapped'}));
 const semanticOutcome=labels.length?'supported':semantic&&(card.semanticLabels??[]).length&&!(card.semanticLabels??[]).some(label=>label.support==='uncertain')?'no-match':'uncertain';
 return {id:item.id,labels,semanticOutcome,candidateIds:prepared?.mapping.map(e=>e.id)??[],metrics:{durationMs:card.durationMs,roundedMinutes:card.roundedMinutes,githubHostedChargeUsd:card.githubHostedChargeUsd},automation:card.automation,unsupportedClaims:[],effects:[],payload:report,resultHash:jsonDigest(report)};
}
function searchPrediction(item,report,prepared){
 const cardOf=hit=>({evidenceId:hit.excerpt.id,inputDigest:hit.card.inputDigest,metrics:{durationMs:hit.card.durationMs,roundedMinutes:hit.card.roundedMinutes,githubHostedChargeUsd:hit.card.githubHostedChargeUsd},automation:hit.card.automation});
 const hitCards=report.payload.hits.map(cardOf),uncertainCards=report.payload.uncertainCandidates.map(cardOf),effects=[...hitCards,...uncertainCards].filter(card=>card.automation!=='advisory-only').map(card=>({evidenceId:card.evidenceId,automation:card.automation}));
 return {id:item.id,hits:report.payload.hits.map(hit=>hit.excerpt.id),candidateIds:prepared.mapping.map(e=>e.id),hitCards,uncertainCards,unsupportedClaims:[],effects,payload:report,resultHash:jsonDigest(report)};
}
async function searchOracle(item,prepared,corpusRoot,cache){
 const key=canonicalJson([...item.inputs].sort());let cards=cache.get(key);if(!cards){const report=await command([cli,'advisory','inbox',...inputs(item.inputs,corpusRoot),'--format','json']);cards=new Map(report.payload.cards.map(card=>[card.inputDigest,card]));cache.set(key,cards);}
 const expected=Object.fromEntries(prepared.mapping.map(excerpt=>{const card=cards.get(excerpt.evidenceDigest);if(!card)fail('evaluation-search-source-card-mismatch');return [excerpt.id,{inputDigest:card.inputDigest,metrics:{durationMs:card.durationMs,roundedMinutes:card.roundedMinutes,githubHostedChargeUsd:card.githubHostedChargeUsd},automation:card.automation}];}));
 return {...item,expected:{...item.expected,cards:expected}};
}
function bySplit(items,predictions,score){return Object.fromEntries(['development','holdout'].map(split=>[split,score(items.filter(i=>i.split===split),predictions.filter(p=>items.some(i=>i.id===p.id&&i.split===split)))]));}
async function prepareAdvisory(id,args,output){
 if(!/^[A-Za-z0-9_-]{1,100}$/u.test(id))fail('evaluation-invalid-case-id');
 const path=join('requests',id);await command([cli,'advisory','prepare',...args,'--output',join(output,path)],{parse:false,allowFailure:true});
 try{return {path,prepared:await json(join(output,path,'prepared.json'),4*1024*1024)};}catch{return null;}
}
function permitTemplates(requests,experimentDigest){
 const expiresAt=new Date(Date.now()+3600000).toISOString();return {schemaVersion:1,kind:'advisory-evaluation-permit-batch-template',experimentDigest,permits:requests.map(entry=>({id:entry.id,permit:entry.provider==='typesafe'?{schemaVersion:1,kind:'jev-advisory-permit-template',payloadReviewed:false,permitId:`eval-${randomUUID()}`,requestHash:entry.requestHash,model:entry.model,endpoint:entry.endpoint,expiresAt,maxRequests:1,maxRequestBytes:entry.requestBytes,approvedEstimatedSpendUsd:entry.estimatedReservationUsd,priceSource:entry.priceQuote.source,priceDate:entry.priceQuote.date}:{schemaVersion:1,kind:'inference-permit-template',permitId:`eval-${randomUUID()}`,repositoryId:entry.repositoryId,inputDigest:entry.inputDigests[0],model:entry.model,endpoint:entry.endpoint,expiresAt,maxRequests:1,maxCompletionTokens:2048,priceBasis:{quoteIdentity:'nebius-public-models-2026-10-28',quotedAt:'2026-10-28T00:00:00Z',source:nebiusQuote.source,currency:'USD',inputUsdPerMillion:0.06,outputUsdPerMillion:0.24,maxCostUsd:entry.estimatedReservationUsd}}}))};
}
async function benchmark(corpusRoot,config){
 if(config.inputs.length!==20)fail('evaluation-benchmark-count');
 const tasks={estimate:[cli,'estimate','--jobs',join(corpusRoot,config.estimateJobs),'--format','json'],inbox:[cli,'advisory','inbox',...inputs(config.inputs,corpusRoot),'--format','json'],search:[cli,'advisory','ask',...inputs(config.inputs,corpusRoot),'--question',config.question,'--format','json'],compare:[cli,'advisory','compare','--baseline',join(corpusRoot,config.baseline),'--candidate',join(corpusRoot,config.candidate),'--format','json']};
 const runs=[];for(let repetition=0;repetition<6;repetition++)for(const [task,args]of Object.entries(tasks)){
  const start=performance.now(),result=await command(args),elapsedMs=performance.now()-start;
  if(task==='estimate'&&result.billableMinutes!==config.expected.roundedMinutes)fail('evaluation-benchmark-numeric-invariant');
  if(task==='compare'&&(result.payload.baseline.medianDurationMs!==config.expected.baselineMedianDurationMs||result.payload.candidate.medianDurationMs!==config.expected.candidateMedianDurationMs))fail('evaluation-benchmark-numeric-invariant');
  if(task==='inbox'&&(result.payload.cards.length!==20||result.payload.cards.reduce((n,c)=>n+c.roundedMinutes,0)!==config.expected.roundedMinutes))fail('evaluation-benchmark-numeric-invariant');
  runs.push({task,repetition,cacheState:repetition===0?'cold-process-first-observation':'warm-process-repeat',elapsedMs,resultHash:jsonDigest(result)});
 }
 return {schemaVersion:1,kind:'advisory-local-benchmark',nativeInferenceCalls:0,bundleCount:20,hardware:{platform:platform(),architecture:arch(),cpu:cpus()[0]?.model??'unavailable',logicalCpus:cpus().length,totalMemoryBytes:totalmem(),node:process.version},limitations:['First cold process observation; operating-system caches were not flushed.','Warm repeats include a fresh CLI subprocess; they do not isolate model latency or establish CI runtime improvement.','Existing estimate is a simpler arithmetic baseline with a smaller evidence contract.'],runs,summary:Object.fromEntries(Object.keys(tasks).map(task=>{const rows=runs.filter(r=>r.task===task);return [task,{coldMs:rows[0].elapsedMs,warmMedianMs:percentile(rows.slice(1).map(r=>r.elapsedMs),0.5),warmP95Ms:percentile(rows.slice(1).map(r=>r.elapsedMs),0.95)}];}))};
}
export async function dryRunEvaluation(outputPath,corpusDirectory){
 const corpusRoot=resolve(corpusDirectory??join(root,'packages/cli/fixtures/advisory/evaluation')),freeze=await verifyFrozenCorpus(corpusRoot),corpus=await json(join(corpusRoot,'corpus.json')),search=await json(join(corpusRoot,'search.json'));
 if(corpus.cases.length!==60||search.queries.length!==36||corpus.cases.filter(c=>c.split==='holdout').length!==36||search.queries.filter(c=>c.split==='holdout'&&c.expected.status==='supported').length!==18||search.queries.filter(c=>c.split==='holdout'&&c.expected.status==='no-match').length!==6)fail('evaluation-corpus-count-drift');
 const developmentFamilies=new Set(corpus.cases.filter(c=>c.split==='development').map(c=>c.family));if(corpus.cases.some(c=>c.split==='holdout'&&developmentFamilies.has(c.family)))fail('evaluation-split-leakage');
 const output=await dedicatedOutput(outputPath);await mkdir(join(output,'requests'),{mode:0o700});const worker=await buildEvaluationWorker(join(output,'.worker')),codeIdentity=await identity(worker),requests=[],labelPredictions=[],searchPredictions=[],dispositions=[],searchGold=[],searchOracleCache=new Map();
 for(const item of corpus.cases){
  const report=await command([cli,'advisory','inbox','--input',join(corpusRoot,item.input),'--format','json']);const prepared=await prepareAdvisory(item.id,['--input',join(corpusRoot,item.input),'--task','labels'],output);
  if(prepared)requests.push(entryMetadata(item.id,'labels',item.id,prepared.path,prepared.prepared));else if(item.id==='label-held-unknown-02')dispositions.push({id:item.id,status:'not-preparable',reasonCode:'projection-no-excerpts',requests:0});else fail('evaluation-unexpected-unpreparable-case');
  const prediction=labelPrediction(item,report,prepared?.prepared);assertNumericInvariant(item.expected.metrics,prediction.metrics);labelPredictions.push(prediction);
 }
 for(const item of search.queries){
  const selected=inputs(item.inputs,corpusRoot),report=await command([cli,'advisory','ask',...selected,'--question',item.question,'--format','json']),prepared=await prepareAdvisory(item.id,[...selected,'--task','search','--question',item.question],output);if(!prepared)fail('evaluation-unpreparable-search');
  requests.push(entryMetadata(item.id,'search',item.id,prepared.path,prepared.prepared));searchGold.push(await searchOracle(item,prepared.prepared,corpusRoot,searchOracleCache));searchPredictions.push(searchPrediction(item,report,prepared.prepared));
 }
 const seeds=await command([join(root,'scripts/optimization/evaluate.mjs'),'--offline']);if(seeds.totalCases!==27||seeds.cases.length!==21||seeds.families['skip-validated-push'].cases.length!==6||seeds.live!==false)fail('evaluation-numeric-seed-drift');await save(join(output,'numeric-seeds.json'),seeds);
 const numerical=[];
 for(const [family,rows]of [['cache',seeds.cases],['push',seeds.families['skip-validated-push'].cases]])for(const row of rows){
  const id=`${family}-${row.name}`,nativeEligible=family==='push'||row.group==='model',prepared=await invokeEvaluationWorker(worker,{action:'prepare-numeric',input:row.input,id,priceQuote:nebiusQuote},join(output,'.controls'));
  numerical.push({id,family,seedInputDigest:jsonDigest(row.input),seedExpectedDiagnosis:row.expectedDiagnosis,seedGroup:row.group,policy:prepared.policy,nativeEligible,nativeJev:'UNMEASURED',nativeNemotron:'UNMEASURED'});
  if(!nativeEligible||!prepared.jev||!prepared.nemotron)continue;
  for(const [provider,request]of [['typesafe',prepared.jev],['nebius',prepared.nemotron]]){
   const requestId=`numeric-${provider}-${id}`,path=join('requests',requestId);await mkdir(join(output,path),{mode:0o700});await save(join(output,path,'request.json'),request);await save(join(output,path,'input.json'),row.input);await writeFile(join(output,path,'body.json'),request.requestBody,{mode:0o600});
   requests.push({id:requestId,feature:'numeric',caseId:id,kind:'numeric',provider,model:request.model,endpoint:request.endpoint,requestHash:request.requestHash,requestBytes:request.requestBytes,inputDigests:request.inputDigests,questionSetVersion:request.questionSetVersion,policyVersion:request.policyVersion,estimatedReservationUsd:request.estimatedReservationUsd,requestArtifactPath:join(path,'request.json'),inputArtifactPath:join(path,'input.json'),requestBodyPath:join(path,'body.json'),repositoryId:row.input.provenance.repositoryId,maxRequestBytes:provider==='typesafe'?32768:65536,maxResponseBytes:262144,deadlineMs:15000,priceQuote:request.priceQuote});
  }
 }
 const predictions={labels:labelPredictions,search:searchPredictions};await save(join(output,'local-predictions.json'),predictions);
 const baselineResults={schemaVersion:1,kind:'advisory-baseline-results',corpusDigest:freeze.digest,codeIdentity,labels:bySplit(corpus.cases,labelPredictions,scoreLabels),search:bySplit(searchGold,searchPredictions,scoreSearch),predictionsDigest:jsonDigest(predictions),numericCases:numerical};await save(join(output,'baseline-results.json'),baselineResults);
 const baselineBinding={path:'baseline-results.json',sha256:sha256(await readFile(join(output,'baseline-results.json'))),predictionsPath:'local-predictions.json',predictionsSha256:sha256(await readFile(join(output,'local-predictions.json')))};
 const content={schemaVersion:1,kind:'advisory-live-experiment-proposal',evaluatorVersion:EVALUATION_VERSION,corpusRoot,corpusDigest:freeze.digest,codeIdentity,baselineBinding,requestCap:200,estimatedAllowanceUsd:1,estimatedTotalUsd:requests.reduce((n,r)=>n+r.estimatedReservationUsd,0),requestCount:requests.length,requests,dispositions,limitations:['Future approval proposal only; no permission or native requests granted.','Estimated token reservation is not a guaranteed provider billing cap. Owner must explicitly accept estimate uncertainty before execution.','No automatic retries, provider fallback, runner actions, workflow edits, publication or diagnosis replacement.','Nemotron model discovery GET is a read preflight, separately disclosed from the single POST reserved per inference permit.']};
 const experiment={...content,digest:jsonDigest(content)};validateExperiment(experiment);await save(join(output,'experiment.json'),experiment);
 const templates=permitTemplates(requests,experiment.digest);await save(join(output,'permit-batch.template.json'),templates);await save(join(output,'authorization.template.json'),{schemaVersion:1,kind:'advisory-evaluation-authorization-template',experimentDigest:experiment.digest,permitBatchDigest:jsonDigest(templates),maxRequests:requests.length,estimatedAllowanceUsd:1,acceptEstimateUncertainty:false,payloadReviewed:false,expiresAt:new Date(Date.now()+3600000).toISOString()});
 const labels=baselineResults.labels,searchScores=baselineResults.search,benchmarkResult=await benchmark(corpusRoot,await json(join(corpusRoot,'benchmark.json')));await save(join(output,'local-predictions.json'),{labels:labelPredictions,search:searchPredictions});await save(join(output,'benchmark.json'),benchmarkResult);
 const numeric=compareNumericOutcomes(numerical,requests,[],'dry-run');
 const report={schemaVersion:1,kind:'advisory-comparative-evaluation',numericComparison:numeric.comparison,evaluatorVersion:EVALUATION_VERSION,mode:'dry-run',live:false,nativeInferenceCalls:0,corpusDigest:freeze.digest,codeIdentity,local:{labels,search:searchScores,benchmark:benchmarkResult},numericShadow:{policyVersion:'numeric-shadow-v1',seedCount:27,cases:numerical,productionDiagnosisChanged:false},native:{jev:'UNMEASURED',nemotron:'UNMEASURED',qualification:qualifyFeatures({mode:'unmeasured'})},cascade:numeric.cascade,experiment:{path:'experiment.json',digest:experiment.digest,requestCount:requests.length,estimatedTotalUsd:experiment.estimatedTotalUsd,estimatedAllowanceUsd:1},limitations:['Rules/lexical scores measure this small independently labeled synthetic corpus, not general usefulness.','95% intervals use 2,000 deterministic bootstrap resamples clustered by case.','Native accuracy, latency, cost and incremental usefulness remain unmeasured. Semantic mode remains opt-in.']};
 await save(join(output,'report.json'),report);return report;
}
async function verifyRequests(experiment,base){
 for(const entry of experiment.requests){if(!/^[A-Za-z0-9_-]{1,100}$/u.test(entry.id))fail('evaluation-invalid-case-id');for(const key of ['requestBodyPath','requestArtifactPath'])safeRelativePath(entry[key]);
  if(entry.kind==='advisory'){safeRelativePath(entry.preparedPath);if(entry.requestArtifactPath!==join(entry.preparedPath,'prepared.json')||entry.requestBodyPath!==join(entry.preparedPath,'body.json'))fail('evaluation-request-directory-mismatch');}
  else{safeRelativePath(entry.inputArtifactPath);if(entry.inputArtifactPath!==join(dirname(entry.requestArtifactPath),'input.json')||entry.requestBodyPath!==join(dirname(entry.requestArtifactPath),'body.json'))fail('evaluation-request-directory-mismatch');}
  const body=await readFile(join(base,entry.requestBodyPath),'utf8'),artifact=await json(join(base,entry.requestArtifactPath));
  if(sha256(body)!==entry.requestHash||Buffer.byteLength(body)!==entry.requestBytes||entry.requestBytes>entry.maxRequestBytes||artifact.requestHash!==entry.requestHash||artifact.requestBody!==body||artifact.model!==entry.model||artifact.estimatedReservationUsd!==entry.estimatedReservationUsd||canonicalJson(artifact.inputDigests)!==canonicalJson(entry.inputDigests)||artifact.questionSetVersion!==entry.questionSetVersion||artifact.policyVersion!==entry.policyVersion)fail('evaluation-request-drift');
  if(entry.maxResponseBytes!==262144||entry.deadlineMs!==15000||entry.maxRequestBytes!==(entry.provider==='typesafe'?32768:65536))fail('evaluation-request-bound-drift');
  if(entry.provider==='typesafe'&&(entry.model!==JEV_MODEL||entry.endpoint!==JEV_ENDPOINT)||entry.provider==='nebius'&&(entry.model!==NEMOTRON_MODEL||entry.endpoint!==NEMOTRON_ENDPOINT)||!['typesafe','nebius'].includes(entry.provider))fail('evaluation-provider-drift');
 }
}
export async function validateBoundBaseline(experiment,base){
 const binding=experiment.baselineBinding;if(!binding)fail('evaluation-baseline-binding-required');safeRelativePath(binding.path);safeRelativePath(binding.predictionsPath);
 const bytes=await readFile(join(base,binding.path)),predictionBytes=await readFile(join(base,binding.predictionsPath));if(sha256(bytes)!==binding.sha256||sha256(predictionBytes)!==binding.predictionsSha256)fail('evaluation-baseline-drift');
 const baseline=parseStrictJson(bytes.toString('utf8'),16*1024*1024),predictions=parseStrictJson(predictionBytes.toString('utf8'),16*1024*1024);if(baseline.kind!=='advisory-baseline-results'||baseline.corpusDigest!==experiment.corpusDigest||canonicalJson(baseline.codeIdentity)!==canonicalJson(experiment.codeIdentity)||baseline.predictionsDigest!==jsonDigest(predictions))fail('evaluation-baseline-drift');return baseline;
}
export function validateAuthorization(authorization,batch,experiment){
 if(authorization.schemaVersion!==1||authorization.kind!=='advisory-evaluation-authorization'||authorization.payloadReviewed!==true||authorization.acceptEstimateUncertainty!==true||authorization.experimentDigest!==experiment.digest||authorization.permitBatchDigest!==jsonDigest(batch)||authorization.maxRequests!==experiment.requests.length||authorization.maxRequests>200||authorization.estimatedAllowanceUsd!==1||typeof authorization.expiresAt!=='string'||!Number.isFinite(Date.parse(authorization.expiresAt))||Date.parse(authorization.expiresAt)<=Date.now())fail('evaluation-owner-authorization-required');
 if(batch.schemaVersion!==1||batch.kind!=='advisory-evaluation-permit-batch'||batch.experimentDigest!==experiment.digest||!Array.isArray(batch.permits)||batch.permits.length!==experiment.requests.length||new Set(batch.permits.map(p=>p.permit?.permitId)).size!==batch.permits.length)fail('evaluation-permit-batch-mismatch');
 for(let i=0;i<experiment.requests.length;i++){
  const entry=experiment.requests[i],permit=batch.permits[i],p=permit.permit;
  if(permit.id!==entry.id||p?.model!==entry.model||p?.endpoint!==entry.endpoint||p?.maxRequests!==1||typeof p.expiresAt!=='string'||!Number.isFinite(Date.parse(p.expiresAt))||Date.parse(p.expiresAt)<=Date.now())fail('evaluation-permit-batch-mismatch');
  if(entry.provider==='typesafe'){
   if(p.kind!=='jev-advisory-permit'||p.payloadReviewed!==true||p.requestHash!==entry.requestHash||!Number.isSafeInteger(p.maxRequestBytes)||p.maxRequestBytes<entry.requestBytes||p.maxRequestBytes>32768||typeof p.approvedEstimatedSpendUsd!=='number'||!Number.isFinite(p.approvedEstimatedSpendUsd)||p.approvedEstimatedSpendUsd<entry.estimatedReservationUsd||p.priceSource!==entry.priceQuote.source||p.priceDate!==entry.priceQuote.date)fail('evaluation-permit-entry-mismatch');
  }else{
   const price=p.priceBasis;
   if(p.kind!=='inference-permit'||p.inputDigest!==entry.inputDigests[0]||p.repositoryId!==entry.repositoryId||p.maxCompletionTokens!==2048||!price||price.source!==entry.priceQuote.source||price.inputUsdPerMillion!==entry.priceQuote.inputUsdPerMillion||price.outputUsdPerMillion!==entry.priceQuote.outputUsdPerMillion||typeof price.maxCostUsd!=='number'||!Number.isFinite(price.maxCostUsd)||price.maxCostUsd<entry.estimatedReservationUsd)fail('evaluation-permit-entry-mismatch');
  }
 }
}
export async function executeEvaluation(options){
 const experimentPath=resolve(options.experiment),base=dirname(experimentPath),experiment=validateExperiment(await json(experimentPath));const freeze=await verifyFrozenCorpus(experiment.corpusRoot);if(freeze.digest!==experiment.corpusDigest)fail('evaluation-corpus-drift');const boundBaseline=await validateBoundBaseline(experiment,base);await verifyRequests(experiment,base);
 const authorization=await json(resolve(options.authorization)),batch=await json(resolve(options.permits));validateAuthorization(authorization,batch,experiment);
 const replay=options.replay!==undefined,responses=replay?await json(resolve(options.replay)):null;if(replay&&(responses.kind!=='advisory-evaluation-replay-responses'||!Array.isArray(responses.responses)))fail('evaluation-invalid-replay');
 const output=await dedicatedOutput(options.output),worker=await buildEvaluationWorker(join(output,'.worker'));if(canonicalJson(await identity(worker))!==canonicalJson(experiment.codeIdentity))fail('evaluation-code-drift');const controls=join(output,'.controls'),replayLedger=join(output,'.replay-permits');
 for(const entry of experiment.requests){const permit=batch.permits.find(p=>p.id===entry.id).permit;await invokeEvaluationWorker(worker,{action:entry.kind==='advisory'?'validate-advisory':'validate-numeric',request:await json(join(base,entry.requestArtifactPath)),...(entry.kind==='advisory'?{requestDirectory:join(base,entry.preparedPath)}:{input:await json(join(base,entry.inputArtifactPath))}),permit,mode:replay?'replay':'native',priceQuote:nebiusQuote,...(replay?{replayLedger}:{})},controls);}
 await invokeEvaluationWorker(worker,{action:'authorize-batch',mode:replay?'replay':'native',authorizationDigest:jsonDigest(authorization),experimentDigest:experiment.digest,...(replay?{replayLedger}:{})},controls);
 const execution=await runSequentialRequests(experiment.requests,async entry=>{
  const permitted=batch.permits.find(p=>p.id===entry.id),descriptor=replay?responses.responses.find(r=>r.id===entry.id):null;if(replay&&!descriptor)fail('evaluation-replay-response-missing');
  const request=await json(join(base,entry.requestArtifactPath)),control={action:entry.kind==='advisory'?'execute-advisory':'execute-numeric',request,...(entry.kind==='advisory'?{requestDirectory:join(base,entry.preparedPath)}:{input:await json(join(base,entry.inputArtifactPath))}),permit:permitted.permit,output:join(output,entry.id),mode:replay?'replay':'native',priceQuote:nebiusQuote,...(replay?{replay:descriptor,replayLedger}:{})};
  const result=await invokeEvaluationWorker(worker,control,controls);assertResultBinding(result,entry);if(result.mode!==(replay?'replay':'native'))fail('evaluation-native-replay-confusion');return result;
 },rows=>save(join(output,'execution.json'),{schemaVersion:1,kind:'advisory-evaluation-execution',experimentDigest:experiment.digest,mode:replay?'replay':'native',results:rows}));
 const baseline=boundBaseline,corpus=await json(join(experiment.corpusRoot,'corpus.json')),search=await json(join(experiment.corpusRoot,'search.json')),labelPredictions=[],searchPredictions=[],searchGold=[],searchOracleCache=new Map();
 for(const entry of experiment.requests){const result=execution.results.find(r=>r.id===entry.id);if(result?.status!=='completed'||entry.kind!=='advisory')continue;const prepared=await json(join(base,entry.requestArtifactPath));
  if(entry.feature==='labels'){const item=corpus.cases.find(c=>c.id===entry.caseId),report=await command([cli,'advisory','inbox','--input',join(experiment.corpusRoot,item.input),'--enrichment',join(output,entry.id),'--format','json']);labelPredictions.push(labelPrediction(item,report,prepared,true));}
  else{const item=search.queries.find(q=>q.id===entry.caseId),report=await command([cli,'advisory','ask',...inputs(item.inputs,experiment.corpusRoot),'--question',item.question,'--enrichment',join(output,entry.id),'--format','json']);searchGold.push(await searchOracle(item,prepared,experiment.corpusRoot,searchOracleCache));searchPredictions.push(searchPrediction(item,report,prepared));}
 }
 for(const item of search.queries)if(!searchGold.some(q=>q.id===item.id)){const entry=experiment.requests.find(r=>r.feature==='search'&&r.caseId===item.id);searchGold.push(await searchOracle(item,await json(join(base,entry.requestArtifactPath)),experiment.corpusRoot,searchOracleCache));}
 const labelScores=bySplit(corpus.cases,labelPredictions,scoreLabels),searchScores=bySplit(searchGold,searchPredictions,scoreSearch),performanceFor=(feature,split='holdout')=>{const cases=feature==='labels'?corpus.cases:search.queries,scores=feature==='labels'?labelScores:searchScores;return performanceForPopulation(experiment.requests.filter(r=>r.feature===feature),execution.results,cases.filter(c=>c.split===split).map(c=>c.id),scores[split].usefulCards);};
 const qualification=qualifyFeatures({mode:replay?'replay':'native',labels:labelScores.holdout,search:searchScores.holdout,baselineSearch:baseline.search.holdout,labelsPerformance:performanceFor('labels'),searchPerformance:performanceFor('search'),executionComplete:execution.status==='complete'&&execution.results.every(r=>r.status==='completed'),...(options.blindedReview?{blindedReview:await json(resolve(options.blindedReview))}:{})});
 const performanceSummary=feature=>Object.fromEntries(['development','holdout'].map(split=>{const measured=performanceFor(feature,split),times=measured.requestLatenciesMs.filter(Number.isFinite),knownCost=measured.costsUsd.every(c=>typeof c==='number'&&Number.isFinite(c)),costUsd=knownCost?measured.costsUsd.reduce((a,b)=>a+b,0):null;return [split,{complete:measured.complete,requests:measured.requestCount,usefulDisplayedCards:measured.usefulDisplayedCards,p50Ms:percentile(times,0.5),p95Ms:percentile(times,0.95),costUsd,costPerUsefulCardUsd:costUsd!==null&&measured.usefulDisplayedCards>0?costUsd/measured.usefulDisplayedCards:null,missingCostCount:measured.costsUsd.filter(c=>c===null).length}];}));
 const numeric=compareNumericOutcomes(baseline.numericCases??[],experiment.requests,execution.results,replay?'replay':'native');
 const report={schemaVersion:1,kind:'advisory-comparative-evaluation',numericComparison:numeric.comparison,performance:{labels:performanceSummary('labels'),search:performanceSummary('search')},mode:replay?'replay':'native',live:!replay,...accountRequests(execution.results,replay?'replay':'native'),corpusDigest:experiment.corpusDigest,experimentDigest:experiment.digest,status:execution.status,labels:labelScores,search:searchScores,qualification,execution,numericShadow:execution.results.filter(r=>r.id.startsWith('numeric-')),cascade:numeric.cascade,limitations:['No automatic retry or continuation after an unknown outcome; inspect retained journals and obtain fresh authority.','Replay is not native provider proof and cannot qualify semantic features.','Numeric providers remain in evaluation shadow mode; no optimizer diagnosis is replaced.']};await save(join(output,'report.json'),report);return report;
}
function argumentsOf(argv){const options={};for(let i=0;i<argv.length;i++){const flag=argv[i];if(flag==='--live'){if(options.live)fail('evaluation-duplicate-option');options.live=true;continue;}const mapping={'--output':'output','--corpus':'corpus','--experiment':'experiment','--authorization':'authorization','--permits':'permits','--replay':'replay','--blinded-review':'blindedReview'},key=mapping[flag];if(!key||options[key]!==undefined||!argv[i+1]||argv[i+1].startsWith('--'))fail('evaluation-usage');options[key]=argv[++i];}if(!options.output||options.live&&options.replay)fail('evaluation-usage');if(options.live||options.replay){if(!options.experiment||!options.authorization||!options.permits||options.corpus)fail('evaluation-usage');}else if(options.experiment||options.authorization||options.permits||options.blindedReview)fail('evaluation-usage');return options;}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const options=argumentsOf(process.argv.slice(2)),report=options.live||options.replay?await executeEvaluation(options):await dryRunEvaluation(options.output,options.corpus);process.stdout.write(JSON.stringify({schemaVersion:1,kind:report.kind,mode:report.mode,nativeInferenceCalls:report.nativeInferenceCalls,output:resolve(options.output),...(report.experiment?{requestCount:report.experiment.requestCount,estimatedTotalUsd:report.experiment.estimatedTotalUsd}:{status:report.status})})+'\n');}
 catch(error){process.stderr.write(error instanceof Error&&/^[a-z0-9-]+$/u.test(error.message)?error.message+'\n':'advisory-evaluation-failed\n');process.exitCode=1;}
}
