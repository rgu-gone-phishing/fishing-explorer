// Public v4/v5 identity filter enums checked against GFW metadata on 24 October 2026.
export const SEARCH_TYPES=["OTHER","DISCREPANCY","BUNKER","CARGO","FISHING","SUPPORT","SEISMIC_VESSEL","PASSENGER","CARRIER","GEAR"];
export const SEARCH_GEARS=["BUNKER","CARGO","CARGO_OR_TANKER","CARRIER","DREDGE_FISHING","DRIFTING_LONGLINES","FISHING","FIXED_GEAR","GEAR","INCONCLUSIVE","NON_FISHING","OTHER","OTHER_PURSE_SEINES","OTHER_SEINES","PASSENGER","PATROL_VESSEL","POLE_AND_LINE","POTS_AND_TRAPS","PURSE_SEINES","PURSE_SEINE_SUPPORT","SEINERS","SEISMIC_VESSEL","SET_GILLNETS","SET_LONGLINES","SPECIALIZED_REEFER","SQUID_JIGGER","TRAWLERS","TROLLERS","TUG","TUNA_PURSE_SEINES"];
export const REGISTRY_GEARS=["BUNKER","BUNKER_OR_TANKER","CARGO","CARGO_OR_REEFER","CARGO_OR_TANKER","CONTAINER_REEFER","DIVE_VESSEL","DREDGE_FISHING","DREDGE_NON_FISHING","DRIFTING_LONGLINES","DRIFTNETS","FISHING","FISH_FACTORY","FISH_TENDER","GEAR","NON_FISHING","OTHER_FISHING","OTHER_NOT_FISHING","OTHER_PURSE_SEINES","OTHER_SEINES","PASSENGER","PATROL_VESSEL","POLE_AND_LINE","POTS_AND_TRAPS","PURSE_SEINES","REEFER","RESEARCH","SEINERS","SEISMIC_VESSEL","SET_GILLNETS","SET_LONGLINES","SPECIALIZED_REEFER","SQUID_JIGGER","SUBMARINE","SUPPLY_VESSEL","TANKER","TRAWLERS","TROLLERS","TUG","TUNA_PURSE_SEINES","WELL_BOAT"];
export const SEARCH_INCLUDES=['AUTHORIZATIONS','MATCH_CRITERIA','OWNERSHIP'];
export const SEARCH_CAVEAT='Search predicates may match different historical records within one result. Identity-record dates are not an activity window or evidence of continuous transmissions. Provider match evidence, registry ownership/authorization records and combined classifications have different sources. Missing evidence is not a legal finding.';
export const splitSearchList=value=>value.split(/[,;]/).map(v=>v.trim()).filter(Boolean);
const date=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
function plain(value,label){if(typeof value!=='string'||value.length>100||value.trim().length<3||/[\\\x00-\x1f\x7f*%_?]/.test(value))throw Error(`${label}: use 3–100 plain characters without wildcards, backslashes or control characters.`);const out=value.trim().toUpperCase();literal(out);return out;}
function literal(value){if(!value.includes("'"))return `'${value}'`;if(!value.includes('"'))return `"${value}"`;throw Error('Text containing both quote styles is not supported by this structured query; use basic keyword search.');}
export function searchFilters(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['source','name','ids','mmsi','imo','callsign','flags','types','gears','gearSource','owner','before','after'].includes(k)))throw Error('Unsupported advanced search field.');
 const source=input.source??'any',gearSource=input.gearSource??'combined';if(!['any','ais','registry'].includes(source)||!['combined','registry'].includes(gearSource))throw Error('Choose a supported identity or gear evidence source.');const out={source,gearSource};
 for(const [key,pattern] of [['ids',/^[a-zA-Z0-9-]{6,100}$/],['mmsi',/^\d{1,15}$/],['imo',/^\d{1,10}$/],['callsign',/^[A-Z0-9._ /-]{1,30}$/],['flags',/^[A-Z]{3}$/],['types',null],['gears',null]]){
  const values=input[key]??[];if(!Array.isArray(values)||values.length>20||values.some(v=>typeof v!=='string'))throw Error(`Provide up to 20 ${key} values.`);const normalized=[...new Set(values.map(v=>key==='ids'?v.trim():v.trim().toUpperCase()))].sort();
  for(const v of normalized)if(!v||(pattern?!pattern.test(v):!(key==='types'?SEARCH_TYPES:gearSource==='registry'?REGISTRY_GEARS:SEARCH_GEARS).includes(v)))throw Error(`Unsupported ${key} value: ${v.slice(0,60)}.`);if(normalized.length)out[key]=normalized;
 }
 for(const key of ['name','owner'])if(input[key]!==undefined&&input[key]!=='')out[key]=plain(input[key],key==='name'?'Name':'Owner');
 for(const key of ['before','after'])if(input[key]!==undefined&&input[key]!==''){if(!date(input[key]))throw Error('Use valid UTC dates for identity-record bounds.');out[key]=input[key];}
 if(Object.keys(out).length===2)throw Error('Choose at least one identity field, class, owner or record-date condition.');return out;
}
export function searchIncludes(input=SEARCH_INCLUDES){if(!Array.isArray(input)||input.length>3||input.some(v=>!SEARCH_INCLUDES.includes(v)))throw Error('Choose supported search evidence fields.');return [...new Set(input)].sort();}
export function advancedWhere(input){
 const f=searchFilters(input),prefix=f.source==='ais'?'selfReportedInfo.':f.source==='registry'?'registryInfo.':'',clauses=[];
 const add=(field,values,op='=')=>{if(!values?.length)return;const alternatives=values.map(v=>`${field} ${op} ${literal(v)}`);clauses.push(alternatives.length>1?'('+alternatives.join(' OR ')+')':alternatives[0]);};
 add('selfReportedInfo.id',f.ids);add(prefix+'shipname',f.name?['*'+f.name+'*']:null,'LIKE');add(prefix+'ssvid',f.mmsi);add(prefix+'imo',f.imo);add(prefix+'callsign',f.callsign);add(prefix+'flag',f.flags);add('combinedSourcesInfo.shiptypes.name',f.types);add(f.gearSource==='registry'?'registryInfo.geartypes':'combinedSourcesInfo.geartypes.name',f.gears);add('registryOwners.name',f.owner?['*'+f.owner+'*']:null,'LIKE');add(prefix+'transmissionDateFrom',f.before?[f.before]:null,'<');add(prefix+'transmissionDateTo',f.after?[f.after]:null,'>');return clauses.join(' AND ');
}
export function searchLabel(query){if(query.mode!=='advanced')return `Keyword: ${query.term}`;const f=query.filters,parts=[];for(const [key,label] of [['name','name'],['ids','AIS IDs'],['mmsi','MMSI/SSVID'],['imo','IMO'],['callsign','callsign'],['flags','flag'],['types','type'],['gears','gear'],['owner','owner'],['before','record start before'],['after','record end after']])if(f[key])parts.push(`${label}: ${Array.isArray(f[key])?f[key].join(', '):f[key]}`);return `Advanced (${f.source} identity evidence): ${parts.join(' · ')}`;}
export function searchEvidenceRecords(value){
 if(value===undefined||value===null)return {state:'unavailable',records:[],unsupported:0};
 if(!Array.isArray(value))return {state:'unsupported',records:[],unsupported:1};
 const records=value.filter(r=>r&&typeof r==='object'&&!Array.isArray(r));return {state:'returned',records,unsupported:value.length-records.length};
}
