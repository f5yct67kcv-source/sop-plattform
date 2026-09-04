// Passwort vergessen / neues Passwort setzen (ENT-373).
//
// Der Anlass: ein Waechter steht morgens vor der ersten Runde, weiss sein
// Passwort nicht mehr und kommt ohne einen erreichbaren Admin nicht rein --
// fatal, weil der GPS-gestuetzte Rundgang ohne Anmeldung gar nicht startet.
// Diese Suite prueft den App-seitigen Weg End-to-End gegen eine
// nachgebaute Server-Antwort; die eigentlichen PHP-Regeln (Admin-Ausnahme,
// Token-Hashing, Gleichlaut der Antwort) stehen in pruef_passwort_reset.php,
// weil die Endpunkte MySQL-eigene Syntax benutzen und sich nicht gegen den
// SQLite-Stub ausfuehren lassen.
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);
// Ein Klick ins Leere oder ein evaluate() gegen ein fehlendes Element darf
// die Suite nicht mitreissen -- eine abgestuerzte Suite meldet gar keine
// rote Pruefung (mehrfache Lehre aus dieser Sitzung).
const klick = async s => { try { await page.click(s, { timeout: 2000 }); return true; }
                           catch (e) { return false; } };
// Dieselbe Absicherung fuer page.fill(): Ein Feld in einem gerade nicht
// sichtbaren Zustand (z.B. weil ein vorheriger Klick in einer Gegenprobe
// ausblieb) liesse fill() sonst in ein Timeout laufen und die ganze Suite
// mitreissen -- gefunden per Gegenprobe, dreimal in dieser Datei.
const fuelle = async (s, wert) => { try { await page.fill(s, wert, { timeout: 2000 }); return true; }
                                    catch (e) { return false; } };
const ev = (fn, ...a) => page.evaluate(fn, ...a).catch(() => null);

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.setDefaultTimeout(5000);
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));

const rufe = [];
await page.route('**/api/**', route => {
  const p = new URL(route.request().url()).pathname.split('/api/')[1];
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (p.includes('passwort_vergessen')) {
    rufe.push({ p, body: JSON.parse(route.request().postData() || '{}') });
    return send({ status: 'ok', message: 'GENAU DIESELBE NACHRICHT, immer' });
  }
  if (p.includes('passwort_zuruecksetzen')) {
    rufe.push({ p, body: JSON.parse(route.request().postData() || '{}') });
    const b = JSON.parse(route.request().postData() || '{}');
    if (b.token === 'schlechter-token') {
      return send({ status: 'error', message: 'Der Link ist ungültig oder abgelaufen. Bitte einen neuen Link anfordern.' });
    }
    return send({ status: 'ok', name: 'm.muster' });
  }
  return send({ status: 'ok' });
});

// ══════════ LOGIN-BILDSCHIRM: DER LINK STEHT DA ═══════════════════════
await page.goto(`file://${WURZEL}/app.html`);
await page.waitForTimeout(300);
check('KRITISCH: "Passwort vergessen?" steht auf dem Anmeldebildschirm',
  await page.isVisible('#lb-pwvergessen'));
check('44 px Trefferflaeche (CLAUDE.md)',
  (await ev(() => document.getElementById('lb-pwvergessen')?.getBoundingClientRect().height)) >= 44);

// ══════════ ANFORDERN ══════════════════════════════════════════════════
await fuelle('#gName', 'm.muster');
await klick('#lb-pwvergessen');
await page.waitForTimeout(300);
check('KRITISCH: die Anmeldemaske ist weg, der Anfrage-Bildschirm steht',
  await ev(() => getComputedStyle(document.getElementById('gate-login')).display === 'none')
  && await ev(() => getComputedStyle(document.getElementById('gate-vergessen')).display !== 'none'));
check('Der bereits eingetippte Name wird uebernommen, nicht nochmal verlangt',
  (await page.inputValue('#gvName').catch(() => '')) === 'm.muster');

await klick('#gvBtn');
await page.waitForTimeout(300);
check('KRITISCH: die Anfrage geht an passwort_vergessen.php mit dem eingetippten Namen',
  rufe.some(r => r.p.includes('passwort_vergessen') && r.body.name === 'm.muster'));
check('KRITISCH: die Antwort des Servers wird unveraendert gezeigt -- keine eigene Umformulierung',
  (await page.textContent('#gvOk').catch(() => '')).includes('GENAU DIESELBE NACHRICHT, immer'));
check('Der Hinweistext vor dem Absenden ist danach weg -- die Bestaetigung ersetzt ihn',
  await ev(() => getComputedStyle(document.getElementById('gvHinweis')).display === 'none'));

await klick('#lb-gvzurueck');   // "Zurueck zur Anmeldung" -- einziger uebriger .gate-link in dieser Ansicht
await page.waitForTimeout(300);
check('KRITISCH: "Zurueck zur Anmeldung" fuehrt tatsaechlich zurueck',
  await ev(() => getComputedStyle(document.getElementById('gate-login')).display !== 'none'));

// ══════════ EIN LEERER NAME WIRD ABGEFANGEN, OHNE ANFRAGE ═════════════
rufe.length = 0;
await klick('#lb-pwvergessen');
await fuelle('#gvName', '');
await klick('#gvBtn');
await page.waitForTimeout(300);
check('KRITISCH: ein leerer Name loest keine Anfrage aus',
  !rufe.some(r => r.p.includes('passwort_vergessen')));
check('Stattdessen steht eine Fehlermeldung da',
  await page.isVisible('#gvErr').catch(() => false));
await klick('#lb-gvzurueck');
await page.waitForTimeout(200);

// ══════════ NEUES PASSWORT SETZEN: ?reset=<token> IN DER ADRESSZEILE ══
rufe.length = 0;
await page.goto(`file://${WURZEL}/app.html?reset=guter-token`);
await page.waitForTimeout(400);
check('KRITISCH: mit ?reset= steht sofort der Bildschirm "Neues Passwort setzen", nicht die Anmeldung',
  await ev(() => getComputedStyle(document.getElementById('gate-reset')).display !== 'none')
  && await ev(() => getComputedStyle(document.getElementById('gate-login')).display === 'none'));
check('KRITISCH: der Token verschwindet sofort aus der Adresszeile -- er ist ein Geheimnis (ENT-340-Muster)',
  await ev(() => location.search) === '');

await fuelle('#grNeu', 'x');
await klick('#grBtn');
await page.waitForTimeout(200);
check('KRITISCH: ein zu kurzes Passwort loest keine Anfrage an den Server aus',
  !rufe.some(r => r.p.includes('passwort_zuruecksetzen')));

await fuelle('#grNeu', 'einLangesUndMerkbaresPasswort');
await klick('#grBtn');
await page.waitForTimeout(300);
check('KRITISCH: der ROHE Token aus der Adresszeile wird mitgeschickt',
  rufe.some(r => r.p.includes('passwort_zuruecksetzen') && r.body.token === 'guter-token'));
check('KRITISCH: nach Erfolg steht wieder die Anmeldemaske da',
  await ev(() => getComputedStyle(document.getElementById('gate-login')).display !== 'none'));
check('KRITISCH: der Anmeldename wird mit dem vom Server genannten Namen vorausgefuellt',
  (await page.inputValue('#gName').catch(() => '')) === 'm.muster');
check('Das neue Passwort steht nicht mehr im Feld, wenn es wieder auftaucht',
  (await page.inputValue('#grNeu').catch(() => '')) === '');

// ══════════ EIN SCHLECHTER TOKEN ZEIGT DEN SERVERFEHLER, WECHSELT NICHT
await page.goto(`file://${WURZEL}/app.html?reset=schlechter-token`);
await page.waitForTimeout(400);
await fuelle('#grNeu', 'einLangesUndMerkbaresPasswort');
await klick('#grBtn');
await page.waitForTimeout(300);
check('KRITISCH: bei einem abgelehnten Token bleibt der Reset-Bildschirm stehen',
  await ev(() => getComputedStyle(document.getElementById('gate-reset')).display !== 'none'));
check('Der Serverfehler wird angezeigt',
  (await page.textContent('#grErr').catch(() => '')).includes('ungültig'));

// ══════════ EIN RESET-LINK GEHT VOR EINER GESPEICHERTEN SITZUNG ═══════
// Wer sein Passwort vergessen hat, aber zufaellig noch eine alte Sitzung im
// Speicher traegt (z.B. ein zweites Geraet), soll trotzdem den
// Reset-Bildschirm sehen -- nicht automatisch eingeloggt werden.
await page.evaluate(() => {
  localStorage.setItem('rv3_token', 'irgendein-alter-token');
  localStorage.setItem('rv3_user', JSON.stringify({ name: 'm.muster', ist_admin: false }));
});
await page.goto(`file://${WURZEL}/app.html?reset=guter-token`);
await page.waitForTimeout(500);
check('KRITISCH: trotz gespeicherter Sitzung startet die App NICHT automatisch',
  await ev(() => !document.getElementById('app')?.classList.contains('on')));
check('KRITISCH: stattdessen steht der Reset-Bildschirm da',
  await ev(() => getComputedStyle(document.getElementById('gate-reset')).display !== 'none'));

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden`);
if (bad.length) { console.log('\n✗ ' + bad.length + ' FEHLGESCHLAGEN:'); bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('\nAlle Pruefungen bestanden.');
