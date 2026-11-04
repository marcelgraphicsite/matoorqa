// matoorqa: powiadomienia push. Odpala go GitHub Actions co 30 minut (plik .github/workflows/push.yml).
// Czyta bazę kontem serwisowym z sekretu FIREBASE_SA. Logi na GitHubie są publiczne, więc wypisuje tylko liczby.
import admin from 'firebase-admin';
import webpush from 'web-push';
import { pathToFileURL } from 'node:url';

const SUBJECT = 'https://marcelgraphicsite.github.io/matoorqa/';
const DAY = 864e5;
const MATURA = Date.UTC(2027, 4, 4) / DAY;
const hsh = t => { let x = 0; for (const c of String(t)) x = (x * 31 + c.charCodeAt(0)) >>> 0; return x; };
const QUIET_FROM = 22, QUIET_TO = 8, PER_RUN = 2, PER_DAY = 9, NZ_DAY = 4;
// cel ekipy: z każdym tygodniem ligi +500 XP (tydzień 1 zaczyna się 2 listopada 2026), tak samo jak w apce
const TEAM_W0 = 2966, TEAM_STEP = 500;

const plf = (n, a, b, c) => { n = Math.abs(n); if (n === 1) return a; const d = n % 10, h = n % 100; return d >= 2 && d <= 4 && !(h >= 12 && h <= 14) ? b : c; };
const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
const dni = n => `${n} ${plf(n, 'dzień', 'dni', 'dni')}`;
const fmtN = n => String(Math.round(+n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const sec = ms => (Math.max(0, +ms || 0) / 1000).toFixed(1).replace('.', ',') + ' s';
const isDone = m => m.ok != null ? m.ok : m.td >= m.g;
const left = m => m.lf != null ? m.lf : Math.max(0, m.g - m.td);
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

// plan dnia ze stanu: cel, przedmioty (grupy) i które już zaliczone
const GRS = { pol: ['pol'], mat: ['matp', 'matr'], ang: ['angp', 'angr'], geo: ['geo'] };
const GRN = { pol: 'polski', mat: 'matma', ang: 'angielski', geo: 'geografia' };
function plan(S, day) {
  if (!S || !S.set) return null;
  const g = +S.set.goal || 60, subs = S.set.subs || [], sep = !(S.set.gsep === false || S.set.gsep === 0);
  const grs = Object.keys(GRS).filter(k => GRS[k].some(x => subs.includes(x))), x = (S.dx || {})[day] || {};
  return { g, sep: sep && grs.length > 1, grs, done: grs.filter(k => (+x[k] || 0) >= g), todo: grs.filter(k => (+x[k] || 0) < g) };
}
// zaległości: słówka z terminem na dziś, otwarte błędy, powtórki zadań z banku
function dues(S, day) {
  if (!S) return { fc: 0, mi: 0, rv: 0 };
  const fc = Object.values(S.fc || {}).filter(r => Array.isArray(r) && +r[1] <= day).length;
  const seen = new Set(); let mi = 0;
  for (const m of Array.isArray(S.mist) ? S.mist : []) { if (!m || seen.has(m.i)) continue; seen.add(m.i); if (!m.fx) mi++; }
  const rv = Object.keys(S.q || {}).filter(id => !/^(g|ai):/.test(id) && Array.isArray(S.q[id]) && +S.q[id][1] <= day).length;
  return { fc, mi, rv };
}
const mins = (n, s) => Math.max(2, Math.round(n * s / 60));
const lst = a => a.length < 2 ? (a[0] || '') : a.slice(0, -1).join(', ') + ' i ' + a[a.length - 1];

// stan dnia z dokumentu social (albo z pełnego stanu, gdy ktoś nie ma nicku)
function today(x, day) {
  const td = +x.d === day;
  return { td: td ? (+x.td || 0) : 0, st: +x.d >= day - 1 ? (+x.st || 0) : 0, g: +x.g || 60, ok: td && x.ok != null ? !!x.ok : undefined, lf: td && x.lf != null ? +x.lf : undefined, n: x.n || '', last: +x.td > 0 ? +x.d : +x.st > 0 ? +x.d - 1 : +x.d };
}
function fromState(S, day) {
  if (!S || !S.days) return null;
  const g = +(S.set && S.set.goal) || 60, fz = Array.isArray(S.fz) ? S.fz : [], sep = !(S.set && (S.set.gsep === false || S.set.gsep === 0));
  const GR = { pol: ['pol'], mat: ['matp', 'matr'], ang: ['angp', 'angr'], geo: ['geo'] }, subs = (S.set && S.set.subs) || [];
  const grs = Object.keys(GR).filter(k => GR[k].some(x => subs.includes(x)));
  const dayOk = d => { const x = (S.dx || {})[d]; if (!sep || !x || !grs.length) return (+S.days[d] || 0) >= g; return grs.every(k => (+x[k] || 0) >= g); };
  const met = d => fz.includes(d) || dayOk(d);
  const x0 = (S.dx || {})[day], lf = sep && x0 && grs.length ? grs.reduce((p, k) => p + Math.max(0, g - (+x0[k] || 0)), 0) : Math.max(0, g - (+S.days[day] || 0));
  let st = 0, d = met(day) ? day : day - 1;
  while (met(d) && st < 3650) { if (!fz.includes(d)) st++; d--; }
  const act = Object.keys(S.days).filter(k => +S.days[k] > 0).map(Number);
  return { td: +S.days[day] || 0, st, g, ok: met(day), lf, n: (S.set && S.set.name) || '', last: act.length ? Math.max(...act) : null };
}

// co wysłać jednej osobie; m.set to zmiana stanu, zapisywana dopiero po udanej wysyłce
const arr = x => Array.isArray(x) ? x : [];
// znajomi potwierdzeni z obu stron (ta sama zasada co w apce: zaproszenie + przyjęcie)
export function friendsOf(p, soc) {
  const me = soc[p]; if (!me) return [];
  const out = [];
  for (const k of new Set(arr(me.fr).concat(arr(me.rq)))) {
    const x = soc[k]; if (k === p || !x) continue;
    const iFr = arr(me.fr).includes(k), iRq = arr(me.rq).includes(k), theyFr = arr(x.fr).includes(p), theyRq = arr(x.rq).includes(p), v3 = (+x.v || 0) >= 3;
    if ((iFr && (theyFr || theyRq || !v3)) || (iRq && theyFr)) out.push(k);
  }
  return out;
}
// zespół: założyciel + osoby potwierdzone z obu stron (są u założyciela i same wskazują ten zespół)
export function teamOf(p, soc) {
  const me = soc[p]; if (!me) return null;
  const o = me.tm && me.tm.n ? p : me.tj, T = o && soc[o] && soc[o].tm && soc[o].tm.n ? soc[o].tm : null;
  if (!T || (o !== p && !arr(T.m).includes(p) && !arr(T.inv).includes(p))) return null;
  const mem = [o];
  for (const k of arr(T.m).concat(arr(T.inv))) if (!mem.includes(k) && soc[k] && soc[k].tj === o) mem.push(k);
  return { o, T, mem };
}

export function events(p, soc, st, my, ctx) {
  const { day, h, H, now, S } = ctx, F = ctx.F || 2, out = [], me = soc[p] || null, wk = weekIdx(day);
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
    if (Array.isArray(v) && +v[0] > (st.nz || 0) && now - v[0] < 12 * 36e5 && +v[0] > top) { top = +v[0]; hit = { h: soc[k].h, typ: v[1] }; }
  }
  if (hit && (!st.nzc || st.nzc.d !== day)) st.nzc = { d: day, n: 0 };
  if (hit && st.nzc.n >= NZ_DAY) { st.nz = top; hit = null; }
  if (hit) out.push(hit.typ === 'h'
      ? { t: `Piątka od @${hit.h}`, b: 'Za dzisiejszy cel. Tak trzymaj.', u: '#start', g: 'soc', set: { nz: top, nzc: { d: day, n: st.nzc.n + 1 } } }
      : { t: `@${hit.h} cię szturcha`, b: my && !isDone(my) ? `Do celu brakuje ${fmtN(left(my))} XP. Jedna lekcja i po sprawie.` : 'Ekipa się uczy. Wpadnij na jedną lekcję.', u: '#start', g: 'soc', set: { nz: top, nzc: { d: day, n: st.nzc.n + 1 } } });
  // 2b. zaproszenia: do znajomych, do zespołu, prośby o dołączenie, przyjęte zaproszenia (każde raz)
  if (me) {
    const seen = st.sq || {}; let ev = null;
    const mark = key => { const n = Object.assign({}, seen, { [key]: day }); for (const k of Object.keys(n)) if (n[k] < day - 30) delete n[k]; return n; };
    for (const k in soc) {
      if (ev) break; if (k === p) continue; const x = soc[k];
      if (arr(x.rq).includes(p) && !arr(me.fr).includes(k) && !(me.rx || {})[k] && !seen['f' + k]) ev = { t: `@${x.h} chce dodać cię do znajomych`, b: 'Przyjmij w apce, a zobaczycie się w lidze.', u: '#znajomi', g: 'soc', set: { sq: mark('f' + k) } };
      else if (x.tm && x.tm.n && arr(x.tm.inv).includes(p) && me.tj !== k && !(me.tx || {})[k] && !seen['t' + k]) ev = { t: `Zaproszenie do zespołu „${x.tm.n}”`, b: `Od @${x.h}${x.tm.sc ? ' · ' + x.tm.sc : ''}. Dołącz w apce.`, u: '#znajomi', g: 'soc', set: { sq: mark('t' + k) } };
      else if (me.tm && me.tm.n && x.tq === p && !arr(me.tm.m).includes(k) && !(me.tm.rj || {})[k] && !seen['j' + k]) ev = { t: `@${x.h} chce dołączyć do zespołu`, b: `${me.tm.n}: przyjmij albo odrzuć w apce.`, u: '#znajomi', g: 'soc', set: { sq: mark('j' + k) } };
      else if (arr(me.rq).includes(k) && arr(x.fr).includes(p) && !seen['a' + k]) ev = { t: `@${x.h} przyjmuje zaproszenie`, b: 'Jesteście znajomymi. Sprawdź, kto prowadzi w lidze.', u: '#znajomi', g: 'soc', set: { sq: mark('a' + k) } };
    }
    if (ev) out.push(ev);
  }
  // 2c. admin: nowe zdjęcia profilowe do sprawdzenia
  if (me && ctx.adm && ctx.adm === p) {
    const pend = Object.keys(soc).filter(k => k !== p && soc[k].av && soc[k].avh && (me.apv || {})[k] !== soc[k].avh && (me.rjv || {})[k] !== soc[k].avh);
    const nw = pend.filter(k => !arr(st.avq).includes(soc[k].avh));
    if (nw.length) out.push({ t: nw.length > 1 ? `${nw.length} zdjęcia do sprawdzenia` : 'Nowe zdjęcie profilowe do sprawdzenia', b: `@${soc[nw[0]].h}${nw.length > 1 ? ' i inni' : ''}. Zaakceptuj albo odrzuć w apce.`, u: '#znajomi', g: 'soc', set: { avq: [...new Set(arr(st.avq).concat(nw.map(k => soc[k].avh)))].slice(-80) } });
  }
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
  // liga: zespół (gdy ma co najmniej 2 osoby), inaczej znajomi; ekipa do pytania dnia: jedni i drudzy
  const frs = friendsOf(p, soc), TM = teamOf(p, soc), inTeam = !!(TM && TM.mem.length >= 2);
  const fr = inTeam ? TM.mem.filter(k => k !== p) : frs, crew = [...new Set(frs.concat(TM ? TM.mem.filter(k => k !== p) : []))];
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
    // 4b. niedziela 16–20: liga kończy się o północy
    if (F >= 2 && (day + 3) % 7 === 6 && h >= 16 && h <= 20 && st.lk !== wk && rows.some(r => r.xw > 0)) {
      const pos = rows.findIndex(r => r.k === p) + 1;
      if (pos === 1) { const g2 = mx - rows[1].xw, h2 = soc[rows[1].k].h;
        out.push({ t: 'Prowadzisz w lidze. Finał dziś o północy', b: g2 <= 150 ? `@${h2} traci tylko ${fmtN(g2)} XP. Jedna lekcja i masz spokój.` : `Przewaga ${fmtN(g2)} XP nad @${h2}. Utrzymaj ją do północy.`, u: '#znajomi', g: 'liga', set: { lk: wk } }); }
      else { const g2 = rows[pos - 2].xw - mx + 1;
        out.push({ t: 'Liga kończy się dziś o północy', b: `Jesteś ${pos}. Do ${pos - 1}. miejsca brakuje ${fmtN(g2)} XP${g2 <= 150 ? ', czyli jednej lekcji' : ''}.`, u: '#znajomi', g: 'liga', set: { lk: wk } }); }
    }
    // 5. cel ekipy zrobiony
    const team = [p, ...fr];
    if (team.length >= 2 && st.tg !== wk) {
      let sum = 0, tg = 0;
      for (const k of team) { sum += xw(soc[k]); tg += Math.max(20, +soc[k].g || 60) * 5; }
      tg += TEAM_STEP * Math.max(0, wk - TEAM_W0);
      if (sum >= tg) out.push({ t: inTeam ? 'Zespół dowiózł cel tygodnia' : 'Ekipa dowiozła cel tygodnia', b: `${fmtN(sum)} XP razem przy celu ${fmtN(tg)}. W przyszłym tygodniu cel rośnie o ${TEAM_STEP} XP.`, u: '#znajomi', g: 'ekipa', set: { tg: wk } });
    }
    // 6. pytanie dnia: ktoś z ekipy już odpowiedział
    if (F >= 2 && st.qd !== day && h >= 12 && h < 21 && !(me.qd && +me.qd.d === day)) {
      const best = crew.map(k => soc[k]).filter(x => x && x.qd && +x.qd.d === day && x.qd.ok).sort((a, b) => a.qd.ms - b.qd.ms)[0];
      if (best) out.push({ t: `Pytanie dnia: @${best.h} w ${sec(best.qd.ms)}`, b: 'To samo pytanie czeka na ciebie. Pobijesz ten czas?', u: '#start', g: 'qd', set: { qd: day } });
    }
  }
  // 7. przypomnienia: rano, w południe, o wybranej godzinie, dogrywka, ostatni dzwonek.
  //    F: 1 = mało (godzina + ostatni dzwonek), 2 = normalnie, 3 = dużo. Najwyżej jedno na przebieg, z odstępami.
  const pick = arr => { arr = arr.filter(Boolean); return arr[(day + hsh(p)) % arr.length]; };
  if (!st.rn || st.rn.d !== day) st.rn = { d: day, n: 0 };
  const CAP = [0, 0, 5, 6][F], room = st.rn.n < CAP, since = now - (st.lt || 0);
  const nm = my && my.n ? String(my.n).split(' ')[0] : '', dm = MATURA - day;
  const idle = my && my.last != null ? day - my.last : 99, done = my ? isDone(my) : true;
  const P = plan(S, day), gap = my ? fmtN(left(my)) : '';
  const planTxt = P && P.sep ? `${P.g} XP z każdego z ${P.grs.length} przedmiotów` : `${P ? P.g : my ? my.g : 60} XP`;
  let R = null;
  const rem = (o, set) => { const { set: s0, ...rest } = o; R = { ...rest, u: rest.u || '#start', set: { ...(s0 || {}), ...set, lt: now, rn: { d: day, n: st.rn.n + 1 } } }; };
  // 7a. o wybranej godzinie (zawsze, poza osobami, które olewają apkę)
  if (my && st.rd !== day && h >= H) {
    if (done) st.rd = day;
    else if (idle >= 6 && st.pa !== my.last) rem({ t: 'Te przypomnienia chyba nie działają', b: 'Od teraz piszę co trzy dni. Apka czeka, wracaj kiedy chcesz.', g: 'seria' }, { rd: day, rt: now, pa: my.last });
    else if (idle >= 6 && idle % 3) st.rd = day;
    else rem({ ...pick(my.st > 0 ? [
      { t: `Seria ${dni(my.st)} czeka na dziś`, b: `Do celu brakuje ${gap} XP. Jedna lekcja to ok. 5 minut.` },
      { t: `Scrollowanie poczeka. Seria ${dni(my.st)} nie`, b: `Do celu ${gap} XP. 5 minut i wracasz do filmików.` },
      { t: `${nm ? nm + ', s' : 'S'}eria ${dni(my.st)} wisi na włosku`, b: `Brakuje ${gap} XP. Zacznij od jednej lekcji.` },
      { t: 'Matura nie przewinie się sama', b: `Seria ${dni(my.st)}, do celu ${gap} XP. Odpal jedną lekcję.` },
      dm > 0 && { t: `Do matury ${dni(dm)}`, b: `Seria ${dni(my.st)} czeka. Do celu ${gap} XP.` },
    ] : [
      { t: 'Dzisiejszy cel czeka', b: `Do celu ${gap} XP. Jedna lekcja to ok. 5 minut.` },
      { t: `${nm ? nm + ', z' : 'Z'}acznij serię dziś`, b: 'Jedna lekcja i masz dzień 1. Reszta przyjdzie sama.' },
      dm > 0 && { t: `Do matury ${dni(dm)}`, b: 'Każdy dzień się liczy. 5 minut wystarczy na start.' },
      { t: 'Telefon w ręku? Idealny moment', b: `Jedna lekcja, ok. 5 minut. Do celu ${gap} XP.` },
    ]), g: 'seria' }, { rd: day, rt: now });
  }
  // 7b. rano (8–10): ważne dni przy F = 2, codziennie przy F = 3
  if (!R && room && F >= 2 && st.ra !== day && h >= 8 && h <= 10 && my && idle <= 3 && !done) {
    const MS = [200, 150, 120, 100, 90, 75, 60, 50, 45, 40, 35, 30, 25, 21, 14, 10, 7, 6, 5, 4, 3, 2, 1];
    const SM = [3, 7, 14, 21, 30, 50, 75, 100, 150, 200, 250, 300, 365];
    const c = dues(S, day);
    let o = null;
    if (dm > 0 && MS.includes(dm)) o = { t: `Do matury ${dni(dm)}`, b: dm <= 7 ? 'Ostatnia prosta. Dziś powtórki, nie nowy materiał.' : dm >= 100 ? `Brzmi jak dużo, ale każdy dzień się liczy. Plan na dziś: ${planTxt}.` : `To już blisko. Plan na dziś: ${planTxt}.` };
    else if (SM.includes(my.st) && st.ms !== my.st) o = { t: `${dni(my.st)} z rzędu`, b: `Dziś dzień ${my.st + 1}. ${my.st >= 30 ? 'To już nawyk, nie wysiłek.' : 'Nie przerywaj teraz.'}`, set: { ms: my.st } };
    else if (my.st === 0 && idle === 2) o = { t: 'Wczoraj przerwa. Dziś wracasz?', b: 'Nowa seria zaczyna się od jednej lekcji. Ok. 5 minut.' };
    else if ((day + 3) % 7 === 0 && fr.length) o = { t: 'Nowy tydzień w lidze', b: 'Wszyscy startują od zera. Pierwsza lekcja daje prowadzenie.', u: '#znajomi' };
    else if (F >= 3) o = pick([
      { t: nm ? `Dzień dobry, ${nm}` : 'Dzień dobry', b: `Plan na dziś: ${planTxt}. Rano idzie najszybciej.` },
      { t: 'Kawa i jedna lekcja?', b: `5 minut teraz i wieczór masz luźniejszy. Cel: ${planTxt}.` },
      { t: 'Zanim dzień się rozkręci', b: `Jedna lekcja rano i masz spokojniejszą głowę. Cel: ${planTxt}.` },
      c.fc >= 5 && { t: `${c.fc} ${plf(c.fc, 'słówko czeka', 'słówka czekają', 'słówek czeka')} od rana`, b: `Powtórka zajmie ok. ${mins(c.fc, 10)} min. W sam raz na drogę do szkoły.`, u: '#slowka' },
    ]);
    if (o) rem({ g: 'rano', ...o }, { ra: day });
  }
  // 7c. w południe (12 do 2 h przed wybraną godziną): powtórka z wczoraj, potem słówka, błędy, powtórki
  const mid = h >= 12 && h <= Math.min(16, H - 2);
  if (!R && room && F >= 2 && mid && S && st.rcp !== day && S.rc !== day && since >= 2 * 36e5) {
    const y = (S.al || {})[day - 1], n = Math.min(7, y && y.length ? new Set(y.map(x => x[0])).size : Object.values(S.q || {}).filter(r => Array.isArray(r) && r[4] === day - 1).length);
    if (n >= 3) { const m = Math.max(2, Math.round(n * .5)), pq = `${n} ${plf(n, 'pytanie', 'pytania', 'pytań')}`;
      rem({ ...[{ t: 'Ile zostało z wczoraj?', b: `${n} ${plf(n, 'pytanie kontrolne', 'pytania kontrolne', 'pytań kontrolnych')} z wczorajszej nauki. Ok. ${m} min.` }, { t: 'Szybki test z wczoraj', b: `${cap(pq)}, żeby nic nie uciekło. Ok. ${m} min.` }][(day + hsh(p)) % 2], g: 'recap' }, { rcp: day }); }
  }
  if (!R && room && F >= 2 && mid && S && st.pw !== day && !done && idle <= 3 && since >= 2 * 36e5 && (F >= 3 || st.rcp !== day)) {
    const c = dues(S, day);
    const o = [
      c.fc >= 5 && { m: mins(c.fc, 10), t: `${c.fc} ${plf(c.fc, 'słówko', 'słówka', 'słówek')} do powtórki`, b: `Ich termin to dziś. Ok. ${mins(c.fc, 10)} min i wracają do pamięci.`, u: '#slowka' },
      c.mi >= 3 && { m: mins(c.mi, 40), t: `${c.mi} ${plf(c.mi, 'błąd', 'błędy', 'błędów')} do poprawy`, b: `Każdy poprawiony znika z listy. Ok. ${mins(c.mi, 40)} min.` },
      c.rv >= 5 && { m: mins(c.rv, 40), t: `${c.rv} ${plf(c.rv, 'zadanie', 'zadania', 'zadań')} do powtórki`, b: `Powtórka utrwala to, co już umiesz. Ok. ${mins(Math.min(c.rv, 20), 40)} min.` },
    ].filter(Boolean).sort((a, b) => b.m - a.m)[0];
    if (o) rem({ t: o.t, b: o.b, u: o.u, g: 'powt' }, { pw: day });
  }
  // 7d. dogrywka: 2 h po przypomnieniu, najpóźniej przed 20, gdy cel dalej niezrobiony
  if (!R && room && F >= 2 && my && st.rd === day && st.r2 !== day && !done && idle <= 3 && h <= 19 && since >= 2 * 36e5) {
    let o;
    if (P && P.sep && P.done.length && P.todo.length) {
      const fem = k => k === 'mat' || k === 'geo', D = P.done, T = P.todo;
      o = { t: `${cap(lst(D.map(k => GRN[k])))} ${D.length > 1 ? 'zaliczone' : fem(D[0]) ? 'zaliczona' : 'zaliczony'}`, b: `${T.length > 1 ? 'Zostały' : fem(T[0]) ? 'Została' : 'Został'} ${lst(T.map(k => GRN[k]))}. Do pełnego celu brakuje ${gap} XP.` };
    } else if (my.td > 0) o = pick([
      { t: `Dobry start: ${fmtN(my.td)} XP dziś`, b: `Dociśnij do celu. Brakuje ${gap} XP.` },
      { t: 'Jeszcze kawałek', b: `Do dzisiejszego celu ${gap} XP. Jedna, dwie lekcje.` },
    ]);
    else o = pick([
      { t: 'Jeszcze ani jednej lekcji dziś', b: 'Dzień ucieka. Zacznij od jednej lekcji, ok. 5 minut.' },
      { t: 'Halo, matura sama się nie zda', b: `Do celu ${gap} XP. Jedna lekcja na rozgrzewkę.` },
      { t: 'To tylko 5 minut', b: 'Mniej niż jeden odcinek serialu. Odpal lekcję.' },
    ]);
    rem({ ...o, g: 'seria' }, { r2: day });
  }
  // 7e. ostatni dzwonek o 21, gdy seria trwa, a cel niezrobiony (każdy poziom)
  if (!R && my && st.rd === day && st.rl !== day && h >= 21 && my.st >= 1 && !done && since >= 1.5 * 36e5) {
    rem({ ...pick([
      { t: `Ostatni dzwonek: seria ${dni(my.st)}`, b: `Do północy ${24 - h} h. Jedna lekcja ratuje serię.` },
      { t: `Seria ${dni(my.st)} zaraz przepadnie`, b: `Zostały ${24 - h} h. 5 minut przed snem i jest uratowana.` },
      { t: `Seria ${dni(my.st)}: zostały ${24 - h} h`, b: 'Jedna lekcja przed snem i seria leci dalej.' },
    ]), g: 'seria' }, { rl: day });
  }
  if (R) out.unshift(R);
  return out;
}

export async function main({ db, send, now = Date.now(), log = console.log, test = false }) {
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
    (subs[pp.id] = subs[pp.id] || []).push({ ref: d.ref, s, h: Math.min(23, Math.max(0, +x.h || 18)), tz: x.tz || 'Europe/Warsaw', f: Math.min(3, Math.max(1, Math.round(+x.f) || 2)), at: +x.at || 0 });
  }
  const people = Object.keys(subs), R = { osoby: people.length, urzadzenia: 0, wyslane: 0, usuniete: 0, bledy: 0 };
  if (!people.length) return R;
  if (test) {
    for (const p of people) for (const x of subs[p]) {
      try { await send(x.s, JSON.stringify({ t: 'matoorqa działa', b: 'Powiadomienia dochodzą. Kliknij, żeby wejść do apki.', u: '#start', g: 'test' })); R.wyslane++; }
      catch (e) { const c = e && e.statusCode; if (c === 404 || c === 410) { R.usuniete++; try { await x.ref.delete(); } catch (z) {} } else { R.bledy++; log('błąd wysyłki: ' + (c || (e && e.message))); } }
    }
    return R;
  }
  const soc = {};
  for (const d of (await db.collection('social').get()).docs) { const x = dec(d.data()); if (x && typeof x.h === 'string' && x.h) soc[d.id] = x; }
  let adm = null; try { const kd = (await db.doc('keys/app').get()).data(); adm = kd && typeof kd.ap === 'string' ? kd.ap : null; } catch (e) {}

  for (const p of people) {
    try {
      const L = subs[p]; R.urzadzenia += L.length;
      const { day, h } = local(now, L[0].tz);
      if (h >= QUIET_FROM || h < QUIET_TO) continue;
      const ref = db.doc('push/' + p), st = (await ref.get()).data() || {}, was = JSON.stringify(st);
      if (!st.c || st.c.d !== day) st.c = { d: day, n: 0 };
      const S = dec((await db.doc('data/users/' + p + '/state').get()).data());
      let my = soc[p] ? today(soc[p], day) : null;
      if (!my) my = fromState(S, day);
      const msgs = st.c.n < PER_DAY ? events(p, soc, st, my, { day, h, H: Math.min(...L.map(x => x.h)), F: L.reduce((a, b) => b.at > a.at ? b : a).f, now, S, adm }).slice(0, Math.min(PER_RUN, PER_DAY - st.c.n)) : [];
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
  const r = await main({ db: admin.firestore(), test: process.env.TEST === '1' });
  console.log(JSON.stringify(r));
}
