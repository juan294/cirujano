export const JEV_MODEL='jev-1.14.0' as const;
export const JEV_ENDPOINT='https://api.typesafe.ai/v1/systemone' as const;
export const LABEL_QUESTION_VERSION='advisory-labels-v1';
export const SEARCH_QUESTION_VERSION='advisory-search-v1';
export const COMPARISON_QUESTION_VERSION='advisory-comparison-v1';
export const MAX_REQUEST_BYTES=32*1024;
export const MAX_RESPONSE_BYTES=256*1024;
export const TOTAL_DEADLINE_MS=15000;
export const PRICE_QUOTE={source:'https://docs.typesafe.ai/models',date:'2026-10-28',inputUsdPerMillion:0.042,outputUsdPerMillion:0} as const;
export interface NoulQuestion {type:'noul';instructions:string;criteria:{true:string;false:string}}
export interface ChoiceQuestion {type:'choice';instructions:string;criteria:Record<string,string>}
export type JevQuestion=NoulQuestion|ChoiceQuestion;
export interface JevBody {model:typeof JEV_MODEL;state:Record<string,unknown>;questions:Record<string,JevQuestion>}
export interface NoulAnswer {type:'noul';noul:number}
export interface ChoiceAnswer {type:'choice';choice:string;confidence:number;probabilities:Record<string,number>}
export type JevAnswer=NoulAnswer|ChoiceAnswer;
export interface JevResponse {model:typeof JEV_MODEL;answers:Record<string,JevAnswer>;usage:{input_tokens:number;output_tokens:number}}
export interface LocalExcerpt {id:string;evidenceDigest:string;sourcePath:string;lineStart:number;lineEnd:number;sourceIndex:number|null;originalText:string;transmittedText:string}
export type AdvisoryTask='labels'|'search'|'compare';
export interface RequestProjection {task:AdvisoryTask;question:string|null;body:JevBody;mapping:LocalExcerpt[];inputDigests:string[];questionSetVersion:string;policyVersion:string}
