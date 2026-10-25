// Explicitly opt-in tiny contract probe. Never prints or persists credentials.
import {randomUUID} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {measure,SOURCES} from '../shared/catalogue.mjs';
import {validate,verifyArtifact} from '../server/domain.mjs';
import {fetchReport} from '../server/gfw.mjs';
if(!process.argv[2])throw Error('Usage: node scripts/probe-gfw.mjs PATH_TO_PERSONAL_TOKEN');
const token=(await readFile(process.argv[2],'utf8')).trim();
const source=process.argv[4]||'gfw-fishing';
const query=validate({source,datasetVersion:'v5.0',start:'2024-01-01',end:process.argv[3]||'2024-01-03',grid:0.1,interval:'DAILY',grouping:SOURCES[source].groupings[0],bounds:[-2,49,-1,50],flags:[],gears:[],...JSON.parse(process.argv[5]||'{}')});
try {
 const artifact=await fetchReport(query,randomUUID(),token);
 verifyArtifact(artifact);
 await mkdir('local-data/probes',{recursive:true});
 await writeFile(`local-data/probes/${query.source}-${query.datasetVersion}-${query.end}-${artifact.manifest.id.slice(0,8)}.json`,JSON.stringify(artifact,null,2),{flag:'wx'});
 console.log(JSON.stringify({source:artifact.manifest.source,version:artifact.manifest.responseVersion,rows:artifact.rows.length,dates:[...new Set(artifact.rows.map(r=>r.date))],units:artifact.manifest.units,value:artifact.rows.reduce((sum,r)=>sum+measure(r),0)}));
} catch(error) {console.error(error.message);process.exitCode=1;}
