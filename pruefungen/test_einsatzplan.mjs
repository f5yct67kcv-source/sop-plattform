// Einsatzplan: das Raster entsteht aus dem Bedarf (ENT-108).
//
// Bis hierher war die Ansicht beim Oeffnen leer: Ein Einsatz sagte mit
// "bedarf", wie viele Leute er braucht, aber daraus wurde nie eine Zeile.
// Wer planen wollte, musste erst jede Position einzeln anlegen -- und eine
// bereits zugeteilte Person war im Raster ueberhaupt nicht zu sehen.
//
// Die Suite gab es vorher nicht; die Ansicht lief ungeprueft (OP-75).
import { WURZEL, HIER, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const EXE = browserPfad();
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const tag = n => iso(new Date(Date.now() + n * 864e5));
const HEUTE = tag(0), MORGEN = tag(1);
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const MA = [
  { id: 1, name: 'adrian', vorname: 'Adrian', nachname: 'von Arb', aktiv: 1, ist_admin: 1 },
  { id: 2, name: 'daniele', vorname: 'Daniele', nachname: 'Ciardo', aktiv: 1, ist_admin: 0 },
  { id: 3, name: 'hans', vorname: 'Hans', nachname: 'Meier', aktiv: 1, ist_admin: 0 },
];
const KU = [{ id: 1, name: 'Stranag', strasse: 'Kantonsstrasse', ort: '6000 Luzern' }];

// 71 — zwei Plaetze, niemand eingeteilt. Der Regelfall.
// 72 — zwei Plaetze, eine Person haengt schon dran (aus der Zeit vor den
//      Positionen, also ohne position_id).
// 73 — kein Bedarf, niemand eingeteilt: hier gibt es nichts anzulegen.
// 74 — abgeglichen und festgeschrieben (ENT-045).
// 75 — fuer die Pruefung, was passiert, wenn das Anlegen fehlschlaegt.
const bau = (id, zus) => ({ id, kunde_id: 1, kunde_name: 'Stranag', titel: null,
  strasse: 'Kantonsstrasse', ort: '6000 Luzern', einsatzart: 'Verkehrsdienst',
  datum: MORGEN, von: '07:30:00', bis: '16:30:00', bedarf: 2, status: 'geplant',
  bemerkung: null, objekt_id: null, mitarbeiter: [], ...zus });

let EINSAETZE = [
  bau(71),
  bau(72, { mitarbeiter: [{ id: 2, name: 'daniele', vorname: 'Daniele', nachname: 'Ciardo' }] }),
  bau(73, { bedarf: 0 }),
  bau(74, { datum: HEUTE, ist_status: 'offen',
            mitarbeiter: [{ id: 3, name: 'hans', vorname: 'Hans', nachname: 'Meier', ist_status: 'anwesend' }] }),
  bau(75, { kunde_name: 'Axians', bedarf: 3 }),
];

// ── Nachbau des Servers (einsatz_position.php) ────────────────────────────
// Nur so viel, wie die Ansicht sieht: die Aktionen, ihre Antwort und die
// Regel, dass aus_bedarf nur anlegt, wo noch gar nichts steht.
const POS = {};
let posSeq = 500;
// Fuer eine Pruefung wird der Server absichtlich unbrauchbar gemacht.
let kaputt = null;
const einsatzVon = id => EINSAETZE.find(e => Number(e.id) === Number(id));

function ausBedarf(e) {
  if ((POS[e.id] || []).length) return POS[e.id];
  const zug = (e.mitarbeiter || []).slice();
  const anzahl = Math.max(Number(e.bedarf) || 0, zug.length);
  POS[e.id] = Array.from({ length: anzahl }, (_, i) => {
    const m = zug[i];
    return { id: ++posSeq, nr: i + 1, funktion: e.einsatzart || null, position: null,
      von: e.von, bis: e.bis, std_verrechnung: null, pauschal: null, qualifikation: null,
      gesperrt: 0, bemerkung: null, mitarbeiter_id: m ? Number(m.id) : null,
      mitarbeiter: m ? m.name : null, vorname: m ? m.vorname : null,
      nachname: m ? m.nachname : null, zusage: null };
  });
  e.bedarf = POS[e.id].length;   // bedarf_nachfuehren()
  return POS[e.id];
}

const rufe = [];
const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
await page.route('**/api/**', route => {
  const req = route.request(), p = req.url().split('/api/')[1].split('?')[0];
  let body = null;
  try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch (e) {}
  rufe.push({ p, body });
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'adrian', ist_admin: true });
  if (p.includes('mitarbeiter_list')) return send({ status: 'ok', mitarbeiter: MA });
  if (p.includes('kunden_list')) return send({ status: 'ok', kunden: KU });
  if (p.includes('einsatz_list')) return send({ status: 'ok', einsaetze: EINSAETZE });
  if (p.includes('einsatz_position')) {
    const id = Number((body && body.einsatz_id) || req.url().split('einsatz_id=')[1] || 0);
    const e = einsatzVon(id);
    if (!body) return send({ status: 'ok', positionen: POS[id] || [] });
    if (body.aktion === 'aus_bedarf') return Number(kaputt) === id
      ? send({ status: 'error', message: 'Anlegen fehlgeschlagen.' })
      : send({ status: 'ok', positionen: ausBedarf(e) });
    if (body.aktion === 'speichern') {
      POS[id] = POS[id] || [];
      POS[id].push({ id: ++posSeq, nr: POS[id].length + 1, funktion: e.einsatzart, position: null,
        von: body.von + ':00', bis: body.bis + ':00', std_verrechnung: null, pauschal: null,
        qualifikation: null, gesperrt: 0, bemerkung: null, mitarbeiter_id: null,
        mitarbeiter: null, vorname: null, nachname: null, zusage: null });
      e.bedarf = POS[id].length;
      return send({ status: 'ok', positionen: POS[id] });
    }
    if (body.aktion === 'zuteilen') {
      const m = MA.find(x => Number(x.id) === Number(body.mitarbeiter_id));
      POS[id].forEach(q => { if (q.id === Number(body.position_id)) {
        q.mitarbeiter_id = Number(m.id); q.mitarbeiter = m.name; q.vorname = m.vorname; q.nachname = m.nachname; } });
      e.mitarbeiter = POS[id].filter(q => q.mitarbeiter_id)
        .map(q => ({ id: q.mitarbeiter_id, name: q.mitarbeiter, vorname: q.vorname, nachname: q.nachname }));
      return send({ status: 'ok', positionen: POS[id] });
    }
    if (body.aktion === 'entfernen') {
      POS[id] = (POS[id] || []).filter(q => q.id !== Number(body.id));
      e.bedarf = POS[id].length;
      return send({ status: 'ok', positionen: POS[id] });
    }
    return send({ status: 'ok', positionen: POS[id] || [] });
  }
  if (p.includes('objekt_list')) return send({ status: 'ok', objekte: [] });
  if (p.includes('masterschicht_list')) return send({ status: 'ok', masterschichten: [] });
  if (p.includes('feiertage_list')) return send({ status: 'ok', feiertage: [], gepflegt: {} });
  if (p.includes('dashboard_stats')) return send({ status: 'ok', kpi: { rapporte_monat: 0, rapporte_vormonat: 0,
    stunden_monat: 0, stunden_vormonat: 0, mitarbeiter: 3, kunden: 1, rapporte_total: 0 },
    verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [], sperr_ereignisse: [] });
  return send({ status: 'ok', einsaetze: [], rapporte: [], objekte: [], feiertage: [], gepflegt: {}, sperren: [] });
});
await page.goto(`file://${WURZEL}/dashboard.html`);
await page.fill('#gName', 'adrian'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#shell.on'); await page.waitForTimeout(500);

const zeilen = () => page.evaluate(() => document.querySelectorAll('#epRaster table.ep-gitter tbody tr').length);
const posRufe = a => rufe.filter(r => r.body && r.body.aktion === a).length;

// Der Weg in die Ansicht fuehrt ueber die Planungsliste -- epAuf() sucht den
// Einsatz im geladenen Bestand und kehrt ohne ihn wieder um.
async function oeffne(id) {
  await page.evaluate(() => { go('planung'); goTab('einsaetze'); });
  await page.waitForTimeout(400);
  await page.evaluate(i => epAuf(i), id);
  await page.waitForTimeout(700);
}

await page.evaluate(() => { go('planung'); goTab('einsaetze'); });
await page.waitForTimeout(600);

// ══════════ DAS RASTER STEHT BEIM ÖFFNEN, OHNE EINEN EINZIGEN KLICK
await oeffne(71);
check('Die Einsatzplan-Ansicht steht offen', await page.isVisible('#view-einsatzplan'));
check('KRITISCH: das Raster ist gefüllt, nicht leer', (await zeilen()) === 2);
check('KRITISCH: kein Leerzustand mehr beim Öffnen',
  !(await page.textContent('#epRaster')).includes('Noch keine Position'));
check('Die Positionen kommen aus dem Bedarf', posRufe('aus_bedarf') === 1);
// Nicht ueber den Selektor lesen: Fehlt die Zeile, wartet Playwright 30 s und
// bricht die ganze Suite ab, statt eine Pruefung rot zu melden. Ein Abbruch
// verdeckt alles, was danach kaeme.
const ersteZeile = await page.evaluate(() => {
  const tr = document.querySelector('#epRaster table.ep-gitter tbody tr');
  return tr ? tr.textContent : '';
});
check('KRITISCH: die Funktion kommt aus der Einsatzart, nicht aus einer Vorgabe',
  ersteZeile.includes('Verkehrsdienst') && !ersteZeile.includes('Ordnungsdienst'));
check('Die Position trägt die Zeit des Einsatzes', ersteZeile.includes('07:30–16:30'));
check('Beide Plätze sind zunächst offen',
  await page.evaluate(() => document.querySelectorAll('#epRaster .ep-balken.offen').length === 2));
check('Der Kopf zählt die Plätze', (await page.textContent('#epKopf')).includes('0 / 2'));
check('Die Zeitachse ist da',
  await page.evaluate(() => document.querySelectorAll('#epRaster th.uhr').length > 20));
check('Soll und Ist stehen im Kopf der Karte', /Soll/.test(await page.textContent('#epSoll')));
await page.screenshot({ path: OUT + '/84-einsatzplan-raster.png' });

// ══════════ EIN ZWEITES ÖFFNEN LEGT NICHT NOCH EINMAL AN
await oeffne(71);
check('KRITISCH: beim zweiten Öffnen entsteht keine weitere Position', (await zeilen()) === 2);
check('KRITISCH: und es geht keine zweite Anlege-Anfrage los', posRufe('aus_bedarf') === 1);

// ══════════ POSITION WÄHLEN, PERSON SETZEN
// Eingefasst: Fehlt das Raster, wartet ein Klick 30 s und bricht die Suite ab
// -- danach faende keine der uebrigen Pruefungen mehr statt. Ein Abbruch sagt
// weniger als ein Rot mit Namen.
try {
  await page.click('#epRaster table.ep-gitter tbody tr:first-child', { timeout: 4000 });
  await page.waitForTimeout(200);
  check('Die gewählte Position wird benannt', (await page.textContent('#epHinweis')).includes('Position 1'));
  await page.click('#epListe .ep-p:first-child', { timeout: 4000 });
  await page.waitForTimeout(500);
  check('KRITISCH: die Person steht auf der Position',
    (await page.evaluate(() => { const tr = document.querySelector('#epRaster table.ep-gitter tbody tr');
      return tr ? tr.textContent : ''; })).includes('Adrian'));
  check('Der Balken zählt jetzt als besetzt',
    await page.evaluate(() => document.querySelectorAll('#epRaster .ep-balken.besetzt').length === 1));
  check('Der Kopf führt die Besetzung nach', (await page.textContent('#epKopf')).includes('1 / 2'));
} catch (e) { bad.push('Zuteilen: ' + String(e).split('\n')[0].slice(0, 110)); }

// ══════════ EINE BEREITS ZUGETEILTE PERSON FÄLLT NICHT AUS DEM RASTER
// Vor den Positionen entstandene Zuteilungen tragen keine position_id. Ohne
// die Uebernahme waeren sie hier unsichtbar -- die Liste zeigte "1/2", das
// Raster zwei leere Plaetze.
await oeffne(72);
check('KRITISCH: die schon eingeteilte Person steht im Raster',
  (await page.textContent('#epRaster')).includes('Daniele'));
check('KRITISCH: sie belegt eine Position, statt danebenzustehen',
  await page.evaluate(() => document.querySelectorAll('#epRaster .ep-balken.besetzt').length === 1));
check('Der zweite Platz bleibt offen',
  await page.evaluate(() => document.querySelectorAll('#epRaster .ep-balken.offen').length === 1));
check('Der Kopf zeigt eine von zwei', (await page.textContent('#epKopf')).includes('1 / 2'));

// ══════════ OHNE BEDARF UND OHNE PERSON WIRD NICHTS ANGELEGT
const vorLeer = posRufe('aus_bedarf');
await oeffne(73);
check('KRITISCH: ohne Bedarf entsteht nichts auf Vorrat', posRufe('aus_bedarf') === vorLeer);
check('Dort steht weiterhin der Leerzustand',
  (await page.textContent('#epRaster')).includes('Noch keine Position'));
check('Und er sagt, woran es liegt',
  (await page.textContent('#epRaster')).includes('keine benötigte Anzahl'));
check('Mit einem Weg heraus', await page.isVisible('#epRaster button'));
await page.click('#epRaster button');
await page.waitForTimeout(500);
check('Der Knopf legt die erste Position an', (await zeilen()) === 1);

// ══════════ EINE FESTGESCHRIEBENE SCHICHT BLEIBT UNBERÜHRT (ENT-045)
const vorGesperrt = posRufe('aus_bedarf');
await oeffne(74);
check('KRITISCH: in einer festgeschriebenen Schicht wird nichts angelegt',
  posRufe('aus_bedarf') === vorGesperrt);
check('KRITISCH: auch keine andere schreibende Anfrage',
  rufe.filter(r => r.body && r.body.einsatz_id === 74).length === 0);
check('Der Kopf sagt, dass sie festgeschrieben ist',
  (await page.textContent('#epKopf')).includes('festgeschrieben'));
check('Das Raster erklärt den Leerzustand statt einen Knopf anzubieten',
  (await page.textContent('#epRaster')).includes('festgeschrieben')
  && !(await page.isVisible('#epRaster button')));

// ══════════ SCHLÄGT DAS ANLEGEN FEHL, STEHT TROTZDEM DER RICHTIGE EINSATZ DA
// Sonst bliebe der zuvor geoeffnete Einsatz auf dem Bildschirm -- falscher
// Kopf, fremdes Raster, kein Hinweis darauf.
await oeffne(71);
kaputt = 75;
await oeffne(75);
check('KRITISCH: nach fehlgeschlagenem Anlegen steht der geöffnete Einsatz im Kopf',
  (await page.textContent('#epKopf')).includes('Axians'));
check('KRITISCH: und nicht mehr das Raster des vorherigen Einsatzes',
  (await page.textContent('#epRaster')).includes('Noch keine Position'));
kaputt = null;

// ══════════ GESTALTUNG: GEMESSEN, NICHT NACHGELESEN
await oeffne(71);
try {
  const m = await page.evaluate(() => {
    const r = s => { const e = document.querySelector(s); if (!e) return null;
      const b = e.getBoundingClientRect(); return { t: Math.round(b.top), l: Math.round(b.left), h: Math.round(b.height) }; };
    return { kopf: r('#epKopf'), leute: r('.ep-leute'), plan: r('.ep-plan'),
             quer: document.documentElement.scrollWidth > window.innerWidth + 1 };
  });
  check('KRITISCH: der Kopf steht über dem Raster', m.kopf.t < m.plan.t);
  check('KRITISCH: die Personen stehen links vom Plan', m.leute.l < m.plan.l);
  check('Beide beginnen auf derselben Höhe', Math.abs(m.leute.t - m.plan.t) <= 2);
  check('KRITISCH: kein Querscrollen der Seite', m.quer === false);
} catch (e) { bad.push('Gestaltung: ' + String(e).split('\n')[0].slice(0, 110)); }

// Auf dem Handy stapelt sich das Raum-Raster; das Zeitraster selbst darf
// scrollen, die Seite nicht.
try {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const m = await page.evaluate(() => ({
    gestapelt: getComputedStyle(document.querySelector('.ep-raum')).gridTemplateColumns.split(' ').length === 1,
    quer: document.documentElement.scrollWidth > window.innerWidth + 1,
    scrollt: document.querySelector('.ep-scroll').scrollWidth > document.querySelector('.ep-scroll').clientWidth,
  }));
  check('KRITISCH: auf dem Handy kein Querscrollen der Seite', m.quer === false);
  check('Das Zeitraster scrollt stattdessen in sich', m.scrollt === true);
  check('Personen und Plan stehen untereinander', m.gestapelt === true);
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.waitForTimeout(250);
} catch (e) { bad.push('Handy: ' + String(e).split('\n')[0].slice(0, 110)); }

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
await browser.close();
