// Entfernt beim Deploy die Kommentare aus den ausgelieferten HTML-Seiten.
//
//     node werkzeuge/verdichten/verdichten.mjs <Buendel-Ordner> [...]
//
// WARUM: Rund ein Drittel von dashboard.html sind Kommentare -- gewollt,
// sie erklaeren das Warum. Der Browser braucht sie nicht, laedt sie aber bei
// jedem ersten Aufruf nach einem Deploy mit, und deployt wird fast taeglich.
// Komprimiert schrumpft das Cockpit damit von rund 600 auf rund 320 KB.
// Die Quelle im Repository bleibt unveraendert und lesbar.
//
// WAS GENAU, UND WAS NICHT:
//   - HTML-Kommentare, JavaScript-Kommentare, CSS-Kommentare: weg.
//   - Sonst NICHTS. Kein Umbenennen, kein Umschreiben von Code, kein
//     Zusammenziehen von Leerraum im HTML (der kann sichtbar sein, etwa
//     zwischen Inline-Elementen). JavaScript wird geparst und ohne
//     Kommentare wieder ausgegeben -- darum bleibt "https://" in einer
//     Zeichenkette eine Zeichenkette und wird nicht als Kommentar gelesen,
//     was jedes Suchen-und-Ersetzen falsch machen wuerde.
//
// WANN: Als LETZTER Schritt vor dem Hochladen eines Buendels. Der Deploy
// ersetzt vorher mit sed genaue Zeichenfolgen in diesen Dateien (Marke,
// Icons, Platzhalter); die duerfen von hier nichts merken.
//
// WENN ETWAS SCHIEFGEHT: Laesst sich eine Datei nicht verarbeiten, bleibt
// sie UNVERAENDERT und es kommt eine Warnung im Deploy-Protokoll. Ein
// Abbruch hielte jedes andere Update mit an -- eine unverdichtete Seite ist
// nur groesser, eine fehlende waere kaputt.
import { minify } from 'html-minifier-terser';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

// CSS-Kommentare selbst entfernen statt ueber clean-css: clean-css schreibt
// auch Werte um, und hier soll ausser Kommentaren nichts passieren.
// Zeichenketten werden uebersprungen, damit ein "/*" darin nicht als
// Kommentar gilt.
export function cssOhneKommentare(css) {
  let aus = '', i = 0;
  while (i < css.length) {
    const c = css[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== c) { j += css[j] === '\\' ? 2 : 1; }
      aus += css.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === '/' && css[i + 1] === '*') {
      const ende = css.indexOf('*/', i + 2);
      i = ende < 0 ? css.length : ende + 2; continue;
    }
    aus += c; i++;
  }
  return aus;
}

export const OPTIONEN = {
  removeComments: true,
  // Alles andere bleibt aus (die Vorgabe von html-minifier-terser ist
  // "nichts tun"); ausdruecklich genannt, damit niemand es nachruestet,
  // ohne diese Datei zu lesen.
  collapseWhitespace: false,
  minifyJS: { compress: false, mangle: false, format: { comments: false } },
  minifyCSS: cssOhneKommentare,
};

export async function verdichten(html) {
  return minify(html, OPTIONEN);
}

function htmlDateien(ordner) {
  const aus = [];
  for (const name of readdirSync(ordner)) {
    const pfad = join(ordner, name);
    const st = statSync(pfad);
    if (st.isDirectory()) { aus.push(...htmlDateien(pfad)); }
    else if (name.endsWith('.html')) { aus.push(pfad); }
  }
  return aus;
}

async function main(ordnerListe) {
  if (!ordnerListe.length) {
    console.error('Aufruf: node verdichten.mjs <Buendel-Ordner> [...]');
    process.exit(2);
  }
  let vorher = 0, nachher = 0;
  for (const ordner of ordnerListe) {
    // Ein Buendel, dessen Bau uebersprungen wurde (Adresse noch nicht
    // eingerichtet), hat keinen Ordner. Das ist kein Fehler dieses Schritts.
    let da = false;
    try { da = statSync(ordner).isDirectory(); } catch (e) { da = false; }
    if (!da) { console.log(`${ordner}: nicht vorhanden, nichts zu verdichten`); continue; }
    for (const datei of htmlDateien(ordner)) {
      const roh = readFileSync(datei, 'utf8');
      try {
        const neu = await verdichten(roh);
        writeFileSync(datei, neu);
        vorher += roh.length; nachher += neu.length;
        console.log(`${datei}: ${roh.length} -> ${neu.length} Zeichen`);
      } catch (e) {
        // GitHub zeigt "::warning::" gelb im Protokoll an.
        console.log(`::warning::${datei} bleibt unverdichtet: ${String(e && e.message || e).split('\n')[0]}`);
      }
    }
  }
  console.log(`Zusammen: ${vorher} -> ${nachher} Zeichen`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main(process.argv.slice(2));
}
