// Auswertung > "Arbeitsergebnisse" (ENT-243): Schublade mit sieben Reitern,
// analog zur Kachel "Rundgaenge" (ENT-242) -- volles Geruest, aber nur
// "Kontrollpunktscans" und "Rundgangerledigung" tatsaechlich verdrahtet. Die
// uebrigen fuenf (Wachbuch, Ereignisse, Aufgabenerledigung, Alarme,
// Schluesselprotokoll) haben noch kein Datenmodell und zeigen einen
// bleibenden Hinweis statt nichts zu tun.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const SEITE = `file://${WURZEL}/dashboard.html`;
const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

// Relative Daten statt fester Werte -- kippt sonst beim Datumswechsel
// (CLAUDE.md, test_datumsfest.mjs).
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const vorTagen = n => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };
const T0 = vorTagen(0), T1 = vorTagen(1), T2 = vorTagen(2);

const SCANS = { status: 'ok', scans: [
  { id: 1, erfasst_am: `${T2} 20:04:00`, status: 'bestaetigt', beschreibung: null,
    kontrollpunkt_name: 'Eingang', kunde_name: 'Muster Liegenschaften AG', objekt_name: 'Testliegenschaft Nord',
    titel: 'Öffnungsrunde', vorname: 'Erika', nachname: 'Muster' },
  { id: 2, erfasst_am: `${T1} 21:10:00`, status: 'nicht_verfuegbar', beschreibung: null,
    kontrollpunkt_name: 'Keller', kunde_name: 'Muster Liegenschaften AG', objekt_name: 'Testliegenschaft Nord',
    titel: 'Öffnungsrunde', vorname: 'Erika', nachname: 'Muster' },
  { id: 3, erfasst_am: `${T0} 22:15:00`, status: 'ersatzscan', beschreibung: 'NFC-Chip defekt, Foto beigelegt',
    kontrollpunkt_name: 'Garage', kunde_name: 'Beispiel Immobilien GmbH', objekt_name: 'Testliegenschaft Süd',
    titel: null, vorname: 'Hans', nachname: 'Beispiel' },
]};

const RUNDGAENGE = { status: 'ok', rundgaenge: [
  { id: 10, einsatz_id: 1, objekt_id: 1, mitarbeiter_id: 5, status: 'abgeschlossen',
    rohzeit_start: `${T2} 20:04:00`, rohzeit_ende: `${T2} 20:41:00`, datum: T2,
    kunde_name: 'Muster Liegenschaften AG', objekt_name: 'Testliegenschaft Nord', titel: 'Öffnungsrunde',
    vorname: 'Erika', nachname: 'Muster', fortschritt: { gesamt: 3, bestaetigt: 3, nicht_verfuegbar: 0 } },
]};

let calls = [];

function setup(page) {
  return page.route('**/api/**', async route => {
    const req = route.request();
    const u = new URL(req.url());
    const path = u.pathname.split('/api/')[1];
    calls.push({ path, query: Object.fromEntries(u.searchParams) });
    const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (path.includes('login')) return send({ status: 'ok', token: 't', name: 'adrian', ist_admin: true });
    if (path.includes('dashboard_stats')) return send({ status: 'ok', kpi: {}, verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [] });
    if (path.includes('rundgang_scan_liste')) return send(SCANS);
    if (path.includes('rundgang_liste')) return send(RUNDGAENGE);
    if (path.includes('mitarbeiter_list')) return send({ status: 'ok', mitarbeiter: [] });
    // kontrolleNavKlick() landet auf Pensen -- ohne dieses Fixture crasht
    // zeichnePensen() auf pensen.mitarbeiter.map() (gleiches Muster wie in
    // test_rundgaenge_verwaltung.mjs). Nicht der Pruefgegenstand hier.
    if (path.includes('pensen.php')) return send({ status: 'ok', jahr: 2026, mitarbeiter: [] });
    return send({ status: 'ok' });
  });
}

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));

await setup(page);
await page.goto(SEITE);
await page.evaluate(() => localStorage.clear());
await page.goto(SEITE);
await page.fill('#gName', 'adrian'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#kpiGrid .kpi-val');

// Gruppe oeffnen (wie zurEinrichtung() in test_kontrollpunkte.mjs), dann den
// neuen Menuepunkt anklicken.
await page.evaluate(() => {
  if (!document.getElementById('navg-kontrolle').classList.contains('offen')) {
    document.getElementById('nav-kontrolle').click();
  }
});
await page.waitForTimeout(150);
check('Der Menuepunkt "Arbeitsergebnisse" ist sichtbar', await page.isVisible('#nav-kontrolle-arbeitsergebnisse'));

calls = [];
await page.click('#nav-kontrolle-arbeitsergebnisse');
await page.waitForSelector('#drawer.on');
check('Der Schubladentitel lautet "Arbeitsergebnisse"', await page.textContent('#drTitle') === 'Arbeitsergebnisse');

// ══════════ ALLE SIEBEN REITER IN DER VORGEGEBENEN REIHENFOLGE
const reiter = await page.$$eval('#aeTabs button', els => els.map(e => e.textContent.trim()));
check('KRITISCH: alle sieben Reiter stehen da, in der vorgegebenen Reihenfolge', JSON.stringify(reiter) ===
  JSON.stringify(['Wachbuch', 'Kontrollpunktscans', 'Ereignisse', 'Rundgangerledigung', 'Aufgabenerledigung', 'Alarme', 'Schlüsselprotokoll']));
check('"Wachbuch" ist der voreingestellte Reiter', await page.evaluate(() => document.getElementById('ae-tab-wachbuch').classList.contains('on')));

// ══════════ UNVERDRAHTETE REITER: BLEIBENDER HINWEIS, KEIN TOAST
check('KRITISCH: "Wachbuch" zeigt einen bleibenden Hinweis statt nichts zu tun',
  (await page.textContent('#aeInhalt')).includes('Folgt in einem späteren Schritt.'));
check('Kein API-Aufruf fuer einen unverdrahteten Reiter', calls.length === 0);

// ══════════ KONTROLLPUNKTSCANS: ECHTE DATEN, DREI STATUS-ARTEN
await page.click('#ae-tab-scans');
await page.waitForTimeout(200);
check('KRITISCH: "Kontrollpunktscans" ruft rundgang_scan_liste.php auf', calls.some(c => c.path.includes('rundgang_scan_liste')));
const scanRuf = calls.find(c => c.path.includes('rundgang_scan_liste'));
check('KRITISCH: Vorgabe ist der zurückliegende Monat bis heute (wie Auslagenersatz, ENT-045)',
  !!scanRuf.query.von && !!scanRuf.query.bis && scanRuf.query.von !== scanRuf.query.bis);
const scanInhalt = await page.textContent('#aeInhalt');
check('Alle drei Status-Arten erscheinen', scanInhalt.includes('Bestätigt') && scanInhalt.includes('Nicht verfügbar') && scanInhalt.includes('Ersatzscan'));
check('Die Bemerkung eines Ersatzscans erscheint', scanInhalt.includes('NFC-Chip defekt'));
check('Kunde/Objekt/Kontrollpunkt/Mitarbeiter je Scan erscheinen',
  scanInhalt.includes('Muster Liegenschaften AG') && scanInhalt.includes('Testliegenschaft Nord')
  && scanInhalt.includes('Eingang') && scanInhalt.includes('Muster, Erika'));
check('KRITISCH: keine Spalte bleibt in der schmalen Schublade unsichtbar -- Karten statt einer zu breiten Tabelle (ENT-243)',
  await page.evaluate(() => {
    const inhalt = document.getElementById('aeInhalt');
    return inhalt.scrollWidth <= inhalt.clientWidth + 1 && !inhalt.querySelector('table');
  }));

// Leerer Zeitraum
await page.route('**/api/rundgang_scan_liste.php**', route =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', scans: [] }) }));
await page.evaluate(() => aeLadeScans());
await page.waitForTimeout(150);
check('KRITISCH: kein Scan im Zeitraum sagt das explizit', (await page.textContent('#aeInhalt')).includes('Nichts vorhanden'));

// ══════════ RUNDGANGERLEDIGUNG: ECHTE DATEN, EIGENER LEERTEXT
calls = [];
await page.click('#ae-tab-erledigung');
await page.waitForTimeout(200);
check('KRITISCH: "Rundgangerledigung" ruft rundgang_liste.php auf', calls.some(c => c.path.includes('rundgang_liste')));
const erlRuf = calls.find(c => c.path.includes('rundgang_liste'));
check('Auch hier: Vorgabe ist der zurückliegende Monat bis heute', !!erlRuf.query.von && erlRuf.query.von !== erlRuf.query.bis);
const erlInhalt = await page.textContent('#aeInhalt');
check('Der Rundgang aus dem Zeitraum erscheint', erlInhalt.includes('Öffnungsrunde') && erlInhalt.includes('3/3'));
check('KRITISCH: auch hier Karten statt einer zu breiten Tabelle',
  await page.evaluate(() => {
    const inhalt = document.getElementById('aeInhalt');
    return inhalt.scrollWidth <= inhalt.clientWidth + 1 && !inhalt.querySelector('table');
  }));

await page.route('**/api/rundgang_liste.php**', route =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', rundgaenge: [] }) }));
await page.evaluate(() => aeLadeErledigung());
await page.waitForTimeout(150);
check('KRITISCH: kein Rundgang im Zeitraum sagt das mit eigenem Text (nicht "in den letzten 14 Tagen", das gilt nur der Kachel)',
  (await page.textContent('#aeInhalt')).includes('Im gewählten Zeitraum liegt kein Rundgang vor.'));

// ══════════ ZURUECK ZU EINEM UNVERDRAHTETEN REITER: KEIN HAENGENBLEIBEN
await page.click('#ae-tab-ereignisse');
await page.waitForTimeout(100);
check('"Ereignisse" zeigt ebenfalls den bleibenden Hinweis', (await page.textContent('#aeInhalt')).includes('Folgt in einem späteren Schritt.'));
check('Der Reiter "Ereignisse" ist jetzt aktiv, "Rundgangerledigung" nicht mehr',
  await page.evaluate(() => document.getElementById('ae-tab-ereignisse').classList.contains('on')
    && !document.getElementById('ae-tab-erledigung').classList.contains('on')));

check('KRITISCH: kein Seiten-Scroll am Desktop',
  await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
await page.screenshot({ path: `${OUT}/ae-01-desktop.png` });

// ══════════ HANDY (CLAUDE.md: jede Aenderung zusaetzlich am Handy pruefen)
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(200);
check('KRITISCH: kein Seiten-Scroll bei 390px', await page.evaluate(() =>
  document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
check('KRITISCH: alle sieben Reiter bleiben ohne Kuerzung sichtbar (senkrechte Liste statt schmaler Kopfzeilen-Reiter, ENT-243)',
  await page.evaluate(() => [...document.querySelectorAll('#aeTabs button')].every(b => b.getClientRects().length && b.getBoundingClientRect().width <= document.getElementById('drawer').getBoundingClientRect().width)));
check('KRITISCH: jeder Reiter ist auf dem Handy mindestens 44 px hoch (CLAUDE.md)',
  await page.evaluate(() => [...document.querySelectorAll('#aeTabs button')].every(b => b.getBoundingClientRect().height >= 44)));
await page.click('#ae-tab-erledigung');
await page.waitForTimeout(150);
check('Der gewaehlte Reiter laedt auch auf dem Handy', (await page.textContent('#aeInhalt')).includes('Im gewählten Zeitraum liegt kein Rundgang vor.'));
await page.screenshot({ path: `${OUT}/ae-02-mobil.png` });

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
