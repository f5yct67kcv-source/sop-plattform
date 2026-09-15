// ist_demo() (backend/db.php) und der Demo-Mailmodus (backend/mailer.php)
// wirklich ausfuehren (ENT-523).
//
// Warum diese Suite: Die Demo-Umgebung erkennt sich selbst allein am
// APP_ENV-Wert, und der E-Mail-Versand darf ausserhalb der Produktion
// NIEMALS an den eingegebenen Empfaenger gehen -- UND nicht ins falsche
// Testpostfach (Staging statt Demo). Ein Fehler hier ist kein
// kosmetischer: entweder verschickt er eine echte Mail an eine echte
// Adresse aus einer Demo-Instanz heraus, oder eine Demo-Mail landet
// unauffindbar im Staging-Postfach.
import { HIER } from './pfade.mjs';
import { execFileSync } from 'child_process';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

let ausgabe = '', code = 0;
try {
  ausgabe = execFileSync('php', [`${HIER}/pruef_demo.php`], { encoding: 'utf8' });
} catch (e) {
  ausgabe = String(e.stdout || '') + String(e.stderr || '');
  code = e.status || 1;
}
const anzahl = Number((ausgabe.match(/^(\d+) bestanden/m) || [0, 0])[1]);
const fehler = ausgabe.split('\n').filter(z => z.trim().startsWith('x '));

check('KRITISCH: die Demo-Pruefungen laufen ueberhaupt durch', anzahl > 0);
check('KRITISCH: alle Faelle bestehen, inklusive der Kopplungs-Gegenprobe (kein Rueckfall auf Staging)',
  code === 0 && fehler.length === 0);
fehler.forEach(f => bad.push('PHP: ' + f.trim()));

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
