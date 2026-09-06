// Ziehen zum Aktualisieren (ENT-428) und der Sockel unter der
// Reiterleiste (ENT-429).
//
// Diese Suite misst am gerenderten Zustand, nicht im Quelltext. Eine
// CSS-Regel kann wirkungslos bleiben, ohne dass etwas kaputtgeht -- durch
// eine spaetere Regel gleicher oder hoeherer Eigenspezifitaet. Und eine
// Pruefung, die nachsieht, ob ein Wort im Code steht, bleibt gruen, wenn
// die Formulierung sich aendert und die Sache verschwindet.
//
// Gezogen wird mit echten Beruehrungsereignissen ueber das Chrome DevTools
// Protocol, nicht mit von Hand gebauten Event-Objekten: Ein selbst
// zusammengesetztes TouchEvent laeuft an jeder Bedingung vorbei, die der
// Browser selbst stellt (passive Zuhoerer, Reihenfolge, scrollY) -- und
// prueft dann die Nachbildung statt die Sache.
//
// Zum Sockel: Auf dem Telefon des Projektinhabers endete der Bereich, an
// dem "position: fixed; bottom: 0" haengt, um die Hoehe der Statusleiste
// zu frueh. Nachstellen laesst sich das im Prueflauf nicht -- der Fehler
// gehoert iOS. Geprueft wird darum beides getrennt:
//   1. die MESSUNG (sockelMessen): Wann gibt sie einen Wert, wann nicht?
//   2. die WIRKUNG (--sockel gesetzt): Wandert die Leiste dann wirklich
//      bis an die Kante, ohne dass die Knoepfe sich verschieben?
//
// Alle Testdaten sind erfunden.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const tag = n => iso(new Date(Date.now() + n * 864e5));

// Ein Bildschirm, auf dem "Heute" kuerzer ist als das Fenster -- genau die
// Lage, in der die Reiterleiste auf dem iPhone danebensass.
const BREIT = 393, HOCH = 852;

const browser = await chromium.launch({ executablePath: EXE });
const seite = await browser.newContext({
  viewport: { width: BREIT, height: HOCH }, deviceScaleFactor: 3, hasTouch: true, isMobile: true
});
const page = await seite.newPage();
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));

// Eine Schicht heute, damit "Heute" nicht der Leerzustand ist -- und eine
// weit in der Zukunft, damit "Plan" laenger wird als der Bildschirm.
const SCHICHTEN = { status: 'ok', von: tag(-1), bis: tag(90), schichten: [
  { id: 61, kunde_name: 'Cupi24 GmbH', titel: 'Revierdienst Beispiel', strasse: 'Musterweg 1',
    ort: '4632 Trimbach', einsatzart: 'Revierdienst', datum: tag(0), von: '20:00:00', bis: '23:00:00',
    status: 'bestaetigt', bemerkung: null, zusage: 'zugesagt', objekt_name: null, im_team: 1 },
  ...Array.from({ length: 14 }, (_, i) => ({
    id: 100 + i, kunde_name: 'Cupi24 GmbH', titel: 'Schicht ' + (i + 1), strasse: null,
    ort: '5013 Musterdorf', einsatzart: 'Verkehrsdienst', datum: tag(1 + i), von: '08:00:00',
    bis: '16:00:00', status: 'bestaetigt', bemerkung: null, zusage: 'zugesagt',
    objekt_name: null, im_team: 1 }))
] };

const rufe = [];
await page.route('**/api/**', route => {
  const p = route.request().url().split('/api/')[1].split('?')[0];
  rufe.push(p);
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'dario.beispiel', ist_admin: false });
  if (p.includes('meine_schichten')) return send(SCHICHTEN);
  if (p.includes('mein_profil')) return send({ status: 'ok', profil: {
    name: 'dario.beispiel', vorname: 'Dario', nachname: 'Beispiel', revierdienst_berechtigt: 1 } });
  if (p.includes('rapport_list')) return send({ status: 'ok', rapporte: [] });
  return send({ status: 'ok' });
});

await page.goto(`file://${WURZEL}/app.html`);
await page.fill('#gName', 'dario.beispiel');
await page.fill('#gPass', 'geheim');
await page.click('#gBtn');
await page.waitForSelector('#app.on');
await page.waitForTimeout(500);

const cdp = await seite.newCDPSession(page);

// Ein echter Zug: aufsetzen, in Schritten ziehen, loslassen. Die Schritte
// muessen einzeln kommen -- ein Sprung von 0 auf 200 px ist kein Ziehen,
// sondern ein Sprung, und traefe die Zwischenzustaende nie.
async function ziehen(weg, { loslassen = true, x = BREIT / 2, y0 = 260 } = {}) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
  for (let i = 1; i <= 8; i++) {
    await cdp.send('Input.dispatchTouchEvent',
      { type: 'touchMove', touchPoints: [{ x, y: y0 + (weg * i) / 8 }] });
    await page.waitForTimeout(16);
  }
  if (loslassen) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
}

const zaehle = e => rufe.filter(p => p.includes(e)).length;
const anzeiger = () => page.evaluate(() => {
  const h = document.getElementById('ptr'), k = document.getElementById('ptrKreis');
  const s = getComputedStyle(k);
  return { reif: h.classList.contains('reif'), laedt: h.classList.contains('laedt'),
           deckkraft: Number(s.opacity), y: Math.round(k.getBoundingClientRect().top) };
});

// ══════════════ ZIEHEN: die Geste selbst
// Ein kurzer Zug ist KEIN Auslöser. Das ist die Gegenprobe zum Fall
// darunter: Ohne sie wuerde eine Fassung, die bei jeder Beruehrung laedt,
// genauso gruen.
let vorher = zaehle('meine_schichten');
await ziehen(60);
await page.waitForTimeout(400);
check('Ein kurzer Zug löst NICHT aus', zaehle('meine_schichten') === vorher);
check('Nach dem kurzen Zug ist der Anzeiger wieder verborgen', (await anzeiger()).deckkraft < 0.05);

// Der kräftige Zug lädt neu -- und zwar alle Quellen, nicht nur eine.
vorher = zaehle('meine_schichten');
const vorherProfil = zaehle('mein_profil');
await ziehen(240);
await page.waitForTimeout(200);
const beimLaden = await anzeiger();
check('KRITISCH: kräftig nach unten ziehen lädt neu', zaehle('meine_schichten') > vorher);
check('Es lädt alle Quellen, nicht nur die Schichten', zaehle('mein_profil') > vorherProfil);
check('Während des Ladens ist der Anzeiger sichtbar', beimLaden.laedt && beimLaden.deckkraft > 0.9);
await page.waitForTimeout(1200);
const danach = await anzeiger();
check('Nach dem Laden verschwindet der Anzeiger wieder', !danach.laedt && danach.deckkraft < 0.05);

// Waehrend des Ziehens: Der Kreis kommt mit, und ab der Schwelle sagt er
// es. Ohne diese Rueckmeldung zieht man ins Ungewisse.
await ziehen(60, { loslassen: false });
const halb = await anzeiger();
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await page.waitForTimeout(400);
check('Der Anzeiger folgt dem Finger', halb.deckkraft > 0.3);
check('Auf halbem Weg meldet er noch nicht "es löst aus"', !halb.reif);

await ziehen(240, { loslassen: false });
const voll = await anzeiger();
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await page.waitForTimeout(1400);
check('KRITISCH: ab der Schwelle meldet der Anzeiger, dass es auslöst', voll.reif);
check('Der Kreis wandert dabei nach unten', voll.y > halb.y);

// ══════════════ ZIEHEN: wo es NICHT gilt
// Nicht am oberen Rand: Dann ist es ein Bildlauf, kein Ziehen.
await page.evaluate(() => zeige('plan'));
await page.waitForTimeout(300);
check('Der Plan ist länger als der Bildschirm (Voraussetzung der Prüfung)',
  await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 100));
await page.evaluate(() => window.scrollTo(0, 300));
await page.waitForTimeout(150);
vorher = zaehle('meine_schichten');
await ziehen(240);
await page.waitForTimeout(900);
check('KRITISCH: mitten im Bildlauf löst der Zug NICHT aus', zaehle('meine_schichten') === vorher);

// Der Fall, den nur die Prüfung beim AUFSETZEN abfängt: weit unten
// anfassen und in einem Zug bis über den oberen Rand hinaus ziehen. Der
// Finger geht dabei genauso weit nach unten wie beim Ziehen -- der
// Unterschied ist allein, dass die Seite beim Aufsetzen noch nicht oben
// stand. Das ist ein Bildlauf und darf nicht neu laden.
await page.evaluate(() => window.scrollTo(0, 300));
await page.waitForTimeout(150);
vorher = zaehle('meine_schichten');
await ziehen(620, { y0: 150 });
await page.waitForTimeout(900);
check('Die Seite ist dabei wirklich bis nach oben gelaufen (Voraussetzung)',
  await page.evaluate(() => window.scrollY === 0));
check('KRITISCH: bis an den oberen Rand zurückscrollen lädt NICHT neu',
  zaehle('meine_schichten') === vorher);

// Dasselbe noch einmal, aber als Wettlauf: Die Zuhörer sind passiv, der
// Browser darf also schon gescrollt haben, bevor das erste touchmove
// ankommt. Dann steht scrollY dort bereits auf 0 und die Prüfung IM
// touchmove greift nicht mehr -- es bleibt nur die beim Aufsetzen.
// Von Hand nachgestellt, weil der Wettlauf sich nicht bestellen lässt.
await page.evaluate(() => window.scrollTo(0, 300));
await page.waitForTimeout(150);
vorher = zaehle('meine_schichten');
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: BREIT / 2, y: 200 }] });
await page.evaluate(() => window.scrollTo(0, 0));
for (let i = 1; i <= 8; i++) {
  await cdp.send('Input.dispatchTouchEvent',
    { type: 'touchMove', touchPoints: [{ x: BREIT / 2, y: 200 + i * 30 }] });
  await page.waitForTimeout(16);
}
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await page.waitForTimeout(900);
check('KRITISCH: hat der Bildlauf den Zug überholt, lädt es trotzdem nicht neu',
  zaehle('meine_schichten') === vorher);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(150);

// Liegt eine eigene Seite darüber, gehört der Zug ihr.
await page.evaluate(() => { document.getElementById('mitSeite').classList.add('on'); });
await page.waitForTimeout(150);
vorher = zaehle('meine_schichten');
await ziehen(240);
await page.waitForTimeout(900);
check('KRITISCH: über einer offenen Seite löst der Zug NICHT aus',
  zaehle('meine_schichten') === vorher);
await page.evaluate(() => { document.getElementById('mitSeite').classList.remove('on'); });
await page.waitForTimeout(150);
await page.evaluate(() => zeige('heute'));
await page.waitForTimeout(300);

// ══════════════ SOCKEL: die Messung
// Die drei Werte, die sockelMessen() liest, werden vorübergehend
// überschrieben und danach wieder entfernt -- der Browser liefert sie
// anschliessend wieder selbst.
const messung = j => page.evaluate(({ standalone, schirm, fenster }) => {
  Object.defineProperty(window.navigator, 'standalone', { value: standalone, configurable: true });
  Object.defineProperty(window.screen, 'height', { value: schirm, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: fenster, configurable: true });
  try { return sockelMessen(); } finally {
    delete window.navigator.standalone;
    delete window.screen.height;
    delete window.innerHeight;
  }
}, j);

check('KRITISCH: im Vollbild vom Startbildschirm misst der Sockel den fehlenden Streifen',
  (await messung({ standalone: true, schirm: 852, fenster: 793 })) === 59);
check('KRITISCH: im Browser mit Adresszeile bleibt der Sockel 0',
  (await messung({ standalone: false, schirm: 852, fenster: 640 })) === 0);
check('Ohne iOS-Kennzeichen bleibt der Sockel 0',
  (await messung({ standalone: undefined, schirm: 852, fenster: 793 })) === 0);
check('Passt alles zusammen, gibt es nichts zu korrigieren',
  (await messung({ standalone: true, schirm: 852, fenster: 852 })) === 0);
check('Ein unplausibel grosser Unterschied wird nicht angefasst (Tastatur, Querformat)',
  (await messung({ standalone: true, schirm: 852, fenster: 700 })) === 0);
check('Ein Fenster grösser als der Bildschirm ergibt keinen negativen Sockel',
  (await messung({ standalone: true, schirm: 852, fenster: 900 })) === 0);

// ══════════════ SOCKEL: die Wirkung
const lage = sel => page.evaluate(s => {
  const e = document.querySelector(s);
  if (!e) { return null; }
  const r = e.getBoundingClientRect();
  return { top: Math.round(r.top), bottom: Math.round(r.bottom) };
}, sel);
const knopfLage = () => page.evaluate(() =>
  Math.round(document.querySelector('.tabs button').getBoundingClientRect().top));

const ohne = await lage('.tabs');
const knopfOhne = await knopfLage();
check('KRITISCH: ohne Sockel sitzt die Reiterleiste bündig am unteren Rand',
  ohne.bottom === HOCH);

// Jetzt der Fall des iPhones nachgestellt: Der feste untere Rand liegt 59 px
// zu hoch. Die Leiste muss diese 59 px nach unten reichen -- und die
// Knoepfe muessen dabei stehen bleiben, sonst wandert die Trefferflaeche.
await page.evaluate(() => document.documentElement.style.setProperty('--sockel', '59px'));
await page.waitForTimeout(120);
const mit = await lage('.tabs');
const knopfMit = await knopfLage();
check('KRITISCH: mit Sockel reicht die Leiste um genau diesen Betrag tiefer',
  mit.bottom === ohne.bottom + 59);
check('KRITISCH: die Knöpfe bleiben dabei, wo sie waren', knopfMit === knopfOhne);
check('Der Inhalt darüber verschiebt sich nicht', mit.top === ohne.top);

// Dieselbe Korrektur tragen alle Flächen, die unten am Bildschirm haengen.
// Bliebe eine zurueck, stuende dort derselbe Streifen -- nur an einer
// Stelle, an die niemand mehr denkt.
// Gemessen wird jede Fläche SICHTBAR -- eine verborgene hat keine Lage,
// und eine Prüfung, die stattdessen den errechneten CSS-Wert abliest,
// bliebe grün, wenn die Regel gar nicht mehr greift.
const sichtbarMessen = (sel, auf) => page.evaluate(({ sel, auf }) => {
  const e = document.querySelector(sel);
  if (!e) { return null; }
  const vorher = e.style.display, vorherT = e.style.transition, hatte = e.classList.contains('on');
  // Das Blatt faehrt von unten herein. Ohne diese Zeile misst man den
  // Zwischenstand der Bewegung statt die Endlage.
  e.style.transition = 'none';
  if (auf === 'display') { e.style.display = 'flex'; } else { e.classList.add('on'); }
  const r = e.getBoundingClientRect();
  const wert = { top: Math.round(r.top), bottom: Math.round(r.bottom) };
  if (auf === 'display') { e.style.display = vorher; } else if (!hatte) { e.classList.remove('on'); }
  e.style.transition = vorherT;
  return wert;
}, { sel, auf });

for (const [sel, auf, name] of [['#gate', 'display', 'die Anmeldung'],
                                ['.abdunkeln', 'klasse', 'der Schleier'],
                                ['.blatt', 'klasse', 'das Blatt'],
                                ['.rgs', 'klasse', 'der Einsatzmodus'],
                                ['.mit-seite', 'klasse', 'die Mitteilungsseite']]) {
  const l = await sichtbarMessen(sel, auf);
  check(`Auch ${name} reicht bis an die Kante`, l && l.bottom === HOCH + 59);
}
// Der Fussbereich der Vollseiten muss die 59 px als Polster mitbekommen --
// sonst rutschten seine Knoepfe unter den Bildschirmrand.
const fussPolster = await page.evaluate(() => {
  const e = document.querySelector('.rgs-fuss');
  return e ? Math.round(parseFloat(getComputedStyle(e).paddingBottom)) : null;
});
check('Der Fussbereich der Vollseiten hält den Sockel frei', fussPolster >= 59 + 16);

await page.evaluate(() => document.documentElement.style.removeProperty('--sockel'));
await page.waitForTimeout(120);
check('Ohne Sockel ist wieder alles wie vorher', (await lage('.tabs')).bottom === HOCH);

await page.screenshot({ path: `${OUT}/ziehen-heute.png` });

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
