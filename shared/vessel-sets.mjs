export const vesselKey=m=>`${m.version}:${m.vesselId}`;
const uuid=s=>typeof s==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(s);
const text=(s,max,required=false)=>{if(typeof s!=='string'||s.length>max||required&&!s.trim())throw Error('Missing or oversized vessel-set text.');return s.trim();};
export function vesselMember(input){
 if(!input||typeof input.vesselId!=='string'||!/^[a-zA-Z0-9-]{6,100}$/.test(input.vesselId)||!['v4.0','v5.0'].includes(input.version))throw Error('Use a GFW AIS identity ID and explicit v4.0/v5.0 identity version.');
 const b=input.basis;let basis;if(b?.kind==='lookup'&&uuid(b.snapshotId)&&/^[a-f0-9]{64}$/.test(b.sha256))basis={kind:'lookup',snapshotId:b.snapshotId,sha256:b.sha256};else if(b?.kind==='manual')basis={kind:'manual',citation:text(b.citation,2000,true)};else throw Error('Member needs a saved-lookup reference or explicit manual citation.');
 return {vesselId:input.vesselId,version:input.version,label:text(input.label||input.vesselId,200,true),annotation:text(input.annotation||'',4000),basis};
}
export function vesselSetContent(input){
 if(!Array.isArray(input?.members)||input.members.length>500)throw Error('A vessel set supports up to 500 identities.');
 const members=input.members.map(vesselMember),keys=new Set();for(const m of members){const key=vesselKey(m);if(keys.has(key))throw Error('Duplicate identity/version in vessel set. Different versions remain separate.');keys.add(key);}
 return {title:text(input.title,120,true),notes:text(input.notes||'',10000),members};
}
export const VESSEL_SET_CAVEAT='A local research selection and user annotations, not an authoritative fleet or a physical-vessel identity mapping. Identity IDs and versions stay separate. Membership does not imply fishing activity, compliance or permission to redistribute source data.';
