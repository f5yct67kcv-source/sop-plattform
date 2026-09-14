// Herstellersignatur "powered by Guard OpS" in der Mitarbeiter-App.
//
// Dieselbe Rolle wie im Anmeldebildschirm des Cockpits: Im Vordergrund
// steht der Betrieb (Logo und Name), die Software signiert nur. Und
// dieselben Fallen -- die Datei ist eine andere, die Mechanik ist es nicht:
//
//   1. Sie wird uebermalt. Ab 900 px liegen Video und .gate-schleier als
//      absolut gesetzte Ebenen ueber dem Fluss. Im Cockpit ist die
//      Signatur beim Umbau genau so verschwunden: vorhanden, sichtbar,
//      richtig gross, richtig gefaerbt -- und unter dem Schleier. Gesehen
//      hat es erst ein Bildschirmfoto. Darum wird gefragt, welches Element
//      am Ort des Logos wirklich OBEN liegt.
//   2. Sie ueberdeckt das Formular. Die App laeuft auf Telefonen, auch auf
//      kleinen. Gemessen stuende eine fest gesetzte Zeile 34 px ueber der
//      Kante bei 320x568 um 35 px im Anmeldeformular. Geloest ist das ueber
//      die Auto-Raender von .gate-mitte; ein spaeteres "position: fixed"
//      saehe auf grossen Schirmen gleich aus und zerstoerte genau das.
//      Geprueft wird zusaetzlich der laengste Zweig der Maske (neues
//      Passwort setzen, zwei Felder mehr).
//   3. Die Zeichnung sitzt nicht in ihrem Kasten (<use>-Falle, siehe
//      test_marke_huelle.mjs).
//   4. Die Zeichnung laeuft der des Cockpits davon. App und Cockpit sind
//      getrennte Dateien und fuehren sie je einzeln mit.
//   5. Der zugaengliche Name geht verloren: Die Bildmarke IST das G.
//
// Gemessen wird am gerenderten Zustand (CLAUDE.md).
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { readFileSync } from 'fs';
import { join } from 'path';

const URL = `file://${WURZEL}/app.html`;
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

// ── Eine Zeichnung, mehrere Dateien ────────────────────────────────────
const symbol = datei => {
  const s = readFileSync(join(WURZEL, datei), 'utf8');
  const a = s.indexOf('<symbol id="go-wort"');
  return a < 0 ? null : s.slice(a, s.indexOf('</symbol>', a));
};
check('KRITISCH: die App traegt Zeichen fuer Zeichen dieselbe Zeichnung wie das Cockpit',
  !!symbol('app.html') && symbol('app.html') === symbol('dashboard.html'));

const browser = await chromium.launch({ executablePath: browserPfad() });

async function seite(breite, hoehe) {
  const p = await browser.newPage({ viewport: { width: breite, height: hoehe } });
  p.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
  await p.route('**/api/**', r => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok' }) }));
  await p.goto(URL);
  await p.evaluate(() => localStorage.clear());
  await p.goto(URL);
  await p.waitForTimeout(450);
  return p;
}

const MESSEN = () => {
  const wrap = document.querySelector('.gate-sig');
  const sig = document.querySelector('.gate-sig .go-sig');
  const label = document.querySelector('.gate-sig .go-label');
  const mitte = document.querySelector('.gate-mitte');
  const logo = document.querySelector('.gate-oben img');
  const gate = document.getElementById('gate');
  if (!wrap || !sig || !mitte) { return null; }
  const rs = sig.getBoundingClientRect();
  const rw = wrap.getBoundingClientRect();
  const rm = mitte.getBoundingClientRect();
  const bb = sig.getBBox(), m = sig.getScreenCTM();
  const pt = (x, y) => { const q = sig.createSVGPoint(); q.x = x; q.y = y; return q.matrixTransform(m); };
  const a = pt(bb.x, bb.y), b = pt(bb.x + bb.width, bb.y + bb.height);
  const proben = [.1, .3, .5, .7, .9].map(f => {
    const e = document.elementFromPoint(rs.left + rs.width * f, rs.top + rs.height / 2);
    return !!e && (e === sig || sig.contains(e));
  });
  const teile = [rs, ...(label ? [label.getBoundingClientRect()] : [])];
  const links = Math.min(...teile.map(r => r.left));
  const rechts = Math.max(...teile.map(r => r.right));
  return {
    hoehe: rs.height,
    gezeichnet: sig.getClientRects().length > 0 && rs.width > 0 && rs.height > 0
                && getComputedStyle(sig).visibility === 'visible',
    obenauf: proben.every(Boolean),
    imKasten: a.x >= rs.left - 1 && a.y >= rs.top - 1 && b.x <= rs.right + 1 && b.y <= rs.bottom + 1,
    deckungB: (b.x - a.x) / rs.width, deckungH: (b.y - a.y) / rs.height,
    logoHoehe: logo ? logo.getBoundingClientRect().height : 0,
    labelDa: !!label && label.textContent.trim().length > 0,
    labelGroesse: label ? parseFloat(getComputedStyle(label).fontSize) : 0,
    mitteAbweichung: Math.abs((links + rechts) / 2 - innerWidth / 2),
    name: sig.getAttribute('aria-label') || '',
    imBlock: !!wrap.closest('.gate-mitte'),
    unterhalb: rw.top >= rm.bottom - 1,
    ueberdeckt: rm.bottom > rw.top + 1,
    abstandZurKante: innerHeight - rw.bottom,
    ueberlauf: gate.scrollHeight - gate.clientHeight,
    scrollbar: ['auto', 'scroll'].includes(getComputedStyle(gate).overflowY),
    ausVorrat: !!sig.querySelector('use')
      && !!document.querySelector(sig.querySelector('use').getAttribute('href')),
  };
};

// ── Desktop: hier liegt das Video darunter ─────────────────────────────
const d = await seite(1440, 1000);
const m = await d.evaluate(MESSEN);
check('Die Signatur ist in der Anmeldemaske der App vorhanden', m !== null);
if (m) {
  check('Sie wird tatsaechlich gezeichnet, nicht nur deklariert', m.gezeichnet);
  check('KRITISCH: sie liegt obenauf und wird nicht vom Schleier uebermalt', m.obenauf);
  check('KRITISCH: die Zeichnung liegt in ihrem Kasten', m.imKasten);
  check('KRITISCH: die Zeichnung fuellt ihren Kasten',
    m.deckungB >= 0.90 && m.deckungH >= 0.85);
  check('Sie bleibt kleiner als das Betriebslogo -- die Rangfolge stimmt',
    m.hoehe < m.logoHoehe);
  check('Sie erreicht das Mindestmass der Fassung ohne Claim (20 px)', m.hoehe >= 20);
  check('Das Etikett "powered by" steht davor und bleibt kleiner als das Logo',
    m.labelDa && m.labelGroesse > 0 && m.labelGroesse < m.hoehe);
  check('Sie steht waagrecht in der Mitte des Fensters', m.mitteAbweichung <= 1);
  check('Sie traegt den vollstaendigen Namen fuer Screenreader', /guard\s*ops/i.test(m.name));
  check('Sie kommt aus dem gemeinsamen Vorrat, nicht aus einer Kopie', m.ausVorrat);
  check('Sie liegt ausserhalb des Anmeldeblocks', !m.imBlock);
  check('Sie steht unten am Rand, unter dem Anmeldeblock',
    m.unterhalb && m.abstandZurKante >= 28 && m.abstandZurKante <= 40);
}
await d.close();

// ── Telefone, auch kleine ──────────────────────────────────────────────
// Zwei Zweige: die kurze Anmeldung und der laengste Zweig der Maske
// ("Neues Passwort setzen", zwei Felder mehr).
for (const [w, h] of [[430, 932], [390, 844], [360, 640], [320, 568]]) {
  const p = await seite(w, h);
  for (const zweig of ['anmeldung', 'passwort setzen']) {
    if (zweig !== 'anmeldung') {
      await p.evaluate(() => {
        document.getElementById('gate-login').style.display = 'none';
        document.getElementById('gate-reset').style.display = '';
      });
      await p.waitForTimeout(120);
    }
    const s = await p.evaluate(MESSEN);
    const fall = `${w}x${h} (${zweig})`;
    check(`KRITISCH ${fall}: die Signatur ueberdeckt das Formular nicht`, s.ueberdeckt === false);
    check(`${fall}: sie steht unter dem Anmeldeblock`, s.unterhalb);
    check(`${fall}: sie steht waagrecht in der Mitte`, s.mitteAbweichung <= 1);
    check(`${fall}: die Zeichnung liegt in ihrem Kasten`, s.imKasten);
    if (s.ueberlauf <= 0) {
      check(`${fall}: sie steht unten am Rand`,
        s.abstandZurKante >= 28 && s.abstandZurKante <= 40);
      check(`${fall}: sie liegt obenauf`, s.obenauf);
    } else {
      check(`${fall}: passt es nicht, bleibt der Bildschirm scrollbar`, s.scrollbar);
    }
  }
  await p.close();
}

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden`);
if (bad.length) { bad.forEach(n => console.log('  ✗ ' + n)); process.exit(1); }
console.log('\nAlle Pruefungen bestanden.');
