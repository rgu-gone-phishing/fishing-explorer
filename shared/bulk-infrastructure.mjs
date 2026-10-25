import {infrastructureQuery} from './infrastructure.mjs';
export const BULK_DATASET='public-fixed-infrastructure-data:v1.1';
export const BULK_NOTES=[
 'Bulk detections are a separate, less-filtered product from the infrastructure map. Noise and additional regions may be included.',
 'Rows describe source detections/records, not an authoritative installation inventory. Repeated structure IDs must not be counted as distinct structures.',
 'Label confidence is a source category, not a probability of operation or fishing impact. Unavailable evidence is not low confidence.',
 'Date filters select a structure’s first or last detection date. They do not select every individual detection date, continuous operation or activity during that interval.',
 'All original fields and compressed data are retained. A local preview is a subset, not a complete map or absence test.',
 'Stopping local retrieval does not cancel report generation at GFW. Reopening local work never resubmits a report automatically.',
];
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
export function bulkQuery(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Choose a bulk infrastructure query.');
 if(input.dataset!==undefined&&input.dataset!==BULK_DATASET)throw Error('Unsupported bulk infrastructure dataset version.');
 const area=infrastructureQuery({...input,start:'2017-01-01',end:'2017-01-02'}),dateMode=input.dateMode??'all';
 if(!['all','first','last'].includes(dateMode))throw Error('Choose all dates, first detection or last detection.');
 const start=dateMode==='all'?null:input.start,end=dateMode==='all'?null:input.end;
 if(dateMode!=='all'&&(!date(start)||!date(end)||start<'2017-01-01'||start>=end||Date.parse(end)>Date.now()))throw Error('Choose valid dates from 2017 through today with an exclusive end.');
 const list=(values,allowed)=>{if(!Array.isArray(values)||values.some(v=>!allowed.includes(v)))throw Error('Unsupported bulk label/confidence selection.');return [...new Set(values)].sort();};
 const labels=list(input.labels??[],['oil','wind','unknown','noise','lake maracaibo']),confidences=list(input.confidences??[],['high','medium','low']);const structureId=input.structureId??'';if(typeof structureId!=='string'||structureId&&!/^[a-zA-Z0-9_-]{1,100}$/.test(structureId))throw Error('Use a single structure ID containing only letters, digits, hyphens or underscores.');
 return {schemaVersion:1,dataset:BULK_DATASET,format:'CSV',geometry:area.geometry,bounds:area.bounds,dateMode,start,end,labels,confidences,structureId};
}
export function bulkFilters(q){const filters=[];if(q.structureId)filters.push(`structure_id = '${q.structureId}'`);if(q.labels.length)filters.push(`label in (${q.labels.map(v=>`'${v}'`).join(',')})`);if(q.confidences.length)filters.push(`label_confidence in (${q.confidences.map(v=>`'${v}'`).join(',')})`);if(q.dateMode!=='all'){const field=q.dateMode==='first'?'structure_start_date':'structure_end_date';filters.push(`${field} >= '${q.start}'`,`${field} < '${q.end}'`);}return filters;}
export function bulkRequest(q,id){return {name:`Fishing Explorer ${id}`,dataset:q.dataset,format:'CSV',filters:bulkFilters(q),geojson:q.geometry};}
