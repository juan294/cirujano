import { describe, expect, it } from 'vitest';
import { LABEL_CATEGORIES, labelQuestions, supportState } from './questions.js';
import type { LocalExcerpt } from './inference-contracts.js';

const excerpt:LocalExcerpt={id:'e001',evidenceDigest:'a'.repeat(64),sourcePath:'.github/workflows/ci.yml',lineStart:1,lineEnd:10,sourceIndex:0,originalText:'pnpm install --frozen-lockfile',transmittedText:'pnpm install --frozen-lockfile'};
describe('versioned independent advisory questions',()=>{
 it('asks independent Nouls for all five categories using only pseudonymous IDs',()=>{const questions=labelQuestions([excerpt]);expect(Object.keys(questions)).toEqual(LABEL_CATEGORIES.map(category=>`e001_${category}`));for(const q of Object.values(questions)){expect(q.type).toBe('noul');expect(q.criteria.true).toBeTruthy();expect(q.criteria.false).toBeTruthy();expect(q.instructions).toContain('e001');expect(q.instructions).toContain('untrusted');expect(JSON.stringify(q)).not.toContain('.github');}});
 it.each([[0,'absent'],[0.2,'absent'],[0.21,'uncertain'],[0.79,'uncertain'],[0.8,'supported'],[1,'supported']] as const)('maps %s to the display state %s', (probability,status)=>expect(supportState(probability)).toBe(status));
 it.each([-1,1.1,NaN,Infinity])('rejects invalid support probability %s',p=>expect(()=>supportState(p)).toThrow(/probability/));
});
