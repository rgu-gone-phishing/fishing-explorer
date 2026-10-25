import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PreviewStore,pngDimensions} from '../server/previews.mjs';
import {SOURCES} from '../shared/catalogue.mjs';
const token=(await readFile(process.argv[2],'utf8')).trim();const source=process.argv[3]||'gfw-fishing';const store=new PreviewStore({context:()=>({token,revision:1})});
try{
 const preview=await store.create({source,datasetVersion:'v5.0',start:'2024-01-01',end:process.argv[5]||'2024-02-01',grid:0.1,interval:'DAILY',grouping:SOURCES[source].groupings[0],bounds:[-2,49,-1,50]},{interval:process.argv[4]||'DAY'});
 const tile=await store.tile(preview.id,6,31,21);const id=randomUUID();await mkdir('local-data/probes',{recursive:true});
 await writeFile(`local-data/probes/preview-${source}-${id}.png`,tile,{flag:'wx'});await writeFile(`local-data/probes/preview-${source}-${id}.json`,JSON.stringify(preview,null,2),{flag:'wx'});
 console.log(JSON.stringify({source,bytes:tile.length,...pngDimensions(tile),version:preview.responseVersion,zoom6Thresholds:preview.thresholds[6],id}));
}catch(error){console.error(error.message);process.exitCode=1;}finally{store.closeAll();}
