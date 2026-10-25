import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Readable} from 'node:stream';
import {deflateRawSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {validate,archive,hash,verifyArtifact} from '../server/domain.mjs';
import {encodeCSV,CSV_TRANSFORM} from '../server/csv.mjs';
import {handoffDocumentation} from '../server/handoff-docs.mjs';
import {buildExtractPackage,ExtractPackageImporter,sourceBundleBytes,documentationContext} from '../server/extract-package.mjs';
import {zipEntries,crc32} from '../server/zip.mjs';
import {ZipReader} from '../server/zip-reader.mjs';
import {JobStore} from '../server/jobs.mjs';
import {start} from '../server/index.mjs';
const input={source:'gfw-fishing',datasetVersion:'v5.0',start:'2024-01-01',end:'2024-01-03',grid:0.1,interval:'DAILY',grouping:'VESSEL_ID',bounds:[-2,49,-1,50]};
function fixtureArtifact(){return archive(validate(input),'original-fixture',[{date:'2024-01-01',lat:49.5,lon:-1.5,hours:0,vesselId:'00123'},{date:'2024-01-02',lat:49.5,lon:-1.5,hours:1.5,vesselId:' \t=2+2'}],{createdAt:'2024-02-01T00:00:00.000Z',raw:'{ "entries": "synthetic test payload, not real observations" }\n'});}
async function workspace(fn,options={}){const dir=await mkdtemp(join(tmpdir(),'handoff-test-')),jobs=new JobStore(dir,options);await jobs.load();try{await fn({dir,jobs,importer:new ExtractPackageImporter(dir,jobs)});}finally{await jobs.close();await rm(dir,{recursive:true,force:true});}}
async function zip(entries){const parts=[];for await(const b of zipEntries(entries))parts.push(b);return Buffer.concat(parts);}
// Independent ZIP32 writer exercises Deflate and fixed local headers.
function deflated(entries){const parts=[],central=[];let offset=0;for(const e of entries){const name=Buffer.from(e.name),data=deflateRawSync(e.data),crc=crc32(e.data),local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(8,8);local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(e.data.length,22);local.writeUInt16LE(name.length,26);parts.push(local,name,data);const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(8,10);c.writeUInt32LE(crc,16);c.writeUInt32LE(data.length,20);c.writeUInt32LE(e.data.length,24);c.writeUInt16LE(name.length,28);c.writeUInt32LE(offset,42);central.push(c,name);offset+=30+name.length+data.length;}const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...parts,directory,end]);}
test('spreadsheet copy escapes whitespace/control-prefixed formulas and preserves negative numbers and original strings',()=>{
 for(const value of ['=2+2','  +2+2','\uFEFF@SUM(1)','\t123','\r123','\n123','  -SUM(1)',' \t=2+2'])assert.equal(encodeCSV(value),`"'${value}"`);
 for(const value of [-1,-1e-10,'-2.5e+6','00123'])assert.equal(encodeCSV(value),`"${value}"`);
 assert.equal(encodeCSV('a"b,c'),'"a""b,c"');
 const a=fixtureArtifact();assert.equal(a.rows[1].vesselId,' \t=2+2');assert.equal(a.manifest.provenance.csvTransform,CSV_TRANSFORM);assert.ok(a.files['data.csv'].includes('"\' \t=2+2"'));
 const changed=structuredClone(a);changed.files['data.csv']=changed.files['data.csv'].replace('00123','DIFFERENT');changed.manifest.files['data.csv']={bytes:Buffer.byteLength(changed.files['data.csv']),sha256:hash(changed.files['data.csv'])};assert.throws(()=>verifyArtifact(changed),/CSV values/);
});
test('dictionary keeps source-specific units, exact scope, missingness and unrecorded retrieval time explicit',()=>{
 for(const [source,grouping,field] of [['gfw-fishing','VESSEL_ID','hours'],['gfw-presence','FLAG','hours'],['gfw-sar','NONE','detections']]){const q=validate({...input,source,grouping}),docs=handoffDocumentation(q,{createdAt:'2024-02-01T00:00:00.000Z'}),d=JSON.parse(docs['data-dictionary.json']);assert.equal(d.fields.at(-1).name,field);assert.equal(d.units,q.metric);assert.match(d.missingness,/not an implicit zero/);assert.match(docs['query-summary.txt'],/Not separately recorded; packaging time is not a retrieval date/);assert.match(docs['query-summary.txt'],/exclusive/);assert.match(docs['use-conditions.txt'],/grants no additional permission/);}
 const a=fixtureArtifact();a.manifest.provenance.receivedAt='2024-02-02T00:00:00.000Z';a.manifest.provenance.request={recovery:{acceptedByUser:true}};const docs=handoffDocumentation(a.query,documentationContext(a));assert.match(docs['source-citation.txt'],/2024-02-02/);assert.match(docs['query-summary.txt'],/RECOVERY ASSOCIATION/);
});
test('legacy original files retain exact bytes and hashes alongside a separately documented safer CSV',async()=>{
 const a=fixtureArtifact();delete a.manifest.provenance.csvTransform;a.files['data.csv']=a.files['data.csv'].replace("' \t=2+2"," \t=2+2");a.manifest.files['data.csv']={bytes:Buffer.byteLength(a.files['data.csv']),sha256:hash(a.files['data.csv'])};verifyArtifact(a);const sourceBytes=Buffer.from(JSON.stringify(a)+'\n\n'),bundle=buildExtractPackage(a,sourceBytes),files=new Map(bundle.entries.map(e=>[e.name,e.data]));assert.ok(files.get('source.bundle.json').equals(sourceBytes));assert.equal(files.get('data.csv').toString(),a.files['data.csv']);assert.notEqual(files.get('spreadsheet-data.csv').toString(),a.files['data.csv']);assert.deepEqual(JSON.parse(files.get('manifest.json')),a.manifest);assert.match(files.get('data-dictionary.json').toString(),/legacy\/unspecified/);
 for(const bytes of [await zip(bundle.entries),deflated(bundle.entries)])await workspace(async({jobs,importer})=>{const job=await importer.receive(Readable.from([bytes]));assert.equal(job.importedFrom,a.manifest.id);assert.deepEqual(await jobs.artifact(job.id),a);assert.deepEqual(JSON.parse(await sourceBundleBytes(jobs,job.id,a)),a);});
});
test('every member is checked before import, including documents with self-consistent altered package checksums',async()=>{
 const a=fixtureArtifact();for(const name of ['spreadsheet-data.csv','query-summary.txt','data-dictionary.json','upstream-response.json','boundary.geojson'])await workspace(async({dir,jobs,importer})=>{const bundle=buildExtractPackage(a),e=bundle.entries.find(e=>e.name===name);e.data=Buffer.from('Changed source or documentation');bundle.manifest.files[name]={bytes:e.data.length,sha256:createHash('sha256').update(e.data).digest('hex')};bundle.entries[0].data=Buffer.from(JSON.stringify(bundle.manifest));await assert.rejects(importer.receive(Readable.from([await zip(bundle.entries)])),/disagrees|differs/);assert.equal(jobs.jobs.length,0);assert.deepEqual(await readdir(dir),[]);assert.equal(importer.busy,false);});
});
test('unknown versions, missing files, unlisted source files and unsafe entries fail without promoting an extract',async()=>{
 const a=fixtureArtifact(),extra=structuredClone(a);extra.files['caveats-extra.txt']='unverified';assert.throws(()=>buildExtractPackage(extra),/Unsupported additional/);
 const variants=[];let p=buildExtractPackage(a);p.manifest.documentationVersion=999;p.entries[0].data=Buffer.from(JSON.stringify(p.manifest));variants.push(p.entries);p=buildExtractPackage(a);variants.push(p.entries.filter(e=>e.name!=='boundary.geojson'));p=buildExtractPackage(a);variants.push([...p.entries,{name:'unexpected.txt',data:Buffer.from('x')}]);p=buildExtractPackage(a);variants.push([...p.entries,{name:'../outside.txt',data:Buffer.from('x')}]);
 for(const entries of variants)await workspace(async({dir,jobs,importer})=>{await assert.rejects(importer.receive(Readable.from([deflated(entries)])),/Unsupported|differ|Unexpected|unsafe/);assert.equal(jobs.jobs.length,0);assert.deepEqual(await readdir(dir),[]);});
});
test('configured credential echo, cancelled uploads and expanded size limits cannot become saved extracts',async()=>{
 const secret='private-test-credential';await workspace(async({dir,jobs,importer})=>{const a=fixtureArtifact();a.rows[0].vesselId=secret;const echoed=archive(a.query,a.manifest.id,a.rows);await assert.rejects(importer.receive(Readable.from([await zip(buildExtractPackage(echoed).entries)])),/credential material/);const controller=new AbortController();controller.abort();await assert.rejects(importer.receive(Readable.from([Buffer.from('incomplete')]),{signal:controller.signal}));assert.deepEqual(await readdir(dir),[]);assert.equal(jobs.jobs.length,0);assert.equal(importer.busy,false);},{token:()=>secret});
 await workspace(async({dir})=>{const bytes=deflated(buildExtractPackage(fixtureArtifact()).entries);let offset=0;for(let i=0;i<2;i++){offset=bytes.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]),offset);const local=bytes.readUInt32LE(offset+42);bytes.writeUInt32LE(140*1024*1024,offset+24);bytes.writeUInt32LE(140*1024*1024,local+22);offset+=46;}const path=join(dir,'oversized.zip');await writeFile(path,bytes);await assert.rejects(ZipReader.open(path,{profile:'extract'}),/Expanded ZIP/);});
});
test('HTTP documented export and second-installation import require a local session and make no upstream calls',async()=>{
 const dirs=await Promise.all([mkdtemp(join(tmpdir(),'handoff-http-source-')),mkdtemp(join(tmpdir(),'handoff-http-dest-'))]),apps=[];let calls=0;try{
  for(const workspace of dirs)apps.push(await start({workspace,port:0,fetchImpl:async()=>{calls++;throw Error('No network expected');}}));
  const headers=[];for(const app of apps){assert.equal((await fetch(app.origin+'/api/import-extract-package',{method:'POST'})).status,401);const r=await fetch(app.origin+'/api/session',{method:'POST',headers:{'X-Bootstrap':app.launchUrl.split('#')[1]}});headers.push({Cookie:r.headers.get('set-cookie').split(';')[0]});}
  const source=fixtureArtifact(),submitted=await fetch(apps[0].origin+'/api/import',{method:'POST',headers:{...headers[0],'Content-Type':'application/json'},body:JSON.stringify(source)});assert.equal(submitted.status,201);const job=await submitted.json();const docs=await fetch(apps[0].origin+`/api/artifacts/${job.id}/documentation`,{headers:headers[0]});assert.equal(docs.status,200);assert.match((await docs.json())['query-summary.txt'],/Not separately recorded/);const download=await fetch(apps[0].origin+`/api/artifacts/${job.id}/package`,{headers:headers[0]});assert.equal(download.status,200);assert.equal(download.headers.get('content-type'),'application/zip');const bytes=Buffer.from(await download.arrayBuffer()),imported=await fetch(apps[1].origin+'/api/import-extract-package',{method:'POST',headers:{...headers[1],'Content-Type':'application/zip'},body:bytes});assert.equal(imported.status,201);const second=await imported.json(),reopened=await(await fetch(apps[1].origin+`/api/artifacts/${second.id}`,{headers:headers[1]})).json();assert.deepEqual(reopened,source);assert.equal(calls,0);
 }finally{for(const app of apps)await app.close();for(const dir of dirs)await rm(dir,{recursive:true,force:true});}
});
