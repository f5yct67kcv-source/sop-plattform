// Groesse je Container: Hoehe ziehen, Breite umschalten, auf freier Flaeche
// ablegen (ENT-098).
//
// Vom Projektinhaber am 2026-08-23: "bei der markierten fläche, kann man
// nichts hinschieben. optimal wäre, wen man die grösse der Kacheln selber
// anpassen in der vertikalen länge".
//
// Der teuerste Fehler waere hier nicht ein Griff, der nicht zieht, sondern
// eine Groesse, die sich einstellen laesst und beim naechsten Laden still
// wieder weg ist. Beides wird gemessen, nicht im Quelltext nachgelesen.
//
// Alle Testdaten sind erfunden.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const URL = `file://${WURZEL}/dashboard.html`;
const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const browser = await chromium.launch({ executablePath: EXE });

async function seite(vorbelegt, breite = 1600, rapporte = 0) {
  const p = await browser.newPage({ viewport: { width: breite, height: 1000 } });
  p.setDefaultTimeout(5000);
  p.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
  if (vorbelegt !== undefined) {
    await p.addInitScript(v => { try { localStorage.setItem('rv3_dash_layout', v); } catch (e) {} }, vorbelegt);
    // Der einmalige Umzug aus ENT-410 (Begruessung auf halbe Breite, "Datum
    // & Zeit" daneben) wird hier abgehakt: Diese Suite prueft die Mechanik
    // mit einer VORGEGEBENEN Anordnung, und ein Umzug, der sie beim Laden
    // umschreibt, prueft etwas anderes als das, was draufsteht. Den Umzug
    // selbst prueft test_zeitkarte.mjs -- dort ohne diesen Merker.
    await p.addInitScript(() => { try { localStorage.setItem('rv3_dash_zeit_umzug', '2'); } catch (e) {} });
  }
  await p.route('**/api/**', r => {
    const pf = r.request().url().split('/api/')[1].split('?')[0];
    const send = b => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (pf.includes('login')) return send({ status: 'ok', token: 't', name: 'adrian', ist_admin: true });
    if (pf.includes('dashboard_stats')) return send({ status: 'ok',
      kpi: { rapporte_monat: 6, stunden_monat: 38, mitarbeiter: 5, kunden: 3, rapporte_total: 6,
             rapporte_vormonat: 0, stunden_vormonat: 0 },
      verlauf: Array.from({ length: 8 }, (_, i) => ({ kw: 26 + i, stunden: [12, 30, 18, 44, 26, 38, 9, 41][i], anzahl: 3 })),
      angemeldet: [], pro_mitarbeiter: [], ereignisse: [],
      // Erfundene Zeilen, nur damit der Rumpf ueberlaeuft.
      letzte_rapporte: Array.from({ length: rapporte }, (_, i) => ({
        id: i + 1, datum: '2026-01-0' + ((i % 9) + 1), name: 'person' + i, vorname: 'Vorname', nachname: 'Nachname' + i,
        kunde_name: 'Kunde ' + i, ort: 'Ort', einsatzart: 'Verkehrsdienst', netto_h: '7.50' })),
      ereignisse_gesamt: 0, ereignisse_gekuerzt: false, ereignisse_unvollstaendig: [] });
    return send({ status: 'ok', rapporte: [], objekte: [], masterschichten: [], einsaetze: [],
      kunden: [], mitarbeiter: [], orte: [], feiertage: [], gepflegt: {}, sperren: [] });
  });
  await p.goto(URL);
  await p.fill('#gName', 'adrian'); await p.fill('#gPass', 'x'); await p.click('#gBtn');
  await p.waitForSelector('#shell.on'); await p.waitForTimeout(500);
  return p;
}
// Gemessen wird der INHALT, nicht der Container: Im Bearbeitungsmodus traegt
// dieser oben 38 px Luft fuer die Werkzeugleiste. Wer die Aussenkante
// vergleicht, vergleicht zwei verschiedene Dinge und haelt einen Unterschied
// von 38 px faelschlich fuer einen Fehler -- oder, schlimmer, uebersieht
// einen echten, weil er die Toleranz danach zu gross waehlt.
const rahmen = (p, id) => p.evaluate(w => {
  const el = document.querySelector(`.dash-item[data-widget="${w}"]`);
  const r = el.getBoundingClientRect();
  const k = (el.querySelector(':scope > .card, :scope > .grid') || el).getBoundingClientRect();
  return { h: Math.round(k.height), b: Math.round(r.width), o: Math.round(r.top), l: Math.round(r.left),
           aussen: Math.round(r.height) };
}, id);
const gespeichert = p => p.evaluate(() => JSON.parse(localStorage.getItem('rv3_dash_layout') || 'null'));

// ══════════════════════════════ VIER KENNZAHLEN, NIE DREI PLUS EINE
try {
  const p = await seite();
  for (const [breite, spalten] of [[1600, 2], [2400, 2]]) {
    await p.setViewportSize({ width: breite, height: 1000 });
    await p.waitForTimeout(250);
    const m = await p.evaluate(() => {
      const k = [...document.querySelectorAll('#kpiGrid > *')];
      return { zeilen: new Set(k.map(e => Math.round(e.getBoundingClientRect().top))).size,
               spalten: new Set(k.map(e => Math.round(e.getBoundingClientRect().left))).size,
               anzahl: k.length };
    });
    check(`KRITISCH: bei ${breite} px stehen die vier Kennzahlen zwei mal zwei`,
      m.anzahl === 4 && m.spalten === spalten && m.zeilen === 2);
  }
  await p.setViewportSize({ width: 1600, height: 1000 });
  await p.waitForTimeout(200);
  await p.close();
} catch (e) { bad.push('Kennzahlen: ' + String(e).split('\n')[0].slice(0, 120)); }

// ══════════════════════════════ VOLLE BREITE OHNE UMWEG
//
// Die Uebersicht ist die einzige Ansicht, die man erreicht, OHNE zu
// navigieren -- wer sich anmeldet, steht schon darauf. Wird die Breite nur in
// go() gesetzt, gilt sie erst nach dem ersten Ansichtswechsel.
// Bei 1600 px waere der Deckel von 1440 px gar nicht wirksam -- die Flaeche
// ist ohnehin schmaler. Erst ein breites Fenster zeigt, ob er faellt.
try {
  const p = await seite(undefined, 2200);
  const m = await p.evaluate(() => {
    const c = document.querySelector('.content');
    return { deckel: getComputedStyle(c).maxWidth,
             flow: Math.round(document.getElementById('dashFlow').getBoundingClientRect().width) };
  });
  check('KRITISCH: die volle Breite gilt schon beim Anmelden, ohne Ansichtswechsel',
    m.deckel === 'none' && m.flow > 1500);
  await p.close();
} catch (e) { bad.push('Startbreite: ' + String(e).split('\n')[0].slice(0, 120)); }

// ══════════════════════════════ HOEHE ZIEHEN
try {
  const p = await seite();
  check('Ausserhalb des Bearbeitens ist kein Höhengriff sichtbar',
    (await p.isVisible('.dash-item[data-widget="kurzwahl"] .dash-griff-h')) === false);

  await p.click('#btnDashBearbeiten'); await p.waitForTimeout(250);
  check('KRITISCH: im Bearbeiten erscheint der Höhengriff',
    await p.isVisible('.dash-item[data-widget="kurzwahl"] .dash-griff-h'));

  const vorher = await rahmen(p, 'kurzwahl');
  const griff = await p.locator('.dash-item[data-widget="kurzwahl"] .dash-griff-h').boundingBox();
  await p.mouse.move(griff.x + griff.width / 2, griff.y + griff.height / 2);
  await p.mouse.down();
  await p.mouse.move(griff.x + griff.width / 2, griff.y + griff.height / 2 + 150, { steps: 8 });
  await p.mouse.up();
  await p.waitForTimeout(250);
  const nachher = await rahmen(p, 'kurzwahl');
  // Nicht nur "hoeher", sondern um GENAU den gezogenen Betrag. Ein Zug, der
  // 150 px nach unten geht und 188 px zulegt, sieht richtig aus und ist
  // falsch: Der Container traegt im Bearbeitungsmodus oben 38 px Luft fuer
  // die Werkzeugleiste, und wer gegen seine Aussenkante misst, rechnet sie
  // jedes Mal mit ein.
  check('KRITISCH: der Container wächst um genau den gezogenen Betrag',
    Math.abs((nachher.h - vorher.h) - 150) <= 6);

  // Nicht ins Bodenlose. Gemessen am GESPEICHERTEN Wert, nicht an der
  // gezeichneten Hoehe: Eine negative Hoehe ist als CSS ungueltig und wird
  // still verworfen -- der Container saehe dann richtig aus und truege
  // trotzdem Unsinn, der beim naechsten Laden mitwandert.
  await p.mouse.move(griff.x + griff.width / 2, nachher.o + nachher.aussen - 4);
  await p.mouse.down();
  await p.mouse.move(griff.x + griff.width / 2, nachher.o - 900, { steps: 10 });
  await p.mouse.up();
  await p.waitForTimeout(250);
  const wert = await p.evaluate(() => (ordEntwurf.find(x => x.id === 'kurzwahl') || {}).hoehe);
  check('KRITISCH: die Höhe hat eine Untergrenze', wert >= 140);
  check('Und der Container bleibt sichtbar', (await rahmen(p, 'kurzwahl')).h >= 140);

  await p.dblclick('.dash-item[data-widget="kurzwahl"] .dash-griff-h');
  await p.waitForTimeout(250);
  const auto = await rahmen(p, 'kurzwahl');
  check('KRITISCH: Doppelklick stellt die Höhe wieder auf automatisch',
    Math.abs(auto.h - vorher.h) <= 2);
  await p.close();
} catch (e) { bad.push('Höhe: ' + String(e).split('\n')[0].slice(0, 120)); }

// ══════════════════════════════ DER INHALT FUELLT DIE HOEHE
//
// Vom Projektinhaber am 2026-08-23: "der inhalt innerhalb der kacheln passt
// nicht an die grösse". Eine gesetzte Hoehe, die nur den Rahmen aufzieht und
// darunter Leere laesst, ist keine Groesseneinstellung, sondern ein Loch.
try {
  const p = await seite(JSON.stringify([
    { id: 'begruessung', sichtbar: true, hoehe: 420 }, { id: 'kpi', sichtbar: true, hoehe: 420 },
    { id: 'kurzwahl', sichtbar: true, hoehe: 420 }, { id: 'verlauf', sichtbar: true, hoehe: 420 },
  ]));
  const m = await p.evaluate(() => {
    const karte = id => document.querySelector(`[data-widget="${id}"] > .card`).getBoundingClientRect();
    const rumpf = id => document.querySelector(`[data-widget="${id}"] > .card > .card-bd`).getBoundingClientRect();
    const k = karte('kurzwahl'), r = rumpf('kurzwahl');
    return {
      kartenHoehe: Math.round(k.height),
      rumpfEndetMitKarte: Math.abs(r.bottom - k.bottom) < 2,
      kwGrid: Math.round(document.querySelector('#kwGrid').getBoundingClientRect().height),
      // Nicht nur "das Raster ist hoch", sondern: Der letzte Weg steht auch
      // wirklich unten. Ein Raster kann hoch sein und seine Zeilen trotzdem
      // oben zusammendraengen.
      letzterWegUnten: (() => {
        const w = [...document.querySelectorAll('#kwGrid .kw')];
        const r = document.querySelector('[data-widget="kurzwahl"] > .card > .card-bd').getBoundingClientRect();
        return r.bottom - w[w.length - 1].getBoundingClientRect().bottom;
      })(),
      rumpfInnen: Math.round(r.height),
      kpiRaster: Math.round(document.querySelector('#kpiGrid').getBoundingClientRect().height),
      kpiKachel: Math.round(document.querySelector('#kpiGrid > *').getBoundingClientRect().height),
      balken: Math.round(document.querySelector('.bars').getBoundingClientRect().height),
      textarea: Math.round(document.querySelector('#rtText').getBoundingClientRect().height),
    };
  });
  check('KRITISCH: die Karte ist genau so hoch wie eingestellt', m.kartenHoehe === 420);
  check('KRITISCH: der Rumpf reicht bis ans untere Ende der Karte', m.rumpfEndetMitKarte);
  check('KRITISCH: der Schnellzugriff füllt den Rumpf, statt oben zu kleben',
    m.kwGrid >= m.rumpfInnen - 40 && m.letzterWegUnten < 30);
  check('KRITISCH: das Kennzahlen-Raster füllt die eingestellte Höhe', m.kpiRaster === 420);
  check('KRITISCH: und die einzelne Kachel wächst mit', m.kpiKachel > 150);
  check('KRITISCH: das Balkenbild füllt den Rumpf', m.balken >= m.rumpfInnen - 40);
  check('Das Eingabefeld der Begrüssung nimmt die zusätzliche Höhe', m.textarea > 150);
  await p.screenshot({ path: `${OUT}/inhalt-fuellt.png` });
  await p.close();
} catch (e) { bad.push('Inhalt füllt: ' + String(e).split('\n')[0].slice(0, 120)); }

// Das Balkenbild rechnete bis zum 23.08.2026 feste 108 px. Es sah bei jeder
// Kartenhoehe gleich aus -- der teuerste Fall, weil es aussieht wie gewollt.
try {
  const hoehen = [];
  for (const h of [300, 620]) {
    const p = await seite(JSON.stringify([{ id: 'verlauf', sichtbar: true, hoehe: h },
                                          { id: 'begruessung', sichtbar: true }]));
    hoehen.push(await p.evaluate(() => Math.round(Math.max(...[...document.querySelectorAll('.bar-fill')]
      .map(e => e.getBoundingClientRect().height)))));
    await p.close();
  }
  check('KRITISCH: der höchste Balken wächst mit der Kartenhöhe',
    hoehen[1] > hoehen[0] + 100);
} catch (e) { bad.push('Balken: ' + String(e).split('\n')[0].slice(0, 120)); }

// Eine gesetzte Hoehe ist eine HOEHE, keine Mindesthoehe: Mehr Inhalt als
// Platz muss rollen, nicht die Karte aufblaehen -- sonst verschoebe ein
// voller Tag die ganze Anordnung.
try {
  const p = await seite(JSON.stringify([{ id: 'letzte', sichtbar: true, hoehe: 240 },
                                        { id: 'begruessung', sichtbar: true }]), 1600, 40);
  const m = await p.evaluate(() => {
    const k = document.querySelector('[data-widget="letzte"] > .card');
    const b = k.querySelector('.card-bd');
    return { karte: Math.round(k.getBoundingClientRect().height),
             rollt: b.scrollHeight > b.clientHeight + 4 };
  });
  check('KRITISCH: zu viel Inhalt bläht die Karte nicht auf', m.karte === 240);
  check('KRITISCH: sondern der Rumpf rollt', m.rollt);
  await p.close();
} catch (e) { bad.push('Rollen: ' + String(e).split('\n')[0].slice(0, 120)); }

// ══════════════════════════════ BREITE UMSCHALTEN
try {
  const p = await seite();
  await p.click('#btnDashBearbeiten'); await p.waitForTimeout(250);
  const halb = await rahmen(p, 'kurzwahl');
  const flow = await p.evaluate(() => Math.round(document.getElementById('dashFlow').getBoundingClientRect().width));
  check('Vorher steht der Container auf halber Breite', Math.abs(halb.b - (flow - 16) / 2) < 2);

  await p.click('.dash-item[data-widget="kurzwahl"] .dash-breite'); await p.waitForTimeout(250);
  const voll = await rahmen(p, 'kurzwahl');
  check('KRITISCH: ein Klick macht ihn voll breit', Math.abs(voll.b - flow) < 2);

  await p.click('.dash-item[data-widget="kurzwahl"] .dash-breite'); await p.waitForTimeout(250);
  check('KRITISCH: und der zweite wieder halb',
    Math.abs((await rahmen(p, 'kurzwahl')).b - (flow - 16) / 2) < 2);

  // Die Ereignisse stehen voll -- an ihnen muss der Schalter in die andere
  // Richtung zeigen, sonst behauptet das Bild das Gegenteil der Wirkung.
  const richtung = await p.evaluate(() => {
    const el = document.querySelector('.dash-item[data-widget="ereignisse"]');
    return getComputedStyle(el.querySelector('.i-breit-zu')).display !== 'none'
        && getComputedStyle(el.querySelector('.i-breit-auf')).display === 'none';
  });
  check('Am vollen Container zeigt der Schalter nach innen', richtung);
  await p.close();
} catch (e) { bad.push('Breite: ' + String(e).split('\n')[0].slice(0, 120)); }

// ══════════════════════════════ GESPEICHERT UND WIEDER DA
//
// Der teuerste Fehler: Die Groesse laesst sich einstellen und ist beim
// naechsten Laden still wieder weg.
try {
  const p = await seite();
  await p.click('#btnDashBearbeiten'); await p.waitForTimeout(250);
  const griff = await p.locator('.dash-item[data-widget="kurzwahl"] .dash-griff-h').boundingBox();
  await p.mouse.move(griff.x + griff.width / 2, griff.y + griff.height / 2);
  await p.mouse.down();
  await p.mouse.move(griff.x + griff.width / 2, griff.y + griff.height / 2 + 180, { steps: 8 });
  await p.mouse.up();
  await p.click('.dash-item[data-widget="kurzwahl"] .dash-breite');
  await p.waitForTimeout(200);
  const gezogen = await rahmen(p, 'kurzwahl');
  await p.click('#dashEditleiste button:has-text("Speichern")');
  await p.waitForTimeout(350);

  const stand = await gespeichert(p);
  const eintrag = (stand || []).find(x => x.id === 'kurzwahl');
  check('KRITISCH: Höhe und Breite stehen im gespeicherten Stand',
    !!eintrag && eintrag.hoehe > 200 && eintrag.breite === 'voll');
  await p.close();

  const q = await seite(JSON.stringify(stand));
  const wieder = await rahmen(q, 'kurzwahl');
  check('KRITISCH: nach dem Neuladen ist die Höhe noch da', Math.abs(wieder.h - gezogen.h) <= 3);
  check('KRITISCH: und die Breite auch', Math.abs(wieder.b - gezogen.b) <= 3);
  await q.screenshot({ path: `${OUT}/containergroesse.png` });
  await q.close();

  // Ein unsinniger gespeicherter Wert darf nicht in die Oberflaeche wandern.
  const faul = JSON.stringify([{ id: 'kurzwahl', sichtbar: true, hoehe: 99999, breite: 'schräg' },
                               { id: 'begruessung', sichtbar: true }]);
  const r = await seite(faul);
  const m = await rahmen(r, 'kurzwahl');
  check('KRITISCH: eine unsinnige gespeicherte Höhe wird verworfen', m.h < 1700);
  check('Und eine unbekannte Breite ebenso', m.b < 1600);
  await r.close();
} catch (e) { bad.push('Speichern: ' + String(e).split('\n')[0].slice(0, 120)); }

// ══════════════════════════════ ZURUECKSETZEN NIMMT DIE GROESSE MIT
try {
  const p = await seite(JSON.stringify([{ id: 'kurzwahl', sichtbar: true, hoehe: 600, breite: 'voll' }]));
  const gross = await rahmen(p, 'kurzwahl');
  check('Der vorbelegte Stand wirkt', gross.h >= 590);
  await p.click('#btnDashBearbeiten'); await p.waitForTimeout(200);
  await p.click('#dashEditleiste button:has-text("Zurücksetzen")'); await p.waitForTimeout(250);
  const zurueck = await rahmen(p, 'kurzwahl');
  check('KRITISCH: Zurücksetzen nimmt auch Höhe und Breite mit', zurueck.h < gross.h - 100);
  await p.close();
} catch (e) { bad.push('Zurücksetzen: ' + String(e).split('\n')[0].slice(0, 120)); }

// ══════════════════════════════ AUF FREIER FLAECHE ABLEGEN
//
// Genau der Punkt aus der Ansage: "bei der markierten fläche, kann man nichts
// hinschieben."
try {
  const p = await seite(JSON.stringify([
    { id: 'kurzwahl', sichtbar: true }, { id: 'ereignisse', sichtbar: true },
    { id: 'begruessung', sichtbar: true }, { id: 'kpi', sichtbar: true },
  ]));
  await p.click('#btnDashBearbeiten'); await p.waitForTimeout(250);

  // Der Schnellzugriff steht halb und allein in seiner Zeile -- rechts davon
  // liegt die Luecke, um die es geht.
  const kw = await rahmen(p, 'kurzwahl');
  const luecke = { x: kw.l + kw.b + 120, y: kw.o + kw.h / 2 };
  const vorher = await p.evaluate(() => [...document.querySelectorAll('.dash-item')]
    .sort((a, b) => Number(a.style.order) - Number(b.style.order)).map(e => e.dataset.widget));

  const griff = await p.locator('.dash-item[data-widget="kpi"] .griff').boundingBox();
  await p.mouse.move(griff.x + griff.width / 2, griff.y + griff.height / 2);
  await p.mouse.down();
  await p.mouse.move(luecke.x, luecke.y, { steps: 12 });
  await p.mouse.up();
  await p.waitForTimeout(300);
  const nachher = await p.evaluate(() => [...document.querySelectorAll('.dash-item')]
    .sort((a, b) => Number(a.style.order) - Number(b.style.order)).map(e => e.dataset.widget));
  check('KRITISCH: in die freie Fläche lässt sich etwas ziehen',
    JSON.stringify(nachher) !== JSON.stringify(vorher));
  check('KRITISCH: und es landet DORT — direkt hinter dem Container links davon',
    nachher[nachher.indexOf('kurzwahl') + 1] === 'kpi');
  await p.close();
} catch (e) { bad.push('Freie Fläche: ' + String(e).split('\n')[0].slice(0, 120)); }

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
