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
check('Die Mindestlaenge des Servers ist ueberhaupt auffindbar', serverMin > 0);

const zahlen = [];
for (const datei of [...OBERFLAECHEN, ...NUR_MASKIERT]) {
  const text = readFileSync(`${WURZEL}/${datei}`, 'utf8');
  // Sowohl die Konstante als auch jeder Text, der dem Nutzer eine Zahl nennt.
  for (const m of text.matchAll(/const PW_MIN\s*=\s*(\d+)/g))              { zahlen.push([datei, 'PW_MIN', +m[1]]); }
  for (const m of text.matchAll(/mind(?:\.|estens)?\s+(\d+)\s+Zeichen/g))  { zahlen.push([datei, 'Text', +m[1]]); }
  for (const m of text.matchAll(/min\.\s+(\d+)\s+Zeichen/g))               { zahlen.push([datei, 'Text', +m[1]]); }
}
const abweichend = zahlen.filter(([, , n]) => n !== serverMin);
check(`KRITISCH: alle Oberflaechen nennen dieselbe Mindestlaenge wie der Server (${serverMin})`,
  abweichend.length === 0);
abweichend.forEach(([d, art, n]) => bad.push(`${d}: ${art} sagt ${n}, der Server verlangt ${serverMin}`));

check(`Geprueft: ${zahlen.length} Angaben zur Mindestlaenge`, zahlen.length >= 6);

console.log(bad.length ? `\n✓ ${ok.length} bestanden\n\n✗ ${bad.length} FEHLGESCHLAGEN:\n  - ${bad.join('\n  - ')}`
                       : `\n✓ ${ok.length} bestanden`);
process.exit(bad.length ? 1 : 0);
