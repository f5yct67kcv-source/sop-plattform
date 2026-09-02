// Signal beim Erreichen eines Kontrollpunkts (ENT-319).
//
// Vom Projektinhaber verlangt: "wenn der MA in den Radius vom
// Kontrollpunkt gelangt und dieser greift, braucht es akustisch ein
// deutliches Signal. Ebenso ein haptisches Feedback mit einer starken
// Vibration. Damit der MA eine gute Rueckmeldung hat."
//
// Der Kern dieser Suite ist die WEICHE, nicht der Ton: Ein Signal, das bei
// jeder Messung neu kommt, schaltet der Waechter nach der zweiten Nacht ab
// -- und dann ist die ganze Funktion weg. Geprueft wird darum vor allem,
// wann NICHT ausgeloest wird.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);
const APP = readFileSync(`${WURZEL}/app.html`, 'utf8');

// ══════════ DIE DREI KANÄLE ═══════════════════════════════════════════
check('KRITISCH: es gibt einen Ton',
  /function rgTonSignal/.test(APP) && /createOscillator/.test(APP));
check('KRITISCH: es wird vibriert, wo das Gerät es kann',
  /function rgVibrieren/.test(APP) && /navigator\.vibrate\(\[/.test(APP));
// Auf iOS gibt es navigator.vibrate NICHT. Ohne sichtbaren Kanal haette
// der Projektinhaber auf seinem iPhone gar keine Rueckmeldung.
check('KRITISCH: es gibt zusätzlich eine SICHTBARE Rückmeldung — der einzige Kanal, der überall ankommt',
  /function rgSichtSignal/.test(APP) && /\.rg-signal\s*\{/.test(APP));
check('Alle drei Kanäle laufen über eine Stelle, nicht verstreut',
  /function rgSignalGeben[\s\S]{0,200}rgTonSignal\(\)[\s\S]{0,120}rgVibrieren\(\)[\s\S]{0,120}rgSichtSignal\(/.test(APP));
// Der Tonkanal ist auf iOS bis zur ersten Nutzeraktion gesperrt -- und
// zwar dauerhaft, nicht nur beim ersten Mal.
check('KRITISCH: der Tonkanal wird aus einer Nutzeraktion heraus entsperrt',
  /function rgTonEntsperren/.test(APP)
  && /rgOrtungNachfuehren\(\);[\s\S]{0,400}rgTonEntsperren\(\);/.test(APP));
check('Ein Gerät ohne Tonunterstützung lässt die Runde nicht scheitern',
  /catch \(e\) \{ rgsTonKanal = null; \}/.test(APP));
check('Das Signal fängt keinen Knopf ab, den jemand drücken wollte',
  /\.rg-signal[\s\S]{0,400}pointer-events: none/.test(APP));
// Es liegt ueber allem -- auch ueber offenen Schubladen (Toast: 200).
check('Das Signal liegt über allem anderen',
  /\.rg-signal[\s\S]{0,300}z-index: 300/.test(APP));

const EXE = browserPfad();
const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
await page.route('**/api/**', route => route.fulfill({ status: 200,
  contentType: 'application/json', body: JSON.stringify({ status: 'ok' }) }));
await page.route('**maps.googleapis.com/**', route => route.abort());
await page.goto(`file://${WURZEL}/app.html`);
await page.waitForTimeout(300);

// ══════════ DIE WEICHE: WANN AUSLÖSEN, WANN NICHT ════════════════════
const w = await page.evaluate(() => {
  const f = (war, dist, r) => rgSignalNoetig(war, dist, r);
  return {
    ersterEintritt: f(false, 12, 25),
    vonUnbekannt: f(undefined, 12, 25),
    schonDrin: f(true, 12, 25),
    // Genau am Rand springt die Messung -- ohne Hysterese gaebe das eine
    // Kette von Signalen.
    knappDraussen: f(true, 30, 25),
    knappDraussenDannRein: f(f(true, 30, 25).drin, 12, 25),
    weitDraussen: f(true, 60, 25),
    weitDraussenDannRein: f(f(true, 60, 25).drin, 12, 25),
    ohneOrt: f(true, null, 25),
    abstand: RG_SIGNAL_ABSTAND,
  };
});
check('KRITISCH: beim Betreten des Radius wird ausgelöst', w.ersterEintritt.signal === true);
check('Auch wenn vorher gar kein Zustand bekannt war', w.vonUnbekannt.signal === true);
// Sonst piepte es alle paar Sekunden, solange jemand am Punkt steht.
check('KRITISCH: wer schon drin ist, bekommt kein zweites Signal', w.schonDrin.signal === false);
// Das Herzstueck: eine springende Messung am Rand darf keine Signalkette
// erzeugen.
check('KRITISCH: knapp ausserhalb gilt weiterhin als "drin" (Hysterese)',
  w.knappDraussen.drin === true && w.knappDraussen.signal === false);
check('KRITISCH: und löst beim Zurückspringen KEIN neues Signal aus',
  w.knappDraussenDannRein.signal === false);
check('KRITISCH: wer WIRKLICH weit weg war, bekommt beim Wiederkommen ein neues Signal',
  w.weitDraussen.drin === false && w.weitDraussenDannRein.signal === true);
check('Ohne Standort wird nichts ausgelöst und nichts vergessen',
  w.ohneOrt.signal === false && w.ohneOrt.drin === true);
check('Der Abstand ist mit einem nachvollziehbaren Wert gesetzt',
  w.abstand >= 5 && w.abstand <= 50);

// ══════════ ERLEDIGTE PUNKTE SCHWEIGEN ════════════════════════════════
const e = await page.evaluate(() => {
  const gerufen = [];
  const echt = window.rgSignalGeben;
  window.rgSignalGeben = t => gerufen.push(t);
  rundgangAktiv = { id: 1, kontrollpunkte: [
    { id: 1, bezeichnung: 'Offen', typ: 'geofence', lat: 47.35, lng: 7.9,
      geofence_radius_m: 25, erledigt: null },
    { id: 2, bezeichnung: 'Schon erledigt', typ: 'geofence', lat: 47.35, lng: 7.9,
      geofence_radius_m: 25, erledigt: { status: 'bestaetigt' } },
    { id: 3, bezeichnung: 'NFC ohne Ort', typ: 'nfc', lat: null, lng: null,
      geofence_radius_m: 20, erledigt: null },
  ] };
  rgsMeinOrt = { lat: 47.35, lng: 7.9, genauigkeit: 5, zeit: Date.now() };
  rgBereichPruefen();
  const ersteRunde = gerufen.slice();
  rgBereichPruefen();            // zweite Messung am selben Ort
  const nachZweiter = gerufen.slice();
  window.rgSignalGeben = echt;
  return { ersteRunde, nachZweiter };
});
check('KRITISCH: der offene Punkt löst aus', e.ersteRunde.length === 1
  && e.ersteRunde[0].includes('Offen'));
// Wer an einem schon bestaetigten Punkt vorbeigeht, bekommt keine Meldung.
check('KRITISCH: ein bereits erledigter Punkt schweigt', !e.ersteRunde.join('|').includes('Schon erledigt'));
check('Ein NFC-Punkt ohne Koordinaten löst nichts aus', !e.ersteRunde.join('|').includes('NFC'));
check('KRITISCH: eine zweite Messung am selben Ort löst NICHT erneut aus',
  e.nachZweiter.length === 1);
check('Der Name des Kontrollpunkts steht im Signal, nicht nur "erreicht"',
  e.ersteRunde[0].includes('Offen') && e.ersteRunde[0].includes('erreicht'));

// ══════════ DIE SICHTBARE RÜCKMELDUNG, GEMESSEN ══════════════════════
await page.evaluate(() => rgSichtSignal('Kontrollpunkt erreicht — Haupteingang'));
await page.waitForTimeout(400);
check('KRITISCH: die sichtbare Rückmeldung erscheint',
  await page.isVisible('#rgSignal'));
check('Sie nennt den Kontrollpunkt',
  (await page.textContent('#rgSignal')).includes('Haupteingang'));
// Auf dem iPhone ist sie der einzige Kanal, der sicher ankommt -- also
// darf sie nicht wie ein Hinweis am Rand aussehen.
check('KRITISCH: sie ist gross genug, um sie nicht zu übersehen',
  await page.evaluate(() => {
    const r = document.getElementById('rgSignal').getBoundingClientRect();
    const s = parseFloat(getComputedStyle(document.getElementById('rgSignal')).fontSize);
    return r.width >= 180 && r.height >= 50 && s >= 17;
  }));
check('Sie steht im oberen Bereich, nicht unter dem Daumen',
  await page.evaluate(() => {
    const r = document.getElementById('rgSignal').getBoundingClientRect();
    return r.top < window.innerHeight * 0.5;
  }));
check('KRITISCH: kein waagrechter Seiten-Scroll durch das Signal',
  await page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
await page.screenshot({ path: `${OUT}/signal-01.png` });
// Sie verschwindet von selbst -- ein Signal, das stehenbleibt, verdeckt
// irgendwann etwas Wichtiges.
await page.waitForTimeout(2600);
check('Sie verschwindet von selbst wieder',
  await page.evaluate(() => !document.getElementById('rgSignal').classList.contains('an')));

await page.setViewportSize({ width: 1440, height: 900 });
await page.evaluate(() => rgSichtSignal('Kontrollpunkt erreicht — Tor 3'));
await page.waitForTimeout(300);
check('Auch am Desktop kein waagrechter Scroll',
  await page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
