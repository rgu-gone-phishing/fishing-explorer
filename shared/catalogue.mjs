// Explicit supported contracts; new products require adapter/fixture verification.
export const SOURCES = {
 'synthetic-activity': {label:'Synthetic activity',metric:'synthetic apparent fishing hours',field:'hours',groupings:['GEARTYPE'],start:'2012-01-01',description:'Illustrative values only. Not suitable for research.',processing:'synthetic'},
 'gfw-fishing': {label:'AIS apparent fishing activity',metric:'apparent fishing hours',field:'hours',dataset:'public-global-fishing-effort',groupings:['GEARTYPE','FLAG','VESSEL_ID'],start:'2012-01-01',description:'Modeled apparent fishing activity. Coverage and reception vary; this is not catch or confirmed fishing.',processing:'upstream modeled and aggregated activity'},
 'gfw-presence': {label:'AIS vessel presence',metric:'vessel presence hours',field:'hours',dataset:'public-global-presence',groupings:['FLAG','VESSEL_ID'],start:'2012-01-01',description:'Presence of AIS-equipped vessels, without fishing classification. Hours come from sampled AIS positions, not a continuous vessel track or a complete fleet census.',processing:'upstream sampled and aggregated AIS presence'},
 'gfw-sar': {label:'SAR vessel detections',metric:'SAR vessel detections',field:'detections',dataset:'public-global-sar-presence',groupings:['NONE'],start:'2017-01-01',description:'Satellite imagery detections, not fishing hours or unique vessels. Coverage depends on imagery acquisition; unmatched detections are not evidence of illegality.',processing:'upstream imagery detection, classification and aggregation'},
};
export const metricField=source=>SOURCES[source]?.field||'hours';
export const measure=row=>Object.hasOwn(row,'detections')?row.detections:row.hours;
export function rowGroup(row,query){
 if(query.grouping==='NONE')return 'All detections';
 if(query.grouping==='FLAG')return row.flag||'Unspecified';
 if(query.grouping==='VESSEL_ID')return row.vesselId||'Unspecified';
 if(query.grouping==='VESSEL_TYPE')return row.vesselType||'Unspecified';
 return row.geartype||'Unspecified';
}
export const GROUP_LABELS={GEARTYPE:'Gear type',FLAG:'Flag',VESSEL_ID:'Vessel ID',VESSEL_TYPE:'Vessel type',NONE:'No identity grouping'};

export const portDistanceSuffix=query=>query.source==='gfw-fishing'?` · port minimum ${query.distanceFromPortKm===undefined?'not requested':'≥ '+query.distanceFromPortKm+' km'}`:'';
