import {hash} from './domain.mjs';
// The immutable base query is stored once. Chunk dates are the only overrides.
export function compactBatch(batch){return {...batch,parts:batch.parts.map(({query,...part})=>part),storageSchemaVersion:2};}
export const batchFingerprint=batch=>hash(compactBatch(batch));
export function expandBatch(record){
 if(record.storageSchemaVersion===undefined)return record;
 if(record.storageSchemaVersion!==2||!Array.isArray(record.parts)||record.parts.some(p=>Object.hasOwn(p,'query')))throw Error('Unsupported batch storage schema.');
 const {storageSchemaVersion,...batch}=record;
 batch.parts=record.parts.map(p=>({index:p.index,start:p.start,end:p.end,query:{...batch.query,start:p.start,end:p.end},...p}));return batch;
}
