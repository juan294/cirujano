import { describe, expect, it } from 'vitest';
import { parseArguments } from '../args.js';

describe('advisory grammar', () => {
  it('parses collect identity and repeated source selections', () => {
    expect(parseArguments(['advisory','collect','--repository','sample/project','--run','1','--attempt','2','--workflow','.github/workflows/ci.yml','--job-key','checks','--job-id','3','--output','out','--source-file','package.json'])).toMatchObject({command:'advisory',action:'collect',flags:{run:'1',attempt:'2'},sourceFiles:['package.json']});
  });
  it('keeps local inbox and status defaults', () => {
    expect(parseArguments(['advisory','inbox'])).toMatchObject({format:'markdown',inputs:[],sort:'duration'});
    expect(parseArguments(['advisory','status','--operation','out'])).toMatchObject({format:'text'});
  });
  it.each([
    ['inbox','--input','a','--sort','money'], ['inbox','--run','1'], ['status','--operation','a','--operation','b'],
    ['collect','--repository','a/b','--run','0'], ['collect','--repository','a/b','--run','1','--attempt','1','--workflow','../evil'],
    ['inbox','--input','a\u0000b'], ['inbox','--input','a','--format','text'], ['bogus'], ['inbox','--unknown','x'], ['status'],
  ])('rejects invalid usage %j', (...args) => { expect(() => parseArguments(['advisory',...args])).toThrow(); });
});
it('requires explicit preparation and enrichment and rejects incompatible options',()=>{
 expect(parseArguments(['advisory','prepare','--input','a','--task','labels','--output','b'])).toMatchObject({action:'prepare',inputs:['a'],flags:{task:'labels',output:'b'}});
 expect(parseArguments(['advisory','enrich','--request','a','--permit','permit.json','--output','b'])).toMatchObject({action:'enrich'});
 for(const args of [['prepare','--task','labels','--output','b'],['prepare','--input','a','--task','routing','--output','b'],['enrich','--request','a','--output','b'],['enrich','--input','a','--permit','x','--output','b']])expect(()=>parseArguments(['advisory',...args])).toThrow();
});
it('keeps questions local unless explicitly prepared and allows only compatible search flags',()=>{
 expect(parseArguments(['advisory','ask','--question','Where is dependency setup?','--input','evidence'])).toMatchObject({action:'ask',flags:{question:'Where is dependency setup?'}});
 expect(parseArguments(['advisory','prepare','--task','search','--question','Find build work','--input','evidence','--output','request'])).toMatchObject({action:'prepare',flags:{task:'search'}});
 for(const args of [['ask'],['ask','--question','q','--enrichment','a','--enrichment','b'],['prepare','--task','search','--input','e','--output','x'],['prepare','--task','labels','--question','q','--input','e','--output','x']])expect(()=>parseArguments(['advisory',...args])).toThrow();
});
it('accepts exact comparison manifests and rejects incompatible preparation arguments',()=>{
 expect(parseArguments(['advisory','compare','--baseline','base.json','--candidate','candidate.json','--format','json'])).toMatchObject({action:'compare',flags:{baseline:'base.json',candidate:'candidate.json'}});
 expect(parseArguments(['advisory','prepare','--task','compare','--baseline','base.json','--candidate','candidate.json','--output','request'])).toMatchObject({action:'prepare'});
 for(const args of [['compare','--baseline','b'],['compare','--baseline','b','--candidate','c','--input','x'],['prepare','--task','compare','--baseline','b','--candidate','c','--input','x','--output','r'],['prepare','--task','labels','--baseline','b','--candidate','c','--output','r'],['prepare','--task','compare','--baseline','b','--candidate','c','--question','why','--output','r']])expect(()=>parseArguments(['advisory',...args])).toThrow();
});
