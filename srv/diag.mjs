// matoorqa: jednorazowy odczyt kont i kopia starszych wersji dokumentów (Firestore trzyma je przez godzinę).
// Logi na GitHubie są publiczne, więc wynik jest zaszyfrowany kluczem z diag.pub. Kopie zostają w bazie, w kolekcji bk (czyta ją tylko serwer).
import admin from 'firebase-admin';
import crypto from 'node:crypto';
import fs from 'node:fs';
import zlib from 'node:zlib';

const sa = JSON.parse(process.env.FIREBASE_SA);
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
const TS = admin.firestore.Timestamp;
const PUB = fs.readFileSync(new URL('./diag.pub', import.meta.url), 'utf8');
const h8 = x => crypto.createHash('sha256').update(String(x)).digest('hex').slice(0, 8);
const dec = d => { if (!d) return null; if (typeof d.j === 'string') { try { return JSON.parse(d.j); } catch (e) { return null; } } return d; };
const iso = t => (t && t.toDate ? t.toDate().toISOString() : null);
const isoMs = m => (m ? new Date(+m).toISOString() : null);
const msOf = t => (t && t.toMillis ? t.toMillis() : 0);
const out = { now: new Date().toISOString(), err: [] };
const E = (k, e) => { const m = k + ': ' + String(e && (e.message || e.code) || e).slice(0, 200); if (!out.err.includes(m)) out.err.push(m); };

function stSum(S) {
  if (!S) return null; const days = S.days || {}; const dk = Object.keys(days).filter(k => +days[k] > 0);
  return { at: isoMs(S.at), h: (S.social || {}).h || '', nm: (S.set || {}).name || '', onb: (S.set || {}).onb || 0, xp: (S.tot || {}).xp || 0, a: (S.tot || {}).a || 0,
    days: dk.length, last: dk.length ? Math.max(...dk.map(Number)) : 0, since: S.since || 0, fr: ((S.social || {}).fr || []).length, rq: ((S.social || {}).rq || []).length,
    av: !!(S.social || {}).av, len: JSON.stringify(S).length };
}
function soSum(x) {
  if (!x) return null;
  return { h: x.h || '', n: x.n || '', at: isoMs(x.at), v: x.v || 0, xw: x.xw || 0, lx: x.lx || 0, st: x.st || 0, av: !!x.av, fr: (x.fr || []).length, rq: (x.rq || []).length };
}

async function main() {
  const app = (await db.doc('keys/app').get()).data() || {};
  const ap = app.ap || '';
  out.ap = h8(ap);
  const invs = (await db.collection('invites').get()).docs.map(d => ({ id: d.id, ...d.data() }));
  const mems = (await db.collection('members').get()).docs.map(d => ({ id: d.id, ...d.data() }));
  const socs = {}; (await db.collection('social').get()).docs.forEach(d => { socs[d.id] = dec(d.data()); });
  const ps = [...new Set(invs.map(x => x.p).concat(mems.map(m => m.p)).concat(Object.keys(socs)).filter(Boolean))];
  out.acc = [];
  for (const p of ps) {
    let st = null;
    try { const s = await db.doc('data/users/' + p + '/state').get(); st = s.exists ? { ...stSum(dec(s.data())), ut: iso(s.updateTime) } : null; } catch (e) { E('st ' + h8(p), e); }
    out.acc.push({ p: h8(p), admin: p === ap,
      inv: invs.filter(x => x.p === p).map(x => ({ i: h8(x.id), at: isoMs(x.at), n: x.n, l: x.label || '', u: (x.uids || []).map(h8) })),
      mem: mems.filter(m => m.p === p).map(m => ({ u: h8(m.id), i: h8(m.inv), at: isoMs(m.at), invOk: invs.some(x => x.id === m.inv) })),
      so: soSum(socs[p]), st });
  }
  // historia: konto admina i każde konto, które ma albo miało jeden z tych nicków
  const watch = new Set([ap]);
  for (const [p, x] of Object.entries(socs)) if (x && ['jokoj', 'marceliooz'].includes(x.h)) watch.add(p);
  out.hist = {};
  const MIN = 60000, base = Math.floor(Date.now() / MIN) * MIN;
  const steps = []; for (let k = 0; k <= 64; k++) steps.push(k); steps.push(90, 120, 180, 360, 720, 1440, 2880, 5760, 10000);
  for (const p of watch) {
    if (!p) continue;
    const refs = [['state', db.doc('data/users/' + p + '/state')], ['social', db.doc('social/' + p)]];
    const seen = { state: new Set(), social: new Set() }; const H = out.hist[h8(p)] = { state: [], social: [], ok: [], bad: [] };
    for (const k of steps) {
      const rt = base - k * MIN; let snaps;
      try { snaps = await db.runTransaction(async t => Promise.all(refs.map(([, r]) => t.get(r))), { readOnly: true, readTime: TS.fromMillis(rt) }); H.ok.push(k); }
      catch (e) { H.bad.push(k); E('rt', e); continue; }
      snaps.forEach((s, j) => {
        const kind = refs[j][0];
        if (!s.exists) { if (!seen[kind].has('none')) { seen[kind].add('none'); H[kind].push({ rt: isoMs(rt), none: 1 }); } return; }
        const key = String(msOf(s.updateTime)); if (seen[kind].has(key)) return; seen[kind].add(key);
        const data = s.data(); const obj = dec(data);
        H[kind].push({ rt: isoMs(rt), ut: iso(s.updateTime), id: kind + '_' + key, ...(kind === 'state' ? stSum(obj) : soSum(obj)) });
        H.save = H.save || []; H.save.push([kind + '_' + key, kind, s.updateTime, rt, data]);
      });
    }
    for (const [bid, kind, ut, rt, data] of H.save || []) {
      try { const bref = db.doc('bk/' + p + '/v/' + bid); const ex = await bref.get(); if (!ex.exists) await bref.set({ kind, ut, rt: TS.fromMillis(rt), data, saved: Date.now() }); }
      catch (e) { E('bk', e); }
    }
    delete H.save;
  }
}

try { await main(); } catch (e) { E('main', e); }
const key = crypto.randomBytes(32), iv = crypto.randomBytes(12);
const c = crypto.createCipheriv('aes-256-gcm', key, iv);
const ct = Buffer.concat([c.update(zlib.gzipSync(Buffer.from(JSON.stringify(out)))), c.final(), c.getAuthTag()]);
const ek = crypto.publicEncrypt({ key: PUB, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, key);
const blob = [ek, iv, ct].map(b => b.toString('base64')).join('.');
for (let i = 0; i < blob.length; i += 3000) console.log('D' + String(i / 3000).padStart(3, '0') + ' ' + blob.slice(i, i + 3000));
console.log('kont: ' + (out.acc || []).length + ', błędów: ' + out.err.length);
