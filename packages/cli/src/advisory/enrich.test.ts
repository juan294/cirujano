import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { prepareOperation } from './prepare.js';
import { evidenceFixture } from './fixture.js';
import { permitTemplate } from './permit.js';
import { enrichOperation, inspectAdvisoryOperation, readEnrichmentOperation } from './enrich.js';
const roots:string[]=[];afterEach(async()=>{for(const p of roots.splice(0))await rm(p,{recursive:true,force:true});});
async function setup(){const root=await mkdtemp(join(tmpdir(),'advisory-enrich-'));roots.push(root);const now=()=>new Date('2026-10-28T12:00:00Z');const request=join(root,'request');const b=evidenceFixture();const p=await prepareOperation([b],'labels',null,request,now);const permit={...permitTemplate(p,now()),kind:'jev-advisory-permit',payloadReviewed:true};let sends=0;const fake:typeof fetch=async(_url,init)=>{sends++;const body=JSON.parse(init!.body as string);return new Response(JSON.stringify({model:'jev-1.14.0',answers:Object.fromEntries(Object.keys(body.questions).map(id=>[id,{type:'noul',noul:0.9}])),usage:{input_tokens:120,output_tokens:10}}));};return {root,now,request,b,p,permit,fake,sends:()=>sends,options:{apiKey:'test-bearer-key',fetch:fake,permitLedger:join(root,'ledger'),now}};}
it('consumes one permit across output directories, attaches exact readback and preserves source evidence',async()=>{
 const f=await setup(),out=join(f.root,'enriched');const receipt=await enrichOperation(f.request,f.permit,out,f.options);
 expect(receipt.status).toBe('completed');expect(f.sends()).toBe(1);expect(receipt.inputTokens).toBe(120);expect(receipt.costUsd).toBeGreaterThan(0);
 const context=await readEnrichmentOperation(out);expect(context.prepared.requestHash).toBe(f.p.requestHash);expect(context.bundles[0]).toEqual(f.b);
 expect((await inspectAdvisoryOperation(out)).status).toBe('complete');
 await expect(enrichOperation(f.request,f.permit,join(f.root,'different'),f.options)).rejects.toThrow('permit-exhausted');expect(f.sends()).toBe(1);
 expect(await readFile(join(out,'receipt.json'),'utf8')).not.toContain('test-bearer-key');
});
it('fails missing key and mismatched authority before any send or consumption, then recovers',async()=>{
 const f=await setup();await expect(enrichOperation(f.request,{...f.permit,requestHash:'0'.repeat(64)},join(f.root,'bad'),f.options)).rejects.toThrow('permit');
 await expect(enrichOperation(f.request,f.permit,join(f.root,'nokey'),{...f.options,apiKey:''})).rejects.toThrow('jev-key-required');expect(f.sends()).toBe(0);
 expect((await enrichOperation(f.request,f.permit,join(f.root,'good'),f.options)).status).toBe('completed');expect(f.sends()).toBe(1);
});
it('retains known HTTP failure as unavailable with null usage/cost and no fallback or retry',async()=>{
 const f=await setup();let sends=0;const receipt=await enrichOperation(f.request,f.permit,join(f.root,'http'),{...f.options,fetch:async()=>{sends++;return new Response('provider body must stay private',{status:429});}});
 expect(receipt.status).toBe('unavailable');expect(receipt.costUsd).toBeNull();expect(receipt.inputTokens).toBeNull();expect(sends).toBe(1);
 expect((await inspectAdvisoryOperation(join(f.root,'http'))).status).toBe('unavailable');
});
it('refuses an oversized unusable key before consuming its permit, then accepts a corrected key',async()=>{
 const f=await setup();await expect(enrichOperation(f.request,f.permit,join(f.root,'oversized'),{...f.options,apiKey:'x'.repeat(2049)})).rejects.toThrow('jev-key-required');
 expect(f.sends()).toBe(0);expect((await enrichOperation(f.request,f.permit,join(f.root,'corrected'),f.options)).status).toBe('completed');expect(f.sends()).toBe(1);
});
it('discloses possible charge for a retained transport-unknown receipt and keeps local fallback usable',async()=>{
 const f=await setup(),out=join(f.root,'disconnected');let sends=0;
 const receipt=await enrichOperation(f.request,f.permit,out,{...f.options,fetch:async()=>{sends++;throw new Error('socket disconnected');}});
 expect(receipt.status).toBe('outcome-unknown');expect(receipt.costUsd).toBeNull();expect(sends).toBe(1);
 const report=await inspectAdvisoryOperation(out);expect(report.status).toBe('outcome-unknown');expect(report.limitations.join(' ')).toContain('charge may have occurred');
 const {runCli}=await import('../cli.js');const output:string[]=[];expect(await runCli(['advisory','inbox','--input',out,'--format','json'],{stdout:s=>output.push(s),stderr:s=>output.push(s)})).toBe(0);expect(JSON.parse(output.pop()!).payload.cards).toHaveLength(1);
});
