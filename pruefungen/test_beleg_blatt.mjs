// Der Briefkopf des Belegblatts -- innen und aussen gleich (ENT-674,
// Nachtrag 2026-09-22).
//
// WARUM DIESE SUITE
//
// Dasselbe Blatt entsteht an ZWEI Stellen: in ofBlatt() in betreiber.html
// fuer Ansicht und Druck im Betreiber-Bereich, und in
// betreiber_beleg_oeffentlich.php fuer den Empfaenger am Link. Beide
// Dateien tragen den Hinweis, dass eine Aenderung an der einen auch an der
// anderen gehoert -- ein Hinweis, der noch nie jemanden aufgehalten hat.
// Wer dieselbe Offerte einmal von innen und einmal ueber den Link ansieht,
// darf nicht zwei verschiedene Blaetter bekommen.
//
// Geprueft werden die drei Befunde des Projektinhabers an der Ansicht, die
// ein Interessent bekommt: Das Logo war zu gross und stand rechts, die
// Belegnummer stand zweimal auf demselben Blatt, und die Mindesthoehe des
// Blattes riss am Bildschirm eine Luecke auf.
import { WURZEL } from './pfade.mjs';
import { readFileSync } from 'fs';
import { join } from 'path';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const lies = p => readFileSync(join(WURZEL, p), 'utf8');
// Kommentare weg, bevor ueber CODE geurteilt wird -- sonst faende jede
// Suche auch die Stelle, an der eine Datei erklaert, was sie bewusst NICHT
// tut.
const nurCode = q => q.replace(/\/\*[\s\S]*?\*\//g, '')
                      .replace(/<!--[\s\S]*?-->/g, '')
                      .replace(/^\s*\/\/.*$/gm, '');

const seite  = nurCode(lies('betreiber.html'));
const portal = nurCode(lies('backend/api/betreiber_beleg_oeffentlich.php'));

// Nur der Teil, der das Blatt baut -- betreiber.html ist 8000 Zeilen, und
// eine Suche ueber die ganze Datei traefe jedes andere Bild mit.
const von = seite.indexOf('function ofBlatt');
const blatt = von > 0 ? seite.slice(von, von + 6000) : '';
check('der Blattbauer in betreiber.html laesst sich abgrenzen', blatt.length > 1000);

// ── 1. Das Logo: gleiche Groesse, gleiche Seite ───────────────────────
//
// Geprueft an der Zahl, weil hier genau sie der Befund war: 200 px waren
// zu gross. Die Pruefung erlaubt jede Groesse bis 140 px und faellt bei
// der alten Fassung durch -- sie schreibt keinen Wert fest, sondern eine
// Obergrenze.
for (const [name, quelle] of [['Betreiber-Bereich', blatt], ['oeffentliche Ansicht', portal]]) {
  // Ohne "display:block" im Muster: Im PHP steht der Style als
  // zusammengesetzte Zeichenkette und bricht mitten im Attribut um.
  const breite = Number((quelle.match(/max-width:(\d+)px;max-height:\d+px/) || [])[1] || 0);
  check(`KRITISCH: das Logo ist massvoll gross (${name}: ${breite || '?'} px)`,
    breite > 0 && breite <= 140);
  // Links aussen heisst: kein margin-left:auto, das es nach rechts
  // schiebt, und ein Abstand nach UNTEN, weil der Absender darunter steht.
  const logoZeile = (quelle.match(/<img[^>]*alt=""[^>]*>/) || [''])[0];
  check(`KRITISCH: es steht links aussen (${name})`,
    logoZeile.includes('margin-bottom') && !logoZeile.includes('margin-left:auto'));
}
// GEGENPROBE zur Suche selbst: Die alte Schreibweise wuerde die Pruefung
// oben rot machen -- ohne diesen Schritt bliebe auch eine kaputte Suche
// gruen.
check('GEGENPROBE — die alte Fassung faellt durch diese Pruefung',
  !/max-width:(1[5-9]\d|[2-9]\d\d)px;max-height:\d+px/.test(blatt + portal)
  && Number(('max-width:200px;max-height:96px;display:block'
    .match(/max-width:(\d+)px/) || [])[1]) > 140);

// ── 2. Die Nummer steht nicht zweimal auf dem Blatt ───────────────────
//
// Sie gehoert in die Kopftabelle. In der Ueberschrift darunter waere sie
// die zweite Nennung derselben Sache im Abstand von drei Zeilen.
const ueberschriftPortal = (portal.match(/font-size:19px;font-weight:700;margin-bottom:14px">'[^\n]*/) || [''])[0];
check('KRITISCH: die Ueberschrift der oeffentlichen Ansicht traegt keine Nummer',
  ueberschriftPortal.length > 0 && !ueberschriftPortal.includes("\$b['nummer']"));
const ueberschriftBlatt = (blatt.match(/font-size:19px;font-weight:700;margin-bottom:14px">[\s\S]{0,200}?<\/div>/) || [''])[0];
check('KRITISCH: und die im Betreiber-Bereich auch nicht',
  ueberschriftBlatt.length > 0 && !ueberschriftBlatt.includes('b.nummer'));
// Die Kehrseite, damit die Pruefung etwas bedeutet: Die Nummer steht
// weiterhin auf dem Blatt, naemlich in der Kopftabelle.
check('KRITISCH: die Nummer steht weiterhin in der Kopftabelle',
  /nummer_label|Offertennummer/.test(portal) && /BELEG_TITEL_FELD/.test(blatt));

// ── 3. Die Mindesthoehe gilt nur im Druck ─────────────────────────────
//
// Auf Papier fuellt sie das A4-Blatt, damit die Fusszeile unten steht. Am
// Bildschirm machte sie aus einem kurzen Beleg ein Blatt mit einem Loch.
check('KRITISCH: die Mindesthoehe steht in den Druckregeln',
  /@media print\{[^}]*#dokumentSeite\{min-height:\d+px\}/.test(portal.replace(/\s+/g, ''))
  || /@media print[\s\S]{0,400}#dokumentSeite\s*\{\s*min-height/.test(portal));
check('KRITISCH: und nicht mehr fest am Element',
  !/id="dokumentSeite"[^>]*min-height/.test(portal));

// ── 4. Die Anschrift des Empfaengers ──────────────────────────────────
//
// Der Block steht rechts (Schweizer Anordnung, Fensterkuvert), sein Text
// aber linksbuendig: Eine Anschrift im rechten Flattersatz bricht an jeder
// Zeile anders.
const empf = (portal.match(/min-width:200px[^"]*"/) || [''])[0];
check('KRITISCH: der Empfaengerblock steht rechts',
  empf.includes('margin-left:auto'));
check('KRITISCH: seine Zeilen stehen linksbuendig',
  !empf.includes('text-align:right'));

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
