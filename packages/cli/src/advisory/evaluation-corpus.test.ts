import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeEvidence } from './contracts.js';
import { sha256 } from '@cirujano/core';
import { buildEvaluationCorpus, validateEvaluationCorpus, writeEvaluationCorpus } from './evaluation-corpus.js';
const roots:string[]=[];afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
describe('frozen independently curated advisory evaluation corpus',()=>{
 it('has exactly60 balanced hand-labeled cases with disjoint development/holdout families',()=>{
  const {corpus}=buildEvaluationCorpus();expect(corpus.cases).toHaveLength(60);for(const split of ['development','holdout'] as const){const cases=corpus.cases.filter(c=>c.split===split);expect(cases).toHaveLength(split==='development'?24:36);for(const category of ['install','build','test','artifact','mixed','unknown'])expect(cases.filter(c=>c.category===category)).toHaveLength(split==='development'?4:6);}
  const dev=new Set(corpus.cases.filter(c=>c.split==='development').map(c=>c.family));expect(corpus.cases.filter(c=>c.split==='holdout').every(c=>!dev.has(c.family))).toBe(true);expect(corpus.cases.filter(c=>c.split==='holdout'&&c.tags.some(t=>['adversarial','missing-context','no-match'].includes(t))).length).toBeGreaterThanOrEqual(6);
  expect(corpus.cases.every(c=>c.expected.automation==='advisory-only')).toBe(true);expect(corpus.cases.some(c=>c.expected.labels.includes('cacheMiss'))).toBe(true);
 });
 it('has12development and24holdout search queries,18heldanswerable with3goldIDs and6nomatch',()=>{
  const {search}=buildEvaluationCorpus();expect(search.queries.filter(q=>q.split==='development')).toHaveLength(12);const held=search.queries.filter(q=>q.split==='holdout');expect(held).toHaveLength(24);expect(held.filter(q=>q.expected.status==='supported')).toHaveLength(18);expect(held.filter(q=>q.expected.status==='no-match')).toHaveLength(6);expect(held.filter(q=>q.expected.status==='supported').every(q=>q.expected.relevantCandidateIds.length>=3)).toBe(true);
  const dev=new Set(search.queries.filter(q=>q.split==='development').map(q=>q.family));expect(held.every(q=>!dev.has(q.family))).toBe(true);expect(search.queries.every(q=>q.inputs.length===20)).toBe(true);
 });
 it('freezes deterministic fixture/label/split bytes and detects altered evidence before scoring',async()=>{
  const root=await mkdtemp(join(tmpdir(),'advisory-corpus-'));roots.push(root);const first=await writeEvaluationCorpus(root),second=await writeEvaluationCorpus(root);expect(first.digest).toBe(second.digest);expect((await validateEvaluationCorpus(root)).labelCases).toBe(60);expect(first.files.some(f=>f.path==='corpus.json')).toBe(true);expect(first.files.some(f=>f.path==='search.json')).toBe(true);const target=first.files.find(f=>f.path.endsWith('/evidence.json'))!;await writeFile(join(root,target.path),'{}');await expect(validateEvaluationCorpus(root)).rejects.toThrow(/freeze/);await expect(writeEvaluationCorpus(root)).rejects.toThrow(/frozen/);
 });
 it('includes20benchmarkbundles,compatible10+10manifests and exact raw estimate input',()=>{
  const {benchmark,files}=buildEvaluationCorpus();expect(benchmark.inputs).toHaveLength(20);expect(benchmark.baseline).toBe('benchmark/baseline/cohort.json');expect(benchmark.candidate).toBe('benchmark/candidate/cohort.json');const estimate=JSON.parse(files.get(benchmark.estimateJobs)!) as {jobs:unknown[]};expect(estimate.jobs).toHaveLength(20);
 });
 it('retains a readable per-case rubric and has no execution/publication authority',async()=>{
  const root=await mkdtemp(join(tmpdir(),'advisory-corpus-'));roots.push(root);await writeEvaluationCorpus(root);const rubric=await readFile(join(root,'rubric.md'),'utf8');expect(rubric).toContain('independent');expect(rubric).toContain('provider-verified');expect(rubric).toContain('label-held-unknown-06');expect(rubric).toContain('no model answers');
 });
 it('includes semantically valid mixed examples for broad install/test queries before scoring',()=>{
  const {search}=buildEvaluationCorpus();for(const query of search.queries.filter(q=>/-install-|-test-/.test(q.id))){expect(query.expected.relevantCandidateIds).toHaveLength(6);expect(query.expected.relevantCandidateIds).toEqual(expect.arrayContaining(['e016','e017','e018']));}
 });
 it('keeps full retained label/search source contents disjoint across development and holdout',()=>{
  const {corpus,search,files}=buildEvaluationCorpus();const sourceHashes=(split:'development'|'holdout')=>{const inputs=new Set([...corpus.cases.filter(c=>c.split===split).map(c=>c.input),...search.queries.filter(q=>q.split===split).flatMap(q=>q.inputs)]);return new Set([...inputs].flatMap(input=>decodeEvidence(JSON.parse(files.get(`${input}/evidence.json`)!)).sources.map(source=>sha256(source.content))));};
  const development=sourceHashes('development'),holdout=sourceHashes('holdout');expect([...holdout].filter(hash=>development.has(hash))).toEqual([]);
 });
 it('uses compilation wording supported by every gold excerpt and records pre-score audit revision',()=>{
  const {search,files}=buildEvaluationCorpus();expect(search.queries.find(q=>q.id==='search-held-build-2')!.question).not.toMatch(/release/i);expect(files.get('rubric.md')).toContain('Pre-score blind audit revision 2');
 });

});
