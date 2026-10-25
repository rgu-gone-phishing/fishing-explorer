import {randomUUID} from 'node:crypto';
import {RECOVERY_POLICY,recoveryDelay} from './retry-policy.mjs';
export const recoveryWatchActive=job=>['watching','checking','stopping'].includes(job.recoveryWatch?.status);
export class RecoveryWatcher{
 constructor(store,{now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout,random=Math.random,policy=RECOVERY_POLICY}={}){this.store=store;this.now=now;this.setTimer=setTimer;this.clearTimer=clearTimer;this.random=random;this.policy={...policy};this.timers=new Map();this.running=new Map();this.closed=false;this.suspending=false;}
 stamp(){return new Date(this.now()).toISOString();}
 clear(id){const timer=this.timers.get(id);if(timer!==undefined)this.clearTimer(timer);this.timers.delete(id);}
 async finish(job,reason){this.clear(job.id);const w=job.recoveryWatch;w.status='stopped';w.reason=reason;w.finishedAt=this.stamp();w.nextCheckAt=null;await this.store.persist(job);}
 async restore(job){if(recoveryWatchActive(job))await this.finish(job,'application-restarted');}
 async start(job){
  if(this.closed||this.suspending)throw Error('Recovery checks are stopping. Start again after the connection change.');
  if(job.query.source==='synthetic-activity'||job.status!=='recovery-needed'||job.recovery?.state==='candidate')throw Error('Choose an unresolved job without a candidate awaiting review.');
  if(!this.store.token())throw Error('Connect your personal GFW token before automatic recovery checks.');
  if(this.store.jobs.some(recoveryWatchActive))throw Error('An automatic recovery check is already active in this workspace.');
  const old=job.recoveryWatch;if(old)job.recoveryWatchHistory=[...(job.recoveryWatchHistory||[]),{id:old.id,startedAt:old.startedAt,finishedAt:old.finishedAt,checks:old.checks,reason:old.reason}].slice(-5);
  const at=this.now(),notBefore=Date.parse(job.recovery?.retryAfter?.notBefore)||at;
  job.recoveryWatch={schemaVersion:1,id:randomUUID(),status:'watching',startedAt:this.stamp(),deadlineAt:new Date(at+this.policy.durationMs).toISOString(),checks:0,maxChecks:this.policy.maxChecks,policy:this.policy,nextCheckAt:new Date(Math.max(at,notBefore)).toISOString(),history:[],reason:null};
  await this.store.persist(job);await this.schedule(job);return job;
 }
 async schedule(job){const w=job.recoveryWatch;if(w.status!=='watching'||this.closed)return;if(w.checks>=w.maxChecks)return this.finish(job,'check-budget');if(Date.parse(w.nextCheckAt)>=Date.parse(w.deadlineAt))return this.finish(job,Date.parse(job.recovery?.retryAfter?.notBefore)>=Date.parse(w.deadlineAt)?'provider-wait-exceeds-budget':'time-budget');this.clear(job.id);const watchId=w.id,timer=this.setTimer(()=>this.begin(job.id,watchId),Math.max(0,Date.parse(w.nextCheckAt)-this.now()));timer?.unref?.();this.timers.set(job.id,timer);}
 begin(id,watchId){this.timers.delete(id);if(this.closed||this.running.has(id))return;const job=this.store.get(id);if(job.recoveryWatch?.id!==watchId||job.recoveryWatch.status!=='watching')return;const work=this.tick(job,watchId).catch(async()=>{try{await this.finish(job,'local-check-failed');}catch{job.recoveryWatch.status='stopped';job.recoveryWatch.reason='storage-failed';job.recoveryWatch.nextCheckAt=null;this.store.diagnostics.push({file:`job-${id}.json`,error:'Recovery watch stopped because state could not be saved.'});}}).finally(()=>this.running.delete(id));this.running.set(id,work);return work;}
 async tick(job,watchId){
  const w=job.recoveryWatch;if(this.now()>=Date.parse(w.deadlineAt))return this.finish(job,'time-budget');if(job.status!=='recovery-needed')return this.finish(job,'job-state-changed');
  w.status='checking';w.nextCheckAt=null;w.checks++;await this.store.persist(job);
  if(w.status==='stopping')return this.finish(job,w.reason||'user-stopped');
  await this.store.action(job.id,'recover',{}, {watchId,deadline:Date.parse(w.deadlineAt)});
  const result=job.recovery;w.history.push({at:result?.checkedAt||this.stamp(),state:result?.state||'check-failed',...(result?.failureKind?{failureKind:result.failureKind}:{}),...(result?.httpStatus?{httpStatus:result.httpStatus}:{})});w.history=w.history.slice(-this.policy.maxChecks);
  if(w.status==='stopping'||this.closed)return this.finish(job,w.reason||'server-stopped');
  if(result?.state==='candidate')return this.finish(job,'candidate-awaiting-review');
  if(result?.state==='running'&&!result.parametersMatch)return this.finish(job,'unrelated-running-report');
  if(result?.retryAfter?.status==='unsupported')return this.finish(job,'unsupported-provider-wait');
  if(!(result?.state==='running'&&result.parametersMatch||result?.state==='check-failed'&&result.retryable))return this.finish(job,result?.failureKind||result?.state||'check-failed');
  if(this.now()>=Date.parse(w.deadlineAt))return this.finish(job,'time-budget');
  const next=Math.max(this.now()+recoveryDelay(w.checks,this.random,this.policy),Date.parse(result.retryAfter?.notBefore)||0);w.status='watching';w.nextCheckAt=new Date(next).toISOString();await this.store.persist(job);
  if(w.status==='stopping')return this.finish(job,w.reason||'user-stopped');await this.schedule(job);
 }
 async stop(job,reason='user-stopped'){this.clear(job.id);if(!recoveryWatchActive(job))return job;const work=this.running.get(job.id);job.recoveryWatch.reason=reason;if(work){job.recoveryWatch.status='stopping';job.recoveryWatch.nextCheckAt=null;this.store.controllers.get(job.id)?.abort();await this.store.persist(job);await work;}else await this.finish(job,reason);return job;}
 async stopAll(reason='credentials-changed'){this.suspending=true;try{await Promise.all(this.store.jobs.filter(recoveryWatchActive).map(job=>this.stop(job,reason)));}finally{this.suspending=false;}}
 async close(){this.closed=true;await this.stopAll('server-stopped');}
}
