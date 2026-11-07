// Betreiber-Konto reaktivieren heisst neu einladen (ENT-737).
//
// Der Kern (altes Passwort und Zwei-Faktor weg, aktives Konto unberuehrt)
// laeuft durch Ausfuehren in pruef_betreiber_einladung.php. Hier wird im
// Browser gemessen, was die Person am Reiter Zugang sieht:
//   1. Am stillgelegten Konto steht "Reaktivieren", nicht mehr "Aktivieren".
//   2. Am aktiven, am eingeladenen und am archivierten Konto steht es nicht.
//   3. Die Rueckfrage nennt die Adresse, an die der Link geht, und sagt,
//      dass das alte Passwort danach nicht mehr gilt.
//   4. Abgeschickt wird dieselbe Anfrage an betreiber_konto_status.php --
//      die Entscheidung trifft der Server, nicht die Oberflaeche.
//   5. Der Hinweis nennt den Weg, statt "neues Konto" zu versprechen.
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { readFileSync } from 'fs';
import { join } from 'path';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const browser = await chromium.launch({ executablePath: browserPfad() });
const seite = await browser.newPage({ viewport: { width: 1280, height: 900 } });
seite.setDefaultTimeout(5000);
const fehler = [];
seite.on('pageerror', e => fehler.push(e.message));
const rufe = [];
let konten = [];
// Ueber http statt file://: Eine Seite unter file:// schickt ihre
// API-Aufrufe ebenfalls an file://, und die faengt route() nicht ab.
const BASIS = 'http://pruef.invalid/';
await seite.route(BASIS + '**', route => {
  const pfad = route.request().url().slice(BASIS.length).split('?')[0];
  if (pfad.startsWith('api/')) { return route.fallback(); }
  try {
    const typ = pfad.endsWith('.js') ? 'text/javascript' : pfad.endsWith('.css') ? 'text/css' : 'text/html';
    return route.fulfill({ status: 200, contentType: typ, body: readFileSync(join(WURZEL, pfad || 'betreiber.html')) });
  } catch (e) { return route.fulfill({ status: 404, body: '' }); }
});
await seite.route('**/api/**', route => {
  const url = route.request().url();
  rufe.push({ url, body: route.request().postData() || '' });
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (url.includes('betreiber_konto_list.php')) {
    return send({ status: 'ok', konten, aktive: 1, archivierte: 0 });
  }
  if (url.includes('betreiber_konto_status.php')) {
    return send({ status: 'ok', id: 4, aktiv: false, eingeladen: true, gueltig_stunden: 48, selbst: false });
  }
  return send({ status: 'ok', eingerichtet: true, belege: [], kunden: [], produkte: [], eintraege: [] });
});
await seite.goto(BASIS + 'betreiber.html');
await seite.evaluate(() => {
  document.getElementById('tor').classList.add('versteckt');
  document.getElementById('haus').classList.remove('versteckt');
});

const ICH = { id: 1, name: 'B. Eins', email: 'eins@beispiel.invalid', aktiv: true, eingeladen: false,
  archiviert: false, zwei_faktor: true, ich: true, angelegt_am: '2031-01-01', letzte_anmeldung: null };
const FREMD = { id: 4, name: 'C. Zwei', email: 'zwei@beispiel.invalid', aktiv: false, eingeladen: false,
  archiviert: false, zwei_faktor: true, ich: false, angelegt_am: '2031-01-01', letzte_anmeldung: null };

async function zugang(k) {
  konten = [ICH, k];
  await seite.evaluate(ks => {
    konten = ks; kontenAktive = 1; bereichZeigen('konten'); kOeffnen(ks[1].id); kdZeichnen(); kdGoTab('zugang');
  }, konten);
  await seite.waitForTimeout(80);
  return seite.evaluate(() => {
    const z = document.getElementById('kdZugang');
    const knoepfe = [...z.querySelectorAll('.kk-tasten button')].map(b => ({
      text: b.textContent.trim(), h: b.getBoundingClientRect().height, sichtbar: b.offsetParent !== null }));
    return { knoepfe, text: z.textContent.replace(/\s+/g, ' ') };
  });
}
const namen = z => z.knoepfe.map(b => b.text);
// Kurze Frist und Rueckgabewert statt Absturz (OP-655): In der Gegenprobe
// fehlt der Knopf, und eine abgestuerzte Suite meldete gar nichts.
const klick = async sel => {
  try { await seite.click(sel, { timeout: 1000 }); return true; } catch (e) { return false; }
};

// ── 1. Stillgelegt ───────────────────────────────────────────────────
const still = await zugang(FREMD);
check('KRITISCH: am stillgelegten Konto steht "Reaktivieren"', namen(still).includes('Reaktivieren'));
check('… und sichtbar, mit messbarer Hoehe',
  still.knoepfe.some(b => b.text === 'Reaktivieren' && b.sichtbar && b.h >= 28));
check('KRITISCH: "Aktivieren" mit altem Passwort gibt es nicht mehr', !namen(still).includes('Aktivieren'));

// ── 2. Nicht an aktiven, eingeladenen, archivierten Konten ───────────
const aktiv  = await zugang({ ...FREMD, aktiv: true });
const einlad = await zugang({ ...FREMD, eingeladen: true });
const archiv = await zugang({ ...FREMD, archiviert: true });
check('KRITISCH: am aktiven Konto kein "Reaktivieren" (sonst Zuruecksetzen fremder Passwoerter)',
  !namen(aktiv).includes('Reaktivieren'));
check('am eingeladenen Konto kein "Reaktivieren" — dort ist "Neu einladen" der Weg',
  !namen(einlad).includes('Reaktivieren') && namen(einlad).includes('Neu einladen'));
check('am archivierten Konto kein "Reaktivieren", sondern "Aus dem Archiv holen"',
  !namen(archiv).includes('Reaktivieren') && namen(archiv).includes('Aus dem Archiv holen'));

// ── 5. Der Hinweis ───────────────────────────────────────────────────
check('der Hinweis nennt Stilllegen und Reaktivieren als Weg',
  /stilllegen und reaktivieren/i.test(still.text) && /hinterlegte Adresse/.test(still.text));
check('… und verspricht kein neues Konto mehr', !/bekommt ein neues Konto/.test(still.text));

// ── 3. und 4. Rueckfrage und Anfrage ─────────────────────────────────
await zugang(FREMD);
let frage = '';
seite.once('dialog', d => { frage = d.message(); d.accept(); });
rufe.length = 0;
konten = [ICH, { ...FREMD, eingeladen: true }];
const geklickt = await klick('#kdZugang .kk-tasten button:has-text("Reaktivieren")');
await seite.waitForTimeout(200);
check('der Knopf laesst sich anklicken', geklickt);
check('KRITISCH: die Rueckfrage nennt die Adresse, an die der Link geht', frage.includes('zwei@beispiel.invalid'));
check('KRITISCH: … und sagt, dass das bisherige Passwort danach nicht mehr gilt',
  /bisherige Passwort[\s\S]*nicht mehr/.test(frage));
const anfrage = rufe.find(r => r.url.includes('betreiber_konto_status.php'));
let body = {};
try { body = JSON.parse(anfrage ? anfrage.body : '{}'); } catch (e) { /* leer */ }
check('KRITISCH: abgeschickt wird an betreiber_konto_status.php mit aktiv = true',
  !!anfrage && body.id === 4 && body.aktiv === true);
const meldung = await seite.evaluate(() => document.body.textContent);
check('die Rueckmeldung sagt, wohin der Link ging und wie lange er gilt',
  /Link an zwei@beispiel\.invalid verschickt\. Er gilt 48 Stunden/.test(meldung));

// Abbrechen schickt nichts
await zugang(FREMD);
seite.once('dialog', d => d.dismiss());
rufe.length = 0;
const geklickt2 = await klick('#kdZugang .kk-tasten button:has-text("Reaktivieren")');
await seite.waitForTimeout(150);
check('Abbrechen in der Rueckfrage schickt nichts',
  geklickt2 && !rufe.some(r => r.url.includes('betreiber_konto_status.php')));

check('keine JS-Fehler', fehler.length === 0);
if (fehler.length) { console.log(fehler.join('\n')); }

await browser.close();
for (const n of ok) { console.log('  ok  ' + n); }
for (const n of bad) { console.log('  X   ' + n); }
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden`);
process.exit(bad.length ? 1 : 0);
