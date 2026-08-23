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

async function seite(vorbelegt, breite = 1600) {
  const p = await browser.newPage({ viewport: { width: breite, height: 1000 } });
  p.setDefaultTimeout(5000);
  p.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
  if (vorbelegt !== undefined) {
    await p.addInitScript(v => { try { localStorage.setItem('rv3_dash_layout', v); } catch (e) {} }, vorbelegt);
  }
  await p.route('**/api/**', r => {
    const pf = r.request().url().split('/api/')[1].split('?')[0];
    const send = b => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (pf.includes('login')) return send({ status: 'ok', token: 't', name: 'adrian', ist_admin: true });
    if (pf.includes('dashboard_stats')) return send({ status: 'ok',
      kpi: { rapporte_monat: 6, stunden_monat: 38, mitarbeiter: 5, kunden: 3, rapporte_total: 6,
             rapporte_vormonat: 0, stunden_vormonat: 0 },
      verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [], ereignisse: [],
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
