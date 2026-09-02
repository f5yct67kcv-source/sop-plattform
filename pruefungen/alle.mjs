// Alle Pruefungen in einem Lauf.
//
//     node pruefungen/alle.mjs            alles
//     node pruefungen/alle.mjs rollen     nur Suiten, deren Name "rollen" enthaelt
//     node pruefungen/alle.mjs --seriell  eine nach der anderen (zum Nachstellen)
//     SOP_BAHNEN=2 node pruefungen/alle.mjs   Anzahl Bahnen selbst bestimmen
//
// Ergebnis: 0 = alles gruen, 1 = mindestens eine Suite rot.
//
// Wozu: Vor jedem Push ausfuehren. Es arbeiten mehrere Beteiligte parallel am
// selben Repository; wer nicht prueft, was er aendert, bricht einen fremden
// Bereich, ohne es zu merken -- und der Deploy geht bei jedem Push sofort
// live.
//
// Seit ENT-310 laufen mehrere Suiten gleichzeitig. Der Grund war nicht
// Ungeduld, sondern eine Messung: 95 Suiten nacheinander brauchten rund 16
// Minuten, waehrend drei von vier Prozessorkernen nichts taten. Der Deploy
// selbst dauert 15 bis 21 Sekunden -- die Wartezeit lag also vollstaendig
// hier.
//
// Zwei Dinge sind dabei ausdruecklich NICHT geopfert worden:
//  - Es wird nichts weggelassen. Dieselben Suiten, dieselben Pruefungen.
//  - Eine rote Suite wird EINZELN wiederholt, bevor sie als rot gilt (siehe
//    lauf.mjs). Ein Netz, dem man nicht traut, ist wertlos.
import { execFile } from 'child_process';
import { readdirSync } from 'fs';
import { cpus } from 'os';
import { HIER } from './pfade.mjs';
import { poolLauf, mitWiederholung } from './lauf.mjs';

const argumente = process.argv.slice(2);
const seriell = argumente.includes('--seriell');
const filter = argumente.find(a => !a.startsWith('--')) || '';

const suiten = readdirSync(HIER)
  .filter(f => f.startsWith('test_') && f.endsWith('.mjs'))
  .filter(f => !filter || f.includes(filter))
  .sort();

if (!suiten.length) {
  console.log(filter ? `Keine Suite passt auf "${filter}".` : 'Keine Suiten gefunden.');
  process.exit(1);
}

// Erst nachsehen, ob Playwright ueberhaupt da ist. Ohne die Abhaengigkeit
// scheitert JEDE Suite mit demselben Fehler -- 37 rote Zeilen, die alle
// dasselbe sagen und die eigentliche Ursache verdecken.
try {
  await import('playwright');
} catch {
  console.log('Playwright fehlt.\n\n    cd pruefungen && npm install\n\n'
    + 'Danach laeuft "node pruefungen/alle.mjs". Einmal pro Rechner noetig.');
  process.exit(2);
}

// Eine Bahn je Kern, hoechstens vier. Mehr Bahnen als Kerne bringen nichts:
// Jede Suite startet einen echten Browser und rechnet, sie wartet nicht auf
// ein Netz. Die Obergrenze steht da, damit ein grosser Rechner nicht 32
// Browser gleichzeitig oeffnet und am Arbeitsspeicher scheitert.
const bahnen = seriell ? 1
  : Math.max(1, Math.min(4, Number(process.env.SOP_BAHNEN) || (cpus().length || 2)));

function starte(name) {
  return new Promise(fertig => {
    execFile('node', [HIER + '/' + name], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
      (fehler, aus, err) => {
        const text = String(aus || '') + String(err || '');
        const code = fehler ? (fehler.code === undefined ? 1 : fehler.code) : 0;
        // Die Suiten melden unterschiedlich; beide Formen zaehlen.
        const zahl = (text.match(/(\d+) bestanden/) || [])[1] || '?';
        const schlecht = code !== 0
          || /nicht bestanden|FEHLGESCHLAGEN/.test(text.replace(/0 nicht bestanden/g, ''));
        fertig({ gruen: !schlecht, zahl, text });
      });
  });
}

// Zeilen, die erklaeren WAS schiefging -- nicht der ganze Auswurf.
function gruende(text) {
  return text.split('\n').filter(z => /✗|FEHLGESCHLAGEN|^\s+- /.test(z)).slice(0, 8);
}

const start = Date.now();
console.log(`${suiten.length} Suiten, ${bahnen} ${bahnen === 1 ? 'Bahn' : 'Bahnen'}.\n`);

let fertigZahl = 0;
const { ergebnisse, hoechststand } = await poolLauf(suiten, starte, bahnen, (name, e) => {
  fertigZahl++;
  const zaehler = String(fertigZahl).padStart(String(suiten.length).length);
  console.log(`${zaehler}/${suiten.length}  ${name.padEnd(38)}`
    + (e.gruen ? `gruen (${e.zahl})` : `ROT   (${e.zahl} bestanden)`));
});

// Rote Suiten einzeln wiederholen, bevor sie als rot gelten. Erst danach
// steht fest, ob es die Software ist oder der Parallelbetrieb.
let rot = [], wackelig = [];
const verdaechtig = suiten.filter((s, i) => !ergebnisse[i].gruen);
if (verdaechtig.length) {
  console.log(`\n${verdaechtig.length} rot -- werden einzeln wiederholt, `
    + 'bevor sie als rot gelten:\n');
  const { echt, wackelig: w } = await mitWiederholung(verdaechtig, starte);
  rot = echt.map(x => x.name);
  wackelig = w.map(x => x.name);
  echt.forEach(x => {
    console.log(`  ROT   ${x.name}`);
    gruende(x.ergebnis.text).forEach(z => console.log('        ' + z.trim()));
  });
  wackelig.forEach(x => console.log(`  gruen ${x} (allein bestanden)`));
}

const sek = Math.round((Date.now() - start) / 1000);
console.log(`\n${suiten.length - rot.length} von ${suiten.length} Suiten gruen, ${sek}s`
  + (bahnen > 1 ? ` (bis zu ${hoechststand} gleichzeitig).` : '.'));

if (wackelig.length) {
  // Nicht verschweigen: Eine Suite, die parallel scheitert und allein
  // besteht, ist ein Befund. Wird das stillschweigend geschluckt, verdeckt
  // die Wiederholung genau die Unzuverlaessigkeit, die sie sichtbar machen
  // soll -- und irgendwann steckt dahinter ein echter Fehler.
  console.log('\nNur im parallelen Lauf rot, allein gruen: ' + wackelig.join(', '));
  console.log('Das ist kein gruenes Licht fuer die Suite, sondern ein Hinweis:');
  console.log('Mit "node pruefungen/alle.mjs --seriell" nachstellen und die Ursache suchen.');
}

if (rot.length) {
  console.log('\nROT: ' + rot.join(', '));
  console.log('\nNicht schieben, solange etwas rot ist -- der Deploy geht sofort live.');
  process.exit(1);
}
