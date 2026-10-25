import { metricField } from '../shared/catalogue.mjs';
import { archive, geometry, SOURCES } from './domain.mjs';
import {retryAfter} from './retry-policy.mjs';

const BASE = 'https://gateway.api.globalfishingwatch.org/v3';
export class ProviderError extends Error {
  constructor(message, state = 'failed', details={}) { super(message); this.state = state; Object.assign(this,details); }
}
export function reportRequest(query) {
  const params = new URLSearchParams({format: 'JSON', 'datasets[0]': `${SOURCES[query.source].dataset}:${query.datasetVersion}`,
    'date-range': `${query.start}T00:00:00.000Z,${query.end}T00:00:00.000Z`, 'spatial-resolution': query.grid === 0.01 ? 'HIGH' : 'LOW',
    'spatial-aggregation': 'false', 'temporal-resolution': query.interval, 'group-by': query.grouping});
  if(query.grouping==='NONE')params.delete('group-by');
  const filters = [];
  if (query.flags.length) filters.push(`flag in (${query.flags.map(x => `'${x}'`).join(',')})`);
  if (query.gears.length) filters.push(`geartype in (${query.gears.map(x => `'${x}'`).join(',')})`);
  if(query.vesselTypes?.length)filters.push(`vessel_type in (${query.vesselTypes.map(x=>`'${x}'`).join(',')})`);
  if(query.matched&&query.matched!=='any')filters.push(`matched='${query.matched}'`);
  if(query.distanceFromPortKm!==undefined)filters.push(`distance_from_port_km >= ${query.distanceFromPortKm}`);
  if (filters.length) params.set('filters[0]', filters.join(' AND '));
  return {method: 'POST', url: `${BASE}/4wings/report?${params}`, body: {geojson: geometry(query)}};
}
export function parseReport(raw, query, headerVersion) {
  let data;
  try { data = JSON.parse(raw); } catch { throw new ProviderError('GFW returned an unexpected format. No extract was marked complete.'); }
  const dataset = `${SOURCES[query.source].dataset}:${query.datasetVersion}`;
  let entries = data.entries;
  if (!Array.isArray(entries)) throw new ProviderError('Unexpected GFW report schema.');
  let keyedVersion;
  // Reports may nest rows under the full dataset ID; null means no returned rows.
  if (entries.length === 1 && entries[0] && Object.keys(entries[0]).some(k => k.startsWith('public-'))) {
    const keys = Object.keys(entries[0]);
    if (keys.length !== 1 || keys[0] !== dataset) throw new ProviderError('Report dataset does not match the requested version.');
    keyedVersion = keys[0];
    entries = entries[0][dataset] ?? [];
  }
  if (headerVersion && headerVersion.trim() !== dataset) throw new ProviderError('Response version does not match the requested dataset.');
  if (!Array.isArray(entries)) throw new ProviderError('Unexpected GFW report rows.');
  const field=metricField(query.source);
  const rows = entries.map(row => {
    if (!row || ['lat', 'lon', field].some(key => typeof row[key] !== 'number' || !Number.isFinite(row[key])) || row[field] < 0 || (field==='detections'&&!Number.isInteger(row[field])) || Math.abs(row.lat) > 90 || Math.abs(row.lon) > 180) throw new ProviderError('Report contains invalid coordinates or activity values.');
    if (query.interval !== 'ENTIRE' && typeof row.date !== 'string') throw new ProviderError('Report is missing its time dimension.');
    if(row.lat<query.bounds[1]-query.grid || row.lat>query.bounds[3]+query.grid || row.lon<query.bounds[0]-query.grid || row.lon>query.bounds[2]+query.grid)throw new ProviderError('Report coordinates fall outside the requested area envelope.');
    if(query.interval==='DAILY'){
      const date=row.date.slice(0,10);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||date<query.start||date>=query.end)throw new ProviderError('Report dates fall outside the requested daily window.');
    }
    if(query.interval==='MONTHLY'){
      const match=row.date.match(/^(\d{4})-(0[1-9]|1[0-2])(?:$|-)/);
      if(!match)throw new ProviderError('Unexpected monthly date format.');
      const start=Date.UTC(Number(match[1]),Number(match[2])-1,1),end=Date.UTC(Number(match[1]),Number(match[2]),1);
      if(end<=Date.parse(query.start)||start>=Date.parse(query.end))throw new ProviderError('Report months do not overlap the requested window.');
    }
    return {date: query.interval === 'ENTIRE' ? 'entire-period' : row.date, lat: row.lat, lon: row.lon,
      geartype: String(row.geartype ?? ''), flag: String(row.flag ?? ''), vesselId: String(row.vesselId ?? ''), ...(query.source==='gfw-presence'?{vesselType:String(row.vessel_type??row.vesselType??'')} : {}), [field]: row[field]};
  });
  return {rows, responseVersion: headerVersion || keyedVersion || null};
}
export async function fetchReport(query, id, token, {fetchImpl = fetch, signal, createdAt} = {}) {
  if (!token) throw new ProviderError('Connect your personal GFW API token in Data & methods.', 'needs-authentication');
  const request = reportRequest(query);
  let response;
  try {
    response = await fetchImpl(request.url, {method: 'POST', redirect: 'error', signal: signal || AbortSignal.timeout(115000),
      headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json'}, body: JSON.stringify(request.body)});
  } catch { throw new ProviderError('Connection ended after submission. Upstream completion is unknown; do not submit a duplicate before checking GFW.', 'recovery-needed'); }
  if (response.status === 401) throw new ProviderError('GFW rejected the token. Reconnect with your personal API token.', 'needs-authentication');
  if (response.status === 403) throw new ProviderError('GFW denied access. Check account permissions or network policy; no bypass was attempted.');
  if (response.status === 429) {const wait=retryAfter(response.headers);await response.body?.cancel();throw new ProviderError('GFW report concurrency or quota limit reached. Check other account sessions and quota before retrying.', 'rate-limited',{httpStatus:429,retryAfter:wait});}
  if (response.status === 524 || response.status >= 500) throw new ProviderError('GFW could not return the report. Remote completion may be unknown; review before retrying.', 'recovery-needed');
  if (!response.ok) {
    let detail = '';
    if (response.status === 422) {
      try {
        const payload = await response.json();
        detail = (payload.messages || []).map(m => `${m.title || ''}: ${m.detail || ''}`).join('; ').replaceAll(token, '[redacted]').slice(0, 800);
      } catch { /* Keep a safe generic error if the error body is not JSON. */ }
    }
    throw new ProviderError(`GFW rejected the request (HTTP ${response.status}). ${detail || 'Review the selected parameters.'}`);
  }
  // Bound memory until streaming large-artifact storage is implemented.
  const chunks = []; let size = 0;
  try {
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 32 * 1024 * 1024) throw new ProviderError('Report exceeds this client’s current 32 MiB safety limit. Use a smaller region or period.');
      chunks.push(Buffer.from(chunk));
    }
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError('Report transfer was interrupted. No partial payload was marked complete.', 'recovery-needed');
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  const parsed = parseReport(raw, query, response.headers.get('x-datasets'));
  return archive(query, id, parsed.rows, {createdAt, raw, responseVersion: parsed.responseVersion, request, receivedAt:new Date().toISOString()});
}

export async function checkLastReport(query, token, {fetchImpl = fetch, signal,now=Date.now} = {}) {
  if (!token) throw new ProviderError('Reconnect your personal token before checking recovery.', 'needs-authentication',{failureKind:'authentication',retryable:false});
  let response;
  try {
    response = await fetchImpl(`${BASE}/4wings/last-report`, {redirect:'error', signal:signal || AbortSignal.timeout(20000), headers:{Authorization:`Bearer ${token}`,Accept:'application/json'}});
  } catch { throw new ProviderError(signal?.aborted?'Recovery check stopped or timed out. Original completion remains unresolved.':'Recovery check could not reach GFW. The original report remains unresolved.', 'recovery-needed',{failureKind:signal?.aborted?(signal.reason?.name==='TimeoutError'?'timeout':'interrupted'):'transport',retryable:!signal?.aborted||signal.reason?.name==='TimeoutError'}); }
  if (!response.ok) {const status=response.status,wait=retryAfter(response.headers,now());await response.body?.cancel();
    if(status===404)return {state:'unavailable',message:'GFW has no retained last report. It may have expired; this does not prove the original request never ran.'};
    throw new ProviderError(status===401?'GFW rejected the recovery token. Reconnect and check again.':`Recovery check returned HTTP ${status}. Original completion remains unresolved.`,status===401?'needs-authentication':'recovery-needed',{httpStatus:status,failureKind:status===401?'authentication':status===403?'permission':status===429?'rate-limited':status>=500?'upstream':'request',retryable:(status===429||status>=500)&&wait.status!=='unsupported',retryAfter:wait});
  }
  const chunks=[];let bytes=0;
  try {
    for await(const chunk of response.body){bytes+=chunk.length;if(bytes>32*1024*1024)throw new ProviderError('Recovery response exceeded 32 MiB. Original completion remains unresolved.','recovery-needed',{failureKind:'size-limit',retryable:false});chunks.push(Buffer.from(chunk));}
  } catch(error) {if(error instanceof ProviderError)throw error;throw new ProviderError('Recovery response was interrupted. Original completion remains unresolved.', 'recovery-needed',{failureKind:signal?.aborted?(signal.reason?.name==='TimeoutError'?'timeout':'interrupted'):'transport',retryable:!signal?.aborted||signal.reason?.name==='TimeoutError'}); }
  const raw=Buffer.concat(chunks).toString('utf8');
  if(token&&raw.includes(token))throw new ProviderError('Unexpected credential material in recovery response.','recovery-needed',{failureKind:'response-invalid',retryable:false});
  let data;
  try{data=JSON.parse(raw);if(token&&JSON.stringify(data).includes(token))throw Error('echo');}catch{throw new ProviderError('Recovery returned an unsupported format. No artifact was accepted.', 'recovery-needed',{failureKind:'response-invalid',retryable:false});}
  if(!data||typeof data!=='object'||Array.isArray(data))throw new ProviderError('Recovery returned an unsupported response shape.','recovery-needed',{failureKind:'response-invalid',retryable:false});
  if(data.status==='running') {
    // The URI does not prove the POST geometry; report only partial correlation.
    let parametersMatch=false;
    try {
      const expected=new URL(reportRequest(query).url),actual=new URL(data.uri,BASE);
      parametersMatch=actual.origin===expected.origin&&actual.pathname===expected.pathname && [...expected.searchParams].every(([k,v])=>actual.searchParams.get(k)===v) && [...actual.searchParams].every(([k,v])=>expected.searchParams.get(k)===v);
    } catch { /* Missing URI is not proof of ownership. */ }
    return {state:'running', parametersMatch,retryAfter:retryAfter(response.headers,now()), message:parametersMatch?'A report with matching URL parameters is still running. Its geometry is not verified.':'A report is still running, but its URL parameters do not establish a match to this job.'};
  }
  if(Number.isInteger(data.status)&&data.status>=400)return {state:'remote-error',message:`The account’s last report failed (HTTP ${data.status}). Ownership of that report is not established.`};
  let parsed;
  try { parsed=parseReport(raw,query,response.headers.get('x-datasets')); }
  catch { return {state:'mismatch',message:'The last report does not match this job’s dataset/schema. It was not attached.'}; }
  // Even a correct dataset cannot prove region, grouping or filters. Quarantine it.
  const dates=[...new Set(parsed.rows.map(r=>r.date))].sort();
  const outside=parsed.rows.some(r=>r.lat<query.bounds[1]-query.grid || r.lat>query.bounds[3]+query.grid || r.lon<query.bounds[0]-query.grid || r.lon>query.bounds[2]+query.grid || (query.interval==='DAILY'&&(r.date.slice(0,10)<query.start||r.date.slice(0,10)>=query.end)));
  if(outside)return {state:'mismatch',message:'The last report contains coordinates or dates outside the requested scope. It was not attached.'};
  return {state:'candidate',raw,responseVersion:parsed.responseVersion,summary:{rows:parsed.rows.length,firstDate:dates[0]||null,lastDate:dates.at(-1)||null,units:query.metric},message:'A possible result was found. GFW does not return enough metadata to prove its area, filters or ownership. Review it before accepting; another GFW session may have produced it.'};
}
