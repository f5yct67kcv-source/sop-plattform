// Herstellermarke "Guard OpS" in der Huelle des Cockpits.
//
// Im Anmeldebildschirm signiert die Marke eine Seite, die dem Betrieb
// gehoert (test_gate_signatur.mjs). Hier drinnen sagt sie, in WELCHER
// Software gearbeitet wird -- links die Software, rechts oben das
// Betriebslogo als Kontogriff.
//
// Geprueft wird nicht das Aussehen, sondern was still brechen kann:
//
//   1. Die Zeichnung sitzt nicht in ihrem Kasten. Das ist beim Bau genau
//      passiert: <use> setzt ein <symbol> immer bei (0,0) des AUFRUFENDEN
//      Koordinatensystems ab. Stand aussen dieselbe viewBox wie im Symbol
//      ("0 -120.22 ..."), rutschte die Zeichnung um 120 Einheiten nach
//      unten und war abgeschnitten -- waehrend Kasten, Farbe und Kontrast
//      sich unveraendert massen. Keine der vorhandenen Pruefungen sah es;
//      sichtbar wurde es erst auf einem Bildschirmfoto. Darum wird hier die
//      TINTE gemessen (getBBox ueber die Bildschirmmatrix), nicht der
//      Kasten: Sie muss im Kasten liegen und ihn fuellen.
//   2. Die Kopfleiste waechst auf zwei Zeilen. Die Leiste ist ein Raster
//      1fr auto 1fr; ein Kind ohne ausdrueckliches "grid-row: 1" setzt die
//      Rasterautomatik hinter das Betriebslogo in eine zweite Zeile. Im
//      Quelltext sieht man davon nichts (der Fall ist im Dashboard schon
//      einmal aufgetreten, siehe Kommentar bei .shell.aus .side-brand).
//   3. Die Navigation verliert die Fenstermitte. Sie steht in Spalte 2,
//      mittig nur solange beide Aussenspalten gleich breit bleiben. Ein zu
//      breiter Inhalt links sprengt das -- und die Marke IST jetzt dieser
//      Inhalt.
//   4. Die falsche Fassung erscheint. Schriftzug (110 px breit) und
//      Bildmarke allein (20 px) wechseln nach Platz. Beide zugleich waere
//      doppelt, keine von beiden waere ein verschwundenes Logo -- und
//      beides sieht man auf dem Desktop nicht, wenn man nur einen Zustand
//      ansieht.
//   5. Die beiden Fassungen laufen auseinander. Sie zeigen ueber <use> auf
//      denselben Vorrat; verschwindet der oder wird eine Fassung wieder als
//      eigene Kopie eingesetzt, aendert eine spaetere Korrektur nur die
//      eine Stelle.
//   6. Die Marke verschwindet in einem der drei Huellenzustaende. Sie ist
//      EIN Element, das je Zustand anders steht -- eine spaetere Regel
//      gleicher Eigenspezifitaet reicht, um es in einem davon auszublenden.
//
// Gemessen wird am gerenderten Zustand (CLAUDE.md), in beiden Themen.
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const URL = `file://${WURZEL}/dashboard.html`;
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const STATS = { status: 'ok', kpi: { rapporte_monat: 0, rapporte_vormonat: 0, stunden_monat: 0,
  stunden_vormonat: 0, mitarbeiter: 1, kunden: 0, rapporte_total: 0 },
  verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [], sperr_ereignisse: [] };

const browser = await chromium.launch({ executablePath: browserPfad() });

async function seite(breite, hoehe) {
  const p = await browser.newPage({ viewport: { width: breite, height: hoehe } });
  p.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
  await p.route('**/api/**', route => {
    const u = route.request().url();
    const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.includes('login')) { return send({ status: 'ok', token: 't', name: 'a', ist_admin: true }); }
    if (u.includes('dashboard_stats')) { return send(STATS); }
    return send({ status: 'ok', einsaetze: [], kunden: [], rapporte: [], objekte: [],
      mitarbeiter: [], feiertage: [], gepflegt: {}, sperren: [] });
  });
  await p.goto(URL);
  return p;
}

async function angemeldet(breite, hoehe) {
  const p = await seite(breite, hoehe);
  await p.fill('#gName', 'a'); await p.fill('#gPass', 'x'); await p.click('#gBtn');
  await p.waitForSelector('#shell.on');
  await p.waitForTimeout(300);
  return p;
}

// Die Messfunktion lebt im Browser und wird mehrfach gebraucht.
const MESSEN = () => {
  const mk = document.querySelector('.marke-hersteller');
  if (!mk) { return null; }
  // Ueber getClientRects und nicht ueber den eigenen display-Wert: Ein
  // Kind eines display:none-Elternteils meldet selbst weiter "block". Genau
  // damit ist diese Pruefung bei der Gegenprobe durchgerutscht -- die Marke
  // war in der schmalen Leiste ausgeblendet, und die Fassung galt trotzdem
  // als sichtbar.
  const sichtbar = e => !!e && e.getClientRects().length > 0
                     && getComputedStyle(e).visibility === 'visible';
  const voll = mk.querySelector('.mh-voll');
  const zeichen = mk.querySelector('.mh-zeichen');
  const aktiv = sichtbar(voll) ? voll : (sichtbar(zeichen) ? zeichen : null);

  // Tinte: getBBox liefert Nutzereinheiten, getScreenCTM rechnet sie in
  // Bildschirmpunkte um. Erst damit laesst sich sagen, ob die Zeichnung im
  // Kasten liegt -- getBoundingClientRect allein sagt das nie.
  let tinte = null;
  if (aktiv) {
    const bb = aktiv.getBBox(), m = aktiv.getScreenCTM();
    const pt = (x, y) => { const q = aktiv.createSVGPoint(); q.x = x; q.y = y; return q.matrixTransform(m); };
    const a = pt(bb.x, bb.y), b = pt(bb.x + bb.width, bb.y + bb.height);
    const k = aktiv.getBoundingClientRect();
    tinte = {
      imKasten: a.x >= k.left - 1 && a.y >= k.top - 1 && b.x <= k.right + 1 && b.y <= k.bottom + 1,
      deckungB: (b.x - a.x) / k.width, deckungH: (b.y - a.y) / k.height,
      kasten: { l: k.left, o: k.top, r: k.right, u: k.bottom, w: k.width, h: k.height },
    };
  }

  const lum = c => { const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => v / 255)
      .map(v => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  let grund = 'rgba(0, 0, 0, 0)', e = mk;
  while (e && (grund === 'transparent' || grund === 'rgba(0, 0, 0, 0)')) { grund = getComputedStyle(e).backgroundColor; e = e.parentElement; }
  const l1 = lum(getComputedStyle(mk).color), l2 = lum(grund);

  const side = document.getElementById('side');
  const nav = document.querySelector('.side-nav');
  const mkR = mk.getBoundingClientRect();
  const nb = nav.getBoundingClientRect();
  return {
    gezeichnet: mkR.width > 0 && mkR.height > 0 && sichtbar(mk),
    fassung: sichtbar(voll) ? 'wort' : (sichtbar(zeichen) ? 'zeichen' : 'keine'),
    beideSichtbar: sichtbar(voll) && sichtbar(zeichen),
    tinte,
    name: aktiv ? (aktiv.getAttribute('aria-label') || '') : '',
    ueberVorrat: aktiv ? !!aktiv.querySelector('use') : false,
    vorratZiel: aktiv && aktiv.querySelector('use')
      ? !!document.querySelector(aktiv.querySelector('use').getAttribute('href')) : false,
    kontrast: (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05),
    leisteH: side.getBoundingClientRect().height,
    ueberlauf: side.scrollWidth - side.clientWidth,
    navVersatz: Math.abs((nb.left + nb.right) / 2 - innerWidth / 2),
    linksVonNav: tinte ? tinte.kasten.r <= nb.left : false,
    luecke: tinte ? nb.left - tinte.kasten.r : 0,
  };
};

// ── Kopfleiste (Zustand "aus"), breites Fenster ────────────────────────
const d = await angemeldet(1500, 900);
await d.evaluate(() => huelleSetzen('aus', false));
await d.waitForTimeout(250);
const m = await d.evaluate(MESSEN);

check('Die Herstellermarke ist in der Huelle vorhanden', m !== null);
check('Sie wird tatsaechlich gezeichnet, nicht nur deklariert', !!m && m.gezeichnet === true);

if (m) {
  check('In der Kopfleiste steht der volle Schriftzug', m.fassung === 'wort');
  check('Nie beide Fassungen zugleich', m.beideSichtbar === false);
  check('KRITISCH: die Zeichnung liegt in ihrem Kasten und ist nicht abgeschnitten',
    !!m.tinte && m.tinte.imKasten);
  check('KRITISCH: die Zeichnung fuellt den Kasten (Breite >= 90 %)',
    !!m.tinte && m.tinte.deckungB >= 0.90);
  check('KRITISCH: die Zeichnung fuellt den Kasten (Hoehe >= 85 %)',
    !!m.tinte && m.tinte.deckungH >= 0.85);
  check('Sie steht links, vor der Navigation', m.linksVonNav);
  check('Zwischen Marke und erstem Menuepunkt bleibt Luft (>= 20 px)', m.luecke >= 20);
  check('Die Kopfleiste bleibt einzeilig (70 px)', Math.abs(m.leisteH - 70) < 1);
  check('Die Leiste laeuft nicht ueber', m.ueberlauf <= 0);
  check('Die Navigation steht weiter in der Fenstermitte', m.navVersatz <= 1);
  check('Sie traegt den vollstaendigen Namen fuer Screenreader', /guard\s*ops/i.test(m.name));
  check('Sie kommt aus dem gemeinsamen Vorrat, nicht aus einer Kopie',
    m.ueberVorrat && m.vorratZiel);
  check('Sie hebt sich vom Grund ab (>= 3:1)', m.kontrast >= 3);
}

// Schmales Fenster: dieselbe Marke, kleinere Fassung, nichts laeuft ueber.
for (const b of [1024, 1000, 901]) {
  await d.setViewportSize({ width: b, height: 900 });
  await d.waitForTimeout(220);
  const s = await d.evaluate(MESSEN);
  const erwartet = b >= 1024 ? 'wort' : 'zeichen';
  check(`Bei ${b} px steht die passende Fassung (${erwartet})`, s.fassung === erwartet);
  check(`Bei ${b} px ist die Zeichnung nicht abgeschnitten`, s.tinte && s.tinte.imKasten);
  check(`Bei ${b} px laeuft die Kopfleiste nicht ueber`, s.ueberlauf <= 0);
  check(`Bei ${b} px bleibt die Kopfleiste einzeilig`, Math.abs(s.leisteH - 70) < 1);
}

// ── Seitenleiste, beide Breiten ────────────────────────────────────────
await d.setViewportSize({ width: 1500, height: 900 });
for (const [zustand, erwartet] of [['voll', 'wort'], ['schmal', 'zeichen']]) {
  await d.evaluate(z => huelleSetzen(z, false), zustand);
  await d.waitForTimeout(220);
  const s = await d.evaluate(MESSEN);
  check(`Im Zustand "${zustand}" wird die Marke gezeichnet`, s.gezeichnet === true);
  check(`Im Zustand "${zustand}" ist die Marke da (${erwartet})`, s.fassung === erwartet);
  check(`Im Zustand "${zustand}" ist die Zeichnung nicht abgeschnitten`, s.tinte && s.tinte.imKasten);
  check(`Im Zustand "${zustand}" fuellt sie ihren Kasten`,
    s.tinte && s.tinte.deckungB >= 0.90 && s.tinte.deckungH >= 0.85);
  check(`Im Zustand "${zustand}" hebt sie sich vom Grund ab`, s.kontrast >= 3);
}

// Dunkles Thema: Die Huelle ist in beiden Themen dunkel, aber die Schublade
// auf dem Handy nicht -- darum wird der Kontrast hier zusaetzlich gemessen.
await d.evaluate(() => document.documentElement.setAttribute('data-thema', 'dunkel'));
await d.evaluate(() => huelleSetzen('aus', false));
await d.waitForTimeout(250);
const dunkel = await d.evaluate(MESSEN);
check('Im dunklen Thema ist die Marke da und hebt sich ab',
  dunkel.fassung === 'wort' && dunkel.kontrast >= 3 && dunkel.tinte.imKasten);
await d.close();

// ── Handy: Schublade ───────────────────────────────────────────────────
// Die Marke sitzt unter dem Fussteil. Sie darf das Abmelden nicht aus dem
// Bild schieben -- das ist der einzige Weg hinaus.
const h = await angemeldet(390, 844);
// Die Schublade wird so geoeffnet, wie der Benutzer es tut. Die Klasse
// heisst ".on" -- eine selbst gesetzte Wunschklasse liesse die Leiste auf
// "visibility: hidden" stehen, und gemessen wuerde dann ein unsichtbares
// Element.
await h.click('#btnBurger');
await h.waitForTimeout(350);
await h.waitForTimeout(250);
const mh = await h.evaluate(MESSEN);
const hExtra = await h.evaluate(() => {
  const imBlick = sel => { const e = document.querySelector(sel); if (!e) { return false; }
    const r = e.getBoundingClientRect();
    return r.height > 0 && r.top >= 0 && r.bottom <= innerHeight + 1; };
  return { abmeldenImBlick: imBlick('#nav-abmelden'), markeImBlick: imBlick('.marke-hersteller') };
});
check('Am Handy steht die Marke in der Schublade und ist im Blick', hExtra.markeImBlick === true);
check('Am Handy ist die Zeichnung nicht abgeschnitten', mh.tinte && mh.tinte.imKasten);
check('Am Handy bleibt "Abmelden" im Blick', hExtra.abmeldenImBlick === true);
check('Am Handy hebt sich die Marke vom hellen Schubladengrund ab (>= 3:1)', mh.kontrast >= 3);
await h.close();

// ── Anmeldebildschirm: dieselbe Zeichnung, derselbe Vorrat ─────────────
// Hier wird NICHT angemeldet -- das Gate muss sichtbar sein, sonst misst
// getBBox einen leeren Kasten.
const g = await seite(1440, 1000);
await g.waitForTimeout(400);
const mg = await g.evaluate(() => {
  const svg = document.querySelector('.gate-sig .go-sig');
  if (!svg) { return null; }
  const bb = svg.getBBox(), m = svg.getScreenCTM();
  const pt = (x, y) => { const q = svg.createSVGPoint(); q.x = x; q.y = y; return q.matrixTransform(m); };
  const a = pt(bb.x, bb.y), b = pt(bb.x + bb.width, bb.y + bb.height);
  const k = svg.getBoundingClientRect();
  const u = svg.querySelector('use');
  return {
    imKasten: a.x >= k.left - 1 && a.y >= k.top - 1 && b.x <= k.right + 1 && b.y <= k.bottom + 1,
    deckungB: (b.x - a.x) / k.width, deckungH: (b.y - a.y) / k.height,
    ueberVorrat: !!u, vorratZiel: u ? !!document.querySelector(u.getAttribute('href')) : false,
  };
});
check('Auch im Anmeldebildschirm kommt die Marke aus dem Vorrat',
  !!mg && mg.ueberVorrat && mg.vorratZiel);
check('KRITISCH: auch dort liegt die Zeichnung im Kasten und fuellt ihn',
  !!mg && mg.imKasten && mg.deckungB >= 0.90 && mg.deckungH >= 0.85);
await g.close();

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden`);
if (bad.length) { bad.forEach(n => console.log('  ✗ ' + n)); process.exit(1); }
console.log('\nAlle Pruefungen bestanden.');
