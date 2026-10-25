import {metricField,rowGroup,SOURCES} from './catalogue.mjs';
export const SAVED_ANALYSIS_TRANSFORM='saved-selection-v1';
export const RECONCILIATION_TOLERANCE={absolute:1e-9,relative:1e-12};
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
export function savedBins(q){const bins=[];let start=Date.parse(q.start),end=Date.parse(q.end);while(start<end){const date=new Date(start),next=q.interval==='ENTIRE'?end:q.interval==='MONTHLY'?Math.min(end,Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,1)):Math.min(end,start+86400000);bins.push({key:q.interval==='ENTIRE'?'entire-period':date.toISOString().slice(0,q.interval==='MONTHLY'?7:10),start:new Date(start).toISOString().slice(0,10),end:new Date(next).toISOString().slice(0,10)});if(bins.length>10000)throw Error('Saved view exceeds 10,000 time bins.');start=next;}return bins;}
export const savedRowBin=(row,q)=>q.interval==='ENTIRE'?'entire-period':row.date.slice(0,q.interval==='MONTHLY'?7:10);
export function savedViewShape(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['start','end','time','group'].includes(k)))throw Error('Unsupported saved-view filter.');
 const options={time:input.time??'',group:input.group??''};for(const value of Object.values(options))if(typeof value!=='string'||value.length>200)throw Error('Invalid saved-view filter.');
 for(const key of ['start','end'])if(Object.hasOwn(input,key)){if(typeof input[key]!=='string'||input[key]&&!validDate(input[key]))throw Error('Use a valid UTC display date.');options[key]=input[key];}if(options.start&&options.end&&options.start>=options.end)throw Error('Display end must follow display start.');return options;
}
export function savedViewOptions(q,rows,input={}){
 const options=savedViewShape(input);
 const start=input.start||q.start,end=input.end||q.end;if(!validDate(start)||!validDate(end)||start<q.start||end>q.end||start>=end)throw Error('Choose a display window inside the saved interval, with an exclusive end.');
 if(q.interval==='MONTHLY'&&[start,end].some(d=>d!==q.start&&d!==q.end&&!d.endsWith('-01')))throw Error('Monthly display windows must use month boundaries or the original endpoints.');
 if(q.interval==='ENTIRE'&&(start!==q.start||end!==q.end))throw Error('Whole-period data cannot be split into finer time windows.');
 if(options.time&&!rows.some(r=>r.date===options.time)||options.group&&!rows.some(r=>rowGroup(r,q)===options.group))throw Error('Report selection is not present in the saved extract.');
 let bins=savedBins(q).filter(b=>b.start>=start&&b.end<=end);
 if(options.time){const bin=savedRowBin(rows.find(r=>r.date===options.time),q);if(!bins.some(b=>b.key===bin))throw Error('The selected original time label is outside the display window.');bins=bins.filter(b=>b.key===bin);}
 if(Object.hasOwn(input,'start')||Object.hasOwn(input,'end'))Object.assign(options,{start,end});
 return {options,window:{start,end},bins};
}
function accumulator(){return {value:0,correction:0,rows:0};}
function add(total,value){const corrected=value-total.correction,next=total.value+corrected;if(!Number.isFinite(next))throw Error('Report aggregation exceeds the numeric range.');total.correction=(next-total.value)-corrected;total.value=next;total.rows++;}
function addAt(map,key,value){let total=map.get(key);if(!total){total=accumulator();map.set(key,total);}add(total,value);}
function sum(values){const total=accumulator();for(const value of values)add(total,value);return total.value;}
export function analyzeSavedRows(q,rows,input={}, {maxCells=20000,includeRowIndices=false}={}){
 if(!Object.hasOwn(SOURCES,q.source))throw Error('Unsupported saved source.');const field=metricField(q.source);
 const selection=savedViewOptions(q,rows,input),keys=new Set(selection.bins.map(b=>b.key)),total=accumulator(),groups=new Map(),series=new Map(),cells=new Map(),rowIndices=[];
 for(let index=0;index<rows.length;index++){const row=rows[index],bin=savedRowBin(row,q),group=rowGroup(row,q);if(!keys.has(bin)||selection.options.time&&row.date!==selection.options.time||selection.options.group&&group!==selection.options.group)continue;const value=row[field];if(typeof value!=='number'||!Number.isFinite(value)||value<0)throw Error('Invalid saved measure.');add(total,value);if(q.source==='gfw-sar'&&!Number.isSafeInteger(total.value))throw Error('Detection totals exceed exact integer precision.');addAt(groups,group,value);addAt(series,bin,value);addAt(cells,`${row.lon},${row.lat}`,value);if(includeRowIndices)rowIndices.push(index);}
 const groupRows=[...groups].map(([group,a])=>({group,value:a.value,rows:a.rows,share:total.value>0?a.value/total.value:null})).sort((a,b)=>b.value-a.value||(a.group<b.group?-1:a.group>b.group?1:0));
 const timeRows=selection.bins.map(b=>({...b,value:series.get(b.key)?.value??null,rows:series.get(b.key)?.rows??0}));
 const tolerance=Math.max(RECONCILIATION_TOLERANCE.absolute,Math.abs(total.value)*RECONCILIATION_TOLERANCE.relative),totals={series:sum(timeRows.map(b=>b.value??0)),groups:sum(groupRows.map(g=>g.value)),cells:sum([...cells.values()].map(c=>c.value))};
 if(Object.values(totals).some(v=>Math.abs(v-total.value)>tolerance))throw Error('Saved-view totals failed numerical reconciliation.');
 const envelope=[...q.bounds];for(const key of cells.keys()){const [lon,lat]=key.split(',').map(Number);envelope[0]=Math.min(envelope[0],lon);envelope[1]=Math.min(envelope[1],lat);envelope[2]=Math.max(envelope[2],lon);envelope[3]=Math.max(envelope[3],lat);}
 return {...selection,transform:SAVED_ANALYSIS_TRANSFORM,rows:total.rows,total:total.rows?total.value:null,groups:groupRows,series:timeRows,cellCount:cells.size,mapOmitted:cells.size>maxCells,cells:cells.size>maxCells?[]:[...cells].map(([key,a])=>{const [lon,lat]=key.split(',').map(Number);return {lon,lat,value:a.value};}),envelope,rowIndices,reconciliation:{...totals,tolerance,method:'Compensated Float64 sums; tolerance is numerical, not measurement accuracy.'}};
}
export function displayMeasure(value,locale){if(value===null)return 'No returned rows';if(value===0)return '0';return Math.abs(value)<.001||Math.abs(value)>=1e9?value.toExponential(6):value.toLocaleString(locale,{maximumSignificantDigits:9});}
