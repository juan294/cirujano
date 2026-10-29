import {expect,it} from 'vitest';
import {sourceEnvironmentMappings,parseWorkflowSource} from './workflow.js';

it('returns exact AST key positions and paths without confusing scalar text with mappings',()=>{
 const source='# café 工具\r\nenv: {CI: true}\r\njobs:\r\n  check:\r\n    env: {CIRUJANO_QEMU_CPUS: 2}\r\n    steps:\r\n      - env: {RESULT: "${{ needs.build.result }}"}\r\n        run: echo ok\r\n      - run: "echo {env: hidden}"\r\n';
 const found=sourceEnvironmentMappings(source);expect(found).toHaveLength(3);
 expect(found.map(item=>item.path)).toEqual([['env'],['jobs','check','env'],['jobs','check','steps',0,'env']]);
 expect(found.map(item=>source.slice(item.keyStart,item.keyEnd))).toEqual(['env','env','env']);
 expect(found.map(item=>item.value)).toEqual([{CI:true},{CIRUJANO_QEMU_CPUS:2},{RESULT:'${{ needs.build.result }}'}]);
 expect(parseWorkflowSource(source).env).toEqual({CI:true});
});
it('exposes quoted/escaped/nonstandard locations for callers to refuse rather than masking a decoy',()=>{
 const source='"\\u0065nv": {CI: true}\njobs:\n  check:\n    container:\n      env: {CI: true}\n    steps:\n      - run: "echo {env: hidden}"\n';
 const found=sourceEnvironmentMappings(source);expect(found).toHaveLength(2);
 expect(found[0]!.key).toBe('env');expect(source.slice(found[0]!.keyStart,found[0]!.keyEnd)).toBe('"\\u0065nv"');
 expect(found[1]!.path).toEqual(['jobs','check','container','env']);
});
it.each(['env: {CI: true}\nenv: {CI: false}\n','env: &x {CI: true}\njobs: {check: {env: *x}}\n','env: !!str value\n','---\nenv: {CI: true}\n---\nenv: {}\n'])('preserves strict parser rejection for %s',source=>{
 expect(()=>sourceEnvironmentMappings(source)).toThrow();expect(()=>parseWorkflowSource(source)).toThrow();
});
