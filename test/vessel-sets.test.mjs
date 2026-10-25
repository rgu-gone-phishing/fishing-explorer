import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {VesselSetStore} from '../server/vessel-sets.mjs';
import {ExplorerStore} from '../server/explorer.mjs';
import {WorkspaceStore} from '../server/workspaces.mjs';
import {JobStore} from '../server/jobs.mjs';
import {hash} from '../server/domain.mjs';
import {vesselMember,vesselSetContent} from '../shared/vessel-sets.mjs';
import {start} from '../server/index.mjs';
const vesselId='synthetic-member-123',manual=(version='v5.0')=>vesselMember({vesselId,version,label:'Synthetic member',annotation:'Research note',basis:{kind:'manual',citation:'Synthetic fixture for tests'}});
async function fixture(fn){const dir=await mkdtemp(join(tmpdir(),'vessel-sets-')),jobs=new JobStore(dir);await jobs.load();const explorer=new ExplorerStore(dir,jobs,{token:()=> 'private-vessel-set-test-token',fetchImpl:async()=>new Response(JSON.stringify({entries:[{selfReportedInfo:[{id:vesselId,shipname:'SYNTHETIC TEST'}],registryInfo:[{id:'registry-only',shipname:'REGISTRY'}]}],total:1}))});await explorer.load();const sets=new VesselSetStore(dir,jobs,explorer);try{await fn({dir,jobs,explorer,sets});}finally{await jobs.close();await rm(dir,{recursive:true,force:true});}}
test('identity/version keys and user annotations survive without merging identities across versions',()=>{
 const content=vesselSetContent({title:'Research fleet',members:[manual(),manual('v4.0')]});assert.equal(content.members.length,2);assert.equal(content.members[0].annotation,'Research note');
 assert.throws(()=>vesselSetContent({title:'Duplicate',members:[manual(),manual()]}),/Duplicate/);
 for(const member of [{...manual(),vesselId:'../path'},{...manual(),version:'latest'},{...manual(),basis:{kind:'manual',citation:''}},{...manual(),basis:{kind:'lookup',snapshotId:'bad',sha256:'a'.repeat(64)}}])assert.throws(()=>vesselMember(member));
 assert.throws(()=>vesselSetContent({title:'Too many',members:Array(501).fill(manual())}));
});
test('saved lookup members retain exact source identity and hash, with registry IDs rejected',async()=>fixture(async({sets,explorer})=>{
 const lookup=await explorer.create({kind:'search',version:'v5.0',term:'Synthetic'}),member=await sets.fromLookup({lookupId:lookup.id,vesselId});assert.equal(member.basis.snapshotId,lookup.id);assert.equal(member.basis.sha256,hash(lookup));assert.equal(member.label,'SYNTHETIC TEST');assert.equal((await sets.evidence([member]))[0].status,'available');
 await assert.rejects(sets.fromLookup({lookupId:lookup.id,vesselId:'registry-only'}),/registry/);assert.equal((await sets.evidence([{...member,version:'v4.0'}]))[0].status,'mismatch');
}));
test('set revisions are immutable and stale or concurrent saves cannot overwrite history',async()=>fixture(async({sets})=>{
 const first=await sets.save({title:'First',members:[manual()]});const args={id:first.record.id,baseRevisionId:first.revision.id,title:'Second',members:[{...manual(),annotation:'Changed annotation'}]};const results=await Promise.allSettled([sets.save(args),sets.save(args)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);const record=await sets.read(first.record.id);assert.equal(record.revisions.length,2);assert.equal(record.revisions[0].content.members[0].annotation,'Research note');assert.equal(record.revisions[1].content.members[0].annotation,'Changed annotation');await assert.rejects(sets.save(args),/changed/);assert.deepEqual(await sets.revision(first.revision.id),first.revision);
}));
test('portable histories extend an identical prefix and refuse conflicts without overwriting',async()=>fixture(async({sets})=>{
 const first=await sets.save({title:'Original',members:[manual()]}),firstCopy=structuredClone(first.record);const second=await sets.save({id:first.record.id,baseRevisionId:first.revision.id,title:'Revision two',members:[]});
 await fixture(async destination=>{const backup=record=>({record,sha256:hash(record)});await destination.sets.importBackup(backup(firstCopy));await destination.sets.importBackup(backup(second.record));assert.equal((await destination.sets.importBackup(backup(firstCopy))).revisions.length,2);const corrupt=structuredClone(second.record);corrupt.revisions[0].content.title='Changed original';await assert.rejects(destination.sets.importBackup(backup(corrupt)),/Conflicting/);assert.deepEqual(await destination.sets.read(first.record.id),second.record);
  const collision=structuredClone(firstCopy);collision.id=randomUUID();collision.revisions[0].setId=collision.id;await assert.rejects(destination.sets.importBackup(backup(collision)),/another vessel set/);
 });
}));
test('set evidence rebinds only exact portable lookup content and stays explicit when missing',async()=>fixture(async({sets,explorer})=>{
 const lookup=await explorer.create({kind:'search',version:'v5.0',term:'Synthetic'}),member=await sets.fromLookup({lookupId:lookup.id,vesselId}),set=await sets.save({title:'Linked source',members:[member]});await fixture(async dest=>{
  let calls=0;dest.explorer.fetchImpl=async()=>{calls++;throw Error('No upstream request');};await dest.sets.importBackup({record:set.record,sha256:hash(set.record)});assert.equal((await dest.sets.evidence([member]))[0].status,'missing');
  const imported=await dest.explorer.importBackup({snapshot:lookup,sha256:hash(lookup)});assert.equal((await dest.sets.evidence([member]))[0].lookupId,imported.id);assert.equal(calls,0);assert.equal((await dest.sets.evidence([manual()]))[0].status,'manual');
 });
}));
test('corruption, extra fields and configured credentials cannot enter saved set histories',async()=>fixture(async({sets,dir})=>{
 await assert.rejects(sets.save({title:'private-vessel-set-test-token',members:[manual()]}),/credential/);const saved=await sets.save({title:'Valid',members:[manual()]});const malformed=structuredClone(saved.record);malformed.revisions[0].unexpected='data';await assert.rejects(sets.importBackup({record:malformed,sha256:hash(malformed)}),/Invalid/);
 const path=join(dir,`vessel-set-${saved.record.id}.json`),wrapper=JSON.parse(await readFile(path,'utf8'));wrapper.record.revisions[0].content.title='corrupt';await writeFile(path,JSON.stringify(wrapper));await assert.rejects(sets.read(saved.record.id),/integrity/);assert.equal((await sets.list()).length,0);
}));
test('studies retain immutable set revisions and recover exact references after separate import',async()=>fixture(async({sets,dir,jobs,explorer})=>{
 const first=await sets.save({title:'Study selection',members:[manual()]}),studies=new WorkspaceStore(dir,jobs,explorer,{list:()=>[]});studies.vesselSets=sets;const input={title:'Research study',query:{source:'synthetic-activity',start:'2024-01-01',end:'2024-02-01',grid:0.1,interval:'DAILY',bounds:[0,49,2,51]},references:[{kind:'vessel-set',id:first.revision.id,label:'Selected fleet'}],presentation:{activeView:'vessels',vesselSetId:first.revision.id}};const saved=await studies.saveStudy(input);await sets.save({id:first.record.id,baseRevisionId:first.revision.id,title:'Newer selection',members:[]});assert.equal((await studies.openStudy(saved.studyId)).availability[0].status,'available');const plan=await studies.exportStudy(saved.studyId);assert.equal((await studies.library()).filter(r=>r.kind==='vessel-set').length,2);
 await fixture(async dest=>{const target=new WorkspaceStore(dest.dir,dest.jobs,dest.explorer,{list:()=>[]});target.vesselSets=dest.sets;const imported=await target.importStudy(plan);assert.equal(imported.availability[0].status,'missing');await dest.sets.importBackup({record:first.record,sha256:hash(first.record)});const opened=await target.openStudy(imported.studyId);assert.equal(opened.availability[0].status,'available');assert.equal(opened.revision.presentation.vesselSetId,first.revision.id);});
}));
test('HTTP vessel-set operations are session protected and save, export and reopen without upstream calls',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'vessel-sets-http-'));let app,calls=0;try{app=await start({workspace:dir,port:0,fetchImpl:async()=>{calls++;throw Error('No upstream');}});assert.equal((await fetch(app.origin+'/api/vessel-sets')).status,401);const session=await fetch(app.origin+'/api/session',{method:'POST',headers:{'X-Bootstrap':app.launchUrl.split('#')[1]}}),headers={Cookie:session.headers.get('set-cookie').split(';')[0],'Content-Type':'application/json'},call=(path,body)=>fetch(app.origin+path,{headers,method:body?'POST':'GET',body:body?JSON.stringify(body):undefined});const value=await(await call('/api/vessel-sets',{title:'Local set',members:[manual()]})).json();assert.equal(value.revision.content.members.length,1);const opened=await(await call('/api/vessel-sets/'+value.record.id)).json();assert.equal(opened.evidence[0].status,'manual');const backup=await(await call(`/api/vessel-sets/${value.record.id}/backup`)).json();assert.equal(backup.sha256,hash(backup.record));assert.equal((await call('/api/vessel-sets/import',backup)).status,201);assert.equal((await call(`/api/vessel-sets/${value.record.id}?revision=${randomUUID()}`)).status,400);assert.equal(calls,0);
 }finally{if(app)await app.close();await rm(dir,{recursive:true,force:true});}
});
test('concurrent imports cannot assign one revision to different sets',async()=>fixture(async({sets})=>{
 const source=await sets.save({title:'Source',members:[manual()]});await fixture(async target=>{const second=structuredClone(source.record);second.id=randomUUID();second.revisions[0].setId=second.id;const results=await Promise.allSettled([source.record,second].map(record=>target.sets.importBackup({record,sha256:hash(record)})));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await target.sets.list()).length,1);});
}));
