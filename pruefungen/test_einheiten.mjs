// Einheiten in Offerten, Rechnungen, Vertraegen und Leistungen (ENT-645).
//
// WOZU DIESE SUITE: Die Einheiten waren da -- Std., Stk., Pauschal und
// weitere standen in einer <datalist>. Sichtbar war trotzdem nur "Std.",
// denn eine datalist filtert ihre Vorschlaege nach dem, was im Feld steht,
// und das Feld kommt vorbelegt an. Kein Fehler, nichts kaputt, keine
// Meldung -- die Liste war einfach unerreichbar. Eine Pruefung auf "die
// Einheit X steht im Quelltext" waere die ganze Zeit gruen gewesen.
//
// Darum wird hier GEMESSEN, was ein Mensch vor dem Bildschirm auswaehlen
// kann: welche Einheiten das Feld im gerenderten Zustand hergibt, ob der
// freie Eintrag wirklich erscheint, und ob eine fremde Einheit aus alten
// Daten stehen bleibt statt still zu Stunden zu werden.
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const ERWARTET = ['Std.', 'Stk.', 'Pauschal', 'Tag', 'Monat', 'Jahr', 'km', 'Einsatz'];

const POSITION = { produkt_id: null, produkt_name: 'Leistung', beschreibung: '',
  menge: 1, einheit: 'Std.', einzelpreis_rappen: 12000, rabatt_bp: 0, mwst_satz_bp: 810 };

// ── Quelle: EINE Liste, nicht zwei ───────────────────────────────────────
// Vorher standen im Betreiberbereich und im Cockpit zwei verschiedene
// Listen, die ueber die Jahre auseinandergelaufen waren.
const liste = d => {
  const m = readFileSync(`${WURZEL}/${d}`, 'utf8').match(/const EINHEITEN = \[([^\]]*)\]/);
  return m ? m[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')) : null;
};
const lBe = liste('betreiber.html'), lCo = liste('dashboard.html');
check('KRITISCH: Betreiberbereich und Cockpit teilen dieselbe Einheitenliste',
  lBe !== null && lCo !== null && lBe.join('|') === lCo.join('|'));
check('Die Liste ist die entschiedene (ENT-645)', lBe !== null && lBe.join('|') === ERWARTET.join('|'));
check('KRITISCH: Die alte Vorschlagsliste ist weg -- sonst haengen Felder weiter daran',
  !readFileSync(`${WURZEL}/betreiber.html`, 'utf8').includes('list="dlEinheiten"')
  && !readFileSync(`${WURZEL}/dashboard.html`, 'utf8').includes('list="dlEinheiten"'));

// Was ein Mensch im Feld tatsaechlich vorfindet.
const ABZUG = id => {
  const sel = document.getElementById(id);
  const frei = document.getElementById(id + '_frei');
  if (!sel || !frei) { return null; }
  return {
    art: sel.tagName,
    werte: Array.from(sel.options).map(o => o.value),
    texte: Array.from(sel.options).map(o => o.textContent.trim()),
    gewaehlt: sel.value,
    selHoch: sel.offsetHeight,
    freiHoch: frei.offsetHeight,
  };
};

// Waehlen, ohne bei fehlender Auswahl mit einer Ausnahme abzubrechen. Ein
// Abbruch ist zwar auch rot, sagt aber nicht WAS fehlt -- und genau das
// braucht der naechste, der hier steht.
async function waehle(seite, id, wert, name) {
  const da = await seite.evaluate(([i, w]) => {
    const el = document.getElementById(i);
    return !!el && el.tagName === 'SELECT' && Array.from(el.options).some(o => o.value === w);
  }, [id, wert]);
  check(name, da);
  if (da) { await seite.selectOption('#' + id, wert); }
  return da;
}

const browser = await chromium.launch({ executablePath: browserPfad() });

async function neueSeite() {
  const seite = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  seite.on('pageerror', e => bad.push('JS-Fehler in der Ansicht: ' + e.message));
  await seite.route('**/api/**', route => {
    const url = route.request().url();
    const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (url.includes('login.php')) { return send({ status: 'ok', token: 't', name: 'pruef', ist_admin: true }); }
    if (url.includes('me.php')) {
      return send({ status: 'ok', name: 'pruef', ist_admin: true, rollen: [],
        rechte: ['kunden_lesen', 'kunden_schreiben', 'offerten_lesen', 'offerten_schreiben',
                 'leistungen_lesen', 'leistungen_schreiben', 'betrieb_lesen'] });
    }
    if (url.includes('dashboard_stats')) {
      return send({ status: 'ok', kpi: { rapporte_monat: 0, rapporte_vormonat: 0, stunden_monat: 0,
        stunden_vormonat: 0, mitarbeiter: 0, kunden: 0, rapporte_total: 0 },
        verlauf: [], angemeldet: [], letzte_rapporte: [], ereignisse: [],
        ereignisse_unvollstaendig: [], pro_mitarbeiter: [] });
    }
    if (url.includes('produkt_list')) { return send({ status: 'ok', eingerichtet: true, produkte: [] }); }
    if (url.includes('beleg_list')) { return send({ status: 'ok', eingerichtet: true, naechste_nummer: 'OF-0001', belege: [] }); }
    if (url.includes('kunden_list')) { return send({ status: 'ok', eingerichtet: true, kunden: [] }); }
    return send({ status: 'ok', eingerichtet: true });
  });
  return seite;
}

// ── Betreiberbereich ─────────────────────────────────────────────────────
const be = await neueSeite();
await be.goto(`file://${WURZEL}/betreiber.html`);
await be.evaluate(p => {
  document.getElementById('tor').classList.add('versteckt');
  document.getElementById('haus').classList.remove('versteckt');
  offertenBereit = true;
  ofNaechsteNummer = 'OF-0001';
  produkte = []; adressen = []; belege = [];
  ofNeu('offerte');
  ofPos = [Object.assign({}, p)];
  ofZeilenZeichnen();
}, POSITION);
await be.waitForTimeout(200);

const a1 = await be.evaluate(ABZUG, 'ofp_einheit0');
check('KRITISCH: Die Einheit ist ein Auswahlfeld, kein Feld mit versteckter Liste',
  a1 !== null && a1.art === 'SELECT');
check('KRITISCH: Alle acht Einheiten stehen wirklich zur Auswahl',
  a1 !== null && ERWARTET.every(e => a1.werte.includes(e)));
check('Der freie Eintrag wird angeboten',
  a1 !== null && a1.texte.some(t => t.startsWith('andere')));
check('Eine neue Zeile steht weiterhin auf Stunden', a1 !== null && a1.gewaehlt === 'Std.');
check('KRITISCH: Das Feld fuer den freien Eintrag ist zu Beginn nicht zu sehen -- GEMESSEN',
  a1 !== null && a1.selHoch > 0 && a1.freiHoch === 0);

// Auswaehlen wirkt auf den Beleg, nicht nur auf die Anzeige.
await waehle(be, 'ofp_einheit0', 'Stk.', 'KRITISCH: "Stk." laesst sich im Betreiberbereich ueberhaupt waehlen');
await be.waitForTimeout(120);
check('KRITISCH: Eine gewaehlte Einheit steht danach in der Position',
  await be.evaluate(() => ofPos[0].einheit) === 'Stk.');

// "andere ..." -- das Feld muss auch wirklich erscheinen. Eine .inp-Regel
// mit display haette das hidden-Attribut geschlagen, ohne dass etwas bricht.
await waehle(be, 'ofp_einheit0', '__andere__', 'KRITISCH: Der freie Eintrag laesst sich waehlen');
await be.waitForTimeout(120);
const a2 = await be.evaluate(ABZUG, 'ofp_einheit0');
check('KRITISCH: "andere ..." blendet das freie Feld ein und das Auswahlfeld aus -- GEMESSEN',
  a2 !== null && a2.freiHoch > 0 && a2.selHoch === 0);
check('KRITISCH: Solange nichts getippt ist, bleibt die zuletzt gewaehlte Einheit stehen',
  await be.evaluate(() => ofPos[0].einheit) === 'Stk.');

const freiDa = await be.evaluate(() => !!document.getElementById('ofp_einheit0_frei'));
check('KRITISCH: Es gibt ueberhaupt ein Feld fuer die eigene Einheit', freiDa);
if (freiDa) {
  await be.fill('#ofp_einheit0_frei', 'Nacht');
  await be.evaluate(() => document.getElementById('ofp_einheit0_frei').blur());
}
await be.waitForTimeout(150);
const a3 = await be.evaluate(ABZUG, 'ofp_einheit0');
check('KRITISCH: Eine eigene Einheit landet im Beleg',
  await be.evaluate(() => ofPos[0].einheit) === 'Nacht');
check('KRITISCH: Die eigene Einheit ist danach wieder waehlbar, nicht nur einmal getippt',
  a3 !== null && a3.werte.includes('Nacht') && a3.gewaehlt === 'Nacht' && a3.freiHoch === 0);

// Abbrechen heisst "doch nicht", nicht "keine Einheit".
await waehle(be, 'ofp_einheit0', '__andere__', 'Der freie Eintrag laesst sich ein zweites Mal waehlen');
await be.evaluate(() => { const f = document.getElementById('ofp_einheit0_frei'); if (f) { f.blur(); } });
await be.waitForTimeout(150);
check('KRITISCH: Ein leer gelassener freier Eintrag laesst die Einheit stehen, statt sie zu loeschen',
  await be.evaluate(() => ofPos[0].einheit) === 'Nacht');

// Alte Daten: eine Einheit, die es in der Liste nicht gibt.
await be.evaluate(() => { ofPos = [Object.assign({}, ofPos[0], { einheit: 'm²' })]; ofZeilenZeichnen(); });
await be.waitForTimeout(150);
const a4 = await be.evaluate(ABZUG, 'ofp_einheit0');
check('KRITISCH: Eine fremde Einheit aus alten Daten bleibt stehen und wird nicht still zu Stunden',
  a4 !== null && a4.gewaehlt === 'm²');

// Der Leistungsstamm fuehrt dasselbe Feld.
await be.evaluate(() => pdDlgOeffnen(null));
await be.waitForTimeout(200);
const a5 = await be.evaluate(ABZUG, 'pd_einheit');
check('KRITISCH: Auch der Leistungsstamm hat das Auswahlfeld, nicht das alte Textfeld',
  a5 !== null && a5.art === 'SELECT' && ERWARTET.every(e => a5.werte.includes(e)));
check('Die Beschriftung des Leistungsfeldes steht weiterhin darueber',
  await be.evaluate(() => {
    const l = document.querySelector('#pd_einheit_feld label');
    return !!l && l.getAttribute('for') === 'pd_einheit' && l.textContent.trim() === 'Einheit';
  }));
await be.close();

// ── Cockpit ──────────────────────────────────────────────────────────────
const co = await neueSeite();
await co.goto(`file://${WURZEL}/dashboard.html`);
await co.fill('#gName', 'pruef'); await co.fill('#gPass', 'x'); await co.click('#gBtn');
await co.waitForSelector('#shell.on');
await co.waitForTimeout(350);
await co.evaluate(p => { ofNeu('offerte'); ofPos = [Object.assign({}, p)]; ofZeilenZeichnen(); }, POSITION);
await co.waitForTimeout(200);

const c1 = await co.evaluate(ABZUG, 'ofp_einheit0');
check('KRITISCH: Im Cockpit steht dasselbe Auswahlfeld mit denselben Einheiten',
  c1 !== null && c1.art === 'SELECT'
  && JSON.stringify(c1.werte) === JSON.stringify(a1 ? a1.werte : null));
check('KRITISCH: Auch im Cockpit ist das freie Feld zu Beginn nicht zu sehen -- GEMESSEN',
  c1 !== null && c1.selHoch > 0 && c1.freiHoch === 0);

await waehle(co, 'ofp_einheit0', 'Einsatz', 'KRITISCH: "Einsatz" laesst sich im Cockpit ueberhaupt waehlen');
await co.waitForTimeout(120);
check('KRITISCH: Im Cockpit landet die gewaehlte Einheit ebenfalls in der Position',
  await co.evaluate(() => ofPos[0].einheit) === 'Einsatz');

await co.evaluate(() => pdNeu());
await co.waitForTimeout(250);
const c2 = await co.evaluate(ABZUG, 'prod_einheit');
check('KRITISCH: Auch der Leistungsstamm im Cockpit fuehrt das Auswahlfeld',
  c2 !== null && c2.art === 'SELECT' && ERWARTET.every(e => c2.werte.includes(e)));
await co.close();

await browser.close();

ok.forEach(n => console.log('  ok   ' + n));
bad.forEach(n => console.log('  FEHLT ' + n));
console.log(`\n${ok.length} bestanden, ${bad.length} offen`);
if (bad.length) { process.exit(1); }
console.log('Alle Pruefungen bestanden.');
