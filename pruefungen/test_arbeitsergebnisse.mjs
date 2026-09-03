// Auswertung > "Arbeitsergebnisse" (ENT-243, umgebaut in ENT-325): eine
// eigene Ansicht mit derselben Kachelreihe wie "Kontrollrunde ändern"
// (.rdkr-reiter/.rdkr-tab), nicht mehr eine Schublade mit einer senkrechten
// Reiterliste. Volles Gerüst, aber nur "Kontrollpunktscans" und
// "Rundgangerledigung" tatsächlich verdrahtet; die übrigen fünf haben noch
// kein Datenmodell und sagen das sichtbar, statt auszusehen wie die anderen
// und dann nichts zu zeigen.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const SEITE = `file://${WURZEL}/dashboard.html`;
const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);
// Klicken mit kurzer Frist und ohne Absturz: Fehlt ein Reiter, weil eine
// Gegenprobe ihn entfernt hat, wartete page.click() dreissig Sekunden und
// riss die Suite mit. Rot war sie dadurch zwar, aber die Zusammenfassung mit
// den BENANNTEN Aussagen kam nie -- und genau die braucht man.
async function klick(sel) {
  try { await page.click(sel, { timeout: 3000 }); return true; }
  catch (e) { bad.push('nicht anklickbar: ' + sel); return false; }
}

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
await klick('#nav-kontrolle-arbeitsergebnisse');
try { await page.waitForSelector('#view-arbeitsergebnisse.on', { timeout: 3000 }); }
catch (e) { bad.push('Die Ansicht öffnet sich nicht'); }
// Seit ENT-325 eine eigene Ansicht: Der Titel steht in der Kopfzeile der
// Seite, nicht in einem Schubladenkopf.
check('KRITISCH: es öffnet sich eine eigene Ansicht, keine Schublade',
  await page.evaluate(() => !document.getElementById('drawer').classList.contains('on')));
check('Der Seitentitel lautet "Arbeitsergebnisse"',
  await page.textContent('#pgTitle') === 'Arbeitsergebnisse');
// Man soll in der Navigation sehen, wo man steht -- als Schublade gab es
// diese Markierung nicht.
check('Der Menüpunkt ist als aktiv markiert',
  await page.evaluate(() => document.getElementById('nav-kontrolle-arbeitsergebnisse').classList.contains('on')));

// ══════════ ALLE SIEBEN KACHELN IN DER VORGEGEBENEN REIHENFOLGE
const reiter = await page.$$eval('#aeReiter .rdkr-tab .rdkr-tab-lbl', els => els.map(e => e.textContent.trim()));
check('KRITISCH: alle sieben Reiter stehen da, in der vorgegebenen Reihenfolge', JSON.stringify(reiter) ===
  JSON.stringify(['Wachbuch', 'Kontrollpunktscans', 'Ereignisse', 'Rundgangerledigung', 'Aufgabenerledigung', 'Alarme', 'Schlüsselprotokoll']));
// Dasselbe Muster wie "Kontrollrunde ändern" -- ein zweites Reiter-Aussehen
// im Haus für dieselbe Sache wäre eine zweite Sprache.
check('KRITISCH: sie benutzen dieselbe Kachelreihe wie "Kontrollrunde ändern"',
  await page.evaluate(() => {
    const r = document.getElementById('aeReiter');
    return r.classList.contains('rdkr-reiter')
      && r.querySelectorAll('.rdkr-tab').length === 7;
  }));
check('Jede Kachel trägt ein Sinnbild',
  await page.evaluate(() =>
    [...document.querySelectorAll('#aeReiter .rdkr-tab')].every(b => b.querySelector('.rdkr-tab-ic svg'))));
// Die Seite startet auf dem ersten Reiter, der wirklich etwas zeigt --
// auf einem dauerhaft leeren zu landen wäre ein schlechter erster Eindruck.
// Über einen Zugriff mit Rückfall statt direkt: Fehlt die Kachel, soll die
// Suite SAGEN, welche Aussage nicht mehr stimmt, statt in der Seite mit
// „classList of null" abzustürzen -- beim Gegenprobieren aufgefallen.
check('KRITISCH: die Ansicht startet auf einem verdrahteten Reiter',
  await page.evaluate(() => {
    const e = document.getElementById('ae-tab-scans');
    return !!e && e.classList.contains('aktiv');
  }));
// „Unbekannt darf nie wie keine aussehen": Ein Reiter, der aussieht wie die
// anderen und dann nichts zeigt, ist derselbe Fehler.
check('KRITISCH: die noch nicht verdrahteten Reiter sagen das schon an der Kachel',
  await page.evaluate(() => {
    const mit = ['wachbuch', 'ereignisse', 'aufgaben', 'alarme', 'schluessel'];
    const ohne = ['scans', 'erledigung'];
    const txt = t => { const e = document.getElementById('ae-tab-' + t); return e ? e.textContent : null; };
    return mit.every(t => (txt(t) || '').includes('folgt'))
      && ohne.every(t => txt(t) !== null && !txt(t).includes('folgt'));
  }));

// ══════════ UNVERDRAHTETE REITER: BLEIBENDER HINWEIS, KEIN TOAST
calls = [];
await klick('#ae-tab-wachbuch');
await page.waitForTimeout(150);
// Der Name steht im Hinweis: Zwei Reiter hintereinander angetippt zeigten
// sonst zweimal denselben Satz, und man wüsste nicht, ob sich etwas tat.
check('KRITISCH: "Wachbuch" zeigt einen bleibenden Hinweis statt nichts zu tun',
  (await page.textContent('#aeInhalt')).includes('Wachbuch folgt später'));
check('Kein API-Aufruf fuer einen unverdrahteten Reiter', calls.length === 0);

// ══════════ KONTROLLPUNKTSCANS: ECHTE DATEN, DREI STATUS-ARTEN
await klick('#ae-tab-scans');
await page.waitForTimeout(200);
check('KRITISCH: "Kontrollpunktscans" ruft rundgang_scan_liste.php auf', calls.some(c => c.path.includes('rundgang_scan_liste')));
// Mit Rückfall auf ein leeres Objekt: Kam der Aufruf gar nicht, soll die
// Suite das als eigene Aussage melden und nicht abstürzen.
const scanRuf = calls.find(c => c.path.includes('rundgang_scan_liste')) || { query: {} };
check('KRITISCH: Vorgabe ist der zurückliegende Monat bis heute (wie Auslagenersatz, ENT-045)',
  !!scanRuf.query.von && !!scanRuf.query.bis && scanRuf.query.von !== scanRuf.query.bis);
const scanInhalt = await page.textContent('#aeInhalt');
check('Alle drei Status-Arten erscheinen', scanInhalt.includes('Bestätigt') && scanInhalt.includes('Nicht verfügbar') && scanInhalt.includes('Ersatzscan'));
check('Die Bemerkung eines Ersatzscans erscheint', scanInhalt.includes('NFC-Chip defekt'));
check('Kunde/Objekt/Kontrollpunkt/Mitarbeiter je Scan erscheinen',
  scanInhalt.includes('Muster Liegenschaften AG') && scanInhalt.includes('Testliegenschaft Nord')
  && scanInhalt.includes('Eingang') && scanInhalt.includes('Muster, Erika'));
// Karten statt Tabelle stammen aus der Schubladenzeit (ENT-243). Sie
// bleiben: Ein Scan hat wenige Angaben, und die Karte trägt sie auf dem
// Handy wie am Desktop ohne waagrechten Scroll.
check('KRITISCH: kein waagrechter Scroll im Inhalt -- Karten statt einer zu breiten Tabelle',
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
await klick('#ae-tab-erledigung');
await page.waitForTimeout(200);
check('KRITISCH: "Rundgangerledigung" ruft rundgang_liste.php auf', calls.some(c => c.path.includes('rundgang_liste')));
const erlRuf = calls.find(c => c.path.includes('rundgang_liste')) || { query: {} };
check('Auch hier: Vorgabe ist der zurückliegende Monat bis heute', !!erlRuf.query.von && erlRuf.query.von !== erlRuf.query.bis);
const erlInhalt = await page.textContent('#aeInhalt');
check('Der Rundgang aus dem Zeitraum erscheint', erlInhalt.includes('Öffnungsrunde') && erlInhalt.includes('3/3'));
check('KRITISCH: auch hier Karten ohne waagrechten Scroll',
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
await klick('#ae-tab-ereignisse');
await page.waitForTimeout(100);
check('"Ereignisse" zeigt ebenfalls den bleibenden Hinweis',
  (await page.textContent('#aeInhalt')).includes('Ereignisse folgt später'));
check('Der Reiter "Ereignisse" ist jetzt aktiv, "Rundgangerledigung" nicht mehr',
  await page.evaluate(() => {
    const a = document.getElementById('ae-tab-ereignisse'), b = document.getElementById('ae-tab-erledigung');
    return !!a && !!b && a.classList.contains('aktiv') && !b.classList.contains('aktiv');
  }));
// Genau EINE Kachel ist aktiv -- zwei hervorgehobene wären zwei Antworten
// auf die Frage, wo man steht.
check('KRITISCH: immer genau eine Kachel ist hervorgehoben',
  await page.evaluate(() => document.querySelectorAll('#aeReiter .rdkr-tab.aktiv').length === 1));

// Eine mittige Reiterreihe über linksbündigem Inhalt wirkt unruhig, ohne
// dass man sagen kann warum (CLAUDE.md: gleiches Muster auf beiden Seiten).
// Gemessen am gerenderten Zustand, nicht im Quelltext nachgelesen.
check('KRITISCH: die Kachelreihe steht bündig zum Inhalt darunter, nicht mittig',
  await page.evaluate(() => {
    const tab = document.querySelector('#aeReiter .rdkr-tab');
    const inhalt = document.getElementById('aeInhalt');
    return !!tab && !!inhalt
      && Math.abs(tab.getBoundingClientRect().left - inhalt.getBoundingClientRect().left) <= 2;
  }));
// Eine Karte mit vier kurzen Zeilen über die volle Fensterbreite schiebt den
// Status-Chip so weit vom Text weg, dass er nicht mehr dazugehört.
check('KRITISCH: die Spalte hat eine Lesebreite, statt über die ganze Seite zu laufen',
  await page.evaluate(() => {
    const v = document.getElementById('view-arbeitsergebnisse').getBoundingClientRect();
    return v.width > 400 && v.width <= 1000;
  }));
check('KRITISCH: kein Seiten-Scroll am Desktop',
  await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
await page.screenshot({ path: `${OUT}/ae-01-desktop.png` });

// ══════════ HANDY (CLAUDE.md: jede Aenderung zusaetzlich am Handy pruefen)
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(200);
check('KRITISCH: kein Seiten-Scroll bei 390px', await page.evaluate(() =>
  document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
// Die Kachelreihe bricht auf dem Handy um, statt zu schrumpfen oder aus
// dem Bild zu laufen -- gemessen am gerenderten Zustand.
check('KRITISCH: alle sieben Kacheln bleiben auf dem Handy sichtbar und im Bild',
  await page.evaluate(() => {
    const breite = document.documentElement.clientWidth;
    return [...document.querySelectorAll('#aeReiter .rdkr-tab')].every(b => {
      const r = b.getBoundingClientRect();
      return b.getClientRects().length && r.left >= -1 && r.right <= breite + 1;
    });
  }));
check('KRITISCH: sie stehen dabei in mehreren Zeilen, nicht in einer gequetschten',
  await page.evaluate(() => {
    const oben = [...document.querySelectorAll('#aeReiter .rdkr-tab')]
      .map(b => Math.round(b.getBoundingClientRect().top));
    return new Set(oben).size > 1;
  }));
check('KRITISCH: jede Kachel ist auf dem Handy mindestens 44 px hoch (CLAUDE.md)',
  await page.evaluate(() => [...document.querySelectorAll('#aeReiter .rdkr-tab')].every(b => b.getBoundingClientRect().height >= 44)));
await klick('#ae-tab-erledigung');
await page.waitForTimeout(150);
check('Der gewaehlte Reiter laedt auch auf dem Handy', (await page.textContent('#aeInhalt')).includes('Im gewählten Zeitraum liegt kein Rundgang vor.'));
await page.screenshot({ path: `${OUT}/ae-02-mobil.png` });

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
