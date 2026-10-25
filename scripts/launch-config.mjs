import path from 'node:path';
import {homedir} from 'node:os';
import {realpath} from 'node:fs/promises';
export function defaultDataDirectory({platform=process.platform,env=process.env,home=homedir()}={}){
 if(platform==='win32'){const base=env.LOCALAPPDATA&&path.win32.isAbsolute(env.LOCALAPPDATA)?env.LOCALAPPDATA:path.win32.join(home,'AppData','Local');return path.win32.join(base,'FishingExplorer','data');}
 if(platform==='darwin')return path.join(home,'Library','Application Support','Fishing Explorer','data');
 const base=env.XDG_DATA_HOME&&path.isAbsolute(env.XDG_DATA_HOME)?env.XDG_DATA_HOME:path.join(home,'.local','share');return path.join(base,'fishing-explorer','data');
}
export function launchOptions(args,{env=process.env,cwd=process.cwd(),defaultDirectory=defaultDataDirectory()}={}){
 const options={workspace:path.resolve(cwd,env.FISHING_EXPLORER_DATA_DIR||defaultDirectory),port:env.FISHING_EXPLORER_PORT||'4310',diagnose:false,writeTest:false,help:false};const seen=new Set();
 for(let i=0;i<args.length;i++){const arg=args[i];if(seen.has(arg))throw Error('Do not repeat launcher options.');seen.add(arg);if(arg==='--help')options.help=true;else if(arg==='--diagnose')options.diagnose=true;else if(arg==='--write-test')options.writeTest=true;else if(arg==='--data-dir'||arg==='--port'){const value=args[++i];if(!value||value.startsWith('--'))throw Error('Supply a value after --data-dir or --port.');if(arg==='--data-dir')options.workspace=path.resolve(cwd,value);else options.port=value;}else throw Error('Unknown launcher option. Use --help.');}
 if(options.help)return options;if(options.writeTest&&!options.diagnose)throw Error('--write-test requires --diagnose.');if(options.diagnose){options.port=null;return options;}
 if(!/^\d{1,5}$/.test(String(options.port))||Number(options.port)!==0&&(Number(options.port)<1024||Number(options.port)>65535))throw Error('Choose port 0 for automatic allocation, or a local port from 1024 through 65535.');options.port=Number(options.port);if(options.writeTest&&!options.diagnose)throw Error('--write-test requires --diagnose.');return options;
}
export async function assertSeparateWorkspace(application,workspace){
 const inside=(root,target)=>{const p=path.relative(root,target);return p===''||(!path.isAbsolute(p)&&p!=='..'&&!p.startsWith('..'+path.sep));};
 if(inside(application,workspace))throw Error('Choose a data directory outside the application folder.');
 const tail=[];let parent=workspace,physical;
 while(true){try{physical=await realpath(parent);break;}catch(e){if(e.code!=='ENOENT')throw e;const next=path.dirname(parent);if(next===parent)throw e;tail.unshift(path.basename(parent));parent=next;}}
 if(inside(await realpath(application),path.join(physical,...tail)))throw Error('Choose a data directory outside the application folder, including linked locations.');
}
export function startupMessage(error){if(['EEXIST','ENOTDIR'].includes(error.code))return 'The selected data path is not usable as a directory. Choose an approved writable folder.';if(error.code==='EADDRINUSE')return 'The local port is already in use. Close the other instance or select another port with --port.';if(['EACCES','EPERM','EROFS'].includes(error.code))return 'The selected data location or local port is not writable/accessible. Choose an approved writable data folder or ask your IT contact.';if(error.code==='ENOSPC')return 'The data volume is full. Free space before trying again; existing research files were not intentionally removed.';if(error.message==='This workspace is already in use.')return 'The data folder is locked by another process. Close its application instance or ask for help checking the lock.';return 'The application could not start. Run --diagnose for a local inventory and check the setup guide.';}
