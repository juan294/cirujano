import { isLiteralBranch, isLiteralWorkflowPath } from '@cirujano/core';
import { ArgumentError } from '../args.js';

/** `collect --family skip-validated-push` replaces `--job`/`--run` with `--branch`; without `--family` it is the cache family. */
const pushCollect = ['family','repository','ref','workflow','branch','output'] as const;
const required = {
  collect: ['repository','ref','workflow','job','run','output'],
  diagnose: ['input','config','output'], propose: ['input','diagnosis','output'],
  verify: ['proposal','profile','permit','output'], measure: ['proposal','sandbox','cohort','output'],
  report: ['proposal','sandbox','measurement','output'], publish: ['report','permit'],
  status: ['operation'], cancel: ['operation','permit'],
} as const;
type Action = keyof typeof required;
export interface OptimizeArguments {
  command: 'optimize'; action: Action; flags: Record<string,string|string[]>; format: 'json'|'text';
}
export function parseOptimizeArguments(argv: readonly string[]): OptimizeArguments {
  const [action,...rest] = argv;
  if (!action || !Object.hasOwn(required, action)) throw new ArgumentError('optimize requires collect, diagnose, propose, verify, measure, report, publish, status or cancel.');
  const selected = action as Action;
  const pushFamily = selected==='collect' && rest.includes('--family');
  const requiredFlags: readonly string[] = pushFamily ? pushCollect : required[selected];
  const allowed: readonly string[] = [...requiredFlags, ...(selected==='diagnose'?['permit']:[]), ...(selected==='report'?['base-ref','head-ref']:[]), 'format'];
  const flags: Record<string,string|string[]> = {};
  let format: 'json'|'text' = 'json';
  for(let index=0;index<rest.length;index+=2) {
    const flag=rest[index], value=rest[index+1], key=flag?.slice(2);
    if(!flag?.startsWith('--') || !key || !allowed.includes(key)) throw new ArgumentError(`Unknown option for optimize ${selected}.`);
    if(!value || value.startsWith('-')) throw new ArgumentError(`${flag} requires a value.`);
    if(Object.hasOwn(flags,key) && key!=='run') throw new ArgumentError(`${flag} must occur once.`);
    if(key==='format') {
      if(value!=='json'&&value!=='text') throw new ArgumentError('--format must be json or text.');
      format=value;
    }
    if(key==='run') flags[key]=[...(flags[key] as string[]|undefined??[]),value];
    else flags[key]=value;
  }
  for(const key of requiredFlags) if(!Object.hasOwn(flags,key)) throw new ArgumentError(`optimize ${selected} requires --${key}.`);
  if(pushFamily) {
    if(flags.family!=='skip-validated-push') throw new ArgumentError('--family must be skip-validated-push.');
    if(!isLiteralBranch(flags.branch)) throw new ArgumentError('--branch must be one literal branch name.');
  }
  if(selected==='collect') {
    if(!/^[A-Za-z0-9_-][A-Za-z0-9_.-]*\/[A-Za-z0-9_-][A-Za-z0-9_.-]*$/u.test(String(flags.repository))) throw new ArgumentError('--repository must be owner/name.');
    if(!/^[a-f0-9]{40}$/u.test(String(flags.ref))) throw new ArgumentError('--ref must be a full lowercase commit SHA.');
    if(!isLiteralWorkflowPath(String(flags.workflow))) throw new ArgumentError('--workflow must be a literal GitHub workflow path.');
    if(!pushFamily) {
      if(!/^[A-Za-z_][A-Za-z0-9_-]*$/u.test(String(flags.job))) throw new ArgumentError('--job must be a literal job key.');
      const runs=flags.run as string[];
      if(runs.length>10 || new Set(runs).size!==runs.length || runs.some(run=>!/^\d+$/u.test(run)||!Number.isSafeInteger(Number(run))||Number(run)<1)) throw new ArgumentError('--run requires up to ten distinct positive run IDs.');
    }
  }
  delete flags.format;
  return {command:'optimize',action:selected,flags,format};
}
