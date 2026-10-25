// Explicit opt-in startup. The default npm start never reads a credential file.
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {start} from '../server/index.mjs';
if(!process.argv[2])throw Error('Usage: node scripts/start-with-token.mjs PATH_TO_PERSONAL_TOKEN [DATA_DIRECTORY]');
const initialToken=(await readFile(process.argv[2],'utf8')).trim();
const app=await start({initialToken,workspace:resolve(process.argv[3]||'local-data'),port:Number(process.env.FISHING_EXPLORER_PORT||4310)});
console.log(`Personal token loaded into server memory from the explicitly selected file.\nOpen locally: ${app.launchUrl}\nKeep the one-time launch link private. Press Ctrl+C to stop.`);
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await app.close();process.exit(0);});
