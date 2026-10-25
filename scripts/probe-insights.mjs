// Explicit, single-request opt-in probe. Never launched by npm start or npm test.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {explorerQuery,fetchExplorerPage} from '../server/explorer.mjs';
import {DEFAULT_INSIGHTS,summarizeInsights} from '../shared/insights.mjs';
const [tokenPath,vesselId,start,end,version='v5.0']=process.argv.slice(2);
if(!tokenPath||!vesselId||!start||!end){console.error('Usage: node scripts/probe-insights.mjs TOKEN_FILE AIS_ID START_DATE END_DATE [v5.0|v4.0]');process.exitCode=1;}else try{
 const query=explorerQuery({kind:'insights',version,vesselId,start,end,includes:DEFAULT_INSIGHTS});const token=(await readFile(tokenPath,'utf8')).trim();if(!token)throw Error('Selected credential file is empty.');
 const page=await fetchExplorerPage(query,null,token),file=`local-data/probes/insights-${randomUUID()}.json`;await mkdir('local-data/probes',{recursive:true});await writeFile(file,JSON.stringify({query,...page},null,2),{flag:'wx'});
 console.log(JSON.stringify({file,retrievedAt:page.retrievedAt,responseVersion:page.responseVersion,categories:summarizeInsights(page.entries[0],query).sections.map(({type,status})=>({type,status}))}));
}catch(error){console.error(error.message);process.exitCode=1;}
