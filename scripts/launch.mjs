import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {launchOptions,startupMessage,assertSeparateWorkspace} from './launch-config.mjs';
const appRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const help=`Fishing Explorer local preview
Usage: node scripts/launch.mjs [--data-dir DIRECTORY] [--port PORT]
       node scripts/launch.mjs --diagnose [--data-dir EXISTING_DIRECTORY] [--write-test]
       node scripts/launch.mjs --help

Requires an approved Node.js 22 or later. No install/build step is needed.
Defaults use a separate per-user data folder and loopback port 4310.
FISHING_EXPLORER_DATA_DIR and FISHING_EXPLORER_PORT are supported; CLI options take precedence.
The packaged launcher verifies listed application files before startup.
Diagnostics inventory is offline and does not start a server or load jobs.
Keep the printed one-time launch link private. Stop with Ctrl+C.
See README.html for data locations, upgrades and managed-network setup.\n`;
export async function launch(args=process.argv.slice(2)){
 if(Number(process.versions.node.split('.')[0])<22){console.error('Fishing Explorer requires an approved Node.js 22 or later. Ask your IT contact if the installed runtime is older.');return 1;}
 let options;try{options=launchOptions(args);}catch(error){console.error(error.message);return 1;}if(options.help){process.stdout.write(help);return 0;}
 if(options.diagnose){try{const {diagnosticReport}=await import('./diagnose.mjs');const result=await diagnosticReport(options.workspace,{writeTest:options.writeTest});process.stdout.write(result.text);return result.ok?0:1;}catch{console.error('Could not prepare the offline inventory. Check the package and existing data directory.');return 1;}}
 try{const {verifyRelease}=await import('./verify-release.mjs');const result=await verifyRelease(appRoot);console.log(`Package verified · ${result.version} · build ${result.buildId.slice(0,12)}`);}catch{console.error('Application verification failed. Extract a complete, clean release; your separate data folder is unchanged. Developer checkouts use node server/index.mjs.');return 1;}
 try{await assertSeparateWorkspace(appRoot,options.workspace);}catch(error){console.error(error.code?'Could not resolve the data folder. Choose an approved writable location.':error.message);return 1;}
 let app;try{const {start}=await import('../server/index.mjs');app=await start({port:options.port,workspace:options.workspace});}catch(error){console.error(startupMessage(error));return 1;}
 console.log(`Fishing Explorer — local research workspace\nData directory: ${options.workspace}\nOpen locally: ${app.launchUrl}\nKeep this one-time link private. No API token file is read automatically.\nPress Ctrl+C to stop. Saved data remains in the data directory.`);
 let stopping=false;const stop=async()=>{if(stopping)return;stopping=true;try{await app.close();process.exit(0);}catch{console.error('Shutdown could not save all state. Preserve the data directory and run diagnostics before restarting.');process.exit(1);}};
 process.once('SIGINT',stop);process.once('SIGTERM',stop);return null;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const code=await launch();if(code!==null)process.exitCode=code;}
