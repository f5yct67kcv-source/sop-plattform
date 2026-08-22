// Das Rapport-Tool (index.html) -- die Seite, auf der draussen tatsaechlich
// erfasst wird.
//
// Sie hatte bis zum 22.08.2026 keine eigene Suite. Andere Suiten laden sie,
// pruefen aber nur einzelne Fragen (Sprache, Zurueck-Knopf). Die
// Bedienbarkeit auf dem Handy war nie gemessen worden -- und war verletzt:
// jedes Eingabefeld unter 16px (iOS zoomt hinein und bleibt dort), fast alle
// Bedienelemente knapp unter 44px, der Loeschen-Knopf der Unterschrift 22px.
//
// Gemessen wird am gerenderten Zustand, nicht im Quelltext nachgelesen: Eine
// CSS-Regel kann wirkungslos bleiben, ohne dass etwas kaputtgeht.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const rufe = [];
const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
await page.route('**/api/**', route => {
  const req = route.request(), u = req.url().split('/api/')[1].split('?')[0];
  let body = null;
  try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch {}
  rufe.push({ u, body });
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (u.includes('login')) return send({ status: 'ok', token: 't', name: 'm.muster', ist_admin: false });
  if (u.includes('rapport_create')) return send({ status: 'ok', netto_h: 7.5 });
  return send({ status: 'ok', rapporte: [], mitarbeiter: [], kunden: [], objekte: [] });
});
await page.goto(`file://${WURZEL}/index.html`);
await page.waitForTimeout(600);

// ══════════════════════════════════════════ ANMELDUNG
check('Die Anmeldung liegt vor dem Formular', await page.isVisible('#loginScreen'));
await page.fill('#loginName', 'm.muster');
await page.fill('#loginPassword', 'x');
await page.click('#btn-login');
await page.waitForTimeout(500);
check('Nach der Anmeldung ist das Formular frei',
  await page.evaluate(() => document.getElementById('loginScreen').style.display === 'none'));

// ══════════════════════════════════════════ AUF DEM HANDY BEDIENBAR
//
// Diese drei Messungen sind der Kern dieser Suite. Sie zaehlen ALLE sichtbaren
// Felder und Knoepfe -- nicht eine Auswahl, die beim naechsten neuen Element
// wieder Luecken haette.
const messen = () => page.evaluate(() => {
  const sicht = el => el && el.offsetParent !== null;
  const hoch = el => Math.round(el.getBoundingClientRect().height);
  // Ankreuzfelder sind ausgenommen: Bei ihnen ist die Trefferflaeche das
  // umgebende, anklickbare Feld, nicht das Kaestchen selbst.
  const felder = [...document.querySelectorAll('input, select, textarea')]
    .filter(sicht).filter(e => e.type !== 'checkbox');
  const knoepfe = [...document.querySelectorAll('button, .btn')].filter(sicht);
  return {
    scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    unter16: felder.filter(e => parseFloat(getComputedStyle(e).fontSize) < 16)
      .map(e => e.id || e.tagName),
    felderKlein: felder.filter(e => hoch(e) < 44).map(e => (e.id || e.tagName) + ':' + hoch(e)),
    knoepfeKlein: knoepfe.filter(e => hoch(e) < 44).map(e => (e.id || e.className) + ':' + hoch(e)),
    anzahl: felder.length + knoepfe.length,
  };
});

let m = await messen();
check('Die Messung erfasst ueberhaupt Elemente', m.anzahl > 10);
check('KRITISCH: kein Eingabefeld unter 16px -- sonst zoomt iOS hinein und bleibt dort',
  m.unter16.length === 0);
if (m.unter16.length) { bad.push('unter 16px: ' + m.unter16.join(', ')); }
check('KRITISCH: kein Eingabefeld unter 44px hoch', m.felderKlein.length === 0);
if (m.felderKlein.length) { bad.push('Felder unter 44px: ' + m.felderKlein.join(', ')); }
check('KRITISCH: kein Bedienelement unter 44px hoch', m.knoepfeKlein.length === 0);
if (m.knoepfeKlein.length) { bad.push('Knoepfe unter 44px: ' + m.knoepfeKlein.join(', ')); }
check('Kein Seiten-Scroll bei 390px', m.scroll <= 1);
await page.screenshot({ path: `${OUT}/rt-01-handy.png` });

// Das Unterschriftfeld ist der Grund, warum es diese Seite gibt -- es muss in
// seinen Rahmen passen, sonst laesst sich am Rand nicht unterschreiben.
check('Das Unterschriftfeld laeuft nicht aus seinem Rahmen',
  await page.evaluate(() => {
    const c = document.getElementById('sigCanvas');
    return c.getBoundingClientRect().right <= c.parentElement.getBoundingClientRect().right + 1;
  }));

// ══════════════════════════════════════════ DASSELBE AM DESKTOP
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(300);
m = await messen();
check('Am Desktop ebenfalls kein Feld unter 16px', m.unter16.length === 0);
check('Am Desktop ebenfalls kein Bedienelement unter 44px',
  m.felderKlein.length === 0 && m.knoepfeKlein.length === 0);
check('Am Desktop kein Seiten-Scroll', m.scroll <= 1);
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);

// ══════════════════════════════════════════ EINSATZART BLEIBT FEST
// Die Regel "nur Verkehrsdienst wird rapportiert" (ENT-082) haengt an dieser
// Zeichenkette. Ein zweites, abweichendes Auswahlfeld an dieser Stelle waere
// eine zweite Wahrheit -- siehe OP-83.
check('Die Einsatzart steht fest auf Verkehrsdienst',
  (await page.inputValue('#einsatzart')) === 'Verkehrsdienst');
check('Sie laesst sich hier nicht umstellen',
  await page.evaluate(() => document.getElementById('einsatzart').readOnly));

// ══════════════════════════════════════════ ERFASSEN GEHT NOCH
// Die Aufraeumarbeit darf den Zweck der Seite nicht beschaedigen.
await page.fill('#kunde', 'Kunde A');
await page.fill('#strasse', 'Dorfstrasse 1');
await page.fill('#ort', '5013 Musterort');
await page.fill('#von', '08:00');
await page.fill('#bis', '16:00');
await page.waitForTimeout(200);
check('Die Nettozeit wird gerechnet und angezeigt',
  /7\.50|7,50/.test(await page.textContent('#netVal')));
await page.evaluate(() => { document.getElementById('confirmCheck').checked = true; });
const vorher = rufe.length;
await page.click('#btn-save');
await page.waitForTimeout(600);
const gesendet = rufe.slice(vorher).find(r => r.u.includes('rapport_create'));
check('KRITISCH: der Rapport laesst sich weiterhin senden', !!gesendet);
check('Die erfassten Angaben gehen mit',
  gesendet && gesendet.body.kunde === 'Kunde A' && gesendet.body.von === '08:00');
check('KRITISCH: der manuelle Rapport traegt keine einsatz_id -- er gehoert zu keiner Schicht',
  gesendet && !gesendet.body.einsatz_id);

await browser.close();

// ══════════════════════════════════════════ KEIN TOTER WORTLAUT
//
// Berechnet, nicht aufgezaehlt: Jeder Schluessel in T muss irgendwo gelesen
// werden. Fuenf lagen verwaist herum, darunter eine Einsatzart-Liste, die
// niemand mehr benutzte -- sie las sich wie eine gueltige zweite Liste neben
// der des Dashboards und war doch nur Rest.
{
  const s = readFileSync(`${WURZEL}/index.html`, 'utf8');
  const esc = k => k.replace(/[-[\]{}()*+?.\\^$|]/g, '\\$&');
  const block = (s.match(/const T = \{([\s\S]*?)\n\};/) || [])[1] || '';
  // ALLE Schluessel, nicht nur der erste je Zeile: Der erste Anlauf dieser
  // Pruefung las `^\s*'...'` und uebersah damit jeden zweiten Eintrag einer
  // Zeile -- zwei verwaiste Schluessel blieben so unentdeckt.
  const schluessel = [...block.matchAll(/'([^']+)'\s*:/g)].map(x => x[1]);
  const rest = s.replace(block, '');
  const verwaist = schluessel.filter(k =>
    !new RegExp(`t\\(\\s*'${esc(k)}'\\s*\\)`).test(rest)
    && !new RegExp(`'${esc(k)}'`).test(rest)
    && !new RegExp(`id="${esc(k)}"`).test(s));
  check('Der Textbestand traegt keine Schluessel mit, die niemand liest',
    verwaist.length === 0);
  if (verwaist.length) { bad.push('verwaiste Textschluessel: ' + verwaist.join(', ')); }
  check('Die Pruefung findet ueberhaupt Schluessel', schluessel.length > 20);

  // Zweite Schicht: Ein Schluessel kann "benutzt" aussehen, weil sein Name in
  // der Beschriftungsliste steht -- waehrend das Element dazu laengst weg ist.
  // So haben acht Reste der entfernten PIN-Funktion ueberlebt: applyLang()
  // ueberspringt fehlende Elemente stillschweigend, es faellt also nie auf.
  const ids = [...((s.match(/const ids = \[([\s\S]*?)\];/) || [])[1] || '')
    .matchAll(/'([^']+)'/g)].map(x => x[1]);
  const htmlIds = new Set([...s.matchAll(/id="([^"]+)"/g)].map(x => x[1]));
  const ohneElement = ids.filter(i => !htmlIds.has(i));
  check('KRITISCH: die Beschriftungsliste nennt nur Elemente, die es gibt',
    ohneElement.length === 0);
  if (ohneElement.length) { bad.push('beschriftet, aber nicht vorhanden: ' + ohneElement.join(', ')); }
  check('Die Pruefung findet ueberhaupt IDs', ids.length > 20);
}

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
