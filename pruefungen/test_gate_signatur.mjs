// Herstellersignatur "powered by Guard OpS" im Anmeldebildschirm.
//
// Der Pruefgegenstand ist nicht das Aussehen -- das entscheidet der
// Projektinhaber am Bildschirm -- sondern die Eigenschaften, die still
// brechen koennen, ohne dass etwas kaputt aussieht:
//
//   1. Die Signatur verschwindet ganz. Eine spaetere CSS-Regel gleicher
//      oder hoeherer Eigenspezifitaet reicht dafuer; im Quelltext steht
//      sie dann weiter da und niemand merkt es.
//   2. Die Rangfolge kippt. Im Vordergrund steht das Logo des Betriebs,
//      die Software signiert nur. Wird die Signatur groesser als das
//      Betriebslogo, streiten zwei Marken um dieselbe Stelle. Dasselbe
//      innerhalb der Zeile: "powered by" ist ein Etikett und muss kleiner
//      bleiben als das, was es beschriftet.
//   3. Sie faellt unter das Mindestmass. Die verwendete Fassung (ohne
//      Claim) braucht 20 px Hoehe; darunter laeuft die feine Linie der
//      Bildmarke zu.
//   4. Sie rutscht in #gateLogin hinein. Dann sieht sie nur, wer sich
//      anmelden darf -- wer abgewiesen wird (#gateDenied), ist aber
//      genauso in dieser Software.
//   5. Der zugaengliche Name geht verloren. Die Bildmarke IST das G;
//      ohne sie laese der Schriftzug "uard OpS" wie ein Tippfehler, und
//      genau das bekaeme ein Screenreader vorgelesen.
//   6. Die Fusszeile wird auch aufs Handy uebernommen. Am Desktop klebt
//      sie an der Bildschirmkante; am Handy ist #gate bewusst scrollbar
//      (offene Tastatur, zusaetzlich eingeblendetes 2FA-Feld), dort
//      wuerde eine fest klebende Zeile im Weg stehen.
//   7. Beim Entfernen des Begruessungssatzes faellt der Satz im
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

// ── Desktop ────────────────────────────────────────────────────────────
const d = await seite(1440, 1000);

const m = await d.evaluate(() => {
  const sig = document.querySelector('.gate-sig .go-sig');
  const label = document.querySelector('.gate-sig .go-label');
  const wrap = document.querySelector('.gate-sig');
  const logo = document.querySelector('.gate-oben img');
  if (!sig || !wrap || !logo) return null;
  const rs = sig.getBoundingClientRect();
  const rl = logo.getBoundingClientRect();
  const rw = wrap.getBoundingClientRect();
  // Wo steht die Zeile als Ganzes? Label plus Logo, nicht der volle
  // Wrapper -- der ist als Fusszeile so breit wie das Fenster.
  const teile = [rs, ...(label ? [label.getBoundingClientRect()] : [])];
  const links = Math.min(...teile.map(r => r.left));
  const rechts = Math.max(...teile.map(r => r.right));
  return {
    hoehe: rs.height, breite: rs.width,
    sichtbar: getComputedStyle(sig).visibility === 'visible'
              && getComputedStyle(wrap).display !== 'none',
    logoHoehe: rl.height,
    labelDa: !!label,
    labelText: label ? label.textContent.trim() : '',
    labelGroesse: label ? parseFloat(getComputedStyle(label).fontSize) : 0,
    mitteAbweichung: Math.abs((links + rechts) / 2 - innerWidth / 2),
    name: sig.getAttribute('aria-label') || '',
    inLogin: !!sig.closest('#gateLogin'),
    inDenied: !!sig.closest('#gateDenied'),
    // Fusszeile: klebt sie am unteren Rand und ist sie im Blick?
    festgesetzt: getComputedStyle(wrap).position === 'fixed',
    imBlick: rw.bottom <= innerHeight + 1 && rw.top >= 0,
    // Der Begruessungssatz ist weg, der Abweisungssatz nicht.
    satzImLogin: !!document.querySelector('#gateLogin .gate-msg'),
    satzImDenied: !!document.querySelector('#gateDenied .gate-msg'),
  };
});

check('Die Signatur ist im Anmeldebildschirm vorhanden', m !== null);

if (m) {
  check('Sie wird tatsaechlich gezeichnet, nicht nur deklariert',
    m.sichtbar && m.hoehe > 0 && m.breite > 0);

  check('Sie bleibt kleiner als das Betriebslogo -- die Rangfolge stimmt',
    m.hoehe < m.logoHoehe);

  check('Sie erreicht das Mindestmass der Fassung ohne Claim (20 px)',
    m.hoehe >= 20);

  check('Das Etikett steht davor', m.labelDa && m.labelText.length > 0);

  check('Das Etikett bleibt kleiner als das Logo, das es beschriftet',
    m.labelGroesse > 0 && m.labelGroesse < m.hoehe);

  // 1 px Toleranz: Bei ungerader Restbreite rundet der Browser die beiden
  // Seiten unterschiedlich, ohne dass etwas aus der Mitte laeuft.
  check('Die Zeile steht waagrecht in der Mitte des Fensters',
    m.mitteAbweichung <= 1);

  check('Sie traegt den vollstaendigen Namen fuer Screenreader',
    /guard\s*ops/i.test(m.name));

  check('Sie liegt ausserhalb beider Zustaende, nicht in einem davon',
    !m.inLogin && !m.inDenied);

  check('Am Desktop steht sie als Fusszeile und bleibt im Blick',
    m.festgesetzt && m.imBlick);

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
  if (!login || !denied || !wrap) return null;
  login.style.display = 'none';
  denied.style.display = 'block';
  const r = wrap.getBoundingClientRect();
  return r.height > 0 && r.width > 0 && getComputedStyle(wrap).display !== 'none';
});
check('Auch wer abgewiesen wird, sieht die Signatur', imDenied === true);
await d.close();

// ── Handy ──────────────────────────────────────────────────────────────
// Enger Fall: zusaetzlich das 2FA-Feld eingeblendet, das im Alltag die
// Hoehe frisst.
const h = await seite(390, 844);
const mh = await h.evaluate(() => {
  document.getElementById('gate2fa').style.display = '';
  const wrap = document.querySelector('.gate-sig');
  const r = wrap.getBoundingClientRect();
  const gate = document.getElementById('gate');
  return {
    festgesetzt: getComputedStyle(wrap).position === 'fixed',
    imBlick: r.bottom <= innerHeight + 1 && r.top >= 0,
    // Bleibt der Kopf erreichbar, wenn es eng wird? Das ist der Grund,
    // warum #gate ueberhaupt scrollbar gebaut ist.
    erreichbar: gate.scrollHeight <= gate.clientHeight || getComputedStyle(gate).overflowY === 'auto',
  };
});
check('Am Handy klebt sie NICHT am Rand, sondern laeuft mit',
  mh.festgesetzt === false);
check('Am Handy ist sie auch mit eingeblendetem 2FA-Feld im Blick',
  mh.imBlick === true);
check('Am Handy bleibt der Bildschirm erreichbar, wenn es eng wird',
  mh.erreichbar === true);
await h.close();

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden`);
if (bad.length) { bad.forEach(n => console.log('  ✗ ' + n)); process.exit(1); }
console.log('\nAlle Pruefungen bestanden.');
