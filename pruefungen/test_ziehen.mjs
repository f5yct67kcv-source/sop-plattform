// Ziehen zum Aktualisieren (ENT-438) und der Sockel unter der
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

// ══════════════ Nachstellen und WIEDER ZURÜCKGEBEN
// window.innerHeight, screen.height und navigator.standalone sind EIGENE
// Eigenschaften ihres Objekts, keine geerbten. "delete" legt darum nicht
// die ursprüngliche Auskunft wieder frei, sondern nimmt sie endgültig weg
// -- der Browser meldet danach undefined, und jede spätere Messung misst
// eine kaputte Welt.
//
// Genau das stand hier bis zum 08.09.2026 und ist beim Bau der Reiter-Spur
// aufgefallen: Ein Reiter hatte in seiner Aufzeichnung kein "Fenster"
// mehr, obwohl der Browser eines hat. Sämtliche Prüfungen nach dem ersten
// Nachstellen liefen seither gegen innerHeight === undefined und waren
// damit wertlos, ohne rot zu werden.
//
// Jetzt wird der ursprüngliche Zustand gemerkt und zurückgegeben -- und
// wo es vorher gar keine eigene Eigenschaft gab (navigator.standalone
// kennt Chromium nicht), wird sie wieder entfernt.
await page.evaluate(() => {
  // paare: [[objekt, name, wert], ...] -- ein Wert von undefined heisst
  // "gar nicht setzen" (navigator.standalone kennt Chromium nicht, und
  // "kein iOS-Kennzeichen" ist genau dieser Fall).
  window.__nachstellen = (paare, fn) => {
    const merk = paare.map(([o, k]) => [o, k, Object.getOwnPropertyDescriptor(o, k)]);
    for (const [o, k, v] of paare) {
      if (v === undefined) { continue; }
      Object.defineProperty(o, k, { value: v, configurable: true });
    }
    try { return fn(); } finally {
      for (const [o, k, d] of merk) {
        if (d) { Object.defineProperty(o, k, d); } else { delete o[k]; }
      }
    }
  };
});

// ══════════════ SOCKEL: die Messung aus den Zahlen des Browsers
// Die drei Werte, die sockelMessen() liest, werden vorübergehend
// überschrieben und danach wieder entfernt -- der Browser liefert sie
// anschliessend wieder selbst.
//
// Die zweite Quelle (der Anker, ENT-475) wird dabei stillgelegt und hat
// ihre eigenen Prüfungen weiter unten. Sonst prüfte dieser Block zwei
// Rechnungen auf einmal: Er verstellt window.innerHeight, und genau davon
// lebt auch der Anker -- ein überschriebenes Fenster von 900 hiesse für
// ihn wahrheitsgemäss "bottom: 0 landet 48 Punkte zu hoch".
const messung = j => page.evaluate(({ standalone, schirm, fenster }) => {
  const anker = window.sockelAmAnker;
  window.sockelAmAnker = () => 0;
  try {
    return window.__nachstellen([[window.navigator, 'standalone', standalone],
                                 [window.screen, 'height', schirm],
                                 [window, 'innerHeight', fenster]], () => sockelMessen());
  } finally { window.sockelAmAnker = anker; }
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

// Die Prüfung, die den Prüfstand selbst prüft. Sie hätte den Fehler vom
// 08.09.2026 sofort gefunden: "delete" gab window.innerHeight nicht
// zurück, sondern nahm es weg -- alles danach mass eine kaputte Welt und
// blieb trotzdem grün. Wer die Nachstellung wieder auf "delete" umstellt,
// wird hier rot.
const echteWelt = await page.evaluate(() => ({
  fenster: window.innerHeight, schirm: window.screen.height,
  vollbild: window.navigator.standalone }));
check('KRITISCH: nach dem Nachstellen meldet das Fenster wieder seine echte Höhe',
  echteWelt.fenster === HOCH);
check('KRITISCH: und der Bildschirm seine echte', echteWelt.schirm > 0);
check('Das iOS-Kennzeichen ist danach wieder weg', echteWelt.vollbild === undefined);

// ══════════════ SOCKEL: der ANKER (ENT-475)
// Die Quelle, die den beiden Anläufen davor gefehlt hat. Gefragt wird
// nicht, was der Browser über sein Fenster SAGT, sondern wo ein Element
// mit "position: fixed; bottom: 0" wirklich landet.
//
// Nachgestellt wird der ABSTAND zwischen beiden, nicht seine Ursache --
// die gehört iOS und lässt sich hier nicht herstellen. Auf dem iPhone ist
// das Fenster 852 und der Anker bei 793; hier liegt der Anker bei den
// echten 852 und das Fenster wird auf 911 gesetzt. Beide Male misst der
// Anker dieselben 59 Punkte. Der Probekörper selbst wird NICHT nachgebaut:
// Er ist das, was geprüft wird.
const amAnker = fenster => page.evaluate(f =>
  window.__nachstellen([[window, 'innerHeight', f]], () => sockelAmAnker()), fenster);
const imVollbild = f => page.evaluate(ff =>
  window.__nachstellen([[window.navigator, 'standalone', true],
                        [window, 'innerHeight', ff]], () => sockelAmAnker()), f);

check('KRITISCH: sitzt der feste untere Rand 59 Punkte zu hoch, misst der Anker 59',
  (await imVollbild(HOCH + 59)) === 59);
check('KRITISCH: sitzt er richtig, misst der Anker 0', (await imVollbild(HOCH)) === 0);
check('Ein zu kurz gemeldetes Fenster ergibt keinen negativen Anker',
  (await imVollbild(HOCH - 40)) <= 0);
check('KRITISCH: ausserhalb des Vollbilds vom Startbildschirm misst der Anker gar nichts',
  (await amAnker(HOCH + 59)) === 0);
// Der Probekörper darf nichts hinterlassen: kein Element im Baum, keine
// zusätzliche Blätterhöhe. Sonst repariert die Messung ihren eigenen
// Befund -- eine blätternde Seite ist genau der Zustand, in dem der
// Fehler verschwindet.
const spuren = await page.evaluate(() => {
  const vorher = document.body.childElementCount;
  const vorherHoehe = document.documentElement.scrollHeight;
  window.__nachstellen([[window.navigator, 'standalone', true]], () => sockelAmAnker());
  return { gleich: document.body.childElementCount === vorher,
           hoehe: document.documentElement.scrollHeight === vorherHoehe };
});
check('KRITISCH: der Probekörper hinterlässt kein Element im Baum', spuren.gleich);
check('KRITISCH: und keine zusätzliche Blätterhöhe', spuren.hoehe);

// Und der Anker muss in sockelMessen() auch WIRKLICH gelesen werden. Ohne
// diese Prüfung bliebe die ganze Rechnung oben grün, während sie im
// Betrieb niemand aufruft.
//
// Die Lage muss dafür so gestellt sein, dass die erste Quelle NICHTS
// findet -- sonst prüft man sie statt den Anker. Beim ersten Anlauf ist
// genau das passiert: Bildschirm und Fenster standen beide auf 911, und
// die erste Quelle fand die 59 über visualViewport.height (die echten
// 852), das die Nachstellung nicht mit verstellt hatte. Die Prüfung blieb
// grün, obwohl der Anker gar nicht gelesen wurde -- aufgefallen erst in
// der Gegenprobe. Darum bleibt der Bildschirm hier auf seinen echten 852:
// Dann sind beide Rechnungen der ersten Quelle 0 oder negativ, und nur
// der Anker kann noch etwas sagen.
const nurAnker = await page.evaluate(f =>
  window.__nachstellen([[window.navigator, 'standalone', true],
                        [window.screen, 'height', f.schirm],
                        [window, 'innerHeight', f.fenster]], () => sockelMessen()),
  { schirm: HOCH, fenster: HOCH + 59 });
check('KRITISCH: sockelMessen liest den Anker auch wirklich', nurAnker === 59);

// ══════════════ SOCKEL: neu gemessen, nicht einmal gemerkt (ENT-475)
// Der Versatz ist nicht auf jeder Ansicht gleich gross -- er hängt daran,
// ob die Seite länger ist als der Bildschirm. Eine einmal beim Start
// gesetzte Zahl ist darum auf der einen Ansicht richtig und auf der
// anderen falsch. Geprüft wird, dass ein hinterlegter Wert den
// Reiterwechsel NICHT überlebt, sondern neu gemessen wird.
for (const r of ['plan', 'heute', 'waechter', 'rapport', 'menu']) {
  const neuGemessen = await page.evaluate(async ziel => {
    document.documentElement.style.setProperty('--sockel', '41px');
    zeige(ziel);
    return document.documentElement.style.getPropertyValue('--sockel');
  }, r);
  check(`Auf "${r}" wird der Sockel neu gemessen statt übernommen`, neuGemessen === '0px');
}
await page.evaluate(() => { document.documentElement.style.removeProperty('--sockel'); zeige('heute'); });
await page.waitForTimeout(300);

// ══════════════ SOCKEL: die SPUR je Reiter
// Der teuerste Befund aus drei Anläufen lag nicht im Code, sondern im Weg
// zur Diagnose: Die Technikzeile steht am ENDE des Menüs, und das Menü ist
// länger als der Bildschirm. Wer sie liest, hat die App damit in genau den
// Zustand gebracht, in dem der Fehler nicht auftritt. An den
// Bildschirmfotos vom 08.09. nachgemessen: "Wächter" 696–793, Menü
// 755–852 -- dieselbe Sitzung, eine Minute auseinander.
//
// Geprüft wird deshalb, dass jeder Reiter seine EIGENEN Zahlen behält.
for (const r of ['heute', 'plan', 'waechter', 'menu']) {
  await page.evaluate(n => zeige(n), r);
  await page.waitForTimeout(250);
}
const spur = await page.evaluate(() => JSON.parse(JSON.stringify(sockelSpur)));
check('KRITISCH: jeder besuchte Reiter hinterlässt eigene Zahlen',
  ['heute', 'plan', 'waechter'].every(r => spur[r]));
// Die Unterscheidung, an der alles hängt: Blättert die Ansicht oder nicht?
// Ohne sie ist aus der Ferne nicht zu sehen, ob die Zahlen aus dem kranken
// oder aus dem gesunden Zustand stammen.
check('KRITISCH: die Spur hält fest, dass "Plan" blättert', spur.plan?.blaettert === true);
check('KRITISCH: und dass "Heute" und "Wächter" das nicht tun',
  spur.heute?.blaettert === false && spur.waechter?.blaettert === false);
// Und sie darf beim Reiterwechsel nicht überschrieben werden -- sonst
// stünde im Menü wieder nur, was im Menü gilt.
check('KRITISCH: die Zahlen von "Wächter" überleben den Wechsel ins Menü',
  !!spur.waechter?.leiste
  && spur.waechter.leiste === (await page.evaluate(() => sockelSpur.waechter?.leiste)));
check('Die Spur nennt Fenster, Rahmen und die Lage der Leiste',
  ['fenster', 'layout', 'leiste'].every(k => spur.heute?.[k] !== undefined));

// "Unbekannt" darf nie wie "keine" aussehen -- auch in der Spur nicht.
const spurVerdeckt = await page.evaluate(() => {
  document.getElementById('mitSeite').classList.add('on');
  sockelSetzen();
  const wert = sockelSpur[reiter] ? sockelSpur[reiter].sockel : 'keine Spur';
  document.getElementById('mitSeite').classList.remove('on');
  return wert;
});
check('KRITISCH: eine verdeckte Leiste steht in der Spur als "nicht messbar", nicht als 0',
  spurVerdeckt === null);

// Und die Spur muss im Menü auch wirklich ankommen -- eine Aufzeichnung,
// die niemand sieht, beantwortet nichts.
const imMenue = await page.evaluate(() => {
  zeige('waechter'); zeige('menu');
  return (document.getElementById('v-menu').textContent || '');
});
check('KRITISCH: die Spur steht im Menü', imMenue.includes('Wächter: Fenster'));
check('Die Spur nennt dort auch, ob der Reiter blättert', imMenue.includes('blättert'));
await page.evaluate(() => zeige('heute'));
await page.waitForTimeout(250);

// ══════════════ SOCKEL: die Wirkung
const lage = sel => page.evaluate(s => {
  const e = document.querySelector(s);
  if (!e) { return null; }
  const r = e.getBoundingClientRect();
  return { top: Math.round(r.top), bottom: Math.round(r.bottom) };
}, sel);
const knopfLage = () => page.evaluate(() => {
  const r = document.querySelector('.tabs button').getBoundingClientRect();
  return { top: Math.round(r.top), bottom: Math.round(r.bottom) };
});

const ohne = await lage('.tabs');
const knopfOhne = await knopfLage();
check('KRITISCH: ohne Sockel sitzt die Reiterleiste bündig am unteren Rand',
  ohne.bottom === HOCH);

// Jetzt der Fall des iPhones nachgestellt: Der feste untere Rand liegt 59 px
// zu hoch.
//
// BERICHTIGT MIT ENT-475 -- und das ist der Kern des Befundes vom
// Projektinhaber ("Heute und Wächter sitzen höher"). Hier stand vorher das
// Gegenteil: "die Knöpfe müssen dabei stehen bleiben". Das war falsch. Der
// Sockel sagt aus, dass der ganze Bezugsrahmen zu hoch endet -- also sitzt
// ALLES darin zu hoch, die Knöpfe eingeschlossen. Blieben sie stehen,
// reichte am Ende nur die Milchglasfläche bis an die Kante, und die Reiter
// sässen weiterhin um den Sockel zu hoch. Genau so sah es auf dem Gerät
// aus: auf "Plan" (blättert, Rahmen stimmt) sassen sie tiefer als auf
// "Heute" und "Wächter" (blättern nicht, Rahmen zu kurz).
await page.evaluate(() => document.documentElement.style.setProperty('--sockel', '59px'));
await page.waitForTimeout(120);
const mit = await lage('.tabs');
const knopfMit = await knopfLage();
check('KRITISCH: mit Sockel reicht die Leiste um genau diesen Betrag tiefer',
  mit.bottom === ohne.bottom + 59);
check('KRITISCH: die Knöpfe wandern um denselben Betrag mit',
  knopfMit.top === knopfOhne.top + 59);
check('KRITISCH: die Leiste wird dabei nicht höher, sie rückt nur nach unten',
  mit.top === ohne.top + 59);
// Die Probe darauf, dass die Verschiebung auch stimmt: Unter dem letzten
// Knopf muss genau der Sicherheitsabstand des Geräts bleiben -- gemessen
// ab der Kante, an der die Leiste jetzt endet. Zwei Sockel im selben Weg
// (verschieben UND polstern) fielen genau hier auf.
const restUnten = mit.bottom - knopfMit.bottom;
const geraeteAbstand = await page.evaluate(() => {
  const e = document.createElement('div');
  e.style.cssText = 'position:fixed;height:env(safe-area-inset-bottom);visibility:hidden';
  document.body.appendChild(e);
  const h = Math.round(e.getBoundingClientRect().height);
  e.remove();
  return h;
});
check('KRITISCH: unter dem letzten Knopf bleibt nur der Sicherheitsabstand des Geräts',
  restUnten === geraeteAbstand);

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
// Der Fussbereich der Vollseiten darf den Sockel NICHT ein zweites Mal
// als Polster tragen (ENT-475). Die Fläche über ihm ist bereits um den
// Sockel nach unten gerückt; ein zusätzliches Polster schöbe seine Knöpfe
// um denselben Betrag wieder nach oben -- derselbe Fehler wie bei der
// Reiterleiste, nur an einer Stelle, an die niemand mehr denkt. Gemessen
// wird die Lage der Knöpfe, nicht der errechnete Polsterwert: Ein Polster
// abzulesen sagt nichts darüber, wo der Knopf am Ende sitzt.
const fussKnopf = await page.evaluate(() => {
  const s = document.querySelector('.rgs');
  const hatte = s.classList.contains('on');
  const vorherT = s.style.transition; s.style.transition = 'none';
  s.classList.add('on');
  const f = document.querySelector('.rgs-fuss');
  const vorherH = f.innerHTML;
  if (!f.querySelector('button')) { f.innerHTML = '<button class="btn btn-primary">Probe</button>'; }
  const k = f.querySelector('button').getBoundingClientRect();
  const box = s.getBoundingClientRect();
  const rest = Math.round(box.bottom - k.bottom);
  f.innerHTML = vorherH;
  if (!hatte) { s.classList.remove('on'); }
  s.style.transition = vorherT;
  return rest;
});
check('KRITISCH: der Knopf im Fussbereich hält nur den Geräteabstand zur Kante, nicht zusätzlich den Sockel',
  fussKnopf === geraeteAbstand + 16);

await page.evaluate(() => document.documentElement.style.removeProperty('--sockel'));
await page.waitForTimeout(120);
check('Ohne Sockel ist wieder alles wie vorher', (await lage('.tabs')).bottom === HOCH);

// ══════════════ SOCKEL: die Messung am gezeichneten Bild
// Der eigentliche Fall vom iPhone: Das Layout meldet die Leiste TIEFER,
// als sie gezeichnet und getroffen wird. Genau so wird er nachgestellt --
// getBoundingClientRect der Leiste liefert vorübergehend einen um N Punkte
// nach unten verschobenen Wert, alles andere bleibt echt. Ein
// Nachbau der Trefferpruefung waere hier wertlos: Sie ist das, was
// geprueft wird.
// Die Leiste bekommt dabei die Höhe, die sie auf dem iPhone hat (62 px
// plus 34 px Sicherheitsabstand unten) -- ohne diese Höhe überschneiden
// sich gemeldete und gezeichnete Lage kaum, und die Nachbildung prüfte
// eine Enge, die es auf dem Gerät gar nicht gibt.
const amBild = versatz => page.evaluate(v => {
  const leiste = document.querySelector('.tabs');
  const vorher = leiste.style.paddingBottom;
  leiste.style.paddingBottom = '34px';
  void leiste.offsetHeight;
  const echt = Element.prototype.getBoundingClientRect;
  leiste.getBoundingClientRect = function () {
    const r = echt.call(this);
    return { ...r.toJSON(), top: r.top + v, bottom: r.bottom + v,
             left: r.left, right: r.right, width: r.width, height: r.height };
  };
  try { return sockelAmBild(); } finally {
    delete leiste.getBoundingClientRect;
    leiste.style.paddingBottom = vorher;
  }
}, versatz);

// Das Blatt faehrt nach der Messung oben noch aus dem Bild -- solange es
// unterwegs ist, verdeckt es die Leiste. Genau daran ist diese Prüfung
// beim ersten Lauf gescheitert; das Warten gehört zur Nachbildung.
await page.waitForTimeout(400);
check('KRITISCH: deckungsgleich gezeichnet ergibt keinen Sockel', (await amBild(0)) === 0);
check('KRITISCH: wird die Leiste 59 Punkte höher gezeichnet, misst der Sockel 59',
  Math.abs((await amBild(59)) - 59) <= 1);
check('Auch ein anderer Betrag wird richtig gemessen', Math.abs((await amBild(34)) - 34) <= 1);
check('Ein unplausibel grosser Versatz gilt als nicht messbar', (await amBild(120)) === null);
// Der Grenzfall dazwischen: gross genug, dass die Suche ihn nicht mehr
// einkreist, aber klein genug, dass die Leiste sich noch selbst trifft.
// Auch das ist "unbekannt" und darf nicht als "kein Versatz" durchgehen.
check('KRITISCH: knapp über der Suchgrenze gilt als nicht messbar, nicht als 0',
  (await amBild(85)) === null);

// Liegt etwas über der Leiste, sagt die Trefferprüfung nichts -- dann
// wird auch nichts korrigiert.
await page.evaluate(() => { document.getElementById('mitSeite').classList.add('on'); });
await page.waitForTimeout(120);
check('KRITISCH: liegt eine Vollseite darüber, ist der Sockel NICHT messbar — und das ist etwas anderes als 0',
  (await amBild(59)) === null);
await page.evaluate(() => { document.getElementById('mitSeite').classList.remove('on'); });
await page.waitForTimeout(120);

// Der Fehler, den der erste Prüflauf aufgedeckt hat: Eine verdeckte
// Leiste ist NICHT MESSBAR und darf einen bereits gefundenen Sockel nicht
// auf 0 zurücksetzen.
const behalten = await page.evaluate(() => {
  const stil = document.documentElement.style;
  stil.setProperty('--sockel', '59px');
  document.getElementById('mitSeite').classList.add('on');
  sockelSetzen();
  const nachher = stil.getPropertyValue('--sockel');
  document.getElementById('mitSeite').classList.remove('on');
  stil.removeProperty('--sockel');
  return nachher;
});
check('KRITISCH: eine verdeckte Leiste löscht den gefundenen Sockel nicht', behalten === '59px');

// Und der Fehler, der am teuersten waere: zweimal messen darf nicht
// zweimal verschieben. Geprüft wird das mit einem echten Sockel im Bild --
// mit 0 wäre die Prüfung wertlos, weil doppelt 0 wieder 0 ist.
const zweimal = await page.evaluate(() => {
  const leiste = document.querySelector('.tabs');
  const vorherP = leiste.style.paddingBottom;
  leiste.style.paddingBottom = '34px'; void leiste.offsetHeight;
  const echt = Element.prototype.getBoundingClientRect;
  leiste.getBoundingClientRect = function () {
    const r = echt.call(this);
    return { ...r.toJSON(), top: r.top + 59, bottom: r.bottom + 59,
             left: r.left, right: r.right, width: r.width, height: r.height };
  };
  const stil = document.documentElement.style;
  sockelSetzen(); const a = stil.getPropertyValue('--sockel');
  sockelSetzen(); const b = stil.getPropertyValue('--sockel');
  delete leiste.getBoundingClientRect;
  leiste.style.paddingBottom = vorherP;
  stil.removeProperty('--sockel');
  return [a, b];
});
check('Der Sockel wird beim Setzen auch wirklich gesetzt (Voraussetzung)', zweimal[0] === '59px');
check('KRITISCH: zweimal messen ergibt denselben Sockel, nicht den doppelten',
  zweimal[1] === zweimal[0]);

// Die Technikzeile trägt die Zahlen, aus denen der Sockel entsteht.
const technik = await page.evaluate(() => technikZeile());
check('Die Technikzeile nennt Bildschirm, Fenster, Sicht und Sockel',
  ['Bildschirm', 'Fenster', 'Sicht', 'Leiste', 'Anker', 'Blättert', 'gezeichnet',
   'Sockel', 'Vollbild'].every(t => technik.includes(t)));

// "Unbekannt" darf nie wie "keine" aussehen -- hier die Stelle, an der die
// Fernsuche sonst hereinfiele: Läuft die App wider Erwarten NICHT vom
// Startbildschirm, geht der gemessene Anker nicht in die Rechnung ein. Die
// Zeile muss das sagen, statt "bündig" zu melden und damit "kein Versatz
// vorhanden" zu behaupten.
const ankerZeile = t => (t.split(' · ').find(x => x.startsWith('Anker')) || '');
check('KRITISCH: ohne Vollbild sagt die Technikzeile, dass der Anker ungenutzt bleibt',
  ankerZeile(await page.evaluate(() => technikZeile())).includes('ungenutzt'));
check('KRITISCH: im Vollbild behauptet sie das nicht',
  !ankerZeile(await page.evaluate(() => window.__nachstellen(
    [[window.navigator, 'standalone', true]], () => technikZeile()))).includes('ungenutzt'));
// Und der gemessene Wert steht auch dann in der Zeile, wenn er nicht
// verwendet wird -- sonst wäre aus der Ferne nicht zu sehen, ob der
// Vorbehalt die Korrektur verhindert oder ob es nichts zu korrigieren gab.
check('KRITISCH: der Anker wird auch ohne Vollbild gemessen und genannt',
  ankerZeile(await page.evaluate(f => window.__nachstellen(
    [[window, 'innerHeight', f]], () => technikZeile()), HOCH + 59)).includes('59'));
check('Die Technikzeile steht im Menü', await page.evaluate(() => {
  zeige('menu');
  return (document.getElementById('v-menu').textContent || '').includes('Bildschirm');
}));
await page.evaluate(() => zeige('heute'));
await page.waitForTimeout(200);

await page.screenshot({ path: `${OUT}/ziehen-heute.png` });

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
