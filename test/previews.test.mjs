import test from 'node:test';
import assert from 'node:assert/strict';
import {PreviewStore,previewQuery,generatePreviewStyle,tileRequest,pngDimensions} from '../server/previews.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {start} from '../server/index.mjs';
const input={source:'gfw-fishing',datasetVersion:'v5.0',start:'2024-01-01',end:'2024-02-01',grid:0.1,interval:'DAILY',grouping:'GEARTYPE',bounds:[-2,49,-1,50],flags:['ESP'],gears:[]};
const dataset='public-global-fishing-effort:v5.0';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42AAAAAASUVORK5CYII=','base64');
const style=Buffer.from(JSON.stringify({color:[178,77,22],ramp:[0,1,10]})).toString('base64');
const styleData={url:`https://different-authority.example/v3/4wings/tile/heatmap/{z}/{x}/{y}?datasets%5B0%5D=${dataset}&style=${encodeURIComponent(style)}`,colorRamp:{stepsByZoom:{6:[{value:10},{value:0},{value:1}]}}};
const response=data=>new Response(JSON.stringify(data),{headers:{'x-datasets':dataset}});
const mock=async url=>String(url).includes('generate-png')?response(styleData):new Response(png,{headers:{'content-type':'image/png','x-datasets':dataset}});
test('preview semantics exclude geometry and export resolution while retaining filters/version',()=>{
 const a=previewQuery(input),b=previewQuery({...input,grid:0.01,interval:'MONTHLY',grouping:'FLAG',geometry:{type:'bad'},bounds:[]});assert.deepEqual(a,b);assert.equal(a.datasetVersion,'v5.0');assert.equal(a.geometry,undefined);
 assert.throws(()=>previewQuery({...input,source:'synthetic-activity'}));assert.throws(()=>previewQuery(input,{interval:'HOUR'}));assert.throws(()=>previewQuery({...input,end:'2025-02-01'},{interval:'DAY'}));
 assert.equal(previewQuery({...input,end:'2025-02-01'},{interval:'MONTH'}).interval,'MONTH');
});
test('provider URL authority is never followed and credentials never enter public metadata',async()=>{
 const urls=[];const store=new PreviewStore({context:()=>({token:'private-personal-token',revision:1}),fetchImpl:async(url,options)=>{urls.push(url);assert.equal(new URL(url).origin,'https://gateway.api.globalfishingwatch.org');assert.equal(options.headers.Authorization,'Bearer private-personal-token');return mock(url);}});
 const p=await store.create(input);assert.deepEqual(p.thresholds[6],[0,1,10]);await store.tile(p.id,6,31,21);assert.equal(urls.length,2);assert.ok(!JSON.stringify(p).includes('private-personal-token'));assert.ok(!JSON.stringify(p).includes('different-authority'));store.closeAll();
});
test('bad style shapes, version changes and invalid PNG/coordinates fail closed',async()=>{
 await assert.rejects(generatePreviewStyle(previewQuery(input),'token',{fetchImpl:async()=>response({...styleData,url:'https://example.com/arbitrary?style=AA'})}),/shape/);
 await assert.rejects(generatePreviewStyle(previewQuery(input),'token',{fetchImpl:async()=>new Response(JSON.stringify(styleData),{headers:{'x-datasets':'public-global-fishing-effort:v4.0'}})}),/version/);
 assert.throws(()=>pngDimensions(Buffer.from('<html>blocked</html>')));assert.deepEqual(pngDimensions(png),{width:1,height:1});
 for(const coords of [[13,0,0],[2,-1,0],[2,4,0],[2,0,4]])assert.throws(()=>tileRequest(previewQuery(input),style,...coords));
});
test('duplicate in-flight tiles share a request; cached bytes expire and remain bounded',async()=>{
 let time=0,tiles=0;const store=new PreviewStore({now:()=>time,maxBytes:png.length,context:()=>({token:'token',revision:1}),fetchImpl:async url=>{if(!String(url).includes('generate-png')){tiles++;await new Promise(r=>setTimeout(r,5));}return mock(url);}});
 const p=await store.create(input);await Promise.all([store.tile(p.id,1,0,0),store.tile(p.id,1,0,0)]);assert.equal(tiles,1);await store.tile(p.id,1,0,0);assert.equal(tiles,1);
 await store.tile(p.id,1,1,0);assert.ok(store.bytes<=png.length);time=61000;await store.tile(p.id,1,1,0);assert.equal(tiles,3);store.closeAll();
});
test('preview sessions are independent, style cache is reused, and credential changes invalidate data',async()=>{
 let revision=1,styles=0;const store=new PreviewStore({context:()=>({token:'token',revision}),fetchImpl:async url=>{if(String(url).includes('generate-png'))styles++;return mock(url);}});
 const a=await store.create(input),b=await store.create(input);assert.notEqual(a.id,b.id);assert.equal(styles,1);store.close(a.id);await store.tile(b.id,1,0,0);
 revision=2;await assert.rejects(store.tile(b.id,1,0,0),/expired/);store.closeAll();assert.equal(store.bytes,0);assert.equal(store.styles.size,0);
});
test('upstream concurrency is bounded and HTTP errors are never converted to empty tiles',async()=>{
 let active=0,max=0;const store=new PreviewStore({context:()=>({token:'token',revision:1}),fetchImpl:async url=>{if(String(url).includes('generate-png'))return mock(url);active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,5));active--;return mock(url);}});
 const p=await store.create(input);await Promise.all(Array.from({length:12},(_,i)=>store.tile(p.id,4,i,0)));assert.ok(max<=4);store.closeAll();
 const failed=new PreviewStore({context:()=>({token:'token',revision:1}),fetchImpl:async url=>String(url).includes('generate-png')?mock(url):new Response('{}',{status:429})});const f=await failed.create(input);await assert.rejects(failed.tile(f.id,1,0,0),/429/);assert.equal(failed.cache.size,0);failed.closeAll();
});
test('HTTP preview endpoints enforce the local session and clear on disconnect',async()=>{
 const workspace=await mkdtemp(join(tmpdir(),'fishing-preview-http-'));let app;
 try{app=await start({port:0,workspace,fetchImpl:mock});const session=await fetch(app.origin+'/api/session',{method:'POST',headers:{'X-Bootstrap':app.launchUrl.split('#')[1]}});const headers={Cookie:session.headers.get('set-cookie').split(';')[0],'Content-Type':'application/json'};
 await fetch(app.origin+'/api/connection',{method:'POST',headers,body:JSON.stringify({token:'private-test-token-for-preview'})});
 const p=await(await fetch(app.origin+'/api/previews',{method:'POST',headers,body:JSON.stringify({query:input,options:{interval:'DAY'}})})).json();assert.ok(p.id);
 assert.equal((await fetch(app.origin+`/api/previews/${p.id}/tiles/1/0/0`)).status,401);
 const tile=await fetch(app.origin+`/api/previews/${p.id}/tiles/1/0/0`,{headers});assert.equal(tile.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await tile.arrayBuffer()),png);
 await fetch(app.origin+'/api/connection',{method:'DELETE',headers});assert.equal((await fetch(app.origin+`/api/previews/${p.id}/tiles/1/0/0`,{headers})).status,400);
 }finally{if(app)await app.close();await rm(workspace,{recursive:true,force:true});}
});
test('explicit startup token stays server-side and unsafe token characters are rejected',async()=>{
 const workspace=await mkdtemp(join(tmpdir(),'fishing-preview-token-'));let app;
 try{
  await assert.rejects(start({workspace,port:0,initialToken:'a'.repeat(20)+'\u0000'}),/token format/);
  app=await start({workspace,port:0,initialToken:'test-explicit-personal-token',fetchImpl:mock});
  assert.ok(!app.launchUrl.includes('test-explicit-personal-token'));
  const session=await fetch(app.origin+'/api/session',{method:'POST',headers:{'X-Bootstrap':app.launchUrl.split('#')[1]}});const headers={Cookie:session.headers.get('set-cookie').split(';')[0]};
  assert.deepEqual(await(await fetch(app.origin+'/api/connection',{headers})).json(),{connected:true});
  const placeholder=await fetch(app.origin+'/preview-unavailable.svg');assert.equal(placeholder.headers.get('content-type'),'image/svg+xml');assert.match(await placeholder.text(),/Image unavailable/);
 }finally{if(app)await app.close();await rm(workspace,{recursive:true,force:true});}
});
