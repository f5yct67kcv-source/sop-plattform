// Was die Anmeldemasken laden, und wann (2026-10-14).
//
// Anlass: Im Browser gemessen lud die Anmeldung des Cockpits auf einer
// langsamen Leitung 25 s -- das Hintergrundvideo (rund 250 KB) und das
// CUPI-24-Siegel (337 KB) liefen gleichzeitig mit der Seite selbst und
// teilten sich mit ihr die Bandbreite. Geprueft wird am echten
// Netzwerkverkehr, nicht am Quelltext:
//
//   1. Am Desktop wird das Video erst NACH dem Laden der Seite angefragt.
//   2. In Handy-Breite wird es gar nicht angefragt (das CSS blendet es aus).
//   3. Wird das Fenster danach breiter, kommt es doch -- sonst bliebe ein
//      gedrehtes Tablet ohne Video, und genau das hat die erste Fassung
//      dieser Aenderung falsch gemacht.
//   4. Das Siegel ist klein genug fuer eine Anmeldemaske und gross genug
//      fuer scharfe Darstellung (angezeigt hoechstens 170 px breit).
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { readFileSync, statSync } from 'fs';
import { join } from 'path';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);
const browser = await chromium.launch({ executablePath: browserPfad() });
const istVideo = u => /anmeldung-nacht\.(webm|mp4)/.test(u);

// Die Seite haelt ihr "load" kuenstlich zurueck: Das Hintergrundfoto (CSS)
// antwortet erst nach 1 s. Faengt das Video vor "load" an, sieht man es
// hier an der Reihenfolge.
async function oeffnen(seite, breite) {
  const page = await browser.newPage({ viewport: { width: breite, height: 900 } });
  const ereignisse = [];
  page.on('pageerror', e => bad.push(`JS-Fehler in ${seite}: ${e.message}`));
  await page.route('**/img/anmeldung-nacht.webp', async route => {
    await new Promise(r => setTimeout(r, 1000));
    route.continue();
  });
  await page.route('**/api/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok"}' }));
  page.on('request', r => { if (istVideo(r.url())) ereignisse.push('video'); });
  await page.exposeFunction('__geladen', () => ereignisse.push('load'));
  await page.addInitScript(() => window.addEventListener('load', () => window.__geladen()));
  await page.goto(`file://${join(WURZEL, seite)}`, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  return { page, ereignisse };
}

for (const seite of ['dashboard.html', 'app.html', 'portal.html']) {
  // 1. Desktop: Video kommt, aber erst nach "load"
  let { page, ereignisse } = await oeffnen(seite, 1400);
  const iLoad = ereignisse.indexOf('load'), iVideo = ereignisse.indexOf('video');
  check(`${seite}: am Desktop wird das Video geladen`, iVideo >= 0);
  check(`KRITISCH: ${seite} -- das Video wird erst nach dem Laden der Seite angefragt, nicht gleichzeitig`,
    iLoad >= 0 && iVideo > iLoad);
  await page.close();

  // 2. + 3. Handy-Breite: kein Video -- bis das Fenster breiter wird
  ({ page, ereignisse } = await oeffnen(seite, 390));
  await page.waitForTimeout(600);
  check(`KRITISCH: ${seite} -- in Handy-Breite wird das Video nicht angefragt`, !ereignisse.includes('video'));
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.waitForTimeout(600);
  check(`KRITISCH: ${seite} -- wird das Fenster breiter, kommt das Video doch`, ereignisse.includes('video'));
  const quellen = await page.evaluate(() => document.querySelectorAll('.gate-video source').length);
  check(`${seite}: … und zwar genau einmal, nicht bei jedem Groessenwechsel neu`, quellen === 2);
  await page.setViewportSize({ width: 1300, height: 900 });
  await page.waitForTimeout(200);
  check(`${seite}: ein weiterer Groessenwechsel haengt keine Quellen dazu`,
    await page.evaluate(() => document.querySelectorAll('.gate-video source').length) === 2);
  await page.close();
}
await browser.close();

// 4. Das Siegel: Dateigroesse und Pixelmass aus dem PNG-Kopf gelesen
const SIEGEL = join(WURZEL, 'icons/cupi24-badge.png');
const kopf = readFileSync(SIEGEL);
const breite = kopf.readUInt32BE(16), hoehe = kopf.readUInt32BE(20);
const kb = Math.round(statSync(SIEGEL).size / 1024);
check(`KRITISCH: das CUPI-24-Siegel ist klein genug fuer eine Anmeldemaske (${kb} KB, hoechstens 60)`, kb <= 60);
// Angezeigt hoechstens 170 px breit (gate-oben .marke, Deploy-Schritt
// cupi24); bei doppelter Pixeldichte braucht es 340 px, sonst wird es unscharf.
check(`Das Siegel ist gross genug fuer scharfe Darstellung (${breite}×${hoehe}, mindestens 340)`,
  breite >= 340 && hoehe >= 340);

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
