// ist_produktion() (backend/db.php) und der Staging-Mailmodus
// (backend/mailer.php) wirklich ausfuehren (ENT-341).
//
// Warum diese Suite: Die Staging-Umgebung erkennt sich selbst allein am
// Hostnamen, und der E-Mail-Versand darf ausserhalb der Produktion NIEMALS
// an den eingegebenen Empfaenger gehen. Ein Fehler hier ist kein
// kosmetischer -- er verschickt eine echte Mail an eine echte Adresse aus
// einer Testumgebung heraus.
import { HIER } from './pfade.mjs';
import { execFileSync } from 'child_process';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

let ausgabe = '', code = 0;
try {
  ausgabe = execFileSync('php', [`${HIER}/pruef_staging.php`], { encoding: 'utf8' });
} catch (e) {
  ausgabe = String(e.stdout || '') + String(e.stderr || '');
  code = e.status || 1;
}
const anzahl = Number((ausgabe.match(/^(\d+) bestanden/m) || [0, 0])[1]);
const fehler = ausgabe.split('\n').filter(z => z.trim().startsWith('x '));

check('KRITISCH: die Staging-Pruefungen laufen ueberhaupt durch', anzahl > 0);
check('KRITISCH: alle Faelle bestehen, inklusive der ENT-192-Gegenprobe',
  code === 0 && fehler.length === 0);
fehler.forEach(f => bad.push('PHP: ' + f.trim()));

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
