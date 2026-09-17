// Kopfzeile am Handy: Titel darf nicht unter die Kerbe (Notch/Dynamic
// Island) rutschen. So verletzt (2026-09-17, Bildschirmfoto im Simulator):
// ".topbar { padding: 0 16px; }" stand in @media (max-width: 900px) NACH
// "padding: env(safe-area-inset-top) 26px 0" -- gleiche Eigenspezifitaet
// (".topbar" gegen ".topbar"), spaetere Regel gewinnt. Die Kopfzeile blieb
// zwar um die Kerbe hoeher (height waechst weiter um
// env(safe-area-inset-top)), verlor aber den Abstand, der den Titel
// darunter schiebt.
//
// env(safe-area-inset-top) ist im Testbrowser IMMER 0 (kein echtes Geraet,
// keine Kerbe) -- eine Pruefung, die sich darauf verlaesst, waere immer
// gruen, ganz gleich ob die Regel greift. Darum wird env() hier textuell
// gegen einen festen Wert getauscht (eine Kerbe von 59px, wie beim iPhone
// mit Dynamic Island) und als spaeteres <style> nachgeschoben -- danach
// zeigt sich der reale Unterschied.
//
// Zweite Sache auf demselben Bildschirmfoto: das Diktierfeld im
// Begruessungs-Widget schnitt eingegebenen Text ab, weil es am Handy
// dieselbe feste Zweizeilen-Hoehe hatte wie am Desktop (ENT-432 -- dort
// ausdruecklich so gewollt). Am Handy gibt es keinen brauchbaren Ziehgriff;
// das Feld waechst dort jetzt automatisch mit dem Inhalt (rtFeldWaechst),
// bis zu einer Obergrenze, danach rollt es in sich selbst weiter.
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));

await page.route('**/api/**', r => {
  const u = r.request().url();
  const send = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) });
  if (u.includes('login')) return send({ status: 'ok', token: 't', name: 'dario.beispiel', ist_admin: true });
  if (u.includes('dashboard_stats')) {
    return send({ status: 'ok', kpi: {}, verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [] });
  }
  return send({ status: 'ok', mitarbeiter: [], kunden: [], einsaetze: [], objekte: [],
    rapporte: [], rundgaenge: [], ereignisse: [], produkte: [], belege: [], monat: { anzahl: 0, stunden: 0 },
    profil: { name: 'dario.beispiel', ist_admin: true, vorname: 'Dario', nachname: 'Beispiel' } });
});

await page.goto(`file://${WURZEL}/dashboard.html`);
await page.fill('#gName', 'dario.beispiel'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#shell.on');
await page.waitForTimeout(500);

// ══════════════ 1. TITEL UNTER DER (NACHGESTELLTEN) KERBE ═════════════
const KERBE = 59; // px, wie beim iPhone mit Dynamic Island
await page.evaluate(kerbe => {
  const alle = [...document.querySelectorAll('style')].map(s => s.textContent).join('\n');
  const gefaelscht = alle.replace(/env\(safe-area-inset-top\)/g, kerbe + 'px');
  const s = document.createElement('style');
  s.textContent = gefaelscht;
  document.head.appendChild(s);
}, KERBE);
await page.waitForTimeout(150);

const kopf = await page.evaluate(() => {
  const titel = document.getElementById('pgTitle').getBoundingClientRect();
  return { titelTop: titel.top };
});
check('KRITISCH: Der Seitentitel steht unter der Kerbe, nicht darin',
  kopf.titelTop >= KERBE);

// ══════════════ 2. DIKTIERFELD WAECHST MIT DEM TEXT (am Handy) ═════════
const vorHoehe = await page.evaluate(() => document.getElementById('rtText').getBoundingClientRect().height);
check('Ungefuellt: die feste Ausgangshoehe (2 Zeilen, ENT-432)',
  Math.round(vorHoehe) === 64);

await page.fill('#rtText',
  'Neuer Einsatz für die Beispiel AG, Montag bis Freitag jeweils von sieben ' +
  'bis sechzehn Uhr, Objekt Lagerhalle Nord, zusätzlich Wochenendbereitschaft.');
await page.dispatchEvent('#rtText', 'input');
await page.waitForTimeout(150);
const nachHoehe = await page.evaluate(() => document.getElementById('rtText').getBoundingClientRect().height);
check('KRITISCH: Mehr Text als Platz -- das Feld waechst, statt abzuschneiden',
  nachHoehe > vorHoehe + 20);

await page.fill('#rtText', '');
await page.dispatchEvent('#rtText', 'input');
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); await browser.close(); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
await browser.close();
