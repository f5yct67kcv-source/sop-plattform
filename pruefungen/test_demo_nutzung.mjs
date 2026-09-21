// backend/api/demo_nutzung_melden.php WIRKLICH ausfuehren (ENT-653), gegen
// eine In-Memory-SQLite-Datenbank -- nicht nur die Serverantwort
// vortaeuschen. Geprueft wird die serverseitige Sperre auf Demo-Plaetze und
// die Formpruefung, nicht nur, dass "ist_demo_platz" irgendwo im Code steht
// (CLAUDE.md: Aussage statt Wortlaut).
import { HIER, WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

function aufruf(koerper, istDemoPlatz = true) {
  try {
    const aus = execFileSync('php', [`${HIER}/pruef_demo_nutzung.php`], {
      input: JSON.stringify(koerper), encoding: 'utf8',
      env: { ...process.env, PRUEF_IST_DEMO_PLATZ: istDemoPlatz ? '1' : '0' },
    });
    return { code: 0, antwort: JSON.parse(aus) };
  } catch (e) {
    return { code: e.status || 1, stdout: String(e.stdout || ''), stderr: String(e.stderr || '') };
  }
}

// ── Der Normalfall: ein Demo-Platz meldet einen Reiterwechsel ──────────
const ok1 = aufruf({ reiter: 'kunden', dauer_s: 42 });
check('KRITISCH: die Anfrage laeuft ohne PHP-Fehler durch',
  ok1.code === 0 && ok1.antwort && !ok1.stderr);
check('KRITISCH: ein Demo-Platz darf melden (status ok)',
  ok1.antwort && ok1.antwort.status === 'ok');
check('KRITISCH: Reiter und Dauer landen wirklich in der Tabelle',
  ok1.antwort && ok1.antwort.zeilen_zur_pruefung
  && ok1.antwort.zeilen_zur_pruefung.length === 1
  && ok1.antwort.zeilen_zur_pruefung[0].reiter === 'kunden'
  && Number(ok1.antwort.zeilen_zur_pruefung[0].dauer_s) === 42);

// ── KRITISCH: kein Demo-Platz -- serverseitige Sperre, nicht nur im
// Browser verborgen (CLAUDE.md). Gegenprobe zum Normalfall oben: gleicher
// Koerper, nur das Umfeld ist jetzt kein Demo-Platz.
const gesperrt = aufruf({ reiter: 'kunden', dauer_s: 42 }, false);
check('KRITISCH: ausserhalb eines Demo-Platzes wird abgewiesen, nichts geschrieben',
  gesperrt.antwort && gesperrt.antwort.status === 'error'
  && !gesperrt.antwort.zeilen_zur_pruefung);

// ── Formpruefung: fehlender/ungueltiger Reiter ──────────────────────────
const ohneReiter = aufruf({ dauer_s: 10 });
check('KRITISCH: ohne Reiter wird nichts geschrieben, sondern klar abgewiesen',
  ohneReiter.antwort && ohneReiter.antwort.status === 'error'
  && /reiter/i.test(ohneReiter.antwort.message));
const seltsamerReiter = aufruf({ reiter: '<script>alert(1)</script>', dauer_s: 10 });
check('KRITISCH: ein Reiter-Name aus unerwarteten Zeichen wird abgewiesen',
  seltsamerReiter.antwort && seltsamerReiter.antwort.status === 'error');

// ── Formpruefung: fehlende/ungueltige Dauer ─────────────────────────────
const ohneDauer = aufruf({ reiter: 'kunden' });
check('KRITISCH: ohne Dauer wird nichts geschrieben, sondern klar abgewiesen',
  ohneDauer.antwort && ohneDauer.antwort.status === 'error'
  && /dauer/i.test(ohneDauer.antwort.message));
const nullDauer = aufruf({ reiter: 'kunden', dauer_s: 0 });
check('KRITISCH: eine Dauer von 0 gilt als kein echter vorheriger Reiter -- abgewiesen',
  nullDauer.antwort && nullDauer.antwort.status === 'error');

// ── Gedeckelt, nicht abgewiesen: ein liegen gelassener Tab verzerrt die
// Statistik nicht mit einer einzigen Zeile von mehreren Tagen.
const riesig = aufruf({ reiter: 'kunden', dauer_s: 999999 });
check('KRITISCH: eine unrealistisch lange Dauer wird gedeckelt (6 Stunden), nicht roh uebernommen',
  riesig.antwort && riesig.antwort.status === 'ok'
  && Number(riesig.antwort.zeilen_zur_pruefung[0].dauer_s) === 6 * 3600);

// ── Der Endpunkt steht in der Ausnahmeliste NUR_EIGENE_DATEN, nicht als
// require_recht()-Endpunkt -- gegen den tatsaechlichen Quelltext geprueft,
// nicht nur gegen die Testliste dieser Datei.
const testPhp = readFileSync(`${WURZEL}/pruefungen/test_php.mjs`, 'utf8');
check('KRITISCH: demo_nutzung_melden.php steht in der Ausnahmeliste NUR_EIGENE_DATEN',
  /NUR_EIGENE_DATEN = \[[\s\S]{0,4000}?'demo_nutzung_melden\.php'/.test(testPhp));
const endpunkt = readFileSync(`${WURZEL}/backend/api/demo_nutzung_melden.php`, 'utf8');
check('KRITISCH: der Endpunkt ruft ausdruecklich ist_demo_platz() auf',
  /ist_demo_platz\(\)/.test(endpunkt));
check('KRITISCH: der Endpunkt hat KEIN require_recht()-Aufruf -- reine Selbstmeldung',
  !/require_recht\(\$/.test(endpunkt));

// ── 2. Am gerenderten Dashboard: go() meldet wirklich, und zwar nur bei
// einem Demo-Platz (CLAUDE.md: gemessen, nicht nachgelesen). testumgebung.js
// setzt window.APP_UMGEBUNG_DEMO_PLATZ beim Laden aus dem unersetzten
// Platzhalter (also false) -- fuer diese Pruefung nachtraeglich per
// page.evaluate() umgebogen, weil dpReiterWechsel()/dpNutzungMelden() das
// Flag bei jedem Aufruf frisch lesen, nicht einmalig beim Laden einfrieren.
{
  const browser = await chromium.launch({ executablePath: browserPfad() });
  const gemeldet = [];
  // Ohne Verwaltungsrechte schickt das Cockpit in die Mitarbeiter-App weiter
  // (ENT-077) -- dieselbe Liste wie in test_reinigung_sparte.mjs/test_dash.mjs.
  const RECHTE = ['kunden_lesen', 'kunden_schreiben', 'abgleich_lesen', 'abgleich_schreiben',
    'auslagen_lesen', 'personal_lesen', 'abwesenheiten_lesen', 'betrieb_lesen', 'betrieb_schreiben',
    'fahrzeuge_lesen', 'fahrzeuge_schreiben', 'einsaetze_lesen', 'einsaetze_schreiben',
    'objekte_lesen', 'objekte_schreiben', 'masterschichten_lesen', 'masterschichten_schreiben',
    'verfuegbarkeit_lesen'];
  async function neueSeite() {
    const kontext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await kontext.newPage();
    page.setDefaultTimeout(5000);
    // EIN Handler statt zwei ueberlappender Routen: Playwright reicht bei
    // mehreren passenden page.route()-Mustern an die zuletzt registrierte
    // zuerst weiter, und ein Zweig, der weder fulfill() noch continue()
    // aufruft, laesst die Anfrage einfach haengen -- genau das passierte
    // hier zuerst mit zwei getrennten Routen.
    await page.route('**/api/**', r => {
      if (r.request().url().includes('demo_nutzung_melden.php')) {
        gemeldet.push(JSON.parse(r.request().postData() || '{}'));
        r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok"}' });
        return;
      }
      r.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ status: 'ok', token: 't', name: 'a', ist_admin: true,
          rollen: [], rechte: RECHTE, sparten: ['sicherheit'], kpi: {}, verlauf: [], angemeldet: [],
          pro_mitarbeiter: [], letzte_rapporte: [], mitarbeiter: [], kunden: [],
          einsaetze: [], objekte: [], rapporte: [], orte: [], feiertage: [], gepflegt: {} }),
      });
    });
    await page.goto(`file://${WURZEL}/dashboard.html`);
    await page.fill('#gName', 'a'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
    await page.waitForSelector('#shell.on');
    return { page, kontext };
  }

  // ── KRITISCH: KEIN Demo-Platz -- ein Reiterwechsel meldet nichts ────────
  {
    const { page, kontext } = await neueSeite();
    await page.evaluate(() => go('kunden'));
    await page.waitForTimeout(1100);
    await page.evaluate(() => go('uebersicht'));
    await kontext.close();
  }
  check('KRITISCH: ausserhalb eines Demo-Platzes meldet ein Reiterwechsel nichts',
    gemeldet.length === 0);

  // ── KRITISCH: ein Demo-Platz meldet den VERLASSENEN Reiter mit Dauer ────
  {
    const { page, kontext } = await neueSeite();
    await page.evaluate(() => { window.APP_UMGEBUNG_DEMO_PLATZ = true; });
    await page.evaluate(() => go('kunden'));
    await page.waitForTimeout(1100);
    await page.evaluate(() => go('uebersicht'));
    await page.waitForTimeout(200);
    await kontext.close();
  }
  check('KRITISCH: bei einem Demo-Platz meldet der Wechsel weg von "kunden" '
      + 'genau diesen Reiter mit einer Dauer von mindestens einer Sekunde',
    gemeldet.length === 1 && gemeldet[0].reiter === 'kunden' && gemeldet[0].dauer_s >= 1);

  await browser.close();
}

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
