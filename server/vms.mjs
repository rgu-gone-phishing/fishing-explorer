import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {hash} from './domain.mjs';
import {parseCSV} from '../shared/reference-layers.mjs';
import {validateVmsEvidence,vmsReadiness} from '../shared/vms.mjs';
const uuid=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value);
export function inspectVmsSample(input){
 if(!input||typeof input.content!=='string'||Buffer.byteLength(input.content)>5*1024*1024||typeof input.name!=='string'||!input.name||input.name.length>200)throw Error('Choose a UTF-8 CSV sample up to 5 MiB with a valid filename.');
 const {headers,rows}=parseCSV(input.content);
 if(headers.some(h=>h.length>1000))throw Error('Sample column names must be at most 1,000 characters.');
 const columns=headers.map((name,index)=>{const counts={empty:0,numericText:0,isoDateText:0,otherText:0};for(const row of rows){const value=row[index].trim();if(!value)counts.empty++;else if(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)&&Number.isFinite(Number(value)))counts.numericText++;else if(/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value)counts.isoDateText++;else counts.otherText++;}return {name,...counts};});
 return {schemaVersion:1,name:input.name,sha256:hash(input.content),bytes:Buffer.byteLength(input.content),rowCount:rows.length,columns,inspectedAt:new Date().toISOString(),rawDataRetained:false,note:'Formatting counts only. Numeric-looking identifiers remain text; units, row meaning, rights and scientific validity are not inferred. No row values or original file contents are saved.'};
}
function validateSample(s){
 if(s===null||s===undefined)return null;
 if(s.schemaVersion!==1||typeof s.name!=='string'||!s.name||s.name.length>200||!/^[a-f0-9]{64}$/.test(s.sha256)||!Number.isInteger(s.bytes)||s.bytes<1||s.bytes>5*1024*1024||!Number.isInteger(s.rowCount)||s.rowCount<1||s.rowCount>2000||s.rawDataRetained!==false||!Number.isFinite(Date.parse(s.inspectedAt))||!Array.isArray(s.columns)||s.columns.length<1||s.columns.length>100)throw Error('Invalid sample schema record.');
 const names=new Set();for(const c of s.columns){if(typeof c.name!=='string'||!c.name||c.name.length>1000||names.has(c.name))throw Error('Invalid sample columns.');names.add(c.name);let total=0;for(const field of ['empty','numericText','isoDateText','otherText']){if(!Number.isInteger(c[field])||c[field]<0)throw Error('Invalid sample format counts.');total+=c[field];}if(total!==s.rowCount)throw Error('Sample column counts disagree with its row count.');}
 return {schemaVersion:1,name:s.name,sha256:s.sha256,bytes:s.bytes,rowCount:s.rowCount,columns:s.columns.map(({name,empty,numericText,isoDateText,otherText})=>({name,empty,numericText,isoDateText,otherText})),inspectedAt:s.inspectedAt,rawDataRetained:false,note:'Formatting counts only. Numeric-looking identifiers remain text; units, row meaning, rights and scientific validity are not inferred. No row values or original file contents are saved.'};
}
export class VmsEvidenceStore{
 constructor(workspace,jobs){this.workspace=workspace;this.jobs=jobs;this.locks=new Set();}
 async read(id){if(!uuid(id))throw Error('Invalid VMS evidence ID.');const wrapper=JSON.parse(await readFile(join(this.workspace,`vms-evidence-${id}.json`),'utf8'));if(wrapper.sha256!==hash(wrapper.record))throw Error('VMS evidence integrity check failed.');return this.validate(wrapper.record,id);}
 validate(record,id=record?.id){
  if(record?.schemaVersion!==1||record.type!=='vms-access-evidence'||!uuid(record.id)||record.id!==id||Object.keys(record).some(k=>!['schemaVersion','type','id','revisions'].includes(k))||!Array.isArray(record.revisions)||!record.revisions.length||record.revisions.length>100)throw Error('Invalid VMS evidence record.');
  const ids=new Set();for(const revision of record.revisions){if(Object.keys(revision).some(k=>!['id','createdAt','evidence','sample'].includes(k))||!uuid(revision.id)||ids.has(revision.id)||!Number.isFinite(Date.parse(revision.createdAt))||hash(validateVmsEvidence(revision.evidence))!==hash(revision.evidence)||hash(validateSample(revision.sample))!==hash(revision.sample))throw Error('Invalid VMS evidence revision.');ids.add(revision.id);}
  return record;
 }
 async list(){const result=[];for(const file of await readdir(this.workspace))if(/^vms-evidence-[a-f0-9-]{36}\.json$/.test(file)){try{const record=await this.read(file.slice(13,-5)),revision=record.revisions.at(-1);result.push({id:record.id,revisions:record.revisions.length,revision,readiness:vmsReadiness(revision)});}catch{this.jobs.diagnostics.push({file,error:'VMS evidence record failed validation.'});}}return result.sort((a,b)=>b.revision.createdAt.localeCompare(a.revision.createdAt));}
 async write(record){await this.jobs.atomic(`vms-evidence-${record.id}.json`,{record,sha256:hash(record)});}
 async save(input){
  const id=input.id||randomUUID();if(!uuid(id)||this.locks.has(id))throw Error('Invalid or busy VMS evidence record.');this.locks.add(id);
  try{const record=input.id?await this.read(id):{schemaVersion:1,type:'vms-access-evidence',id,revisions:[]};if(input.id&&record.revisions.at(-1).id!==input.baseRevisionId)throw Error('Evidence changed in another session. Open the latest revision before saving.');if(record.revisions.length>=100)throw Error('Evidence record reached 100 revisions; export and create a new record.');
   const revision={id:randomUUID(),createdAt:new Date().toISOString(),evidence:validateVmsEvidence(input.evidence),sample:validateSample(input.sample)};record.revisions.push(revision);await this.write(record);return {record,revision,readiness:vmsReadiness(revision)};
  }finally{this.locks.delete(id);}
 }
 async importBackup(bundle){
  if(bundle?.sha256!==hash(bundle?.record))throw Error('Invalid VMS evidence backup checksum.');const record=this.validate(bundle.record);if(this.locks.has(record.id))throw Error('This VMS evidence record is busy.');this.locks.add(record.id);
  try{try{const existing=await this.read(record.id);if(hash(existing)!==hash(record))throw Error('A different evidence history already uses this ID.');return existing;}catch(e){if(e.code!=='ENOENT')throw e;}await this.write(record);return record;}finally{this.locks.delete(record.id);}
 }
}
