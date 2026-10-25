export const EVENT_TYPES={
 fishing:{label:'Apparent fishing',dataset:'public-global-fishing-events',caveat:'Inferred fishing events are a different product from gridded apparent fishing hours; their totals need not agree.'},
 encounters:{label:'Encounters',dataset:'public-global-encounters-events',caveat:'Proximity events are not proof of a transfer or unlawful activity.'},
 loitering:{label:'Loitering',dataset:'public-global-loitering-events',caveat:'Inferred loitering describes movement patterns; it does not establish purpose.'},
 port_visits:{label:'Port visits',dataset:'public-global-port-visits-events',caveat:'Confidence levels 2/3/4 describe event evidence, not probabilities or percentages.'},
 gaps:{label:'AIS gaps',dataset:'public-global-gaps-events',caveat:'This product is marked prototype by GFW. Gaps do not establish intentional disabling or illegality.'},
};
export const list=value=>Array.isArray(value)?value:value&&typeof value==='object'?[value]:[];
export function identities(vessel){return [...list(vessel.selfReportedInfo).map(r=>({...r,recordSource:'AIS self-reported'})),...list(vessel.registryInfo).map(r=>({...r,recordSource:'Registry'}))];}
export function vesselLabel(vessel){const records=identities(vessel);const latest=records.find(r=>r.latestVesselInfo)||records[0]||{};return {name:latest.shipname||latest.nShipname||'Unnamed vessel',flag:latest.flag||'Unspecified',mmsi:latest.ssvid||'Not supplied',imo:latest.imo||'Not supplied',ids:[...new Set(list(vessel.selfReportedInfo).map(r=>r?.id).filter(id=>typeof id==='string'&&/^[a-zA-Z0-9-]{6,100}$/.test(id)))]};}
export function eventPosition(event){const p=event.position;if(!p||p.lat===null||p.lon===null||p.lat===''||p.lon==='')return null;if(!['number','string'].includes(typeof p.lat)||!['number','string'].includes(typeof p.lon))return null;const numeric=v=>typeof v==='number'?v:/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(v.trim())?Number(v):NaN;const lat=numeric(p.lat),lon=numeric(p.lon);return Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=85&&Math.abs(lon)<=180?[lat,lon]:null;}
export const confidenceLabel=event=>event.type==='port_visit'&&['2','3','4'].includes(String(event.port_visit?.confidence))?`${event.port_visit.confidence} · ${({2:'Low',3:'Medium',4:'High'})[event.port_visit.confidence]} (event evidence)`:'Not supplied / not applicable';
