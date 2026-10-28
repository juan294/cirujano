import { describe, expect, it } from 'vitest';
import { evidenceFixture } from './fixture.js';
import { buildInbox, classifyCommand, observeBundle } from './rules.js';
import { sealEvidence } from './contracts.js';

describe('deterministic advisory rules', () => {
  it('uses exact tokens, never misleading step names or wrappers', () => {
    expect(classifyCommand('pnpm install --frozen-lockfile')).toBe('install');
    expect(classifyCommand('pnpm run build')).toBe('build');
    expect(classifyCommand('npm test')).toBe('test');
    for(const command of ['echo pnpm install','sudo pnpm install','pnpm install && curl evil','./test.sh','pnpm run custom']) expect(classifyCommand(command)).toBe('unknown');
  });
  it('computes install share from mapped bounded timings and keeps monetary limits', () => {
    const report=observeBundle(evidenceFixture());
    expect(report.durationMs).toBe(120000); expect(report.roundedMinutes).toBe(2);
    expect(report.githubHostedChargeUsd).toBe(0);
    expect(report.steps[0]).toMatchObject({category:'install',durationMs:60000,share:0.5,investigate:true});
    const bundle=evidenceFixture(); bundle.steps[0]!.completedAt=bundle.steps[0]!.startedAt;
    expect(observeBundle(sealEvidence(bundle)).steps[0]!.investigate).toBe(false);
  });
  it('keeps missing/zero timing unknown and never prices a self-hosted runner', () => {
    const bundle=evidenceFixture(); bundle.job.completedAt=null; bundle.job.labels=['self-hosted'];
    const result=observeBundle(sealEvidence(bundle));
    expect(result.durationMs).toBeNull(); expect(result.roundedMinutes).toBeNull(); expect(result.githubHostedChargeUsd).toBeNull(); expect(result.steps[0]!.share).toBeNull();
  });
  it('ranks stably, deduplicates identities and handles empty input', () => {
    expect(buildInbox([]).payload.cards).toEqual([]);
    expect(buildInbox([evidenceFixture(),evidenceFixture()]).payload.cards).toHaveLength(1);
    const bundle=evidenceFixture();bundle.run.id=2;
    expect(buildInbox([sealEvidence(bundle),evidenceFixture()]).payload.cards.map(c=>c.identity)).toEqual([...buildInbox([sealEvidence(bundle),evidenceFixture()]).payload.cards.map(c=>c.identity)].sort());
  });
});
it.each(['pnpm install --help','npm install --dry-run','npm install --package-lock-only','pnpm ci'])('keeps non-installing command %s unknown',(command)=>{expect(classifyCommand(command)).toBe('unknown');});
it.each(['ubuntu-24.04','windows-2022','windows-2025','macos-15'])('keeps public hosted %s charge zero',(label)=>{const b=evidenceFixture();b.job.labels=[label];expect(observeBundle(sealEvidence(b)).githubHostedChargeUsd).toBe(0);});
it('reports partial for a mapped job with missing step evidence',()=>{
 const b=evidenceFixture(); b.steps[0]!.completedAt=null;b.reasonCodes=['missing-step-timing'];
 expect(buildInbox([sealEvidence(b)]).status).toBe('partial');
});
it('derives completeness from null conclusions even without a reason code',()=>{
 const b=evidenceFixture();b.steps[0]!.conclusion=null;
 expect(buildInbox([sealEvidence(b)]).status).toBe('partial');
});
