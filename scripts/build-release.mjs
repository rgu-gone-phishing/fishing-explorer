// Reproducible local package. Only reviewed allowlisted source paths are inputs.
import {readFile,writeFile,mkdir,mkdtemp,rm,lstat,link,unlink} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {resolve,join,dirname,posix} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {zipEntries} from '../server/zip.mjs';
import {validate,makeArtifact} from '../server/domain.mjs';
import {releasePath,releaseIdentity,releaseChecksums,verifyRelease} from './verify-release.mjs';
const digest=b=>createHash('sha256').update(b).digest('hex');
const sourceRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
async function sourceBytes(root,name){if(!releasePath(name))throw Error('Invalid package source path.');let path=root;for(const part of name.split('/')){path=join(path,part);if((await lstat(path)).isSymbolicLink())throw Error(`Package source must not be a symbolic link: ${name}`);}const info=await lstat(path);if(!info.isFile()||info.size>64*1024*1024)throw Error(`Unsupported package source: ${name}`);const b=await readFile(path);const after=await lstat(path);if(b.length!==info.size||after.ino!==info.ino||after.mtimeMs!==info.mtimeMs)throw Error(`Source changed during packaging: ${name}`);return b;}
function verifyImports(files){
 for(const [name,bytes] of files){if(!/\.(?:mjs|js)$/.test(name)||name.includes('/vendor/'))continue;const source=bytes.toString('utf8'),specs=[];
  for(const match of source.matchAll(/(?:^|[;\n])\s*(?:import\s*(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s*from\s*|export\s*(?:\{[^}]*\}|\*)\s*from\s*|import\s*)['"]([^'"]+)['"]/g))specs.push(match[1]);
  for(const match of source.matchAll(/\bawait\s+import\(\s*['"]([^'"]+)['"]\s*\)/g))specs.push(match[1]);
  for(const spec of specs){if(spec.startsWith('node:'))continue;const target=spec.startsWith('.')?posix.normalize(posix.join(posix.dirname(name),spec)):spec.startsWith('/shared/')?spec.slice(1):spec.startsWith('/')?'public'+spec:null;if(!target||!files.has(target))throw Error(`Runtime import is not included: ${name} → ${spec}`);}
 }
}
async function publish(path,bytes){try{await writeFile(path,bytes,{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;if(!(await readFile(path)).equals(bytes))throw Error('A different output already uses this release filename.');}}
export async function buildRelease({root=sourceRoot,output=resolve('dist')}={}){
 root=resolve(root);output=resolve(output);const catalogue=JSON.parse((await sourceBytes(root,'distribution/runtime-files.json')).toString('utf8'));if(catalogue.schemaVersion!==1||!Array.isArray(catalogue.files)||!catalogue.files.length||catalogue.files.length>1000||new Set(catalogue.files).size!==catalogue.files.length)throw Error('Invalid release input allowlist.');
 const files=new Map();for(const name of catalogue.files)files.set(name,await sourceBytes(root,name));
 for(const name of ['LICENSE','THIRD_PARTY_NOTICES.md'])files.set(name,await sourceBytes(root,name));for(const name of ['README.html','start.cmd','start.sh'])files.set(name,await sourceBytes(root,'distribution/'+name));
 const original=JSON.parse((await sourceBytes(root,'package.json')).toString('utf8'));if(!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(original.version))throw Error('Use a supported application version before packaging.');
 const pkg={name:original.name,version:original.version,private:true,type:'module',engines:{node:'>=22'},scripts:{start:'node scripts/launch.mjs',diagnose:'node scripts/launch.mjs --diagnose',verify:'node scripts/verify-release.mjs'}};files.set('package.json',Buffer.from(JSON.stringify(pkg,null,2)+'\n'));
 const example=makeArtifact(validate({source:'synthetic-activity',start:'2024-01-01',end:'2024-01-08',grid:.1,interval:'DAILY',bounds:[-2,49,-1,50]}),'00000000-0000-4000-8000-000000000001','2024-02-01T00:00:00.000Z');files.set('examples/synthetic.bundle.json',Buffer.from(JSON.stringify(example,null,2)+'\n'));
 const ordered=new Map([...files].sort(([a],[b])=>a<b?-1:a>b?1:0));if(new Set([...ordered.keys()].map(n=>n.toLowerCase())).size!==ordered.size)throw Error('Package paths collide on case-insensitive filesystems.');for(const name of ordered.keys())if(!releasePath(name))throw Error('Unsafe package destination.');if([...ordered.values()].reduce((n,b)=>n+b.length,0)>256*1024*1024)throw Error('Runtime package exceeds 256 MiB.');verifyImports(ordered);
 const descriptors=Object.fromEntries([...ordered].map(([name,b])=>[name,{bytes:b.length,sha256:digest(b)}])),buildId=releaseIdentity(pkg.version,descriptors),manifest={schemaVersion:1,type:'fishing-explorer-release',version:pkg.version,channel:'preview',nodeMinimum:'22',buildId,files:descriptors},manifestBytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');ordered.set('release-manifest.json',manifestBytes);ordered.set('checksums.txt',Buffer.from(releaseChecksums(manifest,manifestBytes)));
 await mkdir(output,{recursive:true});const stage=await mkdtemp(join(output,'.release-stage-')),folder=`fishing-explorer-${pkg.version}-preview-${buildId.slice(0,12)}`,application=join(stage,folder);try{
  for(const [name,b] of ordered){const dest=join(application,name);await mkdir(dirname(dest),{recursive:true});await writeFile(dest,b,{flag:'wx',mode:0o600});}await verifyRelease(application);
  const zipPath=join(output,folder+'.zip'),temporary=join(stage,'release.zip');await pipeline(Readable.from(zipEntries([...ordered].map(([name,data])=>({name:folder+'/'+name,data})))),createWriteStream(temporary,{flags:'wx',mode:0o600}));const zip=await readFile(temporary),sha256=digest(zip);try{await link(temporary,zipPath);}catch(error){if(error.code!=='EEXIST')throw error;if(digest(await readFile(zipPath))!==sha256)throw Error('Existing release archive differs. It was not overwritten.');}await unlink(temporary);await publish(zipPath+'.sha256',Buffer.from(`${sha256}  ${folder}.zip\n`));return {path:zipPath,checksumPath:zipPath+'.sha256',version:pkg.version,buildId,files:ordered.size,bytes:zip.length,sha256};
 }finally{await rm(stage,{recursive:true,force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{if(process.argv.length>3)throw Error('Usage: node scripts/build-release.mjs [OUTPUT_DIRECTORY]');console.log(JSON.stringify(await buildRelease({output:resolve(process.argv[2]||'dist')}),null,2));}catch(error){console.error(error.code?'Package build could not read/write its approved inputs or output directory.':error.message);process.exitCode=1;}}
