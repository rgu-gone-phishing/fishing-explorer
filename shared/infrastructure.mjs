import {normalizeGeometry,boundsOf} from './geometry.mjs';
export const INFRASTRUCTURE_DATASET='public-fixed-infrastructure-filtered:v1.1';
export const INFRASTRUCTURE_NOTES=[
 'GFW filtered map product: predicted oil-related, wind-related and unknown structures. These are not authoritative installation or operating-status records.',
 'The provider excludes noise, requires repeated detection and applies geographic noise masks; this differs from the bulk detection product.',
 'First/last detection spans do not establish continuous detection or operation. Labels may change as source data is revised.',
 'High/medium/low confidence are source-defined label categories, not probabilities; missing evidence remains separate.',
 'Satellite coverage varies. Missing structures or missing tiles do not establish absence.',
 'Coordinates use the supplied longitude/latitude properties, not quantized vector-tile geometry. No positional-accuracy guarantee is implied.',
 'Tile retrieval is not date-filtered. Display dates select overlapping detection spans locally and can be changed without downloading again.',
 'Tiles may include locations outside the selected polygon; only points inside it are shown. No causal interaction with fishing is inferred.',
];
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
export function infrastructureQuery(input){
 if(!input||!date(input.start)||!date(input.end)||input.start<'2017-01-01'||input.start>=input.end||Date.parse(input.end)>Date.now())throw Error('Choose valid infrastructure dates from 2017 to today, with an exclusive end.');
 let area=input.geometry;if(!area){const b=input.bounds;if(!Array.isArray(b)||b.length!==4||b.some(x=>typeof x!=='number'||!Number.isFinite(x))||b[0]>=b[2]||b[1]>=b[3])throw Error('Choose valid area bounds.');const middle=(b[0]+b[2])/2;area={type:'Polygon',coordinates:[b[2]-b[0]>180?[[b[0],b[1]],[middle,b[1]],[b[2],b[1]],[b[2],b[3]],[middle,b[3]],[b[0],b[3]],[b[0],b[1]]]:[[b[0],b[1]],[b[2],b[1]],[b[2],b[3]],[b[0],b[3]],[b[0],b[1]]]]};}
 const geometry=normalizeGeometry(area);return {schemaVersion:1,dataset:INFRASTRUCTURE_DATASET,start:input.start,end:input.end,geometry,bounds:boundsOf(geometry)};
}
export function infrastructureTiles(query){
 const [west,south,east,north]=query.bounds,latY=(lat,z)=>(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*2**z;
 for(let z=5;z>=0;z--){const n=2**z,left=Math.max(0,Math.floor((west+180)/360*n)),right=Math.min(n-1,Math.floor((east+180)/360*n)),top=Math.max(0,Math.floor(latY(north,z))),bottom=Math.min(n-1,Math.floor(latY(south,z)));
  if((right-left+1)*(bottom-top+1)>16)continue;const tiles=[];for(let x=left;x<=right;x++)for(let y=top;y<=bottom;y++)tiles.push({z,x,y,status:'pending'});return tiles;
 }throw Error('Unable to plan infrastructure tiles.');
}
export function infrastructureDisplay(query,input={}){
 const start=input.start||query.start,end=input.end||query.end,label=input.label||'all',confidence=input.confidence||'all',offset=Number(input.offset||0);
 if(!date(start)||!date(end)||start<'2017-01-01'||Date.parse(end)>Date.now()||start>=end)throw Error('Choose valid display dates from 2017 to today. Saved tiles retain all returned detection spans.');
 if(!['all','oil','wind','unknown','other'].includes(label)||!['all','high','medium','low','unavailable','other'].includes(confidence)||!Number.isSafeInteger(offset)||offset<0)throw Error('Invalid infrastructure display filters.');
 const includeUndated=input.includeUndated===undefined||input.includeUndated===true||input.includeUndated==='true';return {start,end,label,confidence,includeUndated,offset,limit:50};
}
