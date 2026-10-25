import {readFileSync,statSync} from 'node:fs';
const read=(name,limit)=>{const url=new URL('../'+name,import.meta.url);if(statSync(url).size>limit)throw Error('Metadata too large');return JSON.parse(readFileSync(url,'utf8'));};
let version='unknown',buildId=null,channel='development';
try{const p=read('package.json',65536);if(typeof p.version==='string'&&/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(p.version))version=p.version;}catch{}
try{const r=read('release-manifest.json',256*1024);if(r.type!=='fishing-explorer-release'||r.schemaVersion!==1||r.version!==version||r.channel!=='preview'||typeof r.buildId!=='string'||!/^[a-f0-9]{64}$/.test(r.buildId))throw Error('Invalid release metadata');buildId=r.buildId;channel='preview';}catch(error){if(error.code!=='ENOENT')channel='unverified';}
// A build identifier describes the packaged code. It is not publisher authentication.
export const APPLICATION_BUILD=Object.freeze({version,buildId,channel});
