export const REGIONS={
 eez:{label:'Exclusive economic zones',dataset:'public-eez-areas',citation:'https://www.marineregions.org/'},
 mpa:{label:'Marine protected areas',dataset:'public-mpa-all',citation:'https://www.protectedplanet.net/'},
 rfmo:{label:'Regional fisheries bodies',dataset:'public-rfmo',citation:'https://globalfishingwatch.org/our-apis/documentation/docs/v3/datasets/regions'},
};
export const SIMPLIFICATIONS=[0,0.001,0.01,0.1];
export function regionIdentity(kind,id){
 if(!Object.hasOwn(REGIONS,kind))throw Error('Choose a supported region catalogue.');
 if(!['string','number'].includes(typeof id)||!/^[A-Za-z0-9_-]{1,80}$/.test(String(id)))throw Error('Invalid region identifier.');
 return {kind,id:String(id),dataset:REGIONS[kind].dataset};
}
export function boundarySource(input){
 if(!input||input.type!=='gfw-region')throw Error('Invalid named-boundary provenance.');
 const identity=regionIdentity(input.kind,input.id);
 if(input.dataset!==identity.dataset||!SIMPLIFICATIONS.includes(input.simplify)||!/^\d{4}-\d{2}-\d{2}T/.test(input.retrievedAt)||!Number.isFinite(Date.parse(input.retrievedAt)))throw Error('Invalid named-boundary metadata.');
 if(typeof input.label!=='string'||!input.label.trim()||input.label.length>1000||!['string','object'].includes(typeof input.version)||(input.version!==null&&(typeof input.version!=='string'||input.version.length>100)))throw Error('Invalid named-boundary label/version.');
 for(const field of ['geometrySha256','originalSha256','selectedSha256'])if(!/^[a-f0-9]{64}$/.test(input[field]||''))throw Error('Invalid named-boundary checksum.');
 return {type:'gfw-region',...identity,label:input.label,version:input.version,retrievedAt:input.retrievedAt,simplify:input.simplify,geometrySha256:input.geometrySha256,originalSha256:input.originalSha256,selectedSha256:input.selectedSha256,citation:REGIONS[input.kind].citation};
}
