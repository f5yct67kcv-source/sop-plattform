// Die Sparte "Reinigung" gibt es nur bei CUPI 24 (ENT-650).
//
// Drei Ebenen, weil eine allein nichts beweist:
//  1. Der Server -- pruef_reinigung_sparte.php, wirklich ausgefuehrt. Das
//     ist die eigentliche Sperre; alles andere erspart nur den Umweg.
//  2. Das Cockpit -- am gerenderten Zustand gemessen, nicht im Quelltext
//     nachgelesen (CLAUDE.md). Eine CSS-Regel kann wirkungslos bleiben,
//     ohne dass etwas kaputtgeht.
//  3. Der Deploy -- der Schalter kommt von dort, und ein Buendel ohne
//     Ersetzung traegt sonst einen Platzhalter statt einer Entscheidung.
//
// Die gefaehrliche Richtung ist hier eindeutig: "CUPI 24 sieht seine Sparte
// nicht mehr" faellt sofort jemandem auf und wird gemeldet. "Ein fremder
// Mandant rechnet Reinigungsstunden nach dem Sicherheits-GAV ab" faellt
// niemandem auf. Darum pruefen die Faelle unten BEIDE Zustaende.
import { WURZEL, HIER, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

// ── 1. Der Server ─────────────────────────────────────────────────────
let ausgabe = '', code = 0;
try {
  ausgabe = execFileSync('php', [`${HIER}/pruef_reinigung_sparte.php`], { encoding: 'utf8' });
} catch (e) {
  ausgabe = String(e.stdout || '') + String(e.stderr || '');
  code = e.status || 1;
}
const anzahl = Number((ausgabe.match(/^(\d+) bestanden/m) || [0, 0])[1]);
const phpFehler = ausgabe.split('\n').filter(z => z.trim().startsWith('x '));
check('KRITISCH: die serverseitigen Spartenpruefungen laufen ueberhaupt durch', anzahl > 0);
check('KRITISCH: alle Faelle bestehen, inklusive der Gegenprobe im freigegebenen Zustand',
  code === 0 && phpFehler.length === 0);
phpFehler.forEach(f => bad.push('PHP: ' + f.trim()));

// me.php muss die Liste ueberhaupt mitschicken -- sonst erfaehrt das
// Cockpit nie, was gilt, und bliebe dauerhaft beim engeren Vorgabewert.
const mePhp = readFileSync(`${WURZEL}/backend/api/me.php`, 'utf8');
check('KRITISCH: me.php liefert die erlaubten Sparten mit',
  /'sparten'\s*=>\s*sparten_erlaubt\(\)/.test(mePhp));
check('KRITISCH: me.php bindet planung.php ein -- sonst 500 statt Auskunft',
  /require_once __DIR__ \. '\/\.\.\/planung\.php'/.test(mePhp));

// ── 2. Das Cockpit, am gerenderten Zustand ────────────────────────────
const browser = await chromium.launch({ executablePath: browserPfad() });

// Ohne Verwaltungsrechte schickt das Cockpit in die Mitarbeiter-App weiter
// (ENT-077) -- dieselbe Liste wie in test_dash.mjs.
const RECHTE = ['kunden_lesen', 'kunden_schreiben', 'abgleich_lesen', 'abgleich_schreiben',
  'auslagen_lesen', 'personal_lesen', 'abwesenheiten_lesen', 'betrieb_lesen', 'betrieb_schreiben',
  'fahrzeuge_lesen', 'fahrzeuge_schreiben', 'einsaetze_lesen', 'einsaetze_schreiben',
  'objekte_lesen', 'objekte_schreiben', 'masterschichten_lesen', 'masterschichten_schreiben',
  'verfuegbarkeit_lesen'];

// Faehrt das Cockpit hoch und laesst me.php die uebergebenen Sparten
// antworten -- derselbe Weg, den der echte Server nimmt.
// EIGENER KONTEXT JE LAUF: Zwei Seiten desselben Browsers teilen sich den
// localStorage. Der erste Lauf legt dort seine Sparten ab, und der zweite
// baute die Maske beim Start schon danach um -- die Gegenprobe wuerde still
// gruen, ohne je den freigegebenen Zustand gesehen zu haben.
async function cockpit(sparten) {
  const kontext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await kontext.newPage();
  page.setDefaultTimeout(5000);
  await page.route('**/api/**', r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ status: 'ok', token: 't', name: 'a', ist_admin: true,
      rollen: [], rechte: RECHTE, sparten, kpi: {}, verlauf: [], angemeldet: [],
      pro_mitarbeiter: [], letzte_rapporte: [], mitarbeiter: [], kunden: [],
      einsaetze: [], objekte: [], rapporte: [], orte: [], feiertage: [], gepflegt: {} }),
  }));
  await page.goto(`file://${WURZEL}/dashboard.html`);
  await page.fill('#gName', 'a'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
  await page.waitForSelector('#shell.on');
  await page.waitForTimeout(700);
  return page;
}

// Gemessen, nicht nachgelesen (CLAUDE.md).
//
// Gemessen wird am FELDRAHMEN, nicht am Auswahlfeld selbst: Die
// Spartenauswahl liegt in Dialogen, die beim Laden geschlossen sind -- dort
// waere jedes Element unsichtbar, und die Pruefung bestuende, ohne etwas
// ueber die Sparte auszusagen. Ausgeblendet wird der Rahmen
// ([data-sparte-feld]), das Auswahlfeld bleibt bewusst im Dokument stehen,
// damit das Speichern weiterhin einen Wert liest.
const rahmenWeg = (page, w) => page.evaluate(sel => {
  const el = document.querySelector(sel);
  if (!el) { return null; }
  const rahmen = el.matches('[data-sparte-feld]') ? el : el.closest('[data-sparte-feld]');
  if (!rahmen) { return null; }
  return getComputedStyle(rahmen).display === 'none';
}, w);

const FELDER = [
  ['#mxSparte', 'der Spartenfilter der Monatsmatrix'],
  ['#agSparte', 'der Spartenfilter im Abgleich'],
  ['#obSparte', 'die Spartenauswahl im Objektdialog'],
  ['#msSparte', 'die Spartenauswahl der Masterschicht'],
  ['#enNSparte', 'die Spartenauswahl im Einsatzdialog'],
];

// ── 2a. Gesperrt: jeder andere Mandant ───────────────────────────────
{
  const page = await cockpit(['sicherheit']);
  check('KRITISCH: gesperrt traegt das Dokument die Klasse "hat-reinigung" NICHT',
    !(await page.evaluate(() => document.documentElement.classList.contains('hat-reinigung'))));
  check('KRITISCH: gesperrt meldet reinigungAngeboten() false',
    (await page.evaluate(() => reinigungAngeboten())) === false);

  const uebrig = await page.evaluate(() =>
    document.querySelectorAll('option[data-sparte="reinigung"]').length);
  check('KRITISCH: gesperrt steht keine einzige Reinigungs-Option mehr im Dokument', uebrig === 0);

  for (const [sel, name] of FELDER) {
    check(`gesperrt ist ${name} ausgeblendet`, (await rahmenWeg(page, sel)) === true);
  }
  check('KRITISCH: die Spartenauswahl bleibt trotzdem im Dokument und liefert "sicherheit"',
    (await page.evaluate(() => { const e = document.getElementById('obSparte');
      return e ? e.value : null; })) === 'sicherheit');

  const arten = await page.evaluate(() => EINSATZARTEN.slice());
  check('KRITISCH: gesperrt steht "Reinigung" nicht mehr in der Einsatzart-Liste',
    !arten.includes('Reinigung'));
  check('Die drei Sicherheitsarten bleiben vollzaehlig',
    ['Verkehrsdienst', 'Revierdienst', 'Sicherheitsdienst'].every(a => arten.includes(a)));

  const dl = await page.evaluate(() =>
    [...document.querySelectorAll('#dlEinsatzarten option')].map(o => o.value || o.textContent));
  check('KRITISCH: gesperrt schlaegt auch die Einsatzart-Vorschlagsliste "Reinigung" nicht vor',
    !dl.some(v => /reinigung/i.test(v)));

  // Die vorsichtige Richtung: die GAV-Rechnung selbst bleibt unangetastet.
  check('KRITISCH: gesperrt gilt der GAV weiterhin fuer Sicherheit',
    (await page.evaluate(() => gavGilt('sicherheit'))) === true);
  check('KRITISCH: eine fehlende Sparte gilt weiterhin als Sicherheit -- nie still abschalten',
    (await page.evaluate(() => gavGilt(null))) === true);
  await page.context().close();
}

// ── 2b. GEGENPROBE -- freigegeben: CUPI 24 ───────────────────────────
//
// Ohne diesen Block bestuende die Suite auch dann, wenn die Reinigung
// ueberall verschwunden waere, auch beim Bestandsmandanten.
{
  const page = await cockpit(['sicherheit', 'reinigung']);
  check('GEGENPROBE: freigegeben traegt das Dokument die Klasse "hat-reinigung"',
    await page.evaluate(() => document.documentElement.classList.contains('hat-reinigung')));
  check('GEGENPROBE: freigegeben meldet reinigungAngeboten() true',
    (await page.evaluate(() => reinigungAngeboten())) === true);

  const uebrig = await page.evaluate(() =>
    document.querySelectorAll('option[data-sparte="reinigung"]').length);
  check('GEGENPROBE: freigegeben stehen die Reinigungs-Optionen noch da', uebrig >= 8);

  for (const [sel, name] of FELDER) {
    check(`GEGENPROBE: freigegeben ist ${name} da`, (await rahmenWeg(page, sel)) === false);
  }
  const arten = await page.evaluate(() => EINSATZARTEN.slice());
  check('GEGENPROBE: freigegeben steht "Reinigung" in der Einsatzart-Liste (ENT-062)',
    arten.includes('Reinigung'));
  check('GEGENPROBE: die Sparte laesst sich auch wirklich waehlen',
    (await page.evaluate(() => { const e = document.getElementById('obSparte');
      e.value = 'reinigung'; return e.value; })) === 'reinigung');
  await page.context().close();
}

await browser.close();

// ── 3. Der Deploy ─────────────────────────────────────────────────────
//
// Der Schalter kommt aus dem Deploy, nie aus der Anfrage (ENT-501, gleiche
// Bauart wie APP_ENV). Bleibt er in einem Buendel unersetzt, gilt zwar
// fail-safe "aus" -- aber niemand soll raten muessen, und drei Buendel
// brechen den Bau ueberhaupt ab, wenn ein Platzhalter stehen bleibt.
const db = readFileSync(`${WURZEL}/backend/db.php`, 'utf8');
const wf = readFileSync(`${WURZEL}/.github/workflows/deploy-hostpoint.yml`, 'utf8');

check('KRITISCH: db.php traegt den Platzhalter __SPARTE_REINIGUNG__',
  db.includes("const SPARTE_REINIGUNG = '__SPARTE_REINIGUNG__'"));

const ersetzt = (ziel) => new RegExp(
  `__SPARTE_REINIGUNG__\\|[01]\\|g"\\s+${ziel.replace(/[/$]/g, m => '\\' + m)}`).test(wf);

for (const ziel of ['dist/db.php', 'dist-guardops/db.php', 'dist-betreiber/db.php',
                    'dist-portal/db.php', 'dist-cupi24/db.php']) {
  check(`KRITISCH: __SPARTE_REINIGUNG__ wird in ${ziel} beim Deploy ersetzt`, ersetzt(ziel));
}
check('KRITISCH: auch jeder Demo-Platz bekommt den Schalter ausdruecklich gesetzt',
  /ersetze __SPARTE_REINIGUNG__ "0" "dist-demo\/\$PLATZ\/db\.php"/.test(wf));

// Und die inhaltliche Aussage: genau zwei Buendel bekommen die "1", und das
// sind die beiden, die auf die Datenbank von CUPI 24 zeigen.
const an = [...wf.matchAll(/__SPARTE_REINIGUNG__\|1\|g"\s+(\S+)/g)].map(m => m[1]).sort();
check('KRITISCH: NUR die beiden CUPI-24-Buendel bekommen die Sparte -- kein drittes',
  JSON.stringify(an) === JSON.stringify(['dist-cupi24/db.php', 'dist/db.php']));
check('KRITISCH: die Demo-Vorlage entsteht VOR der Ersetzung in dist/ und erbt die "1" darum nicht',
  wf.indexOf('cp -a dist dist-demoplatz-vorlage')
    < wf.indexOf('s|__SPARTE_REINIGUNG__|1|g" dist/db.php'));

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
