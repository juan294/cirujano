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
