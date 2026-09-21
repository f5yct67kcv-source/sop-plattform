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
import { execFileSync } from 'child_process';
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

// ── Zuerst: keine Konfliktmarke in den Protokolldateien ───────────────
//
// ANLASS (2026-09-21): Ein Merge hat zwei unaufgelöste Konfliktblöcke ins
// Entscheidungsprotokoll committet und ist gepusht worden. `git merge`
// hatte beide betroffenen Dateien genannt; die Ausgabe war durch `tail`
// geschickt worden, und genau diese Zeile fiel weg (dieselbe Lehre wie
// OP-527, nur an der Merge-Ausgabe statt am Regressionslauf).
//
// Gemerkt hat es niemand, weil keine Prüfung die Dateien ansieht: Die
// Nummernprüfung unten zählt Überschriften, und eine Konfliktmarke ist
// keine. Das Protokoll blieb formal in Ordnung und war trotzdem kaputt.
//
// Geprüft wird am Zeilenanfang, wie Git sie schreibt -- so trifft es
// keinen Fliesstext, der zufällig solche Zeichen enthält. Die Trennlinie
// mit sieben Gleichheitszeichen steht ausdrücklich dabei: Sie ist die
// unauffälligste der drei und überlebt am ehesten.
for (const datei of ['entscheidungsprotokoll.md', 'offene-punkte.md']) {
  const t = readFileSync(join(PROJEKT, datei), 'utf8');
  const marken = [...t.matchAll(/^(<{7} |={7}$|>{7} )/gm)].map(m => m[1].trim());
  check(`KRITISCH: keine Konfliktmarke in ${datei}`, marken.length === 0);
  if (marken.length) {
    bad.push(`${datei}: ${marken.length} Konfliktmarke(n) -- ein Merge ist nicht zu Ende gebracht worden`);
  }
}

// ── ENT-Nummern: jede Überschrift "## ENT-xxx" im Entscheidungsprotokoll.
// "ENT-077-N1" (ein Nachtrag) zählt als eigene ID, nicht als Duplikat von
// ENT-077 -- beide dürfen nebeneinander stehen.
const entText = readFileSync(join(PROJEKT, 'entscheidungsprotokoll.md'), 'utf8');
const entIds = [...entText.matchAll(/^## (ENT-\d+(?:-N\d+)?)\b/gm)].map(m => m[1]);

check('Das Entscheidungsprotokoll ist lesbar und enthält Einträge', entIds.length > 10);

const entDoppelt = doppelte(entIds);
check('KRITISCH: keine ENT-Nummer köpft zwei Einträge', entDoppelt.length === 0);
entDoppelt.forEach(id => bad.push(`${id} doppelt vergeben in entscheidungsprotokoll.md`));

// ── Kein Eintrag wird unter seiner Nummer ausgetauscht ────────────────
//
// ANLASS (2026-09-21): Zwei Sitzungen vergaben ENT-648 im Abstand von 74
// Sekunden. Beim Merge loeste ein `git checkout --ours` den Konflikt
// zugunsten des eigenen Standes -- und haette damit den fremden Eintrag
// vollstaendig ueberschrieben, dazu eine Zeile in ENT-638, die auf ihn
// verweist. Die Nummernpruefung oben blieb gruen: Die Nummer stand
// weiterhin genau einmal da, nur hinter ihr ein anderer Text.
//
// GEPRUEFT WIRD DIE HAUSREGEL, nicht der Wortlaut: "Eine bestehende
// Entscheidung wird nicht ueberschrieben, sondern durch einen neuen
// Eintrag revidiert" (CLAUDE.md sop-projekt). Ein Titel, der sich
// gegenueber `origin/main` aendert, ist genau dieses Ueberschreiben.
// Ergaenzungen INNERHALB eines Eintrags bleiben erlaubt -- ein Nachtrag
// oder ein Rueckverweis aendert den Titel nicht.
//
// Ohne erreichbares `origin/main` (flacher Klon, kein Netz) wird die
// Frage nicht beantwortet. Das wird dann auch so gesagt und nicht als
// bestanden gezaehlt: "nicht pruefbar" ist keine Unbedenklichkeit.
const titel = (text) => {
  const m = new Map();
  for (const t of text.matchAll(/^## (ENT-\d+(?:-N\d+)?)(.*)$/gm)) {
    m.set(t[1], t[2].trim());
  }
  return m;
};

let mainText = null;
try {
  mainText = execFileSync('git', ['show', 'origin/main:00-projekt/entscheidungsprotokoll.md'],
    // maxBuffer: Das Protokoll ist groesser als Nodes Standardpuffer von 1 MiB.
    // Ohne diese Zeile wirft git ENOBUFS, und die Pruefung meldete auf ewig
    // "nicht pruefbar" -- eine Pruefung, die nie laeuft, ist keine.
    { cwd: dirname(PROJEKT), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'] });
} catch { /* kein origin/main erreichbar */ }

if (mainText === null) {
  console.log('Hinweis: origin/main im Projekt-Repository nicht erreichbar --');
  console.log('  ob ein Eintrag unter seiner Nummer ausgetauscht wurde, ist NICHT geprüft.');
} else {
  const alt = titel(mainText), jetzt = titel(entText);
  const getauscht = [...alt].filter(([id, tx]) => jetzt.has(id) && jetzt.get(id) !== tx);
  check('KRITISCH: kein Eintrag ist unter einer bereits vergebenen Nummer ausgetauscht worden',
    getauscht.length === 0);
  getauscht.forEach(([id, tx]) => bad.push(
    `${id} traegt einen anderen Titel als auf origin/main -- dort "${tx}", `
    + `hier "${jetzt.get(id)}". Ein Eintrag wird revidiert, nicht ersetzt.`));
}

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
