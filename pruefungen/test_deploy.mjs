// Jede gemeinsam genutzte Skriptdatei muss im Deploy stehen (ENT-110).
//
// Warum diese Suite: gav.js und zeitwahl.js liegen im Wurzelverzeichnis und
// werden von beiden Oberflächen geladen. Der Deploy kopiert nicht das ganze
// Verzeichnis, sondern jede Datei einzeln. Wer eine dritte gemeinsame Datei
// anlegt und die Zeile vergisst, merkt es nicht beim Prüfen -- lokal liegt
// die Datei ja da. Auffallen würde es erst produktiv, und der Push geht
// sofort live.
//
// Der Fallstrick ist bekannt und im Deploy zweimal auskommentiert (ENT-040,
// ENT-049). Ein Kommentar ist aber keine Prüfung.
import { WURZEL } from './pfade.mjs';
import { readFileSync, existsSync } from 'fs';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const workflow = readFileSync(`${WURZEL}/.github/workflows/deploy-hostpoint.yml`, 'utf8');
const seiten = ['index.html', 'dashboard.html', 'app.html'];

for (const seite of seiten) {
  const html = readFileSync(`${WURZEL}/${seite}`, 'utf8');
  // Nur eigene Dateien, keine fremden Adressen.
  const skripte = [...html.matchAll(/<script\s+src="([^"]+)"/g)]
    .map(m => m[1])
    .filter(q => !/^https?:\/\//.test(q));
  for (const q of skripte) {
    check(`${seite} lädt ${q} — die Datei gibt es`, existsSync(`${WURZEL}/${q}`));
    check(`KRITISCH: ${q} wird auch deployt (von ${seite} geladen)`,
      new RegExp(`cp\\s+${q.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\s+dist/`).test(workflow));
  }
}

// Und die Gegenrichtung: Wer eine HTML-Seite anlegt und nicht deployt, hat
// dasselbe Problem eine Ebene höher.
for (const seite of seiten) {
  check(`KRITISCH: ${seite} wird deployt`,
    new RegExp(`cp\\s+${seite}\\s+dist/`).test(workflow));
}

// Die Ersteinrichtung gehört ausdrücklich NICHT in den Deploy (Kommentar im
// Workflow). Diese Prüfung hält den Entscheid fest, statt ihn dem nächsten
// Lesen zu überlassen.
check('KRITISCH: setup wird nicht mitdeployt', !/cp\s+setup\.(php|html)\s+dist/.test(workflow));

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
