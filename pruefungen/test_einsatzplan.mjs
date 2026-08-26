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
import { zeitSetzen } from './zeitfeld.mjs';

const EXE = browserPfad();
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const tag = n => iso(new Date(Date.now() + n * 864e5));
const HEUTE = tag(0), MORGEN = tag(1), FRUEHER = tag(-5);
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
// 77 — status 'abgeschlossen', aber HEUTE datiert (ENT-128: der Status
//      entscheidet, nicht mehr das Kalenderdatum) -- fuer den
//      Rechnung-Platzhalter und die Rapport-Uebersicht (ENT-127/128).
// 78 — in der Vergangenheit, aber NICHT abgeschlossen (status 'bestaetigt').
//      Genau der Fall, den ENT-126 allein am Datum falsch entschieden hätte.
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
  bau(77, { kunde_name: 'Abgeschlossen', datum: HEUTE, status: 'abgeschlossen',
            mitarbeiter: [{ id: 2, name: 'daniele', vorname: 'Daniele', nachname: 'Ciardo' }] }),
  bau(78, { kunde_name: 'Vergangen, nicht abgeschlossen', datum: FRUEHER, status: 'bestaetigt' }),
  // 79 — abgeschlossen, Rapport deckungsgleich mit dem Plan, UND diese eine
  // Zuteilung bereits abgeglichen (ENT-138): "Direkt abgleichen" darf hier
  // nicht mehr angeboten werden -- nichts mehr zu uebernehmen.
  bau(79, { kunde_name: 'Bereits abgeglichen', datum: HEUTE, status: 'abgeschlossen',
            mitarbeiter: [{ id: 2, name: 'daniele', vorname: 'Daniele', nachname: 'Ciardo', ist_status: 'anwesend' }] }),
  // 76 — drei Rückmeldungen nebeneinander: zugesagt, abgelehnt, offen aber
  //      angesehen. Genau die drei Zustände, die der Balken zeigen soll.
  bau(76, { kunde_name: 'Rückmeldungen', bedarf: 3, mitarbeiter: [
    // Der Zeitpunkt selbst wird nirgends geprüft, nur ob überhaupt einer da
    // ist. Trotzdem relativ statt fest: Ein festes Datum nahe beim heutigen
    // Tag altert und macht die Suite mit der Zeit brüchig (test_datumsfest).
    { id: 1, name: 'adrian', vorname: 'Adrian', nachname: 'von Arb', zusage: 'zugesagt', gesehen_am: tag(-1) + ' 08:00:00' },
    { id: 2, name: 'daniele', vorname: 'Daniele', nachname: 'Ciardo', zusage: 'abgelehnt', gesehen_am: tag(-1) + ' 09:00:00' },
    { id: 3, name: 'hans', vorname: 'Hans', nachname: 'Meier', zusage: 'offen', gesehen_am: null },
  ] }),
];

// Rapport zu Einsatz 77 -- fuer die Rapport-Uebersicht am abgeschlossenen
// Einsatz (ENT-128).
const RAPPORTE = [
  { id: 900, einsatz_id: 77, mitarbeiter_id: 2, mitarbeiter: 'daniele',
    von: '07:00:00', bis: '15:00:00', pause_min: 30, netto_h: 7.5,
    bemerkung: 'Alles ruhig, keine besonderen Vorkommnisse.', erfasst_am: HEUTE + ' 15:10:00' },
  // Zu Einsatz 79 (ENT-138): Zeiten decken sich exakt mit dem Plan (07:30–16:30) --
  // bewusst KEINE Abweichung, damit dieser Testfall nur die Sperre prueft.
  { id: 901, einsatz_id: 79, mitarbeiter_id: 2, mitarbeiter: 'daniele',
    von: '07:30:00', bis: '16:30:00', pause_min: 30, netto_h: 8.5,
    bemerkung: null, erfasst_am: HEUTE + ' 16:40:00' },
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
      nachname: m ? m.nachname : null, zusage: m ? (m.zusage || 'offen') : null,
      gesehen_am: m ? (m.gesehen_am || null) : null };
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
      const vorhanden = body.id ? POS[id].find(q => q.id === Number(body.id)) : null;
      if (vorhanden) {
        // Der Server schreibt alle Felder, die er bekommt -- der Nachbau auch,
        // sonst bliebe unbemerkt, dass die Oberflaeche eines vergisst.
        ['funktion', 'position', 'qualifikation'].forEach(f => { vorhanden[f] = body[f] || null; });
        vorhanden.von = body.von + ':00';
        vorhanden.bis = body.bis + ':00';
        vorhanden.std_verrechnung = body.std_verrechnung == null ? null : Number(body.std_verrechnung);
        vorhanden.pauschal = body.pauschal == null ? null : Number(body.pauschal);
      } else {
        POS[id].push({ id: ++posSeq, nr: POS[id].length + 1, funktion: e.einsatzart, position: null,
          von: body.von + ':00', bis: body.bis + ':00', std_verrechnung: null, pauschal: null,
          qualifikation: null, gesperrt: 0, bemerkung: null, mitarbeiter_id: null,
          mitarbeiter: null, vorname: null, nachname: null, zusage: null });
      }
      e.bedarf = POS[id].length;
      return send({ status: 'ok', positionen: POS[id] });
    }
    if (body.aktion === 'klonen') {
      const q = POS[id].find(x => x.id === Number(body.id));
      POS[id].push({ ...q, id: ++posSeq, nr: POS[id].length + 1,
        mitarbeiter_id: null, mitarbeiter: null, vorname: null, nachname: null });
      e.bedarf = POS[id].length;
      return send({ status: 'ok', positionen: POS[id] });
    }
    if (body.aktion === 'loesen') {
      POS[id].forEach(q => { if (q.id === Number(body.position_id)) {
        q.mitarbeiter_id = null; q.mitarbeiter = null; q.vorname = null; q.nachname = null; } });
      e.mitarbeiter = POS[id].filter(q => q.mitarbeiter_id)
        .map(q => ({ id: q.mitarbeiter_id, name: q.mitarbeiter, vorname: q.vorname, nachname: q.nachname }));
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
  if (p.includes('einsatz_save')) {
    // Der echte Endpunkt schreibt den ganzen Satz. Der Nachbau auch -- sonst
    // bliebe unbemerkt, dass die Oberfläche ein Feld vergisst oder eines
    // zurücksetzt, das sie mitschicken müsste.
    const e = einsatzVon(body.id);
    if (e) {
      e.bemerkung = body.bemerkung || null;
      e.von = String(body.von).slice(0, 5) + ':00';
      e.bis = String(body.bis).slice(0, 5) + ':00';
      e.bedarf = Number(body.bedarf);
      e.status = body.status;
    }
    return send({ status: 'ok', id: body.id });
  }
  if (p.includes('rapport_list')) return send({ status: 'ok', rapporte: RAPPORTE });
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

// ══════════ SPALTE "VERRECHNUNG" ENTFERNT, ZEIT BETONT, LEGENDE (ENT-139)
// Der Projektinhaber, per Foto des Schichten-Rasters: die Verrechnung-Spalte
// weg fuer mehr Platz und mehr Praesenz der Schichtzeiten, dazu eine
// horizontale Legende unter der letzten Schicht, die Symbole und Farben
// erklaert -- Orientierungshilfe fuer einen neuen Planer.
check('KRITISCH: die Spalte "Verrechnung" ist aus dem Rasterkopf verschwunden',
  !(await page.textContent('#epRaster table.ep-gitter thead')).includes('Verrechnung'));
check('KRITISCH: die Schichtzeit ist hervorgehoben (fett), nicht mehr gewoehnlicher Text',
  await page.evaluate(() => {
    const b = document.querySelector('#epRaster table.ep-gitter tbody tr td:nth-child(4) b');
    return !!b && parseInt(getComputedStyle(b).fontWeight, 10) >= 700;
  }));
check('KRITISCH: die Legende steht unter der Tabelle, mit allen fuenf Erklaerungen',
  await page.evaluate(() => {
    const texte = [...document.querySelectorAll('#epRaster .ep-legende .ep-lg-item')].map(x => x.textContent.trim());
    return texte.length === 5
      && texte.some(t => t === 'Offen')
      && texte.some(t => t.includes('keine Rückmeldung'))
      && texte.some(t => t === 'Zugesagt')
      && texte.some(t => t === 'Abgelehnt')
      && texte.some(t => t.includes('in der App angesehen'));
  }));
check('KRITISCH: das Augen-Symbol steht in der Legende (dasselbe Symbol wie im Balken)',
  await page.evaluate(() => !!document.querySelector('#epRaster .ep-legende .ep-lg-item .ep-auge')));
// Am gerenderten Zustand gemessen, nicht angenommen (CLAUDE.md, Gestaltung):
// die Legendenfarben muessen mit den tatsaechlichen Balkenfarben uebereinstimmen,
// nicht nur eine eigene, unabhaengig gepflegte Farbe zeigen, die zufaellig
// aehnlich aussieht.
check('KRITISCH: jede Legendenfarbe stimmt mit der echten Balkenfarbe exakt ueberein',
  await page.evaluate(() => {
    const pruefen = klasse => {
      const balken = document.createElement('div'); balken.className = 'ep-balken ' + klasse;
      const swatch = document.createElement('i'); swatch.className = 'ep-lg-swatch ' + klasse;
      document.body.append(balken, swatch);
      const gleich = getComputedStyle(balken).backgroundColor === getComputedStyle(swatch).backgroundColor;
      balken.remove(); swatch.remove();
      return gleich;
    };
    return ['offen', 'besetzt', 'zugesagt', 'abgelehnt'].every(pruefen);
  }));

// ══════════ EIN ZWEITES ÖFFNEN LEGT NICHT NOCH EINMAL AN
await oeffne(71);
check('KRITISCH: beim zweiten Öffnen entsteht keine weitere Position', (await zeilen()) === 2);
check('KRITISCH: und es geht keine zweite Anlege-Anfrage los', posRufe('aus_bedarf') === 1);

// ══════════ POSITION WÄHLEN, PERSON SETZEN
// Eingefasst: Fehlt das Raster, wartet ein Klick 30 s und bricht die Suite ab
// -- danach faende keine der uebrigen Pruefungen mehr statt. Ein Abbruch sagt
// weniger als ein Rot mit Namen.
try {
  // Gezielt die Funktions-Zelle statt der Zeilenmitte: Die Mitte der Zeile
  // liegt im Balken, und dort sitzt der ×-Knopf.
  await page.click('#epRaster table.ep-gitter tbody tr:first-child td.fest:nth-child(2)', { timeout: 4000 });
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

// ══════════ RECHNUNG-PLATZHALTER NUR BEI STATUS "ABGESCHLOSSEN" (ENT-127/128)
// Ausdruecklich noch ohne Funktion (ENT-040) -- nur der Knopf, ausgegraut.
// Massgeblich ist seit ENT-128 der STATUS, nicht mehr das Kalenderdatum.
await oeffne(71);   // MORGEN, status 'geplant'
check('KRITISCH: kein Rechnung-Knopf bei einem kuenftigen Einsatz',
  !(await page.textContent('#epKopf')).includes('Rechnung erstellen'));
await oeffne(78);   // FRUEHER, aber status 'bestaetigt' -- die Vergangenheit allein reicht seit ENT-128 nicht
check('KRITISCH: kein Rechnung-Knopf bei einem vergangenen, aber nicht abgeschlossenen Einsatz',
  !(await page.textContent('#epKopf')).includes('Rechnung erstellen'));
await oeffne(77);   // HEUTE, aber status 'abgeschlossen'
check('KRITISCH: bei status "abgeschlossen" erscheint der Rechnung-Knopf, auch am selben Tag',
  (await page.textContent('#epKopf')).includes('Rechnung erstellen'));
check('KRITISCH: er ist ausgegraut, keine echte Funktion',
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('#epKopf button')].find(b => b.textContent.includes('Rechnung erstellen'));
    return !!btn && btn.disabled && /noch nicht verfügbar/i.test(btn.title);
  }));
// Am gerenderten Zustand gemessen (ENT-130, CLAUDE.md "Gestaltung"): ein
// Knopf ohne Rahmen und ohne Hintergrund ist nicht als Knopf zu erkennen --
// genau das war beruits gemeldet worden. border-style/background-color
// muessen tatsaechlich sichtbar sein, nicht nur "nicht transparent" im
// Sinne der reinen CSS-Eigenschaft.
check('Der Knopf ist optisch als Knopf erkennbar (Rahmen oder Hintergrund), nicht wie Fliesstext',
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('#epKopf button')].find(b => b.textContent.includes('Rechnung erstellen'));
    if (!btn) return false;
    const s = getComputedStyle(btn);
    // .btn selbst setzt bereits "border: 1px solid transparent" -- border-style
    // ist darum IMMER "solid", auch ganz ohne sichtbaren Rahmen. Massgeblich
    // ist die FARBE, nicht ob ueberhaupt ein Style gesetzt ist.
    const transparent = c => c === 'transparent' || c === 'rgba(0, 0, 0, 0)';
    return !transparent(s.borderColor) || !transparent(s.backgroundColor);
  }));
check('Und zusaetzlich sichtbar gedaempft (Opacity < 1), nicht nur per cursor',
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('#epKopf button')].find(b => b.textContent.includes('Rechnung erstellen'));
    return !!btn && parseFloat(getComputedStyle(btn).opacity) < 1;
  }));

// ══════════ ANORDNUNG UND FARBE DES ABSCHLUSS-BEREICHS (ENT-150)
// Der Projektinhaber: Dokumente sollen neben den Rapport, damit der
// Abschnitt schmaler wird; der Rechnungs-Knopf blau und nach rechts; die
// beiden Rapport-Knoepfe sollen sich farblich besser abheben. Alles am
// gerenderten Zustand gemessen (CLAUDE.md „Gestaltung“) -- eine Rasterregel
// kann wirkungslos bleiben, ohne dass etwas kaputtgeht.
const zone = await page.evaluate(() => {
  const rap = document.querySelector('#epKopf .ep-zone .ep-zone-teil:first-child');
  const dok = document.querySelector('#epKopf .ep-zone .ep-zone-teil:last-child');
  const rBtn = [...document.querySelectorAll('#epKopf button')].find(b => b.textContent.includes('Rechnung erstellen'));
  const zoneEl = document.querySelector('#epKopf .ep-zone');
  if (!rap || !dok || !rBtn || !zoneEl) { return null; }
  const r = el => el.getBoundingClientRect();
  return {
    zweiTeile: rap !== dok,
    rapRechts: r(rap).right, dokLinks: r(dok).left,
    rapOben: r(rap).top, dokOben: r(dok).top,
    zoneRechts: r(zoneEl).right, zoneLinks: r(zoneEl).left,
    rBtnRechts: r(rBtn).right, rBtnUnten: r(rBtn).bottom,
    zoneUnten: r(zoneEl).bottom,
    dokText: dok.textContent, rapText: rap.textContent,
  };
});
check('KRITISCH: Rapport und Dokumente stehen NEBENEINANDER, nicht mehr untereinander',
  !!zone && zone.zweiTeile && zone.dokLinks >= zone.rapRechts - 1);
check('Und zwar auf gleicher Hoehe beginnend — nicht versetzt',
  !!zone && Math.abs(zone.rapOben - zone.dokOben) < 2);
check('Die linke Spalte traegt den Rapport, die rechte die Dokumente',
  !!zone && /Rapport/.test(zone.rapText) && /Dokumente/.test(zone.dokText));
check('KRITISCH: der Rechnungs-Knopf steht rechts, nicht links am Spaltenanfang',
  !!zone && (zone.rBtnRechts > zone.zoneLinks + (zone.zoneRechts - zone.zoneLinks) / 2));
check('KRITISCH: und unterhalb beider Spalten, nicht in einer davon',
  !!zone && zone.rBtnUnten > zone.zoneUnten);
// Blau heisst hier: dieselbe Farbe, die eine isolierte Sonde mit
// var(--accent) liefert -- nicht "irgendeine" Farbe.
check('KRITISCH: der Rechnungs-Knopf ist blau (--accent), wie ausdruecklich verlangt',
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('#epKopf button')].find(b => b.textContent.includes('Rechnung erstellen'));
    const sonde = document.createElement('div');
    sonde.style.background = 'var(--accent)';
    document.body.appendChild(sonde);
    const erwartet = getComputedStyle(sonde).backgroundColor;
    sonde.remove();
    return !!btn && getComputedStyle(btn).backgroundColor === erwartet;
  }));
check('KRITISCH: er bleibt trotz Blau ausgegraut — er hat weiterhin keine Funktion (ENT-040/127)',
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('#epKopf button')].find(b => b.textContent.includes('Rechnung erstellen'));
    return !!btn && btn.disabled && parseFloat(getComputedStyle(btn).opacity) < 1;
  }));
// Die beiden Rapport-Knoepfe: beide muessen als Knopf erkennbar sein (Rahmen
// ODER Flaeche) und sich VONEINANDER unterscheiden -- vorher war einer davon
// btn-quiet, also ganz ohne beides.
const rapKnoepfe = await page.evaluate(() => {
  const btn = t => [...document.querySelectorAll('#epKopf button')].find(b => b.textContent.includes(t));
  const a = btn('Rapport ansehen'), d = btn('Direkt abgleichen');
  if (!a || !d) { return null; }
  const transparent = c => c === 'transparent' || c === 'rgba(0, 0, 0, 0)';
  const lies = el => { const s = getComputedStyle(el);
    return { bg: s.backgroundColor, rand: s.borderColor, farbe: s.color,
      sichtbar: !transparent(s.backgroundColor) || !transparent(s.borderColor) }; };
  return { a: lies(a), d: lies(d) };
});
check('KRITISCH: "Rapport ansehen" ist als Knopf erkennbar (Rahmen oder Fläche), nicht wie Fliesstext',
  !!rapKnoepfe && rapKnoepfe.a.sichtbar);
check('KRITISCH: "Direkt abgleichen" ebenfalls', !!rapKnoepfe && rapKnoepfe.d.sichtbar);
check('KRITISCH: die beiden unterscheiden sich sichtbar voneinander — sie sind nicht dieselbe Handlung',
  !!rapKnoepfe && (rapKnoepfe.a.bg !== rapKnoepfe.d.bg
    || rapKnoepfe.a.rand !== rapKnoepfe.d.rand || rapKnoepfe.a.farbe !== rapKnoepfe.d.farbe));

// ══════════ RAPPORT-ÜBERSICHT AM ABGESCHLOSSENEN EINSATZ (ENT-128)
const kopf77 = await page.textContent('#epKopf');
check('KRITISCH: der Rapport erscheint im Kopf des abgeschlossenen Einsatzes',
  kopf77.includes('07:00') && kopf77.includes('15:00'));
check('Die Person steht dabei', kopf77.includes('Daniele Ciardo'));
check('Die Bemerkung aus dem Rapport ist zu lesen', kopf77.includes('Alles ruhig'));
check('Die Pause ist ausgewiesen', kopf77.includes('30'));

// ══════════ ABWEICHUNGSWARNUNG, RAPPORT ANSEHEN, DIREKT ABGLEICHEN (ENT-138)
// Der Projektinhaber: der Rapport hat oft abweichende, finale Zeiten -- das
// System soll die Abweichung erkennen und den Planer sichtbar warnen, sowie
// direkt aus dem Einsatzplan heraus mit dem Rapport abgleichen lassen.
check('KRITISCH: eine vom Plan abweichende Rapportzeit wird als Warnung angezeigt',
  kopf77.includes('⚠️') && kopf77.includes('Rapport weicht ab')
  && kopf77.includes('07:30 → 07:00') && kopf77.includes('16:30 → 15:00'));
check('KRITISCH: "Rapport ansehen" fuehrt zum bestehenden Rapport-Betrachter (openDrawer)',
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('#epKopf button')].find(b => b.textContent.includes('Rapport ansehen'));
    return !!btn && btn.getAttribute('onclick') === 'openDrawer(900)';
  }));
await page.evaluate(() => [...document.querySelectorAll('#epKopf button')]
  .find(b => b.textContent.includes('Rapport ansehen')).click());
await page.waitForTimeout(300);
check('KRITISCH: der Rapport-Betrachter zeigt tatsaechlich diesen Rapport',
  (await page.textContent('#drBody')).includes('Alles ruhig'));
await page.evaluate(() => closeDrawer());
await page.waitForTimeout(200);

check('KRITISCH: "Direkt abgleichen" ist vorhanden und zielt auf genau diese Zuteilung',
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('#epKopf button')].find(b => b.textContent.includes('Direkt abgleichen'));
    return !!btn && btn.getAttribute('onclick') === 'epDirektAbgleichen(77,2)';
  }));
await page.evaluate(() => [...document.querySelectorAll('#epKopf button')]
  .find(b => b.textContent.includes('Direkt abgleichen')).click());
await page.waitForTimeout(300);
check('KRITISCH: der Abgleich oeffnet sich vorbefuellt mit den Rapportzeiten',
  (await page.inputValue('#agdVon')) === '07:00' && (await page.inputValue('#agdBis')) === '15:00');
check('KRITISCH: der Status wird auf "anwesend" vorbefuellt, nicht auf die erste Option',
  (await page.$eval('#agdStatus', el => el.value)) === 'anwesend');
check('Noch nichts gespeichert -- der Planer muss selbst bestaetigen (Q2-Entscheid)',
  !rufe.some(r => r.p.includes('einsatz_abgleich')));
await page.evaluate(() => closeDrawer());
await page.waitForTimeout(200);

// Gegenprobe zur Sperre: dieselbe Konstellation, aber die Zuteilung ist
// bereits abgeglichen -- der Knopf darf dann nicht mehr angeboten werden.
await oeffne(79);
const kopf79 = await page.textContent('#epKopf');
check('KRITISCH: bei einer bereits abgeglichenen Zuteilung fehlt "Direkt abgleichen"',
  !kopf79.includes('Direkt abgleichen'));
check('"Rapport ansehen" bleibt trotzdem verfuegbar -- ansehen ist keine Aenderung',
  kopf79.includes('Rapport ansehen'));
check('Keine Abweichungswarnung, wenn der Rapport dem Plan entspricht',
  !kopf79.includes('⚠️'));

await oeffne(78);   // vergangen, aber nicht abgeschlossen, kein Rapport in der Fixture
check('KRITISCH: ohne Status "abgeschlossen" erscheint keine Rapport-Übersicht',
  !(await page.textContent('#epKopf')).includes('Rapport'));

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

// ══════════ KOPFBEREICH: BESCHRIFTUNG OBEN, WERT DARUNTER (ENT-109)
// Vorher lief beides im selben Fluss und las sich als "Nummer75".
// Gemessen statt im Quelltext nachgelesen: Eine Regel kann wirkungslos
// bleiben, ohne dass etwas kaputtgeht.
await oeffne(71);
try {
  const m = await page.evaluate(() => {
    const f = document.querySelector('#epKopf .ep-kf');
    const l = f.querySelector('span').getBoundingClientRect();
    const w = f.querySelector('b').getBoundingClientRect();
    return { lb: Math.round(l.bottom), wt: Math.round(w.top), lx: Math.round(l.left), wx: Math.round(w.left),
             felder: document.querySelectorAll('#epKopf .ep-kf').length };
  });
  check('KRITISCH: die Beschriftung steht über dem Wert, nicht daneben', m.lb <= m.wt);
  check('KRITISCH: beide beginnen an derselben Kante', m.lx === m.wx);
  check('Alle zwölf Angaben stehen im Kopf', m.felder === 12);
} catch (e) { bad.push('Kopf: ' + String(e).split('\n')[0].slice(0, 110)); }
check('Strasse und Ort stehen als eine Angabe untereinander',
  await page.evaluate(() => !!document.querySelector('#epKopf .ep-kf b small')));

// ══════════ DER KNOPF STEHT BEI DEM, WAS ER VERÄNDERT (ENT-109)
check('„Neue Schicht" steht im Kopf der Schichten-Karte',
  await page.evaluate(() => !!document.querySelector('.ep-plan-kopf button')));
check('Und nicht mehr in der obersten Leiste',
  await page.evaluate(() => ![...document.querySelectorAll('#view-einsatzplan .bar-tools button')]
    .some(b => /Neue Schicht|Position hinzuf/.test(b.textContent))));

// ══════════ EINE EINZELNE SCHICHT BEARBEITEN
// Der eigentliche Anlass: Nicht jede Person arbeitet den ganzen Einsatz --
// eine Pausenablösung dauert zwei Stunden.
const balkenBreite = () => page.evaluate(() =>
  Math.round(document.querySelectorAll('#epRaster .ep-balken')[1].getBoundingClientRect().width));
const vorher = await balkenBreite();
await page.click('#epRaster table.ep-gitter tbody tr:nth-child(2) .ep-werk button[title="Schicht bearbeiten"]');
await page.waitForTimeout(300);
check('Der Schicht-Dialog geht auf', await page.isVisible('#dlgSchicht.on'));
check('Er nennt die Schicht', (await page.textContent('#epsTitel')).includes('Schicht 2'));
check('Er nennt das Zeitfenster des Einsatzes',
  (await page.textContent('#epsFenster')).includes('07:30–16:30'));
check('Die heutige Zeit steht vorbefüllt drin', (await page.inputValue('#eps_von')) === '07:30');

// Beginn vor dem Einsatz wird abgefangen -- sonst zeichnet das Raster den
// Balken bei 23,5 Stunden statt eine halbe Stunde davor.
await zeitSetzen(page, '#eps_von', '07:00');
await zeitSetzen(page, '#eps_bis', '13:00');
const vorFalsch = posRufe('speichern');
await page.click('#epsBtn');
await page.waitForTimeout(300);
// Auf den WORTLAUT prüfen, nicht nur darauf, dass irgendeine Meldung steht:
// 07:00-13:00 verletzt beide Regeln zugleich (Beginn ausserhalb UND, weil
// 07:00 als Folgetag gerechnet wird, Ende vor Beginn). Eine Prüfung auf
// „irgendein Fehler" wäre auch dann grün, wenn genau die Fensterprüfung fehlt.
check('KRITISCH: ein Beginn vor dem Einsatz wird abgefangen',
  (await page.textContent('#epsErr')).includes('ausserhalb des Einsatzes'));
check('KRITISCH: und geht gar nicht erst an den Server', posRufe('speichern') === vorFalsch);
check('Der Dialog bleibt dafür offen', await page.isVisible('#dlgSchicht.on'));

// Ende vor Beginn ebenso.
await zeitSetzen(page, '#eps_von', '13:00');
await zeitSetzen(page, '#eps_bis', '11:00');
await page.click('#epsBtn');
await page.waitForTimeout(300);
check('Ein Ende vor dem Beginn wird abgefangen',
  (await page.textContent('#epsErr')).includes('nach dem Beginn'));

// Stundenansatz UND Pauschale zugleich ergibt keinen Sinn.
await zeitSetzen(page, '#eps_von', '11:00');
await zeitSetzen(page, '#eps_bis', '13:00');
await page.fill('#eps_std', '38');
await page.fill('#eps_pauschal', '200');
await page.click('#epsBtn');
await page.waitForTimeout(250);
check('Stundenansatz und Pauschale zugleich werden abgefangen',
  (await page.textContent('#epsErr')).includes('nicht beides'));
await page.fill('#eps_pauschal', '');

// Jetzt der gültige Fall: die Pausenablösung.
await page.fill('#eps_position', 'Pausenablösung');
await page.click('#epsBtn');
await page.waitForTimeout(600);
check('Der Dialog schliesst nach dem Speichern', !(await page.isVisible('#dlgSchicht.on')));
check('KRITISCH: die Schicht trägt die neue Zeit',
  (await page.textContent('#epRaster')).includes('11:00–13:00'));
check('Die Bezeichnung steht in der Zeile', (await page.textContent('#epRaster')).includes('Pausenablösung'));
// Die Verrechnung-Spalte im Raster ist mit ENT-139 bewusst entfernt (mehr
// Platz fuer die Schichtzeiten) -- der Wert bleibt trotzdem gespeichert und
// im Bearbeiten-Dialog abrufbar, nur nicht mehr in der Zeile selbst sichtbar.
check('KRITISCH: der Stundenansatz steht NICHT mehr in der Raster-Zeile (ENT-139)',
  !(await page.textContent('#epRaster')).includes('38.00 CHF'));
check('KRITISCH: der Balken ist kürzer als vorher — gemessen', (await balkenBreite()) < vorher * 0.5);
await page.click('#epRaster table.ep-gitter tbody tr:nth-child(2) .ep-werk button[title="Schicht bearbeiten"]');
await page.waitForSelector('#dlgSchicht.on');
check('Der Stundenansatz bleibt aber gespeichert und im Bearbeiten-Dialog sichtbar',
  (await page.inputValue('#eps_std')) === '38');
await page.click('#dlgSchicht .btn-plain');
await page.waitForTimeout(200);
await page.screenshot({ path: OUT + '/85-schicht-bearbeitet.png' });

// ══════════ WARNUNG, WENN DIE SCHICHT ÜBER DEN EINSATZ HINAUSLÄUFT (ENT-111)
// Erlaubt ist es -- verhindert wird nichts. Es soll nur auffallen, solange
// sich ein Verklicken noch folgenlos zurücknehmen lässt.
await page.click('#epRaster table.ep-gitter tbody tr:first-child .ep-werk button[title="Schicht bearbeiten"]');
await page.waitForTimeout(350);
check('Ohne Überhang steht keine Warnung da', !(await page.isVisible('#epsUeber')));
await zeitSetzen(page, '#eps_bis', '19:30');
await page.waitForTimeout(250);
check('KRITISCH: ein Überhang wird sofort gemeldet', await page.isVisible('#epsUeber'));
const warnTxt = await page.textContent('#epsUeber');
check('KRITISCH: die Warnung nennt die Dauer des Überhangs', warnTxt.includes('3 h'));
check('Und die beiden Zeiten', warnTxt.includes('16:30') && warnTxt.includes('19:30'));
check('KRITISCH: gespeichert werden darf trotzdem — es ist kein Fehler',
  !(await page.isVisible('#epsErr')));
// Zurück ins Fenster: die Warnung muss wieder verschwinden.
await zeitSetzen(page, '#eps_bis', '16:30');
await page.waitForTimeout(250);
check('KRITISCH: zurück im Fenster verschwindet die Warnung', !(await page.isVisible('#epsUeber')));
// Jetzt bewusst mit Überhang speichern -- seit ENT-112 mit Rückfrage.
await zeitSetzen(page, '#eps_bis', '19:30');
await page.waitForTimeout(200);
await page.click('#epsBtn');
await page.waitForTimeout(400);
const rueckfrageDa = await page.isVisible('#dlgUeberhang.on');
check('KRITISCH: beim Speichern kommt eine Rückfrage', rueckfrageDa);
// Ohne Rückfrage hat der Rest dieses Blocks kein Ziel -- dann liefe jeder
// Klick 30 s ins Leere und risse die ganze Suite mit. Ein benanntes Rot
// sagt mehr als ein Abbruch.
if (!rueckfrageDa) { bad.push('Rückfrage fehlt — der Überhang-Block wurde übersprungen'); }
else {
check('Sie nennt die Dauer und beide Zeiten',
  (await page.textContent('#epuText')).includes('3 h')
  && (await page.textContent('#epuText')).includes('16:30')
  && (await page.textContent('#epuText')).includes('19:30'));
check('Der Verlängern-Knopf nennt die Zeit',
  (await page.textContent('#epuVerlaengern')).includes('19:30'));
// Zurück: nichts gespeichert, der Schicht-Dialog steht noch offen.
const vorZurueck = posRufe('speichern');
await page.click('#dlgUeberhang .btn-plain');
await page.waitForTimeout(300);
check('KRITISCH: „Zurück" speichert nichts', posRufe('speichern') === vorZurueck);
check('Und der Schicht-Dialog bleibt offen', await page.isVisible('#dlgSchicht.on'));
check('Die Eingabe steht noch da', (await page.inputValue('#eps_bis')) === '19:30');
// Diesmal: nur die Schicht, Einsatz unverändert.
await page.click('#epsBtn');
await page.waitForTimeout(400);
const vorNur = rufe.filter(r => r.p.includes('einsatz_save')).length;
await page.click('#epuNur');
await page.waitForTimeout(800);
check('Der Überhang lässt sich speichern', !(await page.isVisible('#dlgSchicht.on')));
check('KRITISCH: „Nur die Schicht" lässt den Einsatz unangetastet',
  rufe.filter(r => r.p.includes('einsatz_save')).length === vorNur);
check('Der Einsatz endet weiterhin um 16:30',
  (await page.textContent('#epKopf')).includes('07:30–16:30'));
}
check('KRITISCH: der Balken ist im Raster als Überhang gekennzeichnet',
  await page.evaluate(() => document.querySelectorAll('#epRaster .ep-balken.ueber').length === 1));
check('Und sagt beim Überfahren, wie weit',
  await page.evaluate(() => {
    const b = document.querySelector('#epRaster .ep-balken.ueber');
    return !!b && (b.getAttribute('title') || '').includes('nach dem Einsatz');
  }));

// ══════════ DER ZWEITE WEG: DEN EINSATZ MITVERLÄNGERN (ENT-112)
// Eingefasst: Bleibt die Rückfrage aus, liefe der Klick 30 s ins Leere und
// risse die Suite mit, statt eine Prüfung rot zu melden.
try {
await page.click('#epRaster table.ep-gitter tbody tr:first-child .ep-werk button[title="Schicht bearbeiten"]', { timeout: 4000 });
await page.waitForTimeout(300);
await zeitSetzen(page, '#eps_bis', '18:00');
await page.click('#epsBtn');
await page.waitForTimeout(400);
await page.click('#epuVerlaengern', { timeout: 4000 });
await page.waitForTimeout(900);
check('KRITISCH: der Einsatz wurde bis zur Schicht verlängert',
  rufe.some(r => r.p.includes('einsatz_save') && r.body && r.body.bis === '18:00'));
check('KRITISCH: der Bedarf wird dabei nicht zurückgesetzt',
  rufe.filter(r => r.p.includes('einsatz_save')).every(r => Number(r.body.bedarf) >= 1));
check('KRITISCH: der Kopf zeigt die neue Einsatzzeit',
  (await page.textContent('#epKopf')).includes('07:30–18:00'));
check('KRITISCH: danach ragt keine Schicht mehr über den Einsatz hinaus',
  await page.evaluate(() => document.querySelectorAll('#epRaster .ep-balken.ueber').length === 0));
} catch (e) { bad.push('Verlängern: ' + String(e).split('\n')[0].slice(0, 110)); }
await page.screenshot({ path: OUT + '/87-ueberhang.png' });
// Wieder zurücksetzen, damit die folgenden Prüfungen auf bekanntem Stand stehen.
await page.click('#epRaster table.ep-gitter tbody tr:first-child .ep-werk button[title="Schicht bearbeiten"]');
await page.waitForTimeout(300);
await zeitSetzen(page, '#eps_bis', '16:30');
await page.click('#epsBtn');
await page.waitForTimeout(700);
check('Nach dem Zurücksetzen ist kein Balken mehr gekennzeichnet',
  await page.evaluate(() => document.querySelectorAll('#epRaster .ep-balken.ueber').length === 0));

// ══════════ DEN DIALOG BEISEITESCHIEBEN (ENT-111)
// Zweck: eine Zahl aus dem Hintergrund lesen, ohne den Dialog zu schliessen
// und die Eingabe zu verlieren.
try {
  await page.click('#epRaster table.ep-gitter tbody tr:first-child .ep-werk button[title="Schicht bearbeiten"]');
  await page.waitForTimeout(300);
  const vor = await page.evaluate(() => {
    const r = document.querySelector('#dlgSchicht .dlg').getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top) };
  });
  const kopf = await page.evaluate(() => {
    const r = document.querySelector('#dlgSchicht .dlg-hd').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 10) };
  });
  await page.mouse.move(kopf.x, kopf.y);
  await page.mouse.down();
  await page.mouse.move(kopf.x - 260, kopf.y + 90, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const nach = await page.evaluate(() => {
    const r = document.querySelector('#dlgSchicht .dlg').getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top) };
  });
  check('KRITISCH: der Dialog lässt sich am Kopf verschieben — gemessen',
    Math.abs(nach.x - (vor.x - 260)) <= 4 && Math.abs(nach.y - (vor.y + 90)) <= 4);
  check('KRITISCH: die Eingaben bleiben dabei erhalten',
    (await page.inputValue('#eps_bis')) === '16:30');
  check('KRITISCH: der Hintergrund wird dabei sichtbarer',
    await page.evaluate(() => {
      const bg = getComputedStyle(document.getElementById('dlgSchicht')).backgroundColor;
      const a = (bg.match(/[\d.]+\)$/) || ['1)'])[0];
      return parseFloat(a) < 0.3;
    }));
  // Beim nächsten Öffnen steht er wieder mittig -- sonst sucht man ihn.
  await page.evaluate(() => closeDlg('dlgSchicht'));
  await page.waitForTimeout(200);
  await page.click('#epRaster table.ep-gitter tbody tr:first-child .ep-werk button[title="Schicht bearbeiten"]');
  await page.waitForTimeout(300);
  const neuAuf = await page.evaluate(() => {
    const r = document.querySelector('#dlgSchicht .dlg').getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top) };
  });
  check('KRITISCH: beim nächsten Öffnen steht er wieder an seinem Platz',
    Math.abs(neuAuf.x - vor.x) <= 2 && Math.abs(neuAuf.y - vor.y) <= 2);
  await page.evaluate(() => closeDlg('dlgSchicht'));
  await page.waitForTimeout(200);
} catch (e) { bad.push('Verschieben: ' + String(e).split('\n')[0].slice(0, 110)); }

// ══════════ EINE SCHICHT KLONEN
const vorKlon = await zeilen();
await page.click('#epRaster table.ep-gitter tbody tr:nth-child(2) .ep-werk button[title="Schicht klonen"]');
await page.waitForTimeout(600);
check('Klonen legt eine weitere Schicht an', (await zeilen()) === vorKlon + 1);
check('Der Klon übernimmt Zeit und Bezeichnung',
  await page.evaluate(() => {
    const tr = document.querySelectorAll('#epRaster table.ep-gitter tbody tr');
    return tr[tr.length - 1].textContent.includes('11:00–13:00')
        && tr[tr.length - 1].textContent.includes('Pausenablösung');
  }));
check('Der Klon ist unbesetzt',
  await page.evaluate(() => {
    const tr = document.querySelectorAll('#epRaster table.ep-gitter tbody tr');
    return !!tr[tr.length - 1].querySelector('.ep-balken.offen');
  }));

// ══════════ AUSWAHL UND SAMMELAKTIONEN
check('Ohne Auswahl ist die Sammelleiste unsichtbar', !(await page.isVisible('#epSammel')));
await page.click('#epRaster table.ep-gitter thead input[type="checkbox"]');
await page.waitForTimeout(250);
check('Das Kästchen im Kopf hakt alle an', await page.isVisible('#epSammel'));
check('Und die Leiste sagt, wie viele', (await page.textContent('#epSammelZahl')).startsWith('3 '));
await page.click('#epRaster table.ep-gitter thead input[type="checkbox"]');
await page.waitForTimeout(250);
check('Nochmal geklickt hakt alle ab', !(await page.isVisible('#epSammel')));

// Leeren nimmt die Person herunter, die Schicht bleibt.
await page.click('#epRaster table.ep-gitter tbody tr:first-child input[type="checkbox"]');
await page.waitForTimeout(200);
check('Eine einzelne Auswahl wird richtig gezählt',
  (await page.textContent('#epSammelZahl')) === '1 Schicht ausgewählt');
const vorLeeren = await zeilen();
await page.selectOption('#epSammelWas', 'leeren');
await page.click('#epSammel button');
await page.waitForTimeout(300);
check('Leeren fragt zuerst nach', await page.isVisible('#dlgConfirm.on'));
await page.click('#cfBtn');
await page.waitForTimeout(700);
check('KRITISCH: die Person ist von der Schicht herunter',
  !(await page.textContent('#epRaster')).includes('Adrian'));
check('KRITISCH: die Schicht selbst steht noch', (await zeilen()) === vorLeeren);
check('Die Auswahl ist danach aufgehoben', !(await page.isVisible('#epSammel')));

// Löschen nimmt die Schicht selbst weg. Eingefasst: Hat ein Fehler weiter
// oben bereits Zeilen verschwinden lassen, soll das hier als benannte
// Prüfung rot werden und nicht die ganze Suite abbrechen.
try {
  await page.click('#epRaster table.ep-gitter tbody tr:nth-child(2) input[type="checkbox"]', { timeout: 4000 });
  await page.click('#epRaster table.ep-gitter tbody tr:nth-child(3) input[type="checkbox"]', { timeout: 4000 });
  await page.waitForTimeout(250);
  await page.selectOption('#epSammelWas', 'loeschen');
  await page.click('#epSammel button');
  await page.waitForTimeout(300);
  await page.click('#cfBtn');
  await page.waitForTimeout(900);
  check('KRITISCH: Löschen entfernt genau die angehakten Schichten', (await zeilen()) === vorLeeren - 2);
} catch (e) { bad.push('Löschen: ' + String(e).split('\n')[0].slice(0, 110)); }

// Sammel-Bearbeiten: was leer bleibt, bleibt unverändert.
// Nach dem Löschen steht nur noch eine Schicht -- für eine Sammelaktion
// braucht es mehrere, sonst prüft der Fall nichts.
await page.click('#epRaster table.ep-gitter tbody tr:first-child .ep-werk button[title="Schicht klonen"]');
await page.waitForTimeout(600);
check('Für die Sammelaktion stehen wieder mehrere Schichten da', (await zeilen()) >= 2);
await page.click('#epRaster table.ep-gitter thead input[type="checkbox"]');
await page.waitForTimeout(250);
await page.selectOption('#epSammelWas', 'editieren');
await page.click('#epSammel button');
await page.waitForTimeout(300);
check('Der Dialog nennt die Anzahl', (await page.textContent('#epsTitel')).includes('Schichten'));
check('Und sagt, dass Leeres unverändert bleibt',
  (await page.textContent('#epsText')).includes('unverändert'));
await page.evaluate(() => closeDlg('dlgSchicht'));
await page.waitForTimeout(200);

// ══════════ BEMERKUNG FÜR DIE EINGETEILTEN
await page.click('#view-einsatzplan .bar-tools button:has-text("Bemerkung")');
await page.waitForTimeout(300);
check('Der Bemerkungs-Dialog geht auf', await page.isVisible('#dlgEpBemerkung.on'));
await page.fill('#epbText', 'Treffpunkt beim Haupteingang, Warnweste mitbringen.');
await page.click('#epbBtn');
await page.waitForTimeout(700);
check('Die Bemerkung geht an den Einsatz, nicht an die Schicht',
  rufe.some(r => r.p.includes('einsatz_save') && r.body
    && r.body.bemerkung === 'Treffpunkt beim Haupteingang, Warnweste mitbringen.'));
check('KRITISCH: der Bedarf wird dabei nicht rückwärts überschrieben',
  rufe.filter(r => r.p.includes('einsatz_save')).every(r => Number(r.body.bedarf) >= 1));
check('Sie steht danach im Kopf', (await page.textContent('#epKopf')).includes('Haupteingang'));

// ══════════ FAHRZEIT ZÄHLT NICHT ALS ARBEITSZEIT (ENT-116)
// Sperrwirkung aus dem Auslegungsregister: "Der Fahrzeitersatz darf niemals
// in die Stundensummen einfliessen." Art. 18 Ziff. 2 GAV, wörtlich: "wird
// nicht an die Arbeitszeit gemäss diesem GAV angerechnet."
await oeffne(71);
const sollVorher = await page.textContent('#epSoll');
await page.evaluate(() => {
  // Eine Fahrzeit-Position dazustellen, wie sie beim Anlegen entsteht.
  epPos.push({ id: 9001, nr: 99, funktion: 'Fahrzeit Hinweg', ist_fahrzeit: 1,
    position: null, von: '07:00:00', bis: '07:30:00', std_verrechnung: null,
    pauschal: null, qualifikation: null, gesperrt: 0, bemerkung: null,
    mitarbeiter_id: 1, mitarbeiter: 'adrian', vorname: 'Adrian', nachname: 'von Arb',
    zusage: 'zugesagt', gesehen_am: null });
  epEinsatz.weg_minuten = 30;
  epZeichnen();
});
await page.waitForTimeout(300);
check('Die Fahrzeit steht als Zeile im Raster',
  (await page.textContent('#epRaster')).includes('Fahrzeit Hinweg'));
check('KRITISCH: sie ist als „keine Arbeitszeit" gekennzeichnet',
  (await page.textContent('#epRaster')).includes('keine Arbeitszeit'));
check('KRITISCH: die Stundensummen ändern sich durch sie NICHT',
  (await page.textContent('#epSoll')) === sollVorher);
check('KRITISCH: die Achse beginnt früher, damit die Hinfahrt hineinpasst',
  await page.evaluate(() => {
    const erste = document.querySelector('#epRaster th.uhr span');
    return erste && erste.textContent.trim() === '07:00';
  }));
check('Der Balken der Hinfahrt liegt links vom Einsatzbeginn',
  await page.evaluate(() => {
    const zeilen = [...document.querySelectorAll('#epRaster table.ep-gitter tbody tr')];
    const fz = zeilen.find(t => t.textContent.includes('Fahrzeit Hinweg'));
    const normal = zeilen.find(t => !t.textContent.includes('Fahrzeit'));
    if (!fz || !normal) return false;
    return fz.querySelector('.ep-balken').getBoundingClientRect().left
         < normal.querySelector('.ep-balken').getBoundingClientRect().left;
  }));

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

// ══════════ RÜCKMELDUNG IM RASTER (ENT-113)
await oeffne(76);
const balken = () => page.evaluate(() => [...document.querySelectorAll('#epRaster .ep-balken')]
  .map(b => ({ k: b.className, auge: !!b.querySelector('.ep-auge'), t: b.getAttribute('title') || '', txt: b.textContent.trim() })));
const bs = await balken();
check('KRITISCH: die zugesagte Schicht ist grün, nicht gelb',
  bs.some(b => b.txt.includes('Adrian') && b.k.includes('zugesagt') && !b.k.includes('besetzt')));
check('KRITISCH: die abgelehnte Schicht ist hervorgehoben',
  bs.some(b => b.txt.includes('Daniele') && b.k.includes('abgelehnt')));
check('KRITISCH: ohne Rückmeldung bleibt es beim bisherigen Gelb',
  bs.some(b => b.txt.includes('Hans') && b.k.includes('besetzt')));
check('KRITISCH: das Auge steht bei den angesehenen Schichten',
  bs.filter(b => b.auge).length === 2);
check('KRITISCH: und nicht bei der ungesehenen',
  bs.some(b => b.txt.includes('Hans') && !b.auge));
check('Der Titel sagt, woran man ist',
  bs.some(b => b.t.includes('HAT ABGELEHNT'))
  && bs.some(b => b.t.includes('Hat zugesagt'))
  && bs.some(b => b.t.includes('noch nicht angesehen')));
await page.screenshot({ path: OUT + '/88-rueckmeldungen.png' });

// ══════════ EINE ABGELEHNTE SCHICHT IST WIEDER OFFEN (ENT-113)
check('KRITISCH: der Kopf zählt die Abgelehnte nicht als besetzt',
  (await page.textContent('#epKopf')).includes('2 / 3'));
await page.evaluate(() => { go('planung'); goTab('einsaetze'); });
await page.waitForTimeout(600);
const zeile76 = await page.evaluate(() => {
  const tr = [...document.querySelectorAll('#plTable tbody tr')]
    .find(r => r.textContent.includes('Rückmeldungen'));
  return tr ? { txt: tr.textContent.replace(/\s+/g, ' '), durch: !!tr.querySelector('.nm-abgelehnt') } : null;
});
check('KRITISCH: die Planungsliste zeigt 2 von 3 statt 3 von 3',
  zeile76 && zeile76.txt.includes('2/3'));
check('KRITISCH: sie meldet den offenen Platz', zeile76 && zeile76.txt.includes('1 offen'));
check('KRITISCH: der Name der abgelehnten Person bleibt sichtbar, aber gekennzeichnet',
  zeile76 && zeile76.durch && zeile76.txt.includes('Daniele'));

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
await browser.close();
