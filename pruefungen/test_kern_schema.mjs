// Die Sperre gegen halbe Schemata: kern_schema_fehlend() wirklich
// ausfuehren (pruef_kern_schema.php) und nachsehen, dass die Platzwahl
// in demo_instanz.php sie auch benutzt.
//
// ANLASS: Demo-Platz 6 und 8 (2026-09-19). Beide hatten alle Tabellen,
// aber ein halbes Schema, und galten ueberall als eingerichtet.
import { HIER, WURZEL } from './pfade.mjs';
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

let ausgabe = '', code = 0;
try {
  ausgabe = execFileSync('php', [`${HIER}/pruef_kern_schema.php`], { encoding: 'utf8' });
} catch (e) {
  ausgabe = String(e.stdout || '') + String(e.stderr || '');
  code = e.status || 1;
}
const anzahl = Number((ausgabe.match(/^(\d+) bestanden/m) || [0, 0])[1]);
const fehler = ausgabe.split('\n').filter(z => z.trim().startsWith('x '));

check('KRITISCH: die Pruefung laeuft ueberhaupt durch', anzahl > 0);
check('KRITISCH: kern_schema_fehlend() erkennt ein halbes Schema',
  code === 0 && fehler.length === 0);
fehler.forEach(f => bad.push('PHP: ' + f.trim()));

// Die Funktion zu haben genuegt nicht -- die Platzwahl muss sie auch
// aufrufen, und zwar VOR dem Leeren. Danach waere der Platz schon leer.
// OHNE KOMMENTARE. Die erste Fassung dieser Pruefung suchte im rohen
// Text -- und fand den Funktionsnamen im erklaerenden Kommentar darueber
// statt im Aufruf. Beide Gegenproben blieben darum gruen, obwohl die
// Sperre entfernt war. Genau der Fall, vor dem Regel 1 warnt: geprueft
// wird die Aussage, nicht der Wortlaut.
const instanz = readFileSync(`${WURZEL}/backend/demo_instanz.php`, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
// NUR IM RUMPF DER PLATZWAHL. demo_instanz_leeren() wird in derselben
// Datei auch DEFINIERT, weit oben -- gegen die Definition verglichen
// stimmt jede Reihenfolge, und die zweite Gegenprobe blieb gruen.
const anfang = instanz.indexOf('function demo_zugang_einrichten(');
const ende   = instanz.indexOf('\n}', anfang);
const rumpf  = anfang > -1 ? instanz.slice(anfang, ende > -1 ? ende : undefined) : '';
check('KRITISCH: demo_zugang_einrichten() ist auffindbar', rumpf.length > 500);
const beiPruefung = rumpf.indexOf('kern_schema_fehlend(');
const beiLeeren   = rumpf.indexOf('demo_instanz_leeren(');
check('KRITISCH: die Platzwahl prueft das Schema', beiPruefung > -1);
check('KRITISCH: sie prueft es VOR dem Leeren -- danach waere der Platz schon leer',
  beiPruefung > -1 && beiLeeren > -1 && beiPruefung < beiLeeren);

// Und nach dem Befuellen: ohne Systemrollen hat im neuen Zugang niemand
// ein Recht. Das ist die eine Sache, die die Vorpruefung NICHT sehen
// kann, weil das Leeren die Rollen ohnehin loescht.
const beiRollen = rumpf.search(/COUNT\(\*\)\s+FROM\s+rollen\s+WHERE\s+system\s*=\s*1/);
check('KRITISCH: nach dem Befuellen wird auf Systemrollen geprueft', beiRollen > -1);
check('und zwar nach dem Leeren, nicht davor', beiRollen > beiLeeren);

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
