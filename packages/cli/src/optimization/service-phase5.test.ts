import {describe,it,expect} from 'vitest';
import {join} from 'node:path';
import {writeFile} from 'node:fs/promises';
import {canonicalJson} from '@cirujano/core';
import {createOptimizationService} from './service.js';
import {publicationFixture} from './publish.test-helper.js';
import {measurementFixture} from './measure.test-helper.js';

const io=()=>{let output='';return{stdout:(text:string)=>{output+=text;},stderr:(text:string)=>{output+=text;},result:()=>JSON.parse(output)};};
// Multi-stage fixtures use real Git objects and product private-store validation.
describe('Phase 5 product dispatch',{timeout:30000},()=>{
 it('dispatches actual measurement and validated local status with GET only',async()=>{const f=await measurementFixture(),cohortPath=join(f.directory,'cohort.json');await writeFile(cohortPath,canonicalJson(f.cohort),{mode:0o600});const service=createOptimizationService({pageRunner:f.pageRunner,binaryRunner:f.binaryRunner,now:()=>Date.parse('2026-09-30T00:00:00Z')}),output=io();expect(await service.run({command:'optimize',action:'measure',format:'json',flags:{proposal:join(f.proposed,'proposal.json'),sandbox:join(f.verified,'sandbox.json'),cohort:cohortPath,output:f.measured}},output)).toBe(0);expect(output.result().status).toBe('measured-improvement');const previous=f.calls.length,status=io();expect(await service.run({command:'optimize',action:'status',format:'json',flags:{operation:f.measured}},status)).toBe(0);expect(status.result().status).toBe('measured-improvement');expect(f.calls).toHaveLength(previous);});
 it('dispatches publication and status recovery without Sandbox credentials or duplicate POST',async()=>{const f=await publicationFixture(),permitPath=join(f.directory,'publication-permit.json');await writeFile(permitPath,canonicalJson(f.permit),{mode:0o600});const service=createOptimizationService(f.options),output=io();expect(await service.run({command:'optimize',action:'publish',format:'json',flags:{report:f.reportPath,permit:permitPath}},output)).toBe(0);expect(output.result().status).toBe('published');expect(output.result().url).toBe(`https://github.com/${f.permit.repository}/pull/1`);const status=io();expect(await service.run({command:'optimize',action:'status',format:'json',flags:{operation:f.publication}},status)).toBe(0);expect(status.result().status).toBe('published');expect(status.result().url).toBe(`https://github.com/${f.permit.repository}/pull/1`);expect(f.posts).toHaveLength(1);});
});
