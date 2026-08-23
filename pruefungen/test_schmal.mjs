import { WURZEL, HIER, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
await page.route('**/api/**', route => {
  const p = route.request().url().split('/api/')[1].split('?')[0];
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'adrian', ist_admin: true });
  if (p.includes('dashboard_stats')) return send({ status: 'ok', kpi: { rapporte_monat: 0, rapporte_vormonat: 0, stunden_monat: 0, stunden_vormonat: 0, mitarbeiter: 1, kunden: 0, rapporte_total: 0 }, verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [] });
  if (p.includes('objekt_list')) return send({ status: 'ok', objekte: [] });
  if (p.includes('feiertage_list')) return send({ status: 'ok', feiertage: [], gepflegt: {} });
  if (p.includes('einsatz_list')) return send({ status: 'ok', einsaetze: [] });
  if (p.includes('mitarbeiter_list')) return send({ status: 'ok', mitarbeiter: [] });
  if (p.includes('kunden_list')) return send({ status: 'ok', kunden: [] });
  if (p.includes('rapport_list')) return send({ status: 'ok', rapporte: [] });
  return send({ status: 'ok' });
});

const url = `file://${WURZEL}/dashboard.html`;
await page.goto(url);
await page.fill('#gName', 'a'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#kpiGrid .kpi-val');

const breite = () => page.$eval('#side', e => e.getBoundingClientRect().width);
const arbeitsflaeche = () => page.$eval('.main', e => e.getBoundingClientRect().width);

check('Knopf ist da', await page.isVisible('#btnSchmal'));
const b1 = await breite(), a1 = await arbeitsflaeche();
check('Leiste startet breit', Math.round(b1) === 232);
check('Beschriftungen sichtbar', await page.isVisible('#nav-planung .lbl'));
check('Gruppenueberschrift sichtbar', await page.isVisible('.nav-lbl'));

await page.click('#btnSchmal');
await page.waitForTimeout(250);
const b2 = await breite(), a2 = await arbeitsflaeche();
check('Leiste wird schmal', Math.round(b2) === 64);
check('Arbeitsflaeche waechst', a2 > a1 + 150);
check('Beschriftungen ausgeblendet', !(await page.isVisible('#nav-planung .lbl')));
check('Symbol bleibt sichtbar', await page.isVisible('#nav-planung svg'));
check('Navigation weiter benutzbar', await page.isVisible('#nav-planung'));
check('Gruppenueberschrift ausgeblendet', !(await page.isVisible('.nav-lbl')));
check('Markenschrift ausgeblendet', !(await page.isVisible('.side-brand .txt')));
check('Benutzername ausgeblendet', !(await page.isVisible('.side-user .who')));
check('Titel verraet den Zweck', (await page.getAttribute('#nav-planung', 'title')) === 'Planung');
check('Kein Seiten-Scroll im schmalen Modus', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
await page.screenshot({ path: `${OUT}/36-schmal.png` });

// Navigation funktioniert eingeklappt weiter
await page.click('#nav-planung');
await page.waitForTimeout(300);
check('Klick auf Symbol wechselt den Bereich', (await page.textContent('#pgTitle')) === 'Planung');

// Wahl bleibt nach dem Neuladen erhalten
await page.reload();
await page.waitForSelector('#shell.on');
await page.waitForTimeout(300);
check('Schmal bleibt nach dem Neuladen', Math.round(await breite()) === 64);

// Seit ENT-086 hat der Knopf DREI Zustaende: 232 -- 64 -- Kopfleiste.
// Der zweite Klick blendet die Leiste also aus, statt sie aufzuklappen;
// erst der dritte fuehrt zurueck. Die Absicht dieser beiden Pruefungen
// bleibt dieselbe: Der Zustand muss umkehrbar sein und das Neuladen
// ueberleben. Nur die Zahl der Klicks hat sich geaendert.
await page.click('#btnSchmal');
await page.waitForTimeout(250);
check('Der zweite Klick blendet die Leiste aus (ENT-086)', Math.round(await breite()) === 1440);
await page.click('#btnSchmal');
await page.waitForTimeout(250);
check('KRITISCH: der dritte Klick fuehrt zurueck zur vollen Leiste', Math.round(await breite()) === 232);
await page.reload();
await page.waitForSelector('#shell.on');
await page.waitForTimeout(300);
check('Breit bleibt nach dem Neuladen', Math.round(await breite()) === 232);

// Auf schmalen Geraeten aendert der Modus nichts an der Burger-Logik
await page.click('#btnSchmal');
await page.waitForTimeout(200);
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(350);
check('Knopf auf dem Handy ausgeblendet', !(await page.isVisible('#btnSchmal')));
// Seit ENT-059 ist die Leiste auf dem Handy ein Aufklappmenue unter der
// Kopfzeile, kein Seitenpanel. "Eingeklappt" heisst darum unsichtbar, nicht
// "links ausserhalb des Bildes".
check('Leiste auf dem Handy zunaechst zu',
  await page.evaluate(() => getComputedStyle(document.getElementById('side')).visibility === 'hidden'));
await page.click('.btn-burger');
await page.waitForTimeout(400);
check('Burger oeffnet das Menue',
  await page.evaluate(() => document.getElementById('side').classList.contains('on')));
check('Es nimmt auf dem Handy die volle Breite',
  await page.evaluate(() => Math.abs(document.getElementById('side').getBoundingClientRect().width - innerWidth) <= 1));
check('Beschriftungen auf dem Handy sichtbar', await page.isVisible('#nav-planung .lbl'));

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
