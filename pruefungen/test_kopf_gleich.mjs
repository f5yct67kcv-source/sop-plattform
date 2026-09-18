// Kopfleiste und Werkzeugleiste des Betreiber-Bereichs sehen aus wie im
// Cockpit -- GEMESSEN an beiden gerenderten Seiten, nicht im Quelltext
// nachgelesen (ENT-611).
//
// WOZU DIESE SUITE: Der Projektinhaber hat, mit je einem Bildschirmfoto
// beider Seiten nebeneinander, verlangt, dass dieser Bereich dieselbe
// Oberflaeche traegt wie das Cockpit. Vorher stand links ein dreizeiliger
// Block (Schriftzug, Bereichsname, Kontozeile), rechts vier Bedienelemente
// nebeneinander, und die Unterreiter erst darunter im Inhalt. Jedes Stueck
// fuer sich war vertretbar -- zusammen war es sichtbar eine andere Leiste.
//
// Verglichen wird darum der GERENDERTE Zustand beider Dateien gegeneinander.
// Das haelt auch die andere Richtung fest: Aendert das Cockpit seine Leiste
// und diese Seite zieht nicht mit, wird es hier rot. Eine Pruefung auf feste
// Zahlen koennte das nicht -- sie waere am Tag der Aenderung im Cockpit
// gruen und falsch.
//
// Das Cockpit wird dafuer in seinen dritten Huellenzustand gestellt
// ("aus", ENT-086): Dort ist die Seitenleiste zur Kopfleiste geworden, und
// genau diese Fassung ist das Vorbild.
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

// Was verglichen wird -- und zwar je Baustein nur das, was an ihm
// tatsaechlich zu sehen ist. Eine Schriftgroesse an einem Schalter ohne
// Text ist kein Gestaltungsunterschied, sondern Rauschen; sie liesse die
// Suite rot leuchten, ohne dass ein Mensch etwas anderes saehe. Umgekehrt
// zaehlt die Zeilenhoehe an einer Beschriftung sehr wohl.
//
// Die Hoehe steht NEBEN der Merkmalskette, damit sie mit einem Pixel
// Spielraum verglichen werden kann: Ein Kasten von 69,5 px misst je nach
// Lage 69 oder 70, ohne dass etwas anders aussieht.
const GRUPPEN = {
  // Flaechen: Grund, Polster, Kanten, Unschaerfe. Die Spaltenbreiten des
  // Rasters stehen NICHT darin -- sie haengen am Inhalt (ein laengerer
  // Titel, ein Reiter mehr), nicht an der Gestaltung. Dass es drei Spalten
  // sind und die mittlere in der Fenstermitte sitzt, wird weiter unten
  // eigens geprueft.
  flaeche: ['backgroundColor', 'padding', 'display', 'flexDirection', 'alignItems',
            'justifyContent', 'gap', 'backdropFilter', 'boxShadow', 'borderRadius'],
  // Text: alles, was das Schriftbild ausmacht, plus die Flaeche darunter.
  text: ['fontSize', 'fontWeight', 'letterSpacing', 'lineHeight', 'color',
         'backgroundColor', 'padding', 'borderRadius', 'textTransform'],
  // Navigationskachel: Sinnbild ueber Beschriftung, darum zaehlt auch die
  // Flussrichtung.
  kachel: ['backgroundColor', 'borderRadius', 'padding', 'minWidth',
           'flexDirection', 'alignItems', 'justifyContent', 'gap'],
  // Griffe: Markenknopf und die beiden Schalter. Sie tragen keinen Text und
  // genau ein Kind; was man sieht, sind Grund, Kante, Form, Polster -- und
  // die Groesse, die weiter unten mit h und b verglichen wird. Sie war der
  // eigentliche Befund: Die 44-px-Regel dieser Seite machte aus einem
  // 30-px-Schalter einen 44-px-Schalter.
  griff: ['backgroundColor', 'borderRadius', 'padding'],
  // Zeichnungen: Form, Grund, Strich. Keine Schrift.
  bild: ['borderRadius', 'padding', 'backgroundColor', 'objectFit', 'stroke', 'strokeWidth'],
};

const ABZUG = (wahlen) => {
  const aus = {};
  for (const [name, [wahl, gruppe]] of Object.entries(wahlen)) {
    const el = document.querySelector(wahl);
    if (!el) { aus[name] = null; continue; }
    const c = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    /* Eine Kante zaehlt nur da, wo sie gezeichnet wird. Ohne diese Weiche
       verglichen sich Breite und Farbe von Seiten mit border-width: 0 --
       Werte, die kein Mensch je zu Gesicht bekommt, und die hier aus der
       geerbten Textfarbe stammen und darum zwischen den beiden Seiten
       ohnehin abweichen. */
    const kante = ['Top', 'Right', 'Bottom', 'Left']
      .map(seite => (parseFloat(c['border' + seite + 'Width']) > 0
        && c['border' + seite + 'Style'] !== 'none')
        ? `${seite}: ${c['border' + seite + 'Width']} ${c['border' + seite + 'Style']} ${c['border' + seite + 'Color']}`
        : null)
      .filter(Boolean).join(', ') || 'ohne Kante';
    aus[name] = { s: gruppe.map(k => c[k]).join(' | ') + ' | ' + kante, h: r.height, b: r.width };
  }
  return aus;
};

const browser = await chromium.launch({ executablePath: browserPfad() });

async function seiteOeffnen(breite, thema, glas) {
  const seite = await browser.newPage({ viewport: { width: breite, height: 1000 } });
  await seite.addInitScript(([t, g]) => {
    try { localStorage.setItem('rv3_thema', t); localStorage.setItem('rv3_glas', g); } catch (e) { /* egal */ }
  }, [thema, glas]);
  await seite.route('**/api/**', route => {
    const url = route.request().url();
    const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (url.includes('login.php')) { return send({ status: 'ok', token: 't', name: 'pruef', ist_admin: true }); }
    if (url.includes('me.php')) {
      return send({ status: 'ok', name: 'pruef', ist_admin: true, rollen: [],
        rechte: ['kunden_lesen', 'kunden_schreiben', 'offerten_lesen', 'offerten_schreiben',
                 'leistungen_lesen', 'leistungen_schreiben', 'betrieb_lesen'] });
    }
    if (url.includes('kunden_list')) { return send({ status: 'ok', eingerichtet: true, kunden: [] }); }
    if (url.includes('beleg_list') || url.includes('produkt_list')) {
      return send({ status: 'ok', eingerichtet: true, belege: [], produkte: [] });
    }
    if (url.includes('dashboard_stats')) {
      return send({ status: 'ok', kpi: { rapporte_monat: 0, rapporte_vormonat: 0, stunden_monat: 0,
        stunden_vormonat: 0, mitarbeiter: 0, kunden: 0, rapporte_total: 0 },
        verlauf: [], angemeldet: [], letzte_rapporte: [], ereignisse: [],
        ereignisse_unvollstaendig: [], pro_mitarbeiter: [] });
    }
    return send({ status: 'ok' });
  });
  return seite;
}

// Die Bausteine, die es auf beiden Seiten gibt. Links der Name, rechts der
// Weg dorthin -- die Klassennamen sind absichtlich NICHT ueberall dieselben
// (.kopf gegen .side), weil die beiden Seiten verschiedene Geschichten
// haben; dieselbe ROLLE haben sie trotzdem.
const G = GRUPPEN;
const CO_WAHL = {
  'Kopfleiste':          ['.shell.aus .side', G.flaeche],
  'Schriftzug':          ['.marke-hersteller .mh-voll', G.bild],
  'Navigationskachel':   ['.side-nav .nav-item', G.kachel],
  'Kachelbeschriftung':  ['.side-nav .nav-item .lbl', G.text],
  'Kachelsinnbild':      ['.side-nav .nav-item svg.i', G.bild],
  'Markenknopf':         ['.marken-knopf', G.griff],
  'Markenbild':          ['.marken-knopf img', G.bild],
  'Werkzeugleiste':      ['.topbar', G.flaeche],
  'Titel':               ['.topbar h1', G.text],
  'Unterzeile':          ['.topbar .crumb', G.text],
  'Unterreiter':         ['.top-sub', G.flaeche],
  'Unterreiterknopf':    ['.top-sub button:not(.on)', G.text],
  'Offener Unterreiter': ['.top-sub button.on', G.text],
  'Glas-Schalter':       ['#btnGlas', G.griff],
  'Thema-Schalter':      ['#btnThema', G.griff],
  'Schalterkopf':        ['#btnThema .knopf', G.bild],
};
const BE_WAHL = {
  'Kopfleiste':          ['.kopf', G.flaeche],
  'Schriftzug':          ['.kopf-marke', G.bild],
  'Navigationskachel':   ['.kopf-nav .nav-item', G.kachel],
  'Kachelbeschriftung':  ['.kopf-nav .nav-item .lbl', G.text],
  'Kachelsinnbild':      ['.kopf-nav .nav-item svg', G.bild],
  'Markenknopf':         ['.marken-knopf', G.griff],
  'Markenbild':          ['.marken-knopf img', G.bild],
  'Werkzeugleiste':      ['.leiste', G.flaeche],
  'Titel':               ['.leiste h1', G.text],
  'Unterzeile':          ['.leiste .crumb', G.text],
  'Unterreiter':         ['.top-sub', G.flaeche],
  'Unterreiterknopf':    ['.top-sub button:not(.on)', G.text],
  'Offener Unterreiter': ['.top-sub button.on', G.text],
  'Glas-Schalter':       ['#btn-glas', G.griff],
  'Thema-Schalter':      ['#btn-thema', G.griff],
  'Schalterkopf':        ['#btn-thema .knopf', G.bild],
};

async function cockpit(breite, thema, glas) {
  const seite = await seiteOeffnen(breite, thema, glas);
  const fehler = [];
  seite.on('pageerror', e => fehler.push(e.message));
  await seite.goto(`file://${WURZEL}/dashboard.html`);
  await seite.fill('#gName', 'pruef'); await seite.fill('#gPass', 'x'); await seite.click('#gBtn');
  await seite.waitForSelector('#shell.on');
  // Der dritte Huellenzustand: Seitenleiste als Kopfleiste (ENT-086). Und
  // ein Bereich MIT Unterkategorien, sonst bliebe die mittlere Spalte leer.
  await seite.evaluate(() => { huelleSetzen('aus'); go('kunden'); });
  await seite.waitForTimeout(350);
  const m = await seite.evaluate(ABZUG, CO_WAHL);
  await seite.close();
  return { m, fehler };
}

async function betreiber(breite, thema, glas) {
  const seite = await seiteOeffnen(breite, thema, glas);
  const fehler = [];
  seite.on('pageerror', e => fehler.push(e.message));
  await seite.goto(`file://${WURZEL}/betreiber.html`);
  await seite.evaluate(() => {
    document.getElementById('tor').classList.add('versteckt');
    document.getElementById('haus').classList.remove('versteckt');
    document.getElementById('kopf-wer').textContent = 'pruef · pruef@example.invalid';
    offertenBereit = true;
    // Derselbe Fall wie oben: ein Bereich mit Unterreitern.
    bereichZeigen('offerten');
  });
  await seite.waitForTimeout(350);
  const m = await seite.evaluate(ABZUG, BE_WAHL);
  await seite.close();
  return { m, fehler };
}

const wieText = m => `${m.s} | ${m.h.toFixed(1)}h`;
const passt = (a, b) => a.s === b.s && Math.abs(a.h - b.h) <= 1;

function vergleichen(wie, co, be) {
  check(`${wie}: beide Seiten zeigen ihre Leisten ohne JS-Fehler`,
    co.fehler.length === 0 && be.fehler.length === 0);
  if (co.fehler.length) { bad.push('Cockpit: ' + co.fehler[0]); }
  if (be.fehler.length) { bad.push('Betreiber: ' + be.fehler[0]); }

  // Erst: Gibt es den Baustein ueberhaupt auf beiden Seiten? Ein fehlendes
  // Stueck ist keine Gestaltungsfrage mehr.
  const fehlt = Object.keys(CO_WAHL).filter(k => !co.m[k] || !be.m[k]);
  check(`KRITISCH ${wie}: jeder Baustein der Leisten steht auf beiden Seiten`,
    fehlt.length === 0);
  if (fehlt.length) {
    fehlt.forEach(k => bad.push(`${wie}: "${k}" fehlt `
      + (!co.m[k] ? 'im Cockpit (' + CO_WAHL[k][0] + ')' : 'im Betreiber-Bereich (' + BE_WAHL[k][0] + ')')));
    return;
  }

  const anders = Object.keys(CO_WAHL).filter(k => !passt(co.m[k], be.m[k]));
  check(`KRITISCH ${wie}: jeder Baustein ist gleich gestaltet (${Object.keys(CO_WAHL).length} verglichen)`,
    anders.length === 0);
  anders.forEach(k => bad.push(`${wie}: ${k}\n      Cockpit:   ${wieText(co.m[k])}`
    + `\n      Betreiber: ${wieText(be.m[k])}`));

  // Die Breite gesondert, und nur dort, wo sie etwas aussagt: Schriftzug
  // und Markenbild sind Bilder mit festem Seitenverhaeltnis, die Kacheln
  // tragen verschieden lange Woerter.
  ['Schriftzug', 'Markenbild', 'Glas-Schalter', 'Thema-Schalter'].forEach(k => {
    check(`KRITISCH ${wie}: ${k} ist gleich breit`,
      Math.abs(co.m[k].b - be.m[k].b) <= 1);
    if (Math.abs(co.m[k].b - be.m[k].b) > 1) {
      bad.push(`${wie}: ${k} Breite  Cockpit ${co.m[k].b.toFixed(1)}  Betreiber ${be.m[k].b.toFixed(1)}`);
    }
  });
}

// Drei Fassungen. Der dunkle Fall mit Glas ist der haeufigste Anblick, der
// helle ohne Glas die deckende Gegenprobe -- die Werkzeugleiste traegt in
// beiden Fassungen einen anderen Grund, und genau dort liefen die beiden
// Seiten schon einmal auseinander.
const FAELLE = [
  ['Desktop, dunkel, Glas an', 1500, 'dunkel', 'an'],
  ['Desktop, hell, Glas an', 1500, 'hell', 'an'],
  ['Desktop, hell, Glas aus', 1500, 'hell', 'aus'],
];

for (const [wie, breite, thema, glas] of FAELLE) {
  const co = await cockpit(breite, thema, glas);
  const be = await betreiber(breite, thema, glas);
  vergleichen(wie, co, be);
}

// ── Mittiges steht in der Mitte des FENSTERS ──────────────────────────
//
// Beide Leisten sind ein Raster 1fr auto 1fr, und das ist kein Geschmack:
// Mit einem Abstandhalter saessen Navigation und Unterreiter in der Mitte
// des Rests zwischen zwei ungleich langen Seiten, und die Mitte spraenge
// bei jedem Bereichswechsel mit der Titellaenge. Genau daran ist der Kopf
// dieser Seite schon einmal gescheitert (ENT-607).
{
  const seite = await seiteOeffnen(1500, 'hell', 'an');
  await seite.goto(`file://${WURZEL}/betreiber.html`);
  await seite.evaluate(() => {
    document.getElementById('tor').classList.add('versteckt');
    document.getElementById('haus').classList.remove('versteckt');
    document.getElementById('kopf-wer').textContent = 'pruef · pruef@example.invalid';
    offertenBereit = true;
    bereichZeigen('offerten');
  });
  await seite.waitForTimeout(250);
  const m = await seite.evaluate(() => {
    const mitte = el => { const r = el.getBoundingClientRect(); return (r.left + r.right) / 2; };
    return {
      spaltenKopf: getComputedStyle(document.querySelector('.kopf')).gridTemplateColumns.split(' ').length,
      spaltenLeiste: getComputedStyle(document.querySelector('.leiste')).gridTemplateColumns.split(' ').length,
      navVersatz: Math.abs(mitte(document.getElementById('kopf-nav')) - innerWidth / 2),
      subVersatz: Math.abs(mitte(document.getElementById('topSub')) - innerWidth / 2),
      // Beide Leisten bleiben beim Scrollen stehen -- sonst waere die
      // Navigation nach dem ersten Radumdrehen weg.
      kopfOben: document.querySelector('.kopf').getBoundingClientRect().top,
      leisteOben: document.querySelector('.leiste').getBoundingClientRect().top,
    };
  });
  check('KRITISCH: beide Leisten sind ein Raster mit drei Spalten',
    m.spaltenKopf === 3 && m.spaltenLeiste === 3);
  check('KRITISCH: die Navigation steht in der Mitte des Fensters', m.navVersatz <= 1);
  check('KRITISCH: die Unterreiter stehen in der Mitte des Fensters', m.subVersatz <= 1);
  check('am Anfang stehen beide Leisten am oberen Rand',
    Math.abs(m.kopfOben) <= 1 && Math.abs(m.leisteOben - 70) <= 1);

  // Und nach dem Scrollen stehen sie immer noch da.
  await seite.evaluate(() => window.scrollTo(0, 600));
  await seite.waitForTimeout(150);
  const n = await seite.evaluate(() => ({
    kopfOben: document.querySelector('.kopf').getBoundingClientRect().top,
    leisteOben: document.querySelector('.leiste').getBoundingClientRect().top,
  }));
  check('KRITISCH: die Kopfleiste bleibt beim Scrollen stehen', Math.abs(n.kopfOben) <= 1);
  check('KRITISCH: die Werkzeugleiste klebt darunter, nicht darueber',
    Math.abs(n.leisteOben - 70) <= 1);
  await seite.close();
}

// ── Die Unterreiter tragen wirklich, was unten steht ──────────────────
//
// Sie werden aus den Originalen erzeugt. Eine zweite, fest geschriebene
// Liste waere am Tag der ersten Umbenennung falsch -- und zwar lautlos.
{
  const seite = await seiteOeffnen(1500, 'hell', 'an');
  await seite.goto(`file://${WURZEL}/betreiber.html`);
  await seite.evaluate(() => {
    document.getElementById('tor').classList.add('versteckt');
    document.getElementById('haus').classList.remove('versteckt');
    offertenBereit = true;
    bereichZeigen('offerten');
  });
  await seite.waitForTimeout(250);
  const m = await seite.evaluate(() => ({
    oben: [...document.querySelectorAll('#topSub button')].map(b => b.textContent.trim()),
    unten: [...document.querySelectorAll('#ofHauptTabs .tab')].map(b => b.textContent.trim()),
    originalVerborgen: document.getElementById('ofHauptTabs').classList.contains('versteckt'),
    obenAktiv: [...document.querySelectorAll('#topSub button')].map(b => b.classList.contains('on')),
    untenAktiv: [...document.querySelectorAll('#ofHauptTabs .tab')].map(b => b.classList.contains('on')),
  }));
  check('KRITISCH Unterreiter: oben steht genau, was unten steht',
    m.oben.length >= 3 && JSON.stringify(m.oben) === JSON.stringify(m.unten));
  if (JSON.stringify(m.oben) !== JSON.stringify(m.unten)) {
    bad.push('oben ' + JSON.stringify(m.oben) + '\n      unten ' + JSON.stringify(m.unten));
  }
  check('KRITISCH Unterreiter: dieselbe Auswahl steht nicht zweimal im Bild',
    m.originalVerborgen);
  check('Unterreiter: der offene Reiter ist oben derselbe wie unten',
    JSON.stringify(m.obenAktiv) === JSON.stringify(m.untenAktiv));

  // Ein Klick oben muss unten ankommen -- sonst ist die Leiste Zierde.
  // Ohne Absturz, wenn der Reiter oben gar nicht steht: Das ist ein Befund
  // und soll als solcher dastehen, nicht als Stapelabzug.
  const n = await seite.evaluate(() => {
    const finde = () => [...document.querySelectorAll('#topSub button')]
      .find(b => b.textContent.trim() === 'Briefkopf');
    if (!finde()) { return { da: false }; }
    finde().click();
    return {
      da: true,
      ansicht: !document.getElementById('ofv-briefkopf').classList.contains('versteckt'),
      obenMarkiert: finde().classList.contains('on'),
    };
  });
  check('Unterreiter: der Reiter "Briefkopf" steht oben ueberhaupt da', n.da);
  await seite.waitForTimeout(150);
  check('KRITISCH Unterreiter: ein Klick oben schaltet die Ansicht unten um', !!n.ansicht);
  check('Unterreiter: und der geklickte Reiter ist danach markiert', !!n.obenMarkiert);

  // Unter 1210 px faellt die Navigation in eine zweite Zeile. Dann muessen
  // die Reiter wieder im Inhalt stehen -- sonst waeren sie unerreichbar.
  await seite.setViewportSize({ width: 1100, height: 1000 });
  await seite.evaluate(() => unterreiterZeichnen());
  await seite.waitForTimeout(200);
  const s = await seite.evaluate(() => ({
    obenSichtbar: document.getElementById('topSub').offsetParent !== null
      && document.querySelectorAll('#topSub button').length > 0,
    untenSichtbar: document.getElementById('ofHauptTabs').offsetParent !== null,
    querlauf: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  check('KRITISCH Unterreiter: schmaler als 1210 px stehen sie wieder im Inhalt',
    !s.obenSichtbar && s.untenSichtbar);
  check('und die Seite scrollt dabei nicht quer', s.querlauf <= 0);
  await seite.close();
}

await browser.close();

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden`);
if (bad.length) {
  console.log('\n' + bad.map(b => '  ✗ ' + b).join('\n'));
  process.exit(1);
}
console.log('\nAlle Pruefungen bestanden.');
