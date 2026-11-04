const C='mq-8f8d3ff7bec7';
const CORE=['./','index.html','fb.js','manifest.webmanifest','icons/icon-192.png','icons/apple-touch-icon.png','icons/badge-96.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET')return;const u=new URL(r.url);if(u.origin!==location.origin)return;
  e.respondWith((r.mode==='navigate'?fetch(r):fetch(r,{cache:'no-cache'})).then(res=>{if(res&&res.ok){const cp=res.clone();caches.open(C).then(c=>c.put(u.pathname.endsWith('app.bin')?new Request(u.origin+u.pathname):r,cp))}return res})
    .catch(()=>caches.match(u.pathname.endsWith('app.bin')?new Request(u.origin+u.pathname):r,{ignoreSearch:true}).then(m=>m||caches.match('index.html'))))});

self.addEventListener('push',e=>{let d={};try{d=e.data?e.data.json():{}}catch(x){d={b:e.data?e.data.text():''}}
  e.waitUntil(self.registration.showNotification(d.t||'matoorqa',{body:d.b||'',icon:'icons/icon-192.png',badge:'icons/badge-96.png',tag:d.g||'mq',renotify:!!d.g,data:{u:d.u||''}}))});
self.addEventListener('notificationclick',e=>{e.notification.close();const go=(e.notification.data&&e.notification.data.u)||'';
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(l=>{const c=l.find(x=>'focus' in x);if(c){if(go)c.postMessage({go});return c.focus()}return self.clients.openWindow('./'+go)}))});
