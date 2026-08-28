// QR-Rechnung: IBAN-Pruefung, QR-Referenz, SPC-Zahlungsteil (ENT-205).
//
// Der Rechenkern (backend/qrrechnung.php) wird WIRKLICH AUSGEFUEHRT, nicht
// nur gelesen — dieselbe Haltung wie bei pruef_belege.php. Eine Zahlungs-
// pruefsumme, die an eine echte Bank geht, darf nicht auf einer
// vorgetaeuschten Serverantwort beruhen. pruef_qr.php haelt die Ergebnisse
// zusaetzlich gegen unabhaengig veroeffentlichte Beispiele (Wikipedia-IBAN,
// ein oeffentliches QR-IBAN-Beispiel, eine veroeffentlichte QRR-Referenz).
import { WURZEL, HIER, browserPfad } from './pfade.mjs';
import { execFileSync } from 'child_process';
import { chromium } from 'playwright';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

// ══════════════════════════════════════════════════════════════════════════
// TEIL 1 — Der Rechenkern laeuft wirklich
// ══════════════════════════════════════════════════════════════════════════
let ausgabe = '', code = 0;
try {
  ausgabe = execFileSync('php', [`${HIER}/pruef_qr.php`], { encoding: 'utf8' });
} catch (e) {
  ausgabe = String(e.stdout || '') + String(e.stderr || '');
  code = e.status || 1;
}
const anzahl = Number((ausgabe.match(/^(\d+) Pruefungen bestanden/m) || [0, 0])[1]);
const fehler = ausgabe.split('\n').filter(z => z.startsWith('X '));

check('KRITISCH: der Rechenkern laeuft ueberhaupt durch', anzahl > 0);
check('Er prueft mindestens 20 Faelle', anzahl >= 20);
check('KRITISCH: alle Pruefungen bestehen, inklusive der veroeffentlichten Beispiele',
  code === 0 && fehler.length === 0);
fehler.forEach(f => bad.push('PHP: ' + f.trim()));

// ══════════════════════════════════════════════════════════════════════════
// TEIL 2 — Der echte SPC-Text laesst sich im Browser tatsaechlich zu einem
// QR-Code kodieren (dieselbe vendorte Bibliothek wie beleg_oeffentlich.php,
// qrcode.js). Eine Bibliothek, die im Node-Selbsttest funktioniert, aber im
// Browser eine Exception wirft (z. B. weil UTF-8-Kodierung fehlt), waere hier
// noch unbemerkt geblieben -- genau die Naht, an der es zaehlt.
// ══════════════════════════════════════════════════════════════════════════
try {
  const spcJson = JSON.parse(execFileSync('php', [`${HIER}/pruef_qr.php`, '--json'], { encoding: 'utf8' }));
  const browser = await chromium.launch({ executablePath: browserPfad() });
  const page = await browser.newPage();
  page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
  await page.goto('about:blank');
  await page.addScriptTag({ path: `${WURZEL}/qrcode.js` });
  check('KRITISCH: qrcode.js laedt und stellt die globale Funktion bereit',
    (await page.evaluate(() => typeof qrcode)) === 'function');

  const ergebnis = await page.evaluate((spc) => {
    try {
      const q = qrcode(0, 'M');
      q.addData(spc);
      q.make();
      return { fehler: null, module: q.getModuleCount(), svg: q.createSvgTag({ cellSize: 4, margin: 8 }) };
    } catch (e) {
      return { fehler: String(e), module: 0, svg: '' };
    }
  }, spcJson.spc);

  check('KRITISCH: der echte SPC-Zahlteil laesst sich ohne Fehler zu einem QR-Code kodieren',
    !ergebnis.fehler);
  check('Das Ergebnis ist ein plausibles QR-Modulraster (mindestens 21x21, Version 1)',
    ergebnis.module >= 21);
  check('KRITISCH: das Ergebnis ist ein echtes SVG-Element', ergebnis.svg.startsWith('<svg'));
  await browser.close();
} catch (e) {
  bad.push('Browser-Kodierung: ' + String(e).split('\n')[0].slice(0, 160));
}

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
