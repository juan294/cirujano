import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { runCli } from '../cli.js';
it('keeps the generated regression example bound to actual local cohort arithmetic',async()=>{
 const fixtures=new URL('../../fixtures/advisory/comparison/',import.meta.url),baseline=fileURLToPath(new URL('baseline/cohort.json',fixtures)),candidate=fileURLToPath(new URL('candidate/cohort.json',fixtures));
 for(const format of ['json','markdown'] as const){const output:string[]=[];expect(await runCli(['advisory','compare','--baseline',baseline,'--candidate',candidate,'--format',format],{stdout:s=>output.push(s),stderr:s=>output.push(s)})).toBe(0);expect(output.join('')).toBe(await readFile(new URL(format==='json'?'regression.json':'regression.md',fixtures),'utf8'));}
});
