// hat_tabelle()/hat_spalte() (backend/db.php) gegen MEHRERE Verbindungen
// wirklich ausfuehren -- pruef_hat_tabelle.php ruft sie unveraendert auf
// und beantwortet nur die Abfrage selbst je Verbindung kontrolliert.
//
// WARUM ES DIESE DATEI GIBT: pruef_hat_tabelle.php entstand am 2026-09-18
// als Gegenprobe zum ersten Teil des Fehlers, wurde aber von keiner Suite
// aufgerufen -- "node pruefungen/alle.mjs" hat sie nie ausgefuehrt. Damit
// war sie genau das, wovor die Hausregel warnt: eine Behauptung. Der
// zweite Teil desselben Fehlers (die wiederverwendete Objektnummer, live
// gefunden am 2026-09-19 an zwei Demo-Plaetzen) konnte deshalb ungestoert
// durch jede Regression laufen. Eine Pruefung, die nicht laeuft, schuetzt
// nichts.
import { HIER } from './pfade.mjs';
import { execFileSync } from 'child_process';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

let ausgabe = '', code = 0;
try {
  ausgabe = execFileSync('php', [`${HIER}/pruef_hat_tabelle.php`], { encoding: 'utf8' });
} catch (e) {
  ausgabe = String(e.stdout || '') + String(e.stderr || '');
  code = e.status || 1;
}
const anzahl = Number((ausgabe.match(/^(\d+) bestanden/m) || [0, 0])[1]);
const fehler = ausgabe.split('\n').filter(z => z.trim().startsWith('x '));

check('KRITISCH: die Pruefung laeuft ueberhaupt durch', anzahl > 0);
// Eine Untergrenze, kein genauer Wert: Sie faellt auf, wenn Faelle
// stillschweigend verschwinden, ohne bei jedem neuen Fall rot zu werden.
check('die Pruefung deckt weiterhin beide Funktionen und beide Lagen ab', anzahl >= 10);
check('KRITISCH: keine Verbindung erbt das Gedaechtnis einer anderen',
  code === 0 && fehler.length === 0);
fehler.forEach(f => bad.push('PHP: ' + f.trim()));

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
