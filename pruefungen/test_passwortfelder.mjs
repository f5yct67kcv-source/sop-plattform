// Passwortfelder: maskiert, mit Auge, und ueberall dieselbe Mindestlaenge.
//
// Warum als Datei-Pruefung und nicht nur im Browser: Die Browser-Suiten
// rendern die Masken, die sie oeffnen. Das Anmeldefenster, das Feld zum
// Abschalten der Zwei-Faktor-Anmeldung und die vier Felder in index.html
// oeffnet keine von ihnen -- ein Klartextfeld waere dort nie aufgefallen.
// Genau so lag der Fall: #maPw, #maPw2 und #mbNeuPass standen bis ENT-291
// auf type="text", also im Klartext, und niemand hat es bemerkt.
//
// Die WIRKUNG des Auges -- schaltet um, Wert bleibt erhalten, Trefferflaeche
// gross genug -- wird am gerenderten Zustand in test_admin.mjs gemessen.
// Hier steht nur, was ueberhaupt vorhanden sein muss.
import { readFileSync } from 'fs';
import { WURZEL } from './pfade.mjs';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

// Oberflaechen, die ausgeliefert werden. Hier gilt beides: maskiert UND Auge.
const OBERFLAECHEN = ['dashboard.html', 'app.html', 'index.html'];

// backend/setup.html wird bewusst NICHT ausgeliefert (Ersteinrichtung, von
// Hand hochgeladen, danach geloescht). Ein Auge waere dort Zierrat -- aber
// maskiert gehoert das Feld trotzdem, sonst steht das erste Passwort der
// Anlage offen auf dem Bildschirm.
const NUR_MASKIERT = ['backend/setup.html'];

// Nur der Zahlenabgleich, nicht die Auge-Pflicht (ENT-502).
//
// portal.html hat kein Auge -- das ist als OP-489 offen und eine eigene
// Entscheidung, keine, die hier nebenbei erzwungen werden soll. Die
// Mindestlaenge muss dort aber trotzdem stimmen: Das Portal ruft
// passwort_pruefen() ueber portal_neues_passwort.php und
// portal_passwort_aendern.php auf, unterliegt also derselben Regel.
//
// Genau hier lag eine Luecke: portal.html stand in KEINER dieser Listen
// und versprach bis ENT-502 "mindestens 6 Zeichen", waehrend der Server
// laengst mehr verlangte. Dieselbe Sorte Fehler wie bei index.html nach
// ENT-289 -- nur diesmal in der Datei, die Betriebsfremde zu sehen
// bekommen.
const NUR_LAENGE = ['portal.html'];

// Ein Eingabefeld gilt als Passwortfeld, wenn seine id danach aussieht.
// Absichtlich ueber die id und nicht ueber type="password": Wer type
// abschreibt, findet nur die Felder, die schon richtig sind.
const IST_PASSWORTFELD = /\bid="([^"]*(?:[Pp][Ww]|[Pp]ass|PASS)[^"]*)"/;

function felder(text) {
  // Ein <input>-Tag darf ueber mehrere Zeilen gehen -- in dashboard.html tun
  // das die meisten. Darum bis zum naechsten ">" statt zeilenweise.
  return [...text.matchAll(/<input\b[^>]*>/gs)]
    .map(m => m[0])
    .filter(tag => IST_PASSWORTFELD.test(tag))
    .map(tag => ({ tag, id: tag.match(IST_PASSWORTFELD)[1] }));
}

let gezaehlt = 0;
for (const datei of [...OBERFLAECHEN, ...NUR_MASKIERT]) {
  const text = readFileSync(`${WURZEL}/${datei}`, 'utf8');
  const gefunden = felder(text);
  gezaehlt += gefunden.length;

  const offen = gefunden.filter(f => !/type="password"/.test(f.tag)).map(f => f.id);
  check(`KRITISCH: ${datei} zeigt kein Passwort im Klartext`, offen.length === 0);
  offen.forEach(id => bad.push(`${datei}: ${id} steht auf Klartext`));

  if (NUR_MASKIERT.includes(datei)) { continue; }
  const ohneAuge = gefunden.filter(f => !text.includes(`togglePw('${f.id}'`)).map(f => f.id);
  check(`${datei}: jedes Passwortfeld hat ein Auge zum Aufdecken`, ohneAuge.length === 0);
  ohneAuge.forEach(id => bad.push(`${datei}: ${id} hat kein Auge`));
}

// Ohne diesen Waechter waere alles oben gruen, sobald die Erkennung nicht
// mehr greift -- eine leere Menge erfuellt jede Bedingung.
check(`Geprueft: ${gezaehlt} Passwortfelder in ${OBERFLAECHEN.length + NUR_MASKIERT.length} Dateien`,
  gezaehlt >= 10);

// ── Mindestlaenge: eine Zahl, vier Orte ────────────────────────────────
// Der Server entscheidet. Sagt eine Maske etwas anderes, verspricht sie
// entweder eine Strenge, die es nicht gibt, oder sie sperrt ein Passwort,
// das der Server annehmen wuerde. Beides ist schon passiert: index.html
// verlangte nach ENT-289 noch 12, waehrend der Server 6 nahm.
const php = readFileSync(`${WURZEL}/backend/anmeldung.php`, 'utf8');
const serverMin = Number((php.match(/const PASSWORT_MIN\s*=\s*(\d+)/) || [])[1]);
const serverMinAdmin = Number((php.match(/const PASSWORT_MIN_ADMIN\s*=\s*(\d+)/) || [])[1]);
check('Die Mindestlaenge des Servers ist ueberhaupt auffindbar', serverMin > 0);
check('Die laengere Mindestlaenge fuer Verwaltungszugaenge ist auffindbar', serverMinAdmin > 0);

// setup.html legt das ERSTE Konto der Anlage an, und das ist per Definition
// ein Verwaltungszugang (setup.php setzt ist_admin = 1). Dort gilt darum
// die laengere Zahl (ENT-502). Bis dahin verglich diese Pruefung stur gegen
// PASSWORT_MIN und haette eine korrekte 16 dort als Abweichung gemeldet --
// eine Pruefung, die den richtigen Zustand beanstandet, wird irgendwann
// weggeklickt.
const ERWARTET = datei => datei === 'backend/setup.html' ? serverMinAdmin : serverMin;

// Jede gefundene Zahl bringt ihren eigenen Sollwert mit, statt dass unten
// pauschal ERWARTET(datei) gilt. Grund: dashboard.html nennt ZWEI Zahlen in
// einer Zeile -- "const PW_MIN = 10, PW_MIN_ADMIN = 12;". Bis ENT-519 sah
// diese Pruefung nur die erste davon; PW_MIN_ADMIN wurde von NICHTS gegen
// den Server verglichen. Das Cockpit haette also weiter 16 versprechen
// koennen, waehrend der Server 12 nimmt -- genau der Fehler, gegen den es
// diese Datei ueberhaupt gibt, nur eine Zeile weiter rechts.
const zahlen = [];
for (const datei of [...OBERFLAECHEN, ...NUR_MASKIERT, ...NUR_LAENGE]) {
  const text = readFileSync(`${WURZEL}/${datei}`, 'utf8');
  // Die laengere Zahl zuerst: "const PW_MIN" trifft PW_MIN_ADMIN nicht (dort
  // folgt ein "_" statt "="), aber die Reihenfolge macht die Absicht lesbar.
  for (const m of text.matchAll(/PW_MIN_ADMIN\s*=\s*(\d+)/g))              { zahlen.push([datei, 'PW_MIN_ADMIN', +m[1], serverMinAdmin]); }
  for (const m of text.matchAll(/const PW_MIN\s*=\s*(\d+)/g))              { zahlen.push([datei, 'PW_MIN', +m[1], ERWARTET(datei)]); }
  // Und jeder Text, der dem Nutzer eine Zahl nennt.
  for (const m of text.matchAll(/mind(?:\.|estens)?\s+(\d+)\s+Zeichen/g))  { zahlen.push([datei, 'Text', +m[1], ERWARTET(datei)]); }
  for (const m of text.matchAll(/min\.\s+(\d+)\s+Zeichen/g))               { zahlen.push([datei, 'Text', +m[1], ERWARTET(datei)]); }
}
const abweichend = zahlen.filter(([, , n, soll]) => n !== soll);
check(`KRITISCH: alle Oberflaechen nennen dieselbe Mindestlaenge wie der Server (${serverMin}, Verwaltung ${serverMinAdmin})`,
  abweichend.length === 0);
abweichend.forEach(([d, art, n, soll]) => bad.push(`${d}: ${art} sagt ${n}, der Server verlangt ${soll}`));

// Waechter fuer die Verwaltungszahl selbst: Ohne ihn waere oben alles gruen,
// sobald PW_MIN_ADMIN aus dem Cockpit verschwindet -- eine leere Menge
// erfuellt jede Bedingung, und die Maske faellt still auf die kuerzere Zahl
// zurueck.
check('Das Cockpit kennt die laengere Zahl fuer Verwaltungszugaenge ueberhaupt',
  zahlen.some(([d, art]) => d === 'dashboard.html' && art === 'PW_MIN_ADMIN'));

// Und die Stelle, die das erste Konto anlegt, muss die Regel ueberhaupt
// AUFRUFEN. setup.php hatte bis ENT-502 ein eigenes "strlen < 6" -- der
// erste Verwaltungszugang der Anlage entstand damit an der Passwortregel
// vorbei, und der Text im Formular war das einzige, was davon zu sehen war.
const setupPhp = readFileSync(`${WURZEL}/backend/setup.php`, 'utf8');
check('KRITISCH: setup.php prueft das erste Passwort mit der gemeinsamen Regel',
  /passwort_pruefen\s*\([^)]*true\s*\)/.test(setupPhp) && !/strlen\(\$password\)\s*</.test(setupPhp));

// Die Schwelle war 6, solange index.html den Verwaltungsbereich trug: Dort
// standen drei der Angaben (Passwort beim Anlegen, PIN, Zuruecksetzen). Mit
// ENT-303 ist der Bereich entfallen, damit auch die drei Angaben. Die Zahl
// sagt weiterhin "es wurde ueberhaupt etwas gemessen" -- sie ist keine
// Vorgabe, wie viele Passwortfelder es geben muss.
check(`Geprueft: ${zahlen.length} Angaben zur Mindestlaenge`, zahlen.length >= 4);

console.log(bad.length ? `\n✓ ${ok.length} bestanden\n\n✗ ${bad.length} FEHLGESCHLAGEN:\n  - ${bad.join('\n  - ')}`
                       : `\n✓ ${ok.length} bestanden`);
process.exit(bad.length ? 1 : 0);
