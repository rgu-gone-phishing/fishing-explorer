import {areaEventQuery,areaEventBody} from './area-events.mjs';
export const STAT_INTERVALS=['HOUR','DAY','MONTH','YEAR'];
export const STAT_INCLUDES=['EVENTS_GROUPED','TIME_SERIES','TOTAL_COUNT'];
export const STAT_GROUPS={FLAG:'Flag',GEARTYPE:'Gear type',REGION_EEZ:'EEZ',REGION_EEZ12NM:'12-nautical-mile area',REGION_FAO:'FAO area',REGION_HIGH_SEAS:'High seas',REGION_MAJOR_FAO:'Major FAO area',REGION_MPA:'Protected area',REGION_MPA_NO_TAKE:'No-take protected area',REGION_MPA_NO_TAKE_PARTIAL:'Partially no-take protected area',REGION_RFMO:'Fisheries management region',NEXT_PORT_ID:'Next port'};
export const EVENT_STATS_CAVEAT='Provider aggregates are a separate response, not counts reconstructed from loaded event pages. Distinct vessel and flag counts are provider-defined and must not be summed across periods or groups. Overlap totals and source time-bin counts may use different assignment rules; no equality is assumed. Regional groups can overlap. Missing bins/fields remain unavailable, not zero, and empty results do not establish absence of maritime activity.';
export function eventStatsQuery(input){
 if(input?.kind!=='event-stats'||Object.hasOwn(input,'limit'))throw Error('Statistics use a single response, without a page limit.');
 const {kind,timeseriesInterval='DAY',groupBy='FLAG',includes=STAT_INCLUDES,...area}=input;
 if(!STAT_INTERVALS.includes(timeseriesInterval)||!Object.hasOwn(STAT_GROUPS,groupBy)||!Array.isArray(includes)||!includes.length||includes.length>3||includes.some(v=>!STAT_INCLUDES.includes(v)))throw Error('Select supported statistic sections, time interval and grouping.');
 const {limit,...base}=areaEventQuery({...area,kind:'area-events'});return {...base,kind:'event-stats',timeseriesInterval,groupBy,includes:[...new Set(includes)].sort()};
}
export const eventStatsBody=q=>({...areaEventBody(q),timeseriesInterval:q.timeseriesInterval,groupBy:q.groupBy,includes:q.includes});
export function validateStatsResponse(data){if(!data||typeof data!=='object'||Array.isArray(data)||!['numEvents','numVessels','numFlags','timeseries','groups','flags'].some(k=>Object.hasOwn(data,k)))throw Error('Unsupported event-statistics response schema.');return data;}
export function statisticCount(value){
 if(value===undefined||value===null||value===''||['NA','N/A'].includes(value))return {value:null,reason:'Not supplied / not available'};
 const n=typeof value==='number'?value:typeof value==='string'&&/^\d+$/.test(value)?Number(value):NaN;
 return Number.isSafeInteger(n)&&n>=0?{value:n,reason:null}:{value:null,reason:'Unsupported source count; inspect the original response'};
}
function records(value){if(value===undefined||value===null)return {state:'unavailable',rows:[],unsupported:0};if(!Array.isArray(value))return {state:'unsupported',rows:[],unsupported:1};const rows=value.filter(r=>r&&typeof r==='object'&&!Array.isArray(r));return {state:'returned',rows,unsupported:value.length-rows.length};}
const timeLabel=s=>{if(typeof s!=='string'||!/^\d{4}(?:-\d{2}(?:-\d{2}(?:T.*)?)?)?$/.test(s)||!Number.isFinite(Date.parse(s)))return false;return s.length<10||new Date(s.slice(0,10)).toISOString().slice(0,10)===s.slice(0,10);};
export function summarizeEventStats(data,query){
 const warnings=[],metrics=query.includes.includes('TOTAL_COUNT')?[['numEvents','Provider events'],['numVessels','Provider distinct vessels'],['numFlags','Provider distinct flags']].map(([field,label])=>({field,label,...statisticCount(data[field])})):[];
 const series=records(data.timeseries),groups=records(data.groups);series.requested=query.includes.includes('TIME_SERIES');groups.requested=query.includes.includes('EVENTS_GROUPED');
 const seen=new Set();series.rows=series.rows.map(r=>{const count=statisticCount(r.value),validLabel=timeLabel(r.date);if(validLabel&&seen.has(r.date))warnings.push('Repeated provider time labels were retained as separate rows.');seen.add(r.date);return {label:r.date??null,validLabel,...count,raw:r};});
 groups.rows=groups.rows.map(r=>({label:r.label??r.name??r.flag??'Unspecified group',name:r.name??null,flag:r.flag??null,...statisticCount(r.value),raw:r}));
 let seriesSum=null;if(series.requested&&series.state==='returned'&&!series.unsupported&&series.rows.length&&series.rows.every(r=>r.value!==null&&r.validLabel)){const sum=series.rows.reduce((s,r)=>s+r.value,0);if(Number.isSafeInteger(sum))seriesSum=sum;}
 const total=metrics.find(m=>m.field==='numEvents')?.value;if(seriesSum!==null&&total!==undefined&&total!==null&&seriesSum!==total)warnings.push(`Returned time-bin counts sum to ${seriesSum}, while the provider total is ${total}. Assignment rules or coverage can differ; no local reconciliation was applied.`);
 if(series.unsupported||groups.unsupported)warnings.push('Unsupported aggregate entries are retained in the raw response.');
 if(series.rows.some(r=>!r.validLabel))warnings.push('Unrecognized source time labels remain in the table but are not plotted.');
 return {metrics,series,groups,seriesSum,warnings:[...new Set(warnings)],flags:Array.isArray(data.flags)?data.flags:null};
}
