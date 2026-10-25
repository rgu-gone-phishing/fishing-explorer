import http from 'node:http';
import {SavedReuseStore} from './saved-reuse.mjs';
import {selectionPackage} from './selection-export.mjs';
import {BulkInfrastructureStore} from './bulk-infrastructure.mjs';
import {bulkQuery,bulkFilters} from '../shared/bulk-infrastructure.mjs';
import {prepareRaster,rasterPackage} from './geotiff.mjs';
import {ExtractPackageImporter,EXTRACT_PACKAGE_LIMIT,buildExtractPackage,sourceBundleBytes,documentationContext} from './extract-package.mjs';
import {handoffDocumentation} from './handoff-docs.mjs';
import {HealthStore} from './health.mjs';
import {extractReport,reportSvg,reportHtml} from './reports.mjs';
import {prepareBatchReport,batchReportHtml,assertBatchReportCurrent} from './batch-reports.mjs';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {BatchStore,planBatch} from './batches.mjs';
import {zipEntries,verifiedFile} from './zip.mjs';
import {BatchImporter} from './batch-import.mjs';
import {MAX_ARCHIVE_BYTES} from './zip-reader.mjs';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, readdir, open, unlink } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PreviewStore } from './previews.mjs';
import {RegionStore,regionPresentation} from './regions.mjs';
import {InfrastructureStore,infrastructureView} from './infrastructure.mjs';
import {VmsEvidenceStore,inspectVmsSample} from './vms.mjs';
import {infrastructureQuery,infrastructureTiles} from '../shared/infrastructure.mjs';
import { WorkspaceStore } from './workspaces.mjs';
import {VesselSetStore} from './vessel-sets.mjs';
import { ExplorerStore } from './explorer.mjs';
import { JobStore } from './jobs.mjs';
import { compareArtifacts } from './comparison.mjs';
import { hash,encodeCSV } from './domain.mjs';
const here=dirname(fileURLToPath(import.meta.url));
const equal=(a,b)=>typeof a==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export async function start({port=4310,workspace=resolve('local-data'), fetchImpl=fetch, initialToken=''}={}) {
  if(initialToken&&!/^[A-Za-z0-9._~+\/=-]{20,8192}$/.test(initialToken))throw Error('Invalid initial API token format.');
  await mkdir(workspace,{recursive:true,mode:0o700});
  const lockPath=join(workspace,'.lock');
  try { const lock=await open(lockPath,'wx'); await lock.writeFile(String(process.pid)); await lock.close(); }
  catch(error) { if(error.code!=='EEXIST') throw error; const pid=Number(await readFile(lockPath,'utf8')); try { process.kill(pid,0); } catch(e) { if(e.code==='ESRCH') {await unlink(lockPath);return start({port,workspace,fetchImpl,initialToken});} } throw Error('This workspace is already in use.'); }
  const session=randomBytes(32).toString('hex');
  const bootstrap=randomBytes(32).toString('hex');let used=false,origin,gfwToken=initialToken,connectionRevision=0;
  const health=new HealthStore(workspace,{fetchImpl,token:()=>gfwToken,revision:()=>connectionRevision});fetchImpl=health.wrapFetch();
  const store=new JobStore(workspace,{fetchImpl,token:()=>gfwToken});await store.load();const batches=new BatchStore(workspace,store);await batches.load();const explorer=new ExplorerStore(workspace,store,{fetchImpl,token:()=>gfwToken});await explorer.load();const workspaces=new WorkspaceStore(workspace,store,explorer,batches);const previews=new PreviewStore({fetchImpl,context:()=>({token:gfwToken,revision:connectionRevision})});
  const regions=new RegionStore(workspace,store,{fetchImpl,token:()=>gfwToken});
  const bulkInfrastructure=new BulkInfrastructureStore(workspace,store,{fetchImpl,token:()=>gfwToken});await bulkInfrastructure.load();workspaces.bulkInfrastructure=bulkInfrastructure;
  const infrastructure=new InfrastructureStore(workspace,store,{fetchImpl,token:()=>gfwToken});await infrastructure.load();workspaces.infrastructure=infrastructure;
  const vmsEvidence=new VmsEvidenceStore(workspace,store);
  const vesselSets=new VesselSetStore(workspace,store,explorer);workspaces.vesselSets=vesselSets;
  const savedReuse=new SavedReuseStore(store,batches);
  const batchImporter=new BatchImporter(workspace,batches,store),extractImporter=new ExtractPackageImporter(workspace,store),importControllers=new Set();
  await health.init(store,{bulkInfrastructure,infrastructure,vmsEvidence,vesselSets,explorer,batches,isBusy:()=>store.jobs.some(j=>['queued','running','checking-recovery'].includes(j.status))||batches.running.size>0||explorer.locks.size>0||infrastructure.locks.size>0||regions.busy||workspaces.locks.size>0||vmsEvidence.locks.size>0||vesselSets.locks.size>0||bulkInfrastructure.locks.size>0||bulkInfrastructure.creating||bulkInfrastructure.importBusy||batchImporter.busy||extractImporter.busy});
  const server=http.createServer(async(req,res)=>{
    const send=(status,value,type='application/json')=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",'Referrer-Policy':'no-referrer'});res.end(type==='application/json'?JSON.stringify(value):value);};
    try {
      if(req.headers.host!==new URL(origin).host || (req.headers.origin && req.headers.origin!==origin) || req.headers['sec-fetch-site']==='cross-site') return send(403,{error:'Local origin required.'});
      const url=new URL(req.url,origin);
      const body=async(limit=32768)=>{let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>limit)throw Error('Request too large.');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));};
      if(url.pathname==='/api/session'&&req.method==='POST') {
        if(used||!equal(req.headers['x-bootstrap'],bootstrap))return send(403,{error:'Use the launch link printed by the local server.'});
        used=true;res.setHeader('Set-Cookie',`fe_session=${session}; HttpOnly; SameSite=Strict; Path=/`);return send(200,{ok:true});
      }
      if(url.pathname.startsWith('/api/')) {
        const cookie=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('fe_session='))?.slice(11);
        if(!equal(cookie,session))return send(401,{error:'Open the launch link from your terminal to connect this browser.'});
        if(url.pathname==='/api/health'&&req.method==='GET')return send(200,await health.status());
        if(url.pathname==='/api/health/scan'&&req.method==='POST'){const input=await body();if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['verify','writeTest'].includes(k))||Object.values(input).some(v=>typeof v!=='boolean'))throw Error('Choose supported scan options.');return send(202,health.startScan(input));}
        if(url.pathname==='/api/health/stop'&&req.method==='POST')return send(200,health.stopScan());
        if(url.pathname==='/api/health/connection-check'&&req.method==='POST')return send(200,await health.checkConnection());
        if(url.pathname==='/api/health/export-preview'&&req.method==='POST')return send(200,await health.prepareExport(await body()));
        const healthExport=url.pathname.match(/^\/api\/health\/export\/([a-f0-9-]{36})$/);
        if(healthExport&&req.method==='GET'){res.setHeader('Content-Disposition',`attachment; filename="fishing-explorer-diagnostics-${healthExport[1]}.json"`);return send(200,health.export(healthExport[1]),'application/json; charset=utf-8');}
        if(url.pathname==='/api/connection'&&req.method==='GET') return send(200,{connected:Boolean(gfwToken)});
        if(url.pathname==='/api/vms-evidence'&&req.method==='GET')return send(200,await vmsEvidence.list());
        if(url.pathname==='/api/vms-evidence'&&req.method==='POST')return send(201,await vmsEvidence.save(await body(128*1024)));
        if(url.pathname==='/api/vms-evidence/inspect'&&req.method==='POST')return send(200,inspectVmsSample(await body(12*1024*1024)));
        if(url.pathname==='/api/vms-evidence/import'&&req.method==='POST')return send(201,await vmsEvidence.importBackup(await body(16*1024*1024)));
        const vmsRecord=url.pathname.match(/^\/api\/vms-evidence\/([a-f0-9-]{36})(\/backup)?$/);
        if(vmsRecord&&req.method==='GET'){const record=await vmsEvidence.read(vmsRecord[1]);if(vmsRecord[2]){res.setHeader('Content-Disposition',`attachment; filename="vms-evidence-${record.id}.json"`);return send(200,{record,sha256:hash(record)});}return send(200,record);}
        if(url.pathname==='/api/infrastructure/preview'&&req.method==='POST'){const query=infrastructureQuery(await body(16*1024*1024));return send(200,{query,tiles:infrastructureTiles(query)});}
        if(url.pathname==='/api/bulk-infrastructure/import'&&req.method==='POST'){const controller=new AbortController();importControllers.add(controller);req.once('aborted',()=>controller.abort());res.once('close',()=>{if(!res.writableEnded)controller.abort();});try{return send(201,await bulkInfrastructure.importZip(req,{signal:controller.signal}));}finally{importControllers.delete(controller);}}
        if(url.pathname==='/api/bulk-infrastructure/preview'&&req.method==='POST'){const query=bulkQuery(await body(16*1024*1024));return send(200,{query,filters:bulkFilters(query)});}
        if(url.pathname==='/api/bulk-infrastructure'&&req.method==='GET')return send(200,bulkInfrastructure.list());
        if(url.pathname==='/api/bulk-infrastructure'&&req.method==='POST')return send(201,await bulkInfrastructure.create(await body(16*1024*1024)));
        const bulk=url.pathname.match(/^\/api\/bulk-infrastructure\/([a-f0-9-]{36})(?:\/(check|save-next|stop|export))?$/);
        if(bulk){
          if(req.method==='POST'&&bulk[2]==='check')return send(200,await bulkInfrastructure.check(bulk[1],await body()));
          if(req.method==='POST'&&bulk[2]==='save-next')return send(200,await bulkInfrastructure.saveNext(bulk[1]));
          if(req.method==='POST'&&bulk[2]==='stop')return send(200,bulkInfrastructure.stop(bulk[1]));
          if(req.method==='GET'&&bulk[2]==='export'){const result=await bulkInfrastructure.exportEntries(bulk[1]);res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':`attachment; filename="bulk-infrastructure-${bulk[1]}-${result.complete?'complete':'PARTIAL'}.zip"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});await pipeline(Readable.from(zipEntries(result.entries)),res);return;}
          if(req.method==='GET'&&!bulk[2])return send(200,bulkInfrastructure.view(await bulkInfrastructure.get(bulk[1])));
        }
        if(url.pathname==='/api/infrastructure'&&req.method==='GET')return send(200,infrastructure.list());
        if(url.pathname==='/api/infrastructure'&&req.method==='POST')return send(201,await infrastructure.create(await body(16*1024*1024)));
        if(url.pathname==='/api/infrastructure/import'&&req.method==='POST')return send(201,await infrastructure.importBackup(await body(64*1024*1024)));
        const infra=url.pathname.match(/^\/api\/infrastructure\/([a-f0-9-]{36})(?:\/(next|download|csv|geojson))?$/);
        if(infra){
          if(req.method==='POST'&&infra[2]==='next')return send(200,await infrastructure.next(infra[1],await body()));
          if(req.method==='GET'){
            const snapshot=await infrastructure.get(infra[1]);if(infra[2]==='download'){res.setHeader('Content-Disposition',`attachment; filename="infrastructure-${snapshot.id}.json"`);return send(200,{snapshot,sha256:hash(snapshot)});}
            const view=infrastructureView(snapshot,Object.fromEntries(url.searchParams),{allRows:['csv','geojson'].includes(infra[2])});
            if(infra[2]==='csv'){const fields=['id','lon','lat','label','confidence','first','last','variant'];const encode=encodeCSV;res.setHeader('Content-Disposition',`attachment; filename="infrastructure-${snapshot.id}-${view.complete?'complete':'PARTIAL'}.csv"`);return send(200,[fields.join(','),...view.rows.map(row=>fields.map(field=>encode(row[field])).join(','))].join('\n')+'\n','text/csv');}
            if(infra[2]==='geojson'){res.setHeader('Content-Disposition',`attachment; filename="infrastructure-${snapshot.id}.geojson"`);return send(200,{type:'FeatureCollection',metadata:{snapshotId:snapshot.id,snapshotSha256:hash(snapshot),query:view.query,display:view.options,complete:view.complete,notes:view.notes},features:view.rows.map(row=>({type:'Feature',geometry:{type:'Point',coordinates:[row.lon,row.lat]},properties:row}))});}
            return send(200,view);
          }
        }
        if(url.pathname==='/api/connection'&&req.method==='POST') {
          const input=await body();
          if(typeof input.token!=='string' || !/^[A-Za-z0-9._~+\/=-]{20,8192}$/.test(input.token)) return send(400,{error:'Enter a valid personal API token.'});
          previews.closeAll();await store.recoveryWatcher.stopAll('credentials-changed').catch(error=>health.localFailure(error));connectionRevision++;gfwToken=input.token;return send(200,{connected:true});
        }
        if(url.pathname==='/api/connection'&&req.method==='DELETE') {previews.closeAll();await store.recoveryWatcher.stopAll('credentials-changed').catch(error=>health.localFailure(error));connectionRevision++;gfwToken='';return send(200,{connected:false});}
        if(url.pathname==='/api/previews'&&req.method==='POST'){const input=await body(16*1024*1024);return send(201,await previews.create(input.query,input.options));}
        const preview=url.pathname.match(/^\/api\/previews\/([a-f0-9-]{36})(?:\/tiles\/(\d+)\/(\d+)\/(\d+))?$/);
        if(preview){
          if(req.method==='GET'&&!preview[2])return send(200,previews.public(previews.get(preview[1])));
          if(req.method==='DELETE'&&!preview[2]){previews.close(preview[1]);return send(200,{ok:true});}
          if(req.method==='GET'&&preview[2]){const bytes=await previews.tile(preview[1],Number(preview[2]),Number(preview[3]),Number(preview[4]));res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});res.end(bytes);return;}
        }
        const regionCatalogue=url.pathname.match(/^\/api\/regions\/catalogue\/(eez|mpa|rfmo)(\/refresh)?$/);
        if(regionCatalogue){if(req.method==='POST'&&regionCatalogue[2])return send(200,await regions.refresh(regionCatalogue[1]));if(req.method==='GET'&&!regionCatalogue[2])return send(200,await regions.catalogue(regionCatalogue[1],Object.fromEntries(url.searchParams)));}
        if(url.pathname==='/api/regions'&&req.method==='GET')return send(200,await regions.list());
        if(url.pathname==='/api/regions'&&req.method==='POST')return send(201,await regions.retrieve(await body()));
        if(url.pathname==='/api/regions/import'&&req.method==='POST')return send(201,await regions.importBackup(await body(48*1024*1024)));
        const regionSnapshot=url.pathname.match(/^\/api\/regions\/([a-f0-9-]{36})(\/backup)?$/);
        if(regionSnapshot&&req.method==='GET'){const snapshot=await regions.snapshot(regionSnapshot[1]);if(regionSnapshot[2]){res.setHeader('Content-Disposition',`attachment; filename="region-${snapshot.id}.json"`);return send(200,{snapshot,sha256:hash(snapshot)});}return send(200,regionPresentation(snapshot));}
        if(url.pathname==='/api/vessel-sets'&&req.method==='GET')return send(200,await vesselSets.list());
        if(url.pathname==='/api/vessel-sets'&&req.method==='POST')return send(201,await vesselSets.save(await body(4*1024*1024)));
        if(url.pathname==='/api/vessel-sets/member'&&req.method==='POST')return send(200,await vesselSets.fromLookup(await body()));
        if(url.pathname==='/api/vessel-sets/import'&&req.method==='POST')return send(201,await vesselSets.importBackup(await body(17*1024*1024)));
        const vesselSet=url.pathname.match(/^\/api\/vessel-sets\/([a-f0-9-]{36})(\/backup)?$/);
        if(vesselSet&&req.method==='GET'){const record=await vesselSets.read(vesselSet[1]);if(vesselSet[2]){res.setHeader('Content-Disposition',`attachment; filename="vessel-set-${record.id}.json"`);return send(200,{record,sha256:hash(record)});}const revision=record.revisions.find(r=>r.id===url.searchParams.get('revision'))||(!url.searchParams.has('revision')?record.revisions.at(-1):null);if(!revision)throw Error('Vessel-set revision not found.');return send(200,{record,revision,evidence:await vesselSets.evidence(revision.content.members)});}
        if(url.pathname==='/api/library'&&req.method==='GET')return send(200,await workspaces.library());
        if(url.pathname==='/api/layers'&&req.method==='GET')return send(200,await workspaces.layers());
        if(url.pathname==='/api/layers'&&req.method==='POST')return send(201,await workspaces.importLayer(await body(12*1024*1024)));
        if(url.pathname==='/api/layers/import-backup'&&req.method==='POST')return send(201,await workspaces.importLayerBackup(await body(32*1024*1024)));
        const layer=url.pathname.match(/^\/api\/layers\/([a-f0-9-]{36})(\/backup)?$/);
        if(layer&&req.method==='GET'){const data=await workspaces.read('layer',layer[1]);if(layer[2])res.setHeader('Content-Disposition',`attachment; filename="reference-${layer[1]}.json"`);return send(200,layer[2]?{layer:data,sha256:hash(data),note:'Local backup; retains the original license and redistribution restrictions.'}:url.searchParams.get('display')==='true'?{id:data.id,metadata:data.metadata,geojson:data.geojson}:data);}
        if(url.pathname==='/api/studies'&&req.method==='GET')return send(200,await workspaces.studies());
        if(url.pathname==='/api/studies'&&req.method==='POST')return send(201,await workspaces.saveStudy(await body(16*1024*1024)));
        if(url.pathname==='/api/studies/import'&&req.method==='POST')return send(201,await workspaces.importStudy(await body(16*1024*1024)));
        if(url.pathname==='/api/studies/last'&&req.method==='GET')return send(200,await workspaces.lastStudy());
        const study=url.pathname.match(/^\/api\/studies\/([a-f0-9-]{36})(\/export)?$/);
        if(study&&req.method==='GET'){const revision=url.searchParams.get('revision')||undefined;if(study[2]){res.setHeader('Content-Disposition',`attachment; filename="study-${study[1]}-plan.json"`);return send(200,await workspaces.exportStudy(study[1],revision));}const opened=await workspaces.openStudy(study[1],revision);await workspaces.remember(opened.studyId,opened.revision.id);return send(200,opened);}
        if(url.pathname==='/api/explorer'&&req.method==='GET')return send(200,explorer.list());
        if(url.pathname==='/api/explorer'&&req.method==='POST')return send(201,await explorer.create(await body(16*1024*1024)));
        if(url.pathname==='/api/explorer/import'&&req.method==='POST')return send(201,await explorer.importBackup(await body(128*1024*1024)));
        const exploration=url.pathname.match(/^\/api\/explorer\/([a-f0-9-]{36})(?:\/(next|download|continue))?$/);
        if(exploration){
          if(req.method==='POST'&&exploration[2]==='next')return send(200,await explorer.next(exploration[1]));
          if(req.method==='POST'&&exploration[2]==='continue')return send(201,await explorer.copyForContinuation(exploration[1]));
          if(req.method==='GET'){const record=await explorer.read(exploration[1]),snapshot=record.snapshot;if(exploration[2]==='download'){if(snapshot.status==='loading')throw Error('Wait for the lookup to settle before exporting.');res.setHeader('Content-Disposition',`attachment; filename="${snapshot.query.kind}-${snapshot.id}-${snapshot.complete?'complete':'PARTIAL'}.json"`);return send(200,{snapshot,sha256:hash(snapshot)});}return send(200,{...snapshot,id:record.localId,originalId:snapshot.id,localImport:record.origin==='imported'});}
        }
        if(url.pathname==='/api/comparisons'&&req.method==='GET') {
          const items=[];
          for(const file of await readdir(workspace))if(/^comparison-[a-f0-9-]{36}\.json$/.test(file)) {
            try{const record=JSON.parse(await readFile(join(workspace,file),'utf8'));if(record.sha256!==hash(record.report))continue;items.push({id:record.id,createdAt:record.report.createdAt,parents:record.report.parents.map(p=>({query:p.query,localId:p.localId})),normalization:record.report.normalization});}catch{}
          }
          return send(200,items.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)));
        }
        if(url.pathname==='/api/comparisons'&&req.method==='POST') {
          const input=await body();if(input.leftId===input.rightId)throw Error('Choose two different saved extracts.');
          const left=await store.artifact(input.leftId),right=await store.artifact(input.rightId);
          const report=compareArtifacts(left,right,input);const id=randomUUID();
          await store.atomic(`comparison-${id}.json`,{id,report,sha256:hash(report)});return send(201,{id,report});
        }
        const comparison=url.pathname.match(/^\/api\/comparisons\/([a-f0-9-]{36})(\/download)?$/);
        if(comparison&&req.method==='GET') {
          const record=JSON.parse(await readFile(join(workspace,`comparison-${comparison[1]}.json`),'utf8'));
          if(record.sha256!==hash(record.report))throw Error('Saved comparison integrity check failed.');
          if(comparison[2])res.setHeader('Content-Disposition',`attachment; filename="comparison-${comparison[1]}.json"`);
          return send(200,record);
        }
        if(url.pathname==='/api/batches/preview'&&req.method==='POST'){const input=await body(16*1024*1024);return send(200,batches.view(planBatch(input.query,input.options)));}
        if(url.pathname==='/api/batches/import-zip'&&req.method==='POST'){
          if(Number(req.headers['content-length'])>MAX_ARCHIVE_BYTES)throw Error('Batch ZIP exceeds the import size limit.');
          const controller=new AbortController();importControllers.add(controller);req.once('aborted',()=>controller.abort());res.once('close',()=>{if(!res.writableEnded)controller.abort();});
          try{return send(201,await batchImporter.receive(req,{signal:controller.signal}));}finally{importControllers.delete(controller);}
        }
        if(url.pathname==='/api/batches'&&req.method==='GET')return send(200,batches.list());
        if(url.pathname==='/api/batches'&&req.method==='POST'){const input=await body(16*1024*1024);return send(201,batches.view(await batches.create(input.query,input.options)));}
        const batchAction=url.pathname.match(/^\/api\/batches\/([a-f0-9-]{36})\/(start|pause|export|analysis|continue|figure|report)$/);
        if(batchAction){
          if(req.method==='GET'&&['figure','report'].includes(batchAction[2])){const model=await prepareBatchReport(batches,batchAction[1],Object.fromEntries(url.searchParams)),svg=batchAction[2]==='figure',output=svg?await reportSvg(model):await batchReportHtml(model);assertBatchReportCurrent(batches,batchAction[1],model.metadata.batchFingerprint);res.setHeader('Content-Disposition',`attachment; filename="historical-${model.batchId}-${model.metadata.complete?'complete':'PARTIAL'}-${model.id.slice(0,12)}.${svg?'svg':'html'}"`);return send(200,output,svg?'image/svg+xml':'text/html');}
          if(req.method==='GET'&&batchAction[2]==='analysis')return send(200,await batches.analyze(batchAction[1],Object.fromEntries(url.searchParams)));
          if(req.method==='POST'&&batchAction[2]==='start')return send(202,batches.view(batches.start(batchAction[1],await body())));
          if(req.method==='POST'&&batchAction[2]==='continue')return send(201,batches.view(await batches.copyRemaining(batchAction[1])));
          if(req.method==='POST'&&batchAction[2]==='pause')return send(200,batches.view(await batches.pause(batchAction[1])));
          if(req.method==='GET'&&batchAction[2]==='export'){
            const result=await batches.exportEntries(batchAction[1],{allowPartial:url.searchParams.get('partial')==='true'});
            res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':`attachment; filename="historical-${batchAction[1]}-${result.complete?'complete':'PARTIAL'}.zip"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
            await pipeline(Readable.from(result.originalArchive?verifiedFile(result.originalArchive):zipEntries(result.entries)),res);return;
          }
        }
        if(['/api/saved-reuse/search','/api/saved-reuse/choose'].includes(url.pathname)&&req.method==='POST'){
          const input=await body(16*1024*1024),controller=new AbortController();importControllers.add(controller);res.once('close',()=>{if(!res.writableEnded)controller.abort();});try{return send(200,await savedReuse[url.pathname.endsWith('/search')?'search':'choose'](input,{signal:controller.signal}));}finally{importControllers.delete(controller);}
        }
        if(url.pathname==='/api/jobs'&&req.method==='GET') return send(200,url.searchParams.get('summary')==='true'?store.list().map(j=>{const {geometry,...query}=j.query;return {...j,query,geometryType:geometry?.type};}):store.list());
        if(url.pathname==='/api/diagnostics'&&req.method==='GET') return send(200,store.diagnostics);
        if(url.pathname==='/api/import-extract-package'&&req.method==='POST'){
          if(Number(req.headers['content-length'])>EXTRACT_PACKAGE_LIMIT)throw Error('Extract ZIP exceeds the 256 MiB import limit.');
          const controller=new AbortController();importControllers.add(controller);req.once('aborted',()=>controller.abort());res.once('close',()=>{if(!res.writableEnded)controller.abort();});
          try{return send(201,await extractImporter.receive(req,{signal:controller.signal}));}finally{importControllers.delete(controller);}
        }
        if(url.pathname==='/api/import'&&req.method==='POST') return send(201,await store.import(await body(40*1024*1024)));
        if(url.pathname==='/api/extract'&&req.method==='POST') return send(202,await store.submit(await body(16*1024*1024)));
        const candidate=url.pathname.match(/^\/api\/jobs\/([a-f0-9-]{36})\/candidate$/);
        if(candidate&&req.method==='GET')return send(200,await store.candidate(candidate[1]));
        const action=url.pathname.match(/^\/api\/jobs\/([a-f0-9-]{36})\/(retry|pause|cancel|recover|watch-recovery|stop-recovery-watch|accept-recovery|release)$/);
        if(action&&req.method==='POST')return send(200,await store.action(action[1],action[2],await body()));
        const match=url.pathname.match(/^\/api\/artifacts\/([a-f0-9-]{36})(\/(?:bundle|package|selection|documentation|raster-preview|raster|figure|report))?$/);
        if(match&&req.method==='GET') {
          const artifact=await store.artifact(match[1]);
          if(match[2]==='/raster-preview')return send(200,((m)=>({id:m.id,metadata:m.metadata}))(prepareRaster(artifact,Object.fromEntries(url.searchParams))));
          if(match[2]==='/raster'){
            const {expected,...options}=Object.fromEntries(url.searchParams),result=rasterPackage(artifact,options,{expected,sourceBytes:await sourceBundleBytes(store,match[1],artifact)});
            res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':`attachment; filename="extract-${match[1]}-${result.model.id.slice(0,12)}-GIS.zip"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
            await pipeline(Readable.from(zipEntries(result.entries)),res);return;
          }
          if(match[2]==='/documentation')return send(200,handoffDocumentation(artifact.query,documentationContext(artifact)));
          if(match[2]==='/selection'){const result=selectionPackage(artifact,Object.fromEntries(url.searchParams),await sourceBundleBytes(store,match[1],artifact));res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':`attachment; filename="extract-${match[1]}-selected-view.zip"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});await pipeline(Readable.from(zipEntries(result.entries)),res);return;}
          if(match[2]==='/package'){
            const result=buildExtractPackage(artifact,await sourceBundleBytes(store,match[1],artifact));
            res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':`attachment; filename="extract-${match[1]}-documented.zip"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
            await pipeline(Readable.from(zipEntries(result.entries)),res);return;
          }
          if(['/figure','/report'].includes(match[2])){const model=extractReport(artifact,Object.fromEntries(url.searchParams)),svg=match[2]==='/figure';res.setHeader('Content-Disposition',`attachment; filename="extract-${match[1]}-${model.id.slice(0,12)}.${svg?'svg':'html'}"`);return send(200,svg?await reportSvg(model):await reportHtml(model),svg?'image/svg+xml':'text/html');}
          if(match[2])res.setHeader('Content-Disposition',`attachment; filename="fishing-explorer-${match[1]}.json"`);
          return send(200,artifact);
        }
        return send(404,{error:'Unknown operation.'});
      }
      if(req.method!=='GET')return send(405,{error:'Method not allowed.'});
      const assets={'/':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/saved-reuse.js':['saved-reuse.js','text/javascript'],'/extract-analysis.js':['extract-analysis.js','text/javascript'],'/shared/saved-analysis.mjs':['../shared/saved-analysis.mjs','text/javascript'],'/health.js':['health.js','text/javascript'],'/style.css':['style.css','text/css'],'/map.js':['map.js','text/javascript'],'/comparison.js':['comparison.js','text/javascript'],'/batches.js':['batches.js','text/javascript'],'/batch-analysis.js':['batch-analysis.js','text/javascript'],'/explorer.js':['explorer.js','text/javascript'],'/vessel-search.js':['vessel-search.js','text/javascript'],'/area-events.js':['area-events.js','text/javascript'],'/event-stats.js':['event-stats.js','text/javascript'],'/shared/event-stats.mjs':['../shared/event-stats.mjs','text/javascript'],'/shared/area-events.mjs':['../shared/area-events.mjs','text/javascript'],'/shared/vessel-search.mjs':['../shared/vessel-search.mjs','text/javascript'],'/workspaces.js':['workspaces.js','text/javascript'],'/preview.js':['preview.js','text/javascript'],'/infrastructure.js':['infrastructure.js','text/javascript'],'/bulk-infrastructure.js':['bulk-infrastructure.js','text/javascript'],'/vms.js':['vms.js','text/javascript'],'/vessel-sets.js':['vessel-sets.js','text/javascript'],'/shared/vessel-sets.mjs':['../shared/vessel-sets.mjs','text/javascript'],'/insights.js':['insights.js','text/javascript'],'/shared/insights.mjs':['../shared/insights.mjs','text/javascript'],'/shared/vms.mjs':['../shared/vms.mjs','text/javascript'],'/regions.js':['regions.js','text/javascript'],'/shared/regions.mjs':['../shared/regions.mjs','text/javascript'],'/preview-unavailable.svg':['preview-unavailable.svg','image/svg+xml'],'/shared/reference-layers.mjs':['../shared/reference-layers.mjs','text/javascript'],'/shared/explorer.mjs':['../shared/explorer.mjs','text/javascript'],'/shared/geometry.mjs':['../shared/geometry.mjs','text/javascript'],'/shared/vendor/robust-predicates/orient2d.js':['../shared/vendor/robust-predicates/orient2d.js','text/javascript'],'/shared/vendor/robust-predicates/util.js':['../shared/vendor/robust-predicates/util.js','text/javascript'],'/shared/catalogue.mjs':['../shared/catalogue.mjs','text/javascript'],'/data/countries.geojson':['data/countries.geojson','application/geo+json'],'/vendor/leaflet/leaflet.js':['vendor/leaflet/leaflet.js','text/javascript'],'/vendor/leaflet/leaflet.css':['vendor/leaflet/leaflet.css','text/css']};
      for(const name of ['layers.png','layers-2x.png','marker-icon.png','marker-icon-2x.png','marker-shadow.png'])assets['/vendor/leaflet/images/'+name]=['vendor/leaflet/images/'+name,'image/png'];
      const asset=assets[url.pathname];if(!asset)return send(404,{error:'Not found.'});
      return send(200,await readFile(join(here,'../public',asset[0]),asset[1]==='image/png'?undefined:'utf8'),asset[1]);
    } catch(error) {health.localFailure(error);if(res.headersSent){res.destroy();return;}send(400,{error:error instanceof SyntaxError?'Invalid JSON.':error.code?'Local storage operation failed.':error.message});}
  });
  try {await new Promise((ok,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',ok);});}
  catch(error){await unlink(lockPath);throw error;}
  origin=`http://127.0.0.1:${server.address().port}`;
  return {origin,launchUrl:`${origin}/#${bootstrap}`,close:async()=>{previews.closeAll();await bulkInfrastructure.close();for(const controller of importControllers)controller.abort();const stopping=batches.close(),stoppingJobs=store.close();await new Promise(r=>server.close(r));await stoppingJobs;await stopping;await health.close();await unlink(lockPath);}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const app=await start({port:Number(process.env.FISHING_EXPLORER_PORT||4310),workspace:resolve(process.env.FISHING_EXPLORER_DATA_DIR||'local-data')});
  console.log(`Fishing Explorer — local research workspace\nOpen locally: ${app.launchUrl}\nKeep this one-time launch link private. Press Ctrl+C to stop.`);
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await app.close();process.exit(0);});
}
