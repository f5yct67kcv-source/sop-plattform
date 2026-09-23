// Die Cockpit-Tour: Sie geht nach der Anmeldung GENAU EINMAL automatisch
// auf -- danach nur noch auf Zuruf ueber "Tutorial" in der Seitenleiste.
//
// ANLASS (Projektinhaber, 2026-09-23, an der laufenden Anlage): Die Tour
// kam bei jeder Anmeldung wieder. Der Server konnte das nicht sein -- dort
// steht die Tabelle tutorial_gesehen, und login.php wie me.php geben ihren
// Stand mit. Die Oberflaeche schrieb ihn nur nie hinein: Gemerkt wurde
// ausschliesslich, wer alle zehn Schritte bis "Fertig" durchklickte oder am
// letzten Schritt ein Kaestchen ankreuzte. Wer im ersten Schritt wegklickte
// -- der naheliegendste Fall -- hinterliess nichts.
//
// GEMESSEN, NICHT GELESEN (CLAUDE.md): Diese Datei sieht nicht nach, ob
// irgendwo "tutorial_gesehen.php" im Quelltext steht. Sie laesst die Tour
// im Browser wirklich aufgehen, schreibt mit, was dabei an den Server geht,
// und klickt sie so weg, wie eine Person es tut.
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);
const ev = (page, fn, ...a) => page.evaluate(fn, ...a).catch(() => null);

const browser = await chromium.launch({ executablePath: browserPfad() });

// Eine Seite im Zustand "angemeldet als Verwaltung", mit mitgeschriebenen
// Server-Aufrufen. api() wird ersetzt statt fetch: Der echte Weg braucht
// eine Serveradresse, die es an einer file://-Seite nicht gibt -- geprueft
// werden soll, WANN die Oberflaeche merkt, nicht der Transportweg.
const seite = async (gesehen) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(5000);
  page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
  await page.goto(`file://${WURZEL}/dashboard.html`);
  await page.waitForTimeout(400);
  await ev(page, (g) => {
    window.__aufrufe = [];
    window.api = (pfad, opts) => {
      window.__aufrufe.push({ pfad, ...(opts || {}) });
      return Promise.resolve({ ok: true, status: 200, data: { status: 'ok' } });
    };
    document.getElementById('gate').style.display = 'none';
    document.getElementById('shell').classList.add('on');
    me = { name: 'Testperson', ist_admin: true, rollen: ['verwaltung'], rechte: ['alles'] };
    tutorialAutostartPruefen({ tutorial_gesehen: { cockpit_verwaltung: g } });
  }, gesehen);
  await page.waitForTimeout(300);
  return page;
};

const stand = page => ev(page, () => ({
  offen: document.getElementById('tourBox').classList.contains('on'),
  schritt: document.getElementById('tourSchrittLbl').textContent,
  gemerkt: (window.__aufrufe || []).filter(a => a.pfad === 'tutorial_gesehen.php'
    && a.method === 'POST' && a.body && a.body.tutorial === 'cockpit_verwaltung').length,
}));

// ── 1. Erste Anmeldung: Tour geht auf UND ist sofort gemerkt ─────────────
//
// Das "sofort" ist der Kern des Befunds. Gemerkt werden muss beim
// AUFGEHEN, nicht beim Schliessen: Wer den Browser zuklappt oder die Seite
// neu laedt, erreicht kein Schliessen.
{
  const page = await seite(false);
  const a = await stand(page);
  check('KRITISCH: bei der ersten Anmeldung geht die Tour auf', a && a.offen === true);
  check('KRITISCH: sie ist im selben Moment als gesehen gemerkt -- nicht erst am letzten Schritt',
    a && a.gemerkt === 1);

  // So klickt eine Person sie weg: im ERSTEN Schritt, ueber das Kreuz.
  // Genau dieser Weg hinterliess bis zum 2026-09-23 nichts.
  check('der Wegklick geschieht im ersten Schritt', a && /1 von/.test(a.schritt || ''));
  await ev(page, () => tourSchliessen());
  await page.waitForTimeout(200);
  const b = await stand(page);
  check('KRITISCH: nach dem Wegklicken im ersten Schritt ist der Stand gemerkt',
    b && b.gemerkt >= 1);
  check('das Kaestchen ist zu', b && b.offen === false);
  await page.close();
}

// ── 2. Gegenprobe: schon gesehen -- nichts geht auf, nichts wird gemerkt ─
//
// Ohne diese Haelfte waere Teil 1 keine Pruefung: Eine Tour, die IMMER
// aufgeht und IMMER merkt, bestuende ihn ebenfalls.
{
  const page = await seite(true);
  const a = await stand(page);
  check('KRITISCH: wer die Tour schon gesehen hat, bekommt sie nicht wieder',
    a && a.offen === false);
  check('und es wird dabei auch nichts an den Server geschrieben', a && a.gemerkt === 0);

  // Von Hand bleibt sie erreichbar -- das war die Zusage im ersten Schritt
  // ("jederzeit ueber Tutorial unten in der Seitenleiste").
  await ev(page, () => document.getElementById('nav-tutorial').click());
  await page.waitForTimeout(200);
  const b = await stand(page);
  check('KRITISCH: der Knopf "Tutorial" in der Seitenleiste startet sie trotzdem',
    b && b.offen === true);
  await page.close();
}

// ── 3. Nur wer die Tour betrifft ─────────────────────────────────────────
//
// Die Tour fuehrt durch die Sidebar der Verwaltung. Wer diese Rolle nicht
// hat, sieht andere Punkte -- und soll nicht durch fremde gefuehrt werden.
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(5000);
  await page.goto(`file://${WURZEL}/dashboard.html`);
  await page.waitForTimeout(400);
  const offen = await ev(page, () => {
    window.api = () => Promise.resolve({ ok: true, status: 200, data: {} });
    document.getElementById('gate').style.display = 'none';
    me = { name: 'Testperson', ist_admin: false, rollen: ['planung'], rechte: ['planung_schreiben'] };
    tutorialAutostartPruefen({ tutorial_gesehen: { cockpit_verwaltung: false } });
    return document.getElementById('tourBox').classList.contains('on');
  });
  check('ohne die Rolle Verwaltung geht die Tour nicht automatisch auf', offen === false);
  await page.close();
}

// ── 4. Das alte Kaestchen ist weg ────────────────────────────────────────
//
// "Nicht mehr automatisch anzeigen" war die Umgehung eines Fehlers: Es
// verlangte, dass man bis zum letzten Schritt kommt, um etwas abzustellen,
// das schon nach dem ersten nicht mehr haette kommen duerfen. Bleibt es
// stehen, verspricht es eine Wahl, die es nicht mehr gibt.
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`file://${WURZEL}/dashboard.html`);
  check('das Kaestchen "Nicht mehr automatisch anzeigen" ist entfallen',
    (await ev(page, () => !!document.getElementById('tourNichtMehr'))) === false);
  await page.close();
}

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden`);
if (bad.length) { console.log('\n✗ ' + bad.length + ' FEHLGESCHLAGEN:'); bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('\nAlle Pruefungen bestanden.');
