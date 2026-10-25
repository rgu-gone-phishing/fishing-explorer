import {RecoveryWatcher,recoveryWatchActive} from './recovery-watch.mjs';
import {randomUUID} from 'node:crypto';
import {readFile,readdir,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {validate,makeArtifact,verifyArtifact,archive,hash} from './domain.mjs';
import {archiveDirectory,archiveDirectories} from './archive-paths.mjs';
import {fetchReport,checkLastReport,parseReport,reportRequest} from './gfw.mjs';
const live = job => job.query.source !== 'synthetic-activity';
const busyStates = new Set(['queued','running','checking-recovery','recovery-needed']);
const retryable = new Set(['failed','needs-authentication','rate-limited','incomplete','paused','cancelled','abandoned']);

export class JobStore {
  constructor(workspace, {fetchImpl=fetch, token=()=>'',recoveryWatch={}}={}) {
    this.workspace=workspace;this.fetchImpl=fetchImpl;this.token=token;this.jobs=[];
    this.writes=new Map();this.queue=Promise.resolve();this.controllers=new Map();this.actions=new Set();this.diagnostics=[];this.closing=false;this.pendingSubmissions=new Set();this.recoveryWatcher=new RecoveryWatcher(this,recoveryWatch);
  }
  async atomic(name,value){
    const path=join(this.workspace,name),content=JSON.stringify(value,null,2);
    const work=(this.writes.get(name)||Promise.resolve()).catch(()=>{}).then(async()=>{const temp=path+'.'+randomUUID()+'.tmp';await writeFile(temp,content,{mode:0o600});await rename(temp,path);});
    this.writes.set(name,work);const clear=()=>{if(this.writes.get(name)===work)this.writes.delete(name);};work.then(clear,clear);return work;
  }
  async persist(job){await this.atomic(`job-${job.id}.json`,job);}
  async load(){
    const locations=[{directory:this.workspace}];
    for(const id of await archiveDirectories(this.workspace)){
      try{const directory=archiveDirectory(this.workspace,id),batch=JSON.parse(await readFile(join(directory,'batch.json'),'utf8')),query=validate(batch.query,{maxDays:20*366});if(batch.id!==id||batch.queryHash!==hash(query)||!batch.importedArchive)throw Error('Invalid imported batch');locations.push({directory,id,batch,query});}
      catch{this.diagnostics.push({file:`imported-batches/${id}/batch.json`,error:'Imported batch metadata could not be validated.'});}
    }
    for(const location of locations)for(const file of await readdir(location.directory))if(/^job-[a-f0-9-]+\.json$/.test(file)){
      try{
        const job=JSON.parse(await readFile(join(location.directory,file),'utf8'));
        if(location.id){const part=location.batch.parts.find(p=>p.jobId===job.id&&p.status==='complete'),window=job.queryWindow;if(job.archiveDirectory!==location.id||job.batchId!==location.id||job.status!=='complete'||!part||window?.start!==part.start||window?.end!==part.end)throw Error('Invalid imported chunk association');const days=(Date.parse(window.end)-Date.parse(window.start))/86400000;if(!Number.isFinite(days)||days<1||days>(location.query.source==='synthetic-activity'?31:366)||window.start<location.query.start||window.end>location.query.end)throw Error('Invalid imported chunk window');job.query={...location.query,start:window.start,end:window.end};}
        else{if(job.archiveDirectory)throw Error('Imported chunk pointer must live inside its archive.');validate(job.query);}
        if(!job.id || file!==`job-${job.id}.json`)throw Error('Invalid job identity');
        if(job.status==='queued'){job.status='paused';job.error='Queued work was not submitted before shutdown. Resume explicitly.';await this.persist(job).catch(()=>this.diagnostics.push({file,error:'Restored job state could not be saved; the job remains visible for review.'}));}
        else if(['running','checking-recovery'].includes(job.status)){job.status=live(job)?'recovery-needed':'incomplete';job.error='Interrupted after work began. Review upstream state before retrying.';await this.persist(job).catch(()=>this.diagnostics.push({file,error:'Restored job state could not be saved; unresolved upstream work remains blocked.'}));}
        await this.recoveryWatcher.restore(job).catch(()=>this.diagnostics.push({file,error:'Recovery watch stopped in memory but could not save its restart state. No checks resumed.'}));
        if(this.jobs.some(j=>j.id===job.id))throw Error('Duplicate job identity');this.jobs.push(job);
      }catch{this.diagnostics.push({file,error:'Job record could not be read or validated. It was not treated as complete.'});}
    }
  }
  artifactPath(id){const job=this.get(id);return join(job.archiveDirectory?archiveDirectory(this.workspace,job.archiveDirectory):this.workspace,`artifact-${id}.json`);}
  list(){return this.jobs.slice().sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));}
  get(id){const job=this.jobs.find(j=>j.id===id);if(!job)throw Error('Job not found.');return job;}
  async submit(input,options={}){const work=this.submitReserved(input,options);this.pendingSubmissions.add(work);try{return await work;}finally{this.pendingSubmissions.delete(work);}}
  async submitReserved(input,{parentId,id:providedId,batchId}={}){
    if(this.closing)throw Error('Server is shutting down.');
    const query=validate(input);
    if(query.source!=='synthetic-activity'){
      if(!this.token())throw Error('Connect your personal GFW API token first.');
      if(this.jobs.some(j=>live(j)&&busyStates.has(j.status)))throw Error('An upstream report is active or needs recovery. Review it before another submission.');
    }
    if(providedId&&(!/^[a-f0-9-]{36}$/.test(providedId)||this.jobs.some(j=>j.id===providedId)))throw Error('Invalid or duplicate reserved job ID.');
    const job={id:providedId||randomUUID(),query,status:'queued',createdAt:new Date().toISOString(),...(parentId?{parentId}:{}),...(batchId?{batchId}:{})};
    // Reserve synchronously before disk I/O, including concurrent browser submissions.
    this.jobs.push(job);
    try{await this.persist(job);}catch(error){this.jobs.splice(this.jobs.indexOf(job),1);throw error;}
    if(this.closing){job.status='paused';job.error='Application stopped before submission. Resume explicitly.';await this.persist(job);return job;}
    this.queue=this.queue.then(()=>this.run(job));
    return job;
  }
  async run(job){
    if(job.status!=='queued')return;
    if(this.closing){job.status='paused';job.error='Application stopped before submission. Resume explicitly.';await this.persist(job).catch(()=>this.diagnostics.push({file:`job-${job.id}.json`,error:'Queued job was not submitted; paused state could not be saved.'}));return;}
    const controller=new AbortController();this.controllers.set(job.id,controller);
    try{
      job.status='running';job.startedAt=new Date().toISOString();await this.persist(job);
      const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(115000)]);
      const artifact=live(job)?await fetchReport(job.query,job.id,this.token(),{fetchImpl:this.fetchImpl,signal,createdAt:job.createdAt}):makeArtifact(job.query,job.id,job.createdAt);
      await this.atomic(`artifact-${job.id}.json`,artifact);
      job.status='complete';job.rows=artifact.rows.length;delete job.error;
    }catch(error){job.status=error.state||'failed';if(error.retryAfter)job.retryAfter=error.retryAfter;job.error=error.code?'Local storage operation failed. Check disk space and permissions.':error.message;}
    finally{this.controllers.delete(job.id);try{await this.persist(job);}catch{this.diagnostics.push({file:`job-${job.id}.json`,error:'Job state could not be saved. Check workspace storage.'});}}
  }
  async artifact(id){const job=this.get(id);if(job.status!=='complete')throw Error('Complete artifact not found.');return verifyArtifact(JSON.parse(await readFile(this.artifactPath(id),'utf8')));}
  async import(artifact){
    verifyArtifact(artifact);const job={id:randomUUID(),query:artifact.query,status:'complete',createdAt:new Date().toISOString(),rows:artifact.rows.length,importedFrom:artifact.manifest.id};
    await this.atomic(`artifact-${job.id}.json`,artifact);await this.persist(job);this.jobs.push(job);return job;
  }
  async candidate(id){
    const job=this.get(id);if(job.status!=='recovery-needed'||job.recovery?.state!=='candidate')throw Error('No reviewable candidate for this job.');
    const candidate=JSON.parse(await readFile(join(this.workspace,`candidate-${id}.json`),'utf8'));
    const parsed=parseReport(candidate.raw,job.query,candidate.responseVersion);
    return {candidateHash:hash({candidate,queryHash:hash(job.query),checkedAt:job.recovery.checkedAt}),checkedAt:job.recovery.checkedAt,requestedQuery:job.query,reportedVersion:parsed.responseVersion,sampleRows:parsed.rows.slice(0,10),summary:job.recovery.summary,warning:job.recovery.message};
  }
  async action(id,action,input={},context={}){
    if(action==='stop-recovery-watch')return this.recoveryWatcher.stop(this.get(id));
    if(this.closing)throw Error('Server is shutting down.');
    if(this.actions.has(id))throw Error('This job already has an action in progress.');
    this.actions.add(id);
    try{
      const job=this.get(id);
      if(action==='watch-recovery')return await this.recoveryWatcher.start(job);
      if(recoveryWatchActive(job)&&context.watchId!==job.recoveryWatch.id)throw Error('Stop automatic checks before another recovery action.');
      if(action==='retry'){
        if(!retryable.has(job.status))throw Error('Reconcile upstream completion before retrying this job.');
        if(Date.parse(job.retryAfter?.notBefore)>this.recoveryWatcher.now())throw Error(`Provider requested waiting until ${job.retryAfter.notBefore} before a new attempt.`);
        return await this.submit(job.query,{parentId:id});
      }
      if(action==='pause'){
        if(job.status!=='queued')throw Error('Only queued work can be paused. Stop waiting for an active request separately.');
        job.status='paused';await this.persist(job);return job;
      }
      if(action==='cancel'){
        if(job.status==='queued'||job.status==='paused'){job.status='cancelled';job.error='Cancelled locally before submission.';await this.persist(job);return job;}
        if(job.status!=='running')throw Error('This job is not running.');
        this.controllers.get(id)?.abort();return {id,status:'stop-requested',message:'Local transfer stopped. This does not cancel processing at GFW. Check recovery next.'};
      }
      if(action==='recover'){
        if(job.status!=='recovery-needed')throw Error('This job does not need upstream recovery.');
        if(!this.token())throw Error('Connect your personal GFW token before checking recovery.');
        if(Date.parse(job.recovery?.retryAfter?.notBefore)>this.recoveryWatcher.now())throw Error(`Provider requested waiting until ${job.recovery.retryAfter.notBefore} before another recovery check.`);
        const controller=new AbortController();this.controllers.set(id,controller);job.status='checking-recovery';
        try{
          await this.persist(job);
          const timeout=Math.max(1,Math.min(20000,context.deadline?context.deadline-this.recoveryWatcher.now():20000)),signal=AbortSignal.any([controller.signal,AbortSignal.timeout(timeout)]);
          const result=await checkLastReport(job.query,this.token(),{fetchImpl:this.fetchImpl,signal,now:this.recoveryWatcher.now});
          if(controller.signal.aborted)throw Object.assign(Error('Recovery check stopped locally. Original completion remains unresolved.'),{failureKind:'interrupted',retryable:false});
          const {raw,responseVersion,...publicResult}=result;
          if(raw!==undefined)await this.atomic(`candidate-${id}.json`,{raw,responseVersion});
          job.recovery={...publicResult,checkedAt:new Date(this.recoveryWatcher.now()).toISOString()};job.error=result.message;
        }catch(error){job.recovery={state:'check-failed',checkedAt:new Date(this.recoveryWatcher.now()).toISOString(),message:error.code?'Local recovery storage operation failed.':error.message,failureKind:error.failureKind||'local-or-response',retryable:error.retryable===true,...(error.httpStatus?{httpStatus:error.httpStatus}:{}),...(error.retryAfter?{retryAfter:error.retryAfter}:{})};job.error=job.recovery.message;}
        finally{this.controllers.delete(id);job.status='recovery-needed';await this.persist(job);}
        return job;
      }
      if(action==='accept-recovery'){
        if(job.status!=='recovery-needed'||job.recovery?.state!=='candidate'||input.confirmOwnership!==true)throw Error('Review a recovery candidate and explicitly confirm ownership first.');
        const candidate=JSON.parse(await readFile(join(this.workspace,`candidate-${id}.json`),'utf8'));
        if(input.candidateHash!==hash({candidate,queryHash:hash(job.query),checkedAt:job.recovery.checkedAt}))throw Error('The candidate or query changed, or has not been reviewed. Open the candidate again before acceptance.');
        const parsed=parseReport(candidate.raw,job.query,candidate.responseVersion);
        const request={...reportRequest(job.query),recovery:{association:'user-confirmed; not established by provider metadata',candidateHash:input.candidateHash,checkedAt:job.recovery.checkedAt,acceptedAt:new Date().toISOString()}};
        const artifact=archive(job.query,id,parsed.rows,{createdAt:job.createdAt,raw:candidate.raw,responseVersion:parsed.responseVersion,request,receivedAt:job.recovery.checkedAt});
        // The retained manifest explicitly distinguishes manual association from provider proof.
        await this.atomic(`artifact-${id}.json`,artifact);job.status='complete';job.rows=parsed.rows.length;delete job.error;job.recovery.acceptedAt=request.recovery.acceptedAt;await this.persist(job);return job;
      }
      if(action==='release'){
        if(job.status!=='recovery-needed'||input.confirmRemoteReview!==true)throw Error('Review remote activity and explicitly acknowledge unresolved completion first.');
        job.status='abandoned';job.error='Closed locally after user review. Upstream completion was not established; no remote cancellation was issued.';
        job.closedAt=new Date().toISOString();await this.persist(job);return job;
      }
      throw Error('Unknown job action.');
    }finally{this.actions.delete(id);}
  }
  async close(){if(this.closePromise)return this.closePromise;this.closing=true;this.closePromise=(async()=>{for(const controller of this.controllers.values())controller.abort();await this.recoveryWatcher.close().catch(()=>this.diagnostics.push({file:'recovery-watch',error:'Automatic checks stopped; shutdown state could not be saved.'}));await Promise.allSettled([...this.recoveryWatcher.running.values()]);await Promise.allSettled([...this.pendingSubmissions]);await this.queue;await Promise.allSettled([...this.writes.values()]);})();return this.closePromise;}
}
