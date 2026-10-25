import {readdir} from 'node:fs/promises';
import {join} from 'node:path';
export const ARCHIVE_FOLDER='imported-batches';
export const archiveId=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
export function archiveDirectory(workspace,id){if(!archiveId(id))throw Error('Invalid batch archive identity.');return join(workspace,ARCHIVE_FOLDER,id);}
export async function archiveDirectories(workspace){try{return (await readdir(join(workspace,ARCHIVE_FOLDER),{withFileTypes:true})).filter(e=>e.isDirectory()&&archiveId(e.name)).map(e=>e.name);}catch(error){if(error.code==='ENOENT')return [];throw error;}}
