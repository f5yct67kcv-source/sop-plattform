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

// ══════════════════════════════ KEIN UNTERMENUE AN DER LEISTE
//
// Bis 2026-08-23 klappte im kompakten Zustand ein schwebendes Feld an der
// Leiste auf. Der Projektinhaber: "dropdown und untertitel etwas too much".
// Er hat recht -- dieselbe Auswahl zweimal im selben Bild ist Doppelung.
// Die Unterkategorien stehen jetzt nur noch in der Werkzeugleiste.
try {
  const p = await seite(1600, 900);
  await p.click('#btnSchmal'); await p.waitForTimeout(250);   // schmal

  await p.click('#nav-kunden'); await p.waitForTimeout(350);
  const k = await mass(p, '#navg-kunden .nav-kinder');
  check('KRITISCH: an der Leiste klappt nichts mehr auf', k.display === 'none');
  check('KRITISCH: der Klick fuehrt stattdessen in den Bereich',
    (await p.textContent('#pgTitle')) === 'Kunden');
  const ts = await mass(p, '#topSub');
  check('Und die Unterkategorien stehen in der Werkzeugleiste', ts.display === 'flex');

  // Dasselbe im Kopfleisten-Zustand
  await p.evaluate(() => go('uebersicht')); await p.waitForTimeout(200);
  await p.click('#btnSchmal'); await p.waitForTimeout(250);   // aus
  await p.click('#nav-kunden'); await p.waitForTimeout(350);
  check('Auch in der Kopfleiste klappt nichts auf',
    (await mass(p, '#navg-kunden .nav-kinder')).display === 'none');
  check('Und der Bereich wird trotzdem erreicht',
    (await p.textContent('#pgTitle')) === 'Kunden');

  // Bei voller Leiste bleibt das Aufklappen wie bisher
  await p.click('#btnSchmal'); await p.waitForTimeout(250);   // voll
  await p.evaluate(() => go('kunden')); await p.waitForTimeout(250);
  // Zustand ablesen statt annehmen: Der Klick SCHALTET um, er oeffnet nicht.
  const vorher = await p.evaluate(() => document.getElementById('navg-kunden').classList.contains('offen'));
  if (vorher) { await p.click('#nav-kunden'); await p.waitForTimeout(250); }
  await p.click('#nav-kunden'); await p.waitForTimeout(300);
  check('Bei voller Leiste klappt die Gruppe weiterhin auf',
    (await mass(p, '#navg-kunden .nav-kinder')).display === 'block');
  check('Und "Objekte" ist dort direkt anklickbar',
    (await mass(p, '#nav-kunden-objekte')).h > 0);

  await p.screenshot({ path: `${OUT}/huelle-kopfleiste.png` });
  await p.close();
} catch (e) { bad.push('Untermenue: ' + String(e).split('\n')[0].slice(0, 120)); }

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

// ══════════════════════════════ AUCH AUF KLEINEREN BILDSCHIRMEN
//
// Die Grenze lag zuerst bei 1281 px -- geraten, nicht gemessen. Auf einem
// Notebook mit doppelter Aufloesung ist ein Fenster oft nur 1000 CSS-Pixel
// breit; dort fiel der dritte Zustand wortlos auf die schmale Leiste
// zurueck, und der Knopf sah aus, als tue er nichts. Gemessen braucht die
// Kopfleiste bei 1000 px nur 539 px.
{
  const p = await seite(1000, 800);
  await p.evaluate(() => huelleSetzen('aus'));
  await p.waitForTimeout(250);
  const z = await zustand(p), side = await mass(p, '#side'), main = await mass(p, '.main');
  check('KRITISCH: bei 1000 px erscheint die Kopfleiste wirklich', z.sideW === '0px');
  check('Sie liegt waagrecht ueber die volle Breite', side.w === 1000 && side.h === 60);
  check('Der Inhalt rueckt darunter', main.ml === '0px' && main.pt === '60px');
  const platz = await p.evaluate(() => {
    const n = document.querySelector('.side-nav').getBoundingClientRect();
    const b = document.querySelector('.side-brand').getBoundingClientRect();
    const f = document.querySelector('.side-foot').getBoundingClientRect();
    return { ueberlappt: n.left < b.right - 1 || n.right > f.left + 1,
             mittig: Math.abs((n.left + n.width / 2) - 500) <= 4 };
  });
  check('KRITISCH: nichts ueberlappt bei 1000 px', platz.ueberlappt === false);
  check('Und die Symbole stehen auch dort mittig', platz.mittig);
  await p.close();
}

// ══════════════════════════════ HANDYBREITE BLEIBT DIE SCHUBLADE
{
  const p = await seite(800, 800);
  await p.evaluate(() => huelleSetzen('aus'));
  await p.waitForTimeout(250);
  const kompakt = await p.evaluate(() => huelleKompakt());
  const main = await mass(p, '.main');
  check('KRITISCH: unter 901 px greift der kompakte Zustand nicht', kompakt === false);
  check('Der Inhalt bekommt keinen Kopfleisten-Abstand', main.pt !== '60px');
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

  // Mittig -- und zwar unabhaengig davon, WIE VIELE es sind und wie lang
  // der Titel links ist. Mit einem Flex-Abstandhalter waere die Leiste bei
  // "Kunden" anders platziert als bei "Administration", weil Titel und
  // Knopfgruppe verschieden breit sind. Das Raster haelt sie an derselben
  // Stelle.
  const mitteVon = async (fn) => {
    await p.evaluate(fn); await p.waitForTimeout(300);
    return p.evaluate(() => {
      const e = document.querySelector('#topSub');
      const r = e.getBoundingClientRect();
      return { anzahl: e.children.length, mitte: Math.round(r.left + r.width / 2),
               breite: Math.round(r.width) };
    });
  };
  const mKunden = await mitteVon(() => go('kunden'));
  const mAdmin  = await mitteVon(() => go('mitarbeiter'));
  check('Bei den Kunden stehen drei Unterkategorien', mKunden.anzahl === 3);
  check('Bei der Administration zwei', mAdmin.anzahl === 2);
  check('KRITISCH: drei Unterkategorien stehen in der Fenstermitte',
    Math.abs(mKunden.mitte - 800) <= 4);
  check('KRITISCH: zwei ebenfalls -- die Zahl aendert die Mitte nicht',
    Math.abs(mAdmin.mitte - 800) <= 4);
  check('Und die Leisten sind wirklich verschieden breit',
    Math.abs(mKunden.breite - mAdmin.breite) > 20);

  // Ohne Unterkategorien darf die rechte Gruppe NICHT in die Mitte rutschen.
  // Ein Element mit display:none ist kein Rasterfeld -- ohne ausdrueckliche
  // Spaltenzuweisung legt die Automatik die verbleibenden zwei Kinder in
  // Spalte 1 und 2, und die Knopfgruppe sitzt mitten im Kopf.
  await p.evaluate(() => go('abgleich')); await p.waitForTimeout(300);
  const rechts = await p.evaluate(() => {
    const r = document.querySelector('.tb-rechts').getBoundingClientRect();
    return Math.round(window.innerWidth - r.right);
  });
  check('KRITISCH: ohne Unterkategorien bleibt die Knopfgruppe rechts aussen',
    rechts <= 30);

  // Die Uebersicht hat keine Unterkategorien -- zeigte aber die der Kunden.
  // Ursache war ein Suffix-Vergleich: go('uebersicht') traf die ID
  // "nav-kunden-uebersicht" und markierte damit "Adressen".
  await p.evaluate(() => go('kunden')); await p.waitForTimeout(250);
  await p.evaluate(() => go('uebersicht')); await p.waitForTimeout(300);
  const ue = await mass(p, '#topSub');
  const kindMarkiert = await p.evaluate(() => document.querySelectorAll('.nav-kind.on').length);
  check('KRITISCH: die Uebersicht zeigt keine fremden Unterkategorien', ue.display === 'none');
  check('Und markiert auch keine', kindMarkiert === 0);

  await p.screenshot({ path: `${OUT}/huelle-kopf-beschriftet.png` });
  await p.close();
} catch (e) { bad.push('Unterkategorien: ' + String(e).split('\n')[0].slice(0, 120)); }

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
