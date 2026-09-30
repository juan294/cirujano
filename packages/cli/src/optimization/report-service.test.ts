import {it,expect} from 'vitest';
import {join} from 'node:path';
import {measurementFixture} from './measure.test-helper.js';
import {runMeasure} from './measure.js';
import {runReport,readReportContext} from './report-service.js';
// This fixture executes the actual multi-stage Git and private-store lifecycle.
it('renders a bound private report from actual product stages and rereads its entire chain',{timeout:30000},async()=>{const f=await measurementFixture(),measured=await runMeasure(join(f.proposed,'proposal.json'),join(f.verified,'sandbox.json'),f.cohort,f.measured,{pageRunner:f.pageRunner,binaryRunner:f.binaryRunner,now:()=>Date.parse('2026-09-30T00:00:00Z')});expect(measured.status).toBe('measured-improvement');const report=await runReport(join(f.proposed,'proposal.json'),join(f.verified,'sandbox.json'),measured.artifactPath!,join(f.directory,'reported'));expect(report.status).toBe('ready-to-publish');const reread=await readReportContext(report.artifactPath!);expect(reread.report.baseRef).toBe('main');expect(reread.report.headRef).toBe('develop');expect(reread.report.markdown).toContain('public repository list saving is zero');});
