import {readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
let count=0;
async function scan(path){for(const entry of await readdir(path,{withFileTypes:true})){if(['vendor','node_modules'].includes(entry.name))continue;const file=join(path,entry.name);if(entry.isDirectory())await scan(file);else if(entry.isFile()&&/\.(mjs|js)$/.test(file)){const result=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});if(result.status!==0)process.exit(result.status||1);count++;}}}
for(const folder of ['server','shared','public','scripts','test'])await scan(folder);
console.log(`Syntax checked ${count} authored JavaScript files.`);
