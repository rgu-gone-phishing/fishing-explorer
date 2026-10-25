import {rowsCSV,CSV_TRANSFORM} from './csv.mjs';
import {APPLICATION_BUILD} from './build-info.mjs';
export {encodeCSV} from './csv.mjs';
import { createHash } from 'node:crypto';
import { normalizeGeometry, boundsOf, containsPoint } from '../shared/geometry.mjs';
import {boundarySource} from '../shared/regions.mjs';

export const hash = value => createHash('sha256')
  .update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
import { SOURCES, metricField } from '../shared/catalogue.mjs';
export { SOURCES };
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

export function validate(input, {maxDays} = {}) {
  if (!input || typeof input !== 'object') throw Error('A query is required.');
  const source = SOURCES[input.source];
  if (!source) throw Error('This data source is not supported.');
  const synthetic = input.source === 'synthetic-activity';
  const hasPortDistance=Object.hasOwn(input,'distanceFromPortKm');
  if(hasPortDistance&&(input.source!=='gfw-fishing'||!Number.isInteger(input.distanceFromPortKm)||input.distanceFromPortKm<0||input.distanceFromPortKm>5))throw Error('Minimum port distance is supported only for AIS fishing activity, in whole kilometres from 0 through 5.');
  if (!validDate(input.start) || !validDate(input.end)) throw Error('Enter valid ISO dates.');
  const days = (Date.parse(input.end) - Date.parse(input.start)) / 86400000;
  // A conservative application limit, not a claimed upstream maximum.
  if (days < 1 || days > (maxDays ?? (synthetic ? 31 : 366))) throw Error(`Choose 1–${maxDays ?? (synthetic ? 31 : 366)} days, with an exclusive end date.`);
  if (!synthetic && (input.start < source.start || Date.parse(input.end) > Date.now())) throw Error(`This source supports dates from ${source.start} to today. Recent data may be unavailable.`);
  const grid = Number(input.grid);
  if (![0.1, 0.01].includes(grid)) throw Error('Choose a supported grid.');
  if (!['DAILY', 'MONTHLY', 'ENTIRE'].includes(input.interval)) throw Error('Choose a supported time bin.');
  const custom = input.geometry ? normalizeGeometry(input.geometry) : null;
  const b = custom ? boundsOf(custom) : input.bounds;
  if (!Array.isArray(b) || b.length !== 4 || b.some(n => typeof n !== 'number' || !Number.isFinite(n))) throw Error('Bounds require four numeric coordinates.');
  if (b[0] < -180 || b[2] > 180 || b[1] < -85 || b[3] > 85 || b[2] <= b[0] || b[3] <= b[1]) throw Error('Use west < east, south < north, latitude within ±85°. Antimeridian areas are not yet supported.');
  if (synthetic && (b[2] - b[0] < grid * 2 || b[3] - b[1] < grid * 2)) throw Error('The demonstration area must be at least two cells wide and high.');
  const common = {schemaVersion: 1, source: input.source, datasetVersion: 'fixture-v1', metric: source.metric,
    start: input.start, end: input.end, endExclusive: true, grid, interval: input.interval, grouping: 'GEARTYPE', bounds: [...b]};
  if(custom){common.schemaVersion=3;common.geometry=custom;}
  const withBoundary=value=>{if(input.boundarySource){if(!custom)throw Error('Named-boundary provenance requires its exact saved geometry.');const source=boundarySource(input.boundarySource);if(source.geometrySha256!==hash(custom))throw Error('Named boundary changed. Clear its source association before editing.');return {...value,schemaVersion:5,boundarySource:source};}return value;};
  if (synthetic) return withBoundary(common); // Preserve existing fixture query hashes.
  if (!['v4.0', 'v5.0'].includes(input.datasetVersion)) throw Error('Choose an explicit dataset version.');
  if (!source.groupings.includes(input.grouping)) throw Error('Unsupported grouping.');
  function list(value, pattern) {
    if (!Array.isArray(value) || value.length > 50 || value.some(x => typeof x !== 'string' || !pattern.test(x))) throw Error('Invalid filter values. Use three-letter flags or gear names containing letters and underscores.');
    return [...new Set(value)].sort();
  }
  const flags=list(input.flags || [], /^[A-Z]{3}$/),gears=list(input.gears || [], /^[a-z_]{1,50}$/);
  if(input.source==='gfw-presence'&&gears.length)throw Error('Presence uses vessel-type filters, not gear filters.');
  if(input.source!=='gfw-presence'&&input.vesselTypes?.length)throw Error('Vessel-type filters are only supported for presence.');
  if(input.source!=='gfw-sar'&&input.matched&&input.matched!=='any')throw Error('AIS matching filters are only supported for SAR.');
  const result={...common,schemaVersion:custom?3:2,datasetVersion:input.datasetVersion,grouping:input.grouping,flags,gears};
  if(input.source==='gfw-presence'){result.schemaVersion=4;result.vesselTypes=list(input.vesselTypes||[],/^[a-z_]{1,50}$/);}
  if(input.source==='gfw-sar'){result.schemaVersion=4;result.matched=input.matched||'any';if(!['any','true','false'].includes(result.matched))throw Error('Choose all, AIS-matched, or unmatched SAR detections.');}
  const normalized=withBoundary(result);if(hasPortDistance){normalized.schemaVersion=6;normalized.distanceFromPortKm=input.distanceFromPortKm;}return normalized;
}

export function geometry(query) {
  if(query.geometry)return query.geometry;
  const [w, s, e, n] = query.bounds;
  return {type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]]};
}
export function reportRowBin(row,query){
 const [west,south,east,north]=query.bounds,margin=query.grid;
 if(row.lon<west-margin||row.lon>east+margin||row.lat<south-margin||row.lat>north+margin)throw Error('Artifact coordinates lie outside the requested area envelope.');
 if(query.interval==='ENTIRE')return 'entire-period';
 const day=row.date.slice(0,10);
 if(query.interval==='DAILY'){if(!validDate(day)||day<query.start||day>=query.end)throw Error('Artifact dates lie outside the requested daily window.');return day;}
 const month=row.date.slice(0,7);if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||(row.date.length!==7&&!validDate(day)))throw Error('Unsupported artifact monthly date label.');
 const begin=Date.parse(month+'-01'),d=new Date(begin),end=Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1);if(end<=Date.parse(query.start)||begin>=Date.parse(query.end))throw Error('Artifact months do not overlap the query window.');return month;
}
export function archive(query, id, rows, {createdAt = new Date().toISOString(), raw, responseVersion = null, request = null, receivedAt} = {}) {
  const synthetic = query.source === 'synthetic-activity';
  const csv = rowsCSV(query,rows);
  let caveats = synthetic
    ? 'SYNTHETIC DEMONSTRATION. No GFW observations or API requests. Four illustrative cells per day; these do not represent area coverage. Values must not be used for research.\n'
    : 'AIS apparent fishing activity is inferred, not confirmed fishing or catch. Coverage, reception and vessel adoption vary. Missing cells do not prove absence. Grid resolution is aggregation scale, not positional accuracy. Source caveats: https://globalfishingwatch.org/our-apis/documentation/docs/v3/general-api-doc/data-caveats\nUse conditions: https://globalfishingwatch.org/our-apis/documentation/docs/license-rate-limits\nPowered by Global Fishing Watch: https://globalfishingwatch.org\n';
  if(!synthetic)caveats=SOURCES[query.source].description+' Missing cells do not establish absence. Retain product-specific caveats and licenses: https://globalfishingwatch.org/our-apis/documentation/docs/v3/general-api-doc/data-caveats | https://globalfishingwatch.org/our-apis/documentation/docs/license-rate-limits | Powered by Global Fishing Watch: https://globalfishingwatch.org\n';
  if(query.distanceFromPortKm!==undefined)caveats+=`PROVIDER PORT FILTER: distance_from_port_km >= ${query.distanceFromPortKm} km. This uses the provider’s port/anchorage distance classification, not a locally calculated buffer, positional accuracy or confidence score. Returned grid cells can overlap excluded areas; no local clipping or inference of row-level distance is applied.\n`;
  if(request?.recovery)caveats+='RECOVERY ASSOCIATION: this result was attached after explicit user review. Provider metadata did not prove that the last report belonged to the recorded query. See manifest provenance for the manual association record.\n';
  const files = {'data.json': JSON.stringify(rows), 'data.csv': csv, 'query.json': JSON.stringify(query) + '\n',
    'boundary.geojson': JSON.stringify(geometry(query)) + '\n', 'caveats.txt': caveats};
  if(query.boundarySource){files['boundary-source.json']=JSON.stringify(query.boundarySource,null,2)+'\n';files['caveats.txt']+='NAMED BOUNDARY: the actual analysis geometry is in boundary.geojson. Source identity, supplied version (or unknown), retrieval time, requested simplification and response hashes are in boundary-source.json. Full original/simplified provider responses are retained separately in the local region snapshot backup. This boundary is not evidence of historical jurisdiction or protection status.\n';}
  if (raw !== undefined) files['upstream-response.json'] = raw;
  const manifest = {schemaVersion: 1, id, createdAt, source: query.source, datasetVersion: query.datasetVersion,
    responseVersion, responseVersionStatus: synthetic ? 'not applicable: synthetic generator' : responseVersion ? 'reported by provider' : 'not supplied',
    queryHash: hash(query), complete: true, rows: rows.length, units: query.metric,
    provenance: {generator: synthetic ? 'fixture-v1' : null, upstream: synthetic ? 'none' : 'Global Fishing Watch API v3',
      confidence: 'not supplied', observations: false, processing: SOURCES[query.source].processing,
      transform: 'normalized-report-v1', applicationBuild:{...APPLICATION_BUILD}, csvTransform:CSV_TRANSFORM, ...(receivedAt?{receivedAt}:{}), request},
    files: Object.fromEntries(Object.entries(files).map(([name, content]) => [name, {sha256: hash(content), bytes: Buffer.byteLength(content)}]))};
  return {manifest, query, rows, files};
}
export function makeArtifact(query, id, createdAt = new Date().toISOString()) {
  if (query.source !== 'synthetic-activity') throw Error('The fixture generator cannot produce live data.');
  const rows = new Map();
  const cells=Array.from({length:4},(_,cell)=>({cell,lat:Number((query.bounds[1]+Math.floor(cell/2)*query.grid).toFixed(8)),lon:Number((query.bounds[0]+cell%2*query.grid).toFixed(8))})).filter(({lat,lon})=>!query.geometry||containsPoint([lon+query.grid/2,lat+query.grid/2],query.geometry));
  for (let time = Date.parse(query.start); time < Date.parse(query.end); time += 86400000) {
    const day = new Date(time).toISOString().slice(0, 10);
    const bin = query.interval === 'DAILY' ? day : query.interval === 'MONTHLY' ? day.slice(0, 7) : 'entire-period';
    for (const {cell,lat,lon} of cells) {
      const gear = cell % 2 ? 'TRAWLERS' : 'FISHING';
      const key = [bin, lat, lon, gear].join('|');
      const row = rows.get(key) || {date: bin, lat, lon, geartype: gear, hours: 0};
      row.hours += cell + 1;
      rows.set(key, row);
    }
  }
  return archive(query, id, [...rows.values()], {createdAt});
}

export function verifyArtifact(artifact) {
  const {manifest, files, query, rows} = artifact;
  const field=metricField(query?.source);
  if (!Array.isArray(rows) || rows.some(row => !row || typeof row.date !== 'string' || ['lat','lon',field].some(k => typeof row[k] !== 'number' || !Number.isFinite(row[k])) || row[field] < 0 || (field==='detections'&&(!Number.isInteger(row.detections)||Object.hasOwn(row,'hours'))) || (field==='hours'&&Object.hasOwn(row,'detections')) || Math.abs(row.lat)>90 || Math.abs(row.lon)>180)) throw Error('Invalid artifact data rows.');
  if (manifest?.source !== query?.source || manifest?.datasetVersion !== query?.datasetVersion || manifest?.units !== query?.metric) throw Error('Artifact metadata does not match its query.');
  if (manifest?.schemaVersion !== 1 || manifest.complete !== true || manifest.queryHash !== hash(validate(query)) || manifest.queryHash !== hash(query)) throw Error('Artifact query or manifest is invalid.');
  if(rows.some(row=>['geartype','vesselType','flag','vesselId'].some(key=>row[key]!==undefined&&typeof row[key]!=='string')))throw Error('Unsupported normalized dimension type.');
  if(manifest.provenance?.receivedAt!==undefined&&(typeof manifest.provenance.receivedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(manifest.provenance.receivedAt)||!Number.isFinite(Date.parse(manifest.provenance.receivedAt))))throw Error('Invalid payload-receipt timestamp.');
  if(manifest.provenance?.csvTransform!==undefined&&manifest.provenance.csvTransform!==CSV_TRANSFORM)throw Error('Unsupported CSV transformation version.');
  for(const row of rows)reportRowBin(row,query);
  for (const name of ['data.json', 'data.csv', 'query.json', 'boundary.geojson', 'caveats.txt', ...(query.boundarySource?['boundary-source.json']:[]), ...Object.keys(manifest.files || {})]) {
    const content = files?.[name];
    const expected = manifest.files?.[name];
    if (typeof content !== 'string' || !expected || hash(content) !== expected.sha256 || Buffer.byteLength(content) !== expected.bytes) throw Error('Artifact integrity check failed. Preserve the file for diagnosis.');
  }
  if (JSON.stringify(rows) !== files['data.json'] || JSON.stringify(query) !== JSON.stringify(JSON.parse(files['query.json'])) || rows.length !== manifest.rows) throw Error('Artifact contents disagree with the manifest.');
  if(JSON.stringify(JSON.parse(files['boundary.geojson']))!==JSON.stringify(geometry(query))||(query.boundarySource&&JSON.stringify(JSON.parse(files['boundary-source.json']))!==JSON.stringify(query.boundarySource)))throw Error('Artifact boundary disagrees with its query provenance.');
  if(manifest.provenance?.csvTransform===CSV_TRANSFORM&&files['data.csv']!==rowsCSV(query,rows))throw Error('CSV values disagree with normalized rows.');
  return artifact;
}
