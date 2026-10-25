import {displayMeasure} from '/shared/saved-analysis.mjs';
import {metricField,rowGroup} from '/shared/catalogue.mjs';
import { normalizeGeometry, boundsOf, aggregateCells } from '/shared/geometry.mjs';
const L=window.L;
let worldPromise;
function world(){return worldPromise ||= fetch('/data/countries.geojson').then(r=>{if(!r.ok)throw Error('Offline basemap could not be loaded.');return r.json();});}
const dataCredit='Powered by <a href="https://globalfishingwatch.org" target="_blank" rel="noreferrer">Global Fishing Watch</a>';
const credit=(map,source)=>{map.attributionControl.removeAttribution(dataCredit);if(source!=='synthetic-activity')map.attributionControl.addAttribution(dataCredit);};
const textNode=text=>{const p=document.createElement('div');p.textContent=text;return p;};
let referenceLayers=[];const referenceMaps=[];
let infrastructureOverlay=null;
const infrastructureCredit='Infrastructure: <a href="https://globalfishingwatch.org" target="_blank" rel="noreferrer">Global Fishing Watch</a>';
function refreshInfrastructure(entry){
 const data=infrastructureOverlay;if(!data){entry.infrastructureGroup?.clearLayers();if(entry.infrastructureLegend)entry.infrastructureLegend.hidden=true;entry.map.attributionControl.removeAttribution(infrastructureCredit);return;}
 if(!entry.infrastructureGroup){entry.infrastructureGroup=L.layerGroup().addTo(entry.map);entry.infrastructureLegend=document.createElement('div');entry.infrastructureLegend.className='reference-legend';const control=L.control({position:'topright'});control.onAdd=()=>entry.infrastructureLegend;control.addTo(entry.map);L.DomEvent.disableClickPropagation(entry.infrastructureLegend);}
 entry.infrastructureGroup.clearLayers();entry.infrastructureLegend.hidden=false;entry.infrastructureLegend.replaceChildren();entry.map.attributionControl.addAttribution(infrastructureCredit);
 const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent=`Infrastructure · ${data.total} records${data.complete?'':' · PARTIAL'}`;details.append(summary);
 for(const text of [`${data.query.dataset} · ${data.options.start} → ${data.options.end}`,`Label: ${data.options.label}; confidence: ${data.options.confidence}`,data.mapOmitted?'Map omitted above 20,000 records; narrow the display.':'Oil: orange · wind: blue · unknown: grey · other: purple','Context retains its own dates; other map date filters do not change it.']){const p=document.createElement('p');p.textContent=text;details.append(p);}entry.infrastructureLegend.append(details);
 for(const feature of data.features){const r=feature.properties,color=({oil:'#b96b24',wind:'#2876ad',unknown:'#66747d'})[r.label]||'#7855a4';const marker=L.circleMarker([r.lat,r.lon],{pane:'infrastructure',radius:5,color,weight:1,fillOpacity:0.75});
  const popup=document.createElement('div');for(const text of [`GFW predicted ${r.label} · structure ${r.id}`,`Label confidence: ${r.confidence} (category, not probability)`,`First detected: ${r.first===null?'not supplied':new Date(r.first).toISOString().slice(0,10)}`,`Last detected: ${r.last===null?'not supplied':new Date(r.last).toISOString().slice(0,10)}`,r.variant?'Multiple source records for this ID are retained.':'Filtered map product; not an operating-status record.',`Snapshot ${data.id} · ${data.complete?'all planned tiles retrieved':'partial tile retrieval'}`]){const p=document.createElement('p');p.textContent=text;popup.append(p);}marker.bindPopup(popup);entry.infrastructureGroup.addLayer(marker);
 }
}
export function setInfrastructureOverlay(data){infrastructureOverlay=data;for(const entry of referenceMaps)refreshInfrastructure(entry);}
function refreshReferences(entry){
 entry.group.clearLayers();entry.legend.replaceChildren();if(!referenceLayers.length){entry.legend.hidden=true;return;}entry.legend.hidden=false;
 const details=document.createElement('details');const summary=document.createElement('summary');summary.textContent=`Reference layers (${referenceLayers.length})`;details.append(summary);
 for(const layer of referenceLayers){
  const color=({'oil-gas':'#b16a25',mining:'#7a55a3',environment:'#59772e',reference:'#286eaa'})[layer.metadata.sector];const label=document.createElement('p');const swatch=document.createElement('span');swatch.className='reference-swatch';swatch.style.background=color;label.append(swatch,document.createTextNode(`${layer.metadata.title} · ${layer.metadata.sector} · ${layer.metadata.status}`));details.append(label);
  L.geoJSON(layer.geojson,{pane:'references',style:{color,weight:2,fillColor:color,fillOpacity:0.12},pointToLayer:(_,p)=>L.circleMarker(p,{pane:'references',color,radius:5,fillOpacity:0.6}),onEachFeature:(feature,shape)=>{
   const popup=document.createElement('div');const title=document.createElement('strong');title.textContent=layer.metadata.title;popup.append(title);
   for(const value of [`User-supplied reference · ${layer.metadata.sector} · ${layer.metadata.status}`,`Provider: ${layer.metadata.provider}`,`Validity: ${layer.metadata.validFrom||'unknown'} → ${layer.metadata.validTo||'unknown'}`,`Citation: ${layer.metadata.citation}`,`Use basis: ${layer.metadata.license}`,`Redistribution: ${layer.metadata.redistribution}`]){const p=document.createElement('p');p.textContent=value;popup.append(p);}
   for(const [key,value] of Object.entries(feature.properties||{}).slice(0,12)){const p=document.createElement('p');p.textContent=`${key}: ${typeof value==='object'?'Structured value retained in original file':String(value).slice(0,300)}`;popup.append(p);}shape.bindPopup(popup);
  }}).addTo(entry.group);
 }
 const note=document.createElement('p');note.textContent='Reference validity is not automatically time-filtered. Overlap does not establish activity or impact.';note.className='hint';details.append(note);entry.legend.append(details);
}
export function setReferenceLayers(layers){referenceLayers=layers;for(const entry of referenceMaps)refreshReferences(entry);}
function createMap(id){
 const map=L.map(id,{preferCanvas:false,minZoom:1,maxZoom:14,worldCopyJump:false,maxBounds:[[-85,-180],[85,180]],maxBoundsViscosity:1}).setView([30,0],2);
 for(const [name,z] of [['basemap',250],['live-preview',300],['infrastructure',365],['references',375]])map.createPane(name).style.zIndex=z;
 L.control.scale({imperial:false}).addTo(map);
 const group=L.layerGroup().addTo(map),legend=document.createElement('div');legend.className='reference-legend';const control=L.control({position:'topright'});control.onAdd=()=>legend;control.addTo(map);L.DomEvent.disableClickPropagation(legend);const entry={map,group,legend};referenceMaps.push(entry);refreshReferences(entry);
 map.attributionControl.addAttribution('<a href="https://www.naturalearthdata.com/" target="_blank" rel="noreferrer">Natural Earth</a> · generalized offline context');
 world().then(data=>L.geoJSON(data,{pane:'basemap',interactive:false,style:{color:'#a7bbc1',weight:0.7,fillColor:'#e5ece8',fillOpacity:1}}).addTo(map).bringToBack()).catch(e=>{document.getElementById(id+'-message').textContent=e.message;});
 refreshInfrastructure(entry);new ResizeObserver(()=>map.invalidateSize()).observe(document.getElementById(id));
 return map;
}
export function createAreaEditor({onChange,onError,onViewChange=()=>{}}){
 const map=createMap('area-map');const area=L.geoJSON(null,{interactive:false,style:{color:'#007b74',weight:2,fillOpacity:0.12}}).addTo(map);
 map.on('moveend',onViewChange);
 let drawing=false,points=[],draft=null,previewLayer=null,renderedGeometry=null;
 const previewWatchers=[];map.on('zoomend',()=>previewWatchers.forEach(fn=>fn()));
 const message=document.getElementById('area-map-message');
 function updateDraft(){if(draft)map.removeLayer(draft);draft=L.polyline(points,{color:'#a85c16',weight:3}).addTo(map);message.textContent=`${points.length} vertices selected. Finish with at least three vertices.`;}
 function stop(){drawing=false;points=[];if(draft)map.removeLayer(draft);draft=null;document.getElementById('draw-area').setAttribute('aria-pressed','false');}
 map.on('click',e=>{if(!drawing)return;points.push([Number(e.latlng.lat.toFixed(6)),Number(e.latlng.lng.toFixed(6))]);updateDraft();});
 document.getElementById('draw-area').addEventListener('click',()=>{stop();drawing=true;document.getElementById('draw-area').setAttribute('aria-pressed','true');message.textContent='Click polygon vertices on the map, then Finish polygon. Coordinate entry and GeoJSON import are also available.';});
 document.getElementById('undo-vertex').addEventListener('click',()=>{if(drawing){points.pop();updateDraft();}});
 document.getElementById('cancel-draw').addEventListener('click',()=>{stop();message.textContent='Drawing cancelled. Existing analysis area unchanged.';});
 document.getElementById('finish-area').addEventListener('click',()=>{
  try{if(points.length<3)throw Error('Select at least three vertices.');const ring=points.map(([lat,lon])=>[lon,lat]);ring.push([...ring[0]]);const g=normalizeGeometry({type:'Polygon',coordinates:[ring]});onChange(g);stop();message.textContent='Polygon applied to the draft query. Saved extracts are unchanged.';}catch(e){onError(e.message);}
 });
 document.getElementById('use-viewport').addEventListener('click',()=>{
  const b=map.getBounds();const w=Math.max(-180,b.getWest()),s=Math.max(-85,b.getSouth()),e=Math.min(180,b.getEast()),n=Math.min(85,b.getNorth());
  onChange(null,[w,s,e,n].map(v=>Number(v.toFixed(6))));message.textContent='Visible bounds applied to the draft query.';
 });
 world().then(data=>{
  const list=document.getElementById('country-names');
  for(const f of data.features.slice().sort((a,b)=>a.properties.name.localeCompare(b.properties.name))){const option=document.createElement('option');option.value=f.properties.name;list.append(option);}
  document.getElementById('find-country').addEventListener('click',()=>{
   const name=document.getElementById('country-search').value.toLowerCase();const f=data.features.find(f=>f.properties.name.toLowerCase()===name);
   if(!f)return onError('Choose a country name from the list.');
   map.fitBounds(L.geoJSON(f).getBounds());message.textContent='Country used for map navigation only. Select an analysis area separately.';
  });
 }).catch(()=>{});
 return {
  setGeometry(g,fit=false){if(g!==renderedGeometry){area.clearLayers();area.addData(g);renderedGeometry=g;}if(fit){const [w,s,e,n]=boundsOf(g);map.fitBounds([[s,w],[n,e]],{padding:[25,25]});}},
  setPreview(record,options={},onChange=()=>{}){
   if(previewLayer){previewLayer.off('loading tileerror tileload tileunload load');map.removeLayer(previewLayer);previewLayer=null;}previewWatchers.length=0;
   if(!record){map.attributionControl.removeAttribution(dataCredit);return;}
   credit(map,record.query.source);const offset=options.detail==='fine'?1:options.detail==='coarse'?-1:0;
   previewLayer=L.tileLayer(record.tileTemplate,{pane:'live-preview',errorTileUrl:'/preview-unavailable.svg',tileSize:256/2**offset,zoomOffset:offset,minNativeZoom:Math.max(0,-offset),maxNativeZoom:12-offset,minZoom:1,maxZoom:14,noWrap:true,keepBuffer:0,updateWhenIdle:true,updateWhenZooming:false,opacity:options.opacity??0.8});
   const failures=new Set();const tileKey=e=>`${e.coords.z}/${e.coords.x}/${e.coords.y}`;const state=()=>({mapZoom:map.getZoom(),tileZoom:Math.max(0,Math.min(12,Math.round(map.getZoom())+offset)),errors:failures.size});
   previewLayer.on('loading',()=>onChange({...state(),loading:true}));previewLayer.on('tileerror',e=>{failures.add(tileKey(e));onChange({...state(),loading:false});});previewLayer.on('tileload',e=>{if(!e.tile.src.endsWith('/preview-unavailable.svg'))failures.delete(tileKey(e));});previewLayer.on('tileunload',e=>{failures.delete(tileKey(e));onChange({...state(),loading:previewLayer?.isLoading()||false});});previewLayer.on('load',()=>onChange({...state(),loading:false}));previewWatchers.push(()=>onChange({...state(),loading:previewLayer?.isLoading()||false}));previewLayer.addTo(map);onChange({...state(),loading:true});
  },
  previewOpacity(value){previewLayer?.setOpacity(value);},
  viewport(){const c=map.getCenter();return {center:[c.lat,c.lng],zoom:map.getZoom()};},
  restoreViewport(v){if(v)map.setView(v.center,v.zoom,{animate:false});},
  fitReference(geojson){const b=L.geoJSON(geojson).getBounds();if(b.isValid())map.fitBounds(b,{padding:[30,30],maxZoom:10});},
  fit(){if(area.getBounds().isValid())map.fitBounds(area.getBounds(),{padding:[25,25]});},
 };
}
export function createArtifactMap({onMove=()=>{}}={}){
 const map=createMap('artifact-map'),boundary=L.geoJSON(null,{interactive:false,style:{color:'#315a73',weight:2,fillOpacity:0}}).addTo(map),marks=L.layerGroup().addTo(map);let artifact=null;map.scrollWheelZoom.disable();map.on('moveend',onMove);
 return {fit(){map.fitBounds(boundary.getBounds(),{padding:[30,30]});},viewport(){const c=map.getCenter();return {center:[c.lat,((c.lng+180)%360+360)%360-180],zoom:map.getZoom()};},restoreViewport(value){if(value)map.setView(value.center,value.zoom);},show(a,view,{fit=false}={}){const changed=artifact!==a;artifact=a;marks.clearLayers();credit(map,a.query.source);if(changed){boundary.clearLayers();boundary.addData(JSON.parse(a.files['boundary.geojson']));}map.invalidateSize();if(changed||fit)map.fitBounds(boundary.getBounds(),{padding:[30,30]});
 const cells=view.cells,max=cells.reduce((value,c)=>Math.max(value,c.value),0),scope=`${view.window.start} → ${view.window.end} UTC (exclusive end); ${view.options.time||'all original labels'}; ${view.options.group||'all saved groups'}`;
 document.getElementById('map-legend').textContent=view.mapOmitted?'Map omitted; every selected value remains in the summaries and exports.':!cells.length?'No returned coordinate values; no numeric scale is inferred.':`Dynamic selected-coordinate scale: 0–${displayMeasure(max)} ${a.manifest.units} · ${view.cellCount.toLocaleString()} locations · hollow marks = explicit zero`;
 document.getElementById('artifact-map-message').textContent=view.mapOmitted?'Over 20,000 returned coordinates. Narrow the saved-data window or group to show the map.':!cells.length?'No returned rows for this applied selection. This does not establish absence of activity.':'Symbols show returned grid coordinates, not fractional cell footprints. Missing locations are unknown. The map, chart and rows use the same applied selection. Panning and zooming do not filter data or change exports.';
 for(const c of cells){const t=max?c.value/max:0,marker=L.circleMarker([c.lat,c.lon],{radius:c.value===0?3:5+Math.sqrt(t)*7,color:'#164b4b',weight:c.value===0?1.3:.5,fillColor:c.value===0?'white':t<.25?'#b8ded6':t<.5?'#65bbae':t<.75?'#168e81':'#00574f',fillOpacity:1});marker.bindPopup(textNode(`${displayMeasure(c.value)} ${a.manifest.units}; returned coordinate ${c.lat}, ${c.lon}; ${scope}. Source ${a.manifest.source}, ${a.manifest.datasetVersion}.`));marks.addLayer(marker);}
 }};
}

export function createBatchMap({onViewChange}={}){
 const map=createMap('batch-analysis-map'),boundary=L.geoJSON(null,{interactive:false,style:{color:'#315a73',weight:2,fillOpacity:0}}).addTo(map),marks=L.layerGroup().addTo(map);let lastId=null;
 map.on('moveend',()=>onViewChange?.());
 return {viewport(){const c=map.getCenter();return {center:[c.lat,((c.lng+180)%360+360)%360-180],zoom:map.getZoom()};},restoreViewport(value){if(value)map.setView(value.center,value.zoom);},show(result){
  credit(map,result.query.source);boundary.clearLayers();boundary.addData(result.geometry);marks.clearLayers();map.invalidateSize();
  if(lastId!==result.batchId){map.fitBounds(boundary.getBounds(),{padding:[30,30]});lastId=result.batchId;}
  const max=result.cells.reduce((v,c)=>Math.max(v,c.value),0);
  for(const cell of result.cells){const t=max?cell.value/max:0;const marker=L.circleMarker([cell.lat,cell.lon],{radius:5+Math.sqrt(t)*7,color:'#164b4b',weight:0.5,fillColor:t<0.25?'#b8ded6':t<0.5?'#65bbae':t<0.75?'#168e81':'#00574f',fillOpacity:0.8});marker.bindPopup(textNode(`${cell.value.toLocaleString(undefined,{maximumFractionDigits:3})} ${result.units} · ${cell.rows} returned rows at ${cell.lat}, ${cell.lon}. ${result.options.start} → ${result.options.end}; ${result.options.group||'all groups'}. ${result.selectionComplete?'Selected chunks retrieved.':'Partial retrieval.'}`));marks.addLayer(marker);}
  document.getElementById('batch-analysis-map-message').textContent=result.mapOmitted?`More than ${result.maxCells.toLocaleString()} coordinates. Narrow the display dates or group to show the map; totals and table still include all selected rows.`:`${result.cells.length.toLocaleString()} returned coordinates · display scale 0–${max.toLocaleString(undefined,{maximumFractionDigits:3})} ${result.units}. Coordinate symbols, not verified cell footprints. Missing locations are not zero.`;
 }};
}
export function createInfrastructureMap(){
 const map=createMap('infrastructure-map'),boundary=L.geoJSON(null,{interactive:false,style:{color:'#315a73',weight:2,fillOpacity:0}}).addTo(map);let id=null;
 return {show(view){boundary.clearLayers();boundary.addData(view.query.geometry);map.invalidateSize();if(id!==view.id&&!document.getElementById('infrastructure').hidden){map.fitBounds(boundary.getBounds(),{padding:[30,30]});id=view.id;}}};
}

export function createComparisonMaps(){
 const ids=['compare-left-map','compare-right-map'];
 const maps=ids.map(createMap);const boundaries=maps.map(map=>L.geoJSON(null,{interactive:false,style:{color:'#315a73',weight:2,fillOpacity:0}}).addTo(map));const layers=maps.map(map=>L.layerGroup().addTo(map));
 let syncing=false;
 maps.forEach((map,index)=>map.on('moveend',()=>{
  if(syncing||!document.getElementById('link-comparison-maps').checked)return;
  const other=maps[1-index],center=map.getCenter(),zoom=map.getZoom();
  if(other.getZoom()===zoom&&other.getCenter().equals(center))return;
  syncing=true;other.setView(center,zoom,{animate:false});syncing=false;
 }));
 return {show(report){
  const commonUnits=report.units[0]===report.units[1];
  const maxima=['left','right'].map(side=>report.cells.reduce((max,c)=>Math.max(max,c[side]??0),0));
  syncing=true;
  maps.forEach((map,index)=>{
   credit(map,report.parents[index].query.source);
   layers[index].clearLayers();boundaries[index].clearLayers();boundaries[index].addData(report.parents[index].boundary);
   map.invalidateSize();map.fitBounds(boundaries[index].getBounds(),{padding:[25,25],animate:false});
   const side=index?'right':'left',cells=report.cells.filter(c=>c[side]!==null),max=commonUnits?Math.max(...maxima):maxima[index];
   if(cells.length>20000){document.getElementById(ids[index]+'-message').textContent='Over 20,000 locations; map omitted. Complete values remain in the comparison export.';return;}
   for(const cell of cells){const value=cell[side],ratio=max?value/max:0;const color=ratio<0.25?'#b8ded6':ratio<0.5?'#65bbae':ratio<0.75?'#168e81':'#00574f';
    L.circleMarker([cell.lat,cell.lon],{radius:5+Math.sqrt(ratio)*7,color:'#164b4b',weight:0.5,fillColor:color,fillOpacity:0.8}).bindPopup(textNode(`${value.toLocaleString(undefined,{maximumFractionDigits:3})} ${report.units[index]} at ${cell.lat}, ${cell.lon}. ${cell.delta===null?'Difference unavailable at this coordinate.':`Comparison minus baseline: ${cell.delta.toLocaleString(undefined,{maximumFractionDigits:3})}.`}`)).addTo(layers[index]);
   }
   document.getElementById(ids[index]+'-message').textContent=`${commonUnits?'Shared':'Independent'} scale 0–${max.toLocaleString(undefined,{maximumFractionDigits:3})} ${report.units[index]}. ${cells.length} returned coordinates; missing locations are not zero.`;
  });syncing=false;
 }};
}

export function createEventMap(onSelect){
 const map=createMap('event-map'),marks=L.featureGroup().addTo(map),boundary=L.geoJSON(null,{interactive:false,style:{color:'#315a73',weight:2,fillOpacity:0}}).addTo(map);
 map.scrollWheelZoom.disable();
 map.attributionControl.addAttribution('Powered by <a href="https://globalfishingwatch.org" target="_blank" rel="noreferrer">Global Fishing Watch</a>');
 return {show(events,position,geometry=null){marks.clearLayers();boundary.clearLayers();if(geometry)boundary.addData(geometry);let located=0;const buckets=new Map();
  for(const event of events){const p=position(event);if(!p)continue;located++;const key=p.join(',');const bucket=buckets.get(key)||{position:p,events:[]};bucket.events.push(event);buckets.set(key,bucket);}
  const shown=[...buckets.values()].slice(0,2000);
  for(const bucket of shown){
   const popup=document.createElement('div');const title=document.createElement('p');title.textContent=`${bucket.events.length} event(s) at this returned coordinate. Event summaries, not a track.`;popup.append(title);
   for(const event of bucket.events.slice(0,10)){const button=document.createElement('button');button.type='button';button.textContent=`Inspect ${event.type} · ${event.start.slice(0,10)}`;button.addEventListener('click',()=>onSelect(event));popup.append(button);}
   if(bucket.events.length>10){const note=document.createElement('p');note.textContent='First ten events shown here; all are available in the table/export.';popup.append(note);}
   L.circleMarker(bucket.position,{radius:6+Math.min(10,Math.sqrt(bucket.events.length)*2),color:'#164b4b',fillColor:'#00877c',fillOpacity:0.75,weight:1}).bindPopup(popup).addTo(marks);
  }
  map.invalidateSize();const fit=L.latLngBounds([]);if(shown.length)fit.extend(marks.getBounds());if(geometry)fit.extend(boundary.getBounds());if(fit.isValid())map.fitBounds(fit,{padding:[30,30],maxZoom:geometry?12:9,animate:false});
  document.getElementById('event-map-message').textContent=`${located} located events at ${buckets.size} distinct returned coordinates; ${events.length-located} records lack a supported position. Showing ${shown.length} locations. Locations are event summaries, not vessel tracks. Use the +/− map controls to zoom.${geometry?' The outlined boundary is the submitted spatial selection; summary points were not clipped locally.':''}`;
 }};
}

export function createStatsBoundaryMap(){const map=createMap('event-stats-map'),boundary=L.geoJSON(null,{interactive:false,style:{color:'#315a73',weight:2,fillOpacity:0}}).addTo(map);map.scrollWheelZoom.disable();map.attributionControl.addAttribution('Powered by <a href="https://globalfishingwatch.org" target="_blank" rel="noreferrer">Global Fishing Watch</a>');return {show(geometry){boundary.clearLayers();boundary.addData(geometry);map.invalidateSize();map.fitBounds(boundary.getBounds(),{padding:[30,30],maxZoom:12,animate:false});}};}
