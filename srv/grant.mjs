// matoorqa: jednorazowo +1 zamrożenie serii na koncie admina. Przed zmianą kopia stanu w bk. Wypisuje tylko liczby.
import admin from 'firebase-admin';
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SA)) });
const db = admin.firestore();
const ap = ((await db.doc('keys/app').get()).data() || {}).ap;
if (!ap) { console.log('brak ap'); process.exit(1); }
const ref = db.doc(`data/users/${ap}/state`);
const cur = await ref.get();
if (!cur.exists) { console.log('brak stanu'); process.exit(1); }
await db.doc(`bk/${ap}/v/pregrant_${Date.now()}`).set({ kind: 'state', data: cur.data(), saved: Date.now() });
const S = JSON.parse(cur.data().j);
const before = +S.frz || 0;
S.frz = before + 1;
S.at = Date.now();
await ref.set({ ...cur.data(), j: JSON.stringify(S), at: S.at });
const B = JSON.parse((await ref.get()).data().j);
const days = B.days || {}, keys = Object.keys(days).map(Number).sort((a, b) => a - b).slice(-4);
console.log('zamrożenia', before, '->', B.frz, '| cel', (B.set || {}).goal, '| lp', B.lp, '| ostatnie dni', keys.map(k => k + ':' + days[k]).join(' '), '| zamrożone dni', (B.fz || []).slice(-4).join(' '));
