// Explicit opt-in: reads only the named credential file and performs real GFW GETs.
import {readFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {JobStore} from '../server/jobs.mjs';
import {RegionStore} from '../server/regions.mjs';
if(!process.argv[2])throw Error('Usage: node scripts/probe-regions.mjs TOKEN_FILE [eez|mpa|rfmo] [REGION_ID] [PROVIDER_SIMPLIFY_PARAMETER]');
const token=(await readFile(process.argv[2],'utf8')).trim(),kind=process.argv[3]||'eez',id=process.argv[4]||'8491',simplify=Number(process.argv[5]||0);
const workspace=resolve('local-data/probes/regions-client');await mkdir(workspace,{recursive:true});const jobs=new JobStore(workspace);await jobs.load();
try{const store=new RegionStore(workspace,jobs,{token:()=>token});await store.refresh(kind);const catalogue=await store.catalogue(kind),snapshot=await store.retrieve({kind,id,simplify});console.log(JSON.stringify({entries:catalogue.catalogueCount,snapshotId:snapshot.id,kind,id,label:snapshot.label,simplify,canApply:snapshot.canApply,reason:snapshot.reason,version:snapshot.source?.version,backupDirectory:workspace}));}finally{await jobs.close();}
