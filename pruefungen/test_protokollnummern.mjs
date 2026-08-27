// Keine ENT- oder OP-Nummer darf doppelt vergeben sein.
//
// Vorgefallen am 19.08.2026 (ENT-043, später auf ENT-079 umgehängt) und am
// 20.08.2026 (OP-49 und OP-50, je mehrfach vergeben): Zwei parallel
// arbeitende Sitzungen zogen dieselbe nächste Nummer, ohne voneinander zu
// wissen -- keiner der beiden Merges war ein Git-Konflikt, weil zwei
// unterschiedliche Texteinfügungen an verschiedener Stelle für Git kein
// Widerspruch sind, nur für das Protokoll. Siehe
// 00-projekt/offene-punkte.md, Abschnitt "Korrektur der Nummerierung".
//
// Die Nummern stehen im Projekt-Repository (sop-projekt), nicht hier. Diese
// Prüfung liest es als Nachbar-Verzeichnis -- genau die Anordnung, die ein
// Aufgaben-Chat laut STARTPROMPT.md ohnehin hat, weil sonst "der Chat weder
// die freie ENT-Nummer noch die Auslegungen kennt". Fehlt das Verzeichnis
// (z. B. ein Klon ohne diesen Nachbarn), wird übersprungen statt rot: Das
// Fehlen sagt nichts über den Code in diesem Repository aus.
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { WURZEL } from './pfade.mjs';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const PROJEKT = join(dirname(WURZEL), 'sop-projekt', '00-projekt');

if (!existsSync(PROJEKT)) {
  console.log('sop-projekt nicht als Nachbar-Verzeichnis gefunden -- übersprungen.');
  console.log('\n0 bestanden, 0 nicht bestanden\n');
  process.exit(0);
}

// Doppelt vergeben heisst: dieselbe ID köpft zwei verschiedene Einträge.
const doppelte = (ids) => {
  const zaehler = new Map();
  ids.forEach(id => zaehler.set(id, (zaehler.get(id) || 0) + 1));
  return [...zaehler].filter(([, n]) => n > 1).map(([id]) => id);
};

// ── ENT-Nummern: jede Überschrift "## ENT-xxx" im Entscheidungsprotokoll.
// "ENT-077-N1" (ein Nachtrag) zählt als eigene ID, nicht als Duplikat von
// ENT-077 -- beide dürfen nebeneinander stehen.
const entText = readFileSync(join(PROJEKT, 'entscheidungsprotokoll.md'), 'utf8');
const entIds = [...entText.matchAll(/^## (ENT-\d+(?:-N\d+)?)\b/gm)].map(m => m[1]);

check('Das Entscheidungsprotokoll ist lesbar und enthält Einträge', entIds.length > 10);

const entDoppelt = doppelte(entIds);
check('KRITISCH: keine ENT-Nummer köpft zwei Einträge', entDoppelt.length === 0);
entDoppelt.forEach(id => bad.push(`${id} doppelt vergeben in entscheidungsprotokoll.md`));

// ── OP-Nummern: Zeilen der Haupttabelle in offene-punkte.md.
//
// Ausgenommen sind Zeilen der "Korrektur der Nummerierung"-Tabellen -- dort
// steht in der zweiten Spalte absichtlich die NEUE Nummer eines bereits
// umgehängten Punkts ("**OP-56**"), das ist ein Verweis auf die Korrektur,
// keine zweite Vergabe. Erkannt am Inhalt, nicht an der Position: Eine
// echte Zeile trägt in Spalte 2 den Punkt-Text, nie eine reine, fett
// gesetzte Nummer.
const opText = readFileSync(join(PROJEKT, 'offene-punkte.md'), 'utf8');
const IST_VERWEIS_AUF_KORREKTUR = /^\*\*(?:OP|ENT)-\d+/;
const opIds = [];
for (const zeile of opText.split('\n')) {
  const treffer = zeile.match(/^\|\s*(OP-\d+)\s*\|\s*([^|]*)\|/);
  if (treffer && !IST_VERWEIS_AUF_KORREKTUR.test(treffer[2].trim())) {
    opIds.push(treffer[1]);
  }
}

check('Die offenen Punkte sind lesbar und enthalten Einträge', opIds.length > 10);

const opDoppelt = doppelte(opIds);
check('KRITISCH: keine OP-Nummer köpft zwei Punkte', opDoppelt.length === 0);
opDoppelt.forEach(id => bad.push(`${id} doppelt vergeben in offene-punkte.md`));

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Prüfungen bestanden.');
