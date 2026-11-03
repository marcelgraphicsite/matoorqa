const C='mq-0cb4796eb0e0';
const CORE=['./','index.html','fb.js','manifest.webmanifest','icons/icon-192.png','icons/apple-touch-icon.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET')return;const u=new URL(r.url);if(u.origin!==location.origin)return;
  e.respondWith((r.mode==='navigate'?fetch(r):fetch(r,{cache:'no-cache'})).then(res=>{if(res&&res.ok){const cp=res.clone();caches.open(C).then(c=>c.put(u.pathname.endsWith('app.bin')?new Request(u.origin+u.pathname):r,cp))}return res})
    .catch(()=>caches.match(u.pathname.endsWith('app.bin')?new Request(u.origin+u.pathname):r,{ignoreSearch:true}).then(m=>m||caches.match('index.html'))))});
