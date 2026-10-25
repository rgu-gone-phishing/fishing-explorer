// One explicit, bounded page; never called by normal startup or tests.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {explorerQuery,fetchExplorerPage} from '../server/explorer.mjs';
const [tokenFile,queryFile]=process.argv.slice(2);
if(!tokenFile||!queryFile){console.error('Usage: node scripts/probe-vessel-search.mjs TOKEN_FILE QUERY_JSON');process.exitCode=1;}else try{const query=explorerQuery(JSON.parse(await readFile(queryFile,'utf8')));if(query.kind!=='search')throw Error('This probe supports vessel search only.');const token=(await readFile(tokenFile,'utf8')).trim();if(!token)throw Error('Empty credential file.');const page=await fetchExplorerPage(query,null,token),path=`local-data/probes/advanced-search/adapter-${randomUUID()}.json`;await mkdir('local-data/probes/advanced-search',{recursive:true});await writeFile(path,JSON.stringify({query,...page},null,2),{flag:'wx'});console.log(JSON.stringify({path,records:page.entries.length,total:page.total,hasMore:page.next!==null,responseVersion:page.responseVersion,retrievedAt:page.retrievedAt}));}catch(e){console.error(e.message);process.exitCode=1;}
