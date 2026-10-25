import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {hash} from './domain.mjs';
import {vesselSetContent,vesselMember,VESSEL_SET_CAVEAT} from '../shared/vessel-sets.mjs';
import {list,vesselLabel} from '../shared/explorer.mjs';
const uuid=s=>typeof s==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(s);
const time=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(s)&&Number.isFinite(Date.parse(s));
const MAX_BYTES=16*1024*1024;
function lookupMember(snapshot,vesselId){let label=vesselId;
  if(!snapshot.entries.length)throw Error('No returned identity evidence in this lookup.');
  if(['search','detail'].includes(snapshot.query.kind)){const vessel=snapshot.entries.find(v=>list(v.selfReportedInfo).some(r=>r.id===vesselId));if(!vessel)throw Error('Choose an AIS identity returned in this lookup; registry IDs are not AIS identities.');label=vesselLabel(vessel).name;}
  else throw Error('Open a saved identity or search result to add an observed AIS identity.');
  return vesselMember({vesselId,version:snapshot.query.version,label,annotation:'',basis:{kind:'lookup',snapshotId:snapshot.id,sha256:hash(snapshot)}});
}
export class VesselSetStore{
 constructor(workspace,jobs,explorer){this.workspace=workspace;this.jobs=jobs;this.explorer=explorer;this.locks=new Set();}
 validate(record,id=record?.id){
  if(record?.schemaVersion!==1||record.type!=='vessel-set-history'||!uuid(record.id)||record.id!==id||!Array.isArray(record.revisions)||!record.revisions.length||record.revisions.length>100||Object.keys(record).some(k=>!['schemaVersion','type','id','revisions'].includes(k))||Buffer.byteLength(JSON.stringify(record))>MAX_BYTES)throw Error('Invalid or oversized vessel-set history.');
  const ids=new Set();for(const r of record.revisions){if(!r||!uuid(r.id)||ids.has(r.id)||r.setId!==id||!time(r.createdAt)||r.caveat!==VESSEL_SET_CAVEAT||Object.keys(r).some(k=>!['id','setId','createdAt','content','caveat'].includes(k))||hash(vesselSetContent(r.content))!==hash(r.content))throw Error('Invalid vessel-set revision.');ids.add(r.id);}return record;
 }
 async read(id){if(!uuid(id))throw Error('Invalid vessel-set ID.');const wrapper=JSON.parse(await readFile(join(this.workspace,`vessel-set-${id}.json`),'utf8'));if(wrapper.sha256!==hash(wrapper.record))throw Error('Vessel-set integrity check failed.');return this.validate(wrapper.record,id);}
 async records(){const result=[];for(const file of await readdir(this.workspace))if(/^vessel-set-[a-f0-9-]{36}\.json$/.test(file))try{result.push(await this.read(file.slice(11,-5)));}catch{this.jobs.diagnostics.push({file,error:'Vessel-set history failed validation.'});}return result;}
 async list(){return (await this.records()).map(r=>({id:r.id,revisions:r.revisions.map(v=>({id:v.id,title:v.content.title,createdAt:v.createdAt,members:v.content.members.length}))}));}
 async revision(id){if(!uuid(id))throw Error('Invalid vessel-set revision.');for(const record of await this.records()){const r=record.revisions.find(r=>r.id===id);if(r)return r;}throw Error('Vessel-set revision is unavailable.');}
 async write(record){this.validate(record);const token=this.explorer.token?.();if(token&&JSON.stringify(record).includes(token))throw Error('Configured credential material cannot be saved in vessel sets.');await this.jobs.atomic(`vessel-set-${record.id}.json`,{record,sha256:hash(record)});}
 async save(input){const id=input.id||randomUUID();if(!uuid(id)||this.locks.has(id))throw Error('Invalid or busy vessel set.');this.locks.add(id);
  try{const record=input.id?await this.read(id):{schemaVersion:1,type:'vessel-set-history',id,revisions:[]};if(input.id&&input.baseRevisionId!==record.revisions.at(-1)?.id)throw Error('Vessel set changed. Reopen its latest revision before saving.');const revision={id:randomUUID(),setId:id,createdAt:new Date().toISOString(),content:vesselSetContent(input),caveat:VESSEL_SET_CAVEAT};record.revisions.push(revision);await this.write(record);return {record,revision};}finally{this.locks.delete(id);}
 }
 async importBackup(bundle){if(bundle?.sha256!==hash(bundle?.record))throw Error('Vessel-set backup checksum failed.');const incoming=this.validate(bundle.record);if(this.locks.has(incoming.id)||this.locks.has('import'))throw Error('Vessel-set import is busy.');this.locks.add(incoming.id);this.locks.add('import');
  try{let existing;try{existing=await this.read(incoming.id);}catch(e){if(e.code!=='ENOENT')throw e;}if(existing){const count=Math.min(existing.revisions.length,incoming.revisions.length);for(let i=0;i<count;i++)if(hash(existing.revisions[i])!==hash(incoming.revisions[i]))throw Error('Conflicting vessel-set histories. Open the source separately and save a new set; existing revisions were preserved.');if(existing.revisions.length>=incoming.revisions.length)return existing;}
   const revisionIds=new Set(incoming.revisions.map(r=>r.id));for(const record of await this.records())if(record.id!==incoming.id&&record.revisions.some(r=>revisionIds.has(r.id)))throw Error('Revision ID already belongs to another vessel set.');
   await this.write(incoming);return incoming;
  }finally{this.locks.delete(incoming.id);this.locks.delete('import');}
 }
 async fromLookup({lookupId,vesselId}){return lookupMember(await this.explorer.get(lookupId),vesselId);}
 async evidence(members){const cache=new Map();return Promise.all(members.map(async m=>{
  if(m.basis.kind==='manual')return {status:'manual',note:'User-supplied citation; identity not verified locally.'};
  const key=m.basis.snapshotId+':'+m.basis.sha256;if(!cache.has(key))cache.set(key,(async()=>{for(const c of this.explorer.list().filter(c=>c.id===m.basis.snapshotId||c.originalId===m.basis.snapshotId))try{const s=await this.explorer.get(c.id);if(hash(s)===m.basis.sha256)return {snapshot:s,id:c.id};}catch{}return null;})());
  const found=await cache.get(key);if(!found)return {status:'missing',note:'Exact source lookup unavailable. Import its separate archive to inspect it.'};
  try{const verified=lookupMember(found.snapshot,m.vesselId);if(verified.version!==m.version)throw Error();return {status:'available',lookupId:found.id,note:'Exact source lookup available; annotation remains user supplied.'};}catch{return {status:'mismatch',note:'Recorded lookup does not support this identity/version.'};}
 }));}
}
