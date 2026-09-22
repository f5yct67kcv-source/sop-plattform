// Findet jeder Funktionsaufruf eines oeffentlichen Endpunkts sein Ziel?
// (Nachtrag zu ENT-612, 2026-09-18.)
//
// Ausgeloest durch einen echten Fehlschlag: Der oeffentliche Demo-Zugang
// auf guardops.ch beantwortete sieben Anlaeufe lang jede Anfrage mit
// "Unerwarteter Serverfehler". Die Ursache war weder Datenbank noch
// Logik, sondern ein stiller Vertrag zwischen zwei Dateien: demo_reset.php
// benutzte system_rollen() aus rechte.php und verliess sich darauf, dass
// der Aufrufer rechte.php schon geladen hat. Fuer seine damaligen
// Aufrufer stimmte das; demo_anfordern.php erbte die Annahme nicht.
//
// Genau das Muster, vor dem CLAUDE.md warnt ("Regeln, die ueber Dateien
// hinweg gelten [...] jedes Mal beim Bauen von etwas Neuem, das die Regel
// nicht geerbt hat") -- und es blieb unsichtbar, weil so ein Abbruch keine
// PDOException ist und beim Anfragenden nur die Sammelmeldung ankam.
//
// pruef_ladepfad.php laedt darum wirklich, was ein Endpunkt laedt, und
// fragt PHP selbst, welche Funktionen danach existieren.
import { HIER } from './pfade.mjs';
import { execFileSync } from 'child_process';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

let ausgabe = '', code = 0;
try {
  ausgabe = execFileSync('php', [`${HIER}/pruef_ladepfad.php`], { encoding: 'utf8' });
} catch (e) {
  ausgabe = String(e.stdout || '') + String(e.stderr || '');
  code = e.status || 1;
}
const anzahl = Number((ausgabe.match(/^(\d+) bestanden/m) || [0, 0])[1]);
const fehler = ausgabe.split('\n').filter(z => z.trim().startsWith('x '));

check('KRITISCH: die Ladepfad-Pruefung laeuft ueberhaupt durch', anzahl > 0);
check('KRITISCH: jeder oeffentliche Endpunkt findet jede Funktion, die er aufruft',
  code === 0 && fehler.length === 0);
fehler.forEach(f => bad.push('PHP: ' + f.trim()));

// ── Und ab wann er sie findet (2026-09-22) ──────────────────────────
//
// Die Pruefung oben laedt die ganze Kette und fragt, OB die Funktion
// existiert. api/login.php rief ma_nur_menschen() in der Abfrage auf, mit
// der die Anmeldung beginnt, und lud mitarbeiter.php erst sechzig Zeilen
// spaeter -- die Funktion existierte, nur zu spaet. Ergebnis: "Unerwarteter
// Serverfehler" bei jeder Anmeldung auf jeder Anlage. Darum die zweite
// Frage: ab welcher Zeile ist geladen, was in welcher Zeile gerufen wird.
let reihe = '', reiheCode = 0;
try {
  reihe = execFileSync('php', [`${HIER}/pruef_ladepfad_reihenfolge.php`], { encoding: 'utf8' });
} catch (e) {
  reihe = String(e.stdout || '') + String(e.stderr || '');
  reiheCode = e.status || 1;
}
const reiheAnzahl = Number((reihe.match(/^(\d+) bestanden/m) || [0, 0])[1]);
const reiheFehler = reihe.split('\n').filter(z => z.trim().startsWith('x '));

// Die Zahl gehoert MIT in die Bedingung: Stirbt die PHP-Datei, bevor sie
// zaehlt, waere sonst alles gruen, obwohl nichts geprueft wurde.
check('KRITISCH: die Reihenfolge-Pruefung sieht alle Endpunkte an', reiheAnzahl > 100);
check('KRITISCH: kein Endpunkt ruft eine Funktion vor ihrem require',
  reiheCode === 0 && reiheFehler.length === 0);
reiheFehler.forEach(f => bad.push('PHP: ' + f.trim()));

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
