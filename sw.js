const C='mq-c4b4b89f18fc';
// skorupa apki (z tą samą wersją co sw.js): pobierana w tle przy instalacji, potem podawana od razu z pamięci,
// więc start nie czeka na sieć. Nowa wersja instaluje się w tle przy wejściu i działa od następnego otwarcia.
const CORE=['index.html?v=c4b4b89f18fc','app.bin?v=c4b4b89f18fc','fb.js?v=c4b4b89f18fc','manifest.webmanifest','icons/icon-192.png','icons/apple-touch-icon.png','icons/badge-96.png'];
const AC='mq-ark-1',FC='mq-font-1';
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(CORE.map(u=>new Request(u,{cache:'reload'})))).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C&&k!==AC&&k!==FC).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
const fromCache=(name,r)=>caches.open(name).then(c=>c.match(r,{ignoreSearch:true}).then(m=>m||fetch(r).then(res=>{if(res&&res.ok)c.put(r,res.clone());return res})));
const shell=u=>/\/(?:app\.bin|fb\.js|manifest\.webmanifest)$/.test(u.pathname)||/\/icons\/[^/]+$/.test(u.pathname);
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET')return;const u=new URL(r.url);if(u.origin!==location.origin)return;
  if(u.pathname.includes('/tts/'))return; // nagrania lektora: przeglądarka sama obsługuje zakresy (Range), Safari tego wymaga
  if(/\/ark\/[a-z0-9]+\/(?:k\/)?\d+\.webp$/.test(u.pathname)||/\/geo\/[a-z0-9-]+\.webp$/.test(u.pathname)){e.respondWith(fromCache(AC,r));return}
  if(/\/fonts\/[a-z0-9-]+\.woff2$/.test(u.pathname)){e.respondWith(fromCache(FC,r));return}
  if(r.mode==='navigate'){e.respondWith(caches.open(C).then(c=>c.match('index.html',{ignoreSearch:true})).then(m=>m||net(r)));return}
  if(shell(u)){e.respondWith(caches.open(C).then(c=>c.match(r,{ignoreSearch:true})).then(m=>m||net(r)));return}
  e.respondWith(net(r))});
// reszta: najpierw sieć, bez sieci kopia
function net(r){const u=new URL(r.url);const key=u.pathname.endsWith('app.bin')?new Request(u.origin+u.pathname):r;
  return(r.mode==='navigate'?fetch(r):fetch(r,{cache:'no-cache'})).then(res=>{if(res&&res.ok){const cp=res.clone();caches.open(C).then(c=>c.put(key,cp))}return res})
    .catch(()=>caches.match(key,{ignoreSearch:true}).then(m=>m||caches.match('index.html',{ignoreSearch:true})))}

// strona pyta, jaką wersję podaje worker (komunikat „Nowa wersja gotowa”)
self.addEventListener('message',e=>{if(e.data&&e.data.q==='ver'&&e.source)e.source.postMessage({ver:C})});
self.addEventListener('push',e=>{let d={};try{d=e.data?e.data.json():{}}catch(x){d={b:e.data?e.data.text():''}}
  e.waitUntil(self.registration.showNotification(d.t||'matoorqa',{body:d.b||'',icon:'icons/icon-192.png',badge:'icons/badge-96.png',tag:d.g||'mq',renotify:!!d.g,data:{u:d.u||''}}))});
self.addEventListener('notificationclick',e=>{e.notification.close();const go=(e.notification.data&&e.notification.data.u)||'';
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(l=>{const c=l.find(x=>'focus' in x);if(c){if(go)c.postMessage({go});return c.focus()}return self.clients.openWindow('./'+go)}))});
