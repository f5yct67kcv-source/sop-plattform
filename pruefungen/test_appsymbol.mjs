// Das Symbol der App -- auf dem Startbildschirm, im Reiter, in der Huelle
// (ENT-658).
//
// ANLASS, und er ist unangenehm: Das iOS-App-Symbol war bis hierher das
// STANDARDZEICHEN VON CAPACITOR -- ein blaues Kreuz auf weissem Grund,
// unveraendert seit dem Aufsetzen des Geruests. Der Projektinhaber hat es
// auf seinem Startbildschirm gesehen, nicht eine Pruefung.
//
// Der Grund ist genau so einfach wie aergerlich: NIEMAND hat je in die
// Datei hineingesehen. Es gab Pruefungen auf die Dateinamen, auf die
// Verweise in den Seiten und auf die Buendel -- alle gruen, waehrend die
// Datei selbst ein fremdes Zeichen enthielt. Ein Dateiname sagt nichts
// darueber, was im Bild steht.
//
// Darum wird hier in die BILDER gesehen, und zwar so, dass die Aussage
// nicht am Wortlaut haengt: Jedes Symbol muss unseren dunklen Grund
// tragen (unten links dunkler als oben rechts -- der Verlauf) und eine
// helle Marke darauf, die ein UMRISS ist und keine Flaeche. Ein fremdes
// Zeichen faellt durch jede dieser drei Aussagen.
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'fs';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

// Die Dateien, die wirklich ausgeliefert werden -- der iOS-Satz und der
// Web-Satz. Die Groessen stehen hier, weil sie Teil der Aussage sind:
// Ein 180er, der in Wahrheit 32 px hat, ist auf dem Startbildschirm Matsch.
const SYMBOLE = [
  ['mobile/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', 1024],
  ['icons/guardops-512.png', 512],
  ['icons/guardops-192.png', 192],
  ['icons/guardops-180.png', 180],
  ['icons/guardops-32.png', 32],
  ['icons/guardops-16.png', 16],
];

const browser = await chromium.launch({ executablePath: browserPfad() });
const page = await browser.newPage();

for (const [pfad, soll] of SYMBOLE) {
  const da = existsSync(`${WURZEL}/${pfad}`);
  check(`${pfad}: die Datei ist vorhanden`, da);
  if (!da) { continue; }
  const b64 = readFileSync(`${WURZEL}/${pfad}`).toString('base64');
  const m = await page.evaluate(async d => {
    const im = new Image(); im.src = 'data:image/png;base64,' + d;
    try { await im.decode(); } catch (e) { return null; }
    const c = document.createElement('canvas');
    c.width = im.naturalWidth; c.height = im.naturalHeight;
    const x = c.getContext('2d'); x.drawImage(im, 0, 0);
    const px = x.getImageData(0, 0, c.width, c.height).data;
    const N = c.width;
    const L = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    // Ecken: ein Feld von 3x3 Bildpunkten, damit ein einzelner Ausreisser
    // (Kantenglaettung, PNG-Rundung) die Aussage nicht traegt.
    const ecke = (ex, ey) => {
      let s = 0, n = 0;
      for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) {
        const i = ((ey + dy) * N + (ex + dx)) * 4;
        s += L(px[i], px[i + 1], px[i + 2]); n++;
      }
      return s / n;
    };
    let hell = 0, deckend = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] > 128) { deckend++; }
      if (px[i + 3] > 128 && L(px[i], px[i + 1], px[i + 2]) > 170) { hell++; }
    }
    return {
      breite: c.width, hoehe: c.height,
      untenLinks: ecke(0, c.height - 3), obenRechts: ecke(N - 3, 0),
      obenLinks: ecke(0, 0), untenRechts: ecke(N - 3, c.height - 3),
      tinte: 100 * hell / (c.width * c.height),
      deckung: 100 * deckend / (c.width * c.height),
    };
  }, b64);
  check(`${pfad}: die Datei ist ein lesbares Bild`, m !== null);
  if (!m) { continue; }
  check(`${pfad}: quadratisch und ${soll} px, wie der Verweis verspricht`,
    m.breite === soll && m.hoehe === soll);
  /* Das Standardzeichen von Capacitor hat einen nahezu WEISSEN Grund --
     an dieser einen Aussage waere es sofort aufgefallen, haette sie
     jemand geschrieben. */
  check(`${pfad}: der Grund ist dunkel -- kein fremdes Zeichen auf hellem Grund`,
    m.untenLinks < 60 && m.obenRechts < 110);
  check(`${pfad}: der Verlauf laeuft von dunkel unten links nach hell oben rechts`,
    m.obenRechts > m.untenLinks + 8);
  /* Quer zur Diagonale ist die Vorlage an jeder Stelle gleich hell --
     gemessen an der Datei des Projektinhabers. Die beiden anderen Ecken
     muessen darum praktisch gleich sein; laufen sie auseinander, zeigt
     der Verlauf in eine andere Richtung als gewollt. In den kleinsten
     Groessen ist die Toleranz noetig, weil dort ein Bildpunkt schon ein
     ganzes Stueck des Verlaufs abdeckt. */
  check(`${pfad}: er laeuft entlang der Diagonale und nicht quer dazu`,
    Math.abs(m.obenLinks - m.untenRechts) <= (soll <= 32 ? 14 : 6));
  check(`${pfad}: das Bild ist deckend -- ein Startbildschirm zeigt keine Durchsicht`,
    m.deckung > 99);
  /* Die Marke ist ein Umriss. Eine leere Flaeche haette fast keine helle
     Tinte, eine gefuellte fast nur. Die Spanne ist weit genug fuer die
     Kantenglaettung der kleinen Groessen und eng genug, dass beide
     Fehler auffallen. */
  check(`${pfad}: die Marke ist da und ist ein Umriss (${m.tinte.toFixed(1)} % Tinte)`,
    m.tinte > 2.5 && m.tinte < 20);
}

/* Und der iOS-Satz muss die Datei ueberhaupt fuehren. Xcode liest
   Contents.json; ein Symbol, das dort nicht steht, wird nicht gebaut --
   und die App traegt danach gar kein Zeichen. */
const inhalt = readFileSync(
  `${WURZEL}/mobile/ios/App/App/Assets.xcassets/AppIcon.appiconset/Contents.json`, 'utf8');
let js = null;
try { js = JSON.parse(inhalt); } catch (e) {}
check('Der iOS-Satz ist lesbares JSON', js !== null);
check('KRITISCH: er fuehrt genau die Datei, die hier geprueft wurde',
  !!js && (js.images || []).some(b => b.filename === 'AppIcon-512@2x.png'
    && String(b.size || '').startsWith('1024')));

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { console.log(bad.map(n => '  ✗ ' + n).join('\n')); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
