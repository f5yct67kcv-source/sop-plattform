// Die Marke im Anmeldebildschirm der Mitarbeiter-App (ENT-668).
//
// Bis ENT-668 stand hier das Gegenteil: 60 Pruefungen ueber die
// Herstellersignatur "powered by Guard OpS" am unteren Rand -- dass sie
// gezeichnet wird, obenauf liegt, in ihrem Kasten sitzt, das Formular
// nicht ueberdeckt. Die Signatur ist weg, und damit war die ganze Datei
// eine Behauptung ueber etwas, das es nicht mehr gibt.
//
// WARUM SIE WEG IST: Seit ENT-661 traegt die App oben dauerhaft die
// GuardOpS-Bildmarke -- fuer JEDEN Mandanten, weil es eine App fuer alle
// gibt und kein eigener Bau pro Mandant. Damit stand derselbe Name
// zweimal auf derselben Flaeche. Eine Signatur ist die leise Unterschrift
// unter fremdem Logo; steht oben schon der eigene Name, ist sie nur noch
// eine Wiederholung. Im Cockpit (dashboard.html) bleibt sie darum: Dort
// steht oben das Logo des MANDANTEN, und genau dann traegt sie.
//
// WAS JETZT GEPRUEFT WIRD -- und zwar so, dass ein Rueckfall auffaellt:
//
//   1. Die Signatur ist WEG, nicht bloss unsichtbar. Eine Pruefung auf
//      "nicht sichtbar" bliebe gruen, wenn jemand sie mit display:none
//      wieder einbaut -- und beim naechsten CSS-Umbau stuende sie da.
//   2. Auch der Schriftzug im SVG-Vorrat ist weg. Er trug nur die
//      Signatur; bliebe er liegen, waere er totes Gewicht im Buendel und
//      eine Einladung, ihn "kurz" wieder zu verwenden.
//   3. Der zugaengliche Name ist NICHT verloren gegangen. Das war die
//      eigentliche Leistung der Signatur: Sie sprach "Guard OpS" aus.
//      Jetzt muss die Bildmarke oben das tun -- die Bildmarke IST das G,
//      und ein G allein sagt einem Screenreader nichts.
//   4. Das Bild bleibt heil. Der entfernte Block hing an den
//      Auto-Raendern von .gate-mitte; wer ihn herausnimmt, kann die
//      Ausrichtung des Anmeldeblocks mitnehmen, ohne dass etwas bricht.
//      Darum wird auf vier Geraetebreiten und in BEIDEN Zweigen der Maske
//      gemessen, dass der Block oben steht, nichts ueberlaeuft und die
//      Marke sichtbar bleibt.
//
// Gemessen wird am gerenderten Zustand (CLAUDE.md).
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { readFileSync } from 'fs';
import { join } from 'path';

const URL = `file://${WURZEL}/app.html`;
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

// ── Im Quelltext: kein Schriftzug mehr, Bildmarke unveraendert ─────────
const symbol = (datei, id) => {
  const s = readFileSync(join(WURZEL, datei), 'utf8');
  const a = s.indexOf(`<symbol id="${id}"`);
  return a < 0 ? null : s.slice(a, s.indexOf('</symbol>', a));
};
check('KRITISCH: die App fuehrt den Schriftzug gar nicht mehr mit -- kein totes Gewicht im Buendel',
  symbol('app.html', 'go-wort') === null);
check('Die Bildmarke ist weiterhin da', !!symbol('app.html', 'go-bild'));
/* Das Cockpit fuehrt KEINE Bildmarke allein -- es braucht nur den
   Schriftzug. Vergleichbar sind darum nicht zwei Symbole, sondern die
   beiden Schild-Pfade: Sie stecken in der Bildmarke der App und, kleiner
   skaliert, im Schriftzug des Cockpits. Laufen sie auseinander, zeigen
   App und Cockpit verschiedene Schilde -- genau der Fall, den diese
   Pruefung seit jeher verhindern soll. Meine erste Fassung verglich
   stattdessen "go-bild" hier mit "go-bild" dort und war gruen fuer
   nichts: Dort gibt es das Symbol gar nicht, beide Seiten waeren null. */
{
  const bild = symbol('app.html', 'go-bild') || '';
  const wort = symbol('dashboard.html', 'go-wort') || '';
  const pfade = [...bild.matchAll(/ d="([^"]+)"/g)].map(m => m[1]);
  check('Vorbedingung: die Bildmarke besteht aus den zwei Schild-Pfaden', pfade.length === 2);
  check('KRITISCH: beide Pfade stecken Zeichen fuer Zeichen auch im Schriftzug des Cockpits',
    pfade.length === 2 && pfade.every(d => wort.includes(d)));
}
check('Das Cockpit behaelt seinen Schriftzug -- dort signiert die Software unter fremdem Logo',
  !!symbol('dashboard.html', 'go-wort'));

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
  const gate = document.getElementById('gate');
  const mitte = document.querySelector('.gate-mitte');
  const marke = document.querySelector('.gate-oben .gate-marke');
  const sub = document.querySelector('.gate-oben .sub');
  if (!gate || !mitte || !marke) { return null; }
  const rm = mitte.getBoundingClientRect();
  const rk = marke.getBoundingClientRect();
  /* .gate-oben liegt INNERHALB von .gate-mitte -- die Marke steht also
     nicht ueber dem Block, sondern in seinem Kopf. Gemessen wird darum
     gegen das erste Eingabefeld des gerade sichtbaren Zweigs. Meine
     erste Fassung verglich gegen den Block selbst und fiel auf jeder
     Breite durch. */
  const feld = [...document.querySelectorAll('.gate-form')]
    .filter(f => getComputedStyle(f).display !== 'none')
    .flatMap(f => [...f.querySelectorAll('input')])
    /* Nur SICHTBARE Felder: Im Anmeldezweig steht das Betriebsfeld
       (ENT-665) als erstes im Aufbau, ist aber ausgeblendet, sobald der
       Betrieb feststeht -- und ein ausgeblendetes Feld hat den Kasten
       0/0/0/0. Genau daran ist die zweite Fassung dieser Messung
       gescheitert: im Zweig "Passwort setzen" gruen, im Anmeldezweig rot,
       weil es dort ein unsichtbares erstes Feld gibt. */
    .find(e => e.getBoundingClientRect().height > 0);
  const rf = feld ? feld.getBoundingClientRect() : null;
  // Liegt die Marke wirklich obenauf -- oder unter dem Schleier?
  const proben = [.2, .5, .8].map(f => {
    const e = document.elementFromPoint(rk.left + rk.width * f, rk.top + rk.height / 2);
    return !!e && (e === marke || marke.contains(e));
  });
  return {
    // Was es nicht mehr geben darf:
    sigDa: !!document.querySelector('.gate-sig'),
    labelDa: !!document.querySelector('.go-label'),
    wortDa: !!document.querySelector('.go-sig'),
    vorratDa: !!document.getElementById('go-wort'),
    textPowered: /powered\s*by/i.test(gate.innerText || ''),
    // Was es weiterhin geben muss:
    markeGezeichnet: rk.width > 0 && rk.height > 0
                     && getComputedStyle(marke).visibility === 'visible',
    markeObenauf: proben.every(Boolean),
    markeName: marke.getAttribute('aria-label') || '',
    subText: sub ? (sub.textContent || '').trim() : '',
    // Was heil bleiben muss:
    blockOben: rm.top < innerHeight / 2,
    ueberlauf: gate.scrollHeight - gate.clientHeight,
    scrollbar: ['auto', 'scroll'].includes(getComputedStyle(gate).overflowY),
    markeUeberFeld: !!rf && rk.bottom <= rf.top + 1,
  };
};

// ── Desktop: hier liegt das Video/der Schleier darueber ────────────────
{
  const d = await seite(1440, 1000);
  const m = await d.evaluate(MESSEN);
  check('Vorbedingung: der Anmeldebildschirm ist messbar', m !== null);
  if (m) {
    check('KRITISCH: die Herstellersignatur ist WEG, nicht nur unsichtbar', m.sigDa === false);
    check('KRITISCH: auch das Etikett "powered by" gibt es nicht mehr', m.labelDa === false);
    check('KRITISCH: und im Text des Bildschirms steht es auch nirgends mehr', m.textPowered === false);
    check('KRITISCH: der Schriftzug ist auch aus dem SVG-Vorrat verschwunden', m.vorratDa === false);
    check('Kein verwaistes <svg class="go-sig"> haengt noch herum', m.wortDa === false);
    check('KRITISCH: der Name ist nicht mit verschwunden -- die Bildmarke spricht ihn aus',
      /guard\s*ops/i.test(m.markeName));
    check('Die Marke wird gezeichnet, nicht nur deklariert', m.markeGezeichnet);
    check('KRITISCH: sie liegt obenauf und wird nicht vom Schleier uebermalt', m.markeObenauf);
    check('Der Firmenname steht unter der Marke', m.subText.length > 0);
    check('Die Marke steht ueber dem ersten Eingabefeld', m.markeUeberFeld);
    check('Der Anmeldeblock steht in der oberen Haelfte', m.blockOben);
  }
  await d.close();
}

// ── Telefone, auch kleine, in beiden Zweigen der Maske ─────────────────
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
    check(`KRITISCH ${fall}: keine Signatur`, s.sigDa === false && s.textPowered === false);
    check(`${fall}: die Marke ist da und traegt den Namen`,
      s.markeGezeichnet && /guard\s*ops/i.test(s.markeName));
    check(`${fall}: die Marke steht ueber dem ersten Eingabefeld`, s.markeUeberFeld);
    check(`${fall}: der Anmeldeblock steht in der oberen Haelfte`, s.blockOben);
    if (s.ueberlauf > 0) {
      check(`${fall}: passt es nicht, bleibt der Bildschirm scrollbar`, s.scrollbar);
    } else {
      check(`${fall}: die Marke liegt obenauf`, s.markeObenauf);
    }
  }
  await p.close();
}

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden`);
if (bad.length) { bad.forEach(n => console.log('  ✗ ' + n)); process.exit(1); }
console.log('\nAlle Pruefungen bestanden.');
