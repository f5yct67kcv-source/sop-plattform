// Offerten-Modul: Liste, Formular, Produkte, Druck (ENT-181).
//
// Der Rechenkern selbst wird in test_belege.mjs geprueft -- hier geht es um
// alles, was darum herum steht. Drei Dinge haelt diese Suite scharf:
//
// 1. DAS FORMULAR RECHNET WIE DER BELEG, DEN ES NACHBAUT. Die Leitprobe ist
//    dieselbe echte Offerte wie im Rechenkern (OF-0093): einmal komplett
//    durch die Oberflaeche getippt, und am Ende muss CHF 3'111.90 dastehen.
//    Eine Oberflaeche, die richtig rechnet, aber die falschen Werte an den
//    Server schickt, waere sonst gruen.
//
// 2. WAS GESPEICHERT WIRD, IST WAS ERFASST WURDE. Geprueft wird der
//    tatsaechliche Rumpf der Speicheranfrage, nicht nur "es kam ein ok
//    zurueck" -- eine Position, die auf dem Weg ihren MWST-Satz verliert,
//    faellt erst auf der Rechnung auf.
//
// 3. DAS GEDRUCKTE BLATT PASST AUF EINE SEITE. Genau daran ist der
//    Kundenrapport schon einmal gescheitert (ENT-179).
import { WURZEL, HIER, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const URL = `file://${WURZEL}/dashboard.html`;
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

// Kein festes Datum nahe beim heutigen Tag (test_datumsfest.mjs): Die
// Offertenliste vergleicht "gueltig bis" mit HEUTE und markiert Abgelaufenes
// -- ein hingeschriebenes Datum kippte beim naechsten Monatswechsel und
// machte diese Suite ohne Codeaenderung rot.
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const tag = n => iso(new Date(Date.now() + n * 864e5));

const PRODUKTE = { status: 'ok', produkte: [
  { id: 1, name: 'Verkehrsdienst', beschreibung: 'Verkehrsregelung von Hand', einzelpreis_rappen: 4200, einheit: 'Std.', mwst_satz_bp: 810, sortierung: 10, aktiv: 1 },
  { id: 2, name: 'Zulagen', beschreibung: 'Auslagenersatz nach GAV Art. 18', einzelpreis_rappen: 1680, einheit: 'Stk.', mwst_satz_bp: 0, sortierung: 20, aktiv: 1 },
  // Ein archiviertes Produkt: darf sich NICHT mehr vorschlagen.
  { id: 3, name: 'Stillgelegt', beschreibung: '', einzelpreis_rappen: 100, einheit: 'Std.', mwst_satz_bp: 810, sortierung: 30, aktiv: 0 },
]};
const BELEGE = { status: 'ok', naechste_nummer: 'OF-0126', belege: [
  { id: 11, art: 'offerte', nummer: 'OF-0125', kunde_id: 1, kunde_name: 'Gemeinde Läufelfingen', kundennummer: 'A0025', titel: 'Grundreinigung', referenz: null, datum: tag(-12), gueltig_bis: tag(18), status: 'angeschaut', rabatt_bp: 0, total_rappen: 104855, aktiv: 1, ist_vorlage: 0 },
  { id: 12, art: 'offerte', nummer: 'OF-0124', kunde_id: 2, kunde_name: 'Rieder Wittwer Immobilien', kundennummer: 'A0220', titel: 'Hauswartung', referenz: 'B-77', datum: tag(-16), gueltig_bis: tag(14), status: 'versendet', rabatt_bp: 0, total_rappen: 135125, aktiv: 1, ist_vorlage: 0 },
  { id: 13, art: 'offerte', nummer: 'OF-0093', kunde_id: 1, kunde_name: 'Gemeinde Läufelfingen', kundennummer: 'A0025', titel: 'Verkehrsdienst', referenz: null, datum: '2026-02-25', gueltig_bis: '2026-03-27', status: 'bestaetigt', rabatt_bp: 700, total_rappen: 311190, aktiv: 1, ist_vorlage: 0 },
  { id: 14, art: 'offerte', nummer: 'OF-0090', kunde_id: 2, kunde_name: 'Rieder Wittwer Immobilien', kundennummer: 'A0220', titel: 'Altes', referenz: null, datum: '2026-02-17', gueltig_bis: '2026-03-19', status: 'abgelehnt', rabatt_bp: 0, total_rappen: 55295, aktiv: 0, ist_vorlage: 0 },
]};
const KU = { status: 'ok', kunden: [
  { id: 1, name: 'Gemeinde Läufelfingen', kundennummer: 'A0025', strasse: 'Dorfstrasse', hausnummer: '4', plz: '4448', ort: 'Läufelfingen', aktiv: 1,
    personen: [{ id: 5, anrede: 'Herr', vorname: 'Patrick', nachname: 'Hufschmid' }], kontaktwege: [] },
  { id: 2, name: 'Rieder Wittwer Immobilien', kundennummer: 'A0220', strasse: 'Weg', hausnummer: '1', plz: '4600', ort: 'Olten', aktiv: 1, personen: [], kontaktwege: [] },
]};

let gespeichert = null, statusRufe = [], archivRufe = [], dupRufe = [];

const browser = await chromium.launch({ executablePath: browserPfad() });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
// Der bekannte, harmlose Fehler aus unvollstaendigen Kennzahlen-Fixtures wird
// ausgeblendet -- er gehoert nicht zu dieser Suite und stammt aus der
// Uebersicht, die hier gar nicht geprueft wird.
page.on('pageerror', e => {
  if (/rapporte_monat/.test(e.message)) { return; }
  bad.push('JS-Fehler: ' + e.message);
});
await page.route('**/api/**', async route => {
  const url = route.request().url();
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (url.includes('login.php')) return send({ status: 'ok', token: 't', name: 'adrian', ist_admin: true });
  if (url.includes('me.php')) return send({ status: 'ok', name: 'adrian', ist_admin: true, rollen: [],
    rechte: ['kunden', 'abgleich', 'personal_lesen', 'betrieb', 'plan', 'offerten', 'rechte'] });
  if (url.includes('produkt_list')) return send(PRODUKTE);
  if (url.includes('beleg_list')) return send(BELEGE);
  if (url.includes('kunden_list')) return send(KU);
  if (url.includes('beleg_status')) { statusRufe.push(JSON.parse(route.request().postData() || '{}')); return send({ status: 'ok' }); }
  if (url.includes('beleg_archivieren')) { archivRufe.push(JSON.parse(route.request().postData() || '{}')); return send({ status: 'ok' }); }
  if (url.includes('beleg_duplizieren')) { dupRufe.push(JSON.parse(route.request().postData() || '{}')); return send({ status: 'ok', id: 77, nummer: 'OF-0127' }); }
  if (url.includes('beleg_speichern')) {
    gespeichert = JSON.parse(route.request().postData() || '{}');
    return send({ status: 'ok', id: 99, nummer: 'OF-0126',
      summen: { zwischensumme_rappen: 310800, rabatt_bp: 700, rabatt_rappen: 21756, netto_rappen: 289044,
        mwst: [{ satz_bp: 810, grundlage_rappen: 273420, betrag_rappen: 22147 }],
        mwst_rappen: 22147, rundung_rappen: -1, total_rappen: 311190, zeilen: [] } });
  }
  return send({ status: 'ok' });
});

await page.goto(URL);
await page.fill('#gName', 'adrian'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#shell.on');
await page.waitForTimeout(400);

// ══════════════════════════════════════════════════════════════════════════
// TEIL 1 — Die Liste
// ══════════════════════════════════════════════════════════════════════════
// Die Kunden-Gruppe ist zugeklappt, solange man nicht darin ist -- erst
// oeffnen, dann den Unterpunkt anklicken. Genau wie ein Mensch es taete.
await page.click('#nav-kunden');
await page.waitForTimeout(250);
await page.click('#nav-kunden-offerten');
await page.waitForTimeout(400);
check('Der Offerten-Reiter ist über die Seitenleiste erreichbar',
  await page.evaluate(() => document.getElementById('kv-offerten').classList.contains('on')));

const kopf = await page.$$eval('#ofTable thead th', t => t.map(x => x.textContent.replace(/[▲▼]/g, '').trim()));
check('KRITISCH: die Spalten entsprechen dem Vorbild',
  JSON.stringify(kopf) === JSON.stringify(['Status', 'Nr.', 'Referenz', 'Titel', 'Empfänger',
    'Offertendatum', 'Offertensumme', 'Gültig bis', 'Aktion']));
check('KRITISCH: nur aktive Offerten stehen unter "Alle" (die archivierte fehlt)',
  (await page.$$('#ofTable tbody tr')).length === 3);
check('Jede Spalte ausser "Aktion" lässt sich sortieren',
  (await page.$$('#ofTable thead th.sortbar')).length === 8);
// Vorgabe: neueste zuerst. Eine Liste, die mit der aeltesten Offerte
// aufmacht, zeigt die am wenigsten interessante Zeile zuerst.
check('KRITISCH: Vorgabe ist Datum absteigend — die neueste Offerte steht oben',
  (await page.textContent('#ofTable tbody tr:first-child td:nth-child(2)')).trim() === 'OF-0125');

// Sortierung nach Betrag muss NUMERISCH sein. Als Zeichenkette sortiert
// stuende "1'048.55" vor "952.00" -- unauffaellig falsch.
await page.evaluate(() => ofSort('total_rappen'));
await page.waitForTimeout(150);
const nachBetrag = await page.$$eval('#ofTable tbody tr td:nth-child(7)', t => t.map(x => x.textContent.trim()));
check('KRITISCH: nach Summe wird numerisch sortiert, nicht als Text',
  nachBetrag[0].includes('1’048.55') && nachBetrag[2].includes('3’111.90'));
await page.evaluate(() => ofSort('total_rappen'));
await page.waitForTimeout(150);
check('Zweiter Klick kehrt die Richtung um',
  (await page.textContent('#ofTable tbody tr:first-child td:nth-child(7)')).includes('3’111.90'));

// Archiviert-Reiter
await page.click('#ofatab-archiv');
await page.waitForTimeout(200);
check('Der Archiv-Reiter zeigt genau die archivierte Offerte',
  (await page.$$('#ofTable tbody tr')).length === 1
  && (await page.textContent('#ofTable tbody tr:first-child')).includes('OF-0090'));
await page.click('#ofatab-alle');
await page.waitForTimeout(200);

// Suche und Statusfilter
await page.fill('#ofQ', 'hauswartung');
await page.waitForTimeout(150);
check('Die Suche findet über den Titel', (await page.$$('#ofTable tbody tr')).length === 1);
await page.fill('#ofQ', 'zzzz');
await page.waitForTimeout(150);
// "Kein Treffer" und "nichts vorhanden" sind verschiedene Aussagen
// (Gestaltungsregel) -- ein Filter, der alles ausblendet, darf nie wie ein
// leerer Bestand aussehen.
check('KRITISCH: ein Filter ohne Treffer sagt "Keine Treffer", nicht "noch keine Offerten"',
  (await page.textContent('#ofTable')).includes('Keine Treffer'));
await page.fill('#ofQ', '');
await page.waitForTimeout(150);
const statusOpt = await page.$$eval('#ofStatus option', o => o.map(x => x.value));
check('KRITISCH: der Statusfilter bietet nur Status an, die es auch gibt',
  statusOpt.includes('angeschaut') && statusOpt.includes('versendet')
  && statusOpt.includes('bestaetigt') && !statusOpt.includes('entwurf'));
await page.selectOption('#ofStatus', 'bestaetigt');
await page.waitForTimeout(150);
check('Der Statusfilter greift', (await page.$$('#ofTable tbody tr')).length === 1);
await page.selectOption('#ofStatus', '');
await page.waitForTimeout(150);
await page.screenshot({ path: `${OUT}/of-01-liste.png`, fullPage: true });

// ── Zeilenmenü
// Fuer eine BESTIMMTE Offerte oeffnen, nicht fuer "die erste Zeile" -- nach
// den Sortierproben oben steht dort eine andere, und der Test pruefte sonst
// eine Annahme ueber die Sortierung statt das Menue.
await page.evaluate(() => {
  const knopf = [...document.querySelectorAll('#ofTable tbody tr')]
    .find(tr => tr.textContent.includes('OF-0125')).querySelector('.rowmenu-btn');
  knopf.click();
});
await page.waitForTimeout(200);
const menuText = await page.textContent('#rowmenuPop');
check('Das Zeilenmenü bietet Bearbeiten, Drucken, Duplizieren und Archivieren',
  ['Bearbeiten', 'Drucken', 'Duplizieren', 'In Vorlage umwandeln', 'Archivieren']
    .every(w => menuText.includes(w)));
check('KRITISCH: es gibt kein "Stornieren" — eine Offerte hat nichts zu stornieren',
  !/stornier/i.test(menuText));
check('KRITISCH: der aktuelle Status steht nicht als Wechselziel im Menü',
  !menuText.includes('Als „Angeschaut" markieren') && menuText.includes('Als „Bestätigt" markieren'));
await page.evaluate(() => ofStatusSetzen(11, 'bestaetigt'));
await page.waitForTimeout(300);
check('KRITISCH: der Statuswechsel geht mit der richtigen Id an den Server',
  statusRufe.length === 1 && statusRufe[0].id === 11 && statusRufe[0].neuer_status === 'bestaetigt');
await page.evaluate(() => ofArchivKlick(11, 0));
await page.waitForTimeout(300);
check('Archivieren schickt aktiv=0', archivRufe.length === 1 && archivRufe[0].aktiv === 0);
await page.evaluate(() => ofDuplizieren(11, 1));
await page.waitForTimeout(300);
check('„In Vorlage umwandeln" schickt als_vorlage=1', dupRufe.length === 1 && dupRufe[0].als_vorlage === 1);

// ══════════════════════════════════════════════════════════════════════════
// TEIL 2 — Das Formular baut OF-0093 exakt nach
// ══════════════════════════════════════════════════════════════════════════
await page.evaluate(() => ofNeuStarten());
await page.waitForTimeout(400);
check('KRITISCH: "Offerte erstellen" öffnet das Formular',
  await page.evaluate(() => document.getElementById('view-offerte').classList.contains('on')));
check('Die nächste freie Nummer steht als Vorschau im Kopf',
  (await page.textContent('#ofFormNummer')).trim() === 'OF-0126');
check('KRITISCH: vor dem ersten Speichern gibt es keinen Drucken-Knopf',
  await page.evaluate(() => document.getElementById('ofFormDruckBtn').style.display === 'none'));
// Gültig bis wird vorgeschlagen, nicht leer gelassen -- eine Offerte ohne
// Frist ist im Zweifel unbefristet, und das will niemand versehentlich.
const vorgabe = await page.evaluate(() => ({ d: document.getElementById('of_datum').value,
                                             g: document.getElementById('of_gueltig').value }));
check('KRITISCH: "Gültig bis" wird mit 30 Tagen vorgeschlagen',
  vorgabe.g === new Date(new Date(vorgabe.d + 'T12:00:00').getTime() + 30 * 864e5).toISOString().slice(0, 10));

await page.fill('#of_kunde', 'Gemeinde Läufelfingen');
await page.evaluate(() => ofKundeGewaehlt());
await page.waitForTimeout(150);
const personOpt = await page.$$eval('#of_person option', o => o.map(x => x.textContent.trim()));
check('KRITISCH: die Ansprechpersonen des gewählten Kunden stehen zur Auswahl',
  personOpt.some(t => t.includes('Patrick Hufschmid')));
await page.fill('#of_kunde', 'Rieder Wittwer Immobilien');
await page.evaluate(() => ofKundeGewaehlt());
await page.waitForTimeout(150);
check('KRITISCH: beim Kundenwechsel verschwindet die fremde Ansprechperson',
  await page.evaluate(() => document.getElementById('of_person').disabled === true));
await page.fill('#of_kunde', 'Gemeinde Läufelfingen');
await page.evaluate(() => ofKundeGewaehlt());
await page.waitForTimeout(150);

await page.fill('#of_titel', 'Verkehrsdienst');
await page.fill('#of_datum', '2026-02-25');
await page.fill('#of_gueltig', '2026-03-27');
await page.fill('#of_rabatt', '7');

// Position 1: Produkt aus den Stammdaten übernehmen
await page.fill('#ofp_name0', 'Verkehrsdienst');
await page.evaluate(() => ofProduktUebernehmen(0, 'Verkehrsdienst'));
await page.waitForTimeout(150);
const uebernommen = await page.evaluate(() => ({
  text: document.getElementById('ofp_text0').value,
  preis: document.getElementById('ofp_preis0').value,
  einheit: document.getElementById('ofp_einheit0').value,
  mwst: document.getElementById('ofp_mwst0').value,
}));
check('KRITISCH: das Produkt bringt Beschreibung, Preis, Einheit und MWST-Satz mit',
  uebernommen.text === 'Verkehrsregelung von Hand' && uebernommen.preis === '42.00'
  && uebernommen.einheit === 'Std.' && uebernommen.mwst === '810');
await page.fill('#ofp_menge0', '70');
await page.waitForTimeout(120);
check('Die Zeilensumme erscheint sofort', (await page.textContent('#ofp_summe0')).includes('2’940.00'));

// Einen Preis VON HAND eintippen und pruefen, dass er als Rappen ankommt.
// Beim ersten Bau fehlte genau das: Alle getippten Preise waren entweder 0
// oder kamen aus den Produkt-Stammdaten -- eine Gegenprobe, die die
// Franken/Rappen-Umrechnung kaputt machte, blieb darum gruen.
await page.fill('#ofp_preis0', '43.50');
await page.waitForTimeout(150);
check('KRITISCH: ein von Hand getippter Preis wird zu Rappen (43.50 -> 4350)',
  await page.evaluate(() => ofPos[0].einzelpreis_rappen === 4350));
check('KRITISCH: und die Zeilensumme rechnet damit (70 x 43.50 = 3’045.00)',
  (await page.textContent('#ofp_summe0')).includes('3’045.00'));
// Auch mit Komma, wie es auf einer Schweizer Tastatur schneller geht.
await page.fill('#ofp_preis0', '42,00');
await page.waitForTimeout(150);
check('KRITISCH: ein Preis mit Komma wird genauso gelesen (42,00 -> 4200)',
  await page.evaluate(() => ofPos[0].einzelpreis_rappen === 4200));
// Und die Menge mit Nachkommastellen.
await page.fill('#ofp_menge0', '70,5');
await page.waitForTimeout(150);
check('KRITISCH: eine Menge mit Komma wird gelesen (70,5)',
  await page.evaluate(() => ofPos[0].menge === 70.5));
await page.fill('#ofp_menge0', '70');
await page.waitForTimeout(150);
// Positionsrabatt von Hand -- der zweite Rabattweg, den die Liste sonst nie
// beruehrt.
await page.fill('#ofp_rabatt0', '10');
await page.waitForTimeout(150);
check('KRITISCH: ein Positionsrabatt wird zu Basispunkten (10 % -> 1000)',
  await page.evaluate(() => ofPos[0].rabatt_bp === 1000));
check('KRITISCH: und schlaegt sofort auf die Zeilensumme durch (2’646.00)',
  (await page.textContent('#ofp_summe0')).includes('2’646.00'));
await page.fill('#ofp_rabatt0', '0');
await page.waitForTimeout(150);

// Position 2: die steuerfreie Zulage
await page.evaluate(() => ofZeileHinzu());
await page.waitForTimeout(150);
await page.fill('#ofp_name1', 'Zulagen');
await page.evaluate(() => ofProduktUebernehmen(1, 'Zulagen'));
await page.waitForTimeout(150);
check('KRITISCH: der steuerfreie Auslagenersatz kommt mit 0 % herüber',
  await page.evaluate(() => document.getElementById('ofp_mwst1').value === '0'));
await page.fill('#ofp_menge1', '10');

// Position 3: reiner Textblock ohne Preis
await page.evaluate(() => ofZeileHinzu());
await page.waitForTimeout(150);
await page.fill('#ofp_name2', 'Bestimmungen');
await page.fill('#ofp_preis2', '0');
await page.fill('#ofp_menge2', '1');
await page.evaluate(() => ofZeileFeld(2, 'mwst_satz_bp', '0'));
await page.waitForTimeout(250);

const summen = (await page.textContent('#ofSummen')).replace(/\s+/g, ' ');
check('KRITISCH: das Formular trifft die Zwischensumme von OF-0093 (3’108.00)', summen.includes('3’108.00'));
check('KRITISCH: es weist den Rabatt aus (217.56)', summen.includes('217.56'));
check('KRITISCH: die MWST-Grundlage steht dabei (2’734.20) — sonst ist der Betrag nicht nachvollziehbar',
  summen.includes('2’734.20'));
check('KRITISCH: die MWST stimmt (221.47)', summen.includes('221.47'));
check('KRITISCH: die Rundungsdifferenz wird ausgewiesen (0.01)', summen.includes('0.01'));
check('KRITISCH: das Total trifft OF-0093 auf den Rappen (3’111.90)', summen.includes('3’111.90'));
await page.screenshot({ path: `${OUT}/of-02-formular.png`, fullPage: true });

// ── Was gespeichert wird
await page.evaluate(() => ofSpeichern());
await page.waitForTimeout(400);
check('KRITISCH: alle drei Positionen gehen an den Server', gespeichert && gespeichert.positionen.length === 3);
check('KRITISCH: der Gesamtrabatt geht als Basispunkte (700), nicht als "7"',
  gespeichert && gespeichert.rabatt_bp === 700);
check('KRITISCH: die Preise gehen als Rappen (4200), nicht als Franken',
  gespeichert && gespeichert.positionen[0].einzelpreis_rappen === 4200);
check('KRITISCH: der MWST-Satz je Position bleibt erhalten (810 / 0 / 0)',
  gespeichert && gespeichert.positionen.map(p => p.mwst_satz_bp).join(',') === '810,0,0');
check('KRITISCH: die Produkt-Zuordnung wandert mit, wo es eine gibt',
  gespeichert && gespeichert.positionen[0].produkt_id === 1 && gespeichert.positionen[2].produkt_id === null);
check('Der gewählte Empfänger geht als Id mit', gespeichert && gespeichert.kunde_id === 1);
check('Nach dem Speichern erscheint der Drucken-Knopf',
  await page.evaluate(() => document.getElementById('ofFormDruckBtn').style.display !== 'none'));

// ── Was NICHT gespeichert werden darf
gespeichert = null;
await page.evaluate(() => { ofFormKundeId = null; $('of_kunde').value = ''; ofSpeichern(); });
await page.waitForTimeout(250);
check('KRITISCH: ohne Empfänger wird nicht gespeichert, sondern gewarnt',
  gespeichert === null && await page.evaluate(() => document.getElementById('ofFormErr').style.display !== 'none'));
await page.evaluate(() => { ofFormKundeId = 1; $('of_gueltig').value = '2020-01-01'; ofSpeichern(); });
await page.waitForTimeout(250);
check('KRITISCH: ein Ablaufdatum vor dem Offertendatum wird abgewiesen',
  gespeichert === null
  && (await page.textContent('#ofFormErr')).includes('Gültig bis'));

// ── Positionen entfernen
await page.evaluate(() => { $('of_gueltig').value = '2026-03-27'; ofZeileWeg(2); });
await page.waitForTimeout(200);
check('Eine Position lässt sich entfernen',
  await page.evaluate(() => document.querySelectorAll('#ofPositionen .of-pos').length === 2));

// ══════════════════════════════════════════════════════════════════════════
// TEIL 3 — Produkte
// ══════════════════════════════════════════════════════════════════════════
await page.evaluate(() => go('produkte'));
await page.waitForTimeout(300);
check('Die Produkte-Ansicht ist über die Administration erreichbar',
  await page.evaluate(() => document.getElementById('view-produkte').classList.contains('on')));
check('KRITISCH: nur aktive Produkte stehen unter "Alle"',
  (await page.$$('#prodTable tbody tr')).length === 2);
check('KRITISCH: der steuerfreie Satz erscheint als Wort, nicht als "0 %"',
  (await page.textContent('#prodTable')).includes('steuerfrei'));
check('Der Preis erscheint in Franken mit zwei Nachkommastellen',
  (await page.textContent('#prodTable')).includes('42.00'));
const vorschlaege = await page.$$eval('#dlProdukte option', o => o.map(x => x.value));
check('KRITISCH: ein archiviertes Produkt schlägt sich nicht mehr vor',
  vorschlaege.includes('Verkehrsdienst') && !vorschlaege.includes('Stillgelegt'));
await page.click('#prodatab-archiv');
await page.waitForTimeout(200);
check('Der Archiv-Reiter zeigt das stillgelegte Produkt',
  (await page.textContent('#prodTable')).includes('Stillgelegt'));
await page.click('#prodatab-alle');
await page.waitForTimeout(200);
await page.screenshot({ path: `${OUT}/of-03-produkte.png`, fullPage: true });

await page.evaluate(() => pdNeu());
await page.waitForTimeout(250);
check('Der Produktdialog schlägt den Normalsatz vor',
  await page.evaluate(() => document.getElementById('prod_mwst').value === '810'));
check('Er schlägt eine Reihenfolge hinter den bestehenden vor',
  await page.evaluate(() => Number(document.getElementById('prod_sortierung').value) > 30));
await page.evaluate(() => pdSpeichern());
await page.waitForTimeout(200);
check('KRITISCH: ohne Bezeichnung wird nicht gespeichert',
  await page.evaluate(() => document.getElementById('prodErr').style.display !== 'none'));
await page.evaluate(() => closeDlg('dlgProdukt'));

// Komma statt Punkt: auf einer Schweizer Tastatur tippt man beides.
check('KRITISCH: ein Preis mit Komma wird richtig gelesen',
  await page.evaluate(() => chfZuRappen('42,50') === 4250 && chfZuRappen('42.50') === 4250));
check('Ein Betrag mit Hochkomma als Tausendertrennung wird gelesen',
  await page.evaluate(() => chfZuRappen("1'234.50") === 123450));

// ══════════════════════════════════════════════════════════════════════════
// TEIL 4 — Das gedruckte Blatt
// ══════════════════════════════════════════════════════════════════════════
const blatt = await page.evaluate(() => {
  briefkopf.firma = 'Cupi 24 GmbH';
  briefkopf.fusszeile = 'Cupi 24 GmbH\nBaslerstrasse 67\nCH-4632 Trimbach\n0763047648';
  briefkopf.fusszeile2 = 'info@cupi24.ch\nwww.cupi24.ch\nCHE-255.301.179';
  const b = { art: 'offerte', nummer: 'OF-0093', titel: 'Verkehrsdienst', referenz: 'B-12',
    datum: '2026-02-25', gueltig_bis: '2026-03-27', rabatt_bp: 700,
    positionen: [
      { produkt_name: 'Verkehrsdienst', beschreibung: 'Baustelle:\nFalkensteinstrasse', menge: 70, einheit: 'Std.', einzelpreis_rappen: 4200, rabatt_bp: 0, mwst_satz_bp: 810 },
      { produkt_name: 'Zulagen', beschreibung: 'Auslagenersatz', menge: 10, einheit: 'Stk.', einzelpreis_rappen: 1680, rabatt_bp: 0, mwst_satz_bp: 0 },
      { produkt_name: 'Bestimmungen', beschreibung: 'Mindesteinsatzzeit 2h', menge: 1, einheit: 'Stk.', einzelpreis_rappen: 0, rabatt_bp: 0, mwst_satz_bp: 0 },
    ] };
  b.summen = belegSummen(b.positionen, 700);
  const html = ofBlatt(b, { name: 'Primeo Energie AG', strasse: 'Aarburgerstrasse', hausnummer: '39', plz: '4600', ort: 'Olten' },
                          { vorname: 'Patrick', nachname: 'Hufschmid' });
  document.getElementById('printArea').innerHTML = html;
  document.getElementById('printArea').style.display = 'block';
  return { html, hoehe: document.getElementById('printArea').firstElementChild.getBoundingClientRect().height };
});
check('KRITISCH: die Offertennummer steht auf dem Blatt', blatt.html.includes('OF-0093'));
check('KRITISCH: der Empfänger steht darauf', blatt.html.includes('Primeo Energie AG'));
check('Die Ansprechperson steht darunter', blatt.html.includes('Patrick Hufschmid'));
check('Die Referenz erscheint nur, wenn es eine gibt', blatt.html.includes('B-12'));
check('KRITISCH: das Total steht darauf (3’111.90)', blatt.html.includes('3’111.90'));
check('KRITISCH: die MWST-Grundlage steht darauf (2’734.20)', blatt.html.includes('2’734.20'));
check('Die Rundungsdifferenz wird ausgewiesen', blatt.html.includes('Rundungsdifferenz'));
check('Der Absender kommt aus dem Briefkopf', blatt.html.includes('Baslerstrasse 67'));
check('Die zweispaltige Fusszeile hängt an (ENT-172)', blatt.html.includes('CHE-255.301.179'));
check('Mehrzeilige Beschreibungen bleiben mehrzeilig', blatt.html.includes('white-space:pre-line'));

// Der Test, an dem der Kundenrapport schon einmal gescheitert ist (ENT-179).
await page.emulateMedia({ media: 'print' });
await page.waitForTimeout(150);
await page.pdf({ path: `${OUT}/of-blatt.pdf`, printBackground: true, preferCSSPageSize: true });
await page.emulateMedia({ media: 'screen' });
const pdf = readFileSync(`${OUT}/of-blatt.pdf`).toString('latin1');
const seiten = Number((pdf.match(/\/Count (\d+)/) || [0, 0])[1]);
check('KRITISCH: das gedruckte Blatt passt auf EINE Seite (vgl. ENT-179)', seiten === 1);
// Der Druckbereich wieder weg: Er ist 700 px breit und wuerde die
// Handy-Pruefungen weiter unten mit einem Seiten-Scroll rot machen, der gar
// nicht aus dem Modul stammt. (Genau das ist beim ersten Lauf passiert.)
await page.evaluate(() => {
  document.getElementById('printArea').innerHTML = '';
  document.getElementById('printArea').style.display = '';
});

// ══════════════════════════════════════════════════════════════════════════
// TEIL 5 — Keine doppelten Element-Ids in der ganzen Seite
// ══════════════════════════════════════════════════════════════════════════
//
// Beim Bau dieses Moduls sind zwei Ids doppelt vergeben worden (pdTitel und
// pdErr gab es bereits im Planungs-Diktat). Die Folge war KEIN sichtbarer
// Fehler im neuen Modul, sondern ein kaputtes ALTES: $('pdErr') fand ab da
// das falsche Element, und die Fehlermeldung des Diktats erschien nicht mehr.
//
// Genau das ist der Grund, warum diese Pruefung die GANZE Seite prueft und
// nicht nur die Offerten: Eine doppelte Id schadet nie dort, wo sie entsteht.
const doppelte = await page.evaluate(() => {
  const gesehen = new Map();
  document.querySelectorAll('[id]').forEach(el => {
    gesehen.set(el.id, (gesehen.get(el.id) || 0) + 1);
  });
  return [...gesehen.entries()].filter(([, n]) => n > 1).map(([id]) => id);
});
check('KRITISCH: keine Element-Id kommt zweimal vor'
  + (doppelte.length ? ' — doppelt: ' + doppelte.join(', ') : ''),
  doppelte.length === 0);

// ══════════════════════════════════════════════════════════════════════════
// TEIL 6 — Rechte und Handy
// ══════════════════════════════════════════════════════════════════════════
await page.evaluate(() => { me.rechte = ['kunden', 'plan']; rechteAnwenden(); });
await page.waitForTimeout(200);
check('KRITISCH: ohne das Recht "offerten" verschwindet der Offerten-Eintrag',
  await page.evaluate(() => document.getElementById('nav-kunden-offerten').style.display === 'none'));
check('KRITISCH: ohne das Recht verschwindet auch der Produkte-Eintrag',
  await page.evaluate(() => document.getElementById('nav-admin-produkte').style.display === 'none'));
check('Der Kundenstamm bleibt trotzdem erreichbar — die Trennung ist der Sinn des Rechts',
  await page.evaluate(() => document.getElementById('navg-kunden').style.display !== 'none'));
await page.evaluate(() => { me.rechte = ['kunden', 'plan', 'offerten', 'betrieb', 'personal_lesen']; rechteAnwenden(); });
await page.waitForTimeout(200);

// Kein horizontaler Seiten-Scroll -- die Positionszeile hat sieben Felder
// nebeneinander und ist die engste Stelle des ganzen Moduls.
for (const w of [390, 768, 1440]) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.evaluate(() => { go('kunden'); kuGoTab('offerten'); });
  await page.waitForTimeout(150);
  const r1 = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, i: document.documentElement.clientWidth }));
  check(`Kein Seiten-Scroll bei ${w}px – Offertenliste`, r1.s <= r1.i + 1);
  await page.evaluate(() => go('offerte'));
  await page.waitForTimeout(150);
  const r2 = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, i: document.documentElement.clientWidth }));
  check(`KRITISCH: kein Seiten-Scroll bei ${w}px – Offert-Formular`, r2.s <= r2.i + 1);
  await page.evaluate(() => go('produkte'));
  await page.waitForTimeout(150);
  const r3 = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, i: document.documentElement.clientWidth }));
  check(`Kein Seiten-Scroll bei ${w}px – Produkte`, r3.s <= r3.i + 1);
}
await page.setViewportSize({ width: 1500, height: 1000 });

// Auf dem Handy stehen die Beschriftungen in JEDER Positionszeile -- ohne
// Kopfzeile daneben waere sonst nicht erkennbar, was "70" und was "42.00" ist.
await page.setViewportSize({ width: 390, height: 844 });
await page.evaluate(() => go('offerte'));
await page.waitForTimeout(250);
check('KRITISCH: auf dem Handy trägt auch die zweite Positionszeile ihre Beschriftungen',
  await page.evaluate(() => {
    const zeilen = document.querySelectorAll('#ofPositionen .of-pos');
    if (zeilen.length < 2) { return false; }
    const l = zeilen[1].querySelector('label');
    return !!l && l.getBoundingClientRect().height > 4;
  }));
await page.setViewportSize({ width: 1500, height: 1000 });
await page.waitForTimeout(200);
check('Am Desktop bleiben die Beschriftungen ab der zweiten Zeile ausgeblendet',
  await page.evaluate(() => {
    const zeilen = document.querySelectorAll('#ofPositionen .of-pos');
    const l = zeilen[1] && zeilen[1].querySelector('label');
    return !!l && l.getBoundingClientRect().height <= 4;
  }));

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
