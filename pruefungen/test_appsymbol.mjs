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

const ANDROID_RES = 'mobile/android/app/src/main/res';
const ANDROID_DICHTEN = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

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
  // Android (seit dem ersten Android-Bau): das ganzflaechige Symbol fuer
  // Android 7, das noch keine adaptiven Symbole kennt. Gleiche Aussagen
  // wie oben -- es ist dasselbe Zeichen.
  ...Object.entries(ANDROID_DICHTEN).map(([d, f]) =>
    [`${ANDROID_RES}/mipmap-${d}/ic_launcher.png`, 48 * f]),
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

/* ── Android: das adaptive Symbol (ab Android 8) ─────────────────────────
   Zwei Ebenen von 108 dp, sichtbar ist nur die Mitte von 72 dp, und jeder
   Hersteller schneidet sie anders zu. Sicher bleibt nur, was im Kreis von
   66 dp um die Mitte liegt. Darum hier andere Aussagen als oben:
   - Die VORDERE Ebene ist Durchsicht mit einer hellen Marke darauf, und
     die Marke liegt ganz im sicheren Kreis. Eine Marke, die darueber
     hinausragt, wird auf einem runden Startbildschirm angeschnitten --
     auf dem Telefon, mit dem es gebaut wurde, sieht man das womoeglich nie.
   - Die HINTERE Ebene ist der Verlauf, deckend, dunkel unten links. */
const lies = async pfad => {
  const b64 = readFileSync(`${WURZEL}/${pfad}`).toString('base64');
  return page.evaluate(async d => {
    const im = new Image(); im.src = 'data:image/png;base64,' + d;
    try { await im.decode(); } catch (e) { return null; }
    const N = im.naturalWidth;
    const c = document.createElement('canvas'); c.width = N; c.height = im.naturalHeight;
    const x = c.getContext('2d'); x.drawImage(im, 0, 0);
    const px = x.getImageData(0, 0, N, c.height).data;
    const L = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const at = (xx, yy) => { const i = (yy * N + xx) * 4; return [px[i], px[i+1], px[i+2], px[i+3]]; };
    let deckend = 0, hell = 0, weiteste = 0;
    for (let yy = 0; yy < N; yy++) for (let xx = 0; xx < N; xx++) {
      const [r, g, b, a] = at(xx, yy);
      if (a > 20) {
        deckend++;
        if (L(r, g, b) > 170) { hell++; }
        weiteste = Math.max(weiteste, Math.hypot(xx + 0.5 - N / 2, yy + 0.5 - N / 2));
      }
    }
    // Die Ecken des SICHTBAREN Feldes (72 von 108 dp), nicht der Ebene.
    const r0 = Math.round(N * 18 / 108) + 1, r1 = Math.round(N * 90 / 108) - 2;
    const lum = (xx, yy) => { const [r, g, b] = at(xx, yy); return L(r, g, b); };
    return { breite: N, hoehe: c.height, deckung: 100 * deckend / (N * N),
      hellAnteil: deckend ? 100 * hell / deckend : 0, weiteste,
      untenLinks: lum(r0, r1), obenRechts: lum(r1, r0), obenLinks: lum(r0, r0), untenRechts: lum(r1, r1) };
  }, b64);
};

for (const [d, f] of Object.entries(ANDROID_DICHTEN)) {
  const soll = 108 * f;
  const vorn = `${ANDROID_RES}/mipmap-${d}/ic_launcher_foreground.png`;
  const hinten = `${ANDROID_RES}/mipmap-${d}/ic_launcher_background.png`;
  const rund = `${ANDROID_RES}/mipmap-${d}/ic_launcher_round.png`;
  for (const p of [vorn, hinten, rund]) { check(`${p}: vorhanden`, existsSync(`${WURZEL}/${p}`)); }
  if (![vorn, hinten, rund].every(p => existsSync(`${WURZEL}/${p}`))) { continue; }

  const v = await lies(vorn);
  check(`${vorn}: ${soll} px`, !!v && v.breite === soll && v.hoehe === soll);
  check(`${vorn}: die vordere Ebene ist Durchsicht -- kein eigener Grund, der den Verlauf verdeckt`,
    !!v && v.deckung > 1 && v.deckung < 25);
  check(`${vorn}: was darauf steht, ist die helle Marke`, !!v && v.hellAnteil > 90);
  check(`KRITISCH: ${vorn}: die Marke liegt ganz im sicheren Kreis von 66 dp (weiteste Stelle ${v ? (v.weiteste / f).toFixed(1) : '?'} dp vom Mittelpunkt)`,
    !!v && v.weiteste <= 33 * f);
  // Nicht zu klein: Auf dem iPhone misst die Marke 44,6 % der Kante. Im
  // sichtbaren Feld von 72 dp reicht sie damit bis gut 22 dp vom
  // Mittelpunkt (gemessen: 22,2 bis 22,6 dp je nach Dichte). Eine Marke,
  // die deutlich weniger weit reicht, waere ein anderes Symbol als auf iOS.
  check(`${vorn}: die Marke fuellt das Feld wie auf dem iPhone und schrumpft nicht zum Punkt`,
    !!v && v.weiteste >= 20 * f);

  const h = await lies(hinten);
  check(`${hinten}: ${soll} px`, !!h && h.breite === soll && h.hoehe === soll);
  check(`${hinten}: deckend`, !!h && h.deckung > 99);
  check(`${hinten}: dunkel, und hell nur oben rechts -- derselbe Verlauf wie auf iOS`,
    !!h && h.untenLinks < 60 && h.obenRechts < 110 && h.obenRechts > h.untenLinks + 8);
  check(`${hinten}: entlang der Diagonale und nicht quer dazu`,
    !!h && Math.abs(h.obenLinks - h.untenRechts) <= 6);
  check(`${hinten}: keine Marke auf der hinteren Ebene -- sonst stuende sie doppelt`,
    !!h && h.hellAnteil < 0.5);

  const r = await lies(rund);
  check(`${rund}: ${48 * f} px und rund -- die Ecken sind Durchsicht`,
    !!r && r.breite === 48 * f && r.deckung < 82 && r.deckung > 70);
}

/* Die beiden XML-Dateien des adaptiven Symbols muessen auf genau diese
   Ebenen zeigen. Stand dort weiter das Capacitor-Standardzeichen (blaues
   Kreuz, weisser Grund), zeigte jedes Android ab Version 8 dieses --
   gleichgueltig, was in den PNG-Dateien steht. Genau der Fehler aus
   ENT-658, nur eine Datei weiter. */
for (const x of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
  const t = readFileSync(`${WURZEL}/${ANDROID_RES}/mipmap-anydpi-v26/${x}`, 'utf8');
  const ziel = teil => (t.match(new RegExp(`<${teil}[^>]*android:drawable="@([a-z]+)/([a-z_]+)"`)) || []).slice(1);
  const [ht, hn] = ziel('background'), [vt, vn] = ziel('foreground');
  const gibtEs = (typ, name) => !!typ && Object.keys(ANDROID_DICHTEN).every(d =>
    existsSync(`${WURZEL}/${ANDROID_RES}/${typ}-${d}/${name}.png`));
  check(`KRITISCH: ${x}: die hintere Ebene ist der gepruefte Verlauf`,
    ht === 'mipmap' && hn === 'ic_launcher_background' && gibtEs(ht, hn));
  check(`KRITISCH: ${x}: die vordere Ebene ist die gepruefte Marke`,
    vt === 'mipmap' && vn === 'ic_launcher_foreground' && gibtEs(vt, vn));
  check(`${x}: fuer "Designte Symbole" (Android 13) ist eine einfarbige Fassung da`,
    /<monochrome[^>]*@mipmap\/ic_launcher_foreground/.test(t));
}

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { console.log(bad.map(n => '  ✗ ' + n).join('\n')); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
