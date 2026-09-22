// Das Band des Supportzugangs im Cockpit (ENT-631, Schritt 3).
//
// GEMESSEN, NICHT NACHGELESEN (CLAUDE.md): Eine CSS-Regel kann wirkungslos
// bleiben, ohne dass etwas kaputtgeht -- durch eine spaetere Regel gleicher
// oder hoeherer Eigenspezifitaet. Wer eine Gestaltungsaenderung nicht
// misst, weiss nicht, ob sie greift. Darum steht hier keine Pruefung auf
// Quelltext: Alles wird am gerenderten Zustand abgenommen, auf beiden
// Bildschirmgroessen.
//
// WAS DAS BAND LEISTEN MUSS: Es soll dem Betrieb sagen, dass gerade ein
// Fremder im Cockpit ist. Also muss es SICHTBAR sein, es darf nichts
// verdecken, und es muss bedienbar bleiben -- auch auf 390 px.
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const browser = await chromium.launch({ executablePath: browserPfad() });

// Kontrast nach WCAG, gerechnet statt geschaetzt: Weiss auf einem mittleren
// Farbton ist die haeufigste Selbsttaeuschung.
const leuchte = (r, g, b) => {
  const k = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; };
  return .2126 * k(r) + .7152 * k(g) + .0722 * k(b);
};
const kontrast = (a, b) => {
  const z = s => (s.match(/\d+/g) || []).slice(0, 3).map(Number);
  const [l1, l2] = [leuchte(...z(a)), leuchte(...z(b))].sort((x, y) => y - x);
  return (l1 + .05) / (l2 + .05);
};

async function messen(breite, hoehe, supportAn) {
  const page = await browser.newPage({ viewport: { width: breite, height: hoehe } });
  page.setDefaultTimeout(5000);
  const fehler = [];
  page.on('pageerror', e => fehler.push(e.message));
  await page.goto(`file://${WURZEL}/dashboard.html`);
  await page.waitForTimeout(300);

  // Den Zustand herstellen, den eine Support-Sitzung erzeugt -- ohne
  // Server: Die Klasse am Body und der Vorrat sind genau das, was
  // supportBandStarten() setzt.
  const werte = await page.evaluate((an) => {
    // Die Huelle sichtbar machen. OHNE das haben Seitenleiste, Kopfzeile
    // und Inhalt die Hoehe 0 und liegen alle bei y=0 -- jede Aussage
    // ueber "verdeckt nichts" waere dann wertlos, und die Pruefung waere
    // gruen geworden, ohne etwas gemessen zu haben. Dieselben zwei
    // Zeilen fuehrt enter() aus.
    const gate = document.getElementById('gate');
    if (gate) { gate.style.display = 'none'; }
    const shell = document.getElementById('shell');
    if (shell) { shell.classList.add('on'); }
    if (an) {
      window.me = { name: 'GuardOpS Support', rechte: ['rechte_schreiben'],
                    support: true, protokolliert: true };
      window.utLetzte = Date.now();
      document.body.classList.add('support-an');
      if (typeof supportBandSetzen === 'function') { supportBandSetzen(); }
    }
    const m = (sel) => {
      const e = document.querySelector(sel);
      if (!e) { return null; }
      const r = e.getBoundingClientRect(), c = getComputedStyle(e);
      return { x: r.x, y: r.y, w: r.width, h: r.height, unten: r.bottom,
               sichtbar: c.display !== 'none' && r.width > 0 && r.height > 0,
               grund: c.backgroundColor, farbe: c.color, fs: parseFloat(c.fontSize),
               z: c.zIndex, pos: c.position, text: (e.textContent || '').trim() };
    };
    return {
      band:   m('#supportband'),
      bis:    m('#sbBis'),
      ende:   m('#sbEnde'),
      seite:  m('.side'),
      kopf:   m('.topbar'),
      haupt:  m('.main'),
      breite: window.innerWidth,
    };
  }, supportAn);
  await page.close();
  return { ...werte, fehler };
}

// ══════════ OHNE SUPPORTZUGANG AENDERT SICH NICHTS ════════════════════
{
  const a = await messen(1280, 900, false);
  check('ohne Supportzugang ist das Band nicht zu sehen', a.band && !a.band.sichtbar);
  // Der Regelfall muss aussehen wie immer -- die Seitenleiste beginnt oben.
  check('ohne Supportzugang beginnt die Seitenleiste ganz oben',
    a.seite && Math.abs(a.seite.y) < 1);
  check('ohne Supportzugang klebt die Kopfzeile ganz oben',
    a.kopf && Math.abs(a.kopf.y) < 1);
  if (a.fehler.length) { bad.push('JS-Fehler (ohne Band): ' + a.fehler.join('; ')); }
}

// ══════════ DESKTOP ═══════════════════════════════════════════════════
{
  const a = await messen(1280, 900, true);
  check('das Band ist sichtbar', a.band && a.band.sichtbar);
  check('das Band sitzt ganz oben', a.band && Math.abs(a.band.y) < 1);
  check('das Band geht ueber die volle Breite',
    a.band && Math.abs(a.band.w - a.breite) < 2);
  check('das Band ist schmal (unter 45 px)', a.band && a.band.h > 0 && a.band.h < 45);

  // DER EIGENTLICHE PUNKT: Das Band darf nichts verdecken. Verdeckte es
  // die Kopfzeile, waere die Arbeit gestoert -- und wer gestoert wird,
  // sucht einen Weg, das Band loszuwerden.
  check('das Band verdeckt die Seitenleiste nicht',
    a.seite && a.band && a.seite.y >= a.band.unten - 1);
  check('das Band verdeckt die Kopfzeile nicht',
    a.kopf && a.band && a.kopf.y >= a.band.unten - 1);
  check('der Inhalt beginnt unter dem Band',
    a.haupt && a.band && a.haupt.y >= a.band.unten - 1);

  check('das Band liegt ueber Seitenleiste und Kopfzeile',
    a.band && a.seite && Number(a.band.z) > Number(a.seite.z));

  check('das Band nennt den Grund', a.band && /Supportzugriff durch GuardOpS/.test(a.band.text));
  check('das Band nennt die Ablaufzeit', a.bis && /endet um \d{1,2}:\d{2}/.test(a.bis.text));
  check('es gibt einen Weg, den Zugriff zu beenden', a.ende && a.ende.sichtbar);

  // Lesbar, nicht nur vorhanden.
  check('der Text auf dem Band ist lesbar (Kontrast >= 4.5)',
    a.band && kontrast(a.band.farbe, a.band.grund) >= 4.5);
  if (a.fehler.length) { bad.push('JS-Fehler (Desktop): ' + a.fehler.join('; ')); }
}

// ══════════ HANDY ═════════════════════════════════════════════════════
{
  const a = await messen(390, 844, true);
  check('am Handy ist das Band sichtbar', a.band && a.band.sichtbar);
  check('am Handy geht das Band ueber die volle Breite',
    a.band && Math.abs(a.band.w - a.breite) < 2);
  check('am Handy verdeckt das Band die Kopfzeile nicht',
    a.kopf && a.band && a.kopf.y >= a.band.unten - 1);
  check('am Handy beginnt der Inhalt unter dem Band',
    a.haupt && a.band && a.haupt.y >= a.band.unten - 1);

  // Hausregel: Bedienelemente auf dem Handy mindestens 44 px hoch.
  check('der Beenden-Knopf ist am Handy mindestens 44 px hoch',
    a.ende && a.ende.h >= 44);
  // Und er muss ins Band passen, sonst steht er halb darueber hinaus.
  check('der Beenden-Knopf bleibt im Band',
    a.ende && a.band && a.ende.y >= a.band.y - 1 && a.ende.unten <= a.band.unten + 1);
  // Der Text darf nicht unter den Knopf rutschen.
  check('Text und Knopf ueberlappen sich am Handy nicht',
    a.bis && a.ende && a.bis.x + a.bis.w <= a.ende.x + 1);
  if (a.fehler.length) { bad.push('JS-Fehler (Handy): ' + a.fehler.join('; ')); }
}

// ══════════ GEGENPROBE ════════════════════════════════════════════════
//
// Eine Messung, die nie angeschlagen hat, ist eine Behauptung (CLAUDE.md).
// Also wird das Layout absichtlich zerstoert: Die Verschiebungen werden zur
// Laufzeit zurueckgedreht, und die Pruefungen "verdeckt nichts" MUESSEN
// dann rot werden. Kaeme dabei gruen heraus, hiesse das, sie messen etwas
// anderes als das, was sie behaupten.
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(5000);
  await page.goto(`file://${WURZEL}/dashboard.html`);
  await page.waitForTimeout(300);
  const a = await page.evaluate(() => {
    const gate = document.getElementById('gate');
    if (gate) { gate.style.display = 'none'; }
    const shell = document.getElementById('shell');
    if (shell) { shell.classList.add('on'); }
    document.body.classList.add('support-an');
    // Genau die Regeln zurueckdrehen, die das Band Platz schaffen lassen.
    const s = document.createElement('style');
    s.textContent = 'body.support-an .side, body.support-an .topbar { top: 0 !important; }'
                  + 'body.support-an .main { margin-top: 0 !important; }';
    document.head.appendChild(s);
    const m = (sel) => {
      const e = document.querySelector(sel);
      if (!e) { return null; }
      const r = e.getBoundingClientRect();
      return { y: r.y, unten: r.bottom, h: r.height };
    };
    return { band: m('#supportband'), seite: m('.side'), kopf: m('.topbar'), haupt: m('.main') };
  });
  await page.close();

  // Die Elemente muessen ueberhaupt da sein -- sonst waere "verdeckt"
  // nicht messbar und die Gegenprobe selbst wertlos.
  const gerendert = a.seite && a.seite.h > 0 && a.kopf && a.kopf.h > 0;
  check('Gegenprobe: die Huelle ist ueberhaupt gerendert (sonst misst die Suite Luft)',
    gerendert);
  check('Gegenprobe: ohne die Verschiebung verdeckt das Band die Seitenleiste',
    gerendert && a.seite.y < a.band.unten - 1);
  check('Gegenprobe: ohne die Verschiebung verdeckt das Band die Kopfzeile',
    gerendert && a.kopf.y < a.band.unten - 1);
  check('Gegenprobe: ohne die Verschiebung beginnt der Inhalt unter dem Band nicht',
    gerendert && a.haupt.y < a.band.unten - 1);
}

await browser.close();

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
