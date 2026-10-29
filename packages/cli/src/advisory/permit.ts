import { randomUUID } from 'node:crypto';
import { jsonDigest } from '@cirujano/core';
import { JEV_ENDPOINT, JEV_MODEL, MAX_REQUEST_BYTES, PRICE_QUOTE } from './inference-contracts.js';
import type { PreparedRequestV1 } from './prepare.js';
type PermitRequestMetadata=Pick<PreparedRequestV1,'requestHash'|'requestBytes'|'estimatedReservationUsd'>;
import { strictRecord } from './storage.js';

export interface AdvisoryPermitV1 {
 schemaVersion:1;kind:'jev-advisory-permit';permitId:string;requestHash:string;model:typeof JEV_MODEL;endpoint:typeof JEV_ENDPOINT;
 expiresAt:string;maxRequests:1;maxRequestBytes:number;approvedEstimatedSpendUsd:number;priceSource:string;priceDate:string;payloadReviewed:true;
}
export function permitTemplate(prepared:PermitRequestMetadata,now:Date):Omit<AdvisoryPermitV1,'kind'|'payloadReviewed'>&{kind:'jev-advisory-permit-template';payloadReviewed:false}{
 return {schemaVersion:1,kind:'jev-advisory-permit-template',permitId:randomUUID(),requestHash:prepared.requestHash,model:JEV_MODEL,endpoint:JEV_ENDPOINT,expiresAt:new Date(now.getTime()+3600000).toISOString(),maxRequests:1,maxRequestBytes:prepared.requestBytes,approvedEstimatedSpendUsd:prepared.estimatedReservationUsd,priceSource:PRICE_QUOTE.source,priceDate:PRICE_QUOTE.date,payloadReviewed:false};
}
export function decodeAdvisoryPermit(value:unknown,prepared:PermitRequestMetadata,now:Date=new Date()):AdvisoryPermitV1 {
 const p=strictRecord(value,['schemaVersion','kind','permitId','requestHash','model','endpoint','expiresAt','maxRequests','maxRequestBytes','approvedEstimatedSpendUsd','priceSource','priceDate','payloadReviewed'],'permit-invalid');
 if(p.schemaVersion!==1||p.kind!=='jev-advisory-permit'||p.payloadReviewed!==true||typeof p.permitId!=='string'||!/^[A-Za-z0-9_-]{6,128}$/u.test(p.permitId)||p.requestHash!==prepared.requestHash||p.model!==JEV_MODEL||p.endpoint!==JEV_ENDPOINT||p.maxRequests!==1||!Number.isSafeInteger(p.maxRequestBytes)||(p.maxRequestBytes as number)<prepared.requestBytes||(p.maxRequestBytes as number)>MAX_REQUEST_BYTES||typeof p.approvedEstimatedSpendUsd!=='number'||!Number.isFinite(p.approvedEstimatedSpendUsd)||p.approvedEstimatedSpendUsd<prepared.estimatedReservationUsd||p.priceSource!==PRICE_QUOTE.source||p.priceDate!==PRICE_QUOTE.date)throw new Error('permit-request-or-budget-mismatch');
 if(typeof p.expiresAt!=='string'||!Number.isFinite(Date.parse(p.expiresAt))||Date.parse(p.expiresAt)<=now.getTime())throw new Error('permit-expired-or-invalid');
 return p as unknown as AdvisoryPermitV1;
}
/** A permit ID is a single authority across operations, even if its metadata is edited. */
export function permitDigest(value:Pick<AdvisoryPermitV1,'permitId'>):string{return jsonDigest({namespace:'cirujano-jev-advisory-permit-v1',permitId:value.permitId});}
