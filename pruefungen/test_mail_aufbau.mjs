// Der MIME-Aufbau der Mails, wirklich ausgefuehrt (ENT-648).
//
// Anlass: Das Logo in der Signatur wird als eingebettetes Bild verschickt
// (Content-ID, multipart/related) -- derselbe Weg, den Outlook fuer seine
// eigenen Signaturen nimmt. Der Zusammenbau aus Klartext, HTML, Bild und
// Anhang ist die fehleranfaelligste Stelle des Mailers: Eine falsch
// verschachtelte Grenze macht aus dem Logo einen Anhang, aus dem Anhang
// eine dritte Textvariante oder aus der Nachricht eine unlesbare Wand --
// und sichtbar wird das erst im Postfach des Empfaengers.
//
// pruef_mail_aufbau.php fuehrt smtp_nachricht_bauen() darum wirklich aus
// und misst die erzeugte Nachricht nach, statt im Quelltext nachzulesen.

import { HIER } from './pfade.mjs';
import { execFileSync } from 'child_process';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

let ausgabe = '', code = 0;
try {
  ausgabe = execFileSync('php', [`${HIER}/pruef_mail_aufbau.php`], { encoding: 'utf8' });
} catch (e) {
  ausgabe = String(e.stdout || '') + String(e.stderr || '');
  code = e.status || 1;
}
const anzahl = Number((ausgabe.match(/^(\d+) bestanden/m) || [0, 0])[1]);
const fehler = ausgabe.split('\n').filter(z => z.trim().startsWith('x '));

check('KRITISCH: der Aufbau laeuft ueberhaupt durch', anzahl > 0);
check('KRITISCH: jeder Fall stimmt -- mit Bild, mit Anhang, mit beidem, mit keinem',
  code === 0 && fehler.length === 0);
fehler.forEach(f => bad.push('PHP: ' + f.trim()));

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
