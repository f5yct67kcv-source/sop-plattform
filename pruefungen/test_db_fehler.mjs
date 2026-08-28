// db_fehlermeldung() in backend/db.php wirklich ausfuehren (ENT-216).
//
// Ausgeloest durch einen echten Fehlschlag auf der Live-Datenbank: "Neues
// Produkt anlegen" scheiterte dort mit nichts als "Datenbankfehler" -- ohne
// SQLSTATE, ohne Treibercode, ohne jede weitere Spur. Diese Suite haelt zwei
// Dinge scharf: dass ein nicht eingeordneter Fehler den Code jetzt sichtbar
// mitgibt, und dass die drei bereits bekannten Faelle (fehlende Tabelle,
// fehlende Spalte, verletzte Eindeutigkeit) weiterhin ihre verstaendlichen,
// codefreien Texte behalten.
import { HIER } from './pfade.mjs';
import { execFileSync } from 'child_process';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

let ausgabe = '', code = 0;
try {
  ausgabe = execFileSync('php', [`${HIER}/pruef_db_fehler.php`], { encoding: 'utf8' });
} catch (e) {
  ausgabe = String(e.stdout || '') + String(e.stderr || '');
  code = e.status || 1;
}
const anzahl = Number((ausgabe.match(/^(\d+) bestanden/m) || [0, 0])[1]);
const fehler = ausgabe.split('\n').filter(z => z.trim().startsWith('x '));

check('KRITISCH: db_fehlermeldung() laeuft ueberhaupt durch', anzahl > 0);
check('KRITISCH: alle Faelle bestehen, inklusive des vorher unsichtbaren Codes',
  code === 0 && fehler.length === 0);
fehler.forEach(f => bad.push('PHP: ' + f.trim()));

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
