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
import { readFileSync, existsSync, readdirSync } from 'fs';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const workflow = readFileSync(`${WURZEL}/.github/workflows/deploy-hostpoint.yml`, 'utf8');
const seiten = ['index.html', 'dashboard.html', 'app.html'];

// Nicht nur die drei bekannten HTML-Huellen: eine oeffentliche PHP-Seite
// (z. B. beleg_oeffentlich.php, ENT-205) kann ein eigenes <script src>
// einbinden, ohne dass dashboard.html/app.html davon etwas wissen -- genau
// diese Luecke liess qrcode.js beim ersten Mal aus dem Deploy fallen, bis
// test_php.mjs es ueber die separate "jede Backend-Datei"-Pruefung fing.
// Hier wird derselbe Fallstrick fuer STATISCHE Dateien (root-Ebene, per
// <script src> geladen) direkt geschlossen, nicht nur fuer PHP-Dateien.
const phpDateien = readdirSync(`${WURZEL}/backend/api`)
  .filter(f => f.endsWith('.php')).map(f => `backend/api/${f}`);

for (const seite of [...seiten, ...phpDateien]) {
  const html = readFileSync(`${WURZEL}/${seite}`, 'utf8');
  // Nur eigene Dateien, keine fremden Adressen. Zwei Muster: ein literales
  // <script src="…"> UND ein per JS nachgeladenes Skript (s.src = "…js"),
  // wie beleg_oeffentlich.php es fuer html2pdf.bundle.min.js macht (ENT-206)
  // -- ein Skript, das erst bei Klick nachgeladen wird, steht nie als
  // literales <script>-Tag im HTML.
  const skripte = [
    ...[...html.matchAll(/<script\s+src="([^"]+)"/g)].map(m => m[1]),
    ...[...html.matchAll(/\.src\s*=\s*"([^"]+\.js)"/g)].map(m => m[1]),
  ]
    .map(q => q.replace(/^\//, ''))
    .filter((q, i, arr) => arr.indexOf(q) === i)
    .filter(q => !/^https?:\/\//.test(q));
  for (const q of skripte) {
    check(`${seite} lädt ${q} — die Datei gibt es`, existsSync(`${WURZEL}/${q}`));
    check(`KRITISCH: ${q} wird auch deployt (von ${seite} geladen)`,
      new RegExp(`cp\\s+${q.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\s+dist/`).test(workflow));
  }
}

// Dasselbe für Dateien, die das CSS per url(...) holt -- Schriften, Bilder,
// Hintergründe. Bis ENT-223 gab es hier gar keine solche Datei, seither
// liegen zwei Schriftschnitte unter fonts/ (Inter, selbst ausgeliefert statt
// von Google, OP-224). Die Prüfung oben hätte sie NICHT gefangen: Sie kennt
// nur <script src> und .src = "…js".
//
// Der Fallstrick ist hier besonders heimtückisch, weil er nicht kracht: Fehlt
// die Schrift auf dem Server, faellt der Text still auf den System-Stapel
// zurück. Lokal sieht alles richtig aus (die Dateien liegen ja da), und
// produktiv sieht es nur "irgendwie anders" aus, ohne Fehlermeldung.
const alsGlobPassend = (pfad, zeile) => {
  // Der Deploy kopiert teils einzeln (cp gav.js dist/gav.js), teils als
  // Gruppe (cp fonts/*.woff2 dist/fonts/). Beides muss zählen, sonst
  // verlangt die Prüfung eine Schreibweise statt einer Wirkung.
  const muster = zeile.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  return new RegExp(`^${muster}$`).test(pfad);
};
const kopierteQuellen = [...workflow.matchAll(/^\s*cp\s+(\S+)\s+dist\//gm)].map(m => m[1]);

for (const seite of seiten) {
  const html = readFileSync(`${WURZEL}/${seite}`, 'utf8');
  const quellen = [...html.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map(m => m[1].trim())
    .filter((q, i, arr) => arr.indexOf(q) === i)
    .filter(q => !/^(https?:|data:|#)/.test(q))
    .map(q => q.replace(/^\.?\//, ''));
  for (const q of quellen) {
    check(`${seite} holt ${q} per CSS — die Datei gibt es`, existsSync(`${WURZEL}/${q}`));
    check(`KRITISCH: ${q} wird auch deployt (per CSS von ${seite} geholt)`,
      kopierteQuellen.some(zeile => alsGlobPassend(q, zeile)));
  }
}

// Die Schriftlizenz muss mit. Die SIL Open Font License 1.1 verlangt, dass
// sie die Schrift begleitet -- wer die woff2 ausliefert und die Lizenz
// weglaesst, verteilt sie nicht lizenzkonform. Kein Aussehen-Problem,
// darum faellt es sonst niemandem auf.
if (existsSync(`${WURZEL}/fonts`)) {
  const schriften = readdirSync(`${WURZEL}/fonts`).filter(f => f.endsWith('.woff2'));
  if (schriften.length) {
    check('KRITISCH: die Schriftlizenz liegt bei den Schriften',
      existsSync(`${WURZEL}/fonts/inter-LICENSE.txt`));
    check('KRITISCH: die Schriftlizenz wird mitdeployt',
      /cp\s+fonts\/inter-LICENSE\.txt\s+dist\//.test(workflow));
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
