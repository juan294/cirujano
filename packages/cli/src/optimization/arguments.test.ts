import { describe, expect, it } from 'vitest';
import { parseArguments } from '../args.js';

describe('optimize argument boundary', () => {
  it('parses exact collection identity and repeated runs', () => {
    expect(parseArguments(['optimize','collect','--repository','juan/repo','--ref','a'.repeat(40),'--workflow','.github/workflows/ci.yml','--job','test','--run','12','--run','13','--output','private'])).toEqual({command:'optimize',action:'collect',flags:{repository:'juan/repo',ref:'a'.repeat(40),workflow:'.github/workflows/ci.yml',job:'test',run:['12','13'],output:'private'},format:'json'});
  });
  it.each([
    ['diagnose',['input','config','output']], ['propose',['input','diagnosis','output']],
    ['verify',['proposal','profile','permit','output']], ['measure',['proposal','sandbox','cohort','output']],
    ['report',['proposal','sandbox','measurement','output']], ['publish',['report','permit']],
    ['status',['operation']], ['cancel',['operation','permit']],
  ])('parses %s independently', (action, flags) => {
    expect(parseArguments(['optimize',action,...flags.flatMap(flag=>[`--${flag}`,'file'])]).command).toBe('optimize');
  });
  it.each([
    [], ['unknown'], ['status'], ['status','--operation'], ['status','--operation','x','--run','1'],
    ['status','--operation','x','--operation','y'], ['status','--operation','x','--format','markdown'],
    ['collect','--repository','a/b','--ref','main','--workflow','.github/workflows/x.yml','--job','x','--run','1','--output','x'],
    ['collect','--repository','a/b','--ref','a'.repeat(40),'--workflow','../x','--job','x','--run','1','--output','x'],
    ['collect','--repository','a/b','--ref','a'.repeat(40),'--workflow','.github/workflows/x.yml','--job','x','--run','1','--run','1','--output','x'],
    ['collect','--repository','a/b','--ref','a'.repeat(40),'--workflow','.github/workflows/x.yml','--job','x','--run','0','--output','x'],
    ['collect','--repository','a/b','--ref','a'.repeat(40),'--workflow','.github/workflows/x.yml','--job','${{ unsafe }}','--run','1','--output','x'],
  ].map(argv=>({argv})))('rejects malformed command $argv', ({argv}) => expect(()=>parseArguments(['optimize',...argv])).toThrow());
  it('parses the skip-validated-push family collection without job or run',()=>{
    expect(parseArguments(['optimize','collect','--family','skip-validated-push','--repository','juan/repo','--ref','a'.repeat(40),'--workflow','.github/workflows/ci.yml','--branch','release/2026','--output','private'])).toEqual({command:'optimize',action:'collect',flags:{family:'skip-validated-push',repository:'juan/repo',ref:'a'.repeat(40),workflow:'.github/workflows/ci.yml',branch:'release/2026',output:'private'},format:'json'});
  });
  const family=['collect','--family','skip-validated-push','--repository','a/b','--ref','a'.repeat(40),'--workflow','.github/workflows/x.yml','--output','x'];
  it.each([
    [...family], [...family,'--branch','develop','--job','test'], [...family,'--branch','develop','--run','1'],
    [...family,'--branch','feature/*'], [...family,'--branch','../main'], [...family,'--branch','main','--branch','develop'],
    ['collect','--family','pnpm-cache','--repository','a/b','--ref','a'.repeat(40),'--workflow','.github/workflows/x.yml','--branch','main','--output','x'],
    ['collect','--repository','a/b','--ref','a'.repeat(40),'--workflow','.github/workflows/x.yml','--job','x','--run','1','--branch','main','--output','x'],
    ['diagnose','--input','i','--config','c','--output','o','--family','skip-validated-push'],
  ].map(argv=>({argv})))('rejects malformed family command $argv', ({argv}) => expect(()=>parseArguments(['optimize',...argv])).toThrow());
  it('accepts optional inference permit and status text',()=>{
    expect(parseArguments(['optimize','diagnose','--input','i','--config','c','--output','o','--permit','p'])).toMatchObject({flags:{permit:'p'}});
    expect(parseArguments(['optimize','status','--operation','o','--format','text'])).toMatchObject({format:'text'});
  });
});
