// Tabellen im Cockpit: Breite ausgenutzt, Kopf und Wert an derselben Kante
// (ENT-422).
//
// Zwei Befunde vom Projektinhaber am 05.09.2026, beide am gerenderten Zustand
// nachgemessen, nicht im Quelltext gelesen:
//
//  1. Die Listenansichten standen unter dem 1440-px-Deckel von ".content".
//     Gemessen bei 1920 px Fensterbreite: 480 px blieben rechts leer -- ein
//     Viertel der Flaeche -- waehrend dieselbe Zeile links einen langen
//     Firmennamen und eine E-Mail-Adresse nebeneinander quetschte. Der Deckel
//     ist eine LESEBREITE; er gehoert vor ein Formular, nicht vor eine
//     Tabelle mit elf Spalten.
//  2. In neun Tabellen zeigten Spaltenkopf und Zellwert in verschiedene
//     Richtungen: "ZEIT" stand links, "07:00-16:00" rechts. Kopf und Wert
//     derselben Spalte muessen an derselben Kante stehen -- sonst sieht die
//     Spaltengrenze in jeder Zeile anders aus.
//
// Geprueft wird die AUSSAGE, nicht der Wortlaut: Es wird kein Klassenname im
// Quelltext gesucht, sondern die tatsaechlich gerechnete Ausrichtung
// (getComputedStyle) und die tatsaechliche Breite (getBoundingClientRect).
// Eine Kopfzeile, die kuenftig anders gebaut wird, faellt hier trotzdem auf.
//
// Alle Testdaten sind erfunden. Jedes Datum wird aus HEUTE gerechnet -- ein
// festes Datum nahe beim heutigen Tag kippt beim Datumswechsel
// (test_datumsfest.mjs).
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const URL = `file://${WURZEL}/dashboard.html`;
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const BREITE = 1920, HOEHE = 1000;
const tag = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

// ── Erfundene Daten, gerade so viel, dass jede Liste Zeilen zeigt ──────────
const kunden = Array.from({ length: 6 }, (_, i) => ({
  id: i + 1, kundennummer: 'K' + String(i + 1).padStart(4, '0'), art: 'unternehmen',
  name: ['Alpha Immobilien AG', 'Beta Consulting GmbH', 'Gemeinde Musterdorf',
         'Kantonale Gebaeudeversicherung Musterland', 'Delta Technik', 'Epsilon Analytik AG'][i],
  strasse: 'Musterstrasse', hausnummer: String(10 + i), plz: String(4600 + i), ort: 'Musterort',
  telefon: i % 2 ? '062 000 00 0' + i : '', email: i % 2 ? '' : 'kontakt' + i + '@beispiel.test',
  kontaktperson: '', notiz: '', aktiv: 1, kontaktwege: [], personen: [],
}));
const objekte = Array.from({ length: 4 }, (_, i) => ({
  id: i + 1, name: 'Objekt ' + (i + 1), kunde_id: (i % 3) + 1, kunde_name: kunden[i % 3].name,
  ort: 'Musterort', strasse: 'Musterweg ' + i, plz: '4600', kanton: 'SO',
  einsatzart: 'Revierdienst', aktiv: 1, masterschichten: i, stunden_je_einsatz: i * 0.25,
  personen: [],
}));
const mitarbeiter = Array.from({ length: 5 }, (_, i) => ({
  id: i + 1, name: 'person' + i, vorname: 'Vorname' + i, nachname: 'Musterperson' + i,
  personalnummer: 'P' + String(100 + i), email: 'p' + i + '@beispiel.test',
  telefon: '079 000 00 0' + i, mobil: i % 2 ? '' : '079 100 00 0' + i,
  aktiv: 1, ist_admin: i === 0 ? 1 : 0, rollen: [], kategorie: ['A', 'B', 'C', 'B', ''][i],
  strasse: 'Musterweg', hausnummer: String(i), ort: 'Musterort', plz: '4600', schichten: [],
}));
const rapporte = Array.from({ length: 6 }, (_, i) => ({
  id: i + 1, datum: tag(-40 - i * 7), mitarbeiter: 'Vorname' + i + ' Musterperson' + i,
  kunde: kunden[i % 6].name, kunde_name: kunden[i % 6].name, kunde_id: (i % 6) + 1,
  strasse: 'Musterstrasse', ort: 'Musterort', einsatzart: 'Verkehrsdienst',
  einsatz_id: 100 + Math.floor(i / 2), von: '07:00:00', bis: '16:00:00',
  pause_min: 30, netto_h: 8 - (i % 3) * 0.5, auftrag_nr: null, unterzeichner: null,
}));
const einsaetze = Array.from({ length: 5 }, (_, i) => ({
  id: 100 + i, kunde_id: (i % 3) + 1, kunde_name: kunden[i % 3].name,
  // Ohne objekt_id gilt der Einsatz als frei angelegt -- die Vorgabe des
  // Herkunftsfilters ist "Nur Einsaetze" (ENT-106), Objektschichten waeren
  // hier unsichtbar und die Liste bliebe leer.
  objekt_id: null, masterschicht_id: null, serie_id: null,
  titel: 'Einsatz ' + (i + 1), strasse: 'Musterweg ' + i, ort: 'Musterort', kanton: 'SO',
  einsatzart: 'Revierdienst', sparte: 'sicherheit',
  datum: tag(i), von: '07:00:00', bis: '16:00:00', bedarf: 2, status: 'geplant',
  bemerkung: '', spontan_erzeugt: 0, hat_unterschrift: 0,
  mitarbeiter: [{ id: 1, name: 'person1', vorname: 'Vorname1', nachname: 'Musterperson1' }],
  positionen: [], parallel_runden: [],
}));
const belege = Array.from({ length: 4 }, (_, i) => ({
  id: i + 1, art: i < 2 ? 'offerte' : 'rechnung',
  nummer: (i < 2 ? 'OF-' : 'RE-') + String(i + 1).padStart(4, '0'),
  status: ['entwurf', 'versendet', 'entwurf', 'versendet'][i], titel: 'Leistung ' + (i + 1),
  referenz: '', kunde_id: 2, empfaenger_name: kunden[1].name, kundennummer: 'K0002',
  datum: tag(-60 - i), gueltig_bis: tag(-30 - i), faellig_bis: tag(-20 - i),
  total_rappen: 4865 + i * 100, aktiv: 1,
}));
const rundgaenge = Array.from({ length: 3 }, (_, i) => ({
  id: i + 1, kunde_name: kunden[i % 3].name, objekt_name: 'Objekt ' + (i + 1),
  titel: 'Runde ' + (i + 1), datum: tag(-45 - i), rohzeit_start: tag(-45 - i) + ' 22:00:00',
  dauer: 3600, status: 'beendet', vorname: 'Vorname' + i, nachname: 'Musterperson' + i,
  fortschritt: { gesamt: 8, bestaetigt: 8, erledigt: 8, ersatzscan: 0 },
}));

function antwort(pfad) {
  if (pfad.includes('login')) return { status: 'ok', token: 't', name: 'adrian', ist_admin: true };
  if (pfad.includes('me')) return { status: 'ok', name: 'adrian', ist_admin: true, rollen: [],
    rechte: ['kunden_lesen', 'kunden_schreiben', 'abgleich_lesen',
      'abgleich_schreiben', 'auslagen_lesen', 'einsaetze_lesen',
      'einsaetze_schreiben', 'objekte_lesen', 'objekte_schreiben',
      'masterschichten_lesen', 'masterschichten_schreiben',
      'verfuegbarkeit_lesen', 'fahrzeuge_lesen', 'personal_lesen',
      'personal_schreiben', 'personal_vertraulich_lesen',
      'personal_vertraulich_schreiben', 'revierdienst', 'auswertung',
      'betrieb_lesen', 'betrieb_schreiben', 'fahrzeuge_schreiben'] };
  return { status: 'ok', kunden, objekte, mitarbeiter, rapporte, einsaetze, belege, rundgaenge,
    naechste_kundennummer: 'K0007', eingegrenzt: false,
    produkte: Array.from({ length: 3 }, (_, i) => ({ id: i + 1, nummer: 'L-' + (i + 1),
      name: 'Leistung ' + (i + 1), beschreibung: 'Erfunden', einheit: 'Std.',
      einzelpreis_rappen: 5500 + i * 500, mwst_satz_bp: 810, sortierung: i, aktiv: 1 })),
    masterschichten: [], feiertage: [], gepflegt: {}, sperren: [], orte: [], anstellungsorte: [],
    kpi: {}, verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: rapporte,
    ereignisse: [], ereignisse_gesamt: 0, ereignisse_unvollstaendig: [], abwesenheiten: [],
    zeilen: [], von: tag(-30), bis: tag(0), jahr: new Date().getFullYear() };
}

// ── Was gemessen wird ─────────────────────────────────────────────────────
// Die Kante einer Zelle, unabhaengig davon, wie sie zustande kommt.
const KANTE = `(el => {
  const a = getComputedStyle(el).textAlign;
  return a === 'start' ? 'links' : a === 'end' ? 'rechts'
       : a === 'left' ? 'links' : a === 'right' ? 'rechts' : a;
})`;

const MESSEN = new Function(`
  const kante = ${KANTE};
  const content = document.querySelector('.content');
  const cs = getComputedStyle(content);
  const cr = content.getBoundingClientRect();
  const tabellen = [...document.querySelectorAll('.view.on table')]
    .filter(t => t.offsetParent !== null && t.getBoundingClientRect().width > 0)
    .map(t => {
      const kopf = [...t.querySelectorAll('thead tr:last-child th')];
      const zeile = [...t.querySelectorAll('tbody tr')]
        .find(r => r.children.length === kopf.length && !r.querySelector('[colspan]'));
      const eltern = t.parentElement;
      const es = getComputedStyle(eltern);
      const platz = eltern.getBoundingClientRect().width
        - parseFloat(es.paddingLeft) - parseFloat(es.paddingRight)
        - parseFloat(es.borderLeftWidth) - parseFloat(es.borderRightWidth);
      return {
        id: (t.closest('[id]') || {}).id || '(ohne id)',
        breite: Math.round(t.getBoundingClientRect().width), platz: Math.round(platz),
        spalten: zeile ? kopf.map((th, i) => ({
          text: th.textContent.trim().slice(0, 24),
          kopf: kante(th), wert: kante(zeile.children[i]),
        })) : [],
      };
    });
  return { fenster: window.innerWidth, deckel: cs.maxWidth,
           contentBreite: Math.round(cr.width), tabellen };
`);

// Ansichten mit Tabellen. "weit" heisst: hier darf keine Lesebreite bremsen.
const ZIELE = [
  ['Übersicht',                 `go('uebersicht')`, true],
  ['Planung · Übersicht',       `go('planung'); goTab('uebersicht')`, true],
  ['Planung · Einsätze',        `go('planung'); goTab('einsaetze')`, true],
  ['Planung · Tagesplan',       `go('planung'); goTab('tag')`, true],
  ['Abgleich',                  `go('abgleich')`, true],
  ['Kunden · Adressen',         `go('kunden'); kuGoTab('uebersicht')`, true],
  ['Kunden · Objekte',          `go('kunden'); kuGoTab('objekte')`, true],
  ['Kunden · Rapporte',         `go('kunden'); kuGoTab('rapporte')`, true],
  ['Kunden · Offerten',         `go('kunden'); kuGoTab('offerten')`, true],
  ['Kunden · Rechnungen',       `go('kunden'); kuGoTab('rechnungen')`, true],
  ['Kundendetail · Rapporte',   `go('kunden'); openKundeDetail(1); kdGoTab('rapporte')`, true],
  ['Kundendetail · Offerten',   `go('kunden'); openKundeDetail(2); kdGoTab('offerten')`, true],
  ['Revierdienst · Übersicht',  `go('rundgaenge')`, true],
  ['Mitarbeitende',             `go('mitarbeiter')`, true],
  ['Leistungen',                `go('produkte')`, true],
  ['Abwesenheiten',             `go('abwesenheiten')`, true],
];

const browser = await chromium.launch({ executablePath: browserPfad() });
const page = await browser.newPage({ viewport: { width: BREITE, height: HOEHE } });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message.split('\n')[0]));
await page.route('**/api/**', r => {
  const p = r.request().url().split('/api/')[1].split('?')[0];
  r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(antwort(p)) });
});
await page.goto(URL);
await page.fill('#gName', 'adrian'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#shell.on');
// Kopfleisten-Zustand (ENT-086): so arbeitet der Projektinhaber, und nur so
// steht die volle Fensterbreite ueberhaupt zur Verfuegung.
await page.evaluate(() => document.getElementById('shell').classList.add('aus'));
await page.waitForTimeout(400);

let mitTabelle = 0, spaltenGesamt = 0;
for (const [name, js, weit] of ZIELE) {
  try {
    await page.evaluate(j => eval(j), js);
    await page.waitForTimeout(650);
    const m = await page.evaluate(MESSEN);

    if (weit) {
      check(`KRITISCH: ${name} — keine Lesebreite bremst die Ansicht`,
        m.deckel === 'none' && m.contentBreite >= m.fenster - 1);
    }
    for (const t of m.tabellen) {
      if (!t.spalten.length) { continue; }
      mitTabelle++;
      spaltenGesamt += t.spalten.length;
      // Die Tabelle nutzt den Platz, den ihr Container hergibt.
      check(`KRITISCH: ${name} — die Tabelle #${t.id} füllt ihren Container`,
        t.breite >= t.platz - 3);
      const schief = t.spalten.filter(s => s.kopf !== s.wert);
      check(`KRITISCH: ${name} — in #${t.id} steht jeder Kopf auf derselben Kante wie sein Wert`,
        schief.length === 0);
      schief.forEach(s => bad.push(
        `   ${name} #${t.id}: Spalte "${s.text}" — Kopf ${s.kopf}, Wert ${s.wert}`));
    }
  } catch (e) {
    bad.push(`${name}: ` + String(e).split('\n')[0].slice(0, 140));
  }
}

check('Es wurden überhaupt Tabellen gemessen (sonst prüft die Suite nichts)',
  mitTabelle >= 12 && spaltenGesamt >= 80);

// ── Die Lesebreite bleibt, wo sie hingehoert ──────────────────────────────
// Ein Formular unter voller Breite waere der entgegengesetzte Fehler. Die
// Bearbeitungsmaske der Mitarbeitenden ist der Beleg dafuer, dass der Deckel
// nicht einfach global gefallen ist.
try {
  await page.evaluate(() => { go('mitarbeiter'); maGoTab('bearbeiten'); });
  await page.waitForTimeout(300);
  const deckel = await page.evaluate(() => getComputedStyle(document.querySelector('.content')).maxWidth);
  check('KRITISCH: die Bearbeitungsmaske der Mitarbeitenden bleibt auf Lesebreite',
    deckel !== 'none' && parseFloat(deckel) > 0);
  await page.evaluate(() => maGoTab('liste'));
  await page.waitForTimeout(250);
} catch (e) { bad.push('Lesebreite Formular: ' + String(e).split('\n')[0].slice(0, 120)); }

// ── Summenspalte der Monatsraster ─────────────────────────────────────────
// Der Kopf der Summenspalte erbte von ".gr thead th" die Mitte, waehrend die
// Stunden darunter rechts standen. Sichtbar nur im Objektplan, gemessen an
// derselben Klassenkombination.
try {
  const g = await page.evaluate(() => {
    const d = document.createElement('div');
    d.className = 'gr dicht';
    d.innerHTML = '<table><thead><tr><th class="lb">Objekt</th><th class="sum">Std.</th></tr>'
      + '</thead><tbody><tr><td class="lb">x</td><td class="sum">8.00</td></tr></tbody></table>';
    document.querySelector('.content').appendChild(d);
    const a = el => getComputedStyle(d.querySelector(el)).textAlign;
    const r = { kopf: a('thead th.sum'), wert: a('tbody td.sum') };
    d.remove();
    return r;
  });
  check('KRITISCH: im Monatsraster steht der Kopf der Summenspalte auf derselben Kante wie die Stunden',
    g.kopf === g.wert);
} catch (e) { bad.push('Summenspalte: ' + String(e).split('\n')[0].slice(0, 120)); }

// ── Am Handy aendert sich nichts zum Schlechteren ─────────────────────────
try {
  await page.setViewportSize({ width: 430, height: 900 });
  await page.evaluate(() => { go('kunden'); kuGoTab('uebersicht'); });
  await page.waitForTimeout(500);
  const m = await page.evaluate(() => ({
    rollt: document.documentElement.scrollWidth > window.innerWidth + 1,
    breite: Math.round(document.querySelector('.content').getBoundingClientRect().width),
  }));
  check('KRITISCH: am Handy läuft die Seite nicht waagrecht über', !m.rollt);
  check('Und der Inhalt bleibt im Fenster', m.breite <= 430);
  await page.setViewportSize({ width: BREITE, height: HOEHE });
} catch (e) { bad.push('Handy: ' + String(e).split('\n')[0].slice(0, 120)); }

await page.evaluate(() => { go('kunden'); kuGoTab('uebersicht'); });
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/tabellen-breite.png` });
await browser.close();

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
