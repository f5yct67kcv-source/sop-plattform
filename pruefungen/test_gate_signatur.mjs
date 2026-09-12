// Herstellersignatur "Guard OpS" im Anmeldebildschirm.
//
// Der Pruefgegenstand ist nicht das Aussehen -- das entscheidet der
// Projektinhaber am Bildschirm -- sondern die fuenf Eigenschaften, die
// still brechen koennen, ohne dass etwas kaputt aussieht:
//
//   1. Die Signatur verschwindet ganz. Eine spaetere CSS-Regel gleicher
//      oder hoeherer Eigenspezifitaet reicht dafuer; im Quelltext steht
//      sie dann weiter da und niemand merkt es.
//   2. Die Rangfolge kippt. Im Vordergrund steht das Logo des Betriebs,
//      die Software signiert nur. Wird die Signatur groesser als das
//      Betriebslogo, streiten zwei Marken um dieselbe Stelle.
//   3. Sie faellt unter das Mindestmass. Die verwendete Fassung (ohne
//      Claim) braucht 20 px Hoehe; darunter laeuft die feine Linie der
//      Bildmarke zu.
//   4. Sie rutscht in #gateLogin hinein. Dann sieht sie nur, wer sich
//      anmelden darf -- wer abgewiesen wird (#gateDenied), ist aber
//      genauso in dieser Software.
//   5. Der zugaengliche Name geht verloren. Die Bildmarke IST das G;
//      ohne sie laese der Schriftzug "uard OpS" wie ein Tippfehler, und
//      genau das bekaeme ein Screenreader vorgelesen.
//
// Gemessen wird am gerenderten Zustand (CLAUDE.md), nicht im Quelltext
// nachgelesen: Ein vorhandenes <svg> beweist nicht, dass es auch zeichnet.
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const URL = `file://${WURZEL}/dashboard.html`;
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const browser = await chromium.launch({ executablePath: browserPfad() });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));

await page.route('**/api/**', r => {
  const p = r.request().url().split('/api/')[1];
  const send = b => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'a', ist_admin: true });
  return send({ status: 'ok' });
});

await page.goto(URL);
await page.evaluate(() => localStorage.clear());
await page.goto(URL);
await page.waitForTimeout(400);

const m = await page.evaluate(() => {
  const sig = document.querySelector('.gate-sig .go-sig');
  const logo = document.querySelector('.gate-oben img');
  const mitte = document.querySelector('.gate-mitte');
  const wrap = document.querySelector('.gate-sig');
  if (!sig || !logo || !mitte || !wrap) return null;
  const rs = sig.getBoundingClientRect();
  const rl = logo.getBoundingClientRect();
  const rm = mitte.getBoundingClientRect();
  return {
    hoehe: rs.height, breite: rs.width,
    sichtbar: getComputedStyle(sig).visibility === 'visible'
              && getComputedStyle(wrap).display !== 'none',
    logoHoehe: rl.height,
    linksAussen: rs.left - rm.left,
    rechtsAussen: rm.right - rs.right,
    name: sig.getAttribute('aria-label') || '',
    // Steht die Signatur INNERHALB eines der beiden Zustaende? Dann saehe
    // sie nur die eine Haelfte der Leute.
    inLogin: !!sig.closest('#gateLogin'),
    inDenied: !!sig.closest('#gateDenied'),
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

  // 1 px Toleranz: Bei ungerader Restbreite rundet der Browser die beiden
  // Raender unterschiedlich, ohne dass etwas aus der Mitte laeuft.
  check('Sie steht waagrecht in der Mitte des Anmeldeblocks',
    Math.abs(m.linksAussen - m.rechtsAussen) <= 1);

  check('Sie traegt den vollstaendigen Namen fuer Screenreader',
    /guard\s*ops/i.test(m.name));

  check('Sie liegt ausserhalb beider Zustaende, nicht in einem davon',
    !m.inLogin && !m.inDenied);
}

// Wer abgewiesen wird, sieht sie auch. Der Zustand wird hier direkt
// geschaltet statt ueber eine echte Anmeldung -- geprueft wird die
// Sichtbarkeit der Signatur, nicht der Weg dorthin.
const imDenied = await page.evaluate(() => {
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

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden`);
if (bad.length) { bad.forEach(n => console.log('  ✗ ' + n)); process.exit(1); }
console.log('\nAlle Pruefungen bestanden.');
