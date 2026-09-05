// Rapporte und Offerten als aufklappbare Karten auf dem Handy (ENT-400).
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
  if (u.includes('kunden_list')) return send({ status: 'ok', kunden: [
    { id: 1, name: 'Beispiel Consulting GmbH', strasse: 'Mustergasse 2', ort: '4600 Olten' },
    { id: 2, name: 'Muster AG', strasse: 'Beispielweg 7', ort: '4632 Trimbach' }]});
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

// Mehrere gleichzeitig offen: der Grund fuer ein Set statt eines Feldes.
await karteTippen('rapporteTable', 2);
k = await kartenDaten('rapporteTable');
check('Zwei Karten koennen gleichzeitig offen sein', kn(k, 0).offen && kn(k, 2).offen);

// Wieder zu.
await karteTippen('rapporteTable', 0);
k = await kartenDaten('rapporteTable');
check('KRITISCH: ein zweiter Tipp klappt wieder zu', !kn(k, 0).offen && !kn(k, 0).koerper);
check('Und laesst die andere offene Karte offen', kn(k, 2).offen);

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
await d.close();

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
