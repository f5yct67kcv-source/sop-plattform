import { WURZEL, HIER, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { zeitSetzen } from './zeitfeld.mjs';
import { readFileSync } from 'fs';


const URL = `file://${WURZEL}/dashboard.html`;
const dash = readFileSync(`${WURZEL}/dashboard.html`, 'utf8');
const EXE = browserPfad();

// Datum lokal, gleiche Rechnung wie im Dashboard
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const tage = n => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const HEUTE = tage(0), FRUEHER = tage(-10), SPAETER = tage(20);
// MORGEN muss in derselben Kalenderwoche wie HEUTE liegen (Montag-Sonntag,
// siehe zrWoche() in dashboard.html) -- sonst faellt der Nachtdienst-
// Fixtureinsatz aus dem Standardfilter "Diese Woche" heraus, sobald der
// Testlauf an einem Sonntag stattfindet (dann beginnt "morgen" schon die
// naechste Woche). An jedem anderen Wochentag bleibt "morgen" unveraendert;
// nur am Sonntag weicht die Fixtur auf "gestern" aus, das liegt garantiert
// noch in derselben Woche.
const MORGEN = tage(new Date(HEUTE + 'T12:00:00').getDay() === 0 ? -1 : 1);
// Die KPI-Kacheln (renderPlKpi() in dashboard.html) zaehlen "ab heute" in
// einem rollenden 7-Tage-Fenster -- ein eigenes, von der Kalenderwoche der
// Tabelle unabhaengiges Zeitfenster. Am Sonntag liegt MORGEN vor "heute"
// (siehe oben) und zaehlt darum dort nicht mehr mit; die Erwartungswerte
// werden deshalb aus derselben Bedingung abgeleitet statt als feste Zahl
// angenommen, damit die Pruefung an jedem Wochentag stimmt.
const MORGEN_KOMMEND = MORGEN >= HEUTE;
const ERW_KOMMEND = MORGEN_KOMMEND ? '3' : '2';
const ERW_OFFEN = MORGEN_KOMMEND ? '2' : '1';       // 1 bei 11, +1 bei 13 nur falls kommend
const ERW_UNBESTAETIGT = MORGEN_KOMMEND ? '2' : '1'; // 11 und, falls kommend, 13

const STATS = { status: 'ok',
  kpi: { rapporte_monat: 4, rapporte_vormonat: 3, stunden_monat: 30, stunden_vormonat: 25, mitarbeiter: 3, kunden: 2, rapporte_total: 40 },
  verlauf: Array.from({ length: 8 }, (_, i) => ({ kw: 26 + i, stunden: 80, anzahl: 10 })),
  angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [] };

// ENT-138: 14 traegt einen Rapport mit vom Plan abweichenden Zeiten (Warnung
// erwartet), 12 einen deckungsgleichen (keine Warnung erwartet) -- Plan und
// Rapport nebeneinander in den jeweiligen Fixturen unten geprueft.
const RAPPORTE = { status: 'ok', rapporte: [
  { id: 500, einsatz_id: 14, mitarbeiter_id: 2, mitarbeiter: 'daniele.ciardo',
    von: '08:15:00', bis: '12:00:00', pause_min: 0, netto_h: 3.75,
    bemerkung: null, erfasst_am: null },
  { id: 501, einsatz_id: 12, mitarbeiter_id: 1, mitarbeiter: 'adrian',
    von: '12:00:00', bis: '18:00:00', pause_min: 0, netto_h: 6,
    bemerkung: null, erfasst_am: null },
] };

const MA = { status: 'ok', mitarbeiter: [
  { id: 1, name: 'adrian', ist_admin: 1, vorname: 'Adrian', nachname: 'Von Arb', ort: '4632 Trimbach' },
  { id: 2, name: 'daniele.ciardo', ist_admin: 0, vorname: 'Daniele', nachname: 'Ciardo', ort: '4600 Olten' },
  { id: 3, name: 'hans.meier', ist_admin: 0, vorname: 'Hans', nachname: 'Meier', ort: '3000 Bern' }
]};

const KU = { status: 'ok', kunden: [
  { id: 1, name: 'Studer Immobilien AG', strasse: 'Gerolagstrasse 12', ort: '4632 Trimbach', telefon: '062 111 22 33', email: null },
  { id: 2, name: 'Einwohnergemeinde Niedergösgen', strasse: 'Dorfstrasse 4', ort: '5013 Niedergösgen', telefon: '062 849 00 00', email: null }
]};

const A = { id: 1, name: 'adrian', vorname: 'Adrian', nachname: 'Von Arb' };
const D = { id: 2, name: 'daniele.ciardo', vorname: 'Daniele', nachname: 'Ciardo' };

const EINSAETZE = { status: 'ok', einsaetze: [
  // heute, unterbesetzt (1 von 2)
  { id: 11, kunde_id: 1, kunde_name: 'Studer Immobilien AG', titel: 'Baustelle Kreisel', strasse: 'Hauptstrasse 4',
    ort: '4632 Trimbach', einsatzart: 'Verkehrsdienst', datum: HEUTE, von: '07:00:00', bis: '16:00:00',
    bedarf: 2, status: 'geplant', bemerkung: null, mitarbeiter: [A], objekt_id: null },
  // heute, ueberschneidet sich zeitlich mit 11 -- selbe Person
  { id: 12, kunde_id: 2, kunde_name: 'Einwohnergemeinde Niedergösgen', titel: null, strasse: null,
    ort: '5013 Niedergösgen', einsatzart: 'Verkehrsdienst', datum: HEUTE, von: '12:00:00', bis: '18:00:00',
    bedarf: 1, status: 'bestaetigt', bemerkung: null, mitarbeiter: [A] },
  // morgen, ueber Mitternacht, niemand zugeteilt
  { id: 13, kunde_id: 1, kunde_name: 'Studer Immobilien AG', titel: 'Nachtdienst', strasse: null,
    ort: '4600 Olten', einsatzart: 'Sicherheitsdienst', datum: MORGEN, von: '22:00:00', bis: '06:00:00',
    bedarf: 1, status: 'geplant', bemerkung: null, mitarbeiter: [] },
  // vergangen, abgeschlossen (ENT-128: der Status entscheidet, nicht mehr das
  // Kalenderdatum -- ein FRUEHER-Einsatz mit status 'bestaetigt' waere seit
  // ENT-128 NICHT mehr "abgeschlossen", siehe test_einsatzplan.mjs)
  { id: 14, kunde_id: 2, kunde_name: 'Einwohnergemeinde Niedergösgen', titel: null, strasse: null,
    ort: '5013 Niedergösgen', einsatzart: 'Verkehrsdienst', datum: FRUEHER, von: '08:00:00', bis: '12:00:00',
    bedarf: 1, status: 'abgeschlossen', bemerkung: null, mitarbeiter: [D] },
  // abgesagt, in der Zukunft -- zaehlt nirgends als offen
  { id: 15, kunde_id: 1, kunde_name: 'Studer Immobilien AG', titel: null, strasse: null,
    ort: '4632 Trimbach', einsatzart: 'Verkehrsdienst', datum: SPAETER, von: '08:00:00', bis: '12:00:00',
    bedarf: 4, status: 'abgesagt', bemerkung: null, mitarbeiter: [] }
]};

let calls = [];
const writes = () => calls.filter(c => /create|update|delete|save|deactivate|reset/.test(c.path));

async function setup(page) {
  await page.route('**/api/**', async route => {
    const req = route.request();
    const path = req.url().split('/api/')[1].split('?')[0];
    let body = null;
    try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch {}
    calls.push({ path, body });
    const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (path.includes('login')) return send({ status: 'ok', token: 't', name: 'adrian', ist_admin: true });
    if (path.includes('dashboard_stats')) return send(STATS);
    if (path.includes('rapport_list')) return send(RAPPORTE);
    if (path.includes('mitarbeiter_list')) return send(MA);
    if (path.includes('kunden_list')) return send(KU);
    if (path.includes('einsatz_list')) return send(EINSAETZE);
    // Hauptanstellungsort fuer die Wegberechnung (ENT-116).
    if (path.includes('anstellungsorte')) return send({ status: 'ok', orte: [
      { id: 1, bezeichnung: 'Betrieb Olten', rolle: 'hao', strasse: 'Bahnhofstrasse 1',
        plz: '4600', ort: 'Olten', km_zum_anderen: null, aktiv: 1 },
    ] });
    if (path.includes('objekt_list')) return send({ status: 'ok', objekte: [] });
    if (path.includes('masterschicht_list')) return send({ status: 'ok', masterschichten: [] });
    if (path.includes('feiertage_list')) return send({ status: 'ok', feiertage: [], gepflegt: {} });
    if (path.includes('ki_router_parse')) return send({ status: 'ok', bereich: 'einsatz', aktion: 'neu',
      felder: { kunde_name: 'Studer Immobilien AG', titel: 'Fasnachtsumzug', strasse: 'Hauptstrasse 4',
                ort: '4632 Trimbach', datum: MORGEN, von: '07:00', bis: '17:00', bedarf: 2 },
      mitarbeiter_login_namen: ['hans.meier', 'daniele.ciardo', 'gibtsnicht'] });
    return send({ status: 'ok', id: 99 });
  });
}

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
await setup(page);

await page.goto(URL);
await page.fill('#gName', 'adrian'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#kpiGrid .kpi-val');

// ══════════ ANSICHT
check('Navigationspunkt Planung vorhanden', await page.isVisible('#nav-planung'));
await page.click('#nav-planung');
await page.click('#nav-planung-einsaetze');
await page.waitForSelector('#plTable table');
await page.waitForTimeout(300);
check('"Diktat: Einsatz" ist weg -- reine Dopplung zum globalen Sprechen-Knopf',
  (await page.$$('button:has-text("Diktat: Einsatz")')).length === 0);
check('Planung oeffnet ohne Schreibaufruf', writes().length === 0);
check('Seitentitel ist Planung', (await page.textContent('#pgTitle')) === 'Planung');

// Die Reiter stehen seit ENT-233 auf dem Desktop fest in der Kopfzeile
// (identisches Muster zu Kunden/Administration) statt im Seiteninhalt --
// nur auf dem Handy bleibt die alte, extra zugeschnittene Reiterleiste
// bestehen (Rapporte statt Objektplanung/Uebersicht, siehe
// test_tagesplan_mobil.mjs fuer die mobile Gegenprobe).
check('KRITISCH: "Objektplanung" bleibt auf dem Desktop ein sichtbarer Kopfzeilen-Reiter',
  await page.isVisible('#nav-planung-objektplan'));
// isVisible() allein wuerde auch bestehen, wenn der Reiter komplett fehlte
// statt nur per CSS versteckt zu sein -- deshalb zusaetzlich pruefen, dass
// er im DOM tatsaechlich existiert (Gegenprobe zeigte genau diese Luecke).
check('KRITISCH: der mobile "Rapporte"-Reiter existiert, ist auf dem Desktop aber unsichtbar',
  (await page.locator('#ptab-rapporte').count()) === 1 && !(await page.isVisible('#ptab-rapporte')));

// KPI
const kpiWerte = await page.$$eval('#plKpi .kpi-val', els => els.map(e => e.textContent.trim()));
check('Vier Kennzahlen', kpiWerte.length === 4);
check('Kommende Einsaetze ohne abgesagte und ohne vergangene', kpiWerte[0] === ERW_KOMMEND);
check('Naechste 7 Tage', kpiWerte[1] === ERW_KOMMEND);
check('Offene Stellen zaehlt nur Fehlende', kpiWerte[2] === ERW_OFFEN);
check('Nicht bestaetigt', kpiWerte[3] === ERW_UNBESTAETIGT);

// ══════════ LISTE
const zeilen = () => page.$$eval('#plTable tbody tr', rs => rs.map(r => ({
  grp: r.classList.contains('grp'), heute: r.classList.contains('heute'), t: r.innerText.replace(/\s+/g, ' ').trim()
})));
let z = await zeilen();
const dmy = d => d.split('-').reverse().join('.');
// Voreinstellung "Diese Woche" (ENT-222, vorher "ab heute, offenes Ende") --
// die Schnellauswahl zeigt das beim Oeffnen sofort korrekt an.
check('KRITISCH: die Schnellauswahl steht beim Oeffnen der Planung auf "Diese Woche" (ENT-222)',
  (await page.inputValue('#pSchnell')) === 'woche');
check('Standardfilter (Diese Woche) blendet Vergangenes aus', !z.some(r => r.t.includes(dmy(FRUEHER))));
// Weit in der Zukunft (20 Tage) liegt ausserhalb dieser Woche -- anders als
// beim frueheren offenen Ende blendet der Standardfilter das jetzt aus. Dass
// ein abgesagter Zukunftseinsatz grundsaetzlich nicht verschwindet, sobald
// man den Zeitraum weitet, prueft "Alle zeigt auch Vergangenes und
// Abgesagtes" weiter unten.
check('Standardfilter (Diese Woche) blendet auch weit Zukuenftiges aus',
  !z.some(r => r.t.includes(dmy(SPAETER))));
check('Drei Einsaetze in dieser Woche (heute und morgen, nicht der weit entfernte)',
  z.filter(r => !r.grp).length === 3);
check('Zwei Tagesueberschriften (heute und morgen)', z.filter(r => r.grp).length === 2);
check('Wochentag in der Ueberschrift', /MONTAG|DIENSTAG|MITTWOCH|DONNERSTAG|FREITAG|SAMSTAG|SONNTAG/i.test(z[0].t));
check('Heute ist markiert', z.some(r => r.grp && r.t.toLowerCase().includes('heute')));
check('Heutige Zeilen tragen die Markierung', z.filter(r => r.heute && !r.grp).length === 2);
check('Unterbesetzung sichtbar', z.some(r => !r.grp && r.t.includes('1/2') && r.t.includes('1 offen')));
check('Vollbesetzung als 1/1', z.some(r => !r.grp && r.t.includes('1/1')));
check('Nachteinsatz weist auf Folgetag hin', z.some(r => r.t.includes('bis Folgetag')));
check('Bezeichnung wird angezeigt', z.some(r => r.t.includes('Baustelle Kreisel')));
check('Arbeitsort statt Firmensitz', z.some(r => r.t.includes('Hauptstrasse 4')));
check('Kopfzeile nennt offene Stellen', (await page.textContent('#pgCrumb')).includes('offene'));
await page.screenshot({ path: `${OUT}/20-planung.png` });

// ══════════ FILTER (ENT-038: Zeitraum statt fester Optionen)
await page.selectOption('#pSchnell', 'alle');
await page.waitForTimeout(200);
z = await zeilen();
check('Alle zeigt auch Vergangenes und Abgesagtes', z.filter(r => !r.grp).length === 5);
check('Abgesagt-Kennzeichnung sichtbar', z.some(r => r.t.includes('Abgesagt')));
check('„Alle“ leert von und bis', (await page.inputValue('#pVon')) === '' && (await page.inputValue('#pBis')) === '');
await page.selectOption('#pStatus', 'offen');
await page.waitForTimeout(200);
z = await zeilen();
check('Filter „unterbesetzt“ zeigt nur Luecken', z.filter(r => !r.grp).length === 2);
await page.selectOption('#pStatus', 'abgeschlossen');
await page.waitForTimeout(200);
z = await zeilen();
check('KRITISCH: Filter „abgeschlossen“ zeigt nur Einsaetze mit diesem Status (ENT-128)',
  z.filter(r => !r.grp).length === 1 && z.some(r => r.t.includes(dmy(FRUEHER))));
check('Ein anderer Status zaehlt NICHT als abgeschlossen, auch wenn er in der Vergangenheit liegt',
  !z.some(r => r.t.includes(dmy(HEUTE)) || r.t.includes(dmy(SPAETER))));
await page.selectOption('#pStatus', '');
await page.selectOption('#pSchnell', 'monat');
await page.waitForTimeout(200);
const monatHeute = HEUTE.slice(0, 7);
check('„Dieser Monat“ setzt den ganzen Kalendermonat', (await page.inputValue('#pVon')).startsWith(monatHeute));
await page.fill('#pVon', HEUTE);
await page.fill('#pBis', '');
await page.waitForTimeout(200);
check('Ein offenes Ende zeigt die Schnellauswahl als „Zeitraum“ (kein Preset)',
  (await page.inputValue('#pSchnell')) === '');
await page.fill('#pQ', 'niedergösgen');
await page.waitForTimeout(200);
z = await zeilen();
check('Suche filtert auf den Kunden', z.filter(r => !r.grp).length === 1);
await page.fill('#pQ', 'Von Arb');
await page.waitForTimeout(200);
z = await zeilen();
check('Suche findet ueber zugeteilte Person', z.filter(r => !r.grp).length === 2);
await page.fill('#pQ', 'zzz');
await page.waitForTimeout(200);
check('Kein Treffer zeigt Leerzustand', await page.isVisible('#plTable .empty'));
await page.fill('#pQ', '');
await page.waitForTimeout(200);

// ══════════ SCHUBLADE
calls = [];
// Seit dem Umbau (3392470) fuehrt ein Klick auf eine Schicht zuerst in die
// Vollbild-Ansicht "Einsatz planen"; die Bearbeitungs-Schublade haengt dort
// hinter "Einsatz bearbeiten". Verloren geht dabei nichts -- der Weg ist
// einen Klick laenger. Geprueft wird darum der WEG, nicht der alte Ort.
await page.click('#plTable tbody tr:not(.grp) >> nth=1');   // Einsatz 12
await page.waitForTimeout(500);
check('Einsatz oeffnet die Einsatzplan-Ansicht',
  await page.evaluate(() => getComputedStyle(document.getElementById('view-einsatzplan')).display !== 'none'));
check('KRITISCH: die Bearbeitung ist von dort aus erreichbar',
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('#view-einsatzplan button')]
      .find(x => /epEinsatzOeffnen/.test(x.getAttribute('onclick') || ''));
    return !!b && b.offsetParent !== null;
  }));
await page.evaluate(() => epEinsatzOeffnen());
await page.waitForSelector('#drawer.on');
await page.waitForTimeout(300);
check('Einsatz oeffnet die Schublade', await page.isVisible('#drawer.on'));
check('Oeffnen schreibt nichts', writes().length === 0);
check('Kunde vorbefuellt', (await page.inputValue('#enEKunde_name')) === 'Einwohnergemeinde Niedergösgen');
check('Arbeitsort vorbefuellt', (await page.inputValue('#enEOrt')) === '5013 Niedergösgen');
check('Zeiten vorbefuellt', (await page.inputValue('#enEVon')) === '12:00' && (await page.inputValue('#enEBis')) === '18:00');
// Im Anlegen-Dialog waren die Zeitfelder gestaucht, bis von "07" nur noch
// "0" zu sehen war: `.zeitpaar .zp .inp` griff seit ENT-110 auf VIER
// Auswahlfelder statt auf zwei Zeitfelder und drückte jedes auf
// "flex:1; min-width:0".
//
// Der Dialog ist seit ENT-114 weg, und in den verbliebenen Stellen ist
// genug Platz -- der Fall lässt sich hier also nicht mehr an einer Breite
// zeigen. Geprüft wird darum die REGEL selbst: dass die Auswahlfelder ihre
// Mindestbreite behalten und nicht die des Zeitpaars erben. Eine Prüfung
// auf eine Breite, die ohnehin reicht, prüfte nichts.
try {
  const mb = await page.evaluate(() => {
    const h = document.getElementById('enEVon').__zw;
    if (!h) return null;
    return { select: getComputedStyle(h.std).minWidth,
             huelle: getComputedStyle(h.std.closest('.zeitwahl')).minWidth };
  });
  check('KRITISCH: die Auswahlfelder behalten eine eigene Mindestbreite',
    mb && parseFloat(mb.select) >= 40);
  check('Gestaucht wird die Hülle, nicht das einzelne Feld',
    mb && parseFloat(mb.huelle) >= 40);
} catch (e) { bad.push('Zeitbreite: ' + String(e).split('\n')[0].slice(0, 100)); }
check('Status vorbefuellt', (await page.inputValue('#enEStatus')) === 'bestaetigt');
check('Alle aktiven Mitarbeitenden zur Auswahl', (await page.$$('#enEMa label')).length === 3);
check('Zugeteilte Person angehakt', await page.isChecked('#enEMa input[value="1"]'));
check('Nicht zugeteilte Person nicht angehakt', !(await page.isChecked('#enEMa input[value="2"]')));
const clash = await page.$$eval('#enEMa .clash', els => els.map(e => e.textContent));
check('Zeitliche Ueberschneidung wird gemeldet', clash.length === 1 && clash[0].includes('Baustelle Kreisel'));
check('Ueberschneidung nennt die Zeit', clash[0].includes('07:00–16:00'));
// Adrian ist hier bereits zugeteilt -> bedienbar, damit man ihn entfernen kann
check('Bereits Zugeteilter bleibt bedienbar', !(await page.isDisabled('#enEMa input[value="1"]')));
check('Warnung fuer Zugeteilte in Gelb', await page.$eval('#enEMa .clash',
  el => getComputedStyle(el).color === 'rgb(154, 107, 8)'));
check('Hinweis grenzt sich von der GAV-Pruefung ab', (await page.textContent('#drawer .zone')).includes('nicht'));
check('Besetzungsstand unter der Auswahl', (await page.textContent('#enEMaFoot')).includes('1/1'));
await page.screenshot({ path: `${OUT}/23-planung-schublade.png` });

// ── Sperre gegen Doppelbelegung
// Daniele ist am selben Tag 08:00-12:00 bei einem vergangenen Einsatz -- kein
// Konflikt. Wir pruefen mit Adrian: er ist 07:00-16:00 eingeteilt (Einsatz 11).
// Ein neuer Einsatz zur selben Zeit darf ihn nicht mehr anbieten.
await zeitSetzen(page, '#enEVon', '08:00');
await zeitSetzen(page, '#enEBis', '14:00');
await page.dispatchEvent('#enEBis', 'change');
await page.waitForTimeout(250);
check('Zugeteilter mit Konflikt bleibt bedienbar', !(await page.isDisabled('#enEMa input[value="1"]')));
await page.uncheck('#enEMa input[value="1"]');
await page.dispatchEvent('#enEBis', 'change');   // Liste neu berechnen
await page.waitForTimeout(250);

// Seit ENT-060 ist ein Konflikt keine Sperre mehr, sondern der Anfang einer
// Umplanung. Frueher wurde hier geprueft, dass das Haekchen tot ist -- jetzt
// gilt: es bleibt bedienbar, es wird gefragt, und die Person verlaesst die
// andere Schicht. Doppelt eingeteilt ist danach trotzdem niemand.
check('KRITISCH: der Konflikt sperrt nicht mehr, er laesst sich umplanen',
  !(await page.isDisabled('#enEMa input[value="1"]')));
check('Die Zeile ist als umzuplanen gekennzeichnet',
  await page.evaluate(() => !!document.querySelector('#enEMa label.umzuplanen')));
check('Sie nennt die andere Schicht', (await page.textContent('#enEMa .clash')).includes('Baustelle Kreisel'));
check('Sie sagt "bereits eingeteilt", nicht "nicht verfügbar"',
  (await page.textContent('#enEMa .clash')).includes('Bereits eingeteilt'));
check('Freie Person bleibt waehlbar', !(await page.isDisabled('#enEMa input[value="3"]')));
check('KRITISCH: eine freie Person ist als verfuegbar markiert',
  await page.evaluate(() => {
    const el = document.querySelector('#enEMa input[value="3"]');
    return el.closest('label').classList.contains('frei')
      && /verfügbar/.test(el.closest('label').textContent);
  }));

// Die Rueckfrage: Sie muss sagen, was passiert -- nicht nur "wirklich?".
let gefragt = null;
page.once('dialog', d => { gefragt = d.message(); d.dismiss(); });
// Bewusst click statt check: check() besteht darauf, dass das Haekchen danach
// gesetzt ist -- beim Nein ist es das gerade nicht, und genau das wird geprueft.
await page.click('#enEMa input[value="1"]');
await page.waitForTimeout(300);
check('KRITISCH: beim Konflikt wird gefragt', typeof gefragt === 'string' && gefragt.length > 0);
check('Die Frage nennt die andere Schicht', gefragt && /Baustelle Kreisel/.test(gefragt));
check('KRITISCH: die Frage sagt, dass die Person dort entfernt wird',
  gefragt && /entfernt/.test(gefragt));
check('Sie benennt auch die Folge fuer die andere Schicht',
  gefragt && /unterbesetzt/.test(gefragt));
check('KRITISCH: ein Nein setzt das Haekchen wieder zurueck',
  !(await page.isChecked('#enEMa input[value="1"]')));

// Ja: das Haekchen bleibt, und der Name geht als umzuplanen mit.
page.once('dialog', d => d.accept());
await page.click('#enEMa input[value="1"]');
await page.waitForTimeout(300);
check('Ein Ja setzt das Haekchen', await page.isChecked('#enEMa input[value="1"]'));
check('KRITISCH: der Name steht auf der Umplanungsliste',
  await page.evaluate(() => pickUmplanenListe('enE').includes(1)));
check('KRITISCH: eine Person ohne Konflikt landet NICHT auf der Umplanungsliste',
  await page.evaluate(() => !pickUmplanenListe('enE').includes(3)));
// Zustand zuruecksetzen, damit die folgenden Pruefungen unveraendert laufen.
await page.click('#enEMa input[value="1"]');
await page.waitForTimeout(150);
// Zeitfenster aus der Ueberschneidung heraus -> Person wieder waehlbar
await zeitSetzen(page, '#enEVon', '17:00');
await zeitSetzen(page, '#enEBis', '20:00');
await page.dispatchEvent('#enEBis', 'change');
await page.waitForTimeout(250);
check('Ohne Ueberschneidung kein Hinweis mehr', (await page.$$('#enEMa .clash')).length === 0);
check('Ohne Ueberschneidung wieder waehlbar', !(await page.isDisabled('#enEMa input[value="1"]')));
check('Fusszeile ohne Sperrmeldung', !(await page.textContent('#enEMaFoot')).includes('zeitlich belegt'));
await page.check('#enEMa input[value="1"]');
await page.dispatchEvent('#enEBis', 'change');
await page.waitForTimeout(250);
check('Auswahl bleibt nach Neuberechnung erhalten', await page.isChecked('#enEMa input[value="1"]'));

// Zuteilung erweitern
await page.check('#enEMa input[value="3"]');
await page.fill('#enEBedarf', '2');
await page.dispatchEvent('#enEBedarf', 'input');
await page.waitForTimeout(200);
check('Besetzungsstand aktualisiert sich', (await page.textContent('#enEMaFoot')).includes('2/2'));
check('Bedarf gedeckt wird gemeldet', (await page.textContent('#enEMaFoot')).includes('gedeckt'));

// Pflichtfeld leeren -> kein Speichern
calls = [];
await page.fill('#enEOrt', '');
await page.click('#drFoot .btn-primary');
await page.waitForTimeout(250);
check('Ohne Arbeitsort wird nicht gespeichert', writes().length === 0);
await page.fill('#enEOrt', '5013 Niedergösgen');
await page.click('#drFoot .btn-primary');
await page.waitForTimeout(400);
const sv = calls.find(c => c.path.includes('einsatz_save'));
check('Speichern ruft einsatz_save', !!sv);
check('Speichern sendet die id', sv && sv.body.id === 12);
check('Speichern sendet die Zuteilung', sv && JSON.stringify(sv.body.mitarbeiter.sort()) === JSON.stringify([1, 3]));
check('Speichern sendet die neue Zeit', sv && sv.body.von === '17:00' && sv.body.bis === '20:00');
check('Kunde wird mit der Kundendatei verknuepft', sv && sv.body.kunde_id === 2);
check('Schublade schliesst nach Speichern', !(await page.isVisible('#drawer.on')));

// ══════════ LOESCHEN
// Nach dem Speichern steht die Einsatzplan-Ansicht offen -- zurueck in die
// Liste, sonst gibt es dort keine Zeile zum Anklicken.
calls = [];
await page.evaluate(() => { go('planung'); goTab('einsaetze'); });
await page.waitForTimeout(500);
await page.click('#plTable tbody tr:not(.grp) >> nth=0');
await page.waitForTimeout(400);
await page.evaluate(() => epEinsatzOeffnen());
await page.waitForSelector('#drawer.on');
await page.click('#drawer .zone.danger .btn-danger');
await page.waitForSelector('#dlgConfirm.on');
check('Loeschen fragt zuerst nach', await page.isVisible('#dlgConfirm.on'));
check('Rueckfrage schreibt noch nichts', writes().length === 0);
await page.click('#dlgConfirm .btn-plain');
await page.waitForTimeout(200);
check('Abbrechen schreibt nichts', writes().length === 0);
await page.click('#drawer .zone.danger .btn-danger');
await page.waitForSelector('#dlgConfirm.on');
await page.click('#cfBtn');
await page.waitForTimeout(400);
const del = calls.find(c => c.path.includes('einsatz_delete'));
check('Bestaetigen loescht den richtigen Einsatz', del && del.body.id === 11);

// ══════════ NEU ANLEGEN VON HAND
// Das Loeschen liess die Einsatzplan-Ansicht offen -- zurueck in die Liste.
calls = [];
await page.evaluate(() => { go('planung'); goTab('einsaetze'); });
await page.waitForTimeout(400);
await page.click('#view-planung button:has-text("Neuer Einsatz")');
await page.waitForSelector('#view-einsatzneu.on');
check('Die Anlegen-Ansicht steht offen', await page.isVisible('#view-einsatzneu.on'));
check('Titel ohne Diktat', (await page.textContent('#enNeuTitel')) === 'Neuer Einsatz');
check('Diktat-Hinweis ausgeblendet', !(await page.isVisible('#enNeuKiHint')));
check('Datum auf heute vorbelegt', (await page.inputValue('#enNDatum')) === HEUTE);
check('Einsatzart vorbelegt', (await page.inputValue('#enNEinsatzart')) === 'Verkehrsdienst');
check('Keine blauen Markierungen von Hand', (await page.$$('#view-einsatzneu .inp.ki')).length === 0);
check('Kundenvorschlaege verfuegbar', (await page.$$('#dlKunden option')).length === 2);
await page.click('#enNeuBtn');
await page.waitForTimeout(250);
check('Ohne Pflichtfelder kein Anlegen', writes().length === 0 && await page.isVisible('#enNeuErr'));
await page.fill('#enNKunde_name', 'Neuer Kunde ohne Datei');
await page.fill('#enNOrt', '4600 Olten');
await zeitSetzen(page, '#enNVon', '08:00');
await zeitSetzen(page, '#enNBis', '12:00');
// Strasse und Kanton sind seit ENT-115 Pflicht -- ohne sie kommt die
// Ergaenzungsmeldung statt eines Schreibaufrufs.
const vorPflicht = writes().length;
await page.click('#enNeuBtn');
await page.waitForTimeout(300);
check('KRITISCH: ohne Strasse und Kanton wird nicht gespeichert', writes().length === vorPflicht);
check('Die Meldung nennt beide fehlenden Angaben',
  /Strasse und Nummer/.test(await page.textContent('#enNeuErr'))
  && /Kanton/.test(await page.textContent('#enNeuErr')));
await page.fill('#enNStrasse', 'Bahnhofstrasse 1');
await page.selectOption('#enNKanton', 'SO');
await page.fill('#enNKontakt_vorname', 'Petra');
await page.fill('#enNKontakt_nachname', 'Muster');
await page.fill('#enNKontakt_telefon', '079 111 22 33');
await page.fill('#enNTreffpunkt', 'Haupteingang');
await page.click('#enNeuBtn');
await page.waitForTimeout(400);
const cr = calls.find(c => c.path.includes('einsatz_save'));
check('KRITISCH: der Kanton geht mit an den Server', cr && cr.body.kanton === 'SO');
check('KRITISCH: die Kontaktperson geht getrennt mit',
  cr && cr.body.kontakt_vorname === 'Petra' && cr.body.kontakt_nachname === 'Muster');
// Seit ENT-118 international. Eingetippt wurde '079 111 22 33'; gespeichert
// wird '+41 79 111 22 33', damit der tel:-Link in der App auch aus dem
// Ausland waehlt. Die eigenen Grenzfaelle stehen in test_zeitraum.mjs.
check('KRITISCH: die Telefonnummer geht mit Landesvorwahl an den Server',
  cr && cr.body.kontakt_telefon === '+41 79 111 22 33');
check('Der Treffpunkt geht mit', cr && cr.body.treffpunkt === 'Haupteingang');

// ══════════ WEG, ZONE UND FAHRZEIT (ENT-116)
// Die Kilometer werden NICHT automatisch geholt: Der GAV verlangt die
// kuerzeste Route, Google liefert die schnellste -- GAV-AUS-011 ist offen
// und laesst keine automatische Zonenzuordnung zu.
await page.evaluate(() => openEinsatzNeu());
await page.waitForTimeout(400);
check('KRITISCH: es geht keine Abfrage an Google',
  !calls.some(c => /maps|distance|directions/i.test(c.path)));
check('Der Messhinweis nennt die kürzeste Strecke — nicht die schnellste',
  /kürzeste/i.test(await page.textContent('#enNWegHinweis'))
  && /nicht die schnellste/i.test(await page.textContent('#enNWegHinweis')));
check('KRITISCH: ohne Wegstrecke steht „nicht bestimmbar", nicht „keine Entschädigung"',
  (await page.textContent('#enNZone')).includes('nicht bestimmen'));
check('Kein Fahrzeit-Häkchen mehr (ENT-122)',
  await page.evaluate(() => !document.getElementById('enNFzWahl') && !document.getElementById('enNFahrzeit')));

// Anstellungsgebiet: unter 10 km, keine Entschädigung.
await page.fill('#enNWeg_km', '8');
await page.waitForTimeout(250);
check('8 km ergeben das Anstellungsgebiet',
  (await page.textContent('#enNZone')).includes('Anstellungsgebiet'));
check('KRITISCH: dort wird kein Auslagenersatz gemeldet',
  !(await page.textContent('#enNZone')).includes('geschuldet'));
check('Auch im Anstellungsgebiet kein Fahrzeit-Häkchen',
  await page.evaluate(() => !document.getElementById('enNFzWahl')));

// Pauschalzone 1: über 10 km, Entschädigung geschuldet.
await page.fill('#enNWeg_km', '15');
await page.waitForTimeout(250);
const zoneTxt = await page.textContent('#enNZone');
check('KRITISCH: 15 km ergeben Pauschalzone 1 mit Auslagenersatz',
  zoneTxt.includes('Pauschalzone 1') && zoneTxt.includes('geschuldet'));
check('Die Fundstelle wird genannt', zoneTxt.includes('Art. 18'));
check('KRITISCH: der Hinweis nennt die offene Auslegung', zoneTxt.includes('GAV-AUS-011'));
// ENT-122: Auch wenn Auslagenersatz geschuldet ist, entstehen keine
// Fahrzeit-Zeilen mehr. Der Anspruch folgt aus der Zone (Art. 18 Ziff. 3),
// nicht aus zwei Zeilen im Raster.
check('KRITISCH: auch bei geschuldetem Auslagenersatz kein Fahrzeit-Häkchen',
  await page.evaluate(() => !document.getElementById('enNFzWahl')));

// Reinigung: der GAV Sicherheit gilt nicht (ENT-061).
await page.selectOption('#enNSparte', 'reinigung');
await page.waitForTimeout(250);
check('KRITISCH: für Reinigung gilt Art. 18 nicht',
  (await page.textContent('#enNZone')).includes('Reinigung'));
check('Bei Reinigung erst recht keine Fahrzeit-Zeilen',
  await page.evaluate(() => !document.getElementById('enNFzWahl')));
await page.selectOption('#enNSparte', 'sicherheit');
await page.waitForTimeout(250);

// Der Maps-Link öffnet die Route ab HAO -- ohne dass wir selbst abfragen.
await page.fill('#enNStrasse', 'Kantonsstrasse 2');
await page.fill('#enNOrt', '6000 Luzern');
await page.selectOption('#enNKanton', 'LU');
const linkZiel = await page.evaluate(() => {
  let auf = null;
  const alt = window.open;
  window.open = (u) => { auf = u; return null; };
  enWegLinkKlick();
  window.open = alt;
  return auf;
});
check('KRITISCH: der Link führt von der HAO-Adresse zum Arbeitsort',
  linkZiel && linkZiel.includes('Bahnhofstrasse') && linkZiel.includes('Kantonsstrasse'));
check('Er öffnet die Routenliste, nicht eine einzelne Route',
  linkZiel && linkZiel.includes('/maps/dir/?api=1'));

// Anlegen mit eingetragener Fahrzeit: es entstehen KEINE Positionen (ENT-122).
await page.fill('#enNKunde_name', 'Studer Immobilien AG');
await zeitSetzen(page, '#enNVon', '08:00');
await zeitSetzen(page, '#enNBis', '12:00');
await page.fill('#enNWeg_minuten', '30');
await page.waitForTimeout(200);
calls = [];
await page.click('#enNeuBtn');
await page.waitForTimeout(900);
const gespeichert = calls.find(c => c.path.includes('einsatz_save'));
check('KRITISCH: die Wegstrecke geht mit an den Server', gespeichert && Number(gespeichert.body.weg_km) === 15);
check('KRITISCH: die Adresse zur Wegstrecke wird mitgeschrieben',
  gespeichert && (gespeichert.body.weg_adresse || '').includes('Kantonsstrasse 2'));
// ENT-122: Die Minuten werden weiterhin gespeichert -- sie sind die
// Grundlage des Fahrzeitersatzes -- aber es entstehen keine Positionen mehr.
check('KRITISCH: die Fahrzeit-Minuten gehen weiterhin an den Server',
  gespeichert && Number(gespeichert.body.weg_minuten) === 30);
const fz = calls.filter(c => c.path.includes('einsatz_position') && c.body && c.body.ist_fahrzeit);
check('KRITISCH: es entstehen keine Fahrzeit-Positionen mehr', fz.length === 0);
check('KRITISCH: ueberhaupt keine Position wird beim Anlegen erzeugt',
  calls.filter(c => c.path.includes('einsatz_position') && c.body
    && c.body.aktion === 'speichern').length === 0);
// Die Behandlung BESTEHENDER Fahrzeit-Positionen bleibt unangetastet und
// wird in test_einsatzplan.mjs geprueft: Sie stehen im Raster, tragen die
// Marke "keine Arbeitszeit" und zaehlen nicht in die Stundensummen
// (Sperrwirkung GAV-AUS-009). Wuerde das wegfallen, liefen die in der
// Datenbank liegenden Zeilen ab sofort als Arbeitszeit mit.
check('KRITISCH: die Ausnahme bestehender Fahrzeit-Positionen ist nicht entfernt worden',
  /if \(p\.ist_fahrzeit\) return;/.test(dash));

// ══════════ GESTALTUNG DER ANLEGEN-ANSICHT (ENT-115)
// Gemessen, nicht im Quelltext nachgelesen.
try {
  await page.evaluate(() => openEinsatzNeu());
  await page.waitForTimeout(350);
  const m = await page.evaluate(() => {
    const ab = [...document.querySelectorAll('#view-einsatzneu .abschnitt h3')].map(h => h.textContent.trim());
    const raster = document.querySelector('#view-einsatzneu .form-breit');
    const spalten = getComputedStyle(raster).gridTemplateColumns.split(' ').length;
    const rasterBreite = Math.round(raster.getBoundingClientRect().width);
    const karte = document.querySelector('#view-einsatzneu .card').getBoundingClientRect();
    return { ab, spalten, raster: rasterBreite, breite: Math.round(karte.width),
             fenster: window.innerWidth };
  });
  check('KRITISCH: die Abschnitte stehen in der Reihenfolge der Vorlage',
    m.ab[0].startsWith('Stammdaten') && m.ab[1].startsWith('Zeit und Arbeitsort')
    && m.ab[2].startsWith('Weg und Auslagenersatz') && m.ab[3].startsWith('Kontaktperson')
    && m.ab[4].startsWith('Zuteilung') && m.ab[5].startsWith('Angaben für die Eingeteilten'));
  check('KRITISCH: die Angaben für die Eingeteilten stehen zuunterst', m.ab.length === 6);
  // ENT-115 wollte: Die Spalten wachsen mit dem Fenster, statt bei zwei zu
  // bleiben und die halbe Flaeche leer zu lassen. Die Zahl "mehr als zwei bei
  // 1440 px" war dafuer nur ein Stellvertreter -- und er stimmt seit ENT-117
  // (Beschriftung links statt oben) nicht mehr: Von einer Spalte geht jetzt
  // erst die Beschriftung ab. Vier Spalten bei 1440 px hiessen 58 px
  // Eingabefeld, gemessen. Geprueft wird darum, was ENT-115 wirklich meinte:
  // Der Platz wird genutzt (das Raster fuellt die Karte) UND die Spalten
  // wachsen mit dem Fenster (unten bei 1920 px). Dass die Felder dabei
  // benutzbar breit bleiben, prueft test_zeitraum.mjs.
  check('KRITISCH: das Raster fuellt die Kartenbreite — kein Rand statt Inhalt',
    m.breite - m.raster < 45);
  check('Die Karte nutzt die Breite der Ansicht', m.breite > m.fenster * 0.7);
} catch (e) { bad.push('Gestaltung Anlegen: ' + String(e).split('\n')[0].slice(0, 110)); }

// Beim zweiten Öffnen darf nichts vom vorigen Einsatz stehenbleiben.
check('KRITISCH: die neuen Felder sind beim Öffnen leer',
  (await page.inputValue('#enNKanton')) === '' && (await page.inputValue('#enNKontakt_vorname')) === ''
  && (await page.inputValue('#enNTreffpunkt')) === '');
await page.evaluate(() => enNeuAbbrechen());
await page.waitForTimeout(250);
check('Anlegen ruft einsatz_save', !!cr);
check('Anlegen sendet keine id', cr && !('id' in cr.body));
check('Unbekannter Kunde bleibt reiner Text', cr && !('kunde_id' in cr.body) && cr.body.kunde_name === 'Neuer Kunde ohne Datei');
check('Standardstatus geplant', cr && cr.body.status === 'geplant');
check('Die Ansicht schliesst nach dem Anlegen', !(await page.isVisible('#view-einsatzneu.on')));

// ══════════ DIKTAT
// Seit ENT-042 gibt es keinen eigenen Diktat-Knopf in der Planung mehr --
// der globale Sprechen-Knopf deckt auch den Einsatz-Bereich ab (Router).
// Seit ENT-107 ist der globale Knopf auf dem Einsaetze-Reiter selbst
// ausgeblendet (dort steht die eingebettete Zeile) -- fuer diese Pruefung
// darum auf einen anderen Planungs-Reiter wechseln, auf dem er weiterhin da ist.
calls = [];
await page.evaluate(() => goTab('objektplan'));
await page.waitForTimeout(300);
await page.click('#btnSprechen');
await page.waitForSelector('#dlgSprechen.on');
await page.click('#gsBtn');
await page.waitForTimeout(200);
check('Leeres Diktat wird abgewiesen', !calls.some(c => c.path.includes('ki_router_parse')));
await page.fill('#gsText', 'Neuer Einsatz für die Studer Immobilien AG morgen von 7 bis 17 Uhr');
await page.click('#gsBtn');
await page.waitForSelector('#view-einsatzneu.on');
await page.waitForTimeout(300);
const parse = calls.find(c => c.path.includes('ki_router_parse'));
check('Diktat ruft den Router-Endpunkt', !!parse);
check('Diktat sendet das heutige Datum mit', parse && parse.body.heute === HEUTE);
check('KRITISCH: Diktat speichert nichts', writes().length === 0);
check('Titel weist auf Pruefung hin', (await page.textContent('#enNeuTitel')).includes('prüfen'));
check('Hinweis sichtbar', await page.isVisible('#enNeuKiHint'));
check('Kunde uebernommen', (await page.inputValue('#enNKunde_name')) === 'Studer Immobilien AG');
check('Bezeichnung uebernommen', (await page.inputValue('#enNTitel')) === 'Fasnachtsumzug');
check('Arbeitsort uebernommen', (await page.inputValue('#enNOrt')) === '4632 Trimbach');
check('Datum uebernommen', (await page.inputValue('#enNDatum')) === MORGEN);
check('Zeiten uebernommen', (await page.inputValue('#enNVon')) === '07:00' && (await page.inputValue('#enNBis')) === '17:00');
check('Bedarf uebernommen', (await page.inputValue('#enNBedarf')) === '2');
// Seit ENT-060 ist die Bezeichnung ein verstecktes Feld -- ein Feld weniger,
// das sich blau markieren laesst.
check('Uebernommene Felder blau markiert', (await page.$$('#view-einsatzneu .inp.ki')).length === 7);
check('Nicht genanntes Feld unmarkiert', !(await page.getAttribute('#enNBemerkung', 'class')).includes('ki'));
check('Genannte Personen vorgehakt', await page.isChecked('#enNMa input[value="3"]') && await page.isChecked('#enNMa input[value="2"]'));
check('Nicht genannte Person nicht vorgehakt', !(await page.isChecked('#enNMa input[value="1"]')));
const hint = await page.textContent('#enNeuKiText');
check('Hinweis nennt Beschriftungen statt Feldnamen', hint.includes('Kunde, Bezeichnung'));
check('Hinweis nennt die vorgeschlagene Zuteilung', hint.includes('Daniele Ciardo') && hint.includes('Hans Meier'));
check('Erfundener Name taucht nicht auf', !hint.includes('gibtsnicht'));
check('Besetzung im Diktat berechnet', (await page.textContent('#enNMaFoot')).includes('2/2'));
await page.screenshot({ path: `${OUT}/21-planung-diktat.png` });

// Seit ENT-115 sind Strasse und Kanton Pflicht. Der Router liefert die
// Strasse manchmal, den Kanton nie -- also bleibt beides am Planer haengen.
// Das ist gewollt und wird hier ausdruecklich festgehalten: Ein Diktat
// allein reicht nicht mehr zum Speichern.
const vorFehlend = writes().length;
await page.click('#enNeuBtn');
await page.waitForTimeout(300);
check('KRITISCH: ohne Kanton wird auch aus dem Diktat nichts gespeichert', writes().length === vorFehlend);
check('Und die Meldung sagt, was fehlt',
  (await page.textContent('#enNeuErr')).includes('Kanton'));
await page.selectOption('#enNKanton', 'SO');
await page.waitForTimeout(150);

await page.click('#enNeuBtn');
await page.waitForTimeout(400);
const dcr = calls.find(c => c.path.includes('einsatz_save'));
check('Erst nach Klick wird angelegt', !!dcr);
check('Genau ein Schreibaufruf beim Diktat', writes().length === 1);
check('Diktierte Werte landen im Aufruf', dcr && dcr.body.titel === 'Fasnachtsumzug' && dcr.body.von === '07:00');
check('Zuteilung landet im Aufruf', dcr && JSON.stringify(dcr.body.mitarbeiter.sort()) === JSON.stringify([2, 3]));
check('Bekannter Kunde wird verknuepft', dcr && dcr.body.kunde_id === 1);

// Handeingabe danach wieder sauber -- der Knopf dafuer steht nur auf dem
// Einsaetze-Reiter, zurueck wechseln.
await page.evaluate(() => { go('planung'); goTab('einsaetze'); });
await page.waitForTimeout(300);
await page.click('#view-planung button:has-text("Neuer Einsatz")');
await page.waitForSelector('#view-einsatzneu.on');
await page.waitForTimeout(200);
check('Handeingabe ohne Diktat-Hinweis', !(await page.isVisible('#enNeuKiHint')));
check('Handeingabe ohne blaue Markierungen', (await page.$$('#view-einsatzneu .inp.ki')).length === 0);
check('Handeingabe ohne Vorauswahl beim Personal', (await page.$$('#enNMa input:checked')).length === 0);
check('Bezeichnung wieder leer', (await page.inputValue('#enNTitel')) === '');
// Seit ENT-114 ist das Anlegen eine Ansicht, kein Dialog: Escape schliesst
// sie nicht -- der Weg zurück führt über den Knopf.
await page.evaluate(() => enNeuAbbrechen());
await page.waitForTimeout(300);
check('KRITISCH: „Zurück" führt in die Planung, aus der man kam',
  await page.isVisible('#view-planung.on'));

// ══════════ DAS ANLEGEN IST EINE EIGENE ANSICHT (ENT-114)
// Eingefasst: Führt der Weg nicht dorthin, soll das als benannte Prüfung rot
// werden und nicht die ganze Suite mitreissen.
try {
await page.click('#view-planung button:has-text("Neuer Einsatz")', { timeout: 5000 });
await page.waitForSelector('#view-einsatzneu.on', { timeout: 5000 });
await page.waitForTimeout(300);
check('KRITISCH: es ist kein Dialog mehr',
  await page.evaluate(() => !document.getElementById('dlgEnNeu')));
check('Die Ansicht trägt einen eigenen Seitentitel',
  (await page.textContent('#pgTitle')).trim() === 'Neuer Einsatz');
check('Kein verdunkelter Hintergrund mehr',
  await page.evaluate(() => !document.querySelector('.dlg-scrim.on')));
// Die Feldkennungen sind unverändert -- daran hängt die gesamte bestehende
// Logik (enSammeln, pickRender, artSparteKoppeln, der Diktat-Weg).
check('KRITISCH: alle Felder tragen unverändert ihre Kennung',
  await page.evaluate(() => ['enNKunde_name', 'enNEinsatzart', 'enNDatum', 'enNVon', 'enNBis',
    'enNStrasse', 'enNOrt', 'enNSparte', 'enNBedarf', 'enNStatus', 'enNMa', 'enNBemerkung',
    'enNTitel', 'enNeuBtn', 'enNeuErr', 'enNeuKiHint'].every(i => !!document.getElementById(i))));
// Die Zeitbreite wird NICHT hier gemessen: In dieser Ansicht ist ohnehin
// Platz, eine Zahl von hier prüft nichts. Der enge Fall ist die
// Bearbeiten-Schublade -- dort stehen vier Auswahlfelder in einer schmalen
// Spalte. Geprüft wird er weiter unten, wo die Schublade offen steht.
check('Die Personenliste hat in der Breite Platz',
  await page.evaluate(() => document.getElementById('enNMa').getBoundingClientRect().width > 500));
await page.evaluate(() => enNeuAbbrechen());
await page.waitForTimeout(250);
} catch (e) { bad.push('Anlegen-Ansicht: ' + String(e).split('\n')[0].slice(0, 110)); }

// ══════════ MOBIL
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
const scrollX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check('Kein Seiten-Scroll auf 390px', scrollX <= 1);
await page.screenshot({ path: `${OUT}/22-planung-mobil.png` });
await page.setViewportSize({ width: 1440, height: 1000 });

// ══════════ ABGEGLICHENE SCHICHT IST IN DER PLANUNG FESTGESCHRIEBEN (ENT-045, OP-42)
// Die Sperre gilt serverseitig; hier wird geprueft, dass man sie SIEHT, bevor
// man Arbeit in ein Formular steckt, das nicht speichern wird.
calls = [];
await page.evaluate(() => {
  const e = einsaetze.find(x => Number(x.id) === 14);
  e.ist_status = 'offen';
  e.mitarbeiter[0].ist_status = 'anwesend';
  e.mitarbeiter[0].ist_von = '08:00:00';
  e.mitarbeiter[0].ist_bis = '12:30:00';
  goTab('einsaetze');
});
await page.selectOption('#pSchnell', 'alle');   // die abgeglichene Schicht liegt in der Vergangenheit
await page.waitForTimeout(300);
check('Festgeschriebene Schicht wird in der Liste als gesperrt markiert',
  await page.evaluate(() => {
    const tr = [...document.querySelectorAll('#plTable tbody tr')]
      .find(r => r.getAttribute('onclick') === 'openEinsatz(14)');
    return !!tr && tr.classList.contains('zu') && !!tr.querySelector('.i-schloss');
  }));
check('Offene Schichten tragen kein Schloss',
  await page.evaluate(() => {
    const tr = [...document.querySelectorAll('#plTable tbody tr')]
      .find(r => r.getAttribute('onclick') === 'openEinsatz(11)');
    return !!tr && !tr.classList.contains('zu') && !tr.querySelector('.i-schloss');
  }));
check('KRITISCH: eine Zuteilung mit Ist-Stand sperrt die ganze Schicht',
  await page.evaluate(() => enGesperrt(einsaetze.find(x => Number(x.id) === 14))));

// ══════════ STATUS-CHIP "ABGEGLICHEN" STATT ROHSTATUS, SCHLOSS IM CHIP (ENT-136)
// Der Projektinhaber, per Screenshot der Planung: dieselbe abgeglichene
// Schicht wie oben zeigte im STATUS-Feld weiterhin "Geplant" -- das Schloss
// stand nur separat vor der Zeit, sagte aber nichts ueber den Status selbst.
// Ausserdem: "Das Schloss Symbol daneben, nicht am Anfang" -- es gehoert in
// den Chip, hinter das Wort, nicht mehr vor die Uhrzeit.
check('KRITISCH: der Status-Chip zeigt "Abgeglichen" statt des Rohstatus',
  await page.evaluate(() => {
    const tr = [...document.querySelectorAll('#plTable tbody tr')]
      .find(r => r.getAttribute('onclick') === 'openEinsatz(14)');
    const chip = tr && tr.querySelector('td:last-child .chip');
    return !!chip && chip.textContent.includes('Abgeglichen') && chip.classList.contains('chip-p');
  }));
check('KRITISCH: das Schloss steht im Status-Chip, hinter dem Wort',
  await page.evaluate(() => {
    const tr = [...document.querySelectorAll('#plTable tbody tr')]
      .find(r => r.getAttribute('onclick') === 'openEinsatz(14)');
    const chip = tr && tr.querySelector('td:last-child .chip');
    return !!chip && !!chip.querySelector('.i-schloss');
  }));
check('Das Schloss steht NICHT mehr am Anfang des Zeitfelds',
  await page.evaluate(() => {
    const tr = [...document.querySelectorAll('#plTable tbody tr')]
      .find(r => r.getAttribute('onclick') === 'openEinsatz(14)');
    const zeit = tr && tr.querySelector('td:first-child');
    return !!zeit && !zeit.querySelector('.i-schloss');
  }));
check('Eine offene Schicht zeigt weiterhin ihren echten Status, nicht "Abgeglichen"',
  await page.evaluate(() => {
    const tr = [...document.querySelectorAll('#plTable tbody tr')]
      .find(r => r.getAttribute('onclick') === 'openEinsatz(11)');
    const chip = tr && tr.querySelector('td:last-child .chip');
    return !!chip && !chip.textContent.includes('Abgeglichen');
  }));
// Diese Fixtur traegt zugleich status:'abgeschlossen' UND ist jetzt
// abgeglichen -- genau der Fall, in dem beides zusammentrifft. Abgeglichen
// muss dabei sichtbar gewinnen: nicht verblassen, sondern staerker auffallen
// (Wunsch des Projektinhabers), und nicht die Warnfarbe von "gesperrt"
// anderswo (Sperrtage) tragen, sondern dieselbe gruene Aussage wie das
// Haekchen in der App (ENT-133). Am gerenderten Zustand gemessen (CLAUDE.md).
check('KRITISCH: eine zugleich abgeschlossene UND abgeglichene Zeile verblasst NICHT',
  await page.evaluate(() => {
    const tr = [...document.querySelectorAll('#plTable tbody tr')]
      .find(r => r.getAttribute('onclick') === 'openEinsatz(14)');
    const td = tr && tr.querySelector('td');
    return !!tr && tr.classList.contains('status-abgeschlossen') && tr.classList.contains('abgeglichen')
      && !!td && parseFloat(getComputedStyle(td).opacity) === 1;
  }));
check('KRITISCH: das Schloss im Chip ist gruen eingefaerbt wie der Chip selbst, nicht die Warnfarbe der Zeile',
  await page.evaluate(() => {
    const tr = [...document.querySelectorAll('#plTable tbody tr')]
      .find(r => r.getAttribute('onclick') === 'openEinsatz(14)');
    const chip = tr && tr.querySelector('td:last-child .chip');
    const icon = chip && chip.querySelector('.i-schloss');
    if (!chip || !icon) return false;
    return getComputedStyle(icon).color === getComputedStyle(chip).color;
  }));
// Nicht nur "irgendein Rahmenakzent", sondern nachweislich GRUEN (--pos) --
// tr.zu allein traegt anderswo bereits einen Rahmenakzent in der Warnfarbe
// (--warn, "gesperrt"); ein Vergleich gegen eine gewoehnliche Zeile allein
// haette diesen Fall nicht von der Warnfarbe unterschieden. Die Sonde
// rendert denselben CSS-Ausdruck einmal isoliert und vergleicht das Ergebnis
// wortgleich -- die einzig verlaessliche Art, eine CSS-Custom-Property am
// gerenderten Zustand zu pruefen, statt Text- oder Hex-Werte zu vergleichen.
check('KRITISCH: der Rahmenakzent der abgeglichenen Zeile ist gruen (--pos), nicht die Warnfarbe von "gesperrt" anderswo',
  await page.evaluate(() => {
    const tr = [...document.querySelectorAll('#plTable tbody tr')].find(r => r.getAttribute('onclick') === 'openEinsatz(14)');
    const td = tr && tr.querySelector('td:first-child');
    if (!td) return false;
    const sonde = document.createElement('div');
    sonde.style.boxShadow = 'inset 2px 0 0 var(--pos)';
    document.body.appendChild(sonde);
    const erwartet = getComputedStyle(sonde).boxShadow;
    sonde.remove();
    return getComputedStyle(td).boxShadow === erwartet;
  }));

// ══════════ ABWEICHUNGSWARNUNG IN DER LISTE (ENT-138)
// Der Projektinhaber wollte die Abweichung nicht erst beim Hineinklicken
// sehen, sondern schon in der Liste -- eigene Kennzeichnung neben dem
// Status-Chip, unabhaengig davon, ob die Zeile ausserdem gesperrt/abgeglichen
// ist (beides sind unabhaengige Aussagen).
check('KRITISCH: eine Schicht mit vom Plan abweichendem Rapport traegt das Warnzeichen in der Liste',
  await page.evaluate(() => {
    const tr = [...document.querySelectorAll('#plTable tbody tr')].find(r => r.getAttribute('onclick') === 'openEinsatz(14)');
    return !!tr && !!tr.querySelector('.rap-abw');
  }));
check('Eine Schicht mit deckungsgleichem Rapport traegt KEIN Warnzeichen',
  await page.evaluate(() => {
    const tr = [...document.querySelectorAll('#plTable tbody tr')].find(r => r.getAttribute('onclick') === 'openEinsatz(12)');
    return !!tr && !tr.querySelector('.rap-abw');
  }));

// ══════════ RAPPORT-SYMBOL JE PERSON (ENT-141)
// Der Projektinhaber, nach Rueckfrage zum Geltungsbereich ausdruecklich
// bestaetigt: JEDE Schicht in der Liste, nicht nur innerhalb einer Serie.
// Ein kleines Symbol am Namen-Chip, sobald fuer genau diese Person ein
// Rapport vorliegt -- oeffnet ihn direkt (openDrawer), ohne den Umweg ueber
// den Einsatzplan.
check('KRITISCH: der Name-Chip einer Person mit Rapport traegt das Rapport-Symbol',
  await page.evaluate(() => {
    const tr = [...document.querySelectorAll('#plTable tbody tr')].find(r => r.getAttribute('onclick') === 'openEinsatz(14)');
    const chip = tr && [...tr.querySelectorAll('.crew .nm')].find(n => n.textContent.includes('Daniele Ciardo'));
    return !!chip && !!chip.querySelector('.nm-rap');
  }));
check('Eine Person ohne Rapport zu dieser Schicht traegt KEIN Symbol',
  await page.evaluate(() => {
    const tr = [...document.querySelectorAll('#plTable tbody tr')].find(r => r.getAttribute('onclick') === 'openEinsatz(11)');
    const chip = tr && [...tr.querySelectorAll('.crew .nm')].find(n => n.textContent.includes('Adrian'));
    return !!chip && !chip.querySelector('.nm-rap');
  }));
check('KRITISCH: das Symbol zielt auf den richtigen Rapport (openDrawer mit der passenden ID)',
  await page.evaluate(() => {
    const tr = [...document.querySelectorAll('#plTable tbody tr')].find(r => r.getAttribute('onclick') === 'openEinsatz(14)');
    const btn = tr && tr.querySelector('.crew .nm-rap');
    return !!btn && btn.getAttribute('onclick') === 'event.stopPropagation();openDrawer(500)';
  }));
check('KRITISCH: ein Klick oeffnet den Rapport-Betrachter, ohne die Zeile selbst zu oeffnen',
  await page.evaluate(() => {
    const tr = [...document.querySelectorAll('#plTable tbody tr')].find(r => r.getAttribute('onclick') === 'openEinsatz(14)');
    tr.querySelector('.crew .nm-rap').click();
    return !document.getElementById('view-einsatzplan').classList.contains('on');
  }));
await page.waitForTimeout(300);
check('Der geoeffnete Rapport ist tatsaechlich der richtige',
  (await page.textContent('#drTitle')).includes('500'));
await page.evaluate(() => closeDrawer());
await page.waitForTimeout(200);

// openEinsatz() fuehrt seit 3392470 in die Einsatzplan-Ansicht. Die
// Schublade -- und mit ihr der Schreibschutz, den die folgenden Pruefungen
// belegen -- haengt dort hinter "Einsatz bearbeiten"; direkt aufgerufen ist
// es derselbe Code.
await page.evaluate(() => openEinsatzDrawer(14));
await page.waitForSelector('#drawer.on');
await page.waitForTimeout(250);
const gesperrt = await page.textContent('#drBody');
check('Die Schublade sagt zuerst, dass die Schicht festgeschrieben ist',
  gesperrt.includes('abgeglichen und festgeschrieben'));
check('Sie nennt den Grund, nicht nur das Verbot', gesperrt.includes('nie gab'));
check('KRITISCH: kein Speichern-Knopf', !(await page.isVisible('#drFoot .btn-primary')));
check('KRITISCH: keine Loeschzone', !gesperrt.includes('Einsatz löschen'));
check('KRITISCH: alle Felder der Schublade sind gesperrt',
  await page.evaluate(() => ['enEKunde_name', 'enETitel', 'enEStrasse', 'enEOrt', 'enESparte',
    'enEEinsatzart', 'enEDatum', 'enEBedarf', 'enEVon', 'enEBis', 'enEStatus', 'enEBemerkung']
    .every(id => document.getElementById(id).disabled)));
check('KRITISCH: auch die Zuteilung laesst sich nicht mehr aendern',
  await page.evaluate(() => [...document.querySelectorAll('#enEMa input')].every(i => i.disabled)));
check('Lesen bleibt moeglich -- die geplanten Werte stehen da',
  (await page.inputValue('#enEVon')) === '08:00');
check('Der Weg zum Aufheben wird benannt', gesperrt.includes('Zum Abgleich'));
check('KRITISCH: das Oeffnen der gesperrten Schicht schreibt nichts', writes().length === 0);
await page.screenshot({ path: `${OUT}/23b-planung-gesperrt.png` });
await page.evaluate(() => closeDrawer());
await page.waitForTimeout(200);

// Eine offene Schicht bleibt uneingeschraenkt bearbeitbar.
await page.evaluate(() => openEinsatzDrawer(11));
await page.waitForSelector('#drawer.on');
await page.waitForTimeout(250);
check('Offene Schicht: Speichern steht weiterhin bereit', await page.isVisible('#drFoot .btn-primary'));
check('Offene Schicht: Felder sind bedienbar',
  await page.evaluate(() => !document.getElementById('enEVon').disabled));
check('Offene Schicht: Loeschzone ist da', (await page.textContent('#drBody')).includes('Einsatz löschen'));
await page.evaluate(() => closeDrawer());
await page.waitForTimeout(200);
await page.evaluate(() => {
  const e = einsaetze.find(x => Number(x.id) === 14);
  e.mitarbeiter[0].ist_status = 'offen';
});

// ══════════ STATUS "ABGESCHLOSSEN" SPERRT NUR SICH SELBST, NICHT DIE GANZE SCHUBLADE (ENT-128)
// Anders als die ENT-045-Sperre (enGesperrt, oben): "abgeschlossen" kommt vom
// Server und darf hier nicht von Hand zurueckgedreht werden -- aber die
// UEBRIGEN Felder (Kunde, Bemerkung, ...) bleiben bearbeitbar, weil dieser
// Einsatz nicht zwingend auch abgeglichen ist.
await page.evaluate(() => { einsaetze.find(x => Number(x.id) === 11).status = 'abgeschlossen'; renderPlanung(); });
await page.waitForTimeout(200);
check('KRITISCH: die Liste zeigt "Abgeschlossen" als Status-Badge',
  await page.evaluate(() => {
    const tr = [...document.querySelectorAll('#plTable tbody tr')]
      .find(r => r.getAttribute('onclick') === 'openEinsatz(11)');
    return !!tr && /Abgeschlossen/.test(tr.textContent);
  }));
// Gemessen am gerenderten Zustand, nicht im Quelltext nachgelesen (CLAUDE.md):
// eine CSS-Regel kann wirkungslos bleiben, ohne dass etwas kaputtgeht.
check('Die Zeile eines abgeschlossenen Einsatzes tritt sichtbar zurueck (Opacity < 1)',
  await page.evaluate(() => {
    const tr = [...document.querySelectorAll('#plTable tbody tr')]
      .find(r => r.getAttribute('onclick') === 'openEinsatz(11)');
    const td = tr && tr.querySelector('td');
    return !!td && parseFloat(getComputedStyle(td).opacity) < 1;
  }));
check('Eine geplante Zeile bleibt dagegen voll sichtbar (Opacity 1) -- kein pauschales Ausgrauen',
  await page.evaluate(() => {
    const tr = [...document.querySelectorAll('#plTable tbody tr')]
      .find(r => r.getAttribute('onclick') === 'openEinsatz(12)');
    const td = tr && tr.querySelector('td');
    return !!td && parseFloat(getComputedStyle(td).opacity) === 1;
  }));
await page.evaluate(() => openEinsatzDrawer(11));
await page.waitForSelector('#drawer.on');
await page.waitForTimeout(250);
check('KRITISCH: das Statusfeld ist gesperrt, sobald der Status "abgeschlossen" ist',
  await page.evaluate(() => document.getElementById('enEStatus').disabled));
check('KRITISCH: andere Felder bleiben trotzdem bedienbar -- keine Vollsperre',
  await page.evaluate(() => !document.getElementById('enEKunde_name').disabled
    && !document.getElementById('enEBemerkung').disabled));
check('Speichern steht weiterhin bereit -- nur der Status selbst ist geschuetzt',
  await page.isVisible('#drFoot .btn-primary'));
check('Der Statuswert zeigt "Abgeschlossen" an, nicht die erste Option',
  (await page.$eval('#enEStatus', el => el.options[el.selectedIndex].value)) === 'abgeschlossen');
await page.evaluate(() => closeDrawer());
await page.waitForTimeout(200);
await page.evaluate(() => { einsaetze.find(x => Number(x.id) === 11).status = 'geplant'; });

// ══════════ FEHLENDE TABELLE
await page.evaluate(() => { einsaetze = []; });
// Genau die Antwort, die db.php bei fehlender Tabelle liefert (SQLSTATE 42S02)
const FEHLT = 'Eine benoetigte Tabelle fehlt in der Datenbank. Wurde backend/schema_planung.sql schon in phpMyAdmin ausgefuehrt?';
await page.route('**/api/einsatz_list.php', route => route.fulfill({ status: 500, contentType: 'application/json',
  body: JSON.stringify({ status: 'error', message: FEHLT }) }));
await page.evaluate(() => loadEinsaetze());
await page.waitForTimeout(400);
const fehlerText = await page.textContent('#plTable');
check('Fehlende Tabelle wird verstaendlich gemeldet', fehlerText.includes('schema_planung.sql'));
check('Servermeldung wird unveraendert gezeigt', fehlerText.includes(FEHLT));
check('Hinweis steht genau einmal', fehlerText.split('schema_planung.sql').length - 1 === 1);
// Der Weg aus dem Fehler heraus muss direkt anklickbar sein
check('Einrichtungsknopf wird angeboten', await page.isVisible('#plTable button'));
calls = [];
await page.click('#plTable button');
await page.waitForTimeout(400);
const einr = calls.find(c => c.path.includes('planung_einrichten'));
check('Knopf ruft die Einrichtung', !!einr);

// ══════════════ HERKUNFT: EINSATZ ODER OBJEKTSCHICHT (ENT-058)
// Ein Einsatz entsteht entweder frei oder aus einem Objekt samt seiner
// Masterschichten. Massgeblich ist objekt_id, NICHT die Einsatzart -- ein
// freier Verkehrsdienst und eine Objektschicht koennen dieselbe Art tragen.
await page.evaluate(() => go('planung'));
await page.waitForTimeout(300);
await page.evaluate(() => goTab('einsaetze'));
await page.waitForTimeout(400);
// Testdaten so setzen, dass beide Herkuenfte vorkommen und die Einsatzart
// bewusst KEINE Unterscheidung erlaubt.
await page.evaluate(tag => {
  // Bewusst gesetzt statt aus dem Bestand abgeleitet: Der Bestand ist an
  // dieser Stelle je nach vorherigem Schritt leer, und ein Test, der auf
  // leeren Daten "besteht", prueft nichts.
  const mk = (id, objId) => ({ id, kunde_id: 1, kunde_name: 'Studer Immobilien AG',
    titel: 'Zeile ' + id, strasse: 'Weg 1', ort: '4632 Trimbach',
    einsatzart: 'Verkehrsdienst', datum: tag, von: '08:00:00', bis: '12:00:00',
    bedarf: 1, status: 'geplant', bemerkung: null, mitarbeiter: [], objekt_id: objId });
  einsaetze = [mk(901, 7), mk(902, null), mk(903, 7), mk(904, null), mk(905, 7)];
  $('pSchnell').value = 'alle'; pSchnellSetzen();
}, HEUTE);
await page.waitForTimeout(400);
check('Der Herkunftsfilter ist da', await page.isVisible('#pHerkunft'));
// Vorgabe seit ENT-106: nur Einsaetze, keine Objektschichten. Wer die
// Objektplanung sucht, hat dafuer einen eigenen Reiter -- diese Liste ist
// fuer den frei angelegten Einsatz.
check('KRITISCH: die Vorgabe zeigt nur Einsätze, keine Objektschichten',
  (await page.inputValue('#pHerkunft')) === 'einsatz');
const zaehl = () => page.evaluate(() => pFiltered().length);
const einZ = await zaehl();
check('KRITISCH: "Nur Einsaetze" (als Vorgabe) laesst nur Zeilen ohne objekt_id uebrig',
  await page.evaluate(() => pFiltered().every(e => !e.objekt_id)) && einZ > 0);
await page.selectOption('#pHerkunft', 'objekt');
await page.waitForTimeout(300);
const objZ = await zaehl();
check('KRITISCH: "Nur Objektschichten" laesst nur Zeilen mit objekt_id uebrig',
  await page.evaluate(() => pFiltered().every(e => !!e.objekt_id)) && objZ > 0);
await page.selectOption('#pHerkunft', '');
await page.waitForTimeout(300);
const alleZ = await zaehl();
check('Zusammen ergeben beide wieder alles', objZ + einZ === alleZ);
check('KRITISCH: unterschieden wird nach Herkunft, nicht nach Einsatzart',
  await page.evaluate(() => new Set(einsaetze.map(e => e.einsatzart)).size === 1));
await page.selectOption('#pHerkunft', 'einsatz');
await page.waitForTimeout(300);
check('Zuruecksetzen auf die Vorgabe zeigt wieder nur Einsätze', (await zaehl()) === einZ);

// ══════════════ BENENNUNG (ENT-058)
const kpiTxt = await page.textContent('#plKpi');
check('Die Kachel heisst "Offene Schichten"', /Offene Schichten/i.test(kpiTxt));
check('KRITISCH: "Offene Stellen" kommt nirgends mehr vor',
  !/Offene Stellen/i.test(await page.content()));
const krume = await page.textContent('#pgCrumb');
check('Auch die Kopfzeile sagt Schichten, nicht Stellen',
  !/Stelle/.test(krume));

// ══════════════ SPALTENBREITEN (ENT-137)
// Der Projektinhaber, mit einer markierten Planungs-Tabelle: die Spalten
// wirkten ungleichmaessig -- Zwischenraeume unterschiedlich breit, "Status"
// weit nach rechts verschoben, obwohl das Padding je Zelle die ganze Zeit
// gleich war. Grund: table-layout:auto orientierte die Breite jeder Spalte
// am breitesten Inhalt ueber ALLE Zeilen hinweg -- eine einzelne Zeile mit
// vielen Namen in "Zugeteilt" blaehte diese eine Spalte auf und verdraengte
// die uebrigen. Feste Prozentbreiten (table-layout:fixed + colgroup) beheben
// das strukturell, nicht durch Zufall der zufaellig groessten Zeile.
await page.evaluate(() => { go('planung'); goTab('einsaetze'); });
await page.selectOption('#pSchnell', 'alle');
await page.waitForTimeout(300);
// Absichtlich viel Inhalt in EINER Zelle -- genau der Fall, der table-layout:
// auto zuvor aus der Fassung brachte. Datum weit in der Vergangenheit (2000):
// harmlos fuer test_datumsfest.mjs, das nur Daten NAHE bei heute verbietet.
await page.evaluate(() => {
  einsaetze.push({ id: 900, kunde_id: 1, kunde_name: 'Eine sehr sehr lange Kundenbezeichnung AG',
    titel: 'Und ein ebenso langer Titel dazu', strasse: null, ort: '4632 Trimbach',
    einsatzart: 'Verkehrsdienst', datum: '2000-01-01', von: '07:00:00', bis: '16:00:00',
    bedarf: 5, status: 'geplant', bemerkung: null,
    mitarbeiter: [{ id: 101, name: 'x1', vorname: 'Adrian', nachname: 'Von Arb' },
      { id: 102, name: 'x2', vorname: 'Daniele', nachname: 'Ciardo' },
      { id: 103, name: 'x3', vorname: 'Hans', nachname: 'Meier' }] });
  renderPlanung();
});
await page.waitForTimeout(200);
const spalten = await page.evaluate(() => {
  const table = document.querySelector('#plTable table.pl-tab');
  if (!table) return null;
  const breite = table.getBoundingClientRect().width;
  return [...table.querySelectorAll('thead th')].map(th => (th.getBoundingClientRect().width / breite) * 100);
});
check('KRITISCH: die Planung-Tabelle traegt feste Spaltenbreiten (table-layout:fixed)', !!spalten);
// Enge Toleranz mit Bedacht gewaehlt: table-layout:fixed haelt die Breite auf
// 0.01 Prozentpunkte genau ein. Ohne fixed (nur colgroup, table-layout:auto)
// wich "Besetzung" bereits um über 1 Prozentpunkt ab (9.2 statt 8 -- der
// Browser respektiert col-Breiten als Hinweis, nicht als Vorgabe, sobald
// Inhalt umbricht). 0.5 trennt beide Faelle sauber; 2 (die erste Fassung
// dieser Pruefung) haette den Regressionsfall durchgelassen -- beim Schreiben
// der Gegenprobe selbst bemerkt und korrigiert.
// Zeit 10 -> 13 % und Zugeteilt 24 -> 21 % seit ENT-144: die Zeitspalte traegt
// jetzt Pfeil, Uhrzeit und Reihen-Marke und lief bei 10 % sichtbar ueber.
const ERWARTET_SPALTEN = [13, 18, 15, 13, 8, 21, 12];
check('KRITISCH: jede Spalte behaelt ihre vorgesehene Breite, auch mit ueberlangem Inhalt in einer einzelnen Zeile',
  !!spalten && spalten.length === ERWARTET_SPALTEN.length
  && spalten.every((p, i) => Math.abs(p - ERWARTET_SPALTEN[i]) < 0.5));
await page.evaluate(() => { einsaetze.splice(einsaetze.findIndex(e => Number(e.id) === 900), 1); });

// Dasselbe Muster gilt fuer den Tagesplan -- dieselbe Liste, nur nach einem
// Tag gefiltert, mit denselben zwei Fallstricken (table-layout, viele Namen).
await page.evaluate(() => goTab('tag'));
await page.waitForTimeout(300);
const spaltenTag = await page.evaluate(() => {
  const table = document.querySelector('#tgBody table.pl-tab');
  if (!table) return null;
  const breite = table.getBoundingClientRect().width;
  return [...table.querySelectorAll('thead th')].map(th => (th.getBoundingClientRect().width / breite) * 100);
});
check('KRITISCH: die Tagesplan-Tabelle traegt ebenfalls feste Spaltenbreiten', !!spaltenTag);
const ERWARTET_TAG = [11, 22, 18, 9, 26, 14];
check('Die Tagesplan-Spalten entsprechen den vorgesehenen Breiten',
  !!spaltenTag && spaltenTag.length === ERWARTET_TAG.length
  && spaltenTag.every((p, i) => Math.abs(p - ERWARTET_TAG[i]) < 0.5));

// ══════════════ SICHTBARE SPALTENGRENZEN (ENT-140)
// Der Projektinhaber meldete trotz ENT-137 (Breiten bereits exakt, siehe
// oben) weiterhin "nicht sauber ausgerichtete" Spalten. Eine duenne, aber
// durchgehende Trennlinie macht die Spaltengrenze objektiv sichtbar, statt
// sie nur aus Textabstaenden zu erraten -- dasselbe Prinzip wie im
// Einsatzplan-Raster (table.ep-gitter .fest { border-right }).
check('KRITISCH: jede Spalte ausser der letzten traegt eine sichtbare Trennlinie (Planung)',
  await page.evaluate(() => {
    const zellen = [...document.querySelectorAll('#plTable table.pl-tab thead th')];
    if (zellen.length < 2) return false;
    const transparent = c => c === 'transparent' || c === 'rgba(0, 0, 0, 0)';
    return zellen.slice(0, -1).every(z => !transparent(getComputedStyle(z).borderRightColor)
      && getComputedStyle(z).borderRightWidth !== '0px');
  }));
check('Die letzte Spalte (Status) traegt KEINE Trennlinie danach -- kein Rand ins Leere',
  await page.evaluate(() => {
    const letzte = document.querySelector('#plTable table.pl-tab thead th:last-child');
    return !!letzte && getComputedStyle(letzte).borderRightWidth === '0px';
  }));
check('Die Tagesueberschrift-Zeile (eine einzige, spannende Zelle) bleibt ohne Trennlinie',
  await page.evaluate(() => {
    const grpTd = document.querySelector('#plTable table.pl-tab tbody tr.grp td');
    return !!grpTd && getComputedStyle(grpTd).borderRightWidth === '0px';
  }));
// Am gerenderten Zustand gemessen: dieselbe Farbe wie eine isolierte Sonde
// mit der erwarteten CSS-Custom-Property, nicht nur "irgendeine" Farbe.
check('KRITISCH: die Trennlinie hat die vorgesehene, dezente Farbe (--line-soft)',
  await page.evaluate(() => {
    const zelle = document.querySelector('#plTable table.pl-tab thead th');
    const sonde = document.createElement('div');
    sonde.style.borderRight = '1px solid var(--line-soft)';
    document.body.appendChild(sonde);
    const erwartet = getComputedStyle(sonde).borderRightColor;
    sonde.remove();
    return !!zelle && getComputedStyle(zelle).borderRightColor === erwartet;
  }));
check('Dieselbe Trennlinie gilt auch fuer den Tagesplan',
  await page.evaluate(() => {
    const zellen = [...document.querySelectorAll('#tgBody table.pl-tab thead th')];
    if (zellen.length < 2) return false;
    const transparent = c => c === 'transparent' || c === 'rgba(0, 0, 0, 0)';
    return zellen.slice(0, -1).every(z => !transparent(getComputedStyle(z).borderRightColor)
        && getComputedStyle(z).borderRightWidth !== '0px')
      && getComputedStyle(zellen[zellen.length - 1]).borderRightWidth === '0px';
  }));

// ══════════════ SERIEN-GRUPPIERUNG (ENT-142) ═══════════════════════════════
// Der Projektinhaber hat ausdrücklich die grössere, invasivere Variante
// gewählt (gegen die Empfehlung der unaufdringlicheren Variante A): alle Tage
// einer Reihe klappen sich zu EINER Zeile beim ersten Tag zusammen; die
// übrigen Tage stehen standardmässig als schlanke Verweiszeile in ihrem
// eigenen Tagesblock -- nie einfach weg (ENT-069: "nichts vorhanden" darf nie
// etwas anderes bedeuten als nichts vorhanden).
await page.evaluate(({ a, b, c, d, nah, fern }) => {
  einsaetze = [
    { id: 201, kunde_id: 1, kunde_name: 'Strabag AG', titel: 'Belagseinbau', strasse: 'Kantonsstrasse 3',
      ort: '6000 Luzern', einsatzart: 'Verkehrsdienst', datum: a, von: '06:00:00', bis: '18:00:00',
      bedarf: 1, status: 'geplant', bemerkung: null, mitarbeiter: [], serie_id: 201, objekt_id: null, masterschicht_id: null },
    { id: 202, kunde_id: 1, kunde_name: 'Strabag AG', titel: 'Belagseinbau', strasse: 'Kantonsstrasse 3',
      ort: '6000 Luzern', einsatzart: 'Verkehrsdienst', datum: b, von: '06:00:00', bis: '18:00:00',
      bedarf: 1, status: 'geplant', bemerkung: null, mitarbeiter: [], serie_id: 201, objekt_id: null, masterschicht_id: null },
    { id: 203, kunde_id: 1, kunde_name: 'Strabag AG', titel: 'Belagseinbau', strasse: 'Kantonsstrasse 3',
      ort: '6000 Luzern', einsatzart: 'Verkehrsdienst', datum: c, von: '06:00:00', bis: '18:00:00',
      bedarf: 1, status: 'geplant', bemerkung: null, mitarbeiter: [], serie_id: 201, objekt_id: null, masterschicht_id: null },
    { id: 204, kunde_id: 2, kunde_name: 'Einzelkunde AG', titel: null, strasse: null,
      ort: '4600 Olten', einsatzart: 'Revierdienst', datum: d, von: '08:00:00', bis: '12:00:00',
      bedarf: 1, status: 'geplant', bemerkung: null, mitarbeiter: [], serie_id: null, objekt_id: null, masterschicht_id: null },
    // Eine ZWEITE Reihe, deren Geschwistertag weit ausserhalb liegt (ENT-144):
    // in einem engen Zeitraum ist hier nur EIN Tag sichtbar -- dann ist es
    // keine Gruppe, und die Zeile darf nicht aussehen wie eine.
    { id: 205, kunde_id: 2, kunde_name: 'Fremdreihe GmbH', titel: null, strasse: null,
      ort: '3000 Bern', einsatzart: 'Verkehrsdienst', datum: nah, von: '19:00:00', bis: '23:00:00',
      bedarf: 1, status: 'geplant', bemerkung: null, mitarbeiter: [], serie_id: 205, objekt_id: null, masterschicht_id: null },
    { id: 206, kunde_id: 2, kunde_name: 'Fremdreihe GmbH', titel: null, strasse: null,
      ort: '3000 Bern', einsatzart: 'Verkehrsdienst', datum: fern, von: '19:00:00', bis: '23:00:00',
      bedarf: 1, status: 'geplant', bemerkung: null, mitarbeiter: [], serie_id: 205, objekt_id: null, masterschicht_id: null },
  ];
  pSerie = null; pSerieOffen = new Set();
  $('pHerkunft').value = ''; $('pQ').value = '';
  $('pSchnell').value = 'alle'; pSchnellSetzen();
  renderPlanung();
}, { a: tage(2), b: tage(3), c: tage(4), d: tage(5), nah: tage(6), fern: tage(60) });
await page.waitForTimeout(300);

const stand1 = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#plTable table.pl-tab tbody tr')];
  const anker = rows.find(r => r.getAttribute('onclick') === 'openEinsatz(201)');
  const folge202 = rows.find(r => r.classList.contains('serie-folge') && r.textContent.includes('Tag 2 von 3'));
  const folge203 = rows.find(r => r.classList.contains('serie-folge') && r.textContent.includes('Tag 3 von 3'));
  return {
    ankerDa: !!anker,
    ankerHatMarke: !!(anker && anker.querySelector('.serie-marke') && anker.querySelector('.serie-marke').textContent.trim() === 'Tag 1 von 3'),
    ankerHatKlapp: !!(anker && anker.querySelector('.serie-klapp')),
    klappZu: anker && anker.querySelector('.serie-klapp') && anker.querySelector('.serie-klapp').textContent.trim(),
    folge202Da: !!folge202, folge203Da: !!folge203,
    volle202FehltNoch: !rows.find(r => r.getAttribute('onclick') === 'openEinsatz(202)'),
    volle203FehltNoch: !rows.find(r => r.getAttribute('onclick') === 'openEinsatz(203)'),
  };
});
check('KRITISCH: der erste Tag der Reihe zeigt die volle Zeile, mit der bestehenden Marke "Tag 1 von 3" unverändert', stand1.ankerDa && stand1.ankerHatMarke);
check('KRITISCH: der erste Tag trägt zusätzlich den Auf/Zu-Pfeil', stand1.ankerHatKlapp);
check('Eingeklappt zeigt der Pfeil nach rechts (zu)', stand1.klappZu === '▸');
check('KRITISCH: Tag 2 und Tag 3 stehen als schlanke Verweiszeile in ihrem eigenen Tagesblock',
  stand1.folge202Da && stand1.folge203Da);
check('KRITISCH: solange eingeklappt, erscheinen Tag 2 und Tag 3 NICHT als volle Zeile',
  stand1.volle202FehltNoch && stand1.volle203FehltNoch);

// ENT-069: Ein Tagesblock, dessen einziger Einsatz eine eingeklappte
// Verweiszeile ist, darf trotzdem die richtige Anzahl zeigen -- sonst sieht
// "1 Einsatz an diesem Tag" aus wie "nichts geplant".
const kopfTag2 = await page.evaluate(bIso => {
  const dmyB = dmy(bIso);
  const grp = [...document.querySelectorAll('#plTable table.pl-tab tbody tr.grp')]
    .find(g => g.textContent.includes(dmyB));
  return grp ? grp.textContent.replace(/\s+/g, ' ').trim() : null;
}, tage(3));
check('KRITISCH: der Tagesblock des zweiten Reihentags zeigt weiterhin "1 Einsatz" -- die eingeklappte Verweiszeile lässt ihn nicht leer erscheinen (ENT-069)',
  !!kopfTag2 && /\b1 Einsatz\b/.test(kopfTag2) && !/0 Einsätze/.test(kopfTag2));

// ── Aufklappen über den Pfeil
await page.evaluate(() => { document.querySelector('tr[onclick="openEinsatz(201)"] .serie-klapp').click(); });
await page.waitForTimeout(250);
const stand2 = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#plTable table.pl-tab tbody tr')];
  const idx = attr => rows.findIndex(r => r.getAttribute('onclick') === attr);
  const volle202 = rows.find(r => r.getAttribute('onclick') === 'openEinsatz(202)');
  const anker = rows.find(r => r.getAttribute('onclick') === 'openEinsatz(201)');
  return {
    volle202Da: !!volle202, volle203Da: !!rows.find(r => r.getAttribute('onclick') === 'openEinsatz(203)'),
    volle202IstKind: !!(volle202 && volle202.classList.contains('serie-kind')),
    volle202HatEigenesDatum: !!(volle202 && volle202.querySelector('.serie-kind-datum')),
    direktNachAnker: idx('openEinsatz(201)') + 1 === idx('openEinsatz(202)'),
    klappAuf: anker && anker.querySelector('.serie-klapp').textContent.trim(),
    folgeInEigenemTagNochDa: !!rows.find(r => r.classList.contains('serie-folge') && r.textContent.includes('Tag 2 von 3')),
  };
});
check('KRITISCH: nach dem Aufklappen zeigt der Pfeil nach unten (auf)', stand2.klappAuf === '▾');
check('KRITISCH: Tag 2 und Tag 3 erscheinen jetzt als volle Zeile, direkt unter dem ersten Tag',
  stand2.volle202Da && stand2.volle203Da && stand2.direktNachAnker);
check('KRITISCH: die eingeschobene Zeile trägt ihr eigenes Datum -- sie steht ausserhalb ihres Tagesblocks',
  stand2.volle202IstKind && stand2.volle202HatEigenesDatum);
check('KRITISCH: der eigene Tagesblock von Tag 2 zeigt weiterhin den schlanken Verweis -- die Gruppe verschwindet dort nicht, nur weil sie oben ausgeklappt ist',
  stand2.folgeInEigenemTagNochDa);

// ── Wieder einklappen, dann über die Verweiszeile selbst aufklappen
await page.evaluate(() => { document.querySelector('tr[onclick="openEinsatz(201)"] .serie-klapp').click(); });
await page.waitForTimeout(250);
check('Wieder eingeklappt: die Kennung ist aus pSerieOffen entfernt',
  await page.evaluate(() => !pSerieOffen.has('s201')));
await page.evaluate(() => {
  [...document.querySelectorAll('#plTable table.pl-tab tbody tr.serie-folge')]
    .find(r => r.textContent.includes('Tag 2 von 3')).click();
});
await page.waitForTimeout(300);
check('KRITISCH: ein Klick auf die Verweiszeile klappt die Reihe auf',
  await page.evaluate(() => pSerieOffen.has('s201')));
check('Der angeklickte Tag erscheint danach als volle Zeile',
  await page.evaluate(() => !!document.querySelector('tr[onclick="openEinsatz(202)"]')));

// ── Ausserhalb der Serie greift die Gruppierung nicht: einzelner Einsatz, und die isolierte Reihenansicht
check('Ein einzelner Einsatz bekommt weder Pfeil noch Verweiszeile',
  await page.evaluate(() => {
    const tr = [...document.querySelectorAll('#plTable table.pl-tab tbody tr')].find(r => r.getAttribute('onclick') === 'openEinsatz(204)');
    return !!tr && !tr.querySelector('.serie-klapp') && !tr.classList.contains('serie-folge');
  }));
await page.evaluate(() => { serieZeigen('s201'); });
await page.waitForTimeout(300);
check('KRITISCH: in der isolierten Reihenansicht (serieZeigen) steht jeder Tag als volle Zeile, ohne Gruppierung',
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#plTable table.pl-tab tbody tr')];
    return [201, 202, 203].every(id => !!rows.find(r => r.getAttribute('onclick') === `openEinsatz(${id})`))
      && !rows.some(r => r.classList.contains('serie-folge'));
  }));
await page.evaluate(() => { serieFilterWeg(); pSerieOffen = new Set(); renderPlanung(); });
await page.waitForTimeout(300);

// ── Handy: derselbe Mechanismus, mit Trefferflächen
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
const handy1 = await page.evaluate(() => {
  const karten = [...document.querySelectorAll('#plTable .nur-schmal .ag-karte')];
  const anker = karten.find(k => k.getAttribute('onclick') === 'openEinsatz(201)');
  const folge = karten.find(k => k.classList.contains('serie-folge') && k.textContent.includes('Tag 2 von 3'));
  const klapp = anker && anker.querySelector('.serie-klapp');
  const kr = klapp ? klapp.getBoundingClientRect() : null;
  const fr = folge ? folge.getBoundingClientRect() : null;
  return {
    ankerDa: !!anker, folgeDa: !!folge,
    klappHoehe: kr && Math.round(kr.height), klappBreite: kr && Math.round(kr.width),
    folgeHoehe: fr && Math.round(fr.height),
    ueberlauf: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
});
check('KRITISCH: auch die Handy-Karte zeigt den ersten Tag mit Pfeil, die weiteren als Verweis-Karte',
  handy1.ankerDa && handy1.folgeDa);
check('KRITISCH: der Pfeil hält die Trefferfläche von 44 px ein', handy1.klappHoehe >= 44 && handy1.klappBreite >= 44);
check('KRITISCH: die Verweis-Karte hält ebenfalls 44 px ein — sie ist als Ganzes klickbar',
  handy1.folgeHoehe >= 44);
check('Kein Querlauf auf dem Handy', handy1.ueberlauf <= 1);

await page.evaluate(() => { document.querySelector('.ag-karte[onclick="openEinsatz(201)"] .serie-klapp').click(); });
await page.waitForTimeout(250);
check('KRITISCH: auch auf dem Handy erscheinen die weiteren Tage nach dem Aufklappen als volle Karte, eingerückt',
  await page.evaluate(() => {
    const k = document.querySelector('#plTable .nur-schmal .ag-karte[onclick="openEinsatz(202)"]');
    return !!k && k.classList.contains('serie-kind');
  }));
await page.setViewportSize({ width: 1440, height: 1000 });
await page.evaluate(() => { pSerieOffen = new Set(); renderPlanung(); });
await page.waitForTimeout(300);

// ══════════════ GESTALTUNG DER GRUPPE (ENT-144) ════════════════════════════
// Der Projektinhaber meldete am gelieferten Stand zwei Dinge: Schrift und
// Knopf überlagerten sich in der Zeitspalte, und weitere verlinkte Aufträge
// trugen dieselbe Farbe wie die Gruppe. Beides war mit den ENT-142-Prüfungen
// NICHT zu finden — die prüften Vorhandensein und Struktur, aber keine
// Geometrie und keine Flächen. Genau das wird hier nachgeholt (CLAUDE.md:
// „Gestaltung wird gemessen, nicht im Quelltext nachgelesen").
const geo = await page.evaluate(() => {
  const anker = document.querySelector('#plTable table.pl-tab tr[onclick="openEinsatz(201)"]');
  if (!anker) { return null; }
  const zelle = anker.querySelector('td');
  const marke = anker.querySelector('.serie-marke');
  const zeit = anker.querySelector('.pl-zeit');
  const nachbar = anker.querySelectorAll('td')[1];
  const r = el => el.getBoundingClientRect();
  return {
    zelleRechts: r(zelle).right, zelleLinks: r(zelle).left,
    markeRechts: r(marke).right, markeLinks: r(marke).left, markeOben: r(marke).top,
    zeitRechts: r(zeit).right, zeitUnten: r(zeit).bottom,
    nachbarLinks: r(nachbar).left,
  };
});
check('KRITISCH: die Marke ragt nicht aus der Zeitspalte in die Spalte „Kunde" — sie überlagerte dort den Kundennamen',
  !!geo && geo.markeRechts <= geo.zelleRechts + 1 && geo.markeLinks >= geo.zelleLinks - 1);
check('KRITISCH: auch Pfeil und Uhrzeit bleiben in ihrer Spalte',
  !!geo && geo.zeitRechts <= geo.zelleRechts + 1);
check('KRITISCH: die Marke steht UNTER der Uhrzeit, nicht daneben — sonst reicht die Spaltenbreite nie',
  !!geo && geo.markeOben >= geo.zeitUnten - 1);
check('Nichts überlappt die Nachbarspalte',
  !!geo && geo.markeRechts <= geo.nachbarLinks + 1 && geo.zeitRechts <= geo.nachbarLinks + 1);

// ── Fläche trennt Gruppe von Nicht-Gruppe
// Eine Reihe, von der hier nur EIN Tag sichtbar ist, ist keine Gruppe. Trüge
// sie dieselbe Fläche, verschmölze sie optisch mit der Gruppe daneben — genau
// die Rückmeldung des Projektinhabers.
await page.evaluate(({ von, bis }) => {
  $('pVon').value = von; $('pBis').value = bis;
  pSerieOffen = new Set(); renderPlanung();
}, { von: tage(1), bis: tage(6) });
await page.waitForTimeout(300);
const flaechen = await page.evaluate(() => {
  const q = id => document.querySelector(`#plTable table.pl-tab tr[onclick="openEinsatz(${id})"]`);
  const bg = tr => tr ? getComputedStyle(tr.querySelector('td')).backgroundColor : null;
  const anker = q(201), einzelReihe = q(205), normal = q(204);
  const folge = [...document.querySelectorAll('#plTable table.pl-tab tr.serie-folge')][0];
  return {
    ankerBg: bg(anker), einzelBg: bg(einzelReihe), normalBg: bg(normal),
    folgeBg: folge ? getComputedStyle(folge.querySelector('td')).backgroundColor : null,
    einzelIstSerie: !!(einzelReihe && einzelReihe.classList.contains('serie')),
    einzelIstGruppe: !!(einzelReihe && einzelReihe.classList.contains('serie-grp')),
    einzelHatMarke: !!(einzelReihe && einzelReihe.querySelector('.serie-marke')),
    ankerIstGruppe: !!(anker && anker.classList.contains('serie-grp')),
  };
});
check('KRITISCH: die Gruppe trägt Fläche', !!flaechen.ankerBg && flaechen.ankerIstGruppe
  && flaechen.ankerBg !== flaechen.normalBg);
check('KRITISCH: eine Reihe, von der nur ein Tag sichtbar ist, trägt KEINE Gruppenfläche — sie verschmolz sonst optisch mit der Gruppe daneben',
  flaechen.einzelIstSerie && !flaechen.einzelIstGruppe && flaechen.einzelBg === flaechen.normalBg);
check('Sie sagt trotzdem weiterhin, dass sie zu einer Reihe gehört — die Marke bleibt',
  flaechen.einzelHatMarke);
check('KRITISCH: die Verweiszeile trägt ebenfalls keine Fläche — sie ist ein Hinweis, kein Einsatz',
  flaechen.folgeBg === flaechen.normalBg);

// ── Die Klammer sagt, wo die Gruppe anfängt und aufhört
const klammer = await page.evaluate(() => {
  const anker = document.querySelector('#plTable table.pl-tab tr[onclick="openEinsatz(201)"]');
  const td = anker && anker.querySelector('td');
  const breit = s => parseFloat(s) || 0;
  return td ? {
    zuOben: breit(getComputedStyle(td).borderTopWidth),
    zuUnten: breit(getComputedStyle(td).borderBottomWidth),
    ende: anker.classList.contains('serie-grp-ende'),
  } : null;
});
check('KRITISCH: eingeklappt klammert die Gruppe oben UND unten — sie ist genau eine Zeile lang',
  !!klammer && klammer.ende && klammer.zuOben >= 2 && klammer.zuUnten >= 2);
await page.evaluate(() => { document.querySelector('tr[onclick="openEinsatz(201)"] .serie-klapp').click(); });
await page.waitForTimeout(250);
const klammerAuf = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#plTable table.pl-tab tbody tr')];
  const anker = rows.find(r => r.getAttribute('onclick') === 'openEinsatz(201)');
  const letzterKind = rows.filter(r => r.classList.contains('serie-kind')).pop();
  const breit = (el, s) => parseFloat(getComputedStyle(el.querySelector('td'))[s]) || 0;
  return {
    ankerNichtMehrEnde: !!anker && !anker.classList.contains('serie-grp-ende'),
    ankerOben: anker ? breit(anker, 'borderTopWidth') : 0,
    letzterIstEnde: !!letzterKind && letzterKind.classList.contains('serie-grp-ende'),
    letzterUnten: letzterKind ? breit(letzterKind, 'borderBottomWidth') : 0,
    kindHatSchiene: letzterKind ? (parseFloat(getComputedStyle(letzterKind.querySelector('td')).borderLeftWidth) || 0) : 0,
  };
});
check('KRITISCH: ausgeklappt wandert die untere Klammer an den letzten Tag der Gruppe — sonst liefe sie mitten hindurch',
  klammerAuf.ankerNichtMehrEnde && klammerAuf.ankerOben >= 2
  && klammerAuf.letzterIstEnde && klammerAuf.letzterUnten >= 2);
check('Der eingeschobene Tag steht an einer sichtbaren Schiene — er gehört erkennbar nach innen',
  klammerAuf.kindHatSchiene >= 2);
// Der Projektinhaber hat die Spaltenausrichtung schon zweimal beanstandet
// (ENT-137, ENT-140). Der eingeschobene Tag traegt eine Schiene links und ein
// Datum darueber -- beides darf die Uhrzeit NICHT gegenueber dem ersten Tag
// verschieben. Am gerenderten Text gemessen, nicht an der Zelle.
check('KRITISCH: die Uhrzeit des eingeschobenen Tages steht exakt unter der des ersten Tages — die Schiene verschiebt nichts',
  await page.evaluate(() => {
    const kante = sel => {
      const el = document.querySelector(sel);
      if (!el) { return null; }
      const r = document.createRange(); r.selectNodeContents(el);
      return r.getBoundingClientRect().right;
    };
    const a = kante('tr[onclick="openEinsatz(201)"] .pl-zeit span');
    const k = kante('tr[onclick="openEinsatz(202)"] .pl-zeit span');
    const d = kante('tr[onclick="openEinsatz(202)"] .serie-kind-datum');
    return a !== null && k !== null && d !== null
      && Math.abs(a - k) < 0.5 && Math.abs(k - d) < 0.5;
  }));
await page.evaluate(() => {
  pSerieOffen = new Set(); $('pSchnell').value = 'alle'; pSchnellSetzen();
});
await page.waitForTimeout(300);

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
