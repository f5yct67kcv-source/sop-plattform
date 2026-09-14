// Herstellersignatur "powered by Guard OpS" im Anmeldebildschirm des Cockpits.
//
// Der Pruefgegenstand ist nicht das Aussehen -- das entscheidet der
// Projektinhaber am Bildschirm -- sondern die Eigenschaften, die still
// brechen koennen, ohne dass etwas kaputt aussieht:
//
//   1. Sie wird uebermalt. Ab 900 px liegen Video und .gate-schleier als
//      absolut gesetzte Ebenen ueber dem Fluss. Genau das ist beim Umbau
//      passiert: Die Signatur war vorhanden, sichtbar, 114x27 px gross und
//      richtig gefaerbt -- und trotzdem unsichtbar, weil der Schleier
//      darueber lag. Jede Messung am Element selbst sagte "in Ordnung",
//      auch die Kontrastmessung in test_cockpit_gate.mjs blieb gruen.
//      Gesehen hat es erst ein Bildschirmfoto. Darum wird hier gefragt,
//      welches Element am Ort des Logos wirklich OBEN liegt.
//   2. Die Zeichnung sitzt nicht in ihrem Kasten. <use> setzt ein <symbol>
//      bei (0,0) des aufrufenden Koordinatensystems ab; mit der viewBox des
//      Symbols auch aussen rutscht sie nach unten und wird abgeschnitten --
//      bei unveraendertem Kasten. Darum wird die Tinte gemessen.
//   3. Sie ueberdeckt das Formular. Sie steht unten am Rand; auf kleinen
//      Geraeten (320x568, oder 360x640 mit eingeblendetem 2FA-Feld) ist
//      dort das Formular. Geloest ist das ueber die Auto-Raender von
//      .gate-mitte statt ueber "position: fixed" -- reicht die Hoehe nicht,
//      rutscht alles zusammen und wandert mit dem Bildlauf. Ein spaeteres
//      "position: fixed" saehe auf grossen Schirmen gleich aus und
//      zerstoerte genau das.
//   4. Die Rangfolge kippt. Im Vordergrund steht das Logo des Betriebs, die
//      Software signiert nur. Dasselbe in der Zeile: "powered by" ist ein
//      Etikett und muss kleiner bleiben als das, was es beschriftet.
//   5. Sie faellt unter das Mindestmass. Die verwendete Fassung (ohne
//      Claim) braucht 20 px Hoehe; darunter laeuft die feine Linie der
//      Bildmarke zu.
//   6. Sie rutscht in #gateLogin hinein. Dann sieht sie nur, wer sich
//      anmelden darf -- wer abgewiesen wird (#gateDenied), ist aber genauso
//      in dieser Software.
//   7. Der zugaengliche Name geht verloren. Die Bildmarke IST das G; ohne
//      sie laese der Schriftzug "uard OpS" wie ein Tippfehler, und genau
//      das bekaeme ein Screenreader vorgelesen.
//   8. Beim Entfernen des Begruessungssatzes faellt der Satz im
//      Abweisungs-Zweig mit weg. Der ist kein Fuelltext, sondern die
//      einzige Erklaerung, warum jemand nicht hereinkommt.
//
// Gemessen wird am gerenderten Zustand (CLAUDE.md), nicht im Quelltext
// nachgelesen: Ein vorhandenes <svg> beweist nicht, dass es auch zeichnet.
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const URL = `file://${WURZEL}/dashboard.html`;
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const browser = await chromium.launch({ executablePath: browserPfad() });

async function seite(breite, hoehe) {
  const p = await browser.newPage({ viewport: { width: breite, height: hoehe } });
  p.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
  await p.route('**/api/**', r => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok' }) }));
  await p.goto(URL);
  await p.evaluate(() => localStorage.clear());
  await p.goto(URL);
  await p.waitForTimeout(400);
  return p;
}

// Eine Messung, mehrfach gebraucht.
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

  // Tinte: getBBox in Nutzereinheiten, ueber die Bildschirmmatrix in Punkte.
  const bb = sig.getBBox(), m = sig.getScreenCTM();
  const pt = (x, y) => { const q = sig.createSVGPoint(); q.x = x; q.y = y; return q.matrixTransform(m); };
  const a = pt(bb.x, bb.y), b = pt(bb.x + bb.width, bb.y + bb.height);

  // Wer liegt am Ort des Logos wirklich oben? Fuenf Punkte quer durch den
  // Kasten, nicht nur die Mitte: Ein Schleier kann auch nur halb daraufliegen.
  const proben = [.1, .3, .5, .7, .9].map(f => {
    const e = document.elementFromPoint(rs.left + rs.width * f, rs.top + rs.height / 2);
    return !!e && (e === sig || sig.contains(e));
  });

  const teile = [rs, ...(label ? [label.getBoundingClientRect()] : [])];
  const links = Math.min(...teile.map(r => r.left));
  const rechts = Math.max(...teile.map(r => r.right));
  return {
    hoehe: rs.height, breite: rs.width,
    gezeichnet: sig.getClientRects().length > 0 && rs.width > 0 && rs.height > 0
                && getComputedStyle(sig).visibility === 'visible',
    obenauf: proben.every(Boolean),
    imKasten: a.x >= rs.left - 1 && a.y >= rs.top - 1 && b.x <= rs.right + 1 && b.y <= rs.bottom + 1,
    deckungB: (b.x - a.x) / rs.width, deckungH: (b.y - a.y) / rs.height,
    logoHoehe: logo ? logo.getBoundingClientRect().height : 0,
    labelDa: !!label, labelText: label ? label.textContent.trim() : '',
    labelGroesse: label ? parseFloat(getComputedStyle(label).fontSize) : 0,
    mitteAbweichung: Math.abs((links + rechts) / 2 - innerWidth / 2),
    name: sig.getAttribute('aria-label') || '',
    inLogin: !!wrap.closest('#gateLogin'), inDenied: !!wrap.closest('#gateDenied'),
    imBlock: !!wrap.closest('.gate-mitte'),
    // Unten am Rand, und NIE ueber dem Anmeldeblock.
    unterhalb: rw.top >= rm.bottom - 1,
    ueberdeckt: rm.bottom > rw.top + 1,
    abstandZurKante: innerHeight - rw.bottom,
    ueberlauf: gate.scrollHeight - gate.clientHeight,
    ausVorrat: !!sig.querySelector('use')
      && !!document.querySelector(sig.querySelector('use').getAttribute('href')),
    satzImLogin: !!document.querySelector('#gateLogin .gate-msg'),
    satzImDenied: !!document.querySelector('#gateDenied .gate-msg'),
  };
};

// ── Desktop ────────────────────────────────────────────────────────────
const d = await seite(1440, 1000);
const m = await d.evaluate(MESSEN);

check('Die Signatur ist im Anmeldebildschirm vorhanden', m !== null);

if (m) {
  check('Sie wird tatsaechlich gezeichnet, nicht nur deklariert', m.gezeichnet);
  check('KRITISCH: sie liegt obenauf und wird nicht vom Schleier uebermalt', m.obenauf);
  check('KRITISCH: die Zeichnung liegt in ihrem Kasten', m.imKasten);
  check('KRITISCH: die Zeichnung fuellt ihren Kasten',
    m.deckungB >= 0.90 && m.deckungH >= 0.85);
  check('Sie bleibt kleiner als das Betriebslogo -- die Rangfolge stimmt',
    m.hoehe < m.logoHoehe);
  check('Sie erreicht das Mindestmass der Fassung ohne Claim (20 px)', m.hoehe >= 20);
  check('Das Etikett steht davor', m.labelDa && m.labelText.length > 0);
  check('Das Etikett bleibt kleiner als das Logo, das es beschriftet',
    m.labelGroesse > 0 && m.labelGroesse < m.hoehe);
  // 1 px Toleranz: Bei ungerader Restbreite rundet der Browser die beiden
  // Seiten unterschiedlich, ohne dass etwas aus der Mitte laeuft.
  check('Die Zeile steht waagrecht in der Mitte des Fensters', m.mitteAbweichung <= 1);
  check('Sie traegt den vollstaendigen Namen fuer Screenreader', /guard\s*ops/i.test(m.name));
  check('Sie kommt aus dem gemeinsamen Vorrat, nicht aus einer Kopie', m.ausVorrat);
  check('Sie liegt ausserhalb beider Zustaende und ausserhalb des Anmeldeblocks',
    !m.inLogin && !m.inDenied && !m.imBlock);
  check('Sie steht unten am Rand, unter dem Anmeldeblock',
    m.unterhalb && m.abstandZurKante >= 28 && m.abstandZurKante <= 40);
  check('Der Begruessungssatz ist weg', m.satzImLogin === false);
  check('Der Satz im Abweisungs-Zweig ist erhalten', m.satzImDenied === true);
}

// Wer abgewiesen wird, sieht sie auch. Der Zustand wird hier direkt
// geschaltet statt ueber eine echte Anmeldung -- geprueft wird die
// Sichtbarkeit der Signatur, nicht der Weg dorthin.
const imDenied = await d.evaluate(() => {
  const login = document.getElementById('gateLogin');
  const denied = document.getElementById('gateDenied');
  const wrap = document.querySelector('.gate-sig');
  if (!login || !denied || !wrap) { return null; }
  login.style.display = 'none';
  denied.style.display = 'block';
  const r = wrap.getBoundingClientRect();
  return r.height > 0 && r.width > 0 && getComputedStyle(wrap).display !== 'none';
});
check('Auch wer abgewiesen wird, sieht die Signatur', imDenied === true);
await d.close();

// ── Enge Geraete ───────────────────────────────────────────────────────
// Der eigentliche Grund, warum die Zeile NICHT fest gesetzt ist. Geprueft
// wird mit und ohne das zusaetzlich eingeblendete 2FA-Feld -- der Fall, der
// im Alltag die Hoehe frisst.
for (const [w, h] of [[430, 932], [390, 844], [360, 640], [320, 568]]) {
  const p = await seite(w, h);
  for (const zweifaktor of [false, true]) {
    if (zweifaktor) {
      await p.evaluate(() => { document.getElementById('gate2fa').style.display = ''; });
      await p.waitForTimeout(120);
    }
    const s = await p.evaluate(MESSEN);
    const fall = `${w}x${h}${zweifaktor ? ' mit 2FA' : ''}`;
    check(`KRITISCH ${fall}: die Signatur ueberdeckt das Formular nicht`, s.ueberdeckt === false);
    check(`${fall}: sie steht unter dem Anmeldeblock`, s.unterhalb);
    check(`${fall}: sie steht waagrecht in der Mitte`, s.mitteAbweichung <= 1);
    check(`${fall}: die Zeichnung liegt in ihrem Kasten`, s.imKasten);
    if (s.ueberlauf <= 0) {
      check(`${fall}: sie steht unten am Rand`, s.abstandZurKante >= 28 && s.abstandZurKante <= 40);
      check(`${fall}: sie liegt obenauf`, s.obenauf);
    } else {
      // Passt es nicht, MUSS der Bildschirm scrollbar sein -- sonst waere
      // sowohl der Kopf als auch die Signatur unerreichbar.
      const scrollbar = await p.evaluate(() => {
        const g = document.getElementById('gate');
        return getComputedStyle(g).overflowY === 'auto' || getComputedStyle(g).overflowY === 'scroll';
      });
      check(`${fall}: passt es nicht, bleibt der Bildschirm scrollbar`, scrollbar);
    }
  }
  await p.close();
}

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden`);
if (bad.length) { bad.forEach(n => console.log('  ✗ ' + n)); process.exit(1); }
console.log('\nAlle Pruefungen bestanden.');
