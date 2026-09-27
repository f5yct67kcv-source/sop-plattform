// Erzeugt die App-Symbole fuer Android -- dasselbe Zeichen wie auf iOS
// (ENT-658): die Bildmarke auf dem Schwarz-Blau-Verlauf.
//
// WARUM EIN EIGENES SKRIPT: Android will nicht EIN Bild wie iOS, sondern
// drei Sorten in fuenf Dichten:
//
//   ic_launcher.png             quadratisch, ganzflaechig -- fuer Android 7
//                               (minSdk 24), das noch keine adaptiven Symbole kennt
//   ic_launcher_round.png       dasselbe, rund ausgeschnitten
//   ic_launcher_foreground.png  NUR die Marke auf Durchsicht, und
//   ic_launcher_background.png  NUR der Verlauf -- die beiden Ebenen des
//                               adaptiven Symbols (ab Android 8)
//
// Das adaptive Symbol ist der heikle Teil. Jeder Hersteller schneidet es
// anders zu -- Kreis, Quadrat mit runden Ecken, Tropfen -- und sichtbar ist
// nur die Mitte: 72 von 108 dp. Sicher im Bild bleibt nur, was im Kreis von
// 66 dp liegt. Marke und Verlauf beziehen sich darum hier auf das
// SICHTBARE Feld von 72 dp und nicht auf die ganze Ebene. So steht die
// Marke auf dem Telefon im selben Verhaeltnis wie auf dem iPhone, und ihre
// Ecken liegen im sicheren Kreis (test_appsymbol.mjs misst das nach).
//
// Die Masse der Marke sind die aus ENT-658, an der Vorlage gemessen: 44,6 %
// der Breite, waagrecht mittig, oben 20,1 %. Der Verlauf ist derselbe wie
// auf der Anmeldemaske in app.html (neun abgetastete Stufen, "to top right").
//
// Aus dem VEKTOR gerechnet, nicht aus dem 1024er iOS-Symbol verkleinert --
// derselbe Grund wie in ENT-658: Kleine Groessen verlieren sonst die Kanten.
//
// Aufruf (braucht Playwright aus pruefungen/, also dort einmal "npm install"):
//     node android-symbole-erzeugen.mjs
import { createRequire } from 'module';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const WURZEL = dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(join(WURZEL, 'pruefungen', 'package.json'))('playwright');
const { browserPfad } = await import('./pruefungen/pfade.mjs');

const RES = join(WURZEL, 'mobile/android/app/src/main/res');
const MARKE = readFileSync(join(WURZEL, 'logo-quellen/guard-ops-bildmarke-weiss.svg'), 'utf8');
const STUFEN = [['#080E17', 0], ['#0A121E', 13], ['#0D1625', 25], ['#0F1B2B', 38],
  ['#122034', 50], ['#1A2C45', 63], ['#213756', 75], ['#294368', 88], ['#304F79', 100]];

// Der Verlauf fuer eine Flaeche, deren mittiges Feld den Anteil `k` der
// Kante hat. Die Stufen werden auf das Feld zusammengeschoben, davor und
// danach stehen die Endfarben -- so laeuft der Verlauf im sichtbaren Feld
// genau wie auf dem iPhone und setzt sich ohne Kante bis an den Rand der
// Ebene fort (manche Startbildschirme verschieben die Ebene beim Wischen).
function verlauf(k) {
  const o = (1 - k) / 2 * 100;
  const st = STUFEN.map(([farbe, p]) => `${farbe} ${(o + k * p).toFixed(3)}%`);
  return `linear-gradient(to top right, #080E17 0%, ${st.join(', ')}, #304F79 100%)`;
}

// Die fuenf Dichten. Faktor 1 = mdpi.
const DICHTEN = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

// Ein Symbol auf einer Flaeche von `seite` Bildpunkten. `feld` ist das
// Quadrat, auf das sich Marke und Verlauf beziehen (x, y, Kante) -- beim
// ganzflaechigen Symbol die ganze Flaeche, beim adaptiven die sichtbare Mitte.
function seite(seite, feld, { verlauf: mitVerlauf, marke, rund }) {
  const [fx, fy, fk] = feld;
  const breite = fk * 0.446;
  const hoehe = breite * 220 / 170;             // Seitenverhaeltnis der Bildmarke
  const links = fx + (fk - breite) / 2;
  const oben = fy + fk * 0.201;
  const svg = 'data:image/svg+xml;base64,' + Buffer.from(MARKE).toString('base64');
  return `<!doctype html><html><head><style>
    html,body{margin:0;background:transparent}
    #f{position:relative;width:${seite}px;height:${seite}px;overflow:hidden;
       ${rund ? 'border-radius:50%;' : ''}}
    #v{position:absolute;inset:0;background:${mitVerlauf ? verlauf(fk / seite) : 'transparent'}}
    img{position:absolute;left:${links}px;top:${oben}px;width:${breite}px;height:${hoehe}px}
  </style></head><body><div id="f"><div id="v"></div>
  ${marke ? `<img src="${svg}">` : ''}</div></body></html>`;
}

const browser = await chromium.launch({ executablePath: browserPfad() });
const page = await browser.newPage({ deviceScaleFactor: 1 });

async function bild(pfad, px, feld, art) {
  await page.setViewportSize({ width: px, height: px });
  await page.setContent(seite(px, feld, art));
  await page.evaluate(() => Promise.all([...document.images].map(i => i.decode())));
  const png = await page.locator('#f').screenshot({ omitBackground: true });
  mkdirSync(dirname(pfad), { recursive: true });
  writeFileSync(pfad, png);
}

for (const [name, f] of Object.entries(DICHTEN)) {
  const ordner = join(RES, `mipmap-${name}`);
  const klein = Math.round(48 * f);             // ganzflaechiges Symbol: 48 dp
  const ebene = Math.round(108 * f);            // adaptive Ebene: 108 dp
  const sicht = [18 * f, 18 * f, 72 * f];       // sichtbare Mitte: 72 dp
  await bild(join(ordner, 'ic_launcher.png'), klein, [0, 0, klein], { verlauf: true, marke: true });
  await bild(join(ordner, 'ic_launcher_round.png'), klein, [0, 0, klein], { verlauf: true, marke: true, rund: true });
  await bild(join(ordner, 'ic_launcher_foreground.png'), ebene, sicht, { verlauf: false, marke: true });
  await bild(join(ordner, 'ic_launcher_background.png'), ebene, sicht, { verlauf: true, marke: false });
  console.log(`mipmap-${name}: ${klein} px / Ebenen ${ebene} px`);
}

await browser.close();
