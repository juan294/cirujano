import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { VerificationProfile } from './contracts.js';

/** Capture actual Vitest 4 JSON and V8/Istanbul reports from isolated owned code. */
export function captureQualityFixture() {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'cirujano-quality-')));
  const repositoryRoot = resolve(import.meta.dirname, '../../../..');
  mkdirSync(join(workspace, 'src'));
  symlinkSync(join(repositoryRoot, 'node_modules'), join(workspace, 'node_modules'), 'dir');
  writeFileSync(join(workspace, 'src/math.ts'), 'export function add(a:number,b:number){if(a<0)return 0;return a+b}\n');
  writeFileSync(join(workspace, 'src/uncovered.ts'), 'export function untouched(){return 7}\n');
  writeFileSync(join(workspace, 'math.test.ts'), "import {test,expect} from 'vitest';import {add} from './src/math';test('adds',()=>expect(add(1,2)).toBe(3));test.skip('skipped',()=>{});test.todo('future');\n");
  writeFileSync(join(workspace, 'config.mjs'), "export default {test:{fileParallelism:false,maxWorkers:1,reporters:['json'],outputFile:'tests.json',coverage:{provider:'v8',include:['src/**/*.ts'],reporter:['json'],reportsDirectory:'coverage'}}};\n");
  const result = spawnSync(process.execPath, [join(repositoryRoot, 'node_modules/vitest/vitest.mjs'), 'run', '--root', workspace, '--config', join(workspace, 'config.mjs'), '--coverage'], { cwd: repositoryRoot, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
  if (result.status !== 0) throw new Error(`Actual fixture capture failed: ${result.stderr}`);
  const profile: VerificationProfile = { schemaVersion: 1, commands: [['pnpm', 'test']], testReportPath: 'tests.json', coverageReportPath: 'coverage/coverage-final.json', nodeVersion: '22.23.2', pnpmVersion: '11.22.0', timeoutSeconds: 60, sourcePaths: ['src/math.ts', 'src/uncovered.ts'] };
  return { workspace, profile, vitest: JSON.parse(readFileSync(join(workspace, 'tests.json'), 'utf8')) as Record<string, unknown>, coverage: JSON.parse(readFileSync(join(workspace, 'coverage/coverage-final.json'), 'utf8')) as Record<string, unknown> };
}
