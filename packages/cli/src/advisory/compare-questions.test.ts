import { describe, expect, it } from 'vitest';
import { cohortFixture } from './cohort-fixture.js';
import { buildComparisonProjection } from './compare-questions.js';
import { sealEvidence } from './contracts.js';

describe('bounded comparison symptom projection',()=>{
 it('sends independent symptom Nouls with pseudonymous cohort references and exact numerical observations',()=>{const base=cohortFixture(),candidate=cohortFixture([130,140,150],{offset:3,headSha:'3'.repeat(40)}),p=buildComparisonProjection(base,candidate);expect(p.task).toBe('compare');expect(p.question).toBeNull();expect(Object.keys(p.body.questions)).toEqual(['dependencySetup','compilation','artifactTransfer']);expect(p.inputDigests).toHaveLength(6);expect(JSON.stringify(p.body)).not.toContain('example/project');expect(JSON.stringify(p.body)).not.toContain('.github/workflows');expect(JSON.stringify(p.body)).toContain('110000');expect(p.body.state.stepObservations).toEqual([{sourceIndex:0,category:'install',baselineMedianMs:110000,candidateMedianMs:140000,deltaMs:30000}]);expect(p.mapping.length).toBeLessThanOrEqual(20);});
 it('keeps private comparison local-only and refuses remote preparation',()=>{const base=cohortFixture().map(b=>sealEvidence({...b,repository:{...b.repository,visibility:'private'}})),candidate=cohortFixture([130,140,150],{offset:3});expect(()=>buildComparisonProjection(base,candidate)).toThrow('private-inference-disabled');});
});
