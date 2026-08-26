// Warnung bei entschädigungspflichtiger Zone — GAV-AUS-010 (ENT-124).
//
// Der Auftrag: Sobald eine Wegstrecke in eine entschädigungspflichtige Zone
// fällt, muss SICHTBAR werden, dass GAV-AUS-010 offen ist — nicht als
// Tooltip, den man verpassen kann, sondern als eigener, auffälliger Hinweis.
// Zusätzlich: konkret melden, wenn eine eingeteilte Person am selben Tag
// bereits einen anderen Einsatz hat.
//
// WICHTIG, was diese Suite NICHT prüft: dass irgendwo ein Frankenbetrag
// erscheint. GAV-AUS-010 ist offen — es wird NICHTS gerechnet, nur GEMELDET.
// Eine Prüfung, die einen berechneten Auslagenersatz fände, wäre selbst ein
// Zeichen dafür, dass die Sperre verletzt wurde.
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const EXE = browserPfad();
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const tag = n => iso(new Date(Date.now() + n * 864e5));
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

// ══════════════════════════════════════════════════════════════════════════
// TEIL 1 — die Sperre selbst bleibt unangetastet (Quelltext)
// ══════════════════════════════════════════════════════════════════════════
const GAVJS = readFileSync(`${WURZEL}/gav.js`, 'utf8');
const DASH = readFileSync(`${WURZEL}/dashboard.html`, 'utf8');
check('KRITISCH: nirgends wird ein Auslagenersatz-Betrag in Franken berechnet',
  !/CHF.{0,40}entschaedigung.{0,40}\*/.test(GAVJS + DASH)
  && !/gavAus010.{0,200}CHF/.test(DASH));
// Auf die Konstante selbst pruefen, nicht auf die ganze Datei: Ein
// erklaerender Code-Kommentar erwaehnt OP-104 ebenfalls, und eine Pruefung
// gegen die Gesamtdatei wuerde bestehen, auch wenn die WARNUNG SELBST den
// Verweis verloeren wuerde -- genau das ist einer Gegenprobe passiert.
const hinweisText = (GAVJS.match(/const GAV_AUS010_HINWEIS =[\s\S]*?;/) || [''])[0];
check('Der Hinweistext nennt GAV-AUS-010 ausdrücklich', /GAV-AUS-010/.test(hinweisText));
check('Und den Verweis auf OP-104', /OP-104/.test(hinweisText));
check('Eine einzige Quelle für den Text (wie beim Wegstrecken-Hinweis)',
  (DASH.match(/GAV_AUS010_HINWEIS/g) || []).length >= 3);

const MA = [{ id: 1, name: 'adrian', vorname: 'Adrian', nachname: 'von Arb', aktiv: 1, ist_admin: 1 },
            { id: 2, name: 'berta', vorname: 'Berta', nachname: 'Beispiel', aktiv: 1, ist_admin: 0 }];
const KU = [{ id: 1, name: 'Stranag', strasse: 'Kantonsstrasse 3', ort: '6000 Luzern' }];
const HAO = { id: 10, bezeichnung: 'Hauptsitz', rolle: 'hao', strasse: 'Bahnhofstrasse 1',
              plz: '4600', ort: 'Olten', km_zum_anderen: null, aktiv: 1, bemerkung: null };
let EINSAETZE = [];
let idSeq = 700;
const rufe = [];

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));

await page.route('**/api/**', route => {
  const req = route.request(), url = req.url(), p = url.split('/api/')[1].split('?')[0];
  let body = null;
  try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch (e) {}
  rufe.push({ p, body, url });
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'adrian', ist_admin: true });
  if (p.includes('mitarbeiter_list')) return send({ status: 'ok', mitarbeiter: MA });
  if (p.includes('kunden_list')) return send({ status: 'ok', kunden: KU });
  if (p.includes('anstellungsorte')) return send({ status: 'ok', orte: [HAO] });
  if (p.includes('einsatz_list')) return send({ status: 'ok', einsaetze: EINSAETZE });
  if (p.includes('objekt_list')) return send({ status: 'ok', objekte: [
    { id: 1, name: 'Nahes Objekt', kunde_name: 'Stranag', ort: '4600 Olten', strasse: 'Ringstrasse 2',
      kanton: 'SO', einsatzart: 'Revierdienst', sparte: 'sicherheit', aktiv: 1,
      masterschichten: 1, stunden_je_einsatz: 4, distanzen: { 10: { km: 6 } } },
    { id: 2, name: 'Fernes Objekt', kunde_name: 'Stranag', ort: '6000 Luzern', strasse: 'Kantonsstrasse 3',
      kanton: 'LU', einsatzart: 'Revierdienst', sparte: 'sicherheit', aktiv: 1,
      masterschichten: 1, stunden_je_einsatz: 4, distanzen: { 10: { km: 18 } } },
  ] });
  if (p.includes('einsatz_dokument')) return body ? send({ status: 'ok', id: 1 }) : send({ status: 'ok', dokumente: [] });
  if (p.includes('einsatz_position')) return send({ status: 'ok', positionen: [] });
  if (p.includes('einsatz_save')) {
    const id = ++idSeq;
    EINSAETZE.push(Object.assign({ id, bedarf: 1, status: 'geplant' }, body, {
      von: (body.von || '') + ':00', bis: (body.bis || '') + ':00',
      // Erst NACH dem body-Spread setzen -- sonst ueberschreibt body.mitarbeiter
      // (die rohen Zahlen aus pickIds) das hier aufgeloeste Objektfeld.
      mitarbeiter: (body.mitarbeiter || []).map(mid =>
        MA.find(m => Number(m.id) === Number(mid))).filter(Boolean),
    }));
    return send({ status: 'ok', id });
  }
  if (p.includes('dashboard_stats')) return send({ status: 'ok', kpi: { rapporte_monat: 0,
    rapporte_vormonat: 0, stunden_monat: 0, stunden_vormonat: 0, mitarbeiter: 2, kunden: 1,
    rapporte_total: 0 }, verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [],
    sperr_ereignisse: [] });
  return send({ status: 'ok', einsaetze: [], rapporte: [], objekte: [], feiertage: [],
    gepflegt: {}, sperren: [], adressen: [], wege: [], fahrzeuge: [] });
});

await page.goto(`file://${WURZEL}/dashboard.html`);
await page.fill('#gName', 'adrian'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#shell.on'); await page.waitForTimeout(500);

// ══════════════════════════════════════════════════════════════════════════
// TEIL 2 — Objektliste: sichtbarer Balken, nicht nur ein Tooltip
// ══════════════════════════════════════════════════════════════════════════
await page.evaluate(() => { go('kunden'); kuGoTab('objekte'); });
await page.waitForTimeout(600);

check('KRITISCH: bei entschädigungspflichtiger Zone steht ein eigener Balken über der Liste',
  await page.isVisible('#oTable .zone.danger'));
// Ueber evaluate lesen, nicht ueber page.textContent: Fehlt das Element,
// wirft textContent eine Zeitueberschreitung und reisst die ganze Suite mit
// -- ein Abbruch sieht im Sammellauf aus wie ein Fehler im Pruefwerkzeug,
// nicht wie einer im Produkt. Genau das ist einer Gegenprobe passiert.
const balkenTxt = await page.evaluate(() => {
  const el = document.querySelector('#oTable .zone.danger');
  return el ? el.textContent : '';
});
check('KRITISCH: der Balken nennt GAV-AUS-010', /GAV-AUS-010/.test(balkenTxt));
check('Und das betroffene Objekt beim Namen', /Fernes Objekt/.test(balkenTxt));
check('KRITISCH: das Objekt in der sicheren Zone wird NICHT genannt',
  !/Nahes Objekt/.test(balkenTxt));

// Der Balken bleibt stehen, auch wenn die Suche etwas anderes zeigt (OP-104).
await page.fill('#oQ', 'Nahes');
await page.waitForTimeout(300);
check('KRITISCH: der Balken verschwindet nicht, nur weil gefiltert wird',
  await page.isVisible('#oTable .zone.danger'));
await page.fill('#oQ', '');
await page.waitForTimeout(300);

// ══════════════════════════════════════════════════════════════════════════
// TEIL 3 — Objektdialog: deutliche Warnung beim Erfassen
// ══════════════════════════════════════════════════════════════════════════
await page.evaluate(() => openObjektNeu());
await page.waitForTimeout(300);
await page.fill('#obKm10', '18');
await page.waitForTimeout(250);
check('KRITISCH: die Warnung im Objektdialog nennt GAV-AUS-010',
  /GAV-AUS-010/.test(await page.textContent('#obZoneHint')));
await page.fill('#obKm10', '6');
await page.waitForTimeout(250);
check('Unter 10 km keine GAV-AUS-010-Warnung', !/GAV-AUS-010/.test(await page.textContent('#obZoneHint')));
await page.evaluate(() => closeDlg('dlgObNeu'));

// ══════════════════════════════════════════════════════════════════════════
// TEIL 4 — Neue Schicht: Warnung samt konkret genannter Person
// ══════════════════════════════════════════════════════════════════════════
// Erst einen Einsatz anlegen, auf den sich der Tageskonflikt beziehen kann.
await page.evaluate(() => { go('planung'); goTab('einsaetze'); });
await page.waitForTimeout(300);
const heuteImTest = tag(5);
await page.evaluate(() => openEinsatzNeu());
await page.waitForTimeout(300);
await page.evaluate(({ datum }) => {
  $('enNKunde_name').value = 'Stranag';
  $('enNStrasse').value = 'Kantonsstrasse 3'; $('enNOrt').value = '6000 Luzern'; $('enNKanton').value = 'LU';
  $('enNDatum').value = datum; $('enNVon').value = '06:00'; $('enNBis').value = '10:00';
}, { datum: heuteImTest });
await page.evaluate(() => pickRender('enN', [2], null));
await page.waitForTimeout(150);
await page.evaluate(() => createEinsatz());
await page.waitForTimeout(900);

// Jetzt ein zweites Mal am selben Tag, mit derselben Person UND weiter Strecke.
await page.evaluate(() => { go('planung'); goTab('einsaetze'); });
await page.waitForTimeout(300);
await page.evaluate(() => openEinsatzNeu());
await page.waitForTimeout(300);
await page.evaluate(({ datum }) => {
  $('enNKunde_name').value = 'Stranag';
  $('enNStrasse').value = 'Kantonsstrasse 3'; $('enNOrt').value = '6000 Luzern'; $('enNKanton').value = 'LU';
  $('enNDatum').value = datum; $('enNVon').value = '14:00'; $('enNBis').value = '18:00';
}, { datum: heuteImTest });
await page.waitForTimeout(200);
await page.fill('#enNWeg_km', '18');
await page.waitForTimeout(250);
let zoneTxt = await page.textContent('#enNZone');
check('KRITISCH: die Zone zeigt weiterhin den Auslagenersatz an (unverändert)',
  /geschuldet/.test(zoneTxt));
check('KRITISCH: zusätzlich steht GAV-AUS-010 als eigener, deutlicher Hinweis da',
  /GAV-AUS-010/.test(zoneTxt));
check('Ohne zugeteilte Person noch kein Namenshinweis', !/Betrifft bereits/.test(zoneTxt));

// Berta zuteilen — sie hat heute schon einen Einsatz. Ueber den echten Klick
// auf das Haekchen, nicht ueber pickRender(): Nur der Klick loest pickWahl()
// aus, und nur pickWahl() zieht enWegZone() nach (ENT-124).
await page.check('#enNMa input[type=checkbox][value="2"]');
await page.waitForTimeout(200);
zoneTxt = await page.textContent('#enNZone');
check('KRITISCH: nach der Zuteilung wird die betroffene Person konkret genannt',
  /Betrifft bereits/.test(zoneTxt) && /Berta Beispiel/.test(zoneTxt));
check('Adrian, der heute noch keinen zweiten Einsatz hat, wird nicht genannt',
  !zoneTxt.includes('Adrian von Arb'));

// Unter 10 km: kein GAV-AUS-010-Hinweis, auch mit zugeteilter Person.
await page.fill('#enNWeg_km', '6');
await page.waitForTimeout(250);
check('Unter 10 km keine GAV-AUS-010-Warnung im Formular',
  !/GAV-AUS-010/.test(await page.textContent('#enNZone')));

// Zurueck auf 18 km, aber auf einen Tag OHNE Konflikt fuer Berta -- dann per
// echter Feldbedienung (page.fill loest 'change' aus, nicht nur 'input')
// auf den Tag umstellen, an dem sie schon eingeteilt ist. Nur ein echtes
// Bedienereignis prueft den onchange-Haken; ein per JS gesetzter Wert (wie
// beim Ausfuellen der uebrigen Felder oben) loest ihn nicht aus.
await page.fill('#enNWeg_km', '18');
await page.waitForTimeout(200);
await page.fill('#enNDatum', tag(6));
await page.waitForTimeout(250);
check('Auf einem konfliktfreien Tag noch kein Namenshinweis',
  !/Betrifft bereits/.test(await page.textContent('#enNZone')));
await page.fill('#enNDatum', heuteImTest);
await page.waitForTimeout(250);
check('KRITISCH: die Warnung zieht nach, wenn nur das Datum geändert wird — ohne erneuten Klick auf das Häkchen',
  /Betrifft bereits/.test(await page.textContent('#enNZone')) && /Berta Beispiel/.test(await page.textContent('#enNZone')));

await page.evaluate(() => enNeuAbbrechen());

// ══════════════════════════════════════════════════════════════════════════
// TEIL 5 — Einsatzplan: Warnung am bestehenden Einsatz
// ══════════════════════════════════════════════════════════════════════════
// Fernes Objekt hat 18 km -- direkt einen Einsatz mit dieser Wegstrecke anlegen.
await page.evaluate(() => { go('planung'); goTab('einsaetze'); });
await page.waitForTimeout(300);
await page.evaluate(() => openEinsatzNeu());
await page.waitForTimeout(300);
await page.evaluate(({ datum }) => {
  $('enNKunde_name').value = 'Stranag';
  $('enNStrasse').value = 'Kantonsstrasse 3'; $('enNOrt').value = '6000 Luzern'; $('enNKanton').value = 'LU';
  $('enNDatum').value = datum; $('enNVon').value = '07:00'; $('enNBis').value = '11:00';
}, { datum: tag(10) });
await page.waitForTimeout(200);
await page.fill('#enNWeg_km', '18');
await page.waitForTimeout(200);
await page.evaluate(() => createEinsatz());
await page.waitForTimeout(900);
check('KRITISCH: nach dem Anlegen steht der Einsatzplan offen', await page.isVisible('#view-einsatzplan'));
await page.waitForTimeout(600);   // Anstellungsorte nachladen (asynchron)
const epTxt = await page.textContent('#epKopf');
check('KRITISCH: der Einsatzplan zeigt dieselbe GAV-AUS-010-Warnung wie das Formular',
  /GAV-AUS-010/.test(epTxt));

// Bei einer Wegstrecke unter 10 km keine Warnung im Einsatzplan.
await page.evaluate(() => { go('planung'); goTab('einsaetze'); });
await page.waitForTimeout(300);
await page.evaluate(() => openEinsatzNeu());
await page.waitForTimeout(300);
await page.evaluate(({ datum }) => {
  $('enNKunde_name').value = 'Stranag';
  $('enNStrasse').value = 'Ringstrasse 2'; $('enNOrt').value = '4600 Olten'; $('enNKanton').value = 'SO';
  $('enNDatum').value = datum; $('enNVon').value = '07:00'; $('enNBis').value = '11:00';
}, { datum: tag(11) });
await page.waitForTimeout(200);
await page.fill('#enNWeg_km', '6');
await page.waitForTimeout(200);
await page.evaluate(() => createEinsatz());
await page.waitForTimeout(900);
const epTxt2 = await page.textContent('#epKopf');
check('Unter 10 km keine GAV-AUS-010-Warnung im Einsatzplan', !/GAV-AUS-010/.test(epTxt2));

// Ohne hinterlegte Wegstrecke ueberhaupt: auch keine Warnung (unbestimmbar
// darf nicht wie "keine Entschaedigung" behandelt werden, aber auch nicht
// als "Entschaedigung geschuldet").
await page.evaluate(() => { go('planung'); goTab('einsaetze'); });
await page.waitForTimeout(300);
await page.evaluate(() => openEinsatzNeu());
await page.waitForTimeout(300);
await page.evaluate(({ datum }) => {
  $('enNKunde_name').value = 'Stranag';
  $('enNStrasse').value = 'Weg 9'; $('enNOrt').value = '3000 Bern'; $('enNKanton').value = 'BE';
  $('enNDatum').value = datum; $('enNVon').value = '07:00'; $('enNBis').value = '11:00';
}, { datum: tag(12) });
await page.waitForTimeout(200);
await page.evaluate(() => createEinsatz());
await page.waitForTimeout(900);
const epTxt3 = await page.textContent('#epKopf');
check('Ohne Wegstrecke keine GAV-AUS-010-Warnung (weil nichts bestimmbar ist)',
  !/GAV-AUS-010/.test(epTxt3));

// ══════════════════════════════════════════════════════════════════════════
// TEIL 6 — Einsatzplan als ERSTE Seite: Anstellungsorte muessen selbst
// nachgeladen werden, nicht aus einem vorherigen Besuch der Objektliste.
// ══════════════════════════════════════════════════════════════════════════
// Eigene Seite, eigener Login -- kein Besuch der Objekte-Ansicht vorher, wie
// er weiter oben in dieser Suite laengst geschehen ist. Ohne diese isolierte
// Seite waere der Nachlade-Aufruf in epLaden() ungeprueft: Er wuerde nie den
// Fall treffen, in dem anstellungsorte.length noch 0 ist.
const seite2 = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
seite2.on('pageerror', e => bad.push('JS-Fehler (Seite 2): ' + e.message));
const rufe2 = [];
await seite2.route('**/api/**', route => {
  const req = route.request(), url = req.url(), p = url.split('/api/')[1].split('?')[0];
  let body = null;
  try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch (e) {}
  rufe2.push({ p, body, url });
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'adrian', ist_admin: true });
  if (p.includes('mitarbeiter_list')) return send({ status: 'ok', mitarbeiter: MA });
  if (p.includes('kunden_list')) return send({ status: 'ok', kunden: KU });
  if (p.includes('anstellungsorte')) return send({ status: 'ok', orte: [HAO] });
  // Genau EIN Einsatz mit 18 km -- direkt aus der Datenbank geladen, nicht
  // erst im Formular angelegt. So oeffnet sich der Einsatzplan als allererste
  // Handlung der Sitzung.
  if (p.includes('einsatz_list')) return send({ status: 'ok', einsaetze: [
    { id: 9001, kunde_id: 1, kunde_name: 'Stranag', titel: null, strasse: 'Kantonsstrasse 3',
      ort: '6000 Luzern', kanton: 'LU', einsatzart: 'Verkehrsdienst', sparte: 'sicherheit',
      datum: tag(20), von: '07:00:00', bis: '11:00:00', bedarf: 1, status: 'geplant',
      bemerkung: null, objekt_id: null, mitarbeiter: [], weg_km: 18 } ] });
  if (p.includes('einsatz_position')) return send({ status: 'ok', positionen: [] });
  if (p.includes('einsatz_dokument')) return body ? send({ status: 'ok', id: 1 }) : send({ status: 'ok', dokumente: [] });
  return send({ status: 'ok', objekte: [], einsaetze: [], rapporte: [], feiertage: [],
    gepflegt: {}, sperren: [], adressen: [], wege: [], fahrzeuge: [], kpi: {}, verlauf: [],
    angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [] });
});
await seite2.goto(`file://${WURZEL}/dashboard.html`);
await seite2.fill('#gName', 'adrian'); await seite2.fill('#gPass', 'x'); await seite2.click('#gBtn');
await seite2.waitForSelector('#shell.on'); await seite2.waitForTimeout(500);
check('KRITISCH: bei frischer Sitzung sind die Anstellungsorte noch nicht geladen',
  await seite2.evaluate(() => anstellungsorte.length === 0));
// WICHTIG: go('planung') laedt als Nebeneffekt loadObjekte(), und die
// braucht selbst die Anstellungsorte -- ein normaler Klick durch die
// Planung wuerde sie also laengst mitbringen. Um den Nachlade-Aufruf in
// epLaden() wirklich isoliert zu pruefen, wird die Einsatzliste hier direkt
// gesetzt, OHNE go('planung')/loadEinsaetze() zu durchlaufen. Das simuliert
// den Wettlauf-Fall: Ein Klick auf eine Schicht kommt schneller, als der
// Nebeneffekt der Planungsansicht die Anstellungsorte mitgebracht hat.
await seite2.evaluate(() => {
  einsaetze = [{ id: 9001, kunde_id: 1, kunde_name: 'Stranag', titel: null,
    strasse: 'Kantonsstrasse 3', ort: '6000 Luzern', kanton: 'LU',
    einsatzart: 'Verkehrsdienst', sparte: 'sicherheit', datum: '2028-06-10',
    von: '07:00:00', bis: '11:00:00', bedarf: 1, status: 'geplant', bemerkung: null,
    objekt_id: null, mitarbeiter: [], weg_km: 18 }];
});
await seite2.evaluate(() => epAuf(9001));
await seite2.waitForTimeout(900);   // Nachladen der Anstellungsorte ist asynchron
check('KRITISCH: der Einsatzplan zeigt die Warnung auch ohne vorherigen Besuch der Objektliste',
  /GAV-AUS-010/.test(await seite2.textContent('#epKopf')));
await seite2.close();

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(x => console.log('  ✗ ' + x)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
