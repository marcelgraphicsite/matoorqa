// matoorqa: powiadomienia push. Odpala go GitHub Actions co 30 minut (plik .github/workflows/push.yml).
// Czyta bazę kontem serwisowym z sekretu FIREBASE_SA. Logi na GitHubie są publiczne, więc wypisuje tylko liczby.
import admin from 'firebase-admin';
import webpush from 'web-push';
import { pathToFileURL } from 'node:url';

const SUBJECT = 'https://marcelgraphicsite.github.io/matoorqa/';
const DAY = 864e5;
const MATURA = Date.UTC(2027, 4, 4) / DAY;
const hsh = t => { let x = 0; for (const c of String(t)) x = (x * 31 + c.charCodeAt(0)) >>> 0; return x; };
const QUIET_FROM = 22, QUIET_TO = 8, PER_RUN = 2, PER_DAY = 6;

const plf = (n, a, b, c) => { n = Math.abs(n); if (n === 1) return a; const d = n % 10, h = n % 100; return d >= 2 && d <= 4 && !(h >= 12 && h <= 14) ? b : c; };
const dni = n => `${n} ${plf(n, 'dzień', 'dni', 'dni')}`;
const fmtN = n => String(Math.round(+n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const sec = ms => (Math.max(0, +ms || 0) / 1000).toFixed(1).replace('.', ',') + ' s';
const weekIdx = d => Math.floor((d + 3) / 7);
const cmp = (a, am, b, bm) => a !== b ? Math.sign(a - b) : Math.sign(bm - am);
const dec = x => { if (!x) return null; if (typeof x.j === 'string') { try { return JSON.parse(x.j); } catch (e) { return null; } } return x; };

// dzień i godzina w strefie użytkownika; numer dnia liczony tak samo jak w apce (dayNum)
export function local(now, tz) {
  let p;
  try { p = new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'Europe/Warsaw', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(now)); }
  catch (e) { return local(now, 'Europe/Warsaw'); }
  const g = t => +p.find(x => x.type === t).value;
  return { day: Math.floor(Date.UTC(g('year'), g('month') - 1, g('day')) / DAY), h: g('hour') };
}

// stan dnia z dokumentu social (albo z pełnego stanu, gdy ktoś nie ma nicku)
function today(x, day) {
  return { td: +x.d === day ? (+x.td || 0) : 0, st: +x.d >= day - 1 ? (+x.st || 0) : 0, g: +x.g || 60, n: x.n || '', last: +x.td > 0 ? +x.d : +x.st > 0 ? +x.d - 1 : +x.d };
}
function fromState(S, day) {
  if (!S || !S.days) return null;
  const g = +(S.set && S.set.goal) || 60, fz = Array.isArray(S.fz) ? S.fz : [];
  const met = d => (+S.days[d] || 0) >= g || fz.includes(d);
  let st = 0, d = met(day) ? day : day - 1;
  while (met(d) && st < 3650) { if (!fz.includes(d)) st++; d--; }
  const act = Object.keys(S.days).filter(k => +S.days[k] > 0).map(Number);
  return { td: +S.days[day] || 0, st, g, n: (S.set && S.set.name) || '', last: act.length ? Math.max(...act) : null };
}

// co wysłać jednej osobie; m.set to zmiana stanu, zapisywana dopiero po udanej wysyłce
export function events(p, soc, st, my, ctx) {
  const { day, h, H, now } = ctx, out = [], me = soc[p] || null, wk = weekIdx(day);
  const xw = x => x && x.wk === wk ? (+x.xw || 0) : 0;
  // 1. wyzwania na pojedynek
  let top = 0, hit = null;
  for (const k in soc) {
    if (k === p) continue;
    const du = soc[k].du || {};
    for (const id in du) {
      const d = du[id];
      if (!d || d.to !== p || !(+d.at > (st.du || 0)) || now - d.at > 2 * DAY) continue;
      if (me && me.dr && me.dr[id]) continue;
      if (+d.at > top) { top = +d.at; hit = { h: soc[k].h, d }; }
    }
  }
  if (hit) out.push({ t: `Wyzwanie od @${hit.h}`, b: `${hit.d.n || 8} zadań na czas. Do pobicia: ${+hit.d.sc || 0}/${hit.d.n || 8}.`, u: '#znajomi', g: 'duel', set: { du: top } });
  // 2. szturchnięcia i piątki
  top = 0; hit = null;
  for (const k in soc) {
    if (k === p) continue;
    const v = (soc[k].nz || {})[p];
    if (Array.isArray(v) && +v[0] > (st.nz || 0) && now - v[0] < DAY && +v[0] > top) { top = +v[0]; hit = { h: soc[k].h, typ: v[1] }; }
  }
  if (hit) out.push(hit.typ === 'h'
      ? { t: `Piątka od @${hit.h}`, b: 'Za dzisiejszy cel. Tak trzymaj.', u: '#start', g: 'soc', set: { nz: top } }
      : { t: `@${hit.h} cię szturcha`, b: my && my.td < my.g ? `Do celu brakuje ${fmtN(my.g - my.td)} XP. Jedna lekcja i po sprawie.` : 'Ekipa się uczy. Wpadnij na jedną lekcję.', u: '#start', g: 'soc', set: { nz: top } });
  // 3. wyniki moich wyzwań
  if (me && me.du) {
    top = 0; hit = null;
    for (const id in me.du) {
      const d = me.du[id], T = soc[d.to], r = T && T.dr && T.dr[id];
      if (r && +r.at > (st.dr || 0) && now - r.at < 2 * DAY && +r.at > top) { top = +r.at; hit = { d, r, h: T.h }; }
    }
    if (hit) {
      const w = cmp(+hit.d.sc || 0, +hit.d.ms || 0, +hit.r.sc || 0, +hit.r.ms || 0), n = hit.d.n || 8;
      out.push({ t: w > 0 ? `Wygrywasz pojedynek z @${hit.h}` : w < 0 ? `@${hit.h} wygrywa pojedynek` : `Remis z @${hit.h}`, b: `Ty ${+hit.d.sc || 0}/${n}, @${hit.h} ${+hit.r.sc || 0}/${n}.${w > 0 ? ' +20 XP czeka w apce.' : w < 0 ? ' Rewanż?' : ''}`, u: '#znajomi', g: 'duel', set: { dr: top } });
    }
  }
  // 4. liga: ktoś mnie wyprzedził
  const fr = me && Array.isArray(me.fr) ? me.fr.filter(k => k !== p && soc[k]) : [];
  if (me && fr.length) {
    const rows = [p, ...fr].map(k => ({ k, xw: xw(soc[k]) })).sort((a, b) => b.xw - a.xw);
    const mx = xw(me), above = rows.filter(r => r.k !== p && r.xw > mx).map(r => r.k);
    if (st.lg && st.lg.wk === wk && mx > 0) {
      const nw = above.filter(k => !st.lg.ab.includes(k));
      if (!st.lgn || st.lgn.d !== day) st.lgn = { d: day, n: 0 };
      if (nw.length && st.lgn.n < 2) {
        const pos = rows.findIndex(r => r.k === p) + 1, gap = rows[pos - 2].xw - mx + 1;
        out.push({ t: `@${soc[nw[0]].h} wyprzedza cię w lidze`, b: `Jesteś ${pos}. Do ${pos - 1}. miejsca brakuje ${fmtN(gap)} XP${gap <= 150 ? ', czyli jednej lekcji' : ''}.`, u: '#znajomi', g: 'liga', set: { lgn: { d: day, n: st.lgn.n + 1 } } });
      }
    }
    st.lg = { wk, ab: above };
    // 5. cel ekipy zrobiony
    const team = [p, ...fr];
    if (team.length >= 2 && st.tg !== wk) {
      let sum = 0, tg = 0;
      for (const k of team) { sum += xw(soc[k]); tg += Math.max(20, +soc[k].g || 60) * 5; }
      if (sum >= tg) out.push({ t: 'Ekipa dowiozła cel tygodnia', b: `${fmtN(sum)} XP razem przy celu ${fmtN(tg)}. Dobra robota.`, u: '#znajomi', g: 'ekipa', set: { tg: wk } });
    }
    // 6. pytanie dnia: ktoś z ekipy już odpowiedział
    if (st.qd !== day && h >= 12 && h < 21 && !(me.qd && +me.qd.d === day)) {
      const best = fr.map(k => soc[k]).filter(x => x.qd && +x.qd.d === day && x.qd.ok).sort((a, b) => a.qd.ms - b.qd.ms)[0];
      if (best) out.push({ t: `Pytanie dnia: @${best.h} w ${sec(best.qd.ms)}`, b: 'To samo pytanie czeka na ciebie. Pobijesz ten czas?', u: '#start', g: 'qd', set: { qd: day } });
    }
  }
  // 7. przypomnienie o wybranej godzinie (teksty zmieniają się co dzień), 8. ostatni dzwonek o 21
  const pick = arr => { arr = arr.filter(Boolean); return arr[(day + hsh(p)) % arr.length]; };
  if (my && st.rd !== day && h >= H) {
    const gap = fmtN(my.g - my.td), dm = MATURA - day, nm = my.n ? String(my.n).split(' ')[0] : '', idle = my.last == null ? 0 : day - my.last;
    if (my.td >= my.g) st.rd = day;
    else if (idle >= 6 && st.pa !== my.last) out.push({ t: 'Te przypomnienia chyba nie działają', b: 'Od teraz piszę co trzy dni. Apka czeka, wracaj kiedy chcesz.', u: '#start', g: 'seria', set: { rd: day, rt: now, pa: my.last } });
    else if (idle >= 6 && idle % 3) st.rd = day;
    else out.push({ ...pick(my.st > 0 ? [
      { t: `Seria ${dni(my.st)} czeka na dziś`, b: `Do celu brakuje ${gap} XP. Jedna lekcja to ok. 5 minut.` },
      { t: `Scrollowanie poczeka. Seria ${dni(my.st)} nie`, b: `Do celu ${gap} XP. 5 minut i wracasz do filmików.` },
      { t: `${nm ? nm + ', s' : 'S'}eria ${dni(my.st)} wisi na włosku`, b: `Brakuje ${gap} XP. Jedna lekcja i po sprawie.` },
      { t: 'Matura nie przewinie się sama', b: `Seria ${dni(my.st)}, do celu ${gap} XP. Odpal jedną lekcję.` },
      dm > 0 && { t: `Do matury ${dni(dm)}`, b: `Seria ${dni(my.st)} czeka. ${gap} XP i dzień zaliczony.` },
    ] : [
      { t: 'Dzisiejszy cel czeka', b: `Do celu ${gap} XP. Jedna lekcja to ok. 5 minut.` },
      { t: `${nm ? nm + ', z' : 'Z'}acznij serię dziś`, b: 'Jedna lekcja i masz dzień 1. Reszta przyjdzie sama.' },
      dm > 0 && { t: `Do matury ${dni(dm)}`, b: 'Każdy dzień się liczy. 5 minut wystarczy na start.' },
      { t: 'Telefon w ręku? Idealny moment', b: `Jedna lekcja, ok. 5 minut. Do celu ${gap} XP.` },
    ]), u: '#start', g: 'seria', set: { rd: day, rt: now } });
  } else if (my && st.rd === day && st.rl !== day && h >= 21 && my.st >= 2 && my.td < my.g && now - (st.rt || 0) >= 2 * 36e5) {
    out.push({ ...pick([
      { t: `Ostatni dzwonek: seria ${dni(my.st)}`, b: `Do północy ${24 - h} h. Jedna lekcja ratuje serię.` },
      { t: `Seria ${dni(my.st)} zaraz przepadnie`, b: `Zostały ${24 - h} h. 5 minut przed snem i jest uratowana.` },
    ]), u: '#start', g: 'seria', set: { rl: day } });
  }
  return out.sort((a, b) => (a.g === 'seria' ? 0 : 1) - (b.g === 'seria' ? 0 : 1));
}

export async function main({ db, send, now = Date.now(), log = console.log }) {
  // klucze VAPID: powstają raz; prywatny tylko w srv/vapid (apka nie ma do niego dostępu), publiczny w cfg/push
  let v = (await db.doc('srv/vapid').get()).data();
  if (!v || !v.pub || !v.priv) { const k = webpush.generateVAPIDKeys(); v = { pub: k.publicKey, priv: k.privateKey, at: now }; await db.doc('srv/vapid').set(v); log('nowe klucze VAPID'); }
  const cfg = (await db.doc('cfg/push').get()).data();
  if (!cfg || cfg.vapid !== v.pub) await db.doc('cfg/push').set({ vapid: v.pub, at: now });
  send = send || ((sub, data) => webpush.sendNotification(sub, data, { TTL: 6 * 3600, urgency: 'normal', vapidDetails: { subject: SUBJECT, publicKey: v.pub, privateKey: v.priv } }));

  const subs = {};
  for (const d of (await db.collectionGroup('subs').get()).docs) {
    const pp = d.ref.parent && d.ref.parent.parent;
    if (!pp || !pp.parent || pp.parent.id !== 'push') continue;
    const x = d.data(); let s; try { s = JSON.parse(x.s); } catch (e) { continue; }
    if (!s || !s.endpoint) continue;
    (subs[pp.id] = subs[pp.id] || []).push({ ref: d.ref, s, h: Math.min(23, Math.max(0, +x.h || 18)), tz: x.tz || 'Europe/Warsaw' });
  }
  const people = Object.keys(subs), R = { osoby: people.length, urzadzenia: 0, wyslane: 0, usuniete: 0, bledy: 0 };
  if (!people.length) return R;
  const soc = {};
  for (const d of (await db.collection('social').get()).docs) { const x = dec(d.data()); if (x && typeof x.h === 'string' && x.h) soc[d.id] = x; }

  for (const p of people) {
    try {
      const L = subs[p]; R.urzadzenia += L.length;
      const { day, h } = local(now, L[0].tz);
      if (h >= QUIET_FROM || h < QUIET_TO) continue;
      const ref = db.doc('push/' + p), st = (await ref.get()).data() || {}, was = JSON.stringify(st);
      if (!st.c || st.c.d !== day) st.c = { d: day, n: 0 };
      let my = soc[p] ? today(soc[p], day) : null;
      if (!my) my = fromState(dec((await db.doc('data/users/' + p + '/state').get()).data()), day);
      const msgs = st.c.n < PER_DAY ? events(p, soc, st, my, { day, h, H: Math.min(...L.map(x => x.h)), now }).slice(0, Math.min(PER_RUN, PER_DAY - st.c.n)) : [];
      for (const m of msgs) {
        let ok = false;
        for (const x of L) {
          if (x.dead) continue;
          try { await send(x.s, JSON.stringify({ t: m.t, b: m.b, u: m.u, g: m.g })); ok = true; }
          catch (e) { const c = e && e.statusCode; if (c === 404 || c === 410) { x.dead = true; R.usuniete++; try { await x.ref.delete(); } catch (z) {} } else R.bledy++; }
        }
        if (ok) { R.wyslane++; st.c.n++; Object.assign(st, m.set); }
      }
      if (JSON.stringify(st) !== was) await ref.set(st);
    } catch (e) { R.bledy++; }
  }
  return R;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.FIREBASE_SA) { console.error('Brak sekretu FIREBASE_SA w ustawieniach repo (Settings, Secrets and variables, Actions).'); process.exit(1); }
  let sa; try { sa = JSON.parse(process.env.FIREBASE_SA); } catch (e) { console.error('Sekret FIREBASE_SA nie jest poprawnym JSON-em. Wklej całą zawartość pobranego pliku.'); process.exit(1); }
  admin.initializeApp({ credential: admin.credential.cert(sa) });
  const r = await main({ db: admin.firestore() });
  console.log(JSON.stringify(r));
}
