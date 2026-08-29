// Inter als Grundschrift, selbst ausgeliefert (ENT-223/ENT-227, OP-224).
//
// Der Pruefgegenstand ist nicht das Aussehen -- das entscheidet der
// Projektinhaber am Bildschirm -- sondern die drei Eigenschaften, die
// still brechen und dann echten Schaden anrichten:
//
//   1. Faellt body{font-family} auf den System-Stapel zurueck, verschwindet
//      die ganze optische Aufwertung lautlos. Keine Fehlermeldung, kein
//      kaputtes Layout, nur wieder das alte Aussehen.
//   2. Kehrt ein <link href="https://fonts.googleapis.com"> zurueck, geht
//      bei JEDEM Oeffnen des Cockpits die IP-Adresse der bedienenden Person
//      an Google. Sieht identisch aus, niemand merkt es (OP-224).
//   3. Fehlt die Schriftdatei auf dem Server, faellt der Text still auf den
//      System-Stapel zurueck -- lokal sieht alles richtig aus, weil die
//      Datei im Arbeitsverzeichnis ja liegt. Diese dritte Eigenschaft
//      bewacht test_deploy.mjs (CSS-url() im Deploy).
//
// Gemessen wird am gerenderten Zustand (CLAUDE.md), nicht im Quelltext
// nachgelesen: Eine deklarierte font-family beweist nicht, dass die Schrift
// auch zeichnet.
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const URL = `file://${WURZEL}/dashboard.html`;
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const browser = await chromium.launch({ executablePath: browserPfad() });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));

const externeAnfragen = [];
page.on('request', r => { if (/^https?:/.test(r.url())) externeAnfragen.push(r.url()); });

await page.route('**/api/**', r => {
  const p = r.request().url().split('/api/')[1];
  const send = b => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'a', ist_admin: true });
  if (p.includes('dashboard_stats')) return send({ status: 'ok', kpi: {}, verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [] });
  return send({ status: 'ok', mitarbeiter: [], kunden: [], einsaetze: [], objekte: [], rapporte: [] });
});

await page.goto(URL);
await page.evaluate(() => localStorage.clear());
await page.goto(URL);
await page.fill('#gName', 'a'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#kpiGrid .kpi-val');
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(400);

// ══════════ NICHTS GEHT NACH DRAUSSEN
check('KRITISCH: das Cockpit laedt nichts von fremden Servern (OP-224)',
  externeAnfragen.length === 0);
const quelltext = await page.content();
check('KRITISCH: kein Verweis auf Google Fonts im Quelltext',
  !quelltext.includes('fonts.googleapis.com') && !quelltext.includes('fonts.gstatic.com'));

// ══════════ INTER ZEICHNET WIRKLICH
const schrift = await page.evaluate(() => {
  const c = document.createElement('canvas').getContext('2d');
  const mess = f => { c.font = `32px ${f}, monospace`; return c.measureText('Handgloves 123').width; };
  return {
    geladen: [...document.fonts].some(f => f.family === 'Inter' && f.status === 'loaded'),
    zeichnet: mess('Inter') !== mess('KeineSolcheSchrift'),
    deklariert: getComputedStyle(document.body).fontFamily,
    schnitte: [...document.fonts].filter(f => f.family === 'Inter').length,
    geladeneSchnitte: [...document.fonts].filter(f => f.family === 'Inter' && f.status === 'loaded').length,
  };
});
check('KRITISCH: Inter ist im Normalbetrieb geladen (ENT-227)', schrift.geladen);
check('KRITISCH: Inter zeichnet wirklich, der System-Stapel greift nicht heimlich',
  schrift.zeichnet);
check('Inter steht an erster Stelle der Grundschrift',
  /^\s*(['"]?)Inter\1\s*,/.test(schrift.deklariert));
check('Hinter Inter steht ein echter System-Rueckfall, keine nackte sans-serif',
  /-apple-system|BlinkMacSystemFont|system-ui|Segoe UI/.test(schrift.deklariert));

// Zwei Schnitte sind deklariert (latin, latin-ext), aber bei deutschem Text
// braucht der Browser nur einen. Das ist der Sinn der unicode-range-Teilung:
// latin-ext (85 KB) bleibt ungeladen, solange kein Zeichen daraus vorkommt.
// Es ist trotzdem deklariert, weil sonst ein einzelner Name mit c/s/z/l-Haken
// in eine andere Schrift fiele und kaputt aussaehe, waehrend alles andere stimmt.
check('Beide Schnitte sind deklariert (latin und latin-ext)', schrift.schnitte === 2);
check('Bei deutschem Text laedt nur der noetige Schnitt -- latin-ext bleibt liegen',
  schrift.geladeneSchnitte === 1);

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden`);
if (bad.length) { bad.forEach(n => console.log('  ✗ ' + n)); process.exit(1); }
console.log('\nAlle Pruefungen bestanden.');
