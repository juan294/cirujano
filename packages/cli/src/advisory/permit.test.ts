import { expect, it } from 'vitest';
import { buildPreparedRequest } from './prepare.js';
import { evidenceFixture } from './fixture.js';
import { decodeAdvisoryPermit, permitDigest, permitTemplate } from './permit.js';
const now=()=>new Date('2026-10-28T12:00:00Z');
it('requires exact reviewed request/model/endpoint/price/budget/expiry and one request',()=>{
 const p=buildPreparedRequest([evidenceFixture()],'labels');const template=permitTemplate(p,now());
 expect(()=>decodeAdvisoryPermit(template,p,now())).toThrow();
 const valid={...template,kind:'jev-advisory-permit',payloadReviewed:true};
 expect(decodeAdvisoryPermit(valid,p,now()).maxRequests).toBe(1);
 for(const change of [{requestHash:'0'.repeat(64)},{model:'jev-latest'},{endpoint:'https://evil.invalid'},{payloadReviewed:false},{maxRequests:2},{maxRequestBytes:p.requestBytes-1},{approvedEstimatedSpendUsd:0},{priceDate:'2020-01-01'},{expiresAt:'2026-10-28T11:00:00Z'}])expect(()=>decodeAdvisoryPermit({...valid,...change},p,now())).toThrow();
 const edited={...valid,expiresAt:'2026-10-29T12:00:00Z'};expect(permitDigest(valid)).toBe(permitDigest(edited));
});
