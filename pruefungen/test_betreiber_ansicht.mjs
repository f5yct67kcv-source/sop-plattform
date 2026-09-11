// Gestaltung des Betreiber-Bereichs, GEMESSEN am gerenderten Zustand
// (ENT-519 bis ENT-521).
//
// WARUM GEMESSEN UND NICHT GELESEN: Eine CSS-Regel kann wirkungslos bleiben,
// ohne dass etwas kaputtgeht -- durch eine spaetere Regel gleicher oder
// hoeherer Eigenspezifitaet. Wer eine Gestaltungsaenderung nicht misst,
// weiss nicht, ob sie greift (CLAUDE.md). Genau daran ist im Cockpit schon
// mehr als einmal etwas unbemerkt vorbeigelaufen.
//
// Gemessen wird auf BEIDEN Breiten: Jede Aenderung am Handy-Layout wird
// zusaetzlich am Desktop geprueft, und umgekehrt.
import { chromium } from 'playwright';
import { WURZEL, browserPfad } from './pfade.mjs';
import { pathToFileURL } from 'url';
import { join } from 'path';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const browser = await chromium.launch({ executablePath: browserPfad() });
const ADRESSE = pathToFileURL(join(WURZEL, 'betreiber.html')).href;

// Testdaten in die drei Ansichten schreiben. Gemessen wird das LAYOUT --
// die Anmeldung braucht es dafuer nicht, und ein Server erst recht nicht.
const AUFBAU = () => {
  document.getElementById('tor').classList.add('versteckt');
  document.getElementById('haus').classList.remove('versteckt');
  document.getElementById('m-form-karte').classList.remove('versteckt');
  document.getElementById('kopf-wer').textContent = 'Testkonto · test@example.invalid';
  document.getElementById('kopf-mitte').textContent = 'Sitzung endet nach 30 Minuten ohne Nutzung';
  document.getElementById('m-zahlen').innerHTML =
    ['Mandanten', 'Aktiv', 'GAV offen', 'Verbindung unvollständig'].map((l, i) =>
      `<div class="zahl"><div class="lab">${l}</div><div class="wert${i === 3 ? ' leer' : ''}">${[3, 2, 1, 0][i]}</div>`
      + (i === 1 ? '<div class="bezug">2 von 3</div>' : '') + '</div>').join('');
  document.getElementById('m-inhalt').innerHTML =
    '<div class="tab-huelle"><table><thead><tr><th>Mandant</th><th>Status</th><th>GAV</th>'
    + '<th>Verbindung</th><th></th></tr></thead><tbody><tr>'
    + '<td><strong>Betrieb A</strong><div class="zweit">Kanton BE</div></td>'
    + '<td><span class="merker m-pos">aktiv</span></td>'
    + '<td><span class="merker m-warn">nicht bestätigt</span></td>'
    + '<td><span class="merker m-ruhe">Standardverbindung</span></td>'
    + '<td style="text-align:right;white-space:nowrap"><button class="klein">Ändern</button> '
    + '<button class="klein">GAV</button></td></tr></tbody></table></div>';
};

const MESSEN = () => {
  const R = el => el.getBoundingClientRect();
  const sichtbar = el => el.offsetParent !== null;
  const knoepfe = [...document.querySelectorAll('button')].filter(sichtbar)
    .map(k => ({ t: k.textContent.trim().slice(0, 20), h: R(k).height,
                 klein: k.classList.contains('klein') }));
  const felder = [...document.querySelectorAll('input')]
    .filter(f => sichtbar(f) && f.type !== 'hidden')
    .map(f => ({ id: f.id, s: parseFloat(getComputedStyle(f).fontSize), h: R(f).height }));
  const zahlen = [...document.querySelectorAll('.zahl')].map(z => ({
    labOben: R(z.querySelector('.lab')).top < R(z.querySelector('.wert')).top,
    paar: parseFloat(getComputedStyle(z.querySelector('.lab')).fontSize) + '/'
        + parseFloat(getComputedStyle(z.querySelector('.wert')).fontSize),
  }));
  const kopf = document.querySelector('.kopf');
  const mitte = document.getElementById('kopf-mitte');
  const kr = R(kopf), mr = R(mitte);
  return {
    knoepfe, felder, zahlen,
    mitteVersatz: sichtbar(mitte) ? ((mr.left + mr.right) / 2) - ((kr.left + kr.right) / 2) : null,
    querScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    polster: parseFloat(getComputedStyle(document.querySelector('.huelle')).paddingLeft),
    inhaltLinks: R(document.querySelector('.huelle .karte')).left,
  };
};

for (const [wie, breite, hoehe] of [['Desktop', 1500, 900], ['Handy', 390, 844]]) {
  const seite = await browser.newPage({ viewport: { width: breite, height: hoehe } });
  await seite.goto(ADRESSE);
  await seite.evaluate(AUFBAU);
  await seite.waitForTimeout(100);
  const m = await seite.evaluate(MESSEN);

  check(`${wie}: es wurde ueberhaupt etwas gemessen`,
    m.knoepfe.length > 0 && m.felder.length > 0 && m.zahlen.length > 0);

  // Bedienelemente mindestens 44 px. Die bewusst kleinen (.klein) tragen
  // keine Haupthandlung und duerfen 36 px haben -- darunter aber nicht.
  const flach = m.knoepfe.filter(k => !k.klein && k.h < 44);
  check(`KRITISCH ${wie}: jeder Knopf ist mindestens 44px hoch`, flach.length === 0);
  if (flach.length) { bad.push(`${wie}: ` + flach.map(k => `"${k.t}" ${k.h.toFixed(1)}px`).join(', ')); }
  check(`${wie}: auch die kleinen Knoepfe bleiben ueber 36px`,
    m.knoepfe.filter(k => k.klein && k.h < 36).length === 0);

  // Unter 16 px zoomt iOS in ein Eingabefeld hinein und bleibt dort.
  const kleineSchrift = m.felder.filter(f => f.s < 16);
  check(`KRITISCH ${wie}: jedes Eingabefeld hat mindestens 16px Schrift`, kleineSchrift.length === 0);
  if (kleineSchrift.length) { bad.push(`${wie}: ` + kleineSchrift.map(f => `#${f.id} ${f.s}px`).join(', ')); }
  check(`${wie}: jedes Eingabefeld ist mindestens 44px hoch`,
    m.felder.filter(f => f.h < 44).length === 0);

  // Ueberschrift oben, Wert darunter -- nie umgekehrt.
  check(`KRITISCH ${wie}: die Beschriftung steht ueber dem Wert`,
    m.zahlen.every(z => z.labOben));
  // Gleiches Muster auf beiden Seiten: alle Kennzahlen derselbe Aufbau.
  check(`KRITISCH ${wie}: alle Kennzahlen folgen demselben Schriftmuster`,
    new Set(m.zahlen.map(z => z.paar)).size === 1);

  // Mittiges gehoert in die Mitte des CONTAINERS, nicht zwischen zwei
  // ungleich lange Texte. Das ist der Unterschied zwischen 1fr auto 1fr
  // und einem Flex-Abstandhalter -- und er faellt nur beim Messen auf.
  if (m.mitteVersatz !== null) {
    check(`KRITISCH ${wie}: die Kopfmitte sitzt in der Container-Mitte`,
      Math.abs(m.mitteVersatz) <= 1);
    if (Math.abs(m.mitteVersatz) > 1) { bad.push(`${wie}: Versatz ${m.mitteVersatz.toFixed(1)}px`); }
  }

  check(`KRITISCH ${wie}: die Seite scrollt nicht quer`, m.querScroll === 0);
  if (m.querScroll > 0) { bad.push(`${wie}: ${m.querScroll}px Querscroll`); }
  // Gemessen wird beides: dass das Polster gesetzt IST und dass es WIRKT.
  check(`${wie}: mindestens 16px Seitenpolster`, m.polster >= 16);
  check(`${wie}: der Inhalt beginnt auch tatsaechlich dahinter`, m.inhaltLinks >= 16);

  await seite.close();
}

// ── Dieselbe Gestaltung wie das Cockpit, in BEIDEN Themen ────────────
//
// Der Anlass: Das Cockpit stand beim Projektinhaber auf dunkel, der
// Betreiber-Bereich ging hell auf. Beanstandung im Wortlaut: "halte dich
// bitte an ein einheitlich design". Zwei Seiten desselben Betriebs sahen
// aus wie zwei Hersteller.
//
// Verglichen wird der GEMESSENE Zustand beider Seiten, nicht der Quelltext.
// Eine Pruefung, die nachsaehe, ob eine Farbe im CSS steht, bliebe gruen,
// wenn eine spaetere Regel sie ueberschreibt -- und vor allem auch dann,
// wenn das Cockpit seine Palette aendert und diese Seite nicht mitzieht.
// Genau dieser zweite Fall ist der wahrscheinlichere.
//
// Aufgezaehlt wird, was betreiber.html selbst setzt: Kommt dort ein Wert
// dazu, ist er von selbst mitgeprueft, sobald das Cockpit ihn auch kennt.
{
  const COCKPIT = pathToFileURL(join(WURZEL, 'dashboard.html')).href;

  const WERTE = () => {
    const cs = getComputedStyle(document.documentElement);
    const werte = {};
    for (const name of Array.from(cs)) {
      if (name.startsWith('--')) { werte[name] = cs.getPropertyValue(name).trim(); }
    }
    const kb = getComputedStyle(document.body);
    return { thema: document.documentElement.getAttribute('data-thema'),
             werte, bodyBg: kb.backgroundColor, bodyInk: kb.color };
  };

  async function laden(adresse, thema) {
    const seite = await browser.newPage({ viewport: { width: 1500, height: 900 } });
    await seite.addInitScript(t => {
      try { localStorage.setItem('rv3_thema', t); } catch (e) { /* egal */ }
    }, thema);
    await seite.goto(adresse);
    await seite.waitForTimeout(80);
    const m = await seite.evaluate(WERTE);
    await seite.close();
    return m;
  }

  for (const thema of ['hell', 'dunkel']) {
    const be = await laden(ADRESSE, thema);
    const co = await laden(COCKPIT, thema);

    check(`KRITISCH ${thema}: der Betreiber-Bereich uebernimmt die Wahl aus dem Cockpit`,
      be.thema === thema);

    // Der eigentliche Punkt: nicht "es ist dunkel", sondern "es ist
    // DASSELBE dunkel". Ein eigener, aehnlicher Farbsatz waere genau der
    // Fehler, um den es geht.
    const gemeinsam = Object.keys(be.werte).filter(n => co.werte[n] !== undefined && co.werte[n] !== '');
    const anders = gemeinsam.filter(n => be.werte[n] !== co.werte[n]);
    check(`KRITISCH ${thema}: jeder Farbwert stimmt mit dem Cockpit ueberein (${gemeinsam.length} verglichen)`,
      gemeinsam.length >= 15 && anders.length === 0);
    if (anders.length) {
      bad.push(thema + ': ' + anders.slice(0, 6)
        .map(n => `${n} ${be.werte[n]} statt ${co.werte[n]}`).join(', '));
    }

    // Und dass die Werte auch ankommen: Ein richtiger Wert in einer
    // Regel, die nichts einfaerbt, waere unsichtbar richtig.
    check(`KRITISCH ${thema}: die Flaeche der Seite ist auch wirklich eingefaerbt`,
      be.bodyBg === co.bodyBg && be.bodyInk === co.bodyInk);
  }

  // Der Umschalter: dass er da ist, gross genug, und dass er wirkt.
  {
    const seite = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await seite.addInitScript(() => {
      try { localStorage.setItem('rv3_thema', 'hell'); } catch (e) { /* egal */ }
    });
    await seite.goto(ADRESSE);
    await seite.evaluate(AUFBAU);
    await seite.waitForTimeout(80);
    const vorher = await seite.evaluate(() => ({
      thema: document.documentElement.getAttribute('data-thema'),
      hoehe: document.getElementById('btn-thema').getBoundingClientRect().height,
      gemerkt: localStorage.getItem('rv3_thema'),
    }));
    await seite.click('#btn-thema');
    await seite.waitForTimeout(120);
    const nachher = await seite.evaluate(() => ({
      thema: document.documentElement.getAttribute('data-thema'),
      gemerkt: localStorage.getItem('rv3_thema'),
      bodyBg: getComputedStyle(document.body).backgroundColor,
      gedrueckt: document.getElementById('btn-thema').getAttribute('aria-checked'),
    }));
    await seite.close();

    check('KRITISCH Handy: der Umschalter ist mindestens 44px hoch', vorher.hoehe >= 44);
    check('Der Umschalter wechselt das Thema', vorher.thema === 'hell' && nachher.thema === 'dunkel');
    check('KRITISCH: die Wahl wird fuer das Cockpit mitgespeichert (derselbe Schluessel)',
      vorher.gemerkt === 'hell' && nachher.gemerkt === 'dunkel');
    check('Die Flaeche folgt dem Umschalten auch wirklich',
      nachher.bodyBg === 'rgb(15, 17, 23)');
    check('Der Umschalter meldet seinen Zustand den Hilfsmitteln', nachher.gedrueckt === 'true');
  }
}

// ── Eine abgelaufene Sitzung ist kein Ladefehler ─────────────────────
//
// Was der Projektinhaber sah: zwei Karten mit "Nicht abrufbar", daneben
// ein Knopf "Abmelden" fuer eine Sitzung, die es nicht mehr gab. Jede
// Liste meldete fuer sich einen Fehler, obwohl nur die Anmeldung
// abgelaufen war -- "kein Zugriff" als "nichts vorhanden" dargestellt,
// dieselbe Familie wie "unbekannt darf nie wie keine aussehen".
//
// Geprueft wird die Aussage am Verhalten: Der Server wird durch eine
// Attrappe ersetzt, die 401 antwortet. Kein PHP noetig.
{
  const seite = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  await seite.goto(ADRESSE);
  const lage = await seite.evaluate(async () => {
    window.fetch = async () => new Response('{"status":"error","message":"Die Anmeldung gilt nicht mehr."}',
      { status: 401, headers: { 'Content-Type': 'application/json' } });

    // Fall 1: angemeldet, Sitzung traegt nicht mehr.
    token = 'abgelaufener-token';
    document.getElementById('tor').classList.add('versteckt');
    document.getElementById('haus').classList.remove('versteckt');
    await ruf('betreiber_mandant_list.php');
    const sichtbar = el => !el.classList.contains('versteckt');
    const nachAblauf = {
      tor:  sichtbar(document.getElementById('tor')),
      haus: sichtbar(document.getElementById('haus')),
      meldung: document.getElementById('tor-meldung').textContent,
      tokenWeg: token === '',
      speicherWeg: !sessionStorage.getItem('betreiber-token'),
    };

    // Fall 2: NICHT angemeldet -- ein falsches Passwort antwortet ebenfalls
    // mit 401 und gehoert in die Meldung des Anmeldefensters, nicht in
    // einen Rueckwurf.
    document.getElementById('tor-meldung').textContent = 'unberuehrt';
    await ruf('betreiber_anmelden.php', { email: 'x@y.z', passwort: 'falsch' });
    return { nachAblauf, ohneToken: document.getElementById('tor-meldung').textContent };
  });
  await seite.close();

  check('KRITISCH: eine abgelaufene Sitzung fuehrt zurueck zur Anmeldung',
    lage.nachAblauf.tor === true && lage.nachAblauf.haus === false);
  check('KRITISCH: der tote Token wird dabei weggeworfen',
    lage.nachAblauf.tokenWeg && lage.nachAblauf.speicherWeg);
  check('Der Grund steht da, statt dass die Seite kommentarlos zurueckspringt',
    /abgelaufen/i.test(lage.nachAblauf.meldung));
  check('KRITISCH: ein 401 OHNE Anmeldung wirft nicht zurueck (falsches Passwort)',
    lage.ohneToken === 'unberuehrt');
}

// ── Der QR-Code der Zwei-Faktor-Einrichtung ──────────────────────────
//
// Gemessen und nicht angenommen: Ob qrcode.js beim Nachladen tatsaechlich
// ein SVG mit sichtbarer Groesse erzeugt, sieht man dem Quelltext nicht an.
// Ein leeres weisses Feld saehe aus wie ein Ladefehler der Seite.
{
  const seite = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  await seite.goto(ADRESSE);
  const gezeichnet = await seite.evaluate(async () => {
    document.getElementById('tor').classList.add('versteckt');
    document.getElementById('zf-tor').classList.remove('versteckt');
    document.getElementById('zf-schritt1').classList.add('versteckt');
    document.getElementById('zf-schritt2').classList.remove('versteckt');
    await new Promise((fertig, fehler) => {
      const sk = document.createElement('script');
      sk.src = 'qrcode.js'; sk.onload = fertig; sk.onerror = fehler;
      document.head.appendChild(sk);
    });
    const q = qrcode(0, 'M');
    q.addData('otpauth://totp/Betreiber-Bereich:test@example.invalid?secret=JBSWY3DPEHPK3PXP&issuer=Betreiber-Bereich');
    q.make();
    document.getElementById('zf-qr').innerHTML = q.createSvgTag({ cellSize: 5, margin: 0 });
    const svg = document.querySelector('#zf-qr svg');
    const r = svg ? svg.getBoundingClientRect() : null;
    return {
      svgDa: !!svg,
      breite: r ? r.width : 0,
      hoehe: r ? r.height : 0,
      // Ein QR-Code besteht aus vielen Rechtecken oder einem Pfad. Ein SVG
      // ohne Inhalt waere ein leerer Rahmen.
      inhalt: svg ? svg.querySelectorAll('rect, path, use').length : 0,
      schluesselDa: document.getElementById('zf-lesbar') !== null,
    };
  });
  check('KRITISCH: qrcode.js laesst sich nachladen und erzeugt ein SVG', gezeichnet.svgDa);
  check('KRITISCH: der QR-Code hat eine sichtbare Groesse',
    gezeichnet.breite >= 120 && gezeichnet.hoehe >= 120);
  check('KRITISCH: das SVG ist kein leerer Rahmen', gezeichnet.inhalt > 0);
  // Der Code ist eine Ergaenzung, kein Ersatz -- der abtippbare Schluessel
  // bleibt daneben stehen, sonst haengt fest, wessen Kamera nichts liest.
  check('der abtippbare Schluessel bleibt zusaetzlich stehen', gezeichnet.schluesselDa);
  if (!gezeichnet.svgDa) { bad.push('QR: kein SVG erzeugt'); }
  else if (gezeichnet.inhalt === 0) { bad.push('QR: SVG ohne Inhalt'); }
  else { console.log(`QR-Code: ${gezeichnet.breite.toFixed(0)}x${gezeichnet.hoehe.toFixed(0)}px, ${gezeichnet.inhalt} Elemente`); }
  await seite.close();
}

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
