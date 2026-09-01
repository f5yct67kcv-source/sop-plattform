// Zeitraum, Telefon und Formularbreite in der Anlegen-Ansicht (ENT-118).
//
// Drei Dinge werden hier scharf gehalten:
//
// 1. EIN BIS-DATUM ERZEUGT EINEN EINSATZ JE TAG -- nicht einen Einsatz ueber
//    mehrere Tage. Das ist keine Geschmacksfrage: Die 24-Stunden-Annahme
//    ("ist Bis kleiner als Von, liegt es am Folgetag") steckt in gavRohMin(),
//    gavBonusMin(), gavRuheLuecke(), im Raster und in drei Endpunkten. Ein
//    Datensatz ueber drei Tage haette Nacht- und Sonntagszuschlag,
//    Ruhezeitpruefung und Tagesrapport gleichzeitig ausgehebelt -- und ein
//    Fehler dort trifft echte Loehne, nicht hypothetische MVP-Nutzer.
//    Waechst diese Suite je zu einem "bis_datum geht an den Server", ist das
//    kein Test, der angepasst werden muss, sondern eine Entscheidung, die
//    getroffen werden muss.
//
// 2. DIE ANZAHL MUSS VOR DEM SPEICHERN DASTEHEN. Ein Vertipper im Jahresfeld
//    legt sonst dreihundert Schichten an, und niemand merkt es bis zur
//    Lohnrunde.
//
// 3. GEMESSEN, NICHT NACHGELESEN. Die Breiten hier stammen alle aus dem
//    gerenderten Zustand. Genau das hat beim Bau zwei Fehler gefunden, die im
//    Quelltext richtig aussahen: das Zeitfeld fiel auf null Breite zusammen
//    (die Zeitwahl aus ENT-110 ist kein .inp mehr, sondern eine Huelle), und
//    die Zeitraum-Zeile schob die Karte auf dem Handy 29 px nach rechts hinaus
//    (min-width: auto am Gitterkind).
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const EXE = browserPfad();
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const tag = n => iso(new Date(Date.now() + n * 864e5));
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
const datei = name => ({ name, mimeType: 'application/pdf', buffer: PDF });

const MA = [{ id: 1, name: 'adrian', vorname: 'Adrian', nachname: 'Muster', aktiv: 1, ist_admin: 1 }];
const KU = [{ id: 1, name: 'Nordbau', strasse: 'Kantonsstrasse 3', ort: '6000 Luzern' }];
const EINSAETZE = [];
let idSeq = 500;
const rufe = [];
let speicherFehlerBei = null;   // Datum, bei dem das Speichern scheitern soll
// Bremse fuer die Speicherantwort. Ohne sie ist eine Reihe schneller fertig,
// als sich der Zustand "laeuft gerade" ueberhaupt ablesen laesst -- die
// Pruefung auf die gesperrten Knoepfe waere dann keine.
let bremse = 0;

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));

await page.route('**/api/**', async route => {
  const req = route.request(), url = req.url(), p = url.split('/api/')[1].split('?')[0];
  let body = null;
  try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch (e) {}
  rufe.push({ p, body, url });
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'adrian', ist_admin: true });
  if (p.includes('mitarbeiter_list')) return send({ status: 'ok', mitarbeiter: MA });
  if (p.includes('kunden_list')) return send({ status: 'ok', kunden: KU });
  if (p.includes('einsatz_list')) return send({ status: 'ok', einsaetze: EINSAETZE });
  if (p.includes('einsatz_dokument')) {
    if (!body) { return send({ status: 'ok', dokumente: [] }); }
    return send({ status: 'ok', id: 1 });
  }
  if (p.includes('einsatz_position')) {
    return send({ status: 'ok', positionen: [] });
  }
  if (p.includes('einsatz_save')) {
    if (bremse) { await new Promise(r => setTimeout(r, bremse)); }
    if (speicherFehlerBei && body && body.datum === speicherFehlerBei) {
      return send({ status: 'error', message: 'Speichern fehlgeschlagen.' });
    }
    const id = ++idSeq;
    // Der neue Einsatz muss danach in der Liste stehen -- sonst findet der
    // Sprung in den Einsatzplan ihn nicht, und die Pruefung liefe ins Leere.
    EINSAETZE.push(Object.assign({ id, mitarbeiter: [], bedarf: 1, status: 'geplant' },
      body, { von: (body.von || '') + ':00', bis: (body.bis || '') + ':00' }));
    return send({ status: 'ok', id });
  }
  if (p.includes('dashboard_stats')) return send({ status: 'ok', kpi: { rapporte_monat: 0,
    rapporte_vormonat: 0, stunden_monat: 0, stunden_vormonat: 0, mitarbeiter: 1, kunden: 1,
    rapporte_total: 0 }, verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [],
    sperr_ereignisse: [] });
  return send({ status: 'ok', einsaetze: [], rapporte: [], objekte: [], feiertage: [],
    gepflegt: {}, sperren: [], adressen: [], wege: [], fahrzeuge: [] });
});

await page.goto(`file://${WURZEL}/dashboard.html`);
await page.fill('#gName', 'adrian'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#shell.on'); await page.waitForTimeout(500);

const speicherRufe = () => rufe.filter(r => r.p.includes('einsatz_save'));
const speicherDaten = () => speicherRufe().map(r => r.body.datum);

// Fuellt die Pflichtfelder. Das Bis-Datum bleibt der Aufrufer.
async function formular(von, bis, zVon, zBis) {
  await page.evaluate(() => openEinsatzNeu());
  await page.waitForTimeout(350);
  await page.evaluate(({ von, zVon, zBis }) => {
    $('enNKunde_name').value = 'Nordbau';
    $('enNStrasse').value = 'Kantonsstrasse 3';
    $('enNOrt').value = '6000 Luzern';
    $('enNKanton').value = 'LU';
    $('enNDatum').value = von;
    $('enNVon').value = zVon; $('enNBis').value = zBis;
  }, { von, zVon: zVon || '07:30', zBis: zBis || '16:30' });
  if (bis) { await page.fill('#enNDatumBis', bis); }
  await page.evaluate(() => enZeitraum());
  await page.waitForTimeout(120);
}

// ══════════════════════════════════════════════════════════════════════════
// TEIL 1 — Die Tagesliste als reine Rechnung
// ══════════════════════════════════════════════════════════════════════════
// Eigene Seite mit Schweizer Zeitzone. Der Prueflaeufer selbst laeuft in UTC,
// und in UTC GIBT ES KEINE ZEITUMSTELLUNG -- die Faelle unten waeren dort
// gruen, ganz gleich wie enTage() rechnet. Genau das ist in der Gegenprobe
// aufgefallen: Eine Fassung mit lokalem setDate() bestand die Pruefung, obwohl
// sie in Zuerich einen Tag verliert. Nur die Zeitzone der Nutzer prueft das.
const tzSeite = await browser.newPage({ viewport: { width: 1200, height: 800 },
                                        timezoneId: 'Europe/Zurich' });
await tzSeite.goto(`file://${WURZEL}/dashboard.html`);
// Alle Daten hier liegen bewusst weit weg vom heutigen Tag (test_datumsfest):
// Ein festes Datum nahe heute wird frueher oder spaeter mit "heute"
// verglichen und kippt beim Datumswechsel. Die Umstellungs- und Schalttage
// MUESSEN fest sein -- ein berechnetes Datum trifft sie nicht -- darum das
// Jahr 2028: Sommerzeitbeginn 26.03., Ende 29.10., Schalttag 29.02.
const t = await tzSeite.evaluate(() => ({
  leer:      enTage('', ''),
  einer:     enTage('2028-06-10', ''),
  gleich:    enTage('2028-06-10', '2028-06-10'),
  drei:      enTage('2028-06-10', '2028-06-12'),
  rueckwaerts: enTage('2028-06-12', '2028-06-10'),
  monat:     enTage('2028-09-29', '2028-10-02'),
  jahr:      enTage('2028-12-30', '2029-01-02'),
  sommerzeit: enTage('2028-03-25', '2028-03-27'),
  winterzeit: enTage('2028-10-28', '2028-10-30'),
  schalt:    enTage('2028-02-28', '2028-03-01'),
  zuviel:    enTage('2028-01-01', '2028-12-31').length,
  grenze:    enTage('2028-01-01', '2028-01-31').length,
}));
check('Die Pruefung laeuft wirklich in einer Zeitzone mit Umstellung',
  await tzSeite.evaluate(() =>
    new Date('2026-01-15T12:00:00Z').getTimezoneOffset()
    !== new Date('2026-07-15T12:00:00Z').getTimezoneOffset()));
check('Ohne Datum entsteht nichts', t.leer.length === 0);
check('KRITISCH: ohne Bis-Datum entsteht genau ein Tag',
  t.einer.length === 1 && t.einer[0] === '2028-06-10');
check('Gleiches Bis-Datum ist derselbe eine Tag', t.gleich.length === 1);
check('KRITISCH: drei Tage ergeben drei aufeinanderfolgende Daten',
  JSON.stringify(t.drei) === JSON.stringify(['2028-06-10', '2028-06-11', '2028-06-12']));
check('KRITISCH: ein rueckwaerts laufender Zeitraum ergibt nichts',
  t.rueckwaerts.length === 0);
check('Der Monatswechsel stimmt',
  JSON.stringify(t.monat) === JSON.stringify(['2028-09-29', '2028-09-30', '2028-10-01', '2028-10-02']));
check('Der Jahreswechsel stimmt',
  JSON.stringify(t.jahr) === JSON.stringify(['2028-12-30', '2028-12-31', '2029-01-01', '2029-01-02']));
// Die Zeitumstellung ist der Grund, warum ueber die UTC-Achse gerechnet wird:
// Mit lokalen Date-Objekten faellt hier ein Tag aus oder kommt doppelt.
check('KRITISCH: an der Sommerzeit-Umstellung faellt kein Tag aus',
  JSON.stringify(t.sommerzeit) === JSON.stringify(['2028-03-25', '2028-03-26', '2028-03-27']));
check('KRITISCH: an der Winterzeit-Umstellung kommt kein Tag doppelt',
  JSON.stringify(t.winterzeit) === JSON.stringify(['2028-10-28', '2028-10-29', '2028-10-30']));
check('Der Schalttag stimmt',
  JSON.stringify(t.schalt) === JSON.stringify(['2028-02-28', '2028-02-29', '2028-03-01']));
check('KRITISCH: ein ganzes Jahr laeuft nicht durch, sondern bricht ab', t.zuviel <= 32);
check('31 Tage sind noch erlaubt', t.grenze === 31);
await tzSeite.close();

// ══════════════════════════════════════════════════════════════════════════
// TEIL 2 — Anlegen: ein Tag, mehrere Tage, Grenzfaelle
// ══════════════════════════════════════════════════════════════════════════
await page.evaluate(() => { go('planung'); goTab('einsaetze'); });
await page.waitForTimeout(300);

// ── Ohne Bis-Datum: genau ein Einsatz
let vor = speicherRufe().length;
await formular(tag(3), '', '07:30', '16:30');
await page.evaluate(() => createEinsatz());
await page.waitForTimeout(700);
check('KRITISCH: ohne Bis-Datum wird genau ein Einsatz gespeichert',
  speicherRufe().length === vor + 1);
check('Und zwar mit dem gewaehlten Datum',
  speicherRufe()[vor].body.datum === tag(3));
check('KRITISCH: kein bis_datum geht an den Server — ein Einsatz ist ein Tag',
  speicherRufe().every(r => r.body.bis_datum === undefined && r.body.datum_bis === undefined));

// ── Drei Tage: drei Einsaetze mit denselben Zeiten
vor = speicherRufe().length;
await formular(tag(10), tag(12), '20:00', '04:00');
await page.evaluate(() => createEinsatz());
await page.waitForTimeout(1400);
const reihe = speicherRufe().slice(vor);
check('KRITISCH: aus drei Tagen werden drei Einsaetze', reihe.length === 3);
check('KRITISCH: mit den drei aufeinanderfolgenden Daten',
  JSON.stringify(reihe.map(r => r.body.datum)) === JSON.stringify([tag(10), tag(11), tag(12)]));
check('KRITISCH: jeder Tag traegt dieselbe Zeit',
  reihe.every(r => r.body.von === '20:00' && r.body.bis === '04:00'));
check('Kunde und Arbeitsort gehen an jeden Tag mit',
  reihe.every(r => r.body.kunde_name === 'Nordbau' && r.body.ort === '6000 Luzern'));

// ── Rueckwaerts laufender Zeitraum: gar nichts
vor = speicherRufe().length;
await formular(tag(20), tag(18), '07:30', '16:30');
await page.evaluate(() => createEinsatz());
await page.waitForTimeout(500);
// Beides in EINER Pruefung: "nichts gespeichert" allein waere wirkungslos --
// ohne Tage laeuft die Schleife ohnehin leer, die Pruefung bliebe also auch
// ohne die Sperre gruen. Massgeblich ist, dass der Planer den GRUND sieht und
// nicht ein allgemeines "Anlegen fehlgeschlagen".
check('KRITISCH: ein rueckwaerts laufender Zeitraum speichert nichts und sagt warum',
  speicherRufe().length === vor
  && /vor dem Von-Datum/.test(await page.textContent('#enNeuErr')));

// ── Mehr als 31 Tage: gar nichts, und der Weg zum richtigen Werkzeug
vor = speicherRufe().length;
await formular(tag(1), tag(60), '07:30', '16:30');
await page.evaluate(() => createEinsatz());
await page.waitForTimeout(500);
check('KRITISCH: ueber 31 Tage wird nichts gespeichert', speicherRufe().length === vor);
const langErr = await page.textContent('#enNeuErr');
check('Die Meldung nennt die Grenze', /31 Tage/.test(langErr));
check('KRITISCH: und verweist auf das richtige Werkzeug statt nur zu verbieten',
  /Masterschicht/.test(langErr));

// ── Die Vorschau steht VOR dem Speichern da
await formular(tag(5), tag(7), '07:30', '16:30');
const vorschau = await page.textContent('#enNZeitraumNote');
check('KRITISCH: die Anzahl steht vor dem Speichern da', /3 Einsätze/.test(vorschau));
check('Mit dem Zeitraum im Klartext', /\d{2}\.\d{2}\.\d{4}/.test(vorschau));
check('KRITISCH: die Vorschau sagt, dass die Verfuegbarkeitspruefung nur den ersten Tag kennt',
  /nur für den ersten Tag/.test(vorschau));

await formular(tag(5), '', '20:00', '04:00');
check('KRITISCH: eine Schicht ueber Mitternacht wird als Folgemorgen angesagt',
  /Folgemorgen/.test(await page.textContent('#enNZeitraumNote')));
await formular(tag(5), '', '07:30', '16:30');
check('Eine Tagesschicht bekommt keinen Folgemorgen-Hinweis',
  !/Folgemorgen/.test(await page.textContent('#enNZeitraumNote')));
await formular(tag(5), tag(3), '07:30', '16:30');
check('Ein rueckwaerts laufender Zeitraum faellt schon in der Vorschau auf',
  /vor dem Von-Datum/.test(await page.textContent('#enNZeitraumNote')));

// ── Ein misslungener Tag bricht die Reihe nicht ab
speicherFehlerBei = tag(31);
vor = speicherRufe().length;
await formular(tag(30), tag(32), '07:30', '16:30');
await page.evaluate(() => createEinsatz());
await page.waitForTimeout(1400);
check('KRITISCH: ein misslungener Tag bricht die uebrigen nicht ab',
  speicherRufe().length === vor + 3);
const meldung = await page.evaluate(() => document.getElementById('toast').textContent);
check('KRITISCH: der misslungene Tag wird gemeldet, nicht verschwiegen',
  /nicht angelegt/.test(meldung));
check('Und die anderen werden als angelegt gemeldet', /2 Einsätze angelegt/.test(meldung));
speicherFehlerBei = null;

// ── Dokumente haengen an JEDEM Tag der Reihe
const anhaenge = () => rufe.filter(r => r.body && r.body.aktion === 'hochladen');
let vorA = anhaenge().length;
await formular(tag(40), tag(42), '07:30', '16:30');
await page.setInputFiles('#enNDokDatei', datei('Objektplan.pdf'));
await page.waitForTimeout(300);
check('Die Vorschau sagt, dass die Unterlage an jeden Tag geht',
  /an jeden Tag/.test(await page.textContent('#enNZeitraumNote')));
vor = speicherRufe().length;
await page.evaluate(() => createEinsatz());
await page.waitForTimeout(2000);
const neueA = anhaenge().slice(vorA);
check('KRITISCH: die Unterlage haengt an jedem Tag der Reihe, nicht nur am ersten',
  neueA.length === 3);
check('KRITISCH: und an drei VERSCHIEDENEN Einsaetzen',
  new Set(neueA.map(a => a.body.einsatz_id)).size === 3);
check('Die drei Einsatznummern sind die drei eben gespeicherten',
  JSON.stringify(neueA.map(a => Number(a.body.einsatz_id)).sort((x, y) => x - y))
  === JSON.stringify(EINSAETZE.slice(-3).map(e => e.id).sort((x, y) => x - y)));

// ── Das Bis-Datum wirkt nicht auf den naechsten Einsatz nach
await page.evaluate(() => openEinsatzNeu());
await page.waitForTimeout(350);
check('KRITISCH: das Bis-Datum ist beim naechsten Oeffnen leer',
  await page.inputValue('#enNDatumBis') === '');
check('Und die Vorschau ist es auch',
  (await page.textContent('#enNZeitraumNote')).trim() === '');

// ══════════════════════════════════════════════════════════════════════════
// TEIL 3 — Telefon mit Landesvorwahl
// ══════════════════════════════════════════════════════════════════════════
const tel = await page.evaluate(() => ({
  national:   telCh('079 111 22 33'),
  ohneNull:   telCh('79 111 22 33'),
  doppelt:    telCh('+41 079 111 22 33'),
  international: telCh('+41791112233'),
  mitNullNull: telCh('0041 79 111 22 33'),
  festnetz:   telCh('041 555 00 00'),
  ortsvorwahl: telCh('44 123 45 67'),
  durchwahl:  telCh('079 111 22 33 12'),
  leer:       telCh(''),
  nurVorwahl: telCh('+41 '),
  gemischt:   telCh('Tel. 079/111 22 33'),
}));
check('KRITISCH: 079 wird zu +41 79', tel.national === '+41 79 111 22 33');
check('Ohne fuehrende Null bleibt es dieselbe Nummer', tel.ohneNull === '+41 79 111 22 33');
// Der haeufigste Griff: Im Feld steht schon +41, und es wird trotzdem 079 getippt.
check('KRITISCH: +41 gefolgt von 079 ergibt keine verschobene Nummer',
  tel.doppelt === '+41 79 111 22 33');
check('Eine bereits internationale Nummer bleibt', tel.international === '+41 79 111 22 33');
check('0041 wird zu +41', tel.mitNullNull === '+41 79 111 22 33');
check('KRITISCH: eine Festnetznummer 041 wird nicht zur Landesvorwahl verschluckt',
  tel.festnetz === '+41 41 555 00 00');
check('Eine Ortsvorwahl ohne Null bleibt Ortsvorwahl', tel.ortsvorwahl === '+41 44 123 45 67');
check('Eine Durchwahl geht nicht verloren', tel.durchwahl === '+41 79 111 22 33 12');
check('KRITISCH: ein leeres Feld bleibt leer — nicht "+41 "', tel.leer === '' && tel.nurVorwahl === '');
check('Buchstaben und Schraegstriche stoeren nicht', tel.gemischt === '+41 79 111 22 33');

await page.evaluate(() => { const el = $('enNKontakt_telefon'); el.value = ''; el.focus(); });
await page.waitForTimeout(120);
check('Beim Hineinklicken steht die Vorwahl schon da',
  (await page.inputValue('#enNKontakt_telefon')).startsWith('+41'));
await page.evaluate(() => $('enNKontakt_telefon').blur());
await page.waitForTimeout(120);
check('KRITISCH: wer nichts eintraegt, hinterlaesst kein halbes Feld',
  await page.inputValue('#enNKontakt_telefon') === '');

// ══════════════════════════════════════════════════════════════════════════
// TEIL 4 — Speichern-Knopf unten und der Sprung in den Einsatzplan
// ══════════════════════════════════════════════════════════════════════════
check('KRITISCH: am Formularende steht ein zweiter Speichern-Knopf',
  await page.isVisible('#enNeuBtn2'));
check('Er steht wirklich UNTER dem Formular, nicht daneben',
  await page.evaluate(() => {
    const knopf = document.getElementById('enNeuBtn2').getBoundingClientRect();
    const letzt = document.getElementById('enNBemerkung').getBoundingClientRect();
    return knopf.top > letzt.top;
  }));

vor = speicherRufe().length;
await formular(tag(50), '', '07:30', '16:30');
await page.click('#enNeuBtn2');
await page.waitForTimeout(900);
check('KRITISCH: der untere Knopf legt denselben Einsatz an',
  speicherRufe().length === vor + 1);
const neuId = EINSAETZE[EINSAETZE.length - 1].id;
check('KRITISCH: nach dem Anlegen steht der Einsatzplan offen',
  await page.isVisible('#view-einsatzplan'));
check('KRITISCH: und zwar der des soeben angelegten Einsatzes',
  await page.evaluate(() => epId) === neuId);

// Beide Knoepfe muessen zugleich sperren -- sonst laesst sich ueber den
// anderen ein zweites Mal anlegen, waehrend die erste Reihe noch laeuft.
await page.evaluate(() => { go('planung'); goTab('einsaetze'); });
await page.waitForTimeout(300);
await formular(tag(55), tag(57), '07:30', '16:30');
bremse = 400;
await page.evaluate(() => { createEinsatz(); });
await page.waitForTimeout(200);
check('KRITISCH: waehrend des Speicherns sind BEIDE Knoepfe gesperrt',
  await page.evaluate(() => $('enNeuBtn').disabled && $('enNeuBtn2').disabled));
await page.waitForTimeout(2200);
bremse = 0;
check('Danach sind sie wieder frei',
  await page.evaluate(() => !$('enNeuBtn').disabled && !$('enNeuBtn2').disabled));

// ══════════════════════════════════════════════════════════════════════════
// TEIL 5 — Gestaltung, am gerenderten Zustand gemessen
// ══════════════════════════════════════════════════════════════════════════
const messen = async (breite) => {
  await page.setViewportSize({ width: breite, height: 1000 });
  await page.evaluate(() => { go('planung'); goTab('einsaetze'); });
  await page.waitForTimeout(200);
  await page.evaluate(() => openEinsatzNeu());
  await page.waitForTimeout(350);
  return page.evaluate(() => {
    const r = el => el.getBoundingClientRect();
    const raster = document.querySelector('#view-einsatzneu .form-breit');
    const dv = r(document.getElementById('enNDatum'));
    const db = r(document.getElementById('enNDatumBis'));
    const zv = r(document.querySelector('[data-zeitwahl-fuer="enNVon"]'));
    const zb = r(document.querySelector('[data-zeitwahl-fuer="enNBis"]'));
    const km = r(document.getElementById('enNWeg_km'));
    const mi = r(document.getElementById('enNWeg_minuten'));
    const lk = r(document.getElementById('enNWegLink'));
    const fuss = document.querySelector('#view-einsatzneu .form-fuss');
    const knoepfe = [...fuss.querySelectorAll('.btn')].map(r);
    return {
      weit: document.querySelector('.content').classList.contains('weit'),
      spalten: getComputedStyle(raster).gridTemplateColumns.split(' ').length,
      rasterBreite: Math.round(r(raster).width),
      kartenBreite: Math.round(r(document.querySelector('#view-einsatzneu .card')).width),
      feld: Math.round(r(document.getElementById('enNVeranstaltung')).width),
      beschriftung: Math.round(r(document.querySelector('label[for="enNVeranstaltung"]')).width),
      beschriftungLinks: r(document.querySelector('label[for="enNVeranstaltung"]')).left
        < r(document.getElementById('enNVeranstaltung')).left,
      zeitraumEineZeile: [db, zv, zb].every(x => Math.abs(x.top - dv.top) < 3),
      datumBreite: Math.round(dv.width), zeitBreite: Math.round(zv.width),
      wegEineZeile: Math.abs(km.top - mi.top) < 3 && Math.abs(km.top - lk.top) < 8,
      fussRechts: Math.round(r(fuss).right - knoepfe[knoepfe.length - 1].right),
      fussHoehe: Math.round(knoepfe[0].height),
      fussBreite: Math.round(knoepfe[1].width),
      fussVoll: Math.round(r(fuss).width),
      ueberlauf: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      textDeckel: Math.round(r(document.getElementById('enNBemerkung')).width),
    };
  });
};

const m1440 = await messen(1440);
const m1920 = await messen(1920);
const m390 = await messen(390);

check('KRITISCH: die Anlegen-Ansicht nutzt die volle Fensterbreite', m1440.weit);
check('KRITISCH: das Raster fuellt die Karte, statt Rand zu lassen',
  m1440.kartenBreite - m1440.rasterBreite < 45);
// Das war die Klage: Felder von rund 58 px, weil die Beschriftung links
// die Spalte auffrass.
check('KRITISCH: ein Eingabefeld ist bei 1440 px mindestens 200 px breit', m1440.feld >= 200);
check('KRITISCH: auch bei 1920 px bleibt es breit genug', m1920.feld >= 200);
check('Die Beschriftung steht links vom Feld, nicht darueber (ENT-117)',
  m1440.beschriftungLinks);
check('Die Beschriftung frisst die Spalte nicht mehr auf',
  m1440.beschriftung < m1440.feld);
// ENT-115 wollte: Die Spalten wachsen mit dem Fenster, statt bei zwei zu
// bleiben und die halbe Flaeche leer zu lassen.
check('KRITISCH: die Spalten wachsen mit dem Fenster (ENT-115)',
  m1920.spalten > m1440.spalten);

check('KRITISCH: Datum von-bis und Zeit von-bis stehen auf einer Ebene',
  m1440.zeitraumEineZeile);
check('Auch bei 1920 px', m1920.zeitraumEineZeile);
// Diese Pruefung schuetzt nicht vor einer fehlenden CSS-Regel, sondern vor der
// Verwechslung, die sie noetig gemacht hat: Seit ENT-110 ist #enNVon ein
// verstecktes Feld INNERHALB der Zeitwahl-Huelle. Wer die Breite am <input>
// misst, misst null und merkt nichts -- gemessen wird die Huelle.
check('KRITISCH: das Zeitfeld ist nicht auf null Breite zusammengefallen',
  m1440.zeitBreite > 100 && m1920.zeitBreite > 100);
check('Datum und Zeit sind gleich breit — gleiches Muster auf beiden Seiten',
  Math.abs(m1440.datumBreite - m1440.zeitBreite) <= 4);
check('KRITISCH: das Datumsfeld bleibt lesbar breit', m1440.datumBreite >= 130);
check('Vier Felder laufen auf sehr breitem Schirm nicht auseinander',
  m1920.datumBreite <= 320);

check('KRITISCH: Wegstrecke, Fahrzeit und Route stehen auf einer Ebene',
  m1440.wegEineZeile);

check('KRITISCH: der Speichern-Knopf unten steht rechtsbuendig', m1440.fussRechts <= 2);
check('KRITISCH: er wird nicht ueber die volle Breite gezogen',
  m1440.fussBreite < m1440.fussVoll / 2);
check('Auf dem Handy haelt er die Trefferflaeche von 44 px ein', m390.fussHoehe >= 44);
check('Auch auf dem Handy bleibt er schmal', m390.fussBreite < m390.fussVoll / 2);

check('KRITISCH: kein Querlauf auf dem Handy', m390.ueberlauf <= 1);
check('KRITISCH: kein Querlauf auf dem Desktop',
  m1440.ueberlauf <= 1 && m1920.ueberlauf <= 1);
check('KRITISCH: die Zeitraum-Zeile bleibt auf dem Handy in der Karte',
  await page.evaluate(() => {
    const zr = document.querySelector('.zeitraum .zr').getBoundingClientRect();
    const karte = document.querySelector('#view-einsatzneu .card-bd').getBoundingClientRect();
    return zr.right <= karte.right + 1;
  }));
check('Auf dem Handy steht die Beschriftung wieder ueber dem Feld',
  await page.evaluate(() => {
    const l = document.querySelector('label[for="enNVeranstaltung"]').getBoundingClientRect();
    const f = document.getElementById('enNVeranstaltung').getBoundingClientRect();
    return l.bottom <= f.top + 2;
  }));
// Fliesstext bekommt einen Deckel: Eine Zeile ueber 2000 px liest sich nicht.
check('Das Bemerkungsfeld laeuft auf breitem Schirm nicht ins Endlose',
  m1920.textDeckel <= 830);

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(x => console.log('  ✗ ' + x)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
