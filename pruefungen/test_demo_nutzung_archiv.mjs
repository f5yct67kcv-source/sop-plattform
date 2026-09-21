// demo_nutzung_archivieren() (ENT-653) WIRKLICH ausfuehren -- siehe
// pruef_demo_nutzung_archiv.php. Hier zusaetzlich: dass demo_instanz_leeren()
// wirklich VOR dem Leeren archiviert und ein Fehler dabei das Leeren nicht
// verhindert (CLAUDE.md: Aussage statt Wortlaut -- "archiviert" muss auch
// bedeuten "in der richtigen Reihenfolge und fehlertolerant").
import { HIER, WURZEL } from './pfade.mjs';
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

let aus = '', code = 0;
try {
  aus = execFileSync('php', [`${HIER}/pruef_demo_nutzung_archiv.php`], { encoding: 'utf8' });
} catch (e) {
  aus = String(e.stdout || '') + String(e.stderr || '');
  code = e.status || 1;
}
const anzahl = Number((aus.match(/^(\d+) bestanden/m) || [0, 0])[1]);
const phpFehler = aus.split('\n').filter(z => z.trim().startsWith('x '));
check('KRITISCH: demo_nutzung_archivieren() laeuft wirklich gegen SQLite', anzahl > 0 && code === 0);
check('KRITISCH: alle Faelle in pruef_demo_nutzung_archiv.php bestehen', phpFehler.length === 0);
phpFehler.forEach(f => bad.push('PHP: ' + f.trim()));

const quelle = readFileSync(`${WURZEL}/backend/demo_instanz.php`, 'utf8');
check('KRITISCH: demo_instanz_leeren() archiviert VOR dem Leeren, nicht danach',
  quelle.indexOf('demo_nutzung_archivieren($instanz, $betreiber)')
    < quelle.indexOf('demo_reset_alle_tabellen_leeren($instanz)'));
check('KRITISCH: das Archivieren ist gegen Fehler abgesichert (try/catch) -- '
    + 'ein Platz muss sich auch leeren lassen, wenn die Archivtabelle fehlt',
  /try\s*\{\s*demo_nutzung_archivieren/.test(quelle));
check('Die neue Archivtabelle steht in be_tabellen() (backend/betreiber.php)',
  readFileSync(`${WURZEL}/backend/betreiber.php`, 'utf8').includes("'be_demo_nutzung_archiv' =>"));

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
