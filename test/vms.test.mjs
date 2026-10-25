import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {VMS_COUNTRIES,VMS_ACTIONS,validateVmsEvidence,vmsReadiness} from '../shared/vms.mjs';
import {VmsEvidenceStore,inspectVmsSample} from '../server/vms.mjs';
import {JobStore} from '../server/jobs.mjs';
import {hash,validate} from '../server/domain.mjs';
import {start} from '../server/index.mjs';
const evidence={country:'BLZ',product:'Synthetic sample assessment',provider:'Test provider; not an authority claim'};
const csv='\ufeffvessel_code,date,hours,notes\r\n00017,2024-01-01,2.5,"SENSITIVE_VESSEL\nnot retained"\r\n00018,01/02/2024,,other\r\n';
async function fixture(fn){const workspace=await mkdtemp(join(tmpdir(),'vms-evidence-')),jobs=new JobStore(workspace);await jobs.load();try{await fn(new VmsEvidenceStore(workspace,jobs),workspace,jobs);}finally{await jobs.close();await rm(workspace,{recursive:true,force:true});}}
test('country inventory distinguishes publication from commitment and never advertises API/import entitlement',()=>{
 assert.equal(VMS_COUNTRIES.filter(c=>c.evidence==='published').length,10);assert.equal(VMS_COUNTRIES.filter(c=>c.evidence==='commitment').length,3);assert.equal(new Set(VMS_COUNTRIES.map(c=>c.id)).size,13);
 for(const country of VMS_COUNTRIES){assert.match(country.publicAPI,/No public/);assert.equal(country.importAdapter,'Not verified');assert.match(country.download,/unverified/);assert.match(country.source,/^https:\/\//);}
 assert.throws(()=>validate({source:'gfw-vms',start:'2024-01-01',end:'2024-02-01',grid:0.1,interval:'DAILY',bounds:[0,0,1,1]}),/not supported/);
});
test('permission claims require dated evidence and remain independent by action',()=>{
 const unknown=validateVmsEvidence(evidence);assert.ok(Object.values(unknown.permissions).every(s=>s==='unknown'));
 assert.throws(()=>validateVmsEvidence({...evidence,permissions:{download:'allowed'}}),/basis/);
 const allowed=validateVmsEvidence({...evidence,permissions:{view:'allowed'},basis:'Synthetic test evidence',checkedAt:'2024-01-01'});assert.equal(allowed.permissions.view,'allowed');assert.equal(allowed.permissions.download,'unknown');assert.equal(allowed.permissions.redistribute,'unknown');
 assert.throws(()=>validateVmsEvidence({...evidence,sourceUrl:'javascript:alert(1)'}));assert.throws(()=>validateVmsEvidence({...evidence,sourceUrl:'https://user:secret@example.org'}));assert.throws(()=>validateVmsEvidence({...evidence,start:'2024-02-30'}));assert.throws(()=>validateVmsEvidence({...evidence,checkedAt:'9999-01-01'}));
 const unlisted=validateVmsEvidence({...evidence,country:'OTHER',countryName:'Unlisted test fleet'});assert.equal(unlisted.countryName,'Unlisted test fleet');
});
test('CSV inspection preserves the original checksum and retains no data-row values or inferred units',()=>{
 const sample=inspectVmsSample({name:'synthetic.csv',content:csv});assert.equal(sample.sha256,hash(csv));assert.equal(sample.bytes,Buffer.byteLength(csv));assert.equal(sample.rowCount,2);assert.equal(sample.rawDataRetained,false);assert.equal(sample.columns[0].numericText,2);assert.equal(sample.columns[1].isoDateText,1);assert.equal(sample.columns[1].otherText,1);assert.equal(sample.columns[2].empty,1);assert.ok(!JSON.stringify(sample).includes('SENSITIVE_VESSEL'));assert.ok(!JSON.stringify(sample).includes('00017'));
 assert.throws(()=>inspectVmsSample({name:'bad.csv',content:'x,y\n1,2,3'}));assert.throws(()=>inspectVmsSample({name:'too-many.csv',content:'x\n'+'1\n'.repeat(2001)}),/2,000/);assert.throws(()=>inspectVmsSample({name:'duplicate.csv',content:'a,a\n1,2'}));
});
test('readiness records restrictions and missing evidence without enabling an analytical adapter',()=>{
 const sample=inspectVmsSample({name:'synthetic.csv',content:csv}),permissions=Object.fromEntries(Object.keys(VMS_ACTIONS).map(k=>[k,'allowed']));
 const e=validateVmsEvidence({...evidence,permissions,basis:'Synthetic test permission claim',checkedAt:'2024-01-01',units:'hours (unverified fixture)',spatialGrain:'0.1 degree fixture',temporalGrain:'daily fixture',scope:'synthetic test scope'});
 const ready=vmsReadiness({evidence:e,sample});assert.equal(ready.status,'candidate-for-review');assert.equal(ready.adapterSupported,false);
 assert.equal(vmsReadiness({evidence:{...e,permissions:{...e.permissions,retain:'denied'}},sample}).status,'recorded-restriction');assert.equal(vmsReadiness({evidence:validateVmsEvidence(evidence),sample:null}).status,'evidence-incomplete');
});
test('immutable revisions preserve history and reject concurrent stale updates',async()=>fixture(async(store,workspace)=>{
 const first=await store.save({evidence,sample:inspectVmsSample({name:'synthetic.csv',content:csv})});const id=first.record.id;
 const second=await store.save({id,baseRevisionId:first.revision.id,evidence:{...evidence,notes:'New question'},sample:first.revision.sample});assert.equal(second.record.revisions.length,2);assert.equal(second.record.revisions[0].evidence.notes,'');assert.equal((await store.list())[0].id,id);
 await assert.rejects(store.save({id,baseRevisionId:first.revision.id,evidence}),/changed/);
 const results=await Promise.allSettled([store.save({id,baseRevisionId:second.revision.id,evidence}),store.save({id,baseRevisionId:second.revision.id,evidence})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const saved=await readFile(join(workspace,`vms-evidence-${id}.json`),'utf8');assert.ok(!saved.includes('SENSITIVE_VESSEL'));assert.ok(!saved.includes('00017'));
}));
test('portable evidence histories reject tampering, raw-data fields and conflicting identities',async()=>fixture(async(store,workspace,jobs)=>{
 const saved=await store.save({evidence}),record=saved.record,backup={record,sha256:hash(record)};assert.equal((await store.importBackup(backup)).id,record.id);
 const tampered=structuredClone(backup);tampered.record.revisions[0].evidence.notes='changed';await assert.rejects(store.importBackup(tampered),/checksum/);tampered.sha256=hash(tampered.record);await assert.rejects(store.importBackup(tampered),/different/);
 const raw=structuredClone(backup);raw.record.rawCsv=csv;raw.sha256=hash(raw.record);await assert.rejects(store.importBackup(raw),/record/);
}));
test('HTTP evidence workflow stays local, preserves unknowns and never submits a VMS report',async()=>{
 const workspace=await mkdtemp(join(tmpdir(),'vms-evidence-http-'));let app,calls=0;
 try{app=await start({workspace,port:0,fetchImpl:async()=>{calls++;throw Error('VMS evidence must not access GFW');}});assert.equal((await fetch(app.origin+'/api/vms-evidence')).status,401);
 const session=await fetch(app.origin+'/api/session',{method:'POST',headers:{'X-Bootstrap':app.launchUrl.split('#')[1]}}),headers={Cookie:session.headers.get('set-cookie').split(';')[0],'Content-Type':'application/json'};
 const call=(path,body,method=body?'POST':'GET')=>fetch(app.origin+path,{method,headers,body:body?JSON.stringify(body):undefined});
 const sample=await(await call('/api/vms-evidence/inspect',{name:'synthetic.csv',content:csv})).json();const saved=await(await call('/api/vms-evidence',{evidence,sample})).json();assert.equal(saved.readiness.adapterSupported,false);assert.equal(saved.revision.evidence.permissions.download,'unknown');
 const backup=await(await call(`/api/vms-evidence/${saved.record.id}/backup`)).json();assert.ok(!JSON.stringify(backup).includes('SENSITIVE_VESSEL'));assert.equal((await call('/api/vms-evidence/import',backup)).status,201);assert.equal((await call('/api/extract',{source:'gfw-vms'})).status,400);assert.equal((await(await call('/api/jobs')).json()).length,0);assert.equal(calls,0);
 }finally{if(app)await app.close();await rm(workspace,{recursive:true,force:true});}
});
