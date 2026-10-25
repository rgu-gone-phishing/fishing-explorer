// Exact-coordinate WGS84 polygon validation. Topology uses robust orientation
// predicates and a bounding-volume hierarchy; no coordinates are simplified.
import {orient2d} from './vendor/robust-predicates/orient2d.js';
export const GEOMETRY_LIMITS=Object.freeze({vertices:250000,polygons:2000,rings:4000,checks:10000000});
// Cache only successfully validated serialized coordinates. Mutable caller objects
// are never trusted by identity, and every return owns an independent copy.
const verified=new Map();let verifiedBytes=0;
function remember(serialized){if(serialized.length*2>16*1024*1024)return;verified.set(serialized,true);verifiedBytes+=serialized.length*2;while(verified.size>4||verifiedBytes>16*1024*1024){const first=verified.keys().next().value;verifiedBytes-=first.length*2;verified.delete(first);}}
const same=(a,b)=>a[0]===b[0]&&a[1]===b[1];
const orientation=(a,b,c)=>orient2d(a[0],a[1],b[0],b[1],c[0],c[1]);
const onSegment=(p,a,b)=>p[0]>=Math.min(a[0],b[0])&&p[0]<=Math.max(a[0],b[0])&&p[1]>=Math.min(a[1],b[1])&&p[1]<=Math.max(a[1],b[1])&&orientation(a,b,p)===0;
function intersects(a,b,c,d){
 const x=orientation(a,b,c),y=orientation(a,b,d),z=orientation(c,d,a),w=orientation(c,d,b);
 return ((x<0&&y>0)||(x>0&&y<0))&&((z<0&&w>0)||(z>0&&w<0))||onSegment(c,a,b)||onSegment(d,a,b)||onSegment(a,c,d)||onSegment(b,c,d);
}
export function inRing(point,ring){
 let inside=false;
 for(let i=1;i<ring.length;i++){
  const a=ring[i-1],b=ring[i];if(onSegment(point,a,b))return true;
  // Division-free ray crossing; orient2d uses the screen-axis sign convention.
  if((a[1]>point[1])!==(b[1]>point[1])){const side=orientation(a,b,point);if((b[1]>a[1]&&side<0)||(b[1]<a[1]&&side>0))inside=!inside;}
 }
 return inside;
}
export function containsPoint(point,geometry){const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;return polygons.some(p=>inRing(point,p[0])&&!p.slice(1).some(r=>inRing(point,r)));}
const overlap=(a,b)=>a.minX<=b.maxX&&a.maxX>=b.minX&&a.minY<=b.maxY&&a.maxY>=b.minY;
const boundsContain=(b,p)=>p[0]>=b.minX&&p[0]<=b.maxX&&p[1]>=b.minY&&p[1]<=b.maxY;
function box(items){const b={minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity};for(const item of items){b.minX=Math.min(b.minX,item.minX);b.minY=Math.min(b.minY,item.minY);b.maxX=Math.max(b.maxX,item.maxX);b.maxY=Math.max(b.maxY,item.maxY);}return b;}
function tree(items){
 const node=box(items);if(items.length<=12)return {...node,items};
 const x=node.maxX-node.minX>=node.maxY-node.minY;items.sort((a,b)=>x?(a.minX+a.maxX)-(b.minX+b.maxX):(a.minY+a.maxY)-(b.minY+b.maxY));const middle=items.length>>1;
 return {...node,left:tree(items.slice(0,middle)),right:tree(items.slice(middle))};
}
function checkTopology(segments){
 const root=tree(segments.slice());let checks=0,visits=0;
 for(const s of segments){const stack=[root];while(stack.length){
  const node=stack.pop();if(++visits>GEOMETRY_LIMITS.checks*8)throw Error('Geometry validation work limit exceeded. Split the study area explicitly; no geometry was changed.');if(!overlap(s,node))continue;
  if(!node.items){stack.push(node.left,node.right);continue;}
  for(const t of node.items){if(t.id<=s.id||!overlap(s,t))continue;if(++checks>GEOMETRY_LIMITS.checks)throw Error('Geometry validation work limit exceeded. Split the study area explicitly; no geometry was changed.');
   if(s.ring===t.ring&&(Math.abs(s.edge-t.edge)===1||Math.abs(s.edge-t.edge)===s.count-1)){
    const shared=same(s.a,t.a)||same(s.a,t.b)?s.a:s.b,otherS=same(s.a,shared)?s.b:s.a,otherT=same(t.a,shared)?t.b:t.a;
    if(onSegment(otherS,shared,otherT)||onSegment(otherT,shared,otherS))throw Error('Area has overlapping adjacent edges.');continue;
   }
   if(intersects(s.a,s.b,t.a,t.b))throw Error(s.ring===t.ring?'Area has intersecting or touching nonadjacent edges.':s.polygon===t.polygon?'Polygon rings cannot intersect or touch.':'MultiPolygon parts cannot overlap or touch.');
  }
 }}
 return (point,ring)=>{
  let inside=false;const ray={minX:point[0],maxX:180,minY:point[1],maxY:point[1]},stack=[root];
  while(stack.length){const node=stack.pop();if(++visits>GEOMETRY_LIMITS.checks*8)throw Error('Geometry validation work limit exceeded. Split the study area explicitly; no geometry was changed.');if(!overlap(ray,node))continue;
   if(!node.items){stack.push(node.left,node.right);continue;}
   for(const s of node.items){if(s.ring!==ring||!overlap(ray,s))continue;if(onSegment(point,s.a,s.b))return true;if((s.a[1]>point[1])!==(s.b[1]>point[1])){const side=orientation(s.a,s.b,point);if(s.b[1]>s.a[1]&&side<0||s.b[1]<s.a[1]&&side>0)inside=!inside;}}
  }return inside;
 };
}
export function normalizeGeometry(input){
 let g=input;
 if(g?.crs)throw Error('Use WGS84 GeoJSON without a custom CRS.');
 if(g?.type==='FeatureCollection'){if(g.features?.length!==1)throw Error('Use one GeoJSON feature containing a Polygon or MultiPolygon.');g=g.features[0];}
 if(g?.crs)throw Error('Use WGS84 GeoJSON without a custom CRS.');if(g?.type==='Feature')g=g.geometry;
 if(g?.crs)throw Error('Use WGS84 GeoJSON without a custom CRS.');
 if(!g||!['Polygon','MultiPolygon'].includes(g.type))throw Error('Area must be a GeoJSON Polygon or MultiPolygon.');
 const serialized=JSON.stringify({type:g.type,coordinates:g.coordinates});if(verified.has(serialized)){verified.delete(serialized);verified.set(serialized,true);return JSON.parse(serialized);}
 const polygons=g.type==='Polygon'?[g.coordinates]:g.coordinates;
 if(!Array.isArray(polygons)||!polygons.length||polygons.length>GEOMETRY_LIMITS.polygons)throw Error(`Use 1–${GEOMETRY_LIMITS.polygons.toLocaleString('en-US')} polygons.`);
 let count=0,ringId=0;const segments=[],ringBoxes=[];
 for(let polygonId=0;polygonId<polygons.length;polygonId++){
  const polygon=polygons[polygonId],boxes=[];if(!Array.isArray(polygon)||!polygon.length)throw Error('Polygon has no outer ring.');
  for(const ring of polygon){
   if(++ringId>GEOMETRY_LIMITS.rings)throw Error('Area exceeds the 4,000-ring limit.');if(!Array.isArray(ring)||ring.length<4)throw Error('Each ring needs at least three vertices and a closing point.');
   count+=ring.length;if(count>GEOMETRY_LIMITS.vertices)throw Error('Area exceeds the 250,000-vertex limit. Split the study area explicitly; no automatic simplification occurs.');
   for(const p of ring)if(!Array.isArray(p)||p.length!==2||p.some(n=>typeof n!=='number'||!Number.isFinite(n))||Math.abs(p[0])>180||Math.abs(p[1])>85)throw Error('Use two-dimensional WGS84 longitude/latitude, within ±180° longitude and ±85° latitude.');
   if(!same(ring[0],ring.at(-1)))throw Error('GeoJSON rings must be closed.');let noncollinear=false;const first=segments.length;
   for(let i=1;i<ring.length;i++){
    const a=ring[i-1],b=ring[i];if(same(a,b))throw Error('Remove repeated consecutive vertices.');if(Math.abs(a[0]-b[0])>180)throw Error('Antimeridian crossings are not supported yet.');
    if(i>1&&orientation(ring[0],ring[1],b)!==0)noncollinear=true;
    segments.push({id:segments.length,ring:ringId,polygon:polygonId,edge:i-1,count:ring.length-1,a,b,minX:Math.min(a[0],b[0]),maxX:Math.max(a[0],b[0]),minY:Math.min(a[1],b[1]),maxY:Math.max(a[1],b[1])});
   }
   if(!noncollinear)throw Error('Area must have nonzero size.');boxes.push({...box(segments.slice(first)),ringId});
  }ringBoxes.push(boxes);
 }
 const insideRing=checkTopology(segments),insidePolygon=(point,index)=>insideRing(point,ringBoxes[index][0].ringId)&&!ringBoxes[index].slice(1).some(b=>boundsContain(b,point)&&insideRing(point,b.ringId));
 for(let p=0;p<polygons.length;p++){
  const polygon=polygons[p],boxes=ringBoxes[p];
  for(let i=1;i<polygon.length;i++){
   if(!boundsContain(boxes[0],polygon[i][0])||!insideRing(polygon[i][0],boxes[0].ringId))throw Error('Each hole must lie strictly inside the outer ring.');
   for(let j=1;j<i;j++)if(boundsContain(boxes[j],polygon[i][0])&&insideRing(polygon[i][0],boxes[j].ringId)||boundsContain(boxes[i],polygon[j][0])&&insideRing(polygon[j][0],boxes[i].ringId))throw Error('Holes cannot overlap or contain one another.');
  }
  for(let j=0;j<p;j++)if(overlap(boxes[0],ringBoxes[j][0])&&(boundsContain(ringBoxes[j][0],polygon[0][0])&&insidePolygon(polygon[0][0],j)||boundsContain(boxes[0],polygons[j][0][0])&&insidePolygon(polygons[j][0][0],p)))throw Error('MultiPolygon parts cannot overlap or touch.');
 }
 remember(serialized);return JSON.parse(serialized);
}
export function boundsOf(geometry){
 const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;const b=[Infinity,Infinity,-Infinity,-Infinity];for(const polygon of polygons)for(const ring of polygon)for(const p of ring){b[0]=Math.min(b[0],p[0]);b[1]=Math.min(b[1],p[1]);b[2]=Math.max(b[2],p[0]);b[3]=Math.max(b[3],p[1]);}return b;
}
export function compilePointFilter(input){
 const geometry=normalizeGeometry(input),polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates,segments=[],rings=[];let id=0;
 for(const polygon of polygons){const ids=[];for(const ring of polygon){const ringId=id++;ids.push(ringId);for(let i=1;i<ring.length;i++){const a=ring[i-1],b=ring[i];segments.push({ring:ringId,a,b,minX:Math.min(a[0],b[0]),maxX:Math.max(a[0],b[0]),minY:Math.min(a[1],b[1]),maxY:Math.max(a[1],b[1])});}}rings.push(ids);}
 const root=tree(segments);
 return point=>{
  if(!boundsContain(root,point))return false;const ray={minX:point[0],maxX:180,minY:point[1],maxY:point[1]},inside=new Set(),boundary=new Set(),stack=[root];
  while(stack.length){const node=stack.pop();if(!overlap(ray,node))continue;if(!node.items){stack.push(node.left,node.right);continue;}
   for(const s of node.items){if(!overlap(ray,s))continue;if(onSegment(point,s.a,s.b)){boundary.add(s.ring);continue;}if((s.a[1]>point[1])!==(s.b[1]>point[1])){const side=orientation(s.a,s.b,point);if(s.b[1]>s.a[1]&&side<0||s.b[1]<s.a[1]&&side>0){if(inside.has(s.ring))inside.delete(s.ring);else inside.add(s.ring);}}}
  }
  for(const ring of boundary)inside.add(ring);return rings.some(ids=>inside.has(ids[0])&&!ids.slice(1).some(id=>inside.has(id)));
 };
}
export function aggregateCells(rows,field='hours'){const cells=new Map();for(const row of rows){const key=`${row.lon},${row.lat}`,c=cells.get(key)||{lat:row.lat,lon:row.lon,[field]:0};c[field]+=row[field];cells.set(key,c);}return [...cells.values()];}
