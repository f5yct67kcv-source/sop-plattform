// Das engere Update-Kriterium (ENT-033-Nachtrag): kern_verweise_fehlend()
// wirklich ausfuehren (pruef_kern_verweise.php) und nachsehen, dass
// planung_einrichten_ausfuehren() das "ausstehend"-Feld tatsaechlich daraus
// UND aus kern_schema_fehlend() berechnet -- nicht mehr aus count($getan).
//
// ANLASS: Der Update-Knopf im Konto-Menue faerbte sich gelb, sobald IRGEND-
// ein offener Punkt aus der Einrichtung anstand -- auch laufende Datenpflege
// (fehlende Rolle, "abgeschlossen"-Nachtrag, unerfasste Lohnsaetze usw.),
// die im Alltag jederzeit neu entsteht. Direkt nach einer erfolgreichen
// Einrichtung stand er darum oft gleich wieder auf Gelb, obwohl kein Update
// (kein Deploy-Nachtrag an Tabellen/Spalten/Verweisen) mehr anstand.
import { HIER, WURZEL } from './pfade.mjs';
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

let ausgabe = '', code = 0;
try {
  ausgabe = execFileSync('php', [`${HIER}/pruef_kern_verweise.php`], { encoding: 'utf8' });
} catch (e) {
  ausgabe = String(e.stdout || '') + String(e.stderr || '');
  code = e.status || 1;
}
const anzahl = Number((ausgabe.match(/^(\d+) bestanden/m) || [0, 0])[1]);
const fehler = ausgabe.split('\n').filter(z => z.trim().startsWith('x '));

check('KRITISCH: die Pruefung laeuft ueberhaupt durch', anzahl > 0);
check('KRITISCH: kern_verweise_fehlend() erkennt einen fehlenden Fremdschluessel', code === 0 && fehler.length === 0);
fehler.forEach(f => bad.push('PHP: ' + f.trim()));

// GEGENPROBE, ohne Kommentare: Die erste Fassung dieser Sperre suchte im
// rohen Text und haette ein Vorkommen in einem erklaerenden Kommentar schon
// als Beleg genommen -- die Sperre waere gruen geblieben, obwohl die
// Berechnung wieder auf count($getan) zurueckgefallen ist (Regel 1:
// geprueft wird die Aussage, nicht der Wortlaut).
const kern = readFileSync(`${WURZEL}/backend/planung_einrichten_kern.php`, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const beiAusstehend = kern.indexOf("'ausstehend' =>");
check('KRITISCH: das Ergebnis traegt ueberhaupt ein "ausstehend"-Feld', beiAusstehend > -1);
const zeile = beiAusstehend > -1 ? kern.slice(beiAusstehend, kern.indexOf('\n', beiAusstehend)) : '';
check('KRITISCH: "ausstehend" wird NICHT (mehr) direkt aus jedem offenen Punkt gezaehlt',
  !zeile.includes('count($getan)'));
// Die eigentliche Berechnung steht eine Zuweisung davor -- ihr Wert ist die
// Variable, die "ausstehend" oben traegt, nicht der Text "$schemaOffen"
// selbst (das waere wieder nur Wortlaut).
const trefferVar = zeile.match(/=>\s*(\$\w+)\s*,/);
const zuweisung = trefferVar
  ? kern.slice(0, beiAusstehend).lastIndexOf(trefferVar[1] + ' =')
  : -1;
const zuweisungsZeile = zuweisung > -1 ? kern.slice(zuweisung, kern.indexOf('\n', zuweisung)) : '';
check('KRITISCH: diese Variable wird aus kern_schema_fehlend() UND kern_verweise_fehlend() berechnet',
  zuweisungsZeile.includes('kern_schema_fehlend(') && zuweisungsZeile.includes('kern_verweise_fehlend('));

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
