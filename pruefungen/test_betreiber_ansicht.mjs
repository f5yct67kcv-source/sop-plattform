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

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
