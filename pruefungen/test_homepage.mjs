// Die oeffentliche Homepage (ENT-469) -- die Seite, die Interessenten sehen.
//
// Geprueft wird am gerenderten Zustand, nicht im Quelltext:
//   1. Die Schriften kommen wirklich vom eigenen Server (fonts/), nicht
//      als stiller Rueckfall auf den System-Stapel -- und nichts wird bei
//      Google geladen.
//   2. Kein horizontaler Ueberlauf, weder am Desktop noch auf dem Handy.
//      Genau das war im ersten Entwurf kaputt: lange Versalwoerter dehnten
//      die Spalte ueber den Bildschirmrand.
//   3. Die Masse fuer das Handy: Bedienelemente mindestens 44 px, Eingabe-
//      felder mindestens 16 px Schrift. Der Demo-Knopf steht in der
//      Kopfleiste genau einmal.
//   4. Das Formular: Ohne Pflichtangaben geht nichts zum Server; mit ihnen
//      geht genau EIN JSON-Aufruf an api/demo_anfrage.php, das Fallenfeld
//      bleibt leer, und die Antwort des Servers erscheint -- Erfolg wie
//      "nicht eingerichtet" (503) sind zwei verschiedene Texte.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const SEITE = `file://${WURZEL}/homepage.html`;
const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);
async function klick(seite, sel) {
  try { await seite.click(sel, { timeout: 3000 }); return true; }
  catch (e) { bad.push('nicht anklickbar: ' + sel); return false; }
}
async function fuell(seite, sel, wert) {
  try { await seite.fill(sel, wert, { timeout: 3000 }); return true; }
  catch (e) { bad.push('nicht ausfuellbar: ' + sel); return false; }
}

const browser = await chromium.launch({ executablePath: EXE });

// ── Desktop ────────────────────────────────────────────────────────────
const fremdeAbrufe = [];
const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
desktop.on('request', r => { if (/^https?:/.test(r.url())) { fremdeAbrufe.push(r.url()); } });
// Die Serverantwort wird VOR dem Laden vorgetaeuscht -- eine danach
// registrierte Umleitung greift bei einer file://-Seite nicht mehr (der
// Browser weist den Aufruf vorher als Cross-Origin ab).
const aufrufe = [];
let antwort = { status: 200, body: { status: 'ok', message: 'Vielen Dank. Wir melden uns innert eines Arbeitstages.' } };
await desktop.route('**/backend/api/demo_anfrage.php', async route => {
  const r = route.request();
  aufrufe.push({ methode: r.method(), typ: r.headers()['content-type'] || '', daten: r.postDataJSON() });
  await route.fulfill({ status: antwort.status, contentType: 'application/json', body: JSON.stringify(antwort.body) });
});
await desktop.goto(SEITE, { waitUntil: 'load' });
await desktop.evaluate(() => document.fonts.ready);

check('KRITISCH: die Seite laedt nichts von fremden Servern (keine Google-Schriften, kein CDN)',
  fremdeAbrufe.length === 0);
if (fremdeAbrufe.length) { bad.push('fremd: ' + fremdeAbrufe.slice(0, 3).join(', ')); }

const schriften = await desktop.evaluate(() => ({
  archivo: document.fonts.check('700 40px Archivo'),
  plex: document.fonts.check('400 16px "IBM Plex Sans"'),
  mono: document.fonts.check('400 12px "IBM Plex Mono"'),
  geladen: [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family),
}));
check('KRITISCH: Archivo ist wirklich geladen (Datei unter fonts/ vorhanden und lesbar)', schriften.archivo && schriften.geladen.includes('Archivo'));
check('KRITISCH: IBM Plex Sans ist wirklich geladen', schriften.plex && schriften.geladen.includes('IBM Plex Sans'));
check('IBM Plex Mono ist wirklich geladen', schriften.mono && schriften.geladen.includes('IBM Plex Mono'));

const h1 = await desktop.evaluate(() => {
  const e = document.querySelector('h1'); const cs = getComputedStyle(e);
  return { fam: cs.fontFamily, stretch: cs.fontStretch, gross: cs.textTransform };
});
check('Die Ueberschrift steht in schmalem Archivo in Versalien (die Westenaufschrift)',
  /Archivo/.test(h1.fam) && parseFloat(h1.stretch) < 80 && h1.gross === 'uppercase');

// ── Dieselben Farben wie das Cockpit (Anordnung des Projektinhabers,
// ENT-469-N1). Nicht der Wortlaut einer Hex-Zahl wird verglichen, sondern
// die Aussage: Was die Homepage rendert, ist der Wert, den dashboard.html
// fuer sein dunkles bzw. helles Thema traegt. Aendert jemand das Cockpit,
// wird die Homepage hier rot -- und nicht still anders.
const dash = readFileSync(`${WURZEL}/dashboard.html`, 'utf8');
const block = (ab) => { const i = dash.indexOf(ab); return i < 0 ? '' : dash.slice(i, dash.indexOf('}', i)); };
const marke = (b, name) => (b.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`)) || [])[1] || '';
const dunkel = block('html[data-thema="dunkel"] {');
const hell = block(':root {');
const rgb = h => `rgb(${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)})`;
check('Die Farbmarken des Cockpits sind lesbar (dunkel: bg, accent, warn; hell: bg, accent)',
  !!marke(dunkel, 'bg') && !!marke(dunkel, 'accent') && !!marke(dunkel, 'warn') && !!marke(hell, 'bg') && !!marke(hell, 'accent'));
const farben = await desktop.evaluate(() => {
  const f = (sel, eig) => { const e = document.querySelector(sel); return e ? getComputedStyle(e)[eig] : ''; };
  return {
    grundDunkel: getComputedStyle(document.body).backgroundColor,
    grundHell: f('#belege', 'backgroundColor'),
    vorzeileDunkel: f('.abs.nacht .vorzeile', 'color'),
    vorzeileHell: f('.abs.hell .vorzeile', 'color'),
    knopf: f('.held .btn.primaer', 'backgroundColor'),
    live: f('.protokoll li.live .wo', 'color'),
    andereZeile: f('.protokoll li:not(.live) .wo', 'color'),
    cockpitGrund: f('.cockpit', 'backgroundColor'),
  };
});
check('KRITISCH: der dunkle Grund der Homepage ist der dunkle Grund des Cockpits', farben.grundDunkel === rgb(marke(dunkel, 'bg')));
check('KRITISCH: der Cockpit-Bildschirm im Kopfbereich traegt den dunklen Cockpit-Grund', farben.cockpitGrund === rgb(marke(dunkel, 'bg')));
check('Der helle Grund der Homepage ist der helle Grund des Cockpits', farben.grundHell === rgb(marke(hell, 'bg')));
check('KRITISCH: Blau bedient -- die Vorzeile traegt auf dunklem Grund den dunklen, auf hellem den hellen Cockpit-Akzent',
  farben.vorzeileDunkel === rgb(marke(dunkel, 'accent')) && farben.vorzeileHell === rgb(marke(hell, 'accent')));
const kanal = t => (t.match(/\d+/g) || []).slice(0, 3).map(Number);
const [kr, kg, kb] = kanal(farben.knopf);
check('KRITISCH: der Demo-Knopf ist blau, nicht bernsteinfarben', kb > kr + 60 && kb > kg);
check('Bernstein meldet -- nur der laufende Rundgang traegt die Warnfarbe des Cockpits, die uebrigen Zeilen Blau',
  farben.live === rgb(marke(dunkel, 'warn')) && farben.andereZeile === rgb(marke(dunkel, 'accent')));

const masseDesktop = await desktop.evaluate(() => ({
  ueberlauf: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  kopfKnoepfe: [...document.querySelectorAll('.kopf .btn')].filter(b => b.getBoundingClientRect().width > 0).length,
  menueSichtbar: getComputedStyle(document.getElementById('menuKnopf')).display !== 'none',
  navSichtbar: getComputedStyle(document.getElementById('nav')).display !== 'none',
}));
check('KRITISCH: kein horizontaler Ueberlauf am Desktop', masseDesktop.ueberlauf === 0);
check('KRITISCH: der Demo-Knopf steht in der Kopfleiste genau einmal (Desktop)', masseDesktop.kopfKnoepfe === 1);
check('Am Desktop ist die Navigation sichtbar und der Menue-Knopf nicht',
  masseDesktop.navSichtbar && !masseDesktop.menueSichtbar);
await desktop.screenshot({ path: `${OUT}/homepage-01-desktop.png` });

// ── Formular: nichts geht ohne Pflichtangaben, dann genau ein Aufruf ────
await klick(desktop, '#demoKnopf');
await desktop.waitForTimeout(200);
check('KRITISCH: ohne Pflichtangaben geht kein Aufruf zum Server', aufrufe.length === 0);
check('Die leeren Pflichtfelder sind als ungueltig markiert und eine Meldung steht da',
  await desktop.evaluate(() =>
    document.querySelector('[name="firma"]').getAttribute('aria-invalid') === 'true'
    && document.querySelector('[name="email"]').getAttribute('aria-invalid') === 'true'
    && document.getElementById('demoMeldung').classList.contains('zeigen')));

check('Das Fallenfeld ist da, aber fuer Menschen nicht sichtbar',
  await desktop.evaluate(() => {
    const f = document.querySelector('[name="website"]'); if (!f) { return false; }
    const r = f.getBoundingClientRect();
    // Ausserhalb des Bildschirms -- Playwright's isVisible() hielte das
    // Feld fuer sichtbar, darum wird die Lage gemessen, nicht gefragt.
    return r.right < 0 || r.width <= 1;
  }));

await fuell(desktop, '[name="firma"]', 'Muster Sicherheitsdienst AG');
await fuell(desktop, '[name="name"]', 'A. Beispielperson');
await fuell(desktop, '[name="email"]', 'a.beispiel@example.invalid');
await fuell(desktop, '[name="nachricht"]', 'Revierdienst mit Kundenportal');
await klick(desktop, '#demoKnopf');
await desktop.waitForTimeout(400);
check('KRITISCH: mit Pflichtangaben geht genau EIN Aufruf zum Server', aufrufe.length === 1);
const a = aufrufe[0] || {};
check('KRITISCH: der Aufruf ist ein POST mit JSON und traegt die Felder',
  a.methode === 'POST' && /application\/json/.test(a.typ) && a.daten
  && a.daten.firma === 'Muster Sicherheitsdienst AG' && a.daten.email === 'a.beispiel@example.invalid'
  && a.daten.nachricht === 'Revierdienst mit Kundenportal');
check('KRITISCH: das Fallenfeld wird leer mitgeschickt (ein Mensch fuellt es nicht)',
  a.daten && a.daten.website === '');
check('Nach dem Erfolg steht die Antwort des Servers da und die Felder sind weg',
  await desktop.isVisible('#demoDanke')
  && (await desktop.textContent('#demoDankeText')).includes('innert eines Arbeitstages')
  && !(await desktop.isVisible('#demoKnopf')));
await desktop.screenshot({ path: `${OUT}/homepage-02-gesendet.png`, fullPage: false });

// "Nicht eingerichtet" ist etwas anderes als "fehlgeschlagen": Die Meldung
// des Servers muss WOERTLICH ankommen, nicht durch einen Einheitstext ersetzt.
await desktop.reload({ waitUntil: 'load' });
antwort = { status: 503, body: { status: 'error', message: 'Der Empfang von Anfragen ist noch nicht eingerichtet: Im Cockpit fehlt die E-Mail-Adresse des Betriebs.' } };
await fuell(desktop, '[name="firma"]', 'Muster Sicherheitsdienst AG');
await fuell(desktop, '[name="name"]', 'A. Beispielperson');
await fuell(desktop, '[name="email"]', 'a.beispiel@example.invalid');
await klick(desktop, '#demoKnopf');
await desktop.waitForTimeout(400);
check('KRITISCH: die Fehlermeldung des Servers erscheint woertlich ("nicht eingerichtet"), als Fehler gekennzeichnet',
  (await desktop.textContent('#demoMeldung')).includes('noch nicht eingerichtet')
  && await desktop.evaluate(() => document.getElementById('demoMeldung').classList.contains('fehler'))
  && !(await desktop.isVisible('#demoDanke')));
check('Der Knopf ist danach wieder bedienbar',
  await desktop.evaluate(() => !document.getElementById('demoKnopf').disabled));
await desktop.close();

// ── Handy ──────────────────────────────────────────────────────────────
const handy = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await handy.goto(SEITE, { waitUntil: 'load' });
await handy.evaluate(() => document.fonts.ready);
const masseHandy = await handy.evaluate(() => {
  const sichtbar = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const knoepfe = [...document.querySelectorAll('.btn, button, .faq summary')].filter(sichtbar);
  const felder = [...document.querySelectorAll('.formular input:not(.falle input), .formular select, .formular textarea')]
    .filter(sichtbar).filter(e => e.name !== 'website');
  return {
    ueberlauf: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    kleinsterKnopf: Math.min(...knoepfe.map(k => k.getBoundingClientRect().height)),
    kleinsteSchrift: Math.min(...felder.map(f => parseFloat(getComputedStyle(f).fontSize))),
    kopfKnoepfe: [...document.querySelectorAll('.kopf .btn')].filter(sichtbar).length,
    menueSichtbar: sichtbar(document.getElementById('menuKnopf')),
    h1Breite: document.querySelector('h1').getBoundingClientRect().width,
    breite: document.documentElement.clientWidth,
  };
});
check('KRITISCH: kein horizontaler Ueberlauf auf dem Handy', masseHandy.ueberlauf === 0);
check('KRITISCH: jedes Bedienelement ist auf dem Handy mindestens 44 px hoch', masseHandy.kleinsterKnopf >= 44);
check('KRITISCH: jedes Eingabefeld hat auf dem Handy mindestens 16 px Schrift (sonst zoomt iOS)', masseHandy.kleinsteSchrift >= 16);
check('Auf dem Handy traegt die Kopfleiste den Menue-Knopf und keinen zweiten Demo-Knopf',
  masseHandy.menueSichtbar && masseHandy.kopfKnoepfe === 0);
check('Die Ueberschrift bleibt innerhalb des Bildschirms', masseHandy.h1Breite <= masseHandy.breite);

// Das Menue oeffnet sich und jeder Eintrag ist eine volle Trefferflaeche.
await klick(handy, '#menuKnopf');
await handy.waitForTimeout(150);
const menue = await handy.evaluate(() => {
  const nav = document.getElementById('nav');
  const eintraege = [...nav.querySelectorAll('a')].map(a => a.getBoundingClientRect().height);
  return { offen: getComputedStyle(nav).display !== 'none', kleinster: Math.min(...eintraege),
    aria: document.getElementById('menuKnopf').getAttribute('aria-expanded') };
});
check('Das Menue oeffnet sich auf dem Handy und sagt das auch (aria-expanded)', menue.offen && menue.aria === 'true');
check('Jeder Menueeintrag ist mindestens 44 px hoch', menue.kleinster >= 44);
await handy.screenshot({ path: `${OUT}/homepage-03-handy-menue.png` });
await handy.close();

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
