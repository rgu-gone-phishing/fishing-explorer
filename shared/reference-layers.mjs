import {normalizeGeometry} from './geometry.mjs';
export function parseCSV(text){
 const rows=[];let row=[],field='',quoted=false,afterQuote=false;
 const fieldEnd=()=>{row.push(field);if(row.length>100)throw Error('CSV supports at most 100 columns.');field='';afterQuote=false;};
 const rowEnd=()=>{fieldEnd();if(row.some(v=>v.trim()!=='')){rows.push(row);if(rows.length>2001)throw Error('CSV supports at most 2,000 data rows per reference import or schema sample.');}row=[];};
 text=text.replace(/^\uFEFF/,'');
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;afterQuote=true;}}else field+=c;continue;}
  if(c===','){fieldEnd();continue;}if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;rowEnd();continue;}
  if(afterQuote){if(c===' '||c==='\t')continue;throw Error('Malformed CSV after a quoted field.');}
  if(c==='"'){if(field!=='')throw Error('Quote inside an unquoted CSV field.');quoted=true;}else field+=c;
 }
 if(quoted)throw Error('CSV contains an unclosed quoted field.');if(field||row.length||afterQuote)rowEnd();
 if(rows.length<2)throw Error('CSV needs a header and at least one data row.');
 const headers=rows.shift().map(h=>h.trim());
 if(headers.length>100||headers.some(h=>!h||['__proto__','constructor','prototype'].includes(h))||new Set(headers).size!==headers.length)throw Error('CSV headers must be unique, nonempty and not reserved.');
 if(rows.some(r=>r.length!==headers.length))throw Error('CSV rows have different column counts.');
 if(rows.length>2000)throw Error('Reference layers currently support at most 2,000 features.');
 return {headers,rows};
}
const point=p=>{if(!Array.isArray(p)||p.length!==2||p.some(n=>typeof n!=='number'||!Number.isFinite(n))||Math.abs(p[0])>180||Math.abs(p[1])>85)throw Error('Reference coordinates must be 2D WGS84 longitude/latitude within ±180° / ±85°.');return p;};
export function normalizeReference(input){
 if(!input||typeof input!=='object'||input.crs)throw Error('Use WGS84 GeoJSON without a custom CRS; reproject explicitly before importing.');
 const features=input.type==='FeatureCollection'?input.features:input.type==='Feature'?[input]:[{type:'Feature',properties:{},geometry:input}];
 if(!Array.isArray(features)||!features.length||features.length>2000)throw Error('Use 1–2,000 reference features.');
 let vertices=0,propertyNodes=0;
 return {type:'FeatureCollection',features:features.map((f,index)=>{
  if(f?.type!=='Feature'||!f.geometry||f.crs||f.geometry.crs)throw Error('Malformed reference feature or custom CRS.');
  const g=f.geometry;
  if(g.type==='Point'){point(g.coordinates);vertices++;}
  else if(g.type==='LineString'){
   if(!Array.isArray(g.coordinates)||g.coordinates.length<2)throw Error('A line needs at least two positions.');
   for(let i=0;i<g.coordinates.length;i++){point(g.coordinates[i]);if(i&&Math.abs(g.coordinates[i][0]-g.coordinates[i-1][0])>180)throw Error('Antimeridian lines are not supported.');}vertices+=g.coordinates.length;
  }else if(['Polygon','MultiPolygon'].includes(g.type)){normalizeGeometry(g);vertices+=g.type==='Polygon'?g.coordinates.flat().length:g.coordinates.flat(2).length;}
  else throw Error('Supported reference geometries: Point, LineString, Polygon and MultiPolygon.');
  if(vertices>20000)throw Error('Reference layer exceeds 20,000 vertices. No automatic simplification is performed.');
  const properties=f.properties??{};if(typeof properties!=='object'||Array.isArray(properties))throw Error('Feature properties must be an object.');
  const stack=[{value:properties,depth:0}];while(stack.length){const {value,depth}=stack.pop();if(++propertyNodes>50000||depth>8)throw Error('Reference properties are too complex.');if(value&&typeof value==='object')for(const v of Object.values(value))stack.push({value:v,depth:depth+1});}
  return {type:'Feature',id:typeof f.id==='string'||typeof f.id==='number'?f.id:index,properties,geometry:{type:g.type,coordinates:g.coordinates}};
 })};
}
export function csvReference(content,{longitudeColumn,latitudeColumn}){
 const {headers,rows}=parseCSV(content),lon=headers.indexOf(longitudeColumn),lat=headers.indexOf(latitudeColumn);
 if(lon<0||lat<0||lon===lat)throw Error('Select different longitude and latitude columns.');
 const numeric=value=>{if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()))throw Error('Coordinate cells must be decimal numbers, not blanks or formulas.');return Number(value);};
 return normalizeReference({type:'FeatureCollection',features:rows.map((r,i)=>({type:'Feature',id:i,properties:Object.fromEntries(headers.map((h,j)=>[h,r[j]])),geometry:{type:'Point',coordinates:[numeric(r[lon]),numeric(r[lat])]}}))});
}
