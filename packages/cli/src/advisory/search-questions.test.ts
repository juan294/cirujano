import { describe, expect, it } from 'vitest';
import { evidenceFixture } from './fixture.js';
import { buildSearchProjection } from './search-questions.js';
import { SEARCH_QUESTION_VERSION } from './inference-contracts.js';

describe('bounded search projection',()=>{
 it('pins query, candidate existence/relevance and the exact closed Choice set',()=>{const b=evidenceFixture(),p=buildSearchProjection([b],'find dependency setup');expect(p.task).toBe('search');expect(p.question).toBe('find dependency setup');expect(p.questionSetVersion).toBe(SEARCH_QUESTION_VERSION);expect(p.body.questions.answer_exists!.type).toBe('noul');expect(p.body.questions.e001_relevance!.type).toBe('noul');expect(p.body.questions.best_evidence).toMatchObject({type:'choice',criteria:{e001:expect.any(String)}});expect(JSON.stringify(p.body)).not.toContain('example/project');});
 it('sanitizes the query before outbound hashing but retains exact local question identity',()=>{const p=buildSearchProjection([evidenceFixture()],'find example/project dependency setup https://github.com/example/project /Users/juan/code');expect(p.question).toContain('example/project');const outbound=JSON.stringify(p.body);expect(outbound).not.toContain('example/project');expect(outbound).not.toContain('/Users');expect(outbound).not.toContain('https://');});
 it('refuses credential-bearing queries, invalid query lengths and empty evidence',()=>{expect(()=>buildSearchProjection([evidenceFixture()],'apiKey: literal')).toThrow('search-sensitive-query');expect(()=>buildSearchProjection([evidenceFixture()],'x'.repeat(4097))).toThrow(/query/);expect(()=>buildSearchProjection([],'dependencies')).toThrow('search-no-candidates');});
});
