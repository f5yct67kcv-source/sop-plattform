// Der Rückkanal am Beleg (ENT-677).
//
// WARUM DIESE SUITE
//
// Der Faden hat eine Eigenheit, die ihn von allem anderen auf dieser Ebene
// unterscheidet: Er nimmt Text von jemandem entgegen, der NICHT angemeldet
// ist. Ausweis ist allein der Versand-Token. Damit hängen vier Zusagen
// daran, und jede davon verschwindet lautlos beim nächsten Umbau:
//
//   1. NUR POST UND MIT BREMSE. Ein Weg, der ohne Anmeldung schreibt und
//      Mails auslöst, darf weder von einer Mailvorschau ausgelöst werden
//      noch als Dauerlast taugen.
//   2. GESCHRIEBEN IST GESCHRIEBEN. Der Mailversand darf die Eingabe nie
//      scheitern lassen -- sonst hält der Kunde etwas für abgeschickt, das
//      es nicht gibt.
//   3. NICHT MEHR NACH DER ENTSCHEIDUNG. Die Wache dafür steht im Server,
//      nicht in der Oberfläche.
//   4. DER SECHSTE ZUSTAND GEHÖRT NUR DER BETREIBERSEITE. Die Tabelle
//      `belege` der Mandantin kennt ihn nicht; landete er im gemeinsamen
//      BELEG_STATUS, liefe die Mandantenseite in einen SQL-Fehler.
//
// Was sich ausführen lässt, läuft in pruef_beleg_faden.php wirklich.
import { WURZEL, HIER } from './pfade.mjs';
import { readFileSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const lies = p => readFileSync(join(WURZEL, p), 'utf8');
const nurCode = q => q.replace(/\/\*[\s\S]*?\*\//g, '')
                      .replace(/<!--[\s\S]*?-->/g, '')
                      .replace(/^\s*\/\/.*$/gm, '')
                      .replace(/^\s*--.*$/gm, '');

const API = 'backend/api/';
const oeff   = nurCode(lies(API + 'betreiber_beleg_nachricht_oeffentlich.php'));
const innen  = nurCode(lies(API + 'betreiber_beleg_nachricht.php'));
const ansicht= nurCode(lies(API + 'betreiber_beleg_oeffentlich.php'));
const lesen  = nurCode(lies(API + 'betreiber_beleg_lesen.php'));
const modul  = nurCode(lies('backend/betreiber.php'));
const kern   = nurCode(lies('backend/belege.php'));
const seite  = lies('betreiber.html');

// ── 1. Die reinen Funktionen wirklich ausfuehren ──────────────────────
let phpAus = '', phpCode = 0;
try {
  phpAus = execFileSync('php', [`${HIER}/pruef_beleg_faden.php`], { encoding: 'utf8' });
} catch (e) {
  phpAus = String(e.stdout || '') + String(e.stderr || '');
  phpCode = e.status || 1;
}
const phpAnzahl = Number((phpAus.match(/^(\d+) bestanden/m) || [0, 0])[1]);
check(`KRITISCH: pruef_beleg_faden.php laeuft durch (${phpAnzahl} Pruefungen)`,
  phpCode === 0 && phpAnzahl > 0);
if (phpCode !== 0) { console.log(phpAus); }

// ── 2. Der unangemeldete Weg ──────────────────────────────────────────
check('KRITISCH: der oeffentliche Weg nimmt nur POST',
  /REQUEST_METHOD[^;]*POST/.test(oeff));
check('KRITISCH: er hat eine eigene Bremse',
  /anmeld_zaehlen\(\s*db\(\),\s*'be-nachricht:'/.test(oeff)
  && /anmeld_sperre\(/.test(oeff));
check('… und zaehlt nur den erfundenen Token als Fehlversuch, nicht jede Nachricht',
  (oeff.match(/anmeld_fehlversuch\(/g) || []).length === 1
  && oeff.indexOf('anmeld_fehlversuch(') < oeff.indexOf('be_beleg_nachricht_anlegen('));
check('KRITISCH: er spricht den Beleg ueber den Versand-Token an',
  /WHERE versand_token = \?/.test(oeff));
check('KRITISCH: und legt keine Sitzung an',
  !/betreiber_sessions/.test(oeff) && !/require_betreiber/.test(oeff));

// ── 3. Nicht mehr nach der Entscheidung ───────────────────────────────
//
// Geprueft an der Reihenfolge, nicht am Wortlaut: Die Wache muss VOR dem
// Schreiben stehen. Eine Pruefung auf die blosse Anwesenheit beider Woerter
// bliebe gruen, wenn jemand die Wache hinter das INSERT schoebe.
const posSchreiben = oeff.indexOf('be_beleg_nachricht_anlegen(');
const davor = posSchreiben > 0 ? oeff.slice(0, posSchreiben) : '';
const wache = davor.split('\n').find(z =>
  /^\s*if\s*\(/.test(z) && z.includes('entscheidung_am') && z.includes('abgelaufen'));
check('KRITISCH: nach Entscheidung oder Ablauf wird nichts mehr geschrieben',
  !!wache && posSchreiben > 0);
check('… und die Oberflaeche bietet das Feld dann auch nicht an',
  /\$schreibenOffen = [^;]*!\$entschieden[^;]*!\$abgelaufen/.test(ansicht));

// ── 4. Geschrieben ist geschrieben ────────────────────────────────────
//
// Die Nachricht steht VOR dem Mailversand, und der Versand liegt in einem
// try/catch. Beides zusammen ist die Zusage; einzeln ist keines davon eine.
const posMail = oeff.indexOf('smtp_senden(');
check('KRITISCH: die Nachricht wird abgelegt, BEVOR eine Mail versucht wird',
  posSchreiben > 0 && posMail > posSchreiben);
check('KRITISCH: ein gescheiterter Versand laesst die Eingabe nicht scheitern',
  /try \{[\s\S]*smtp_senden\([\s\S]*?\} catch \(Throwable/.test(oeff));
check('KRITISCH: auch der Statuswechsel darf die Nachricht nicht mitreissen',
  /try \{[\s\S]{0,200}UPDATE be_belege SET status = 'aenderung'[\s\S]{0,200}?\} catch \(Throwable/.test(oeff));
check('KRITISCH: der Zustand wechselt nur aus den beiden Lagen, in denen der Ball beim Empfaenger lag',
  /in_array\(\(string\)\$b\['status'\], \['versendet', 'angeschaut'\], true\)/.test(oeff));

// ── 5. Die Gegenseite im Betreiber-Bereich ────────────────────────────
check('KRITISCH: die Antwort verlangt den zweiten Faktor',
  /require_betreiber_voll\s*\(/.test(innen));
check('KRITISCH: und nimmt nur POST', /REQUEST_METHOD[^;]*POST/.test(innen));
check('KRITISCH: sie schreibt ins Logbuch', /be_log\(/.test(innen));
// Was mit der Mail geschah, wird GENANNT -- "abgelegt, aber nicht
// verschickt" ist etwas anderes als "verschickt" (Hausregel).
for (const lage of ['kein_versand', 'nie_versendet', 'keine_adresse', 'fehlgeschlagen']) {
  check(`die Lage "${lage}" ist eine eigene Aussage`, innen.includes(lage));
}
check('… und die Oberflaeche hat fuer jede davon einen eigenen Text',
  ['kein_versand', 'nie_versendet', 'keine_adresse', 'fehlgeschlagen']
    .every(l => new RegExp(l + ':').test(seite)));

// ── 6. Das Datenmodell ────────────────────────────────────────────────
check('KRITISCH: die Tabelle wird fuer eine frische Anlage angelegt',
  /'be_beleg_nachricht' => "CREATE TABLE IF NOT EXISTS be_beleg_nachricht/.test(modul));
check('KRITISCH: der sechste Zustand wird fuer bestehende Anlagen nachgetragen',
  /\['be_belege', 'status', 'aenderung',/.test(modul));
// Die beiden Aufzaehlungen muessen uebereinstimmen -- sonst legt eine frische
// Anlage etwas anderes an als der Nachtrag.
const aufzaehlungen = [...modul.matchAll(/ENUM\('entwurf','versendet','angeschaut','aenderung','bestaetigt','abgelehnt'\)/g)];
check('KRITISCH: Tabellendefinition und Nachtrag nennen dieselben Zustaende',
  aufzaehlungen.length === 2);
// Und die Mandantenseite bleibt unberuehrt: Ihre Tabelle kennt den Wert
// nicht, ein gemeinsamer Status waere dort ein SQL-Fehler.
check('KRITISCH: der gemeinsame BELEG_STATUS bleibt ohne den neuen Zustand',
  /const BELEG_STATUS = \['entwurf', 'versendet', 'angeschaut', 'bestaetigt', 'abgelehnt'\]/.test(kern));

// ── 7. Der Beleg bringt seinen Faden mit ──────────────────────────────
check('KRITISCH: wer den Beleg liest, bekommt den Faden dazu',
  /'nachrichten' => be_beleg_nachrichten\(/.test(lesen));
check('KRITISCH: und die Auskunft, ob der Rueckkanal ueberhaupt eingerichtet ist',
  /'faden_da' => be_beleg_nachricht_tabelle_da\(/.test(lesen));

// ── 8. Die Oberflaeche ────────────────────────────────────────────────
check('KRITISCH: der dritte Weg heisst "Änderungen anbringen"',
  /Änderungen anbringen<\/button>/.test(ansicht));
check('… und er ist zurueckhaltend gesetzt, nicht wie Annehmen',
  /id="fadenAuf"[^>]*knopf-still/.test(ansicht));
// Ohne JavaScript bleibt das Formular OFFEN: sichtbar ist besser als
// unerreichbar. Zugeklappt wird es erst vom Skript.
check('KRITISCH: ohne JavaScript bleibt das Feld erreichbar',
  /f\.style\.display\s*=\s*"none"/.test(ansicht)
  && !/id="fadenForm"[^>]*style="[^"]*display:none/.test(ansicht));
check('KRITISCH: der Verlauf erscheint auch im Betreiber-Bereich',
  /id="ofFadenListe"/.test(seite) && /ofFadenZeichnen\(/.test(seite));
check('KRITISCH: der sechste Zustand ist in beiden Listen benannt',
  /wert: 'aenderung',\s*text: 'Änderungswunsch'/.test(seite)
  && /aenderung:\s*\['m-warn', 'Änderungswunsch'\]/.test(seite));
// Beide Seiten nennen einen namenlosen Absender GLEICH. Zwei Wortlaute
// waeren zwei Aussagen ueber dieselbe Sache.
const wortlaut = 'Über den Link zur Offerte';
check('KRITISCH: Server und Oberflaeche nennen den namenlosen Absender gleich',
  modul.includes(wortlaut) && seite.includes(wortlaut));
// Und "noch nichts geschrieben" ist etwas anderes als "nicht eingerichtet".
check('KRITISCH: leer und nicht eingerichtet sind zwei verschiedene Texte',
  /Noch keine Rückmeldung/.test(seite) && /noch nicht nachgetragen/.test(seite));

// ── 9. Die Meldung erreicht auch das Sammelpostfach ───────────────────
const liste = nurCode(lies(API + 'betreiber_beleg_list.php'));
check('KRITISCH: der oeffentliche Weg meldet an Konten UND Sammelpostfach',
  /be_melde_empfaenger\(\$pdo\)/.test(oeff)
  && !/FROM betreiber WHERE aktiv = 1/.test(oeff));
check('KRITISCH: die Adresse kommt aus dem Briefkopf, nicht aus dem Deploy',
  /be_briefkopf/.test(modul.slice(modul.indexOf('function be_melde_empfaenger')))
  && !/__[A-Z_]+__/.test(modul.slice(modul.indexOf('function be_melde_empfaenger'),
                                     modul.indexOf('function be_melde_empfaenger') + 2000)));

// ── 10. Ein Wunsch ist von der Uebersicht aus sichtbar ────────────────
//
// Er wartet auf eine Antwort -- genau wie eine Supportanfrage, und die hat
// ihr Abzeichen seit ENT-538. Bis hierher sah man ihn nur, wenn die
// Offertenliste ohnehin offen war.
check('KRITISCH: der Server zaehlt die offenen Wuensche, je Art und ueber alle',
  /'aenderung'\s*=>/.test(liste) && /'aenderung_gesamt'\s*=>/.test(liste));
check('KRITISCH: gezaehlt wird in der Datenbank, nicht in der gelieferten Liste',
  /SELECT SUM\(art = \?\)[\s\S]{0,200}WHERE status = 'aenderung'/.test(liste));
// Eine fehlende Zahl darf die Liste nicht ausfallen lassen -- vor dem
// Einrichtungslauf kennt die Spalte den Wert nicht.
check('KRITISCH: eine fehlende Zahl laesst die Belegliste nicht ausfallen',
  /try \{[\s\S]{0,400}status = 'aenderung'[\s\S]{0,400}?\} catch \(Throwable/.test(liste));
check('KRITISCH: beide Reiter tragen ein Abzeichen',
  /id="nav-of-abz"/.test(seite) && /id="nav-re-abz"/.test(seite));
check('… und es ist angesagt, nicht nur eingefaerbt',
  /setAttribute\('aria-label'[\s\S]{0,200}Änderungswunsch wartet/.test(seite));
check('KRITISCH: die Uebersicht zeigt den Stand auf der Startseite',
  /id="u-aw-zahlen"/.test(seite) && /awUebersichtSetzen\(/.test(seite));
check('KRITISCH: die Gesamtzahl kommt vom Server, statt aus zwei Reitern summiert zu werden',
  /awGesamt = Number\(antwort\.aenderung_gesamt/.test(seite));
// "Nichts offen" und "eine Zahl ohne Bezug" sind zwei verschiedene
// Aussagen -- die Karte sagt, worueber sie zaehlt.
check('KRITISCH: die Zahl auf der Uebersicht nennt ihren Bezug',
  /zahlBlock\('Offen', awGesamt, awGesamt \? 'über alle Belegarten'/.test(seite));

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
