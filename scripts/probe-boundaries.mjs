// Opt-in, small adjacent-window contract checks; credentials never logged or saved.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {fetchReport} from '../server/gfw.mjs';
import {validate,hash} from '../server/domain.mjs';
import {measure,rowGroup} from '../shared/catalogue.mjs';
const token=(await readFile(process.argv[2],'utf8')).trim();
const cases=[['gfw-fishing','ais-v5-2024-02-01.json','2024-01-16'],['gfw-presence','gfw-presence-v5-2024-01-03.json','2024-01-02'],['gfw-sar','gfw-sar-v5-2024-02-01.json','2024-01-16']];
const sumRows=(rows,q)=>{const result=new Map();for(const row of rows){const key=JSON.stringify([row.date,row.lat,row.lon,rowGroup(row,q)]);result.set(key,(result.get(key)||0)+measure(row));}return result;};
try{
 await mkdir('local-data/probes',{recursive:true});
 for(const [source,file,seam] of cases){
  const baseline=JSON.parse(await readFile(`local-data/probes/${file}`,'utf8'));const q=baseline.query;const parts=[];
  for(const [start,end] of [[q.start,seam],[seam,q.end]]){
   const part=await fetchReport(validate({...q,start,end}),randomUUID(),token);parts.push(part);
   await writeFile(`local-data/probes/seam-${source}-${part.manifest.id}.json`,JSON.stringify(part,null,2),{flag:'wx'});
  }
  const expected=sumRows(baseline.rows,q),actual=sumRows(parts.flatMap(p=>p.rows),q);
  const keys=new Set([...expected.keys(),...actual.keys()]);const mismatches=[...keys].filter(key=>!expected.has(key)||!actual.has(key)||Math.abs(expected.get(key)-actual.get(key))>Math.max(1e-6,Math.abs(expected.get(key))*1e-8));
  const result={source,seam,baselineQueryHash:hash(q),baselineRows:baseline.rows.length,partRows:parts.map(p=>p.rows.length),mismatches:mismatches.length,expectedTotal:[...expected.values()].reduce((a,b)=>a+b,0),actualTotal:[...actual.values()].reduce((a,b)=>a+b,0),partIds:parts.map(p=>p.manifest.id)};
  await writeFile(`local-data/probes/seam-result-${source}-${Date.now()}.json`,JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify(result));
  if(mismatches.length)throw Error('Adjacent-window equivalence failed; do not enable this batching contract.');
 }
}catch(error){console.error(error.message);process.exitCode=1;}
