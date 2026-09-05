// Alle vier Kunden-Reiter als aufklappbare Karten auf dem Handy
// (ENT-400: Rapporte und Offerten, ENT-401: Adressen und Objekte,
// ENT-403: Herunterladen und Teilen auch bei der Offerte,
// ENT-409: Rapporte/Offerten als Akkordeon -- Adressen/Objekte unveraendert
// mit Mehrfachauswahl, siehe dort).
//
// Der Anlass war eine MESSUNG, keine Meinung: Beide Listen sind neun Spalten
// breit. Auf 390 px blieb davon ein waagrecht schiebbarer Streifen uebrig, in
// dem nie eine ganze Zeile zu sehen war. Diese Reihe misst darum vor allem
// eines: dass in den beiden Reitern nichts mehr waagrecht geschoben werden
// muss -- weder die Seite noch der Tabellenbehaelter .tw, der das Schieben
// vorher ueberhaupt erst ermoeglichte.
//
// Geprueft wird die Aussage, nicht der Wortlaut: die Reihenfolge der
// tatsaechlich gezeichneten Datumsangaben (nicht die Beschriftung des
// Sortierknopfes), die Zahl der Karten (nicht ihr HTML), und ob ein Klick
// wirklich eine Datei erzeugt (nicht ob eine Funktion existiert).
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

// Feste Daten im Vormonat statt nahe am heutigen Tag: Ein Datum neben dem
// Stichtag kippt beim Datumswechsel (test_datumsfest.mjs achtet darauf).
const T = n => `2026-03-${String(n).padStart(2, '0')}`;

// Zwei Rapporte gehoeren zum selben Einsatz (501) -- das ist der Fall, den
// die Tabelle mit einer Klammer zeigt und die Karte mit einem Hinweis.
const RAP = { status: 'ok', rapporte: [
  { id: 284, einsatz_id: 501, datum: T(26), mitarbeiter: 'dario.beispiel', kunde: 'Beispiel Consulting GmbH',
    strasse: 'Mustergasse 2', ort: '4600 Olten', auftrag_nr: 'A-118', einsatzart: 'Verkehrsdienst',
    von: '07:00:00', bis: '16:00:00', pause_min: 30, netto_h: '8.50', unterzeichner: 'R. Muster',
    unterschrift: null, bemerkung: 'Baustellenverkehr geregelt.', erfasst_am: T(26) + ' 16:12:00' },
  { id: 283, einsatz_id: 501, datum: T(26), mitarbeiter: 'anna.beispiel', kunde: 'Beispiel Consulting GmbH',
    strasse: 'Mustergasse 2', ort: '4600 Olten', auftrag_nr: 'A-118', einsatzart: 'Verkehrsdienst',
    von: '07:00:00', bis: '16:00:00', pause_min: 30, netto_h: '8.50', unterzeichner: null,
    unterschrift: null, bemerkung: null, erfasst_am: T(26) + ' 16:20:00' },
  { id: 282, einsatz_id: 502, datum: T(25), mitarbeiter: 'anna.beispiel', kunde: 'Muster AG',
    strasse: 'Beispielweg 7', ort: '4632 Trimbach', auftrag_nr: null, einsatzart: 'Revierdienst',
    von: '22:00:00', bis: '04:00:00', pause_min: 0, netto_h: '6.00', unterzeichner: null,
    unterschrift: null, bemerkung: null, erfasst_am: T(25) + ' 04:20:00' },
  { id: 281, einsatz_id: 503, datum: T(23), mitarbeiter: 'anna.beispiel', kunde: 'Muster AG',
    strasse: 'Beispielstrasse 23', ort: '4632 Trimbach', auftrag_nr: 'A-117', einsatzart: 'Verkehrsdienst',
    von: '08:00:00', bis: '15:45:00', pause_min: 30, netto_h: '7.25', unterzeichner: 'M. Frei',
    unterschrift: null, bemerkung: null, erfasst_am: T(23) + ' 16:02:00' },
]};

const BEL = { status: 'ok', belege: [
  { id: 9, art: 'offerte', nummer: 'OF-2026-004', referenz: 'Projekt Nord', titel: 'Verkehrsdienst Baustelle',
    kunde_id: 1, kunde_name: 'Beispiel Consulting GmbH', kundennummer: 'K0001', status: 'versendet',
    datum: T(26), gueltig_bis: T(28), total_rappen: 104855, aktiv: 1 },
  { id: 8, art: 'offerte', nummer: 'OF-2026-003', referenz: null, titel: null,
    kunde_id: 2, kunde_name: 'Muster AG', kundennummer: 'K0002', status: 'entwurf',
    datum: T(20), gueltig_bis: T(24), total_rappen: 95200, aktiv: 1 },
  { id: 7, art: 'offerte', nummer: 'OF-2026-002', referenz: 'Revier', titel: 'Revierdienst Nacht',
    kunde_id: 2, kunde_name: 'Muster AG', kundennummer: 'K0002', status: 'bestaetigt',
    datum: T(12), gueltig_bis: T(30), total_rappen: 248000, aktiv: 1 },
]};

const mock = page => page.route('**/api/**', r => {
  const u = r.request().url();
  const send = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) });
  if (u.includes('login')) return send({ status: 'ok', token: 't', name: 'adrian', ist_admin: true });
  if (u.includes('me.php')) return send({ status: 'ok', name: 'adrian', ist_admin: true, rollen: [],
    rechte: ['kunden', 'abgleich', 'personal_lesen', 'betrieb', 'plan'] });
  if (u.includes('rapport_list')) return send(RAP);
  if (u.includes('beleg_list')) return send(BEL);
  // Das PDF darf NICHT aus der Liste gebaut werden: belege[] traegt nur die
  // Kopfdaten, beleg_lesen.php rechnet Positionen und Summen frisch. Der
  // Mock bildet das nach, damit die Pruefung denselben Weg geht wie der Code.
  if (u.includes('beleg_lesen')) {
    const id = Number((u.split('id=')[1] || '').split('&')[0]);
    const b = BEL.belege.find(x => Number(x.id) === id) || BEL.belege[0];
    return send({ status: 'ok',
      beleg: { ...b, rabatt_bp: 0,
        positionen: [{ id: 1, text: 'Verkehrsdienst', menge: 5, einheit: 'h',
                       einzelpreis_rappen: 19420, mwst_bp: 810 }] },
      kunde: { id: 1, name: 'Beispiel Consulting GmbH', strasse: 'Mustergasse 2', plz: '4600', ort: 'Olten' },
      person: null });
  }
  if (u.includes('kunden_list')) return send({ status: 'ok', kunden: [
    { id: 1, name: 'Beispiel Consulting GmbH', kundennummer: 'K0001', strasse: 'Mustergasse', hausnummer: '2',
      plz: '4600', ort: 'Olten', telefon: '062 000 00 00', email: 'info@beispiel.ch',
      kontaktperson: 'R. Muster', notiz: 'Schluessel im Tresor', aktiv: 1 },
    { id: 2, name: 'Muster AG', kundennummer: 'K0002', strasse: 'Beispielweg', hausnummer: '7',
      plz: '4632', ort: 'Trimbach', telefon: null, email: null, kontaktperson: null, notiz: null, aktiv: 1 },
    { id: 3, name: 'Alpha Privat', kundennummer: 'K0003', art: 'privat', strasse: 'Seeweg', hausnummer: '1',
      plz: '4600', ort: 'Olten', telefon: '079 000 00 00', email: 'a@beispiel.ch', aktiv: 1 }]});
  if (u.includes('objekt_list')) return send({ status: 'ok', objekte: [
    { id: 1, kunde_id: 1, kunde_name: 'Beispiel Consulting GmbH', name: 'Einkaufszentrum Nord West',
      strasse: 'Mustergasse 2', plz: '4600', ort: 'Olten', kanton: 'SO', einsatzart: 'Revierdienst',
      aktiv: 1, masterschichten: 2, stunden_je_einsatz: 0.5, bemerkung: 'Zufahrt hinten', distanzen: {} },
    { id: 2, kunde_id: 2, kunde_name: 'Muster AG', name: 'Baustelle Kreisel',
      strasse: 'Beispielweg 7', plz: '4632', ort: 'Trimbach', kanton: 'SO', einsatzart: 'Verkehrsdienst',
      aktiv: 1, masterschichten: 0, stunden_je_einsatz: 0, bemerkung: null, distanzen: {} }]});
  return send({ status: 'ok', kpi: {}, verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [],
    rapporte: [], kunden: [], belege: [], produkte: [], feiertage: [], gepflegt: {}, orte: [] });
});

const anmelden = async page => {
  await page.goto(`file://${WURZEL}/dashboard.html`);
  await page.fill('#gName', 'a'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
  await page.waitForSelector('#shell.on'); await page.waitForTimeout(700);
};

const browser = await chromium.launch({ executablePath: EXE });

// ══════════════════════════════ HANDY: 390 px
const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
m.setDefaultTimeout(6000);
m.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
await mock(m); await anmelden(m);

// Der Kern der Sache: nichts mehr waagrecht schieben. Gemessen wird beides --
// die Seite UND der Tabellenbehaelter, der das Schieben vorher trug. Ein
// reiner Seiten-Scroll-Test waere hier gruen geblieben, weil .tw sein
// overflow-x selbst auffaengt: genau das war der beanstandete Zustand.
const schiebt = () => m.evaluate(() => {
  const d = document.documentElement;
  const tw = document.querySelector('.view.on .ku-tab.on .tw');
  return { seite: d.scrollWidth - d.clientWidth, tw: tw ? tw.scrollWidth - tw.clientWidth : -1 };
});

// Auf eine Karte tippen. Mit Absicherung: Fehlen die Karten ganz (etwa weil
// eine spaetere Aenderung sie wieder durch die Tabelle ersetzt), soll diese
// Reihe das als Befund melden und nicht mit einem nichtssagenden TypeError
// abstuerzen -- eine Pruefung, die abstuerzt, sagt nicht, was fehlt.
const karteTippen = async (behaelter, nr) => {
  const da = await m.evaluate(([sel, i]) => {
    const k = document.getElementById(sel).querySelectorAll('.nur-schmal .ag-karte')[i];
    if (!k) { return false; }
    k.click(); return true;
  }, [behaelter, nr]);
  if (!da) { bad.push(`Karte ${nr + 1} in #${behaelter} ist gar nicht da -- Tipp nicht moeglich`); }
  await m.waitForTimeout(350);
  return da;
};

// Zugriff auf eine Karte, die es vielleicht nicht gibt. Ohne das steht in
// der Gegenprobe (alter Stand, neue Pruefungen) ein TypeError statt einer
// Liste roter Befunde -- und eine Pruefung, die abstuerzt, sagt nicht, was
// fehlt.
const KEINE = { datum: '', offen: false, koerper: false, text: '' };
const kn = (liste, i) => liste[i] || KEINE;

// Dasselbe fuer die Bedienelemente der Leiste: fehlt der Knopf, ist das ein
// Befund und kein Zeitueberlauf ohne Aussage.
const knopfTippen = async sel => {
  const da = await m.evaluate(s2 => {
    const b = document.querySelector(s2);
    if (!b) { return false; }
    b.click(); return true;
  }, sel);
  if (!da) { bad.push(`Bedienelement ${sel} ist gar nicht da -- Klick nicht moeglich`); }
  await m.waitForTimeout(400);
  return da;
};

const kartenDaten = behaelter => m.evaluate(sel => {
  const wurzel = document.getElementById(sel);
  return [...wurzel.querySelectorAll('.nur-schmal .ag-karte')].map(k => ({
    datum: (k.querySelector('.kopf b') || {}).textContent || '',
    offen: k.getAttribute('aria-expanded') === 'true',
    koerper: !!k.querySelector('.kk-koerper'),
    text: k.textContent.replace(/\s+/g, ' ').trim(),
  }));
}, behaelter);

// ── Rapporte ───────────────────────────────────────────────────────────────
await m.evaluate(() => { go('kunden'); kuGoTab('rapporte'); });
await m.waitForTimeout(700);

let s = await schiebt();
check(`KRITISCH: Rapporte schieben die Seite nicht waagrecht (${s.seite} px)`, s.seite <= 1);
check(`KRITISCH: die Rapport-Liste selbst schiebt nicht mehr waagrecht (${s.tw} px) -- das war der Anlass fuer ENT-400`, s.tw <= 1);

let k = await kartenDaten('rapporteTable');
check('Mobil steht je Rapport eine Karte', k.length === RAP.rapporte.length);
check('KRITISCH: die neunspaltige Tabelle ist mobil nicht sichtbar',
  await m.evaluate(() => !document.querySelector('#rapporteTable table')?.getClientRects().length));
check('Die Karten starten zugeklappt', k.every(x => !x.offen && !x.koerper));

// Aufklappen: die Angaben, die vorher nur beim Schieben sichtbar waren,
// stehen danach da. Geprueft an einem Wert aus den hinteren Spalten.
await karteTippen('rapporteTable', 0);
k = await kartenDaten('rapporteTable');
check('KRITISCH: ein Tipp klappt die Karte auf', kn(k, 0).offen && kn(k, 0).koerper);
check('Aufgeklappt stehen die hinteren Tabellenspalten da (Pause, Unterzeichner, Bemerkung)',
  /30 Min\./.test(kn(k, 0).text) && /R\. Muster/.test(kn(k, 0).text) && /Baustellenverkehr/.test(kn(k, 0).text));
check('Die uebrigen Karten bleiben davon unberuehrt', k.slice(1).every(x => !x.offen));

// Akkordeon (ENT-409, revidiert ENT-400 Punkt 4): eine zweite Karte zu
// oeffnen klappt die erste automatisch zu, ohne einen zweiten Tipp darauf.
await karteTippen('rapporteTable', 2);
k = await kartenDaten('rapporteTable');
check('KRITISCH: eine zweite Karte zu oeffnen klappt die erste automatisch zu',
  !kn(k, 0).offen && kn(k, 2).offen);

// Ein Tipp auf die offene Karte klappt nur sie zu, ohne eine andere zu oeffnen.
// Zustand danach bewusst "alle zu" -- das braucht die spaetere Pruefung der
// Handlungen (sie oeffnet Karte 1 frisch und erwartet sie vorher geschlossen).
await karteTippen('rapporteTable', 2);
k = await kartenDaten('rapporteTable');
check('KRITISCH: ein zweiter Tipp auf dieselbe Karte klappt sie zu, ohne eine andere zu oeffnen',
  k.every(x => !x.offen));

// Der Hinweis auf zusammengehoerende Rapporte steht bei genau den beiden
// Karten desselben Einsatzes -- die Tabelle zeigt dort eine Klammer.
const mitHinweis = k.filter(x => /zum selben Einsatz/.test(x.text)).length;
check(`Beide Rapporte desselben Einsatzes sind als zusammengehoerig erkennbar (${mitHinweis} von 4)`, mitHinweis === 2);

// ── Sortieren ──────────────────────────────────────────────────────────────
// Geprueft wird die REIHENFOLGE der gezeichneten Daten, nicht die Aufschrift.
const datenReihe = async () => (await kartenDaten('rapporteTable')).map(x => x.datum);
const abwaerts = await datenReihe();
check('Voreingestellt stehen die neuesten Rapporte oben',
  abwaerts[0] === '26.03.2026' && abwaerts[abwaerts.length - 1] === '23.03.2026');
await knopfTippen('#rSortBtn');
const aufwaerts = await datenReihe();
check('KRITISCH: der Sortierknopf dreht die Reihenfolge tatsaechlich um',
  aufwaerts[0] === '23.03.2026' && aufwaerts[aufwaerts.length - 1] === '26.03.2026');
check('Die Beschriftung nennt danach den neuen Zustand',
  /Älteste zuerst/.test(await m.evaluate(() => (document.getElementById('rSortBtn') || {}).textContent || '')));
check('Auch umgedreht bleiben die Rapporte desselben Einsatzes benachbart -- sonst zerfaellt die Gruppe',
  (await kartenDaten('rapporteTable')).slice(2).every(x => /zum selben Einsatz/.test(x.text)));
await knopfTippen('#rSortBtn');
check('Ein weiterer Klick stellt die Ausgangsordnung wieder her',
  (await datenReihe())[0] === '26.03.2026');

// ── Suche ──────────────────────────────────────────────────────────────────
await m.fill('#rQ', 'dario');
await m.waitForTimeout(400);
check('KRITISCH: das Suchfeld filtert die Karten, nicht nur die Tabelle',
  (await kartenDaten('rapporteTable')).length === 1);
await m.fill('#rQ', 'gibtesnicht');
await m.waitForTimeout(400);
check('Ohne Treffer stehen keine Karten mehr da', (await kartenDaten('rapporteTable')).length === 0);
// "Kein Treffer" und "nichts vorhanden" sind verschiedene Aussagen (CLAUDE.md).
check('KRITISCH: ein Filter ohne Treffer sagt "keine Treffer", nicht "noch keine Rapporte"',
  /[Kk]eine Treffer/.test(await m.textContent('#rapporteTable'))
  && !/Noch keine Rapporte/.test(await m.textContent('#rapporteTable')));
await m.fill('#rQ', '');
await m.waitForTimeout(400);
check('Zuruecksetzen bringt alle Karten zurueck', (await kartenDaten('rapporteTable')).length === 4);

// ── Handlungen in der offenen Karte ────────────────────────────────────────
// Sie ersetzen auf dem Handy die Schublade -- also muss dort auch etwas
// passieren. "Herunterladen" wird deshalb wirklich ausgeloest und die
// entstehende Datei abgefangen.
await karteTippen('rapporteTable', 0);
const tasten = await m.evaluate(() => [...document.querySelectorAll('#rapporteTable .ag-karte .kk-tasten .btn')]
  .map(b => b.textContent.replace(/\s+/g, ' ').trim()));
check(`Die offene Karte traegt Herunterladen, Teilen, Kundenrapport und Loeschen (${tasten.join(', ')})`,
  tasten.some(t => /Herunterladen/.test(t)) && tasten.some(t => /Teilen/.test(t))
  && tasten.some(t => /Kundenrapport/.test(t)) && tasten.some(t => /Löschen/.test(t)));
const zuKlein = await m.evaluate(() => [...document.querySelectorAll('#rapporteTable .ag-karte .kk-tasten .btn')]
  .filter(b => b.getBoundingClientRect().height < 43.9).length);
check('Die Knoepfe in der Karte sind mindestens 44 px hoch', zuKlein === 0);

const dlVersprechen = m.waitForEvent('download', { timeout: 15000 }).catch(() => null);
await m.evaluate(() => {
  const b = [...document.querySelectorAll('#rapporteTable .ag-karte .kk-tasten .btn')]
    .find(x => /Herunterladen/.test(x.textContent));
  if (b) { b.click(); }
});
const datei = await dlVersprechen;
check('KRITISCH: "Herunterladen" erzeugt tatsaechlich eine Datei', !!datei);
check(`Und zwar ein PDF mit sprechendem Namen (${datei ? datei.suggestedFilename() : '–'})`,
  !!datei && /^Rapport-.*\.pdf$/.test(datei.suggestedFilename()));
check('Ein Klick auf einen Knopf klappt die Karte NICHT zu',
  kn(await kartenDaten('rapporteTable'), 0).offen);

// ── Offerten ───────────────────────────────────────────────────────────────
await m.evaluate(() => kuGoTab('offerten'));
await m.waitForTimeout(700);
s = await schiebt();
check(`KRITISCH: Offerten schieben die Seite nicht waagrecht (${s.seite} px)`, s.seite <= 1);
check(`KRITISCH: die Offerten-Liste selbst schiebt nicht mehr waagrecht (${s.tw} px)`, s.tw <= 1);

let o = await kartenDaten('ofTable');
check('Mobil steht je Offerte eine Karte', o.length === BEL.belege.length);
check('KRITISCH: die Offerten-Tabelle ist mobil nicht sichtbar',
  await m.evaluate(() => !document.querySelector('#ofTable table')?.getClientRects().length));
// Das Tausendertrennzeichen kommt aus toLocaleString('de-CH') und ist je
// nach ICU-Fassung ein gerader oder ein typografischer Apostroph -- geprueft
// wird der Betrag, nicht das Zeichen dazwischen.
check('Zugeklappt zeigt die Karte Datum, Nummer, Empfaenger und Summe',
  /26\.03\.2026/.test(kn(o, 0).text) && /OF-2026-004/.test(kn(o, 0).text)
  && /Beispiel Consulting/.test(kn(o, 0).text) && /1.?048\.55/.test(kn(o, 0).text));

await karteTippen('ofTable', 0);
o = await kartenDaten('ofTable');
check('KRITISCH: die Offerten-Karte klappt auf', kn(o, 0).offen && kn(o, 0).koerper);
check('Aufgeklappt stehen Referenz, Kunden-Nr. und Gueltigkeit da',
  /Projekt Nord/.test(kn(o, 0).text) && /K0001/.test(kn(o, 0).text) && /28\.03\.2026/.test(kn(o, 0).text));
const ofTasten = await m.evaluate(() => [...document.querySelectorAll('#ofTable .ag-karte .kk-tasten .btn')]
  .map(b => b.textContent.replace(/\s+/g, ' ').trim()));
check(`Die offene Offerte bietet Vorschau, Bearbeiten und Drucken (${ofTasten.join(', ')})`,
  ofTasten.some(t => /Vorschau/.test(t)) && ofTasten.some(t => /Bearbeiten/.test(t))
  && ofTasten.some(t => /Drucken/.test(t)));
// Seit ENT-403 dieselben zwei Wege wie beim Rapport (ENT-400) -- das war der
// ausdrueckliche Wunsch: "so wie es bei Rapporte schon ist".
check('KRITISCH: die offene Offerte bietet auch Herunterladen und Teilen',
  ofTasten.some(t => /Herunterladen/.test(t)) && ofTasten.some(t => /Teilen/.test(t)));
const ofZuKlein = await m.evaluate(() => [...document.querySelectorAll('#ofTable .ag-karte .kk-tasten .btn')]
  .filter(b => b.getBoundingClientRect().height < 43.9).length);
check('Die Knoepfe der Offerten-Karte sind mindestens 44 px hoch', ofZuKlein === 0);

// Und wieder: geprueft wird, ob wirklich eine Datei entsteht -- nicht, ob
// eine Funktion existiert.
const ofDlVersprechen = m.waitForEvent('download', { timeout: 20000 }).catch(() => null);
await m.evaluate(() => {
  const b = [...document.querySelectorAll('#ofTable .ag-karte .kk-tasten .btn')]
    .find(x => /Herunterladen/.test(x.textContent));
  if (b) { b.click(); }
});
const ofDatei = await ofDlVersprechen;
check('KRITISCH: "Herunterladen" erzeugt bei der Offerte tatsaechlich eine Datei', !!ofDatei);
check(`Und zwar ein PDF, benannt nach der Offertennummer (${ofDatei ? ofDatei.suggestedFilename() : '–'})`,
  !!ofDatei && /^OF-2026-004\.pdf$/.test(ofDatei.suggestedFilename()));
await m.waitForTimeout(300);
check('Der Klick klappt die Offerten-Karte nicht zu',
  kn(await kartenDaten('ofTable'), 0).offen);

// Akkordeon (ENT-409, revidiert ENT-400 Punkt 4): eigener Zustand je Liste,
// aber dieselbe Regel wie bei den Rapporten -- eine zweite Offerte zu
// oeffnen klappt die erste automatisch zu.
await karteTippen('ofTable', 1);
o = await kartenDaten('ofTable');
check('KRITISCH: eine zweite Offerte zu oeffnen klappt die erste automatisch zu',
  !kn(o, 0).offen && kn(o, 1).offen);
await karteTippen('ofTable', 1);
o = await kartenDaten('ofTable');
check('KRITISCH: ein zweiter Tipp auf dieselbe Offerte klappt sie zu, ohne eine andere zu oeffnen',
  o.every(x => !x.offen));

// Sortierung der Offerten: dieselbe Aussage wie oben, eigene Zustandsgroesse.
const ofDaten = async () => (await kartenDaten('ofTable')).map(x => x.datum);
check('Voreingestellt steht die neueste Offerte oben', (await ofDaten())[0] === '26.03.2026');
await knopfTippen('#ofSortBtn');
check('KRITISCH: der Sortierknopf dreht auch die Offerten um', (await ofDaten())[0] === '12.03.2026');
await knopfTippen('#ofSortBtn');
check('Und wieder zurueck', (await ofDaten())[0] === '26.03.2026');

await m.fill('#ofQ', 'Revierdienst');
await m.waitForTimeout(400);
check('KRITISCH: das Offerten-Suchfeld filtert die Karten', (await kartenDaten('ofTable')).length === 1);
await m.fill('#ofQ', '');
await m.waitForTimeout(400);

// ── Adressen (ENT-401) ─────────────────────────────────────────────────────
await m.evaluate(() => kuGoTab('uebersicht'));
await m.waitForTimeout(700);
s = await schiebt();
check(`KRITISCH: Adressen schieben die Seite nicht waagrecht (${s.seite} px)`, s.seite <= 1);
check(`KRITISCH: die Adressliste selbst schiebt nicht mehr waagrecht (${s.tw} px)`, s.tw <= 1);

let a = await kartenDaten('kuTable');
check('Mobil steht je Kunde eine Karte', a.length === 3);
check('KRITISCH: die Kundentabelle ist mobil nicht sichtbar',
  await m.evaluate(() => !document.querySelector('#kuTable table')?.getClientRects().length));
check('Zugeklappt zeigt die Karte Name, Nummer, Ort und Telefon',
  /Beispiel Consulting GmbH/.test(kn(a, 0).text) && /K0001/.test(kn(a, 0).text)
  && /Olten/.test(kn(a, 0).text) && /062 000 00 00/.test(kn(a, 0).text));
// "unbekannt" darf nie wie "keine" aussehen: Ein Kunde ohne Telefon zeigt
// das ausdruecklich an, statt die Zeile wegzulassen.
check('Ein Kunde ohne Telefonnummer sagt das, statt die Zeile wegzulassen',
  a.some(x => /keine Telefonnummer/.test(x.text)));

await karteTippen('kuTable', 0);
a = await kartenDaten('kuTable');
check('KRITISCH: die Adress-Karte klappt auf', kn(a, 0).offen && kn(a, 0).koerper);
check('Aufgeklappt stehen E-Mail, Kontaktperson und Notiz da',
  /info@beispiel\.ch/.test(kn(a, 0).text) && /R\. Muster/.test(kn(a, 0).text)
  && /Schluessel im Tresor/.test(kn(a, 0).text));
// Der eigentliche Handy-Gewinn: Die Nummer laesst sich waehlen, statt sie
// abzuschreiben. Geprueft am tatsaechlichen Verweisziel, nicht am Text.
check('KRITISCH: die Telefonnummer ist ein Anruf-Verweis (tel:)',
  await m.evaluate(() => {
    const a2 = document.querySelector('#kuTable .kk-koerper a[href^="tel:"]');
    return !!a2 && /^tel:\+?[\d]+$/.test(a2.getAttribute('href'));
  }));
check('Die E-Mail ist ein mailto-Verweis',
  await m.evaluate(() => !!document.querySelector('#kuTable .kk-koerper a[href^="mailto:"]')));
const kuTasten = await m.evaluate(() => [...document.querySelectorAll('#kuTable .ag-karte .kk-tasten .btn')]
  .map(b => b.textContent.replace(/\s+/g, ' ').trim()));
check(`Die offene Adresse bietet Oeffnen und Bearbeiten (${kuTasten.join(', ')})`,
  kuTasten.some(t => /Öffnen/.test(t)) && kuTasten.some(t => /Bearbeiten/.test(t)));

// Sortierung: Das Feld steht anfangs auf "kundennummer" (Desktop-Vorgabe),
// darum bietet der Knopf zuerst den Wechsel auf den Namen an.
await knopfTippen('#kuSortBtn');
const nachName = (await kartenDaten('kuTable')).map(x => x.datum);
check('KRITISCH: der Knopf sortiert die Adressen nach Namen (A–Z)',
  nachName[0] === 'Alpha Privat' && nachName[nachName.length - 1] === 'Muster AG');
await knopfTippen('#kuSortBtn');
check('KRITISCH: ein weiterer Klick dreht auf Z–A',
  (await kartenDaten('kuTable')).map(x => x.datum)[0] === 'Muster AG');

await m.fill('#kQ', 'Alpha');
await m.waitForTimeout(400);
check('KRITISCH: das Adress-Suchfeld filtert die Karten', (await kartenDaten('kuTable')).length === 1);
await m.fill('#kQ', '');
await m.waitForTimeout(400);

// ── Objekte (ENT-401) ──────────────────────────────────────────────────────
await m.evaluate(() => kuGoTab('objekte'));
await m.waitForTimeout(700);
s = await schiebt();
check(`KRITISCH: Objekte schieben die Seite nicht waagrecht (${s.seite} px)`, s.seite <= 1);
check(`KRITISCH: die Objektliste selbst schiebt nicht mehr waagrecht (${s.tw} px)`, s.tw <= 1);

let ob = await kartenDaten('oTable');
check('Mobil steht je Objekt eine Karte', ob.length === 2);
check('KRITISCH: die Objekttabelle ist mobil nicht sichtbar',
  await m.evaluate(() => !document.querySelector('#oTable table')?.getClientRects().length));
// KRITISCH und der Grund fuer den dritten Zustand: objekt_list.php liefert
// bereits sortiert (ORDER BY aktiv DESC, name). Wuerde die Oberflaeche im
// Ausgangszustand selbst nachsortieren, verloere die Liste die Gruppierung
// "in Betrieb zuerst" -- und zwar auch am Desktop, wo niemand danach
// gefragt hat. Genau das ist beim Bauen passiert und hat test_auslagen und
// test_objekte rot gemacht. Geprueft wird darum, dass die gelieferte
// Reihenfolge unangetastet bleibt, solange niemand den Knopf drueckt.
check('KRITISCH: im Ausgangszustand bleibt die Reihenfolge des Servers stehen',
  kn(ob, 0).datum === 'Einkaufszentrum Nord West' && kn(ob, 1).datum === 'Baustelle Kreisel');
check('Der Knopf nennt diesen Zustand beim Namen',
  /In Betrieb zuerst/.test(await m.evaluate(() => (document.getElementById('obSortBtn') || {}).textContent || '')));
check('Zugeklappt zeigt die Karte Objekt, Kunde, Ort und Zustand',
  /Einkaufszentrum/.test(kn(ob, 0).text) && /Beispiel Consulting/.test(kn(ob, 0).text)
  && /Olten/.test(kn(ob, 0).text) && /in Betrieb/.test(kn(ob, 0).text));

await karteTippen('oTable', 0);
ob = await kartenDaten('oTable');
check('KRITISCH: die Objekt-Karte klappt auf', kn(ob, 0).offen && kn(ob, 0).koerper);
check('Aufgeklappt stehen Kanton, Masterschichten und Bemerkung da',
  /SO/.test(kn(ob, 0).text) && /Zufahrt hinten/.test(kn(ob, 0).text));
// "keine hinterlegt" statt "0": nicht eingerichtet ist nicht dasselbe wie null.
await karteTippen('oTable', 1);
check('Ein Objekt ohne Masterschichten sagt "keine hinterlegt" statt "0"',
  /keine hinterlegt/.test(kn(await kartenDaten('oTable'), 1).text));

// Drei Zustaende, im Kreis: Standard -> A-Z -> Z-A -> Standard.
await knopfTippen('#obSortBtn');
check('KRITISCH: ein Klick sortiert die Objekte alphabetisch',
  (await kartenDaten('oTable')).map(x => x.datum)[0] === 'Baustelle Kreisel');
await knopfTippen('#obSortBtn');
check('KRITISCH: der zweite Klick dreht auf Z–A',
  (await kartenDaten('oTable')).map(x => x.datum)[0] === 'Einkaufszentrum Nord West');
await knopfTippen('#obSortBtn');
check('KRITISCH: der dritte Klick fuehrt zurueck zur Server-Ordnung',
  (await kartenDaten('oTable')).map(x => x.datum)[0] === 'Einkaufszentrum Nord West'
  && /In Betrieb zuerst/.test(await m.evaluate(() => (document.getElementById('obSortBtn') || {}).textContent || '')));
await m.fill('#oQ', 'Kreisel');
await m.waitForTimeout(400);
check('KRITISCH: das Objekt-Suchfeld filtert die Karten', (await kartenDaten('oTable')).length === 1);
await m.fill('#oQ', '');
await m.waitForTimeout(400);

await m.screenshot({ path: `${OUT}/kundenkarten-mobil.png` });
await m.close();

// ══════════════════════════════ DESKTOP: nichts davon darf dort greifen
const d = await browser.newPage({ viewport: { width: 1440, height: 900 } });
d.setDefaultTimeout(6000);
d.on('pageerror', e => bad.push('JS-Fehler (Desktop): ' + e.message));
await mock(d); await anmelden(d);
await d.evaluate(() => { go('kunden'); kuGoTab('rapporte'); });
await d.waitForTimeout(700);
check('KRITISCH: am Desktop bleibt die Rapport-Tabelle die Darstellung',
  await d.evaluate(() => !!document.querySelector('#rapporteTable table')?.getClientRects().length));
check('Die Karten sind am Desktop ausgeblendet',
  await d.evaluate(() => !document.querySelector('#rapporteTable .nur-schmal')?.getClientRects().length));
check('Der Sortierknopf ist am Desktop ausgeblendet -- dort sortieren die Spaltenkoepfe',
  await d.evaluate(() => !document.getElementById('rSortBtn')?.getClientRects().length));
check('Die Klammer ueber zusammengehoerende Rapporte besteht am Desktop weiter',
  await d.evaluate(() => document.querySelectorAll('#rapporteTable td.rapp-klammer[rowspan]').length > 0));
await d.evaluate(() => kuGoTab('offerten'));
await d.waitForTimeout(600);
check('KRITISCH: am Desktop bleibt die Offerten-Tabelle die Darstellung',
  await d.evaluate(() => !!document.querySelector('#ofTable table')?.getClientRects().length));
check('Die Offerten-Karten sind am Desktop ausgeblendet',
  await d.evaluate(() => !document.querySelector('#ofTable .nur-schmal')?.getClientRects().length));
check('Am Desktop sortieren weiterhin die Spaltenkoepfe',
  await d.evaluate(() => document.querySelectorAll('#ofTable th.sortbar').length >= 6));
for (const [tab, id, name] of [['uebersicht', 'kuTable', 'Adressen'], ['objekte', 'oTable', 'Objekte']]) {
  await d.evaluate(t => kuGoTab(t), tab);
  await d.waitForTimeout(600);
  check(`KRITISCH: am Desktop bleibt die ${name}-Tabelle die Darstellung`,
    await d.evaluate(s2 => !!document.querySelector('#' + s2 + ' table')?.getClientRects().length, id));
  check(`Die ${name}-Karten sind am Desktop ausgeblendet`,
    await d.evaluate(s2 => !document.querySelector('#' + s2 + ' .nur-schmal')?.getClientRects().length, id));
}
check('Der Adress-Sortierknopf ist am Desktop ausgeblendet',
  await d.evaluate(() => !document.getElementById('kuSortBtn')?.getClientRects().length));
check('Der Objekt-Sortierknopf ist am Desktop ausgeblendet',
  await d.evaluate(() => !document.getElementById('obSortBtn')?.getClientRects().length));
await d.close();

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
