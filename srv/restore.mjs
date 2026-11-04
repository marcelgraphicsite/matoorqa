// matoorqa: jednorazowe przywrócenie stanu konta admina z kopii bk (zrobionej przez diag.mjs). Wypisuje tylko liczby.
import admin from 'firebase-admin';
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SA)) });
const db = admin.firestore();
const BID = process.env.BID;
const ap = ((await db.doc('keys/app').get()).data() || {}).ap;
if (!ap || !/^state_\d+$/.test(BID || '')) { console.log('brak ap albo BID'); process.exit(1); }
const bk = await db.doc(`bk/${ap}/v/${BID}`).get();
if (!bk.exists) { console.log('brak kopii'); process.exit(1); }
const S = JSON.parse(bk.data().data.j);
const ref = db.doc(`data/users/${ap}/state`);
const cur = await ref.get();
if (cur.exists) await db.doc(`bk/${ap}/v/current_${Date.now()}`).set({ kind: 'state', data: cur.data(), saved: Date.now() });
S.at = Date.now();
await ref.set({ j: JSON.stringify(S), at: S.at });
const back = JSON.parse((await ref.get()).data().j);
console.log('przywrócono: xp', (back.tot || {}).xp, 'odpowiedzi', (back.tot || {}).a, 'nick', ((back.social || {}).h) ? 'jest' : 'brak', 'zdjęcie', ((back.social || {}).av) ? 'jest' : 'brak', 'znajomi', ((back.social || {}).fr || []).length, 'rozmiar', JSON.stringify(back).length);
