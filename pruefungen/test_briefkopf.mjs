// Briefkopf fuer den Rapport-Ausdruck und Rechnungsadresse am Kunden (ENT-155).
//
// WORAUF DIESE SUITE BESONDERS ACHTET:
//
// 1. Der Rapport-Ausdruck geht AN KUNDEN. Solange der Briefkopf nicht
//    gepflegt ist, darf dort kein erfundener Firmenname stehen -- lieber eine
//    leere Ecke als eine falsche Angabe auf einem fremden Schreibtisch.
//
// 2. Die Tabelle rapporte traegt KEIN kunde_id, nur den Kundennamen als Text.
//    Verlaesslich verknuepft ist nur, was aus einer Schicht entstanden ist --
//    rapport.einsatz_id -> einsaetze.kunde_id. Diesen Weg geht der SERVER
//    (rapport_list.php) und liefert die Stammdaten am Rapport mit; die
//    Oberflaeche sucht sie NICHT aus den Listen einsaetze/kunden zusammen,
//    weil die dort erst beim Oeffnen ihrer Ansicht geladen werden -- beim
//    Bauen dieser Aenderung genau so aufgefallen: die Kundennummer stand je
//    nach zuvor besuchter Ansicht mal auf dem Blatt und mal nicht.
//    Ueber Namensgleichheit wird NIE geraten: der Treffer landet auf einem
//    Beleg, der Richtung Rechnung geht.
//
// 3. Die abweichende Rechnungsadresse hat KEINEN Schalter "abweichend
//    ja/nein". Gefuellt heisst abweichend, leer heisst gleich. Ein Schalter
//    koennte auf "ja" stehen, waehrend die Felder leer sind -- dann stuende
//    auf dem Beleg eine leere Adresse.
//
// 4. Das Logo wird beim Anmelden geholt, nicht beim Drucken: window.print()
//    wartet nicht auf einen laufenden Abruf, und dann fehlte der Kopf genau
//    auf dem Blatt.
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const HEUTE = iso(new Date());

// ══════════════════════════════════════════════════════════════════════════
// TEIL 1 — Endpunkt und Schema (Quelltext)
// ══════════════════════════════════════════════════════════════════════════
const BET = readFileSync(`${WURZEL}/backend/api/betrieb.php`, 'utf8');
const EINR = readFileSync(`${WURZEL}/backend/api/planung_einrichten.php`, 'utf8');
const LIST = readFileSync(`${WURZEL}/backend/api/kunden_list.php`, 'utf8');
const KUN = readFileSync(`${WURZEL}/backend/kunden.php`, 'utf8');
const RLIST = readFileSync(`${WURZEL}/backend/api/rapport_list.php`, 'utf8');

check('KRITISCH: die Tabelle betrieb steht im Schema',
  /CREATE TABLE IF NOT EXISTS betrieb/.test(EINR));
check('KRITISCH: sie laesst nur EINE Zeile zu (id als Primaerschluessel mit Vorgabe 1)',
  /id TINYINT UNSIGNED NOT NULL PRIMARY KEY DEFAULT 1/.test(EINR));
check('Das Logo liegt als LONGBLOB in der Datenbank, nicht als Pfad im Dateisystem',
  /logo LONGBLOB NULL/.test(EINR) && !/logo_pfad/.test(EINR));
check('KRITISCH: die Betriebszeile wird LEER angelegt — keine erfundenen Firmenangaben',
  /INSERT INTO betrieb \(id, firma, zusatz\) VALUES \(1, '', ''\)/.test(EINR));

check('KRITISCH: Aendern verlangt das Recht "betrieb"', /require_recht\(\$user, 'betrieb'\)/.test(BET));
check('KRITISCH: Lesen steht vor der Rechtepruefung — wer drucken darf, braucht den Kopf',
  BET.indexOf("REQUEST_METHOD'] === 'GET'") < BET.indexOf("require_recht($user, 'betrieb')"));
check('KRITISCH: das Logo ist auf 512 KB begrenzt', /LOGO_MAX = 512 \* 1024/.test(BET));
check('KRITISCH: nur Bildformate werden angenommen',
  /LOGO_MIME_ERLAUBT = \['image\/png', 'image\/jpeg', 'image\/svg\+xml', 'image\/webp'\]/.test(BET));
check('Ein unerlaubtes Format wird abgewiesen, nicht gespeichert',
  /!in_array\(\$mime, LOGO_MIME_ERLAUBT, true\)/.test(BET));
check('KRITISCH: die Groesse wird gegen die ROHE Datei geprueft, nicht gegen base64',
  /\$roh = base64_decode\([\s\S]*?strlen\(\$roh\) > LOGO_MAX/.test(BET));
check('KRITISCH: eine fehlende Betriebszeile wird angelegt — ein UPDATE ins Leere meldet sonst Erfolg',
  /INSERT IGNORE INTO betrieb \(id, firma, zusatz\)/.test(BET));
check('Das Logo geht als Daten-URL heraus — der Ausdruck braucht keinen zweiten Abruf',
  /'data:' \. \$r\['logo_mime'\] \. ';base64,' \. base64_encode\(\$roh\)/.test(BET));

check('KRITISCH: der Server verknuepft den Kunden ueber die SCHICHT, nicht ueber den Namen',
  /LEFT JOIN einsaetze e ON e\.id = r\.einsatz_id/.test(RLIST)
  && /LEFT JOIN kunden k ON k\.id = e\.kunde_id/.test(RLIST));
check('KRITISCH: nirgends wird auf den Kundennamen verknuepft — Namen wiederholen und aendern sich',
  !/JOIN kunden[\s\S]{0,80}k\.name\s*=/.test(RLIST) && !/ON\s+k\.name/.test(RLIST));
check('KRITISCH: die Kundenstammdaten gehen nur an den Zugang, der ohnehin alle Rapporte sieht',
  /if \(darf\(\$user, 'abgleich'\)\)[\s\S]{0,200}\$kundenFelder/.test(RLIST)
  && /\} else \{[\s\S]{0,200}\$basis \. \$von/.test(RLIST));

check('KRITISCH: die sechs Rechnungsadress-Spalten werden nachgetragen',
  ['re_name', 're_zusatz', 're_strasse', 're_hausnummer', 're_plz', 're_ort']
    .every(s => new RegExp(`\\['kunden', '${s}',`).test(EINR)));
check('KRITISCH: es gibt KEINEN Schalter "abweichende Rechnungsadresse" — gefuellt heisst abweichend',
  !/re_abweichend|rechnung_abweichend/.test(EINR) && !/re_abweichend/.test(KUN));
check('KRITISCH: die Kundenliste liefert die Rechnungsadresse mit',
  /re_name, re_zusatz, re_strasse, re_hausnummer, re_plz, re_ort/.test(LIST));
check('KRITISCH: das Speichern des Kunden kennt die Felder ebenfalls',
  ['re_name', 're_zusatz', 're_strasse', 're_hausnummer', 're_plz', 're_ort']
    .every(s => new RegExp(`'${s}' => \\$wert\\('${s}'\\)`).test(KUN)));

// ══════════════════════════════════════════════════════════════════════════
// TEIL 2 — Oberflaeche und Ausdruck
// ══════════════════════════════════════════════════════════════════════════
const MA = [{ id: 1, name: 'adrian', vorname: 'Adrian', nachname: 'Von Arb', aktiv: 1, ist_admin: 1 }];
const KUNDEN = [
  // 1 — gewoehnliche Adresse, KEINE abweichende Rechnungsadresse
  { id: 1, kundennummer: 'K-0001', name: 'pzu Consulting GmbH', strasse: 'Mustergasse',
    hausnummer: '2', adresszusatz: null, plz: '8200', ort: 'Schaffhausen', aktiv: 1,
    re_name: null, re_zusatz: null, re_strasse: null, re_hausnummer: null, re_plz: null, re_ort: null },
  // 2 — mit abweichender Rechnungsadresse
  { id: 2, kundennummer: 'K-0002', name: 'Strabag AG', strasse: 'Kantonsstrasse',
    hausnummer: '3', adresszusatz: null, plz: '6000', ort: 'Luzern', aktiv: 1,
    re_name: 'Strabag AG, Buchhaltung', re_zusatz: 'Postfach 44', re_strasse: 'Finanzweg',
    re_hausnummer: '9', re_plz: '8005', re_ort: 'Zürich' },
];
const EINSAETZE = [
  { id: 500, kunde_id: 1, kunde_name: 'pzu Consulting GmbH', titel: null, strasse: 'Mustergasse 2',
    ort: '8200 Schaffhausen', einsatzart: 'Verkehrsdienst', datum: HEUTE, von: '07:15:00',
    bis: '15:30:00', bedarf: 1, status: 'abgeschlossen', mitarbeiter: [], objekt_id: null },
  { id: 501, kunde_id: 2, kunde_name: 'Strabag AG', titel: null, strasse: 'Kantonsstrasse 3',
    ort: '6000 Luzern', einsatzart: 'Verkehrsdienst', datum: HEUTE, von: '08:00:00',
    bis: '12:00:00', bedarf: 1, status: 'abgeschlossen', mitarbeiter: [], objekt_id: null },
];
const RAPPORTE = [
  // 10 — haengt ueber einsatz_id sauber am Kunden 1
  { id: 10, datum: HEUTE, mitarbeiter_id: 1, einsatz_id: 500, mitarbeiter: 'adrianvonarb',
    kunde_id: 1, kunde_nr: 'K-0001', k_name: 'pzu Consulting GmbH', k_strasse: 'Mustergasse',
    k_hausnummer: '2', k_adresszusatz: null, k_plz: '8200', k_ort: 'Schaffhausen',
    re_name: null, re_zusatz: null, re_strasse: null, re_hausnummer: null, re_plz: null, re_ort: null,
    kunde: 'pzu Consulting GmbH', strasse: 'Mustergasse 2', ort: '8200 Schaffhausen',
    auftrag_nr: null, einsatzart: 'Verkehrsdienst', von: '07:15:00', bis: '15:15:00',
    pause_min: 30, netto_h: 7.5, unterzeichner: 'M. Beispiel', unterschrift: null,
    bemerkung: null, erfasst_am: HEUTE + ' 15:17:00' },
  // 11 — von Hand erfasst, OHNE einsatz_id: nur der Kundenname als Text.
  //      Hier darf NICHT ueber den Namen auf Kunde 1 geschlossen werden.
  { id: 11, datum: HEUTE, mitarbeiter_id: 1, einsatz_id: null, mitarbeiter: 'adrianvonarb',
    kunde_id: null, kunde_nr: null,
    kunde: 'pzu Consulting GmbH', strasse: 'Mustergasse 2', ort: '8200 Schaffhausen',
    auftrag_nr: null, einsatzart: 'Verkehrsdienst', von: '09:00:00', bis: '12:00:00',
    pause_min: 0, netto_h: 3, unterzeichner: null, unterschrift: null,
    bemerkung: null, erfasst_am: HEUTE + ' 12:05:00' },
  // 12 — haengt am Kunden MIT abweichender Rechnungsadresse
  { id: 12, datum: HEUTE, mitarbeiter_id: 1, einsatz_id: 501, mitarbeiter: 'adrianvonarb',
    kunde_id: 2, kunde_nr: 'K-0002', k_name: 'Strabag AG', k_strasse: 'Kantonsstrasse',
    k_hausnummer: '3', k_adresszusatz: null, k_plz: '6000', k_ort: 'Luzern',
    re_name: 'Strabag AG, Buchhaltung', re_zusatz: 'Postfach 44', re_strasse: 'Finanzweg',
    re_hausnummer: '9', re_plz: '8005', re_ort: 'Zürich',
    kunde: 'Strabag AG', strasse: 'Kantonsstrasse 3', ort: '6000 Luzern',
    auftrag_nr: 'A-77', einsatzart: 'Verkehrsdienst', von: '08:00:00', bis: '12:00:00',
    pause_min: 0, netto_h: 4, unterzeichner: null, unterschrift: null,
    bemerkung: null, erfasst_am: HEUTE + ' 12:10:00' },
  // 13 — kunde_id FEHLT, Stammfelder waeren aber gefuellt. Kann der Server so
  //      heute nicht liefern; die Fixtur haelt den Riegel in
  //      rapportRechnungsadresse() pruefbar. Ohne sie bliebe eine Gegenprobe,
  //      die den Riegel entfernt, gruen -- beim Schreiben genau so passiert.
  { id: 13, datum: HEUTE, mitarbeiter_id: 1, einsatz_id: null, mitarbeiter: 'adrianvonarb',
    kunde_id: null, kunde_nr: null, k_name: 'Fremd AG', k_strasse: 'Irrweg',
    k_hausnummer: '1', k_adresszusatz: null, k_plz: '9999', k_ort: 'Nirgendwo',
    re_name: null, re_zusatz: null, re_strasse: null, re_hausnummer: null, re_plz: null, re_ort: null,
    kunde: 'Fremd AG', strasse: 'Baustelle 5', ort: '3000 Bern',
    auftrag_nr: null, einsatzart: 'Verkehrsdienst', von: '10:00:00', bis: '11:00:00',
    pause_min: 0, netto_h: 1, unterzeichner: null, unterschrift: null,
    bemerkung: null, erfasst_am: HEUTE + ' 11:05:00' },
];

let BETRIEB = { firma: '', zusatz: '', fusszeile: null, logo: null, logo_mime: null, logo_groesse: null };
const gesendet = [];

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));

await page.route('**/api/**', route => {
  const req = route.request(), u = req.url();
  let body = null;
  try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch (e) {}
  const s = x => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) });
  if (u.includes('login')) return s({ status: 'ok', token: 't', name: 'adrian', ist_admin: true });
  if (u.includes('me.php')) return s({ status: 'ok', name: 'adrian', ist_admin: true, rollen: [], rechte: ['betrieb'] });
  if (u.includes('betrieb.php')) {
    if (body) {
      gesendet.push(body);
      if (body.logo_weg) { BETRIEB = { ...BETRIEB, logo: null, logo_mime: null, logo_groesse: null }; }
      else if (body.logo) { BETRIEB = { ...BETRIEB, logo: 'data:' + body.logo_mime + ';base64,' + body.logo, logo_mime: body.logo_mime, logo_groesse: 120 }; }
      else { BETRIEB = { ...BETRIEB, firma: body.firma, zusatz: body.zusatz, fusszeile: body.fusszeile || null }; }
    }
    return s({ status: 'ok', betrieb: BETRIEB });
  }
  if (u.includes('mitarbeiter_list')) return s({ status: 'ok', mitarbeiter: MA });
  if (u.includes('kunden_list')) return s({ status: 'ok', kunden: KUNDEN });
  if (u.includes('einsatz_list')) return s({ status: 'ok', einsaetze: EINSAETZE });
  if (u.includes('rapport_list')) return s({ status: 'ok', rapporte: RAPPORTE });
  if (u.includes('dashboard_stats')) return s({ status: 'ok', kpi: {}, verlauf: [], angemeldet: [],
    pro_mitarbeiter: [], letzte_rapporte: [], sperr_ereignisse: [] });
  return s({ status: 'ok', einsaetze: [], rapporte: [], objekte: [], feiertage: [], gepflegt: {},
    sperren: [], adressen: [], wege: [], fahrzeuge: [], dokumente: [], positionen: [], orte: [] });
});

await page.goto(`file://${WURZEL}/dashboard.html`);
await page.fill('#gName', 'adrian'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#shell.on'); await page.waitForTimeout(600);

// Drucken darf die Suite nicht wirklich -- window.print() haelt den Browser an.
await page.evaluate(() => { window.__gedruckt = 0; window.print = () => { window.__gedruckt++; }; });

const drucken = id => page.evaluate(i => { drawerId = i; printReport(); return $('printArea').innerHTML; }, id);

// ── Leerer Briefkopf: nichts erfinden
let html = await drucken(10);
check('KRITISCH: ohne gepflegten Briefkopf steht KEIN erfundener Firmenname auf dem Blatt',
  !/CUPI 24/.test(html));
check('Der Ausdruck entsteht trotzdem — ein fehlender Briefkopf blockiert nichts',
  /Arbeitsrapport/.test(html));
check('Ohne Fusszeile steht keine leere Fusszeile da',
  !/border-top:1px solid #E5E8EC;font-size:10.5px/.test(html));

// ── Briefkopf pflegen
await page.evaluate(() => { go('betrieb'); });
await page.waitForTimeout(500);
check('KRITISCH: die Karte "Briefkopf für Rapporte" steht im Betriebsbereich',
  await page.isVisible('#bkKarte'));
check('Sie sagt, dass diese Angaben an Kunden herausgehen',
  /Kunden zu sehen/.test(await page.textContent('#bkKarte')));
await page.fill('#bkFirma', 'CUPI 24 GmbH');
await page.fill('#bkZusatz', 'Sicherheits- und Verkehrsdienst');
await page.fill('#bkFuss', 'Musterweg 1 · 4600 Olten · 062 000 00 00');
await page.click('#bkKarte .btn-primary');
await page.waitForTimeout(400);
check('KRITISCH: der Briefkopf wird gespeichert',
  gesendet.some(b => b.firma === 'CUPI 24 GmbH' && b.zusatz === 'Sicherheits- und Verkehrsdienst'));

html = await drucken(10);
check('KRITISCH: der gepflegte Firmenname steht jetzt im Kopf', /CUPI 24 GmbH/.test(html));
check('Der Zusatz ebenfalls', /Sicherheits- und Verkehrsdienst/.test(html));
check('KRITISCH: die Fusszeile steht am Seitenende', /Musterweg 1 · 4600 Olten/.test(html));

// ── Kundennummer und Adresse: nur bei sauberer Verknuepfung
check('KRITISCH: bei einem aus einer Schicht entstandenen Rapport steht die Kunden-Nr.',
  /Kunden-Nr\./.test(html) && /K-0001/.test(html));
check('KRITISCH: die Adresse des Einsatzes heisst jetzt "Einsatzort", nicht mehr nur "Adresse"',
  /Einsatzort/.test(html));
check('KRITISCH: die Kundenadresse aus dem Stamm steht als eigener Block',
  /Mustergasse 2/.test(html) && /8200 Schaffhausen/.test(html));
check('Ohne abweichende Rechnungsadresse ist der Block mit "Kunde" ueberschrieben, nicht mit "Rechnungsadresse"',
  />Kunde</.test(html) && !/Rechnungsadresse/.test(html));

const htmlOhne = await drucken(11);
check('KRITISCH: ein von Hand erfasster Rapport ohne Schichtbezug zeigt KEINE Kunden-Nr. — der Name allein wird nicht geraten',
  !/Kunden-Nr\./.test(htmlOhne));
check('KRITISCH: und auch keine Rechnungs-/Kundenadresse aus dem Stamm',
  !/Rechnungsadresse/.test(htmlOhne));
check('Der Rapport selbst wird trotzdem gedruckt', /Arbeitsrapport/.test(htmlOhne));

const htmlOhneId = await drucken(13);
check('KRITISCH: ohne kunde_id bleibt der Adressblock weg, selbst wenn Stammfelder mitkaemen',
  !/Irrweg/.test(htmlOhneId) && !/Nirgendwo<\/div>/.test(htmlOhneId));

const htmlRe = await drucken(12);
check('KRITISCH: bei abweichender Rechnungsadresse steht diese und nicht die gewoehnliche',
  /Finanzweg 9/.test(htmlRe) && /8005 Zürich/.test(htmlRe) && !/Kantonsstrasse 3<br>/.test(htmlRe));
check('KRITISCH: der Block heisst dann ausdruecklich "Rechnungsadresse"', /Rechnungsadresse/.test(htmlRe));
check('Der Zusatz der Rechnungsadresse steht mit', /Postfach 44/.test(htmlRe));
check('Der Einsatzort bleibt trotzdem sichtbar — er ist nicht dasselbe',
  /Kantonsstrasse 3/.test(htmlRe));

// ── Unterzeichner
check('KRITISCH: ein hinterlegter Unterzeichner steht unter der Unterschrift',
  /M\. Beispiel/.test(html));
check('Ohne Unterzeichner steht dort keine leere Zeile mit Beschriftung',
  !/Name in Blockschrift/.test(htmlOhne));

// ── Logo
await page.evaluate(() => { go('betrieb'); });
await page.waitForTimeout(400);
check('Ohne Logo sagt die Karte das ausdruecklich',
  /Kein Logo hinterlegt/.test(await page.textContent('#bkLogoStand')));
// 1x1-PNG, kleinstes gueltiges Bild
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
await page.setInputFiles('#bkLogoDatei', {
  name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from(PNG, 'base64') });
await page.waitForTimeout(500);
check('KRITISCH: das Logo wird hochgeladen', gesendet.some(b => b.logo && b.logo_mime === 'image/png'));
check('Die Karte zeigt danach das Logo selbst, nicht nur "vorhanden"',
  await page.evaluate(() => !!document.querySelector('#bkLogoStand img')));
check('Und bietet an, es wieder zu entfernen', await page.isVisible('#bkLogoWeg'));

html = await drucken(10);
check('KRITISCH: das Logo steht im Kopf des Ausdrucks',
  await page.evaluate(() => !!document.querySelector('#printArea img[src^="data:image/png"]')));

await page.evaluate(() => { go('betrieb'); });
await page.waitForTimeout(300);
await page.click('#bkLogoWeg');
await page.waitForTimeout(400);
check('KRITISCH: das Logo laesst sich wieder entfernen', gesendet.some(b => b.logo_weg === true));
check('Danach sagt die Karte wieder, dass keines hinterlegt ist',
  /Kein Logo hinterlegt/.test(await page.textContent('#bkLogoStand')));

// ── Der Ausdruck loest tatsaechlich das Drucken aus
check('KRITISCH: printReport() ruft window.print() auf',
  await page.evaluate(() => window.__gedruckt > 0));

// ── Rechnungsadresse im Kundendialog
await page.evaluate(() => { go('kunden'); });
await page.waitForTimeout(500);
await page.evaluate(() => { if (typeof openKundeNeu === 'function') openKundeNeu(); });
await page.waitForTimeout(500);
const felderDa = await page.evaluate(() => ['re_name', 're_zusatz', 're_strasse',
  're_hausnummer', 're_plz', 're_ort'].every(f => !!document.getElementById('ku_' + f)));
check('KRITISCH: der Kundendialog hat Felder fuer die Rechnungsadresse', felderDa);
check('Er sagt, dass Leerlassen "gleiche Adresse" heisst',
  /Leer lassen heisst/.test(await page.content()));

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
