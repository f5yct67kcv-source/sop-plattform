// Belege: Datenmodell und Summenrechnung (ENT-181).
//
// Diese Suite haelt drei Dinge scharf:
//
// 1. Der Rechenkern in backend/belege.php wird WIRKLICH AUSGEFUEHRT, nicht
//    nur gelesen. Bei einer Geldrechnung, die auf ein Kundendokument geht,
//    ist eine Suite, die die Serverantwort vortaeuscht, kein Nachweis.
//    Leitfall ist eine echte, bereits verschickte Offerte (OF-0093) --
//    abgelesene Zahlen, keine ausgedachten.
//
// 2. DAS ZWEI-SPRACHEN-RISIKO. Dieselbe Formel steht zweimal: in PHP
//    (massgeblich, wird gespeichert) und in JS (Vorschau beim Tippen). Teil 2
//    laesst beide ueber dieselben Faelle laufen und vergleicht Feld fuer
//    Feld. Ohne das koennte das Formular monatelang andere Zahlen zeigen als
//    die, die am Ende in der Datenbank stehen -- und niemand merkte es, weil
//    beide fuer sich plausibel aussehen.
//
// 3. Das Datenmodell entsteht bei der Einrichtung und wahrt die
//    Snapshot-Regel: Produktpreise werden in die Position KOPIERT, nicht
//    verlinkt. Aendert sich spaeter ein Preis, darf eine verschickte Offerte
//    sich nicht rueckwirkend veraendern.
import { WURZEL, HIER, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

// ══════════════════════════════════════════════════════════════════════════
// TEIL 1 — Der Rechenkern laeuft wirklich
// ══════════════════════════════════════════════════════════════════════════
let phpAusgabe = '', phpCode = 0;
try {
  phpAusgabe = execFileSync('php', [`${HIER}/pruef_belege.php`], { encoding: 'utf8' });
} catch (e) {
  phpAusgabe = String(e.stdout || '') + String(e.stderr || '');
  phpCode = e.status || 1;
}
const phpAnzahl = Number((phpAusgabe.match(/^(\d+) Pruefungen bestanden/m) || [0, 0])[1]);
const phpFehler = phpAusgabe.split('\n').filter(z => z.startsWith('X '));
check('KRITISCH: der Rechenkern laeuft ueberhaupt durch', phpAnzahl > 0);
check('Er prueft mindestens 30 Faelle', phpAnzahl >= 30);
check('KRITISCH: alle Rappen-Pruefungen des Rechenkerns bestehen',
  phpCode === 0 && phpFehler.length === 0);
phpFehler.forEach(f => bad.push('PHP: ' + f.trim()));

// ══════════════════════════════════════════════════════════════════════════
// TEIL 2 — PHP und JS rechnen dasselbe
// ══════════════════════════════════════════════════════════════════════════
let phpFaelle = [];
try {
  phpFaelle = JSON.parse(execFileSync('php', [`${HIER}/pruef_belege.php`, '--json'], { encoding: 'utf8' }));
} catch (e) {
  bad.push('PHP konnte die gemeinsamen Faelle nicht rechnen: ' + String(e.message || e).slice(0, 200));
}
const faelle = JSON.parse(readFileSync(`${HIER}/belege_faelle.json`, 'utf8'));
check('Es gibt genug gemeinsame Faelle, um etwas zu beweisen', faelle.length >= 8);
check('PHP hat jeden gemeinsamen Fall gerechnet', phpFaelle.length === faelle.length);

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
await page.route('**/api/**', r => r.fulfill({
  status: 200, contentType: 'application/json', body: '{"status":"ok"}' }));
await page.goto(`file://${WURZEL}/dashboard.html`);
await page.waitForTimeout(200);

check('KRITISCH: belegSummen() existiert im Browser',
  await page.evaluate(() => typeof belegSummen === 'function'));

const jsFaelle = await page.evaluate(
  f => f.map(x => ({ name: x.name, summen: belegSummen(x.positionen, x.rabatt_bp) })), faelle);

// Feld fuer Feld vergleichen statt die Objekte als Ganzes: Weicht etwas ab,
// soll der Name der Pruefung sagen WELCHES Feld -- "die Objekte sind
// verschieden" hilft beim Suchen nicht.
const felder = ['zwischensumme_rappen', 'rabatt_rappen', 'netto_rappen',
                'mwst_rappen', 'rundung_rappen', 'total_rappen'];
for (let i = 0; i < faelle.length; i++) {
  const p = (phpFaelle[i] || {}).summen, j = (jsFaelle[i] || {}).summen;
  const name = faelle[i].name;
  if (!p || !j) { bad.push(`Fall fehlt auf einer der beiden Seiten: ${name}`); continue; }
  for (const feld of felder) {
    check(`KRITISCH: PHP und JS gleich bei "${name}" — ${feld}`, p[feld] === j[feld]);
  }
  check(`KRITISCH: PHP und JS gleich bei "${name}" — MWST-Zeilen`,
    JSON.stringify(p.mwst) === JSON.stringify(j.mwst));
  check(`PHP und JS gleich bei "${name}" — Nettobetrag jeder Position`,
    JSON.stringify(p.zeilen.map(z => z.netto_rappen))
    === JSON.stringify(j.zeilen.map(z => z.netto_rappen)));
}

// Der Leitfall noch einmal ausdruecklich auf der JS-Seite: Wuerde Teil 2 nur
// PHP gegen JS vergleichen, waeren zwei gleich falsche Seiten gruen.
const of = jsFaelle[0].summen;
check('KRITISCH: JS trifft OF-0093 auf den Rappen (Total 3111.90)', of.total_rappen === 311190);
check('KRITISCH: JS trifft die MWST-Grundlage von OF-0093 (2734.20)',
  of.mwst.length === 1 && of.mwst[0].grundlage_rappen === 273420);
check('KRITISCH: JS trifft die Rundungsdifferenz von OF-0093 (-0.01)', of.rundung_rappen === -1);

// Die Anzeigehelfer, mit denen die Betraege auf den Bildschirm kommen.
const anzeige = await page.evaluate(() => ({
  glatt: chf(311190), null0: chf(0), klein: chf(5),
  bp810: bpText(810), bp700: bpText(700), bp0: bpText(0),
}));
check('Ein Betrag erscheint immer mit zwei Nachkommastellen', anzeige.glatt.endsWith('.90'));
check('Auch die Null bekommt zwei Nachkommastellen', anzeige.null0 === '0.00');
check('Fuenf Rappen werden nicht zu "5"', anzeige.klein === '0.05');
check('8.10 % behaelt seine Nachkommastellen', anzeige.bp810 === '8.10');
check('7 % bekommt keine erfundene Genauigkeit', anzeige.bp700 === '7');
check('0 % bleibt "0"', anzeige.bp0 === '0');

await browser.close();

// ══════════════════════════════════════════════════════════════════════════
// TEIL 3 — Datenmodell (Quelltext, da ohne Datenbank nicht ausfuehrbar --
// derselbe Ansatz wie test_auslagenersatz.mjs Teil 2)
// ══════════════════════════════════════════════════════════════════════════
const EINRICHTEN = readFileSync(`${WURZEL}/backend/api/planung_einrichten.php`, 'utf8');
const RECHTE     = readFileSync(`${WURZEL}/backend/rechte.php`, 'utf8');
const BELEGE     = readFileSync(`${WURZEL}/backend/belege.php`, 'utf8');

check('KRITISCH: die Einrichtung legt produkte an', /CREATE TABLE produkte/.test(EINRICHTEN));
check('KRITISCH: die Einrichtung legt belege an', /CREATE TABLE belege/.test(EINRICHTEN));
check('KRITISCH: die Einrichtung legt beleg_positionen an', /CREATE TABLE beleg_positionen/.test(EINRICHTEN));

// Reihenfolge: beleg_positionen verweist auf beide anderen und muss darum
// NACH ihnen entstehen -- sonst schlaegt der Fremdschluessel fehl und die
// Einrichtung bricht genau einmal ab, naemlich beim Kunden.
check('KRITISCH: die Tabellen entstehen in einer Reihenfolge, die die Fremdschluessel haelt',
  EINRICHTEN.indexOf('CREATE TABLE produkte') < EINRICHTEN.indexOf('CREATE TABLE beleg_positionen')
  && EINRICHTEN.indexOf('CREATE TABLE belege') < EINRICHTEN.indexOf('CREATE TABLE beleg_positionen'));

// Die Snapshot-Regel: die Position traegt eigene Kopien von Name, Preis,
// Einheit und Satz. Faende sich nur produkt_id, waere jede alte Offerte an
// den heutigen Preis gekettet.
const posBlock = (EINRICHTEN.match(/CREATE TABLE beleg_positionen[\s\S]*?ENGINE=InnoDB/) || [''])[0];
check('KRITISCH: die Position kopiert den Produktnamen', /produkt_name/.test(posBlock));
check('KRITISCH: die Position kopiert den Einzelpreis', /einzelpreis_rappen/.test(posBlock));
check('KRITISCH: die Position kopiert die Einheit', /einheit/.test(posBlock));
check('KRITISCH: die Position kopiert den MWST-Satz', /mwst_satz_bp/.test(posBlock));
check('KRITISCH: der Produktverweis darf ins Leere zeigen, ohne die Position zu loeschen',
  /produkt_id\) REFERENCES produkte\(id\) ON DELETE SET NULL/.test(posBlock));
check('KRITISCH: Positionen verschwinden mit ihrem Beleg',
  /beleg_id\) REFERENCES belege\(id\) ON DELETE CASCADE/.test(posBlock));

const belegBlock = (EINRICHTEN.match(/CREATE TABLE belege[\s\S]*?ENGINE=InnoDB/) || [''])[0];
check('KRITISCH: eine Belegnummer gibt es je Belegart nur einmal',
  /UNIQUE KEY uq_beleg_nummer \(art, nummer\)/.test(belegBlock));
check('Der Beleg traegt die gerechneten Summen als abgeleitete Werte',
  ['zwischensumme_rappen', 'rabatt_rappen', 'mwst_rappen', 'rundung_rappen', 'total_rappen']
    .every(f => belegBlock.includes(f)));
check('Archivieren ist vorgesehen, Stornieren nicht',
  /aktiv TINYINT/.test(belegBlock) && !/storn/i.test(belegBlock.replace(/--[^\n]*/g, '')));

check('KRITISCH: es gibt ein eigenes Recht "offerten"', /'offerten'\s*=>/.test(RECHTE));
check('KRITISCH: die Verwaltung traegt es', /'betrieb', 'rechte', 'offerten'/.test(RECHTE));
// Der Sinn des eigenen Rechts: Die Rolle Planung hat Kundenzugang, soll aber
// die Kalkulation nicht sehen. Bekaeme sie 'offerten', waere die Trennung
// wieder aufgehoben -- diese Pruefung haelt genau das fest.
const planungZeile = (RECHTE.match(/ROLLE_PLANUNG =>[\s\S]*?\],/) || [''])[0];
check('KRITISCH: die Rolle Planung hat es NICHT -- sie sieht Kunden, aber keine Preise',
  !planungZeile.includes("'offerten'"));

check('KRITISCH: der Rechenkern rechnet in Rappen, nicht in Franken',
  /BELEG_MENGE_FAKTOR/.test(BELEGE) && /_rappen/.test(BELEGE));
check('Beide Belegarten sind vorgesehen',
  /'offerte'\s*=>/.test(BELEGE) && /'rechnung'\s*=>/.test(BELEGE));

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
