import { safeRelativePath } from '@cirujano/core';
import { ArgumentError } from '../args.js';

const options = {
  collect: ['repository','run','attempt','workflow','job-key','job-id','output','source-file'],
  inbox: ['input','enrichment','format','sort'],
  status: ['operation','format'],
  prepare: ['input','task','question','output'],
  ask: ['input','question','enrichment','format'],
  enrich: ['request','permit','output'],
} as const;
export type AdvisoryAction = keyof typeof options;
export interface AdvisoryArguments {
  command:'advisory'; action:AdvisoryAction; flags:Record<string,string>; inputs:string[];
  enrichments:string[]; sourceFiles:string[]; format:'json'|'markdown'|'text'; sort:'duration'|'minutes';
}
export function parseAdvisoryArguments(argv:readonly string[]):AdvisoryArguments {
  const action=argv[0];
  if(!action||!Object.hasOwn(options,action)) throw new ArgumentError('advisory requires collect, inbox, prepare, enrich, ask or status.');
  const allowed:readonly string[]=options[action as AdvisoryAction];
  const flags:Record<string,string>={},inputs:string[]=[],enrichments:string[]=[],sourceFiles:string[]=[];
  for(let i=1;i<argv.length;i+=2){
    const flag=argv[i]?.replace(/^--/,''); const value=argv[i+1];
    if(!argv[i]?.startsWith('--')||!flag||!allowed.includes(flag)||!value||value.startsWith('--')||/[\u0000-\u001f\u007f]/u.test(value)) throw new ArgumentError('advisory received an invalid option or value.');
    if(flag==='input') inputs.push(value);
    else if(flag==='enrichment') enrichments.push(value);
    else if(flag==='source-file') {try{safeRelativePath(value);}catch{throw new ArgumentError('advisory source-file requires a safe relative path.');}sourceFiles.push(value);}
    else { if(Object.hasOwn(flags,flag)) throw new ArgumentError(`Duplicate advisory option --${flag}.`);flags[flag]=value; }
  }
  const required=action==='collect'?['repository','run','attempt','workflow','job-key','job-id','output']:action==='status'?['operation']:action==='prepare'?['task','output']:action==='enrich'?['request','permit','output']:action==='ask'?['question']:[];
  for(const key of required) if(!flags[key]) throw new ArgumentError(`advisory ${action} requires --${key}.`);
  if(action==='prepare'&&(inputs.length===0||!['labels','search'].includes(flags.task!)||(flags.task==='labels'&&flags.question!==undefined)||(flags.task==='search'&&!flags.question)))throw new ArgumentError('advisory prepare requires --input and compatible --task labels|search options (search requires --question).');
  if(flags.question!==undefined&&(!flags.question.trim()||Buffer.byteLength(flags.question)>2048))throw new ArgumentError('advisory question must contain 1–2048 UTF-8 bytes.');
  if(action==='ask'&&enrichments.length>1)throw new ArgumentError('advisory ask accepts one retained enrichment.');
  if(action==='collect'){
    if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(flags.repository!)||flags.repository!.split('/').some(p=>p==='.'||p==='..')) throw new ArgumentError('Invalid advisory repository.');
    for(const key of ['run','attempt','job-id']) if(!/^[1-9]\d*$/u.test(flags[key]!)||!Number.isSafeInteger(Number(flags[key]))) throw new ArgumentError(`Invalid advisory --${key}.`);
    try{safeRelativePath(flags.workflow!);}catch{throw new ArgumentError('Invalid advisory workflow path.');}
    if(!/^\.github\/workflows\/[^/]+\.ya?ml$/u.test(flags.workflow!)||!/^[A-Za-z_][A-Za-z0-9_-]*$/u.test(flags['job-key']!)) throw new ArgumentError('Invalid advisory workflow or job key.');
  }
  if(inputs.length>20||sourceFiles.length>20||enrichments.length>20) throw new ArgumentError('advisory accepts at most 20 inputs, sources or enrichments.');
  const format=flags.format??(action==='status'?'text':'markdown');
  if(format!=='json'&&(action==='status'?format!=='text':format!=='markdown')) throw new ArgumentError('Invalid advisory format.');
  const sort=flags.sort??'duration';if(sort!=='duration'&&sort!=='minutes') throw new ArgumentError('Invalid advisory sort.');
  return {command:'advisory',action:action as AdvisoryAction,flags,inputs,enrichments,sourceFiles,format:format as AdvisoryArguments['format'],sort};
}
