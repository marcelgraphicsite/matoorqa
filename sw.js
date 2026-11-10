const C='mq-7a15f657a67a';
const CORE=['./','index.html','fb.js','manifest.webmanifest','icons/icon-192.png','icons/apple-touch-icon.png','icons/badge-96.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()))});
const AC='mq-ark-1';
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C&&k!==AC).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET')return;const u=new URL(r.url);if(u.origin!==location.origin)return;
  if(/\/ark\/[a-z0-9]+\/\d+\.webp$/.test(u.pathname)){e.respondWith(caches.open(AC).then(c=>c.match(r).then(m=>m||fetch(r).then(res=>{if(res&&res.ok)c.put(r,res.clone());return res}))));return}
  e.respondWith((r.mode==='navigate'?fetch(r):fetch(r,{cache:'no-cache'})).then(res=>{if(res&&res.ok){const cp=res.clone();caches.open(C).then(c=>c.put(u.pathname.endsWith('app.bin')?new Request(u.origin+u.pathname):r,cp))}return res})
    .catch(()=>caches.match(u.pathname.endsWith('app.bin')?new Request(u.origin+u.pathname):r,{ignoreSearch:true}).then(m=>m||caches.match('index.html'))))});

self.addEventListener('push',e=>{let d={};try{d=e.data?e.data.json():{}}catch(x){d={b:e.data?e.data.text():''}}
  e.waitUntil(self.registration.showNotification(d.t||'matoorqa',{body:d.b||'',icon:'icons/icon-192.png',badge:'icons/badge-96.png',tag:d.g||'mq',renotify:!!d.g,data:{u:d.u||''}}))});
self.addEventListener('notificationclick',e=>{e.notification.close();const go=(e.notification.data&&e.notification.data.u)||'';
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(l=>{const c=l.find(x=>'focus' in x);if(c){if(go)c.postMessage({go});return c.focus()}return self.clients.openWindow('./'+go)}))});
