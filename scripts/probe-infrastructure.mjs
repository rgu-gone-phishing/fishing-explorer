// Explicit opt-in; performs metadata and a small North Sea tile retrieval.
import {readFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {JobStore} from '../server/jobs.mjs';
import {InfrastructureStore} from '../server/infrastructure.mjs';
if(!process.argv[2])throw Error('Usage: node scripts/probe-infrastructure.mjs TOKEN_FILE');
const token=(await readFile(process.argv[2],'utf8')).trim(),workspace=resolve('local-data/probes/infrastructure-client');await mkdir(workspace,{recursive:true});const jobs=new JobStore(workspace);await jobs.load();
try{const store=new InfrastructureStore(workspace,jobs,{token:()=>token});await store.load();let view=await store.create({start:'2024-01-01',end:'2025-01-01',bounds:[0,50,10,60]});while(!view.complete&&!view.error)view=await store.next(view.id);console.log(JSON.stringify({id:view.id,complete:view.complete,error:view.error,total:view.total,distinctIds:view.distinctIds,labels:view.labels,confidence:view.confidences,duplicates:view.duplicatesRemoved,variants:view.variantRecords,tiles:view.tiles.map(({z,x,y,bytes,features,status})=>({z,x,y,bytes,features,status})),workspace}));}finally{await jobs.close();}
