// Wer in den Revierdienst-Bereich darf -- und was die App sagt, wenn es
// nicht klappt (ENT-338).
//
// Anlass: Der Projektinhaber, mit zwei Bildschirmfotos eines frisch
// angelegten Mitarbeiters: „Wieso werden bei diesem Mitarbeiter keine
// Rundgaenge angezeigt? Und wenn der Mitarbeiter fuer die Waechterfunktion
// nicht autorisiert ist oder der Eintrag nicht gemacht wurde: Warum kam
// keine Meldung?"
//
// Zwei getrennte Fehler steckten dahinter:
//  1. Vier Server-Endpunkte pruetten noch die von ENT-284 abgeloeste
//     Herleitung („jemals einem Objekt mit Kontrollpunkten zugeteilt")
//     statt das Merkmal `revierdienst_berechtigt`, das seither den
//     Waechter-Reiter steuert. Reiter sichtbar, Endpunkt 403 -- genau der
//     Konflikt, gegen den ENT-284 gebaut wurde, eine Ebene tiefer.
//  2. Die App machte aus JEDEM Fehlschlag eine leere Liste und daraus die
//     Meldung „Es sind aktuell keine Kontrollrunden hinterlegt". Falsch:
//     Die Runden sind hinterlegt, sie sind nur nicht erreichbar.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const tag = n => iso(new Date(Date.now() + n * 864e5));

// ══════════ SERVER: EIN GATE, VIER ENDPUNKTE ══════════════════════════
const RG = readFileSync(`${WURZEL}/backend/rundgang.php`, 'utf8');
check('KRITISCH: es gibt ein gemeinsames Gate statt vier handgeschriebener Abfragen',
  /function revierdienst_zugang\(PDO \$pdo, int \$mitarbeiterId\): bool/.test(RG));
check('KRITISCH: es liest das Merkmal aus der Personalakte, nicht die Schicht-Historie',
  /SELECT revierdienst_berechtigt FROM mitarbeiter WHERE id = \?/.test(RG));
// Ohne diesen Rueckfall sperrt ein noch nicht migrierter Bestand ALLE aus --
// eine Zugriffsaenderung darf nie an einer fehlenden Migration haengen.
check('KRITISCH: fehlt die Spalte, gilt weiterhin die alte Herleitung',
  /hat_spalte\(\$pdo, 'mitarbeiter', 'revierdienst_berechtigt'\)/.test(RG)
  && /JOIN kontrollpunkt k ON k\.objekt_id = e\.objekt_id AND k\.aktiv = 1/.test(RG));

const ENDPUNKTE = ['mein_rundgang_vorlagen_alle', 'mein_rundgang_uebersicht',
                   'mein_rundgang_spontan_starten', 'mein_ereignis_melden'];
for (const e of ENDPUNKTE) {
  const q = readFileSync(`${WURZEL}/backend/api/${e}.php`, 'utf8');
  check(`KRITISCH: ${e}.php benutzt das gemeinsame Gate`,
    /revierdienst_zugang\(\$pdo, \(int\)\$user\['id'\]\)/.test(q));
  // Die alte Abfrage darf nicht daneben stehenbleiben -- zwei Gates waeren
  // wieder zwei Wahrheiten.
  check(`Und die alte "jemals zugeteilt"-Abfrage steht dort nicht mehr`,
    !/SELECT COUNT\(\*\) FROM einsatz_zuteilung z\s*\n\s*JOIN einsaetze e ON e\.id = z\.einsatz_id\s*\n\s*JOIN kontrollpunkt/.test(q));
  check(`${e}.php nennt beim 403 einen maschinenlesbaren Code`,
    /'code' => 'keine_revierdienst_berechtigung'/.test(q));
}

// ══════════ APP: DREI SACHVERHALTE, DREI MELDUNGEN ════════════════════
const SCHICHTEN = { status: 'ok', von: tag(-30), bis: tag(90), schichten: [] };
const PROFIL = { status: 'ok', monat: { anzahl: 0, stunden: 0 }, profil: {
  name: 'test.muster', ist_admin: false, personalnummer: 'P-099',
  vorname: 'Test', nachname: 'Muster', erstellt_am: tag(-1) + ' 10:00:00',
  revierdienst_berechtigt: true } };

let antwort = null;   // wird je Fall gesetzt
const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
let rufe = 0;
await page.route('**/api/**', route => {
  const p = new URL(route.request().url()).pathname.split('/api/')[1];
  const send = (b, s) => route.fulfill({ status: s || 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'test.muster', ist_admin: false });
  if (p.includes('meine_schichten')) return send(SCHICHTEN);
  if (p.includes('mein_profil')) return send(PROFIL);
  if (p.includes('rapport_list')) return send({ status: 'ok', rapporte: [] });
  if (p.includes('mein_rundgang_vorlagen_alle')) {
    rufe++;
    if (antwort === '403') {
      return send({ status: 'error', message: 'Kein Zugriff auf die Rundgänge-Übersicht',
                    code: 'keine_revierdienst_berechtigung' }, 403);
    }
    if (antwort === '500') { return send({ status: 'error', message: 'Datenbank nicht erreichbar' }, 500); }
    if (antwort === 'leer') { return send({ status: 'ok', vorlagen: [] }); }
    return send({ status: 'ok', vorlagen: [
      { id: 501, name: 'Musterrunde Quartier', objekt_id: 7, objekt_name: 'Objekt Nord',
        kunde_name: 'Beispiel AG', fenster_von: null, fenster_bis: null }] });
  }
  return send({ status: 'ok' });
});
await page.route('**maps.googleapis.com/**', r => r.abort());

await page.goto(`file://${WURZEL}/app.html`);
await page.fill('#gName', 'test.muster'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('.app.on');
await page.waitForTimeout(400);

check('KRITISCH: der Wächter-Reiter ist da -- die Berechtigung ist gesetzt',
  await page.isVisible('#t-waechter'));

const oeffnen = async art => {
  antwort = art;
  await page.evaluate(() => { blattZu(); });
  await page.waitForTimeout(150);
  await page.evaluate(() => rundgangUebersichtOeffnen());
  await page.waitForTimeout(400);
};
const txt = async () => (await page.textContent('#blBody')) || '';

// ── 403: fehlende Freigabe ───────────────────────────────────────────
await oeffnen('403');
const t403 = await txt();
check('KRITISCH: bei fehlender Freigabe steht NICHT "keine Kontrollrunden hinterlegt"',
  !t403.includes('keine Kontrollrunden hinterlegt'));
check('KRITISCH: sondern, dass der Revierdienst nicht freigegeben ist',
  t403.includes('nicht freigegeben'));
check('Und wer das ändern kann -- eine Meldung ohne nächsten Schritt hilft niemandem',
  t403.includes('Verwaltung') && t403.includes('Personalakte'));
// Ein "Nochmals versuchen" waere hier eine leere Zusage: Eine fehlende
// Freigabe geht durch Wiederholen nicht weg.
check('Kein "Nochmals versuchen" bei fehlender Freigabe -- das ginge nie gut aus',
  !t403.includes('Nochmals versuchen'));

// ── Serverfehler / Funkloch ──────────────────────────────────────────
await oeffnen('500');
const t500 = await txt();
check('KRITISCH: ein Serverfehler sieht nicht aus wie "nichts vorhanden"',
  !t500.includes('keine Kontrollrunden hinterlegt'));
check('Er wird als Ladefehler benannt',
  t500.includes('nicht geladen') || t500.includes('nicht abgerufen') || t500.includes('Datenbank'));
check('KRITISCH: und lässt sich ohne Verlassen der Seite erneut versuchen',
  t500.includes('Nochmals versuchen'));
// Nicht page.click: Fehlt der Knopf -- und genau das ist der Fall, gegen
// den hier geprueft wird --, laeuft der Aufruf 30 Sekunden ins Leere und
// reisst die Suite mit. Eine abgestuerzte Suite meldet keine rote Pruefung,
// sondern gar nichts (in der Gegenprobe genau so aufgefallen).
const vorher = rufe;
let geklickt = false;
try { await page.click('#blBody button:has-text("Nochmals versuchen")', { timeout: 2500 }); geklickt = true; }
catch (e) {}
await page.waitForTimeout(400);
check('KRITISCH: der Knopf fragt wirklich noch einmal an',
  geklickt && rufe === vorher + 1);

// ── Wirklich leer ────────────────────────────────────────────────────
await oeffnen('leer');
const tLeer = await txt();
check('KRITISCH: eine wirklich leere Liste sagt weiterhin genau das',
  tLeer.includes('keine Kontrollrunden hinterlegt'));
check('Und dort steht dann kein Fehler und keine Sperre',
  !tLeer.includes('nicht freigegeben') && !tLeer.includes('Nochmals versuchen'));

// ── Normalfall ───────────────────────────────────────────────────────
await oeffnen('ok');
check('KRITISCH: mit Daten erscheint die Runde ganz normal',
  (await txt()).includes('Musterrunde Quartier'));
await page.screenshot({ path: `${OUT}/zugang-01-liste.png` });

// ── Gestaltung, gemessen ─────────────────────────────────────────────
await oeffnen('403');
check('Die Meldung steht sichtbar im Blatt, nicht nur im Quelltext',
  await page.evaluate(() => {
    const el = document.querySelector('#blBody .leer');
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.height > 60 && r.top >= 0;
  }));
check('KRITISCH: kein waagrechter Seiten-Scroll bei 390px',
  await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
await page.screenshot({ path: `${OUT}/zugang-02-gesperrt.png` });

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
