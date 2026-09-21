// Alleinarbeiterschutz Mechanismus B, Stufe 1 (ENT-153, ENT-644):
// Ueberfaelligkeitserkennung + Push an die Zentrale.
//
// KEINE BROWSER-OBERFLAECHE FUER DIESE AENDERUNG (bewusst, Auftragsgrenze):
// Es entsteht kein neuer Bildschirm und keine neue Zeile in app.html --
// nur ein bestehender Zeitgeber-Endpunkt (push_versand.php) bekommt einen
// zusaetzlichen Rechenschritt. Ein Playwright-Test wie test_push.mjs oder
// test_rundgang.mjs haette hier nichts zu bedienen und nichts zu sehen.
// Gleiches Muster wie test_db_fehler.mjs fuer db_fehlermeldung(): Der
// eigentliche Rechenkern laeuft ECHT gegen SQLite in pruef_alleinarbeiter-
// schutz.php (Rollen-Ableitung, Pausen-Rausrechnung, Karenzgrenze, kein
// Doppel-Push, kein stiller Ruckfall, und die tatsaechliche try/catch-
// Klammer sowie alle drei Antwortpfade in push_versand.php) -- diese Datei
// fuehrt ihn aus und meldet das Ergebnis in dem Format, das
// pruefungen/alle.mjs erwartet.
import { HIER } from './pfade.mjs';
import { execFileSync } from 'child_process';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

let ausgabe = '', code = 0;
try {
  ausgabe = execFileSync('php', [`${HIER}/pruef_alleinarbeiterschutz.php`], { encoding: 'utf8' });
} catch (e) {
  ausgabe = String(e.stdout || '') + String(e.stderr || '');
  code = e.status || 1;
}
const anzahl = Number((ausgabe.match(/^(\d+) Pruefungen bestanden/m) || [0, 0])[1]);
const fehler = ausgabe.split('\n').filter(z => z.trim().startsWith('- '));

check('KRITISCH: der Rechenkern laeuft ueberhaupt durch (echte SQLite-Datenbank)', anzahl > 0);
check('KRITISCH: alle Faelle bestehen, inklusive der Gegenproben '
  + '(Pause, Karenzgrenze, kein Doppel-Push, kein stiller Ruckfall)',
  code === 0 && fehler.length === 0);
fehler.forEach(f => bad.push('PHP: ' + f.trim()));

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
