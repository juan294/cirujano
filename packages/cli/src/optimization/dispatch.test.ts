import { describe, expect, it } from 'vitest';
import { runCli } from '../cli.js';

describe('optimization CLI dispatch',()=>{
  it('dispatches optimization as the appended service and preserves IO and exit codes',async()=>{
    let observed: unknown;
    const stdout:string[]=[],stderr:string[]=[];
    const code=await runCli(['optimize','status','--operation','private'],{stdout:t=>stdout.push(t),stderr:t=>stderr.push(t)},undefined,undefined,undefined,{run:async(args,io)=>{observed=args;io.stdout('safe\n');return 2;}});
    expect(observed).toMatchObject({command:'optimize',action:'status',flags:{operation:'private'}});
    expect(code).toBe(2);expect(stdout).toEqual(['safe\n']);expect(stderr).toEqual([]);
  });
  it('does not expose arbitrary thrown provider payloads',async()=>{
    const stderr:string[]=[];
    expect(await runCli(['optimize','status','--operation','private'],{stdout:()=>{},stderr:t=>stderr.push(t)},undefined,undefined,undefined,{run:async()=>{throw new Error('secret_canary_api_key');}})).toBe(1);
    expect(stderr.join('')).toContain('optimize status failed');expect(stderr.join('')).not.toContain('secret_canary');
  });
});
