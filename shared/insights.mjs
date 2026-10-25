export const INSIGHT_TYPES={
 COVERAGE:{label:'AIS voyage coverage',caveat:'Coverage describes AIS reception during detected voyages, excluding ports. It is not a fishing-confidence score.'},
 FISHING:{label:'Apparent fishing indicators',caveat:'Modeled events and uncertain boundaries require review. Missing public RFMO authorization does not establish unauthorized fishing.'},
 GAP:{label:'AIS-off indicators',caveat:'These are model inferences, not proof of deliberate disabling.'},
 'VESSEL-IDENTITY-IUU-VESSEL-LIST':{label:'Reported RFMO IUU-list evidence',caveat:'List evidence has collection gaps. Zero reported listings does not establish compliance.'},
 'VESSEL-IDENTITY-FLAG-CHANGES':{label:'Flag-history indicator',restricted:true,caveat:'Flag-history records alone are not evidence of unlawful activity.'},
 'VESSEL-IDENTITY-MOU-LIST':{label:'Flag-state MOU-list evidence',restricted:true,caveat:'Flag-state list evidence is not a vessel IUU listing.'},
};
export const DEFAULT_INSIGHTS=Object.keys(INSIGHT_TYPES).filter(k=>!INSIGHT_TYPES[k].restricted);
export const INSIGHT_CAVEAT='Provider-supplied indicators are separate evidence, not a local risk score or a legal finding. Missing fields remain unavailable. The requested identity version does not pin every derived dataset. Exact date-end inclusion is not verified for this endpoint.';
export function validateInsightResponse(data,query){
 if(!data||typeof data!=='object'||Array.isArray(data)||!['period','coverage','gap','gaps','apparentFishing','vesselIdentity','vesselIdsWithoutIdentity'].some(k=>Object.hasOwn(data,k)))throw Error('Unsupported insights response schema.');
 for(const [field,expected] of [['startDate',query.start],['endDate',query.end]]){const actual=data.period?.[field];if(actual!==undefined&&(typeof actual!=='string'||!Number.isFinite(Date.parse(actual))||actual.slice(0,10)!==expected))throw Error('Returned insight period differs from the requested period.');}
 for(const section of [data,data.coverage,data.gap,data.gaps,data.apparentFishing,data.vesselIdentity])if(section?.vesselId!==undefined&&section.vesselId!==query.vesselId)throw Error('Returned insights identify a different vessel.');
 return data;
}
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
function metric(label,raw,unit='count'){
 if(raw===undefined||raw===null||raw===''||['NA','N/A'].includes(raw))return {label,value:null,unit,reason:'Not supplied / not available'};
 const numeric=typeof raw==='number'?raw:typeof raw==='string'&&/^\d+(?:\.\d+)?$/.test(raw)?Number(raw):NaN;
 if(!Number.isFinite(numeric)||numeric<0||(unit==='%'?numeric>100:!Number.isSafeInteger(numeric)))return {label,value:null,unit,reason:'Unsupported source value; inspect the raw response'};
 return {label,value:numeric,unit,reason:null};
}
export function summarizeInsights(data,query){
 const sections=[],warnings=[],identity=data.vesselIdentity||{},missingIds=data.vesselIdsWithoutIdentity;
 const unmatched=Array.isArray(missingIds)&&missingIds.includes(query.vesselId);
 if(missingIds!==undefined&&missingIds!==null&&!Array.isArray(missingIds))warnings.push('Provider identity-match status has an unrecognized shape; inspect the raw response.');
 if(!data.period?.startDate||!data.period?.endDate)warnings.push('The provider did not echo both period bounds.');
 for(const type of query.includes){
  const config=INSIGHT_TYPES[type],section={type,label:config.label,caveat:config.caveat,status:'not-returned',metrics:[],datasets:[],references:[],history:[],warnings:[]};let source;
  if(type==='COVERAGE')source=data.coverage;
  else if(type==='FISHING')source=data.apparentFishing;
  else if(type==='GAP')source=data.gap??data.gaps;
  else source=identity[({'VESSEL-IDENTITY-IUU-VESSEL-LIST':'iuuVesselList','VESSEL-IDENTITY-FLAG-CHANGES':'flagsChanges','VESSEL-IDENTITY-MOU-LIST':'mouList'})[type]];
  if(unmatched){section.status='identity-unmatched';sections.push(section);continue;}
  if(!object(source)){if(source!==null&&source!==undefined)section.status='unsupported';sections.push(section);continue;}section.status='returned';
  const datasets=type.startsWith('VESSEL-IDENTITY')?identity.datasets:source.datasets;section.datasets=Array.isArray(datasets)?datasets.filter(d=>typeof d==='string'):[];
  if(type==='COVERAGE'){
   section.metrics=[metric('Provider coverage',source.percentage,'%'),metric('Voyage hour blocks',source.blocks),metric('Blocks with positions',source.blocksWithPositions)];
   const [percentage,blocks,positions]=section.metrics.map(m=>m.value);if(blocks!==null&&positions!==null&&(positions>blocks||blocks>0&&percentage!==null&&Math.abs(positions/blocks*100-percentage)>0.1))section.warnings.push('Reported coverage and block counts disagree; no local correction was applied.');
  }else if(type==='FISHING'||type==='GAP'){
   const counts=source.periodSelectedCounters||{};
   section.metrics=type==='FISHING'?[metric('Apparent fishing events',counts.events),metric('Events in no-take MPAs',counts.eventsInNoTakeMPAs),metric('Events without known RFMO authorization',counts.eventsInRFMOWithoutKnownAuthorization)]:[metric('Gap events',counts.events),metric('AIS-off events',counts.eventsGapOff)];
   const lists=type==='FISHING'?[['eventsInNoTakeMpas','No-take MPA','fishing'],['eventsInRfmoWithoutKnownAuthorization','No known RFMO authorization','fishing']]:[['aisOff','AIS-off','gaps']];
   for(const [field,label,eventType] of lists){if(!Array.isArray(source[field])){section.warnings.push(`${label} event references were not supplied as a list.`);continue;}for(const id of source[field])if(typeof id==='string')section.references.push({id,label,eventType});else section.warnings.push('An event reference has an unsupported shape.');}
  }else{
   const groups=type==='VESSEL-IDENTITY-MOU-LIST'?Object.entries(source):[['Reported list',source]];
   for(const [group,value] of groups){if(!object(value))continue;section.metrics.push(metric(`${group}: reported count in selected period`,value.totalTimesListedInThePeriod),metric(`${group}: historical reported count`,value.totalTimesListed));if(Array.isArray(value.valuesInThePeriod))section.history.push(...value.valuesInThePeriod.map(row=>({group,record:row})));else section.warnings.push(`${group}: detailed period records were not supplied.`);}
  }
  if(!section.metrics.length||section.metrics.some(m=>m.value===null))section.status='incomplete-fields';sections.push(section);
 }
 return {sections,warnings,reportedPeriod:data.period||null,unmatched};
}
