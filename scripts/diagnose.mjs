// Offline, content-free inventory. No token reads, network, workspace lock or job loading.
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {HealthStore} from '../server/health.mjs';
export async function diagnosticReport(workspace,{writeTest=false}={}){
 const health=new HealthStore(resolve(workspace),{mode:'offline-inventory'});
 try{await health.init({jobs:[],diagnostics:[],atomic:async()=>{throw Error('Offline inventory does not write logs.');}},{});health.startScan({verify:false,writeTest});await health.scanning;const preview=await health.prepareExport();return {text:preview.text,ok:health.scan.public.state!=='failed'&&Boolean(health.scan.public.result?.complete)&&health.scan.public.result?.writeTest?.status!=='failed'};}finally{await health.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),paths=args.filter(a=>!a.startsWith('--'));
 if(paths.length>1||args.some(a=>a.startsWith('--')&&a!=='--write-test')){console.error('Usage: node scripts/diagnose.mjs [EXISTING_DATA_DIRECTORY] [--write-test]');process.exitCode=1;}else try{const result=await diagnosticReport(paths[0]||'local-data',{writeTest:args.includes('--write-test')});process.stdout.write(result.text);if(!result.ok)process.exitCode=1;}catch{console.error('Could not prepare a local diagnostic inventory. No request was sent.');process.exitCode=1;}
}
