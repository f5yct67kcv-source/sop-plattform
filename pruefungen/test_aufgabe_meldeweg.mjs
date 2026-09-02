// Nicht erledigte Aufgaben fallen auf (ENT-311).
//
// Vom Projektinhaber auf die Frage aus OP-290, ob eine nicht erledigte
// Aufgabe irgendwo auffallen soll: "ja unbedingt".
//
// Zwei Faelle, die verschieden behandelt gehoeren -- das ist der Kern dieser
// Suite:
//  1. "Nicht moeglich" mit Grund: Der Waechter hat GEANTWORTET und etwas
//     gemeldet. Jemand muss es lesen -> Ereignis im Meldeweg.
//  2. Unbeantwortet: Es wurde NICHTS gemeldet. Kein Befund, sondern eine
//     Luecke -> sichtbar in der Auswertung, aber NICHT im Meldeweg. Beides
//     in denselben Topf zu werfen fuellte den Feed mit Nicht-Ereignissen,
//     und man gewoehnte sich daran, "erledigt" zu klicken, ohne dass jemand
//     etwas getan hat.
//
// Ausserdem geprueft: der stille Datenverlust aus ENT-305, gefunden beim
// Bauen dieser Aenderung.
import { WURZEL } from './pfade.mjs';
import { readFileSync } from 'fs';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const SCAN = readFileSync(`${WURZEL}/backend/api/mein_rundgang_scan.php`, 'utf8');
const LISTE = readFileSync(`${WURZEL}/backend/api/rundgang_scan_liste.php`, 'utf8');
const EINR = readFileSync(`${WURZEL}/backend/api/planung_einrichten.php`, 'utf8');
const RG = readFileSync(`${WURZEL}/backend/rundgang.php`, 'utf8');
const DASH = readFileSync(`${WURZEL}/dashboard.html`, 'utf8');

// ══════════ 1. "NICHT MÖGLICH" WIRD ZUM EREIGNIS ══════════════════════
check('KRITISCH: eine nicht ausführbare Aufgabe erzeugt eine Ereignis-Meldung',
  /INSERT INTO ereignis_meldung/.test(SCAN));
check('KRITISCH: nur bei "nicht möglich" — eine erledigte Aufgabe ist kein Ereignis',
  /\$aStatus === 'nicht_moeglich'\s*&&/.test(SCAN));
// Die Warteschlange sendet erneut, wenn das Netz zurueckkommt (ENT-132).
// Ohne diese Bedingung saehe die Verwaltung dieselbe klemmende Tuer fuenfmal.
check('KRITISCH: ein erneut gesendeter Eintrag erzeugt KEIN zweites Ereignis',
  /\$ein->rowCount\(\) === 1/.test(SCAN));
check('Das Ereignis hängt an Runde, Objekt und Person, nicht nur am Text',
  /rundgang_id, einsatz_id, mitarbeiter_id/.test(SCAN));
check('KRITISCH: der Grund steht im Ereignis — ohne das Warum ist es wertlos',
  /Grund: ' \. \$grund/.test(SCAN));
check('Der Kontrollpunkt wird genannt, damit klar ist, WO es klemmt',
  /Kontrollpunkt: ' \. \$katZeile\['punkt'\]/.test(SCAN));

// Der Nachweis darf davon nicht abhaengen: Der Waechter hat seine Arbeit
// getan, auch wenn der Meldeweg klemmt.
check('KRITISCH: scheitert die Ereignismeldung, bleibt die Antwort trotzdem gespeichert',
  SCAN.indexOf('INSERT IGNORE INTO rundgang_aufgabe') < SCAN.indexOf('INSERT INTO ereignis_meldung')
  // Fenster bewusst grosszuegig: Geprueft wird, DASS der Fehlerfall im
  // catch landet, nicht wie viele Kommentarzeilen dazwischenstehen. Eine zu
  // enge Fassung wurde hier bereits rot, ohne dass am Code etwas falsch war.
  && /catch \(Throwable \$e\) \{[\s\S]{0,800}ereignis_fehler/.test(SCAN));
check('Ein dauerhaft kaputter Meldeweg fällt auf, statt still zu bleiben',
  /'status' => 'ereignis_fehler'/.test(SCAN));

// ══════════ DIE EREIGNISART ═══════════════════════════════════════════
check('KRITISCH: die Ereignisart steht als Konstante da, nicht zweimal als Zeichenkette',
  /const EREIGNISART_AUFGABE = /.test(RG)
  && /EREIGNISART_AUFGABE/.test(SCAN) && /EREIGNISART_AUFGABE/.test(EINR));
// Der Startbestand entsteht nur, solange die Tabelle LEER ist. Bei jedem
// Betrieb, der schon Ereignisse erfasst hat, liefe die Zeile sonst nie.
check('KRITISCH: die neue Art entsteht auch in einem Betrieb, der schon Ereignisse hat',
  /INSERT IGNORE INTO ereignisart/.test(EINR)
  && EINR.indexOf('INSERT IGNORE INTO ereignisart')
     > EINR.indexOf("Ereignisarten: Startbestand angelegt"));
// Eine Runde darf nicht an einem fehlenden Katalogeintrag scheitern.
check('KRITISCH: fehlt die Art noch, entsteht das Ereignis trotzdem (ohne Art)',
  /\$artId = null;/.test(SCAN));

// ══════════ 2. DER STILLE DATENVERLUST AUS ENT-305 ════════════════════
// Die Runde schliesst sich selbst, sobald kein Punkt mehr uebrig ist -- im
// SELBEN Aufruf, der den letzten Scan bringt. Die Aufgaben dieses Punktes
// poppen erst danach auf; die Antwort traf auf eine beendete Runde, wurde
// mit 409 abgewiesen und blieb laut App-Code "in der Warteschlange" --
// also fuer immer. Betroffen war der letzte Kontrollpunkt JEDER Runde.
check('KRITISCH: die Zustandssperre gilt nur für neue SCANS, nicht für Aufgaben-Antworten',
  /if \(\$scans\) \{[\s\S]{0,600}bereits beendet/.test(SCAN));
check('KRITISCH: ein neuer Scan auf einer beendeten Runde bleibt verboten',
  /'Dieser Rundgang ist bereits beendet'/.test(SCAN));
check('Auch der Pausen-Riegel gilt weiterhin für Scans',
  /'Dieser Rundgang ist pausiert -- erst fortsetzen'/.test(SCAN));
// Die Selbstschliessung darf nicht durch eine reine Aufgaben-Anfrage
// ausgeloest werden.
check('Eine Anfrage NUR mit Aufgaben schliesst keine Runde ab',
  SCAN.indexOf("status = 'abgeschlossen'") > SCAN.indexOf('foreach ($scans as $eintrag)'));

// ══════════ 3. UNBEANTWORTET IN DER AUSWERTUNG ════════════════════════
// Eine unbeantwortete Aufgabe hat KEINE Zeile -- sie ist genau das Fehlen
// eines Eintrags. Findbar nur durch Abgleich gegen den Katalog.
check('KRITISCH: unbeantwortete Aufgaben werden über den Katalog gefunden',
  /LEFT JOIN rundgang_aufgabe ra/.test(LISTE) && /ra\.id IS NULL/.test(LISTE));
check('KRITISCH: nur aktive Aufgaben zählen — abgeschaffte Arbeit ist kein Mangel',
  /objekt_aufgabe a ON a\.id = ka\.aufgabe_id AND a\.aktiv = 1/.test(LISTE));
// Bei einer LAUFENDEN Runde ist eine offene Aufgabe kein Mangel, sondern
// Arbeit, die noch aussteht -- dieselbe Verwechslung wie "unbekannt" mit
// "keine".
check('KRITISCH: nur BEENDETE Runden — eine laufende hat legitim offene Aufgaben',
  /r\.status IN \('abgeschlossen', 'abgebrochen'\)/.test(LISTE));
check('Der Endpunkt liefert sie unter eigenem Namen aus',
  /'offene_aufgaben' => \$offene/.test(LISTE));
check('Fehlen die Tabellen noch, fällt die Auswertung nicht aus',
  /hat_tabelle\(db\(\), 'kontrollpunkt_aufgabe'\)/.test(LISTE)
  && /catch \(Throwable \$e\) \{[\s\S]{0,200}\$offene = \[\];/.test(LISTE));

// ══════════ ANZEIGE ═══════════════════════════════════════════════════
check('KRITISCH: "Unbeantwortet" trägt eine EIGENE Kennzeichnung, nicht die von "nicht möglich"',
  /unbeantwortet: \['chip-x', 'Unbeantwortet'\]/.test(DASH)
  && /nicht_moeglich: \['chip-n', 'Nicht möglich'\]/.test(DASH));
// Eine CSS-Klasse, die es nicht gibt, bleibt wirkungslos, ohne dass etwas
// kaputtgeht -- genau davor warnt CLAUDE.md. Beim Bauen ist mir das
// passiert: "chip-r" existierte nicht.
check('KRITISCH: die verwendete Kennzeichnung ist im Stylesheet auch definiert',
  /\.chip-x\s*\{/.test(DASH));
check('Die offenen Aufgaben werden auch wirklich an die Anzeige gereicht',
  /data\.offene_aufgaben \|\| \[\]/.test(DASH));
check('Sie stehen zwischen den beantworteten, nicht in einer zweiten Liste',
  /const aufg = \(aufgaben \|\| \[\]\)\.concat/.test(DASH));
// Beide wandern durch dasselbe "zugeordnet"-Set; eine ID-Kollision liesse
// eine echte Antwort verschwinden.
check('KRITISCH: ihre Kennung kann nicht mit der einer echten Antwort kollidieren',
  /id: 'o' \+ o\.rundgang_id/.test(DASH));

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
