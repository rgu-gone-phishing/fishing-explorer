import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {explorerQuery,fetchExplorerPage} from '../server/explorer.mjs';
import {vesselLabel,list} from '../shared/explorer.mjs';
const token=(await readFile(process.argv[2],'utf8')).trim();
await mkdir('local-data/probes',{recursive:true});
async function probe(query,cursor=null){const page=await fetchExplorerPage(explorerQuery(query),cursor,token);const id=randomUUID();await writeFile(`local-data/probes/explorer-${query.kind}-${id}.json`,JSON.stringify({query:explorerQuery(query),cursor,...page},null,2),{flag:'wx'});console.log(JSON.stringify({kind:query.kind,records:page.entries.length,total:page.total,next:page.next,version:page.responseVersion,file:`explorer-${query.kind}-${id}.json`}));return page;}
try{
 const search=await probe({kind:'search',version:'v5.0',term:'7831410'});
 if(search.next!==null)await probe({kind:'search',version:'v5.0',term:'7831410'},search.next);
 const records=list(search.entries[0]?.selfReportedInfo).sort((a,b)=>String(b.transmissionDateTo||'').localeCompare(String(a.transmissionDateTo||'')));
 const id=records[0]?.id;if(!id)throw Error('No vessel ID returned.');
 const detail=await probe({kind:'detail',version:'v5.0',vesselId:id});console.log(JSON.stringify({label:vesselLabel(detail.entries[0]),identityRecords:records.length}));
 const events=await probe({kind:'events',version:'v5.0',vesselId:id,eventType:'port_visits',start:'2024-01-01',end:'2025-01-01',confidence:'all'});
 console.log(JSON.stringify({eventExample:events.entries[0]||null}));
}catch(error){console.error(error.message);process.exitCode=1;}
