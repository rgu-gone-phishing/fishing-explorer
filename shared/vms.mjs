export const VMS_REVIEW_DATE='2026-10-23';
export const VMS_SOURCES={
 availability:{label:'GFW data availability',url:'https://globalfishingwatch.org/global-fishing-watch-data-availability/'},
 ownership:{label:'GFW raw VMS FAQ',url:'https://globalfishingwatch.org/faqs/can-i-download-raw-vms-data/'},
 guide:{label:'GFW map user guide',url:'https://globalfishingwatch.org/user-guide/'},
 publication:{label:'GFW transparency timeline',url:'https://globalfishingwatch.org/transparency/'},
 map:{label:'Open GFW map',url:'https://globalfishingwatch.org/platform/map/fishing-activity/default-public'},
};
export const VMS_COUNTRIES=[
 ['BLZ','Belize','published','2022-03'],['BRA','Brazil','published','2021-11'],['CHL','Chile','published','2020-03'],['CRI','Costa Rica','published','2022-01'],['ECU','Ecuador','published','2021-10'],['IDN','Indonesia','published','2017-06'],['NOR','Norway','published','2023-03'],['PAN','Panama','published','2019-10'],['PNG','Papua New Guinea','published','2023-06'],['PER','Peru','published','2018-10'],['BEN','Benin','commitment','2022-05'],['MHL','Marshall Islands','commitment','2022-04'],['PLW','Palau','commitment','2023-09'],
].map(([id,name,evidence,announced])=>({id,name,evidence,announced,reviewedAt:VMS_REVIEW_DATE,source:VMS_SOURCES.publication.url,coverage:'Country/product dates and fleet scope require verification',grain:'Not established',download:'Country-specific eligibility unverified',publicAPI:'No public VMS API advertised',importAdapter:'Not verified',reuse:'Unknown; obtain product-specific permission evidence'}));
export const VMS_ACTIONS={view:'View',query:'Automated query',download:'Download',retain:'Retain locally',transform:'Transform / analyse',redistribute:'Share / redistribute'};
const text=(v,max,required=false)=>{if(typeof v!=='string'||v.length>max||(required&&!v.trim()))throw Error('Missing or oversized evidence field.');return v.trim();};
const date=v=>{if(v===null||v===undefined||v==='')return null;if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)throw Error('Use valid ISO dates for evidence and coverage.');return v;};
export function validateVmsEvidence(input){
 if(!input||!VMS_COUNTRIES.some(c=>c.id===input.country)&&input.country!=='OTHER')throw Error('Choose a country or an explicitly unlisted territory.');
 const countryName=input.country==='OTHER'?text(input.countryName,100,true):VMS_COUNTRIES.find(c=>c.id===input.country).name;
 const product=text(input.product,200,true),provider=text(input.provider,200,true),scope=text(input.scope||'',2000),version=text(input.version||'',200),units=text(input.units||'',200),spatialGrain=text(input.spatialGrain||'',500),temporalGrain=text(input.temporalGrain||'',500),basis=text(input.basis||'',5000),sourceUrl=text(input.sourceUrl||'',2000),reviewer=text(input.reviewer||'',200),notes=text(input.notes||'',5000);
 if(sourceUrl){let url;try{url=new URL(sourceUrl);}catch{throw Error('Evidence link must be a complete HTTP(S) URL.');}if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('Use an HTTP(S) evidence link without embedded credentials.');}
 const permissions=Object.fromEntries(Object.keys(VMS_ACTIONS).map(action=>{const value=input.permissions?.[action]||'unknown';if(!['unknown','allowed','denied'].includes(value))throw Error('Permission status must be unknown, allowed or denied.');return [action,value];}));
 const checkedAt=date(input.checkedAt),start=date(input.start),end=date(input.end);if(start&&end&&end<start)throw Error('Coverage end precedes start.');
 if(checkedAt&&checkedAt>new Date().toISOString().slice(0,10))throw Error('Evidence checked date cannot be in the future.');
 if(Object.values(permissions).some(p=>p!=='unknown')&&(!basis||!checkedAt))throw Error('A permission claim needs its evidence basis and checked date. Unknown is available when evidence is missing.');
 const route=input.route||'unknown';if(!['unknown','gfw-map','authority-file','research-share','partner-process'].includes(route))throw Error('Unsupported VMS access route.');
 return {country:input.country,countryName,product,provider,scope,version,units,spatialGrain,temporalGrain,start,end,route,permissions,basis,sourceUrl,checkedAt,reviewer,notes};
}
export function vmsReadiness(revision){
 const e=revision.evidence,missing=[],restricted=[];
 for(const action of ['download','retain','transform']){if(e.permissions[action]==='unknown')missing.push(`${VMS_ACTIONS[action]} permission evidence`);if(e.permissions[action]==='denied')restricted.push(VMS_ACTIONS[action]);}
 for(const [key,label] of [['units','Units'],['spatialGrain','Spatial grain'],['temporalGrain','Temporal grain'],['scope','Fleet/geographic scope']])if(!e[key])missing.push(label);
 if(!revision.sample)missing.push('Representative CSV schema sample');
 return {status:restricted.length?'recorded-restriction':missing.length?'evidence-incomplete':'candidate-for-review',missing,restricted,adapterSupported:false,explanation:'Evidence is user-supplied. A schema inspection is not authorization or a validated VMS analytical adapter.'};
}
