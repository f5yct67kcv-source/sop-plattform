// Musterbetrieb-Erzeugung (backend/demo_daten.php) wirklich ausfuehren
// (ENT-523).
//
// Warum diese Suite: Der Fehler, den sie fangen soll, ist kein
// kosmetischer -- eine Person, die an zwei Objekten gleichzeitig
// eingeteilt wird, oder ein Objekt, das ohne die dafuer vorgesehene
// Absicht unbesetzt bleibt, macht die Demo entweder unglaubwuerdig oder
// zeigt am falschen Ort eine Luecke, wo eigentlich Fuehrungsstation 2
// ("Besetzen Sie ihn") ansetzen soll.
import { HIER } from './pfade.mjs';
import { execFileSync } from 'child_process';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

let ausgabe = '', code = 0;
try {
  ausgabe = execFileSync('php', [`${HIER}/pruef_demo_daten.php`], { encoding: 'utf8' });
} catch (e) {
  ausgabe = String(e.stdout || '') + String(e.stderr || '');
  code = e.status || 1;
}
const anzahl = Number((ausgabe.match(/^(\d+) bestanden/m) || [0, 0])[1]);
const fehler = ausgabe.split('\n').filter(z => z.trim().startsWith('x '));

check('KRITISCH: die Musterbetrieb-Pruefungen laufen ueberhaupt durch', anzahl > 0);
check('KRITISCH: alle Faelle bestehen, inklusive der Gegenprobe zur Personalzuteilung',
  code === 0 && fehler.length === 0);
fehler.forEach(f => bad.push('PHP: ' + f.trim()));

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
