// Der Anmeldebildschirm verschiebt sich beim Oeffnen der Tastatur (ENT-635).
//
// Vom Projektinhaber gemeldet, mit Bildschirmfotos: Vorher stand der
// Anmeldeblock mittig, Logo und "Passwort vergessen?" sichtbar. Nach dem
// Antippen eines Feldes riss die Tastatur das Bild auseinander -- das Logo
// war weg, und darunter blieb eine grosse leere Flaeche stehen. #gate ist
// "position:fixed;inset:0" und schrumpfte selbst nicht mit: iOS verschob
// stattdessen das ganze sichtbare Fenster, um das fokussierte Feld ueber
// die Tastatur zu heben.
//
// Kopfloses Chromium kennt keine echte Bildschirmtastatur, und
// page.setViewportSize() aendert window.innerHeight und
// window.visualViewport.height GEMEINSAM -- genau der Fall, den die
// Sockel-Messung schon beherrscht, nicht der Tastatur-Fall. Auf dem
// iPhone aendert sich nur visualViewport.height; innerHeight bleibt
// stehen. Genau das wird hier nachgebildet: window.visualViewport.height
// wird ueberschrieben (dieselbe Eigenschaft, die die App selbst liest),
// window.innerHeight bleibt unangetastet -- ein "resize" darauf loest
// denselben Code aus wie auf dem Geraet.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const browser = await chromium.launch({ executablePath: browserPfad() });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.setDefaultTimeout(5000);
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));

await page.goto(`file://${WURZEL}/app.html`);
await page.waitForTimeout(400);

// Die "Tastatur" nachbilden: visualViewport.height ueberschreiben,
// innerHeight unveraendert lassen -- und ein echtes "resize" darauf
// feuern, denselben Ereignisnamen, an den die App horcht.
const tastaturSetzen = hoehe => page.evaluate(h => {
  Object.defineProperty(window.visualViewport, 'height', { get: () => h, configurable: true });
  window.visualViewport.dispatchEvent(new Event('resize'));
}, hoehe);

const gate = async () => page.evaluate(() => {
  const r = document.getElementById('gate').getBoundingClientRect();
  return { top: r.top, bottom: r.bottom, hoehe: r.height };
});
const tastaturVar = () => page.evaluate(() =>
  getComputedStyle(document.documentElement).getPropertyValue('--tastatur').trim());

// ══════════ AUSGANGSLAGE: KEINE TASTATUR, VOLLE FLAECHE ═══════════════
const vorher = await gate();
check('KRITISCH: #gate fuellt ohne Tastatur den ganzen Bildschirm',
  vorher.top === 0 && Math.abs(vorher.hoehe - 844) < 2);
check('Die Tastatur-Variable steht auf 0', (await tastaturVar()) === '0px');

// ══════════ EINE TASTATUR (300 px) SCHRUMPFT #gate VON UNTEN ══════════
await page.click('#gPass');
await tastaturSetzen(844 - 300);
await page.waitForTimeout(150);
check('KRITISCH: die Tastatur-Variable traegt jetzt die gemessene Hoehe',
  (await tastaturVar()) === '300px');
const mitTastatur = await gate();
check('KRITISCH: #gate schrumpft genau um die Tastaturhoehe -- von UNTEN, nicht von oben',
  mitTastatur.top === 0 && Math.abs(mitTastatur.hoehe - 544) < 2);
// Die Gegenprobe zum gemeldeten Fehler: Vorher verschwand das Logo aus dem
// Bild, weil das ganze Fenster verschoben wurde. Jetzt bleibt die OBERE
// Kante an Ort und Stelle -- die Flaeche schrumpft, sie wandert nicht.
check('KRITISCH: die obere Kante bleibt am Bildschirmrand -- kein Wegrutschen des Logos',
  mitTastatur.top === 0);
check('Das fokussierte Feld bleibt sichtbar innerhalb der geschrumpften Flaeche',
  await page.evaluate(() => {
    const f = document.getElementById('gPass').getBoundingClientRect();
    const g = document.getElementById('gate').getBoundingClientRect();
    return f.top >= g.top - 1 && f.bottom <= g.bottom + 1;
  }));
await page.screenshot({ path: `${OUT}/tastatur-01-geschrumpft.png` });

// ══════════ KLEINE ABWEICHUNGEN SIND DER SOCKEL, NICHT DIE TASTATUR ═══
// Grenze wie bei sockelMessen(): bis 80 px gehoert es der Statusleiste/
// dem Home-Indikator, nicht der Tastatur.
await tastaturSetzen(844 - 60);
await page.waitForTimeout(150);
check('KRITISCH: 60 px Abweichung zaehlt NICHT als Tastatur (Grenze bei 80, wie beim Sockel)',
  (await tastaturVar()) === '0px');
const kleineAbweichung = await gate();
check('#gate bleibt bei einer so kleinen Abweichung auf voller Hoehe',
  Math.abs(kleineAbweichung.hoehe - 844) < 2);

// ══════════ TASTATUR ZU: DIE FLAECHE FUELLT SICH WIEDER ═══════════════
await tastaturSetzen(844);
await page.waitForTimeout(150);
check('KRITISCH: nach dem Schliessen der Tastatur steht die Variable wieder auf 0',
  (await tastaturVar()) === '0px');
const nachher = await gate();
check('KRITISCH: #gate fuellt danach wieder den ganzen Bildschirm',
  nachher.top === 0 && Math.abs(nachher.hoehe - 844) < 2);

await browser.close();

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { console.log(bad.map(n => '  ✗ ' + n).join('\n')); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
