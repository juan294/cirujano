import { gitBlobSha } from '@cirujano/core';
import { sealEvidence, type EvidenceBundleV1 } from './contracts.js';

/** Synthetic fixture shared by the local CLI examples and behavioral tests. */
export function evidenceFixture(overrides: Partial<EvidenceBundleV1> = {}): EvidenceBundleV1 {
  const content='name: CI\non: push\njobs:\n  check:\n    name: Checks\n    runs-on: ubuntu-latest\n    steps:\n      - name: Install\n        run: pnpm install --frozen-lockfile\n';
  return sealEvidence({schemaVersion:1,kind:'advisory-evidence',repository:{id:1,name:'example/project',visibility:'public'},run:{id:10,attempt:1,headSha:'1'.repeat(40),event:'push'},workflow:{path:'.github/workflows/ci.yml',blobSha:gitBlobSha(content)},job:{id:20,key:'check',name:'Checks',labels:['ubuntu-latest'],conclusion:'success',startedAt:'2026-10-28T10:00:00Z',completedAt:'2026-10-28T10:02:00Z'},steps:[{number:2,name:'Install',startedAt:'2026-10-28T10:00:00Z',completedAt:'2026-10-28T10:01:00Z',conclusion:'success',sourceIndex:0,command:'pnpm install --frozen-lockfile',lineStart:1,lineEnd:content.split('\n').length}],sources:[{path:'.github/workflows/ci.yml',blobSha:gitBlobSha(content),content,lineStart:1,lineEnd:content.split('\n').length}],mapping:'supported',reasonCodes:[],fetchedAt:'2026-10-28T11:00:00Z',toolSourceSha:'2'.repeat(40),apiVersion:'2022-11-28',...overrides});
}
