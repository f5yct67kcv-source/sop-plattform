// Marke "Guard OpS" im Kundenportal und im Betreiber-Bereich.
//
// Drei Oberflaechen, drei verschiedene Rangfolgen -- das ist der eigentliche
// Pruefgegenstand, denn eine falsche Rangfolge sieht nie kaputt aus:
//
//   Cockpit          Die Software, in der ein BETRIEB arbeitet. Marke links
//                    in der Huelle, Betriebslogo rechts (test_marke_huelle).
//   Kundenportal     Hier kommt der KUNDE DES BETRIEBS herein. Im Vordergrund
//                    steht darum der Betrieb (Logo und Name im Empfang), die
//                    Software signiert nur: klein, unten, mit "powered by".
//                    Waechst die Signatur ueber das Betriebslogo hinaus,
//                    streiten zwei Marken um dieselbe Stelle -- und zwar vor
//                    dem Kunden eines Kunden.
//   Betreiber-Bereich  Gehoert dem BETREIBER der Plattform, nicht einem
//                    Betrieb. Kein "powered by": Hier signiert die Marke
//                    nichts, hier ist sie die Oberflaeche.
//
// Dazu die Fallen, die still brechen:
//
//   1. Die Zeichnung sitzt nicht in ihrem Kasten. <use> setzt ein <symbol>
//      bei (0,0) des AUFRUFENDEN Koordinatensystems ab; steht aussen die
//      viewBox des Symbols ("0 -120.22 ..."), rutscht die Zeichnung nach
//      unten und wird abgeschnitten -- bei unveraendertem Kasten und
//      unveraendertem Kontrast. Genau so ist es beim Bau passiert, und keine
//      Messung am Kasten hat es gesehen. Darum wird die TINTE gemessen.
//   2. Die drei Dateien laufen auseinander. Cockpit, Portal und
//      Betreiber-Bereich sind getrennte Dateien und fuehren die Zeichnung
//      je einzeln mit (der Deploy kopiert nur namentlich gelistete
//      Dateien). Eine spaetere Korrektur an einer Stelle ist sonst lautlos
//      eine zweite Marke. Das ist das Einzige hier, was sich nicht am
//      gerenderten Zustand pruefen laesst -- es wird an den Dateien selbst
//      geprueft.
//   3. Die Signatur steht nur in EINEM Zustand des Portals. Empfang (vor
//      der Anmeldung) und Arbeitskopf (danach) schliessen einander aus; die
//      Signatur liegt bewusst in der Fusszeile, die beiden gemeinsam ist.
//   4. Der Kopf des Betreiber-Bereichs waechst oder verliert die Mitte. Er
//      ist ein Raster 1fr auto 1fr; die Marke steht neu in der ersten
//      Spalte und kann sie zu breit machen.
//
// Gemessen wird am gerenderten Zustand (CLAUDE.md), in hellem und dunklem
// Schema.
import { chromium } from 'playwright';
import { WURZEL, browserPfad } from './pfade.mjs';
import { pathToFileURL } from 'url';
import { join } from 'path';
import { readFileSync } from 'fs';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

// ── Die Zeichnung selbst: EINE Quelle, drei Dateien ────────────────────
const symbol = (datei, id) => {
  const s = readFileSync(join(WURZEL, datei), 'utf8');
  const a = s.indexOf(`<symbol id="${id}"`);
  if (a < 0) { return null; }
  const b = s.indexOf('</symbol>', a);
  return s.slice(a, b);
};
const wortCockpit = symbol('dashboard.html', 'go-wort');
check('Das Cockpit fuehrt die Zeichnung als Symbol', !!wortCockpit && wortCockpit.length > 3000);
for (const datei of ['portal.html', 'betreiber.html']) {
  check(`KRITISCH: ${datei} traegt Zeichen fuer Zeichen dieselbe Zeichnung wie das Cockpit`,
    symbol(datei, 'go-wort') === wortCockpit);
}

const browser = await chromium.launch({ executablePath: browserPfad() });
const adresse = d => pathToFileURL(join(WURZEL, d)).href;

// Tinte, Kasten und Kontrast an EINER Stelle -- dieselbe Messung fuer alle
// drei Oberflaechen.
const MESSUNG = (svgSel, traegerSel) => {
  const svg = document.querySelector(svgSel);
  const traeger = document.querySelector(traegerSel);
  if (!svg || !traeger) { return null; }
  const bb = svg.getBBox(), mm = svg.getScreenCTM();
  const pt = (x, y) => { const q = svg.createSVGPoint(); q.x = x; q.y = y; return q.matrixTransform(mm); };
  const a = pt(bb.x, bb.y), b = pt(bb.x + bb.width, bb.y + bb.height);
  const k = svg.getBoundingClientRect();
  const lum = c => { const [r, g, bl] = c.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => v / 255)
      .map(v => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl; };
  let grund = 'rgba(0, 0, 0, 0)', e = traeger;
  while (e && (grund === 'transparent' || grund === 'rgba(0, 0, 0, 0)')) { grund = getComputedStyle(e).backgroundColor; e = e.parentElement; }
  const l1 = lum(getComputedStyle(traeger).color), l2 = lum(grund);
  return {
    gezeichnet: svg.getClientRects().length > 0 && k.width > 0 && k.height > 0,
    hoehe: k.height, breite: k.width,
    imKasten: a.x >= k.left - 1 && a.y >= k.top - 1 && b.x <= k.right + 1 && b.y <= k.bottom + 1,
    deckungB: (b.x - a.x) / k.width, deckungH: (b.y - a.y) / k.height,
    kontrast: (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05),
    name: svg.getAttribute('aria-label') || '',
    ausVorrat: !!svg.querySelector('use')
      && !!document.querySelector(svg.querySelector('use').getAttribute('href')),
    kasten: { l: k.left, r: k.right, o: k.top, u: k.bottom },
  };
};

async function seite(datei, breite, hoehe, schema) {
  const ctx = await browser.newContext({ viewport: { width: breite, height: hoehe }, colorScheme: schema });
  const p = await ctx.newPage();
  p.on('pageerror', e => bad.push(`JS-Fehler (${datei}): ` + e.message));
  await p.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ status: 'ok' }) }));
  await p.goto(adresse(datei));
  await p.waitForTimeout(350);
  return { ctx, p };
}

// ══════════ KUNDENPORTAL ══════════
for (const schema of ['light', 'dark']) {
  const { ctx, p } = await seite('portal.html', 1100, 900, schema);
  const m = await p.evaluate(({ fn, a, b }) => (new Function('return ' + fn))()(a, b),
    { fn: MESSUNG.toString(), a: '.hersteller .hs', b: '.hersteller' });

  check(`Portal (${schema}): die Signatur wird gezeichnet`, !!m && m.gezeichnet);
  if (m) {
    check(`Portal (${schema}): KRITISCH -- die Zeichnung liegt im Kasten`, m.imKasten);
    check(`Portal (${schema}): KRITISCH -- sie fuellt ihren Kasten`,
      m.deckungB >= 0.90 && m.deckungH >= 0.85);
    check(`Portal (${schema}): Mindestmass der Fassung ohne Claim (20 px)`, m.hoehe >= 20);
    check(`Portal (${schema}): sie kommt aus dem gemeinsamen Vorrat`, m.ausVorrat);
    check(`Portal (${schema}): vollstaendiger Name fuer Screenreader`, /guard\s*ops/i.test(m.name));
    // 4,5:1 und nicht 3:1: "powered by" ist Text in 11 px, und der
    // Portalgrund ist ein Verlauf -- ein Wert knapp ueber 3 haelt das nicht.
    check(`Portal (${schema}): lesbar auf dem Verlaufsgrund (>= 4,5:1)`, m.kontrast >= 4.5);
  }

  const rang = await p.evaluate(() => {
    const sig = document.querySelector('.hersteller .hs');
    const etikett = document.querySelector('.hersteller .hl');
    const betriebslogo = document.querySelector('.empfang img');
    const h = document.querySelector('.hersteller').getBoundingClientRect();
    return {
      etikettDa: !!etikett && etikett.textContent.trim().length > 0,
      etikettKleiner: !!etikett && parseFloat(getComputedStyle(etikett).fontSize) < sig.getBoundingClientRect().height,
      // Nicht bloss "kleiner", sondern deutlich kleiner. Das Betriebslogo
      // misst gerendert 132 px; eine Signatur mit 120 px waere formal
      // kleiner und stuende dem Betrieb trotzdem gleichrangig gegenueber.
      // Die Haelfte ist die Grenze -- derzeit sind es 18 Prozent.
      anteilAmBetriebslogo: sig.getBoundingClientRect().height / betriebslogo.getBoundingClientRect().height,
      mitteAbweichung: Math.abs((h.left + h.right) / 2 - innerWidth / 2),
      inEmpfang: !!sig.closest('#empfang'), inInhalt: !!sig.closest('#inhalt'),
    };
  });
  check(`Portal (${schema}): das Etikett "powered by" steht davor`, rang.etikettDa);
  check(`Portal (${schema}): das Etikett bleibt kleiner als das Logo`, rang.etikettKleiner);
  check(`Portal (${schema}): KRITISCH -- die Signatur bleibt deutlich kleiner als das `
      + `Betriebslogo (hoechstens die Haelfte, gemessen ${(rang.anteilAmBetriebslogo * 100).toFixed(0)} %)`,
    rang.anteilAmBetriebslogo <= 0.5);
  check(`Portal (${schema}): sie steht waagrecht in der Mitte`, rang.mitteAbweichung <= 1);
  check(`Portal (${schema}): sie liegt ausserhalb beider Zustaende`,
    !rang.inEmpfang && !rang.inInhalt);

  // Nach der Anmeldung: Empfang weg, Arbeitskopf da -- die Signatur bleibt.
  const nachher = await p.evaluate(() => {
    zeige('inhalt');
    const sig = document.querySelector('.hersteller .hs').getBoundingClientRect();
    return { empfangWeg: document.getElementById('empfang').hidden === true,
             kopfDa: document.getElementById('kopf').hidden === false,
             sigDa: sig.width > 0 && sig.height > 0 };
  });
  check(`Portal (${schema}): der Zustandswechsel greift ueberhaupt`,
    nachher.empfangWeg && nachher.kopfDa);
  check(`Portal (${schema}): nach der Anmeldung steht die Signatur weiter da`, nachher.sigDa);
  await ctx.close();
}

// ══════════ BETREIBER-BEREICH ══════════
for (const schema of ['light', 'dark']) {
  const { ctx, p } = await seite('betreiber.html', 1440, 900, schema);

  // Anmeldung
  const tor = await p.evaluate(({ fn, a, b }) => (new Function('return ' + fn))()(a, b),
    { fn: MESSUNG.toString(), a: '.tor-marke svg', b: '.tor-marke' });
  check(`Betreiber (${schema}): auf der Anmeldung steht die Marke`, !!tor && tor.gezeichnet);
  if (tor) {
    check(`Betreiber (${schema}): KRITISCH -- die Zeichnung liegt im Kasten (Anmeldung)`, tor.imKasten);
    check(`Betreiber (${schema}): sie fuellt ihren Kasten (Anmeldung)`,
      tor.deckungB >= 0.90 && tor.deckungH >= 0.85);
    check(`Betreiber (${schema}): lesbar (Anmeldung, >= 4,5:1)`, tor.kontrast >= 4.5);
    check(`Betreiber (${schema}): aus dem Vorrat, mit Namen (Anmeldung)`,
      tor.ausVorrat && /guard\s*ops/i.test(tor.name));
  }
  const ueberKarte = await p.evaluate(() => {
    const m = document.querySelector('.tor-marke').getBoundingClientRect();
    const k = document.querySelector('#tor .tor-karte').getBoundingClientRect();
    return { darueber: m.bottom <= k.top + 1,
             gleicheMitte: Math.abs((m.left + m.right) / 2 - (k.left + k.right) / 2) <= 1,
             // Hier signiert die Marke nicht -- sie IST der Bereich.
             keinEtikett: !/powered\s*by/i.test(document.querySelector('#tor').textContent) };
  });
  check(`Betreiber (${schema}): die Marke steht ueber der Anmeldekarte`, ueberKarte.darueber);
  check(`Betreiber (${schema}): Marke und Karte stehen auf derselben Mitte`, ueberKarte.gleicheMitte);
  check(`Betreiber (${schema}): kein "powered by" -- der Bereich gehoert dem Betreiber`,
    ueberKarte.keinEtikett);

  // Kopfzeile
  await p.evaluate(() => {
    document.getElementById('tor').classList.add('versteckt');
    document.getElementById('haus').classList.remove('versteckt');
    document.getElementById('kopf-wer').textContent = 'Testkonto · test@example.invalid';
  });
  await p.waitForTimeout(250);
  const kopf = await p.evaluate(({ fn, a, b }) => (new Function('return ' + fn))()(a, b),
    { fn: MESSUNG.toString(), a: '.kopf-marke', b: '.kopf-links' });
  check(`Betreiber (${schema}): in der Kopfzeile steht die Marke`, !!kopf && kopf.gezeichnet);
  if (kopf) {
    check(`Betreiber (${schema}): KRITISCH -- die Zeichnung liegt im Kasten (Kopf)`, kopf.imKasten);
    check(`Betreiber (${schema}): sie fuellt ihren Kasten (Kopf)`,
      kopf.deckungB >= 0.90 && kopf.deckungH >= 0.85);
    check(`Betreiber (${schema}): Mindestmass 20 px (Kopf)`, kopf.hoehe >= 20);
    check(`Betreiber (${schema}): lesbar auf dem Huellengrund (Kopf, >= 4,5:1)`, kopf.kontrast >= 4.5);
  }
  await ctx.close();
}

// Der Kopf darf ueber die Breiten hinweg nicht ueberlaufen und die
// Navigation nicht aus der Fenstermitte schieben. Genau daran ist die
// Anordnung "Marke NEBEN dem Bereichsnamen" gescheitert.
{
  const { ctx, p } = await seite('betreiber.html', 1440, 900, 'light');
  await p.evaluate(() => {
    document.getElementById('tor').classList.add('versteckt');
    document.getElementById('haus').classList.remove('versteckt');
    document.getElementById('kopf-wer').textContent = 'Testkonto · test@example.invalid';
  });
  for (const b of [1440, 1280, 1100, 1010]) {
    await p.setViewportSize({ width: b, height: 900 });
    await p.waitForTimeout(200);
    const m = await p.evaluate(() => {
      const k = document.querySelector('.kopf');
      const nav = document.getElementById('kopf-nav').getBoundingClientRect();
      const marke = document.querySelector('.kopf-marke').getBoundingClientRect();
      return { ueberlauf: k.scrollWidth - k.clientWidth,
               navVersatz: Math.abs((nav.left + nav.right) / 2 - innerWidth / 2),
               dreiSpalten: getComputedStyle(k).gridTemplateColumns.split(' ').length === 3,
               markeDa: marke.width > 0 && marke.height > 0 };
    });
    check(`Betreiber: bei ${b} px laeuft der Kopf nicht ueber`, m.ueberlauf <= 0);
    check(`Betreiber: bei ${b} px steht die Marke da`, m.markeDa);
    if (m.dreiSpalten) {
      check(`Betreiber: bei ${b} px bleibt die Navigation in der Fenstermitte`, m.navVersatz <= 1);
    }
  }
  await ctx.close();
}

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden`);
if (bad.length) { bad.forEach(n => console.log('  ✗ ' + n)); process.exit(1); }
console.log('\nAlle Pruefungen bestanden.');
