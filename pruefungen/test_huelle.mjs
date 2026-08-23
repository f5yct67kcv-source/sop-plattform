// Drei Hüllenzustände: 232 px — 64 px — Kopfleiste (ENT-086).
//
// Diese Suite misst am gerenderten Zustand, nicht im Quelltext. Eine
// CSS-Regel kann wirkungslos bleiben, ohne dass etwas kaputtgeht -- durch
// eine spaetere Regel gleicher oder hoeherer Eigenspezifitaet. Wer eine
// Gestaltungsaenderung nicht misst, weiss nicht, ob sie greift.
//
// Der teuerste Fehler waere hier nicht ein falscher Pixelwert, sondern ein
// Zustand, in dem ein Menuepunkt UNERREICHBAR wird, ohne dass es jemandem
// auffaellt -- genau das war bis hierher im schmalen Modus der Fall:
// "Objekte" und "Rapporte" liessen sich dort gar nicht anwaehlen.
//
// Alle Testdaten sind erfunden.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const URL = `file://${WURZEL}/dashboard.html`;
const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const browser = await chromium.launch({ executablePath: EXE });

async function seite(w, h) {
  const p = await browser.newPage({ viewport: { width: w, height: h } });
  p.setDefaultTimeout(5000);
  await p.route('**/api/**', r => {
    const pf = r.request().url().split('/api/')[1].split('?')[0];
    const send = b => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (pf.includes('login')) return send({ status: 'ok', token: 't', name: 'adrian', ist_admin: true });
    if (pf.includes('feiertag')) return send({ status: 'ok', kanton: 'SO', feiertage: [], gepflegt: {} });
    return send({ status: 'ok', kpi: {}, verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [],
      rapporte: [], objekte: [], masterschichten: [], einsaetze: [], kunden: [], mitarbeiter: [], orte: [] });
  });
  await p.goto(URL);
  await p.fill('#gName', 'adrian'); await p.fill('#gPass', 'x'); await p.click('#gBtn');
  await p.waitForSelector('#shell.on'); await p.waitForTimeout(500);
  return p;
}

const mass = (p, sel) => p.evaluate(s => {
  const e = document.querySelector(s);
  if (!e) { return null; }
  const r = e.getBoundingClientRect();
  const c = getComputedStyle(e);
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
           display: c.display, position: c.position, ml: c.marginLeft, pt: c.paddingTop };
}, sel);

const zustand = p => p.evaluate(() => {
  const sh = document.getElementById('shell');
  return { schmal: sh.classList.contains('schmal'), aus: sh.classList.contains('aus'),
           sideW: getComputedStyle(sh).getPropertyValue('--side-w').trim() };
});

// ══════════════════════════════ BREITBILD: der volle Zyklus
{
  const p = await seite(1600, 900);

  let z = await zustand(p);
  let side = await mass(p, '#side'), main = await mass(p, '.main');
  check('Startzustand ist die volle Leiste', !z.schmal && !z.aus && z.sideW === '232px');
  check('Die Leiste ist tatsaechlich 232 px breit (gemessen)', side.w === 232);
  check('Der Inhalt beginnt genau dahinter', main.ml === '232px');
  const breiteVoll = (await mass(p, '.content')).w;

  await p.click('#btnSchmal'); await p.waitForTimeout(250);
  z = await zustand(p); side = await mass(p, '#side');
  check('KRITISCH: ein Klick fuehrt in den schmalen Zustand', z.schmal && !z.aus);
  check('Gemessen 64 px', side.w === 64);

  await p.click('#btnSchmal'); await p.waitForTimeout(250);
  z = await zustand(p); side = await mass(p, '#side'); main = await mass(p, '.main');
  const top = await mass(p, '.topbar');
  check('KRITISCH: der zweite Klick blendet die Leiste aus', z.aus && !z.schmal);
  check('KRITISCH: sie liegt jetzt waagrecht ueber die volle Breite', side.w === 1600 && side.x === 0 && side.y === 0);
  check('Und ist so hoch wie die Werkzeugleiste (60 px)', side.h === 60);
  check('Der Inhalt rueckt nicht mehr zur Seite', main.ml === '0px');
  check('Sondern nach unten -- die Leiste verdeckt ihn nicht', main.pt === '60px');
  check('Die Werkzeugleiste klebt unter der Navigation, nicht darueber', top.y === 60);

  const breiteAus = (await mass(p, '.content')).w;
  check('KRITISCH: der gewonnene Platz wird zu Inhalt, nicht zu Rand',
    breiteAus > breiteVoll);

  await p.click('#btnSchmal'); await p.waitForTimeout(250);
  z = await zustand(p);
  check('Der dritte Klick fuehrt zurueck zum Anfang', !z.schmal && !z.aus);

  await p.screenshot({ path: `${OUT}/huelle-voll.png` });
  await p.close();
}

// ══════════════════════════════ UNTERMENUE -- die geschlossene Luecke
{
  const p = await seite(1600, 900);
  await p.click('#btnSchmal'); await p.waitForTimeout(250);   // schmal

  let kinder = await mass(p, '#navg-kunden .nav-kinder');
  check('Im schmalen Zustand ist das Untermenue zunaechst zu', kinder.display === 'none');

  await p.click('#nav-kunden'); await p.waitForTimeout(250);
  kinder = await mass(p, '#navg-kunden .nav-kinder');
  const objekte = await mass(p, '#nav-kunden-objekte');
  check('KRITISCH: ein Klick oeffnet es als schwebendes Feld', kinder.display === 'block' && kinder.position === 'fixed');
  check('KRITISCH: "Objekte" ist damit erreichbar -- vorher war es das nicht',
    objekte.w > 0 && objekte.h > 0);
  check('Das Feld steht neben der Leiste, nicht darunter versteckt', kinder.x >= 64);
  check('Und ragt nicht aus dem Fenster', kinder.x + kinder.w <= 1600 && kinder.y + kinder.h <= 900);

  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  kinder = await mass(p, '#navg-kunden .nav-kinder');
  check('Escape schliesst es', kinder.display === 'none');

  await p.click('#nav-kunden'); await p.waitForTimeout(200);
  await p.mouse.click(800, 500); await p.waitForTimeout(250);
  kinder = await mass(p, '#navg-kunden .nav-kinder');
  check('Ein Klick daneben schliesst es ebenfalls', kinder.display === 'none');

  await p.click('#nav-kunden'); await p.waitForTimeout(200);
  await p.evaluate(() => go('planung')); await p.waitForTimeout(250);
  kinder = await mass(p, '#navg-kunden .nav-kinder');
  check('Und ein Seitenwechsel laesst es nicht offen stehen', kinder.display === 'none');

  // Dasselbe im Kopfleisten-Zustand: das Feld haengt dann UNTER dem Symbol
  await p.click('#btnSchmal'); await p.waitForTimeout(250);   // aus
  await p.click('#nav-kunden'); await p.waitForTimeout(250);
  kinder = await mass(p, '#navg-kunden .nav-kinder');
  const knopf = await mass(p, '#nav-kunden');
  check('KRITISCH: in der Kopfleiste oeffnet dasselbe Feld nach unten',
    kinder.display === 'block' && kinder.y >= knopf.y + knopf.h);
  check('Es bleibt im Fenster', kinder.x >= 0 && kinder.x + kinder.w <= 1600);

  await p.screenshot({ path: `${OUT}/huelle-kopfleiste.png` });
  await p.close();
}

// ══════════════════════════════ EIN MARKUP, KEINE ZWEITE KOPIE
{
  const p = await seite(1600, 900);
  const doppelt = await p.evaluate(() => {
    const ids = [...document.querySelectorAll('[id]')].map(e => e.id);
    return ids.filter((v, i) => ids.indexOf(v) !== i);
  });
  check('KRITISCH: keine doppelten IDs -- die Kopfleiste ist keine zweite Kopie der Eintraege',
    doppelt.length === 0);

  const einer = await p.evaluate(() => document.querySelectorAll('#nav-kunden-objekte').length);
  check('Jeder Menuepunkt existiert genau einmal', einer === 1);
  await p.close();
}

// ══════════════════════════════ RUECKFALL AUF SCHMALEN BILDSCHIRMEN
{
  const p = await seite(1200, 800);
  await p.evaluate(() => huelleSetzen('aus'));
  await p.waitForTimeout(250);
  const z = await zustand(p), side = await mass(p, '#side');
  check('KRITISCH: unter 1281 px faellt "aus" auf die schmale Leiste zurueck', z.sideW === '64px');
  check('Sie bleibt dabei senkrecht, nicht halb umgebaut', side.h > 200 && side.w === 64);
  await p.close();
}

// ══════════════════════════════ DER ZUSTAND UEBERLEBT DAS NEULADEN
{
  const p = await seite(1600, 900);
  await p.click('#btnSchmal'); await p.click('#btnSchmal'); await p.waitForTimeout(250);
  check('Vor dem Neuladen: ausgeblendet', (await zustand(p)).aus);
  await p.reload();
  // Die Sitzung ueberlebt das Neuladen, die Anmeldemaske erscheint dann
  // gar nicht -- beide Wege zulassen, statt einen anzunehmen.
  await p.waitForTimeout(400);
  if (await p.isVisible('#gName')) {
    await p.fill('#gName', 'adrian'); await p.fill('#gPass', 'x'); await p.click('#gBtn');
  }
  await p.waitForSelector('#shell.on'); await p.waitForTimeout(500);
  check('KRITISCH: der Zustand ist nach dem Neuladen derselbe', (await zustand(p)).aus);
  await p.close();
}

// ══════════════════════════════ HANDY BLEIBT UNBERUEHRT
{
  const p = await seite(390, 780);
  const btn = await mass(p, '#btnSchmal');
  check('Auf dem Handy gibt es den Huellenschalter nicht', btn.display === 'none');
  const kompakt = await p.evaluate(() => huelleKompakt());
  check('KRITISCH: und der kompakte Zustand greift dort nicht', kompakt === false);
  await p.close();
}

// ══════════════════════════════ AUFKLAPPEN BEIM UEBERFAHREN
//
// Der ganze Block liegt in try/catch. Faellt das Ueberfahren aus, ist das
// eine FEHLGESCHLAGENE Pruefung -- kein Absturz der Suite. Eine Suite, die
// beim ersten Problem abbricht, verschweigt alles, was danach kaeme.
try {
  const p = await seite(1600, 900);
  await p.click('#btnSchmal'); await p.waitForTimeout(250);   // schmal

  await p.hover('#nav-kunden'); await p.waitForTimeout(250);
  let k = await mass(p, '#navg-kunden .nav-kinder');
  check('KRITISCH: Ueberfahren oeffnet das Untermenue', k.display === 'block');

  // Vom Symbol ins Feld wechseln -- der 6-px-Spalt darf es nicht zufallen lassen
  await p.hover('#nav-kunden-objekte'); await p.waitForTimeout(300);
  k = await mass(p, '#navg-kunden .nav-kinder');
  check('KRITISCH: der Weg zum Eintrag laesst es offen', k.display === 'block');

  // Wegfahren schliesst -- aber erst nach der Wartezeit
  await p.hover('#nav-uebersicht'); await p.waitForTimeout(120);
  k = await mass(p, '#navg-kunden .nav-kinder');
  check('Direkt nach dem Wegfahren ist es noch offen (Wartezeit)', k.display === 'block');
  await p.waitForTimeout(300);
  k = await mass(p, '#navg-kunden .nav-kinder');
  check('Danach schliesst es von selbst', k.display === 'none');

  // Ein Klick auf ein bereits offenes Menue fuehrt in den Bereich,
  // statt das eben Aufgegangene wieder zuzuklappen
  await p.evaluate(() => go('planung')); await p.waitForTimeout(200);
  await p.hover('#nav-kunden'); await p.waitForTimeout(250);
  await p.click('#nav-kunden'); await p.waitForTimeout(300);
  check('KRITISCH: Klick auf das offene Symbol fuehrt in den Bereich',
    (await p.textContent('#pgTitle')) === 'Kunden');

  await p.close();
} catch (e) {
  bad.push('Aufklappen beim Ueberfahren: ' + String(e).split('\n')[0].slice(0, 120));
}

// ══════════════════════════════ BREITE JE ANSICHT
{
  const p = await seite(1600, 900);
  const weit = async () => p.evaluate(() => document.querySelector('.content').classList.contains('weit'));

  for (const t of ['uebersicht', 'einsaetze', 'objektplan', 'tag']) {
    await p.evaluate(() => go('planung'));
    await p.evaluate(x => goTab(x), t); await p.waitForTimeout(250);
    check(`Planung/${t} nutzt die volle Breite`, await weit());
  }

  for (const v of ['abgleich', 'pensen', 'einsatzplan', 'masterschichten']) {
    await p.evaluate(x => go(x), v); await p.waitForTimeout(250);
    check(`${v} nutzt die volle Breite`, await weit());
  }

  // Und die Gegenrichtung: Wo Formulare stehen, bleibt die Lesebreite.
  // Ein 2500 px breites Formular ist nicht besser, sondern unlesbar.
  for (const v of ['uebersicht', 'betrieb', 'kunden', 'mitarbeiter']) {
    await p.evaluate(x => go(x), v); await p.waitForTimeout(250);
    check(`KRITISCH: ${v} behaelt die Lesebreite`, (await weit()) === false);
  }

  // Gemessen statt geglaubt, und im Zustand, in dem es zaehlt: ausgeblendete
  // Leiste, 1600 px Fenster. Die Einsatzliste nutzt sie ganz, die Kundenseite
  // bleibt beim Deckel von 1440 px. Der Unterschied ist der ganze Punkt.
  await p.evaluate(() => huelleSetzen('aus')); await p.waitForTimeout(250);
  await p.evaluate(() => go('planung'));
  await p.evaluate(() => goTab('einsaetze')); await p.waitForTimeout(250);
  const bEins = (await mass(p, '.content')).w;
  await p.evaluate(() => go('kunden')); await p.waitForTimeout(250);
  const bKund = (await mass(p, '.content')).w;
  check('KRITISCH: die Einsatzliste nutzt die ganze Breite', bEins === 1600);
  check('KRITISCH: die Kundenseite bleibt bei der Lesebreite', bKund === 1440);

  await p.close();
}

// ══════════════════════════════ BESCHRIFTUNG UNTER DEN SYMBOLEN
try {
  const p = await seite(1600, 900);
  await p.evaluate(() => huelleSetzen('aus')); await p.waitForTimeout(300);

  const lbl = await p.evaluate(() => [...document.querySelectorAll('.side-nav .nav-item .lbl')]
    .map(e => ({ text: e.textContent.trim(), sichtbar: e.getBoundingClientRect().height > 0 })));
  check('KRITISCH: die Hauptnavigation traegt Beschriftungen', lbl.length >= 6);
  check('KRITISCH: sie sind auch sichtbar, nicht nur vorhanden', lbl.every(l => l.sichtbar));
  check('Und tragen die erwarteten Namen',
    ['Übersicht', 'Planung', 'Abgleich', 'Kunden'].every(n => lbl.some(l => l.text === n)));

  // Ueberschrift oben, Wert darunter -- das Symbol steht ueber der Schrift
  const paar = await p.evaluate(() => {
    const it = document.querySelector('#nav-planung');
    const i = it.querySelector('svg.i').getBoundingClientRect();
    const l = it.querySelector('.lbl').getBoundingClientRect();
    return { symbolOben: i.top < l.top, drin: it.getBoundingClientRect().bottom <= 60 };
  });
  check('Das Symbol steht ueber der Beschriftung', paar.symbolOben);
  check('Und alles bleibt in der 60 px hohen Leiste', paar.drin);

  // Die Knoepfe im Fussteil bleiben bewusst ohne Schrift
  const fuss = await p.evaluate(() => {
    const e = document.querySelector('.side-foot .nav-item .lbl');
    return e ? e.getBoundingClientRect().height : 0;
  });
  check('Der Fussteil bleibt bei Symbolen', fuss === 0);

  // Mittig heisst: in der Mitte des Fensters, nicht in der Mitte des
  // Rests zwischen Logo und Fussteil. Die beiden sind verschieden breit --
  // ein Flex-Abstandhalter haette die Navigation sichtbar danebengesetzt.
  const mitte = await p.evaluate(() => {
    const n = document.querySelector('.side-nav').getBoundingClientRect();
    const b = document.querySelector('.side-brand').getBoundingClientRect();
    const f = document.querySelector('.side-foot').getBoundingClientRect();
    return { navMitte: Math.round(n.left + n.width / 2),
             fenster: Math.round(window.innerWidth / 2),
             brandLinks: Math.round(b.left), fussRechts: Math.round(f.right),
             breiteUngleich: Math.abs(b.width - f.width) > 20 };
  });
  check('KRITISCH: die Symbole stehen in der Mitte des Fensters',
    Math.abs(mitte.navMitte - mitte.fenster) <= 4);
  check('Und das, obwohl Logo und Fussteil verschieden breit sind',
    mitte.breiteUngleich);
  check('Das Logo bleibt links', mitte.brandLinks <= 20);
  check('Der Fussteil bleibt rechts', mitte.fussRechts >= 1600 - 20);
  await p.close();
} catch (e) { bad.push('Beschriftungen: ' + String(e).split('\n')[0].slice(0, 120)); }

// ══════════════════════════════ KEIN UEBERLAUF AM UNTEREN RAND (1281 px)
try {
  const p = await seite(1281, 800);
  await p.evaluate(() => huelleSetzen('aus')); await p.waitForTimeout(300);
  const platz = await p.evaluate(() => {
    const n = document.querySelector('.side-nav');
    const letzte = [...document.querySelectorAll('.side-foot .nav-item, .side-foot .side-user')].pop();
    return { ueberlauf: n.scrollWidth - n.clientWidth,
             rechts: letzte ? Math.round(letzte.getBoundingClientRect().right) : 0 };
  });
  check('KRITISCH: bei 1281 px laeuft die Navigation nicht ueber', platz.ueberlauf <= 1);
  check('KRITISCH: der letzte Knopf bleibt im Fenster', platz.rechts > 0 && platz.rechts <= 1281);
  await p.close();
} catch (e) { bad.push('Ueberlauf 1281: ' + String(e).split('\n')[0].slice(0, 120)); }

// ══════════════════════════════ UNTERKATEGORIEN IN DER WERKZEUGLEISTE
try {
  const p = await seite(1600, 900);

  // Voll ausgefahren: nicht noetig, die Seitenleiste zeigt sie selbst
  await p.evaluate(() => go('kunden')); await p.waitForTimeout(300);
  let ts = await mass(p, '#topSub');
  check('Bei voller Leiste bleibt die Werkzeugleiste frei', ts.display === 'none');

  await p.evaluate(() => huelleSetzen('aus')); await p.waitForTimeout(300);
  ts = await mass(p, '#topSub');
  const namen = await p.evaluate(() => [...document.querySelectorAll('#topSub button')].map(b => b.textContent));
  check('KRITISCH: kompakt erscheinen die Unterkategorien oben', ts.display === 'flex');
  check('KRITISCH: mit den richtigen Namen',
    JSON.stringify(namen) === JSON.stringify(['Adressen', 'Objekte', 'Rapporte']));
  const markiert = await p.evaluate(() => {
    const b = document.querySelector('#topSub button.on'); return b ? b.textContent : null; });
  check('Die aktuelle ist hervorgehoben', markiert === 'Adressen');

  // Der Klick fuehrt wirklich weiter
  await p.evaluate(() => [...document.querySelectorAll('#topSub button')].find(b => b.textContent === 'Objekte').click());
  await p.waitForTimeout(350);
  check('KRITISCH: ein Klick wechselt die Unterkategorie',
    (await p.textContent('#pgCrumb')).includes('Dauerauftr'));
  const m2 = await p.evaluate(() => {
    const b = document.querySelector('#topSub button.on'); return b ? b.textContent : null; });
  check('Und die Hervorhebung wandert mit', m2 === 'Objekte');

  // Administration: bis hierher war dort gar nichts markiert
  await p.evaluate(() => go('mitarbeiter')); await p.waitForTimeout(300);
  const n2 = await p.evaluate(() => [...document.querySelectorAll('#topSub button')].map(b => b.textContent));
  check('KRITISCH: auch die Administration zeigt ihre Unterkategorien',
    JSON.stringify(n2) === JSON.stringify(['Mitarbeitende', 'Betrieb']));

  // Ein Bereich ohne Untergruppen zeigt keine leere Leiste
  await p.evaluate(() => go('abgleich')); await p.waitForTimeout(300);
  ts = await mass(p, '#topSub');
  check('Ein Bereich ohne Unterkategorien zeigt keine leere Leiste', ts.display === 'none');

  await p.screenshot({ path: `${OUT}/huelle-kopf-beschriftet.png` });
  await p.close();
} catch (e) { bad.push('Unterkategorien: ' + String(e).split('\n')[0].slice(0, 120)); }

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
