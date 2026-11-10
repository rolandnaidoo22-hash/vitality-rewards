const C='vr-v7-gb',F=['./','index.html','manifest.webmanifest','icon-192.png','icon-512.png','assets/tesseract.min.js','assets/worker.min.js','assets/tesseract-core-lstm.wasm.js','assets/eng.traineddata.gz'];

function mimeFor(u){
  var p=new URL(u,self.location.href).pathname;
  if(p.endsWith('.js'))return 'text/javascript; charset=utf-8';
  if(p.endsWith('.gz'))return 'application/gzip';
  if(p.endsWith('.wasm'))return 'application/wasm';
  if(p.endsWith('.webmanifest'))return 'application/manifest+json';
  if(p.endsWith('.png'))return 'image/png';
  if(p.endsWith('.html')||p.endsWith('/'))return 'text/html; charset=utf-8';
  return null;
}

function tidy(req,res){
  var h=new Headers(res.headers);
  var m=mimeFor(req.url);
  if(m)h.set('Content-Type',m);
  // Keep .gz as gzip bytes. Never leave Content-Encoding:gzip on a .gz file,
  // or the browser gunzips it and Tesseract then tries to gunzip again.
  if(new URL(req.url,self.location.href).pathname.endsWith('.gz')){
    h.delete('Content-Encoding');
  }
  h.set('Accept-Ranges','bytes');
  return new Response(res.body,{status:res.status,statusText:res.statusText,headers:h});
}

function parseRange(header,size){
  var m=/bytes=(\d*)-(\d*)/.exec(header||'');
  if(!m)return null;
  var start=m[1]===''?null:+m[1], end=m[2]===''?null:+m[2];
  if(start==null&&end==null)return null;
  if(start==null){start=Math.max(0,size-end);end=size-1;}
  else if(end==null||end>=size)end=size-1;
  if(start<0||start>end||start>=size)return null;
  return {start:start,end:end};
}

async function rangeFrom(req,res){
  var header=req.headers.get('Range');
  if(!header||!res)return res;
  var buf=await res.arrayBuffer();
  var r=parseRange(header,buf.byteLength);
  if(!r)return new Response(buf,{status:200,headers:res.headers});
  var slice=buf.slice(r.start,r.end+1);
  var h=new Headers(res.headers);
  h.set('Content-Range','bytes '+r.start+'-'+r.end+'/'+buf.byteLength);
  h.set('Content-Length',String(slice.byteLength));
  h.set('Accept-Ranges','bytes');
  return new Response(slice,{status:206,headers:h});
}

async function fromCache(req){
  var cache=await caches.open(C);
  return (await cache.match(req,{ignoreSearch:true}))||(await caches.match(req,{ignoreSearch:true}));
}

self.addEventListener('install',function(e){
  e.waitUntil((async function(){
    var cache=await caches.open(C);
    await Promise.all(F.map(async function(f){
      var req=new Request(f,{cache:'reload'});
      var res=await fetch(req);
      if(!res.ok)throw new Error('cache '+f);
      await cache.put(req,tidy(req,res));
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate',function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){return k!==C}).map(function(k){return caches.delete(k)}));
  }).then(function(){return self.clients.claim()}));
});

self.addEventListener('fetch',function(e){
  if(e.request.method!=='GET')return;
  var url=new URL(e.request.url);
  if(url.origin!==location.origin)return;
  e.respondWith((async function(){
    var cached=await fromCache(e.request);
    if(cached)return rangeFrom(e.request,cached);
    try{
      var res=await fetch(e.request);
      if(res.ok && res.status!==206){
        var clone=res.clone();
        caches.open(C).then(function(c){c.put(e.request,tidy(e.request,clone))});
        return rangeFrom(e.request,tidy(e.request,res));
      }
      return res;
    }catch(err){
      if(cached)return rangeFrom(e.request,cached);
      throw err;
    }
  })());
});
