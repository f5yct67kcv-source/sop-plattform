// Archiv der Betreiber-Konten und der Weg zum eigenen Passwort (ENT-672).
//
// WARUM DIESE SUITE
//
// Beide Punkte kommen aus dem ersten echten Gebrauch, und beide sind von
// der Sorte, die beim naechsten Umbau still verschwindet:
//
//   1. ARCHIVIEREN IST NICHT LOESCHEN. Der Unterschied ist die ganze
//      Entscheidung (ENT-519, ENT-672): Die Zeile bleibt, das Logbuch
//      behaelt seinen Bezug, nur die Liste wird aufgeraeumt. Ein spaeterer
//      "Aufraeum"-Endpunkt, der daraus ein DELETE macht, nimmt der Ebene
//      die einzige Auskunft darueber, wer einmal Zugang zu ALLEN Mandanten
//      hatte.
//   2. NUR EIN STILLGELEGTES KONTO. Ein aktives zu archivieren hiesse,
//      einen bestehenden Zugang aus der Liste zu nehmen -- genau die
//      Unsichtbarkeit, gegen die die Liste da ist.
//   3. DER WEG ZUM EIGENEN PASSWORT muss auffindbar bleiben. Er existierte
//      schon und wurde trotzdem vermisst; eine Funktion, die niemand
//      findet, ist praktisch keine.
import { WURZEL } from './pfade.mjs';
import { readFileSync } from 'fs';
import { join } from 'path';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const lies = p => readFileSync(join(WURZEL, p), 'utf8');
// Kommentare weg, bevor ueber CODE geurteilt wird -- sonst faende jede
// Suche auch die Stelle, an der eine Datei erklaert, was sie bewusst NICHT
// tut, und ausgerechnet die sorgfaeltig kommentierte fiele durch.
const nurCode = q => q.replace(/\/\*[\s\S]*?\*\//g, '')
                      .replace(/^\s*\/\/.*$/gm, '')
                      .replace(/^\s*--.*$/gm, '');

const archivieren = nurCode(lies('backend/api/betreiber_konto_archivieren.php'));
const liste       = nurCode(lies('backend/api/betreiber_konto_list.php'));
const status      = nurCode(lies('backend/api/betreiber_konto_status.php'));
const modul       = nurCode(lies('backend/betreiber.php'));
const seite       = lies('betreiber.html');

// ── 1. Archivieren loescht nicht ──────────────────────────────────────
//
// Die wichtigste Pruefung dieser Datei. Geprueft an dem, was ein Loeschen
// zwingend braeuchte -- ein DELETE auf `betreiber` --, und zwar in BEIDEN
// Endpunkten, die den Zustand eines Kontos veraendern.
for (const [name, quelle] of [['archivieren', archivieren], ['stilllegen', status]]) {
  check(`KRITISCH: "${name}" entfernt kein Konto`,
    !/DELETE\s+FROM\s+betreiber\b/i.test(quelle));
}
check('KRITISCH: archivieren setzt einen Zeitpunkt, statt die Zeile anzutasten',
  /UPDATE betreiber SET archiviert_am/.test(archivieren));
// Die Kehrseite: Zurueckholen muss gehen, sonst ist "archiviert" ein
// Einbahnweg und damit ein Loeschen mit anderem Namen.
check('KRITISCH: und es laesst sich zurueckholen',
  /NULL/.test(archivieren) && /archiv/.test(archivieren));

// ── 2. Nur ein stillgelegtes Konto ────────────────────────────────────
//
// Geprueft an der Wache selbst, nicht am Wortlaut ihrer Meldung: Sie muss
// den Fall "archivieren UND aktiv" abweisen, bevor geschrieben wird.
const posUpdate = archivieren.indexOf('UPDATE betreiber');
// Der Abschnitt VOR dem Schreiben muss eine Bedingung enthalten, die
// "archivieren" und "aktiv" miteinander verknuepft. Bewusst nicht auf die
// genaue Schreibweise geprueft -- ein (int)-Cast oder eine umgestellte
// Bedingung darf die Pruefung nicht rot machen, das Fehlen der Wache schon.
//
// GESCHAERFT nach einer Gegenprobe: Zuerst stand hier nur, dass "$archiv",
// "aktiv" und "json_response" irgendwo vor dem Schreiben vorkommen. Das
// blieb gruen, als die Wache probeweise ENTFERNT wurde -- alle drei stehen
// ohnehin im Code (Variablenzuweisung, SELECT, andere Fehlerpfade). Eine
// Pruefung, die den Fehler nicht bemerkt, gegen den sie gerichtet ist, ist
// eine Behauptung. Jetzt muss es EINE Bedingung geben, die beide Begriffe
// miteinander verknuepft.
const vorDemSchreiben = posUpdate > 0 ? archivieren.slice(0, posUpdate) : '';
const wacheZeile = vorDemSchreiben.split('\n').find(z =>
  /^\s*if\s*\(/.test(z) && z.includes('$archiv') && z.includes('aktiv'));
check('KRITISCH: ein aktives Konto laesst sich nicht archivieren',
  !!wacheZeile && /json_response/.test(vorDemSchreiben.slice(vorDemSchreiben.indexOf(wacheZeile))));
check('… und die Wache steht im Server, nicht nur in der Oberflaeche',
  /409/.test(archivieren));
// In der Oberflaeche erspart sie den Umweg -- mehr nicht (CLAUDE.md).
check('die Oberflaeche bietet Archivieren nur am stillgelegten Konto an',
  /if \(!k\.aktiv\) \{[\s\S]{0,400}?kontoArchiv/.test(seite));

// ── 3. Die Wache am Endpunkt selbst ───────────────────────────────────
check('KRITISCH: der Endpunkt verlangt den zweiten Faktor',
  /require_betreiber_voll\s*\(/.test(archivieren));
check('KRITISCH: und nimmt nur POST',
  /REQUEST_METHOD[^;]*POST/.test(archivieren));

// ── 4. Fehlende Spalte ist kein Absturz ───────────────────────────────
//
// Zwischen Deploy und Einrichtungslauf gibt es `archiviert_am` noch nicht.
// Ein Endpunkt, der dann mit einem SQL-Fehler abbricht, macht aus einer
// fehlenden Spalte einen unbenutzbaren Bereich -- dieselbe Ueberlegung wie
// bei den Namensteilen aus ENT-615.
check('KRITISCH: der Endpunkt prueft die Spalte, bevor er sie benutzt',
  /hat_spalte\(\$pdo, 'betreiber', 'archiviert_am'\)/.test(archivieren)
  && /503/.test(archivieren));
check('KRITISCH: die Liste kommt ohne die Spalte aus',
  /hat_spalte\(\$pdo, 'betreiber', 'archiviert_am'\)/.test(liste));
// Und der Nachtrag, damit eine bestehende Anlage sie ueberhaupt bekommt.
check('KRITISCH: die Spalte wird fuer bestehende Anlagen nachgetragen',
  /'betreiber',\s*'archiviert_am',\s*"ALTER TABLE betreiber ADD COLUMN archiviert_am/.test(modul));
check('… und steht auch in der Definition einer frischen Anlage',
  /archiviert_am DATETIME NULL/.test(modul));

// ── 5. Ein archiviertes Konto verschwindet nicht spurlos ──────────────
//
// Der Reiter erscheint, SOBALD es archivierte gibt. Ohne diese Zahl
// muesste die Oberflaeche raten, und ein archiviertes Konto, das nirgends
// mehr auftaucht, waere geloescht in allem ausser dem Namen.
check('KRITISCH: der Server meldet, wie viele Konten archiviert sind',
  /'archivierte'\s*=>/.test(liste));
check('KRITISCH: die Oberflaeche zeigt den Archiv-Reiter, sobald es einen Inhalt gibt',
  /zeig\(\$\('kArchivTabs'\), kontenArchivierte > 0\)/.test(seite));
check('KRITISCH: der Zustand "archiviert" ist in der Liste sichtbar',
  /k\.archiviert.*archiviert/.test(seite));

// ── 6. Vier Aussagen, vier Texte ──────────────────────────────────────
//
// Die Hausregel, die hier schon mehrfach verletzt worden ist: "kein
// Treffer", "nichts archiviert", "alles archiviert" und "gar keine Konten"
// sind verschiedene Dinge. Geprueft wird, dass es vier UNTERSCHIEDLICHE
// Texte gibt -- nicht, wie sie lauten.
const leerTexte = (seite.match(/LEER\('([^']+)'/g) || [])
  .map(m => m.replace(/LEER\('/, '').replace(/'$/, ''));
for (const t of ['Keine Treffer', 'Nichts archiviert', 'Alle Konten archiviert', 'Noch keine Konten']) {
  check(`der Leerfall "${t}" hat einen eigenen Text`, leerTexte.includes(t));
}

// ── 7. Der Weg zum eigenen Passwort ───────────────────────────────────
//
// Er existierte schon (ENT-615) und wurde trotzdem vermisst. Geprueft wird
// darum nicht, DASS es ihn gibt, sondern dass er an der Stelle steht, an
// der gesucht wurde: im Kontomenue, das den eigenen Namen traegt.
// Das Menue ueber seine Eckpunkte abgrenzen, nicht ueber das naechste
// schliessende Tag: Der Block enthaelt selbst verschachtelte <div>, und ein
// nicht-gieriges Muster endet schon beim ersten davon.
// Ab dem Menue suchen, nicht ab Dateianfang: "knopf-abmelden" steht auch
// im Stylesheet weiter oben, und von dort aus laege das Ende VOR dem Anfang.
const menueVon  = seite.indexOf('class="konto-menue"');
const menueBis  = seite.indexOf('</div>', seite.indexOf('knopf-abmelden', menueVon));
const menue = menueVon > 0 && menueBis > menueVon ? seite.slice(menueVon, menueBis) : '';
check('das Kontomenue laesst sich ueberhaupt abgrenzen', menue.length > 0);
check('KRITISCH: das Kontomenue fuehrt zum Passwortwechsel',
  /knopf-passwort/.test(menue));
// Zeilenweise geprueft, nicht ueber eine Zeichenkette ohne Semikolon: Der
// Eintrag schliesst zuerst das Menue und oeffnet dann den Dialog, das sind
// zwei Anweisungen. Entscheidend ist, dass BEIDE Wege in denselben Dialog
// fuehren -- zwei Masken fuer dasselbe waeren zwei Stellen zu pflegen.
const zeileMenue = seite.split('\n').find(z =>
  z.includes("$('knopf-passwort')") && z.includes('onclick'));
check('… und der Eintrag oeffnet denselben Dialog wie der Weg ueber den Reiter Zugang',
  !!zeileMenue && /pwOeffnen\(\)/.test(zeileMenue)
  && /onclick="pwOeffnen\(\)"/.test(seite));
// Die Kehrseite, damit die Pruefung oben etwas bedeutet: Abmelden und
// Einrichtung stehen weiter da -- der Eintrag ist dazugekommen, nicht an
// die Stelle eines anderen getreten.
check('… ohne dass Einrichtung oder Abmelden dabei verschwunden sind',
  /knopf-einrichtung/.test(menue) && /knopf-abmelden/.test(menue));

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
