// Kundenimport aus CSV (ENT-066).
//
// Der teuerste Fehler waere hier nicht eine abgewiesene Zeile, sondern eine
// STILL VERAENDERTE: eine Spalte, die auf dasselbe Ziel faellt wie eine
// andere und sie ueberschreibt, oder ein Trockenlauf, der andere Zahlen
// zeigt als der echte Lauf. Mehrere Pruefungen zielen genau darauf.
//
// Alle Testdaten sind erfunden. Echte Kundennamen gehoeren nirgendwohin,
// wo sie versehentlich versioniert werden koennten.
import { WURZEL, HIER, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { readFileSync } from 'fs';


const URL = `file://${WURZEL}/dashboard.html`;
const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

let gesendet = [];
const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(5000);

await page.route('**/api/**', route => {
  const req = route.request();
  const pfad = req.url().split('/api/')[1].split('?')[0];
  let body = null;
  try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch {}
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (pfad.includes('login')) return send({ status: 'ok', token: 't', name: 'adrian', ist_admin: true });
  if (pfad.includes('kunden_import')) {
    gesendet.push(body);
    const neu = (body.zeilen || []).filter(z => z.name && z.plz && z.ort);
    return send({
      status: 'ok', modus: body.modus, gelesen: (body.zeilen || []).length,
      neu: neu.length, angelegt: body.modus === 'anwenden' ? neu.length : 0,
      von_nummer: 'K0007', bis_nummer: 'K0009',
      uebersprungen: [{ zeile: 5, name: 'Muster AG', grund: 'gibt es bereits' }],
      fehler: [{ zeile: 7, name: 'Ohne Ort GmbH', grund: 'Ort fehlt' }],
      vorschau: neu.slice(0, 20).map((z, i) => ({ zeile: i + 2, name: z.name, plz: z.plz, ort: z.ort })),
    });
  }
  if (pfad.includes('kunden_list')) return send({ status: 'ok', kunden: [] });
  if (pfad.includes('mitarbeiter_list')) return send({ status: 'ok', mitarbeiter: [] });
  if (pfad.includes('objekt_list')) return send({ status: 'ok', objekte: [] });
  if (pfad.includes('anstellungsorte')) return send({ status: 'ok', orte: [] });
  if (pfad.includes('feiertag')) return send({ status: 'ok', kanton: 'SO', feiertage: [], gepflegt: {} });
  return send({ status: 'ok', kpi: {}, verlauf: [], angemeldet: [], pro_mitarbeiter: [],
    letzte_rapporte: [], rapporte: [], objekte: [], masterschichten: [], einsaetze: [] });
});

const jsFehler = [];
page.on('pageerror', e => jsFehler.push(e.message));

await page.goto(URL);
await page.fill('#gName', 'adrian'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#shell.on'); await page.waitForTimeout(600);

// ══════════════ CSV ZERLEGEN
const csv = t => page.evaluate(s => impCsvZerlegen(s), t);

let r = await csv('Name;PLZ;Ort\nMuster AG;4600;Olten\nBeispiel GmbH;4632;Trimbach\n');
check('Semikolon wird erkannt', r.trenner === ';');
check('Kopfzeile wird gelesen', r.kopf.join(',') === 'Name,PLZ,Ort');
check('Zwei Datenzeilen', r.zeilen.length === 2);
check('Werte stimmen', r.zeilen[1][1] === '4632');

r = await csv('Name,PLZ,Ort\nMuster AG,4600,Olten\n');
check('Komma wird erkannt', r.trenner === ',');
r = await csv('Name\tPLZ\nMuster AG\t4600\n');
check('Tabulator wird erkannt', r.trenner === '\t');

// Der Fall, an dem naive Zerleger scheitern
r = await csv('Name;Ort\n"Muster AG; Zweigstelle";Olten\n');
check('KRITISCH: Trennzeichen INNERHALB von Anfuehrungszeichen trennt nicht',
  r.zeilen[0][0] === 'Muster AG; Zweigstelle' && r.zeilen[0].length === 2);
r = await csv('Name;Notiz\nMuster AG;"Sagt ""dringend"" dazu"\n');
check('Verdoppelte Anfuehrungszeichen werden zu einem', r.zeilen[0][1] === 'Sagt "dringend" dazu');
r = await csv('Name;Notiz\nMuster AG;"Zeile eins\nZeile zwei"\n');
check('Zeilenumbruch im Feld sprengt die Zeile nicht',
  r.zeilen.length === 1 && r.zeilen[0][1].includes('\n'));

r = await csv('﻿Name;Ort\nMuster AG;Olten\n');
check('KRITISCH: Excel-BOM verunstaltet die erste Spalte nicht', r.kopf[0] === 'Name');
r = await csv('Name;Ort\nMuster AG;Olten\n\n\n');
check('Angehaengte Leerzeilen werden verworfen', r.zeilen.length === 1);
r = await csv('Name;Ort\r\nMuster AG;Olten\r\n');
check('Windows-Zeilenenden stoeren nicht', r.zeilen[0][1] === 'Olten');
r = await csv('');
check('Leere Datei gibt leeres Ergebnis, keinen Absturz', r.kopf.length === 0 && r.zeilen.length === 0);

// ══════════════ SPALTEN RATEN
const raten = k => page.evaluate(kk => impRaten(kk), k);
let z = await raten(['Firma', 'Strasse', 'PLZ', 'Ort', 'Telefon', 'E-Mail']);
check('Firma wird als Name erkannt', z[0] === 'name');
check('E-Mail mit Bindestrich wird erkannt', z[5] === 'email');
z = await raten(['FIRMENNAME', 'plz ', 'Ortschaft']);
check('Gross-/Kleinschreibung egal', z[0] === 'name');
check('Leerzeichen am Rand egal', z[1] === 'plz');
check('Unbekannte Ueberschrift bleibt leer statt falsch geraten', z[2] === '');

z = await raten(['Telefon', 'Mobil', 'Natel']);
check('KRITISCH: ein Ziel wird hoechstens einmal vergeben',
  z.filter(x => x === 'telefon').length === 1 && z[1] === '' && z[2] === '');

// Echter AbaNinja-Export (2026-08-27): "Unternehmensname" traf keinen
// Treffer in IMP_SYNONYME.name. Ohne Namen lehnt kunden_import.php JEDE
// Zeile mit "Name fehlt" ab -- der Import wirkte dadurch komplett
// wirkungslos, nicht bloss luckenhaft. Notizen (Mehrzahl) hatte dieselbe
// Luecke bei "notiz" (Einzahl).
z = await raten(['Unternehmensname', 'Notizen']);
check('KRITISCH: "Unternehmensname" wird als Name erkannt (AbaNinja-Export)', z[0] === 'name');
check('"Notizen" (Mehrzahl) wird erkannt', z[1] === 'notiz');

// ══════════════ DIALOG: DATEI -> ZUORDNUNG -> BERICHT
const DATEI = `Firma;Strasse;PLZ;Ort;Telefon;Kundennummer
Muster AG;Weg 1;4600;Olten;062 000 00 00;A-100
Beispiel GmbH;Gasse 2;4632;Trimbach;;A-101
Dritte AG;Platz 3;4460;Gelterkinden;;A-102
`;
await page.evaluate(() => impOeffnen());
await page.waitForTimeout(200);
check('Der Dialog geht auf', await page.isVisible('#dlgImp.on'));
check('Schritt 1 ist zu sehen', await page.isVisible('#impSchritt1'));
check('Die Zuordnung ist noch verborgen', !(await page.isVisible('#impSchritt2')));

await page.setInputFiles('#impDatei', { name: 'kunden.csv', mimeType: 'text/csv', buffer: Buffer.from(DATEI, 'utf-8') });
await page.waitForTimeout(400);
check('Nach der Dateiwahl erscheint die Zuordnung', await page.isVisible('#impSchritt2'));
check('Die Dateiauswahl verschwindet', !(await page.isVisible('#impSchritt1')));

const gefunden = await page.textContent('#impGefunden');
check('Die Zeilenzahl wird genannt', /3 Zeilen/.test(gefunden));
check('Die Spaltenzahl wird genannt', /6 Spalten/.test(gefunden));
check('Das erkannte Trennzeichen wird benannt', /Semikolon/.test(gefunden));

check('Je Spalte eine Auswahl', (await page.$$('#impZuordnung select')).length === 6);
check('Firma ist auf Name vorbelegt', (await page.inputValue('#impZ0')) === 'name');
check('PLZ ist vorbelegt', (await page.inputValue('#impZ2')) === 'plz');
check('KRITISCH: Kundennummer ist NICHT vorbelegt (ENT-040)', (await page.inputValue('#impZ5')) === '');
check('Ein Beispielwert steht daneben', (await page.textContent('#impZuordnung')).includes('Muster AG'));

// Der Hinweis muss sichtbar sein, nicht bloss im Quelltext stehen.
check('KRITISCH: der ENT-040-Hinweis ist sichtbar', await page.evaluate(() => {
  const e = [...document.querySelectorAll('#impSchritt2 .ki-hint')]
    .find(x => x.textContent.includes('Kundennummer'));
  return !!e && getComputedStyle(e).display !== 'none' && e.getClientRects().length > 0;
}));

// ══════════════ WAS TATSAECHLICH GESENDET WIRD
gesendet = [];
await page.click('button:has-text("Prüfen")');
await page.waitForTimeout(400);
const p1 = gesendet[0];
check('Der Trockenlauf sendet modus=pruefen', p1 && p1.modus === 'pruefen');
check('Alle drei Zeilen gehen mit', p1 && p1.zeilen.length === 3);
check('Zugeordnete Felder kommen an', p1 && p1.zeilen[0].name === 'Muster AG' && p1.zeilen[0].plz === '4600');
check('KRITISCH: nicht zugeordnete Spalten werden nicht mitgeschickt',
  p1 && p1.zeilen[0].kundennummer === undefined && !JSON.stringify(p1.zeilen).includes('A-100'));
check('Leere Werte werden weggelassen statt als Leerstring gesendet',
  p1 && p1.zeilen[1].telefon === undefined);

check('Der Bericht erscheint', await page.isVisible('#impSchritt3'));
const b1 = await page.textContent('#impBericht');
check('KRITISCH: der Trockenlauf sagt ausdruecklich, dass nichts gespeichert wurde',
  /noch nichts gespeichert/i.test(b1));
check('Er nennt die Zahl der neuen Kunden', /3/.test(b1));
check('Uebersprungene werden aufgefuehrt', /gibt es bereits/.test(b1));
check('Unvollstaendige werden aufgefuehrt', /Ort fehlt/.test(b1));
check('Der Anlegen-Knopf erscheint erst jetzt', await page.isVisible('#impAnwendenBtn'));

gesendet = [];
await page.click('#impAnwendenBtn');
await page.waitForTimeout(400);
check('Der echte Lauf sendet modus=anwenden', gesendet[0] && gesendet[0].modus === 'anwenden');
check('KRITISCH: er sendet dieselben Zeilen wie der Trockenlauf',
  JSON.stringify(gesendet[0].zeilen) === JSON.stringify(p1.zeilen));
const b2 = await page.textContent('#impBericht');
check('Der Bericht meldet die angelegten Kunden', /3 Kunden angelegt/.test(b2));
check('Er nennt die vergebenen Nummern', /K0007/.test(b2) && /K0009/.test(b2));
check('Der Anlegen-Knopf verschwindet danach', !(await page.isVisible('#impAnwendenBtn')));

// ══════════════ MEHRERE SPALTEN AUF EIN ZIEL
await page.evaluate(() => impOeffnen());
await page.setInputFiles('#impDatei', { name: 'k2.csv', mimeType: 'text/csv',
  buffer: Buffer.from('Name;PLZ;Ort;Bemerkung;Hinweis\nMuster AG;4600;Olten;alpha;beta\n', 'utf-8') });
await page.waitForTimeout(300);
await page.selectOption('#impZ3', 'notiz');
await page.selectOption('#impZ4', 'notiz');
const gebaut = await page.evaluate(() => impZeilenBauen());
check('KRITISCH: zwei Spalten auf dasselbe Ziel haengen aneinander statt zu ueberschreiben',
  gebaut[0].notiz === 'alpha beta');

// ══════════════ ABANINJA-EXPORT DURCHGEHEND, OHNE VON HAND NACHZUBESSERN
//
// Der eigentliche Fehlerfall: Ein Anwender laedt die Datei, sieht eine
// bereits ausgefuellte Zuordnung und klickt durch, ohne jede Zeile zu
// pruefen. Traf "Unternehmensname" damals keinen Treffer, blieb die
// Spalte leer -- ohne Namen lehnt der Server (kunden_import.php) die
// Zeile ab, und zwar ausnahmslos jede, weil KEINE Zeile dieses Exports
// Vorname/Nachname traegt. Der Import wirkte dadurch komplett
// wirkungslos, nicht bloss luckenhaft, wie zunaechst vermutet.
await page.evaluate(() => impOeffnen());
await page.setInputFiles('#impDatei', { name: 'abaninja.csv', mimeType: 'text/csv',
  buffer: Buffer.from(
    'Unternehmensname;Strasse;Hausnummer;PLZ;Stadt;Notizen\n'
    + 'Beispiel Treuhand AG;Musterweg;12;4600;Olten;Bevorzugt Rechnung per Post\n',
    'utf-8') });
await page.waitForTimeout(300);
check('KRITISCH: "Unternehmensname" ist OHNE Nachbessern schon auf Name vorbelegt',
  (await page.inputValue('#impZ0')) === 'name');
check('"Notizen" ist ebenso vorbelegt', (await page.inputValue('#impZ5')) === 'notiz');
check('"Stadt" faellt weiterhin auf Ort (bereits bekannter Fall)',
  (await page.inputValue('#impZ4')) === 'ort');
const abaZeile = (await page.evaluate(() => impZeilenBauen()))[0];
check('KRITISCH: die gebaute Zeile hat einen Namen -- sonst weist der Server sie zurueck',
  abaZeile.name === 'Beispiel Treuhand AG');

// ══════════════ SERVERSEITIGE ZUSICHERUNGEN
const php = readFileSync(`${WURZEL}/backend/api/kunden_import.php`, 'utf8');
check('SERVER: der Import braucht das Kundenrecht (ENT-077)',
  /require_recht\(\$user, 'kunden'\)/.test(php));
check('SERVER: nur POST', /nur POST/.test(php) && /405/.test(php));
check('KRITISCH: keine zweite Speicherlogik, dieselbe wie beim Anlegen von Hand',
  /kunden_eingabe_lesen/.test(php));
check('KRITISCH: dieselben Pflichtfelder wie kunden_create',
  /Name fehlt/.test(php) && /PLZ/.test(php) && /Ort/.test(php));
check('KRITISCH: der Trockenlauf schreibt nichts',
  /\$modus === 'pruefen'[\s\S]{0,120}json_response/.test(php));
check('KRITISCH: alles oder nichts, in einer Transaktion',
  /beginTransaction/.test(php) && /rollBack/.test(php) && /commit/.test(php));
check('SERVER: Dubletten werden erkannt', /uebersprungen/.test(php) && /gibt es bereits/.test(php));
check('KRITISCH: auch Dubletten INNERHALB der Datei', /imLauf/.test(php) && /doppelt/.test(php));
check('KRITISCH: die Kundennummer kommt vom System, nicht aus der Datei',
  /naechste_kundennummer/.test(php));
check('SERVER: eine Obergrenze verhindert Endlosimporte', /IMPORT_MAX_ZEILEN/.test(php));
check('SERVER: der Bestand wird einmal geladen, nicht je Zeile abgefragt',
  /SELECT name, plz FROM kunden/.test(php));

const dash = readFileSync(`${WURZEL}/dashboard.html`, 'utf8');
check('Der Knopf sitzt bei den Kunden', /impOeffnen\(\)/.test(dash) && /Importieren/.test(dash));
check('KRITISCH: keine Kundenliste im Quelltext des Werkzeugs',
  !/Muster AG/.test(dash));

check('KRITISCH: keine JavaScript-Fehler auf der Seite', jsFehler.length === 0);

await page.screenshot({ path: `${OUT}/imp-01-bericht.png` });
await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
