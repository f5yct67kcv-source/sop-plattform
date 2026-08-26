import { WURZEL, HIER, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { zeitSetzen } from './zeitfeld.mjs';


const URL = `file://${WURZEL}/dashboard.html`;
const EXE = browserPfad();

const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const tage = n => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const HEUTE = tage(0), MORGEN = tage(1);
const MONAT = HEUTE.slice(0, 7);
const T = n => `${MONAT}-${String(n).padStart(2, '0')}`;

const STATS = { status: 'ok',
  kpi: { rapporte_monat: 0, rapporte_vormonat: 0, stunden_monat: 0, stunden_vormonat: 0, mitarbeiter: 2, kunden: 1, rapporte_total: 0 },
  verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [] };

const MA = { status: 'ok', mitarbeiter: [
  { id: 1, name: 'adrian', ist_admin: 1, vorname: 'Adrian', nachname: 'Von Arb' },
  { id: 2, name: 'hans.meier', ist_admin: 0, vorname: 'Hans', nachname: 'Meier' }
]};
const KU = { status: 'ok', kunden: [
  { id: 1, name: 'Studer Immobilien AG', strasse: 'Gerolagstrasse 12', ort: '4632 Trimbach', telefon: '062 111 22 33', email: null }
]};

const OBJEKTE = { status: 'ok', objekte: [
  { id: 1, kunde_id: 1, kunde_name: 'Studer Immobilien AG', name: 'Einkaufszentrum Nord', strasse: 'Hauptstrasse 4',
    ort: '4632 Trimbach', kanton: 'SO', einsatzart: 'Revierdienst', aktiv: 1, bemerkung: null,
    masterschichten: 2, stunden_je_einsatz: 0.75 },
  { id: 2, kunde_id: 1, kunde_name: 'Studer Immobilien AG', name: 'Kirche Wangen', strasse: null,
    ort: '4612 Wangen', kanton: 'SO', einsatzart: 'Revierdienst', aktiv: 0, bemerkung: null,
    masterschichten: 0, stunden_je_einsatz: 0 }
]};

const MS = { status: 'ok', masterschichten: [
  { id: 10, objekt_id: 1, name: 'Schliessrunde', kuerzel: 'SR', art: 'arbeit', von: '22:00:00', bis: '22:30:00',
    pause_von: null, pause_bis: null, pause_min: 0, arbeitszeit_h: 0.5, farbe: null, auf_abruf: 0,
    rhythmus: 'woche', bedarf_mo: 1, bedarf_di: 1, bedarf_mi: 1, bedarf_do: 1, bedarf_fr: 1,
    bedarf_sa: 0, bedarf_so: 0, bedarf_feiertag: 2, intervall_tage: null, intervall_start: null,
    bedarf_intervall: 1, gueltig_ab: '2026-01-01', gueltig_bis: null, ersetzt_id: null, laeuft: true },
  { id: 11, objekt_id: 1, name: 'Patrouille Sommer', kuerzel: 'PA', art: 'arbeit', von: '20:00:00', bis: '02:00:00',
    pause_von: null, pause_bis: null, pause_min: 30, arbeitszeit_h: 5.5, farbe: null, auf_abruf: 1,
    rhythmus: 'intervall', bedarf_mo: 0, bedarf_di: 0, bedarf_mi: 0, bedarf_do: 0, bedarf_fr: 0,
    bedarf_sa: 0, bedarf_so: 0, bedarf_feiertag: 0, intervall_tage: 2, intervall_start: '2026-04-01',
    bedarf_intervall: 1, gueltig_ab: '2026-04-01', gueltig_bis: '2026-10-31', ersetzt_id: null, laeuft: true }
]};

const FEIERTAGE = { status: 'ok', kanton: 'SO', feiertage: [
  { id: 1, datum: `${new Date().getFullYear()}-05-01`, kanton: 'SO', name: 'Tag der Arbeit (ab Mittag)', halbtags: 1, ab_zeit: '12:00:00', quelle: 'Arbeitsinspektorat Kanton Solothurn' },
  { id: 2, datum: T(3), kanton: 'SO', name: 'Testfeiertag', halbtags: 0, ab_zeit: null, quelle: 'Arbeitsinspektorat Kanton Solothurn' }
], gepflegt: { von: '2026-01-01', bis: '2026-12-25' } };

const A = { id: 1, name: 'adrian', vorname: 'Adrian', nachname: 'Von Arb', zusage: 'offen' };

const EINSAETZE = { status: 'ok', einsaetze: [
  // voll besetzt
  { id: 21, kunde_id: 1, kunde_name: 'Studer Immobilien AG', objekt_id: 1, masterschicht_id: 10, titel: 'Schliessrunde',
    strasse: 'Hauptstrasse 4', ort: '4632 Trimbach', einsatzart: 'Revierdienst', datum: T(2), von: '22:00:00',
    bis: '22:30:00', bedarf: 1, status: 'geplant', bemerkung: null, mitarbeiter: [A] },
  // unterbesetzt
  { id: 22, kunde_id: 1, kunde_name: 'Studer Immobilien AG', objekt_id: 1, masterschicht_id: 10, titel: 'Schliessrunde',
    strasse: 'Hauptstrasse 4', ort: '4632 Trimbach', einsatzart: 'Revierdienst', datum: T(3), von: '22:00:00',
    bis: '22:30:00', bedarf: 2, status: 'geplant', bemerkung: null, mitarbeiter: [A] },
  // gar nicht besetzt
  { id: 23, kunde_id: 1, kunde_name: 'Studer Immobilien AG', objekt_id: 1, masterschicht_id: 10, titel: 'Schliessrunde',
    strasse: 'Hauptstrasse 4', ort: '4632 Trimbach', einsatzart: 'Revierdienst', datum: T(4), von: '22:00:00',
    bis: '22:30:00', bedarf: 1, status: 'geplant', bemerkung: null, mitarbeiter: [] },
  // provisorisch -- zaehlt nicht als Luecke
  { id: 24, kunde_id: 1, kunde_name: 'Studer Immobilien AG', objekt_id: 1, masterschicht_id: 11, titel: 'Patrouille Sommer',
    strasse: null, ort: '4632 Trimbach', einsatzart: 'Revierdienst', datum: T(5), von: '20:00:00',
    bis: '02:00:00', bedarf: 2, status: 'provisorisch', bemerkung: null, mitarbeiter: [] },
  // Einzeleinsatz ohne Objekt
  { id: 25, kunde_id: 1, kunde_name: 'Gemeinde Musterdorf', objekt_id: null, masterschicht_id: null, titel: 'Baustelle',
    strasse: 'Dorfstrasse 1', ort: '4600 Olten', einsatzart: 'Verkehrsdienst', datum: T(6), von: '07:00:00',
    bis: '16:00:00', bedarf: 1, status: 'bestaetigt', bemerkung: null, mitarbeiter: [A] },
  // abgesagt
  { id: 26, kunde_id: 1, kunde_name: 'Studer Immobilien AG', objekt_id: 1, masterschicht_id: 10, titel: 'Schliessrunde',
    strasse: null, ort: '4632 Trimbach', einsatzart: 'Revierdienst', datum: T(7), von: '22:00:00',
    bis: '22:30:00', bedarf: 1, status: 'abgesagt', bemerkung: null, mitarbeiter: [] }
]};

const VORSCHAU = { status: 'ok',
  objekt: { id: 1, name: 'Einkaufszentrum Nord', kunde_id: 1, kunde_name: 'Studer Immobilien AG',
            strasse: 'Hauptstrasse 4', ort: '4632 Trimbach', kanton: 'SO', einsatzart: 'Revierdienst' },
  von: MORGEN, bis: MORGEN, anzahl: 23, gezeigt: 2, uebersprungen: 4, vorlagen: 2, feiertage: 1,
  schichten: [
    { datum: T(10), masterschicht_id: 10, name: 'Schliessrunde', kuerzel: 'SR', von: '22:00', bis: '22:30', bedarf: 1, status: 'geplant', feiertag: null, art: 'arbeit' },
    { datum: T(11), masterschicht_id: 11, name: 'Patrouille Sommer', kuerzel: 'PA', von: '20:00', bis: '02:00', bedarf: 1, status: 'provisorisch', feiertag: 'Testfeiertag', art: 'arbeit' }
  ]};

let calls = [];
const writes = () => calls.filter(c => /create|update|delete|save|erzeugen|generieren|deactivate|reset/.test(c.path));

async function setup(page) {
  await page.route('**/api/**', async route => {
    const req = route.request();
    const path = req.url().split('/api/')[1].split('?')[0];
    let body = null;
    try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch {}
    calls.push({ path, body, url: req.url() });
    const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (path.includes('login')) return send({ status: 'ok', token: 't', name: 'adrian', ist_admin: true });
    if (path.includes('dashboard_stats')) return send(STATS);
    if (path.includes('rapport_list')) return send({ status: 'ok', rapporte: [] });
    if (path.includes('mitarbeiter_list')) return send(MA);
    if (path.includes('kunden_list')) return send(KU);
    if (path.includes('einsatz_list')) return send(EINSAETZE);
    if (path.includes('objekt_list')) return send(OBJEKTE);
    if (path.includes('objektplan')) return send({ status: 'ok', objekt: OBJEKTE.objekte[0],
      vorlagen: MS.masterschichten.map(x => ({ id: x.id, name: x.name, kuerzel: x.kuerzel, art: x.art,
        von: String(x.von).slice(0, 5), bis: String(x.bis).slice(0, 5), arbeitszeit_h: Number(x.arbeitszeit_h),
        auf_abruf: x.auf_abruf, farbe: x.farbe, gueltig_ab: x.gueltig_ab, gueltig_bis: x.gueltig_bis })),
      bedarf: [], einsaetze: EINSAETZE.einsaetze.filter(e => Number(e.objekt_id) === 1), feiertage: {} });
    if (path.includes('masterschicht_list')) return send(MS);
    if (path.includes('feiertage_list')) return send(FEIERTAGE);
    if (path.includes('schichten_vorschau')) return send(VORSCHAU);
    if (path.includes('schichten_erzeugen')) return send({ status: 'ok', angelegt: 23, uebersprungen: 4 });
    if (path.includes('masterschicht_save')) return send({ status: 'ok', id: 99, art: 'neue Fassung', alt_bis: HEUTE });
    if (path.includes('objekt_save')) return send({ status: 'ok', id: 1 });
    return send({ status: 'ok' });
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

// ══════════ REITER
await page.click('#nav-planung');
await page.waitForSelector('#mxTable table');
await page.waitForTimeout(400);
// Vier Planungsreiter seit ENT-039 (Objekte zu Kunden gezogen), seit ENT-045
// kommt der Abgleich als fuenfter dazu. Kein Objekte-Reiter mehr.
// Sichtbar zaehlen, nicht nur im DOM: seit ENT-165 liegt zusaetzlich ein
// mobiler "Rapporte"-Reiter im Markup, auf dem Desktop aber unsichtbar
// (".nur-schmal") -- ein blosses $$() zaehlte ihn faelschlich mit.
const sichtbareReiter = await page.$$eval('#view-planung .tab',
  els => els.filter(e => e.getClientRects().length));
check('Vier Reiter, keiner davon Objekte', sichtbareReiter.length === 4
  && !(await page.textContent('#view-planung .tabs')).includes('Objekte'));
check('Uebersicht ist der Standardreiter', await page.isVisible('#pv-uebersicht') && !(await page.isVisible('#pv-einsaetze')));
check('Reiter oeffnen schreibt nichts', writes().length === 0);
check('Kein eigener Objekte-Punkt in der Seitenleiste -- er haengt als Kind unter Kunden', (await page.$$('#nav-objekte')).length === 0);

// ══════════ MONATSMATRIX
const kopf = await page.$$eval('#mxTable thead th', ts => ts.map(t => ({ t: t.innerText.trim(), c: t.className })));
const tageImMonat = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
check('Kopfzeile hat Objektspalte plus alle Tage', kopf.length === tageImMonat + 1);
check('Erste Spalte ist die Objektspalte', kopf[0].c.includes('obj'));
check('Erste Spalte bleibt stehen', await page.$eval('#mxTable th.obj', el => getComputedStyle(el).position) === 'sticky');
check('Wochenenden sind gekennzeichnet', kopf.some(k => k.c.includes('we')));
check('Feiertag ist gekennzeichnet', kopf.some(k => k.c.includes('fei')));
check('Heute ist gekennzeichnet', kopf.some(k => k.c.includes('heute')));

const zeilen = await page.$$eval('#mxTable tbody tr', rs => rs.map(r => r.querySelector('td.obj').innerText.replace(/\s+/g, ' ').trim()));
check('Aktives Objekt in der Matrix', zeilen.some(z => z.includes('Einkaufszentrum Nord')));
check('Stillgelegtes Objekt ohne Einsaetze bleibt draussen', !zeilen.some(z => z.includes('Kirche Wangen')));
check('Einzeleinsaetze als eigene Zeile', zeilen.some(z => z.includes('Einzeleinsätze')));

const zellKlasse = async (tag) => page.$eval(`#mxTable tbody tr:first-child td.d:nth-child(${tag + 1}) .zelle`, el => el.className);
check('Voll besetzt ist gruen', (await zellKlasse(2)).includes('z-voll'));
check('Teilweise besetzt ist gelb', (await zellKlasse(3)).includes('z-teil'));
check('Unbesetzt ist rot', (await zellKlasse(4)).includes('z-leer'));
check('Provisorisch hat eigene Farbe', (await zellKlasse(5)).includes('z-prov'));
check('Abgesagt ist neutral', (await zellKlasse(7)).includes('z-ab'));
check('Leerer Tag ist nicht anklickbar', (await zellKlasse(9)).includes('z-nix'));
const titel = await page.getAttribute('#mxTable tbody tr:first-child td.d:nth-child(4) .zelle', 'title');
check('Zelle nennt Zeit und Besetzung', titel.includes('22:00–22:30') && titel.includes('1/2'));
check('Legende erklaert die Farben', (await page.textContent('#pv-uebersicht .legende')).includes('provisorisch'));
await page.screenshot({ path: `${OUT}/30-matrix.png` });

// Zelle fuehrt in den Tagesplan
await page.click('#mxTable tbody tr:first-child td.d:nth-child(4) .zelle');
await page.waitForTimeout(300);
check('Klick auf Zelle oeffnet den Tagesplan', await page.isVisible('#pv-tag'));
check('Tagesplan uebernimmt das Datum', (await page.inputValue('#tgD')) === T(3));
// Seit ENT-068 ein eigenes Element vor der Werkzeugleiste, nicht mehr der
// erste Baustein von #tgBody -- deshalb hier statt dort geprueft.
check('Tagesplan zeigt den Feiertag', (await page.textContent('#tgKopf')).includes('Testfeiertag'));
check('Feiertag ohne Lohnaussage erklaert', (await page.textContent('#tgKopf')).includes('Zuschläge'));
check('Tagesplan listet den Einsatz', (await page.textContent('#tgBody')).includes('1/2'));
// Das Kästchen „nur unbesetzte" ist mit ENT-069 durch den Statusfilter
// ersetzt worden -- „Nur unterbesetzt" steht dort neben den übrigen
// Zuständen statt als Sonderfall daneben. Gleiche Wirkung, geprüft am
// selben Fall.
await page.selectOption('#tgStatus', 'offen');
await page.waitForTimeout(250);
check('Filter unbesetzte behaelt den Einsatz', (await page.$$('#tgBody tbody tr')).length === 1);
check('Das alte Kästchen gibt es nicht mehr',
  await page.evaluate(() => !document.getElementById('tgNurOffen')));
await page.selectOption('#tgStatus', '');
await page.waitForTimeout(200);
await page.screenshot({ path: `${OUT}/31-tagesplan.png` });

// ══════════ OBJEKTPLANUNG
await page.click('#ptab-uebersicht');
await page.waitForTimeout(300);
calls = [];
// Der Objektname in der Matrix fuehrt in die Objektplanung
await page.click('#mxTable tbody tr:first-child td.obj button');
await page.waitForSelector('#pv-objektplan.on');
await page.waitForTimeout(500);
check('Objektname oeffnet die Objektplanung', await page.isVisible('#pv-objektplan'));
check('Objektplanung schreibt nichts', writes().length === 0);
check('Objektplan wird geladen', calls.some(c => c.path.includes('objektplan')));
check('Richtiges Objekt vorgewaehlt', (await page.inputValue('#oplObjekt')) === '1');
check('Monat aus der Uebersicht uebernommen', (await page.inputValue('#oplVon')).startsWith(MONAT));
// Der Inhalt der Objektplanung wird in test_objektplan.mjs geprueft -- dort
// steht der vollstaendige Soll/Ist-Fall. Hier nur der Weg dorthin.
await page.screenshot({ path: `${OUT}/35-objektplanung.png` });

// ══════════ OBJEKTE (seit ENT-039 unter Kunden statt in der Planung)
await page.click('#nav-kunden');
await page.waitForTimeout(200);
check('Kunden-Dropdown klappt beim Anklicken auf', await page.evaluate(() => document.getElementById('navg-kunden').classList.contains('offen')));
await page.click('#nav-kunden-objekte');
await page.waitForSelector('#oTable table');
await page.waitForTimeout(200);
check('Objektliste zeigt aktives Objekt', (await page.textContent('#oTable')).includes('Einkaufszentrum Nord'));
check('Stillgelegtes standardmaessig ausgeblendet', !(await page.textContent('#oTable')).includes('Kirche Wangen'));
await page.check('#oInaktiv');
await page.waitForTimeout(200);
check('Stillgelegtes auf Wunsch sichtbar', (await page.textContent('#oTable')).includes('Kirche Wangen'));
check('Zustand wird ausgewiesen', (await page.textContent('#oTable')).includes('stillgelegt'));
await page.uncheck('#oInaktiv');

// Anlegen
calls = [];
await page.click('#kv-objekte button:has-text("Neues Objekt")');
await page.waitForSelector('#dlgObNeu.on');
check('Kanton vorbelegt', (await page.inputValue('#obKanton')) === 'SO');
check('Einsatzart vorbelegt', (await page.inputValue('#obEinsatzart')) === 'Revierdienst');
await page.click('#obNeuBtn');
await page.waitForTimeout(200);
check('Ohne Pflichtfelder kein Anlegen', writes().length === 0 && await page.isVisible('#obNeuErr'));
await page.fill('#obName', 'Testobjekt');
await page.fill('#obKunde_name', 'Studer Immobilien AG');
await page.fill('#obOrt', '4600 Olten');
await page.click('#obNeuBtn');
await page.waitForTimeout(400);
const os = calls.find(c => c.path.includes('objekt_save'));
check('Objekt wird gespeichert', os && os.body.name === 'Testobjekt');
check('Bekannter Kunde wird verknuepft', os && os.body.kunde_id === 1);
check('Kanton wird mitgesendet', os && os.body.kanton === 'SO');
// Nach dem Anlegen geht es direkt weiter zu den Masterschichten -- ohne
// Vorlage entstuende an dem Objekt nie eine Schicht.
await page.waitForSelector('#drawer.on');
check('Neues Objekt oeffnet sich gleich', await page.isVisible('#drawer.on'));
await page.waitForTimeout(600);              // alle Nachladevorgaenge abwarten
await page.evaluate(() => closeDrawer());
await page.waitForTimeout(300);

// ══════════ SCHUBLADE MIT MASTERSCHICHTEN
calls = [];
await page.click('#oTable tbody tr:first-child');
await page.waitForSelector('#drawer.on');
await page.waitForTimeout(400);
check('Objekt-Schublade zeigt den Kanton-Hinweis', (await page.textContent('#drBody')).includes('bestimmt die Feiertage'));
check('Masterschichten geladen', (await page.$$('#msListe .ms-zeile')).length === 2);
const msText = await page.textContent('#msListe');
check('Wochenmuster wird gezeigt', msText.includes('Mo 1') && msText.includes('Fei 2'));
check('Intervall wird als Text gezeigt', msText.includes('Jeden 2. Tag'));
check('Auf Abruf ist gekennzeichnet', msText.includes('auf Abruf'));
check('Nachtschicht als Folgetag erkannt', msText.includes('Folgetag'));
check('Saisonfenster sichtbar', msText.includes('bis 31.10.2026'));
check('Oeffnen der Schublade schreibt nichts', writes().length === 0);
await page.screenshot({ path: `${OUT}/32-objekt-masterschichten.png` });

// Ändern ab Stichtag
await page.click('#msListe .ms-zeile:first-child button:has-text("Ändern ab")');
await page.waitForSelector('#dlgMs.on');
await page.waitForTimeout(200);
check('Stichtag auf heute vorbelegt', (await page.inputValue('#msGueltigAb')) === HEUTE);
check('Stichtag-Hinweis sichtbar', await page.isVisible('#msStichtagHint'));
const sh = await page.textContent('#msStichtagText');
check('Hinweis verspricht unveraenderte Vergangenheit', sh.includes('bleiben unverändert'));
check('Beschriftung nennt die neue Fassung', (await page.textContent('#msGueltigAbLbl')).includes('gilt ab'));
check('Werte der alten Fassung uebernommen', (await page.inputValue('#msVon')) === '22:00');
check('Feiertagsbedarf uebernommen', (await page.inputValue('#msBedarf_feiertag')) === '2');
check('Zeitfelder bei Aenderung bearbeitbar', !(await page.isDisabled('#msVon')));

calls = [];
await page.fill('#msBedarf_sa', '1');
await page.click('#msBtn');
await page.waitForTimeout(400);
const mss = calls.find(c => c.path.includes('masterschicht_save'));
check('Aenderung sendet Modus aenderung', mss && mss.body.modus === 'aenderung');
check('Aenderung sendet den Stichtag', mss && mss.body.gueltig_ab === HEUTE);
check('Aenderung sendet die id der alten Fassung', mss && mss.body.id === 10);
check('Geaenderter Bedarf wird mitgesendet', mss && mss.body.bedarf_sa === 1);
check('Dialog schliesst nach Speichern', !(await page.isVisible('#dlgMs.on')));

// Korrektur sperrt alles ausser der Beschriftung
await page.waitForTimeout(300);
await page.click('#msListe .ms-zeile:first-child button:has-text("Beschriftung")');
await page.waitForSelector('#dlgMs.on');
await page.waitForTimeout(200);
check('Korrektur sperrt die Zeiten', await page.isDisabled('#msVon'));
check('Korrektur sperrt den Bedarf', await page.isDisabled('#msBedarf_mo'));
check('Korrektur sperrt den Stichtag', await page.isDisabled('#msGueltigAb'));
check('Korrektur ohne Stichtag-Hinweis', !(await page.isVisible('#msStichtagHint')));
check('Name bleibt bearbeitbar', !(await page.isDisabled('#msName')));
calls = [];
await page.fill('#msName', 'Schliessrunde neu');
await page.click('#msBtn');
await page.waitForTimeout(400);
const kor = calls.find(c => c.path.includes('masterschicht_save'));
check('Korrektur sendet Modus korrektur', kor && kor.body.modus === 'korrektur');
check('Korrektur sendet keine Zeiten', kor && !('von' in kor.body));

// Neue Masterschicht: Rhythmus umschalten und Arbeitszeit rechnen
await page.waitForTimeout(300);
await page.click('#msListe ~ div button:has-text("Masterschicht hinzufügen")');
await page.waitForSelector('#dlgMs.on');
await page.waitForTimeout(200);
check('Neu zeigt das Wochenmuster', await page.isVisible('#msWoche') && !(await page.isVisible('#msIntervall')));
await page.selectOption('#msRhythmus', 'intervall');
await page.waitForTimeout(150);
check('Intervall blendet das Wochenmuster aus', !(await page.isVisible('#msWoche')) && await page.isVisible('#msIntervall'));
await page.selectOption('#msRhythmus', 'woche');
await zeitSetzen(page, '#msVon', '08:00');
await zeitSetzen(page, '#msBis', '12:30');
await page.dispatchEvent('#msBis', 'change');
await page.waitForTimeout(150);
check('Arbeitszeit wird vorgeschlagen', (await page.inputValue('#msArbeitszeit')) === '4.5');
await page.fill('#msPauseMin', '30');
await page.dispatchEvent('#msPauseMin', 'input');
await page.waitForTimeout(150);
check('Pause wird abgezogen', (await page.inputValue('#msArbeitszeit')) === '4');
// Nachtschicht ueber Mitternacht
await zeitSetzen(page, '#msVon', '22:00');
await zeitSetzen(page, '#msBis', '02:00');
await page.fill('#msPauseMin', '0');
await page.dispatchEvent('#msBis', 'change');
await page.waitForTimeout(150);
check('Nachtschicht rechnet ueber Mitternacht', (await page.inputValue('#msArbeitszeit')) === '4');
calls = [];
await page.click('#msBtn');
await page.waitForTimeout(250);
check('Ohne Bezeichnung kein Speichern', writes().length === 0);
await page.fill('#msName', 'Nachtrunde');
await page.fill('#msBedarf_mo', '1');
await page.click('#msBtn');
await page.waitForTimeout(400);
const neuMs = calls.find(c => c.path.includes('masterschicht_save'));
check('Neu sendet Modus neu', neuMs && neuMs.body.modus === 'neu');
check('Neu sendet die Objekt-id', neuMs && neuMs.body.objekt_id === 1);
check('Neu sendet keine id', neuMs && !('id' in neuMs.body));

// ══════════ VORSCHAU VOR DEM MASSENBEFEHL
await page.waitForTimeout(300);
calls = [];
await page.click('#drBody button:has-text("Schichten erzeugen")');
await page.waitForSelector('#dlgVorschau.on');
await page.waitForTimeout(500);
check('Vorschau ruft den Vorschau-Endpunkt', calls.some(c => c.path.includes('schichten_vorschau')));
check('KRITISCH: Vorschau schreibt nichts', writes().length === 0);
const vs = await page.textContent('#vsInhalt');
check('Vorschau nennt die Anzahl', vs.includes('23 neu'));
check('Vorschau nennt bereits Vorhandenes', vs.includes('4 schon vorhanden'));
check('Vorschau nennt die Vorlagen', vs.includes('2 Vorlagen'));
check('Vorschau nennt Feiertage im Zeitraum', vs.includes('1 Feiertage'));
check('Vorschau zeigt einzelne Schichten', vs.includes('Schliessrunde') && vs.includes('22:00–22:30'));
check('Vorschau kennzeichnet provisorische', vs.includes('provisorisch'));
check('Vorschau kennzeichnet den Feiertag', vs.includes('Testfeiertag'));
check('Kuerzung wird offengelegt statt verschwiegen', vs.includes('Gezeigt sind die ersten 2 von 23'));
check('Knopf nennt die Zahl', (await page.textContent('#vsBtn')).includes('23 Schichten erzeugen'));
await page.screenshot({ path: `${OUT}/33-vorschau.png` });

calls = [];
await page.click('#vsBtn');
await page.waitForTimeout(500);
const erz = calls.find(c => c.path.includes('schichten_erzeugen'));
check('Erst nach Klick wird erzeugt', !!erz);
check('Genau ein Schreibaufruf', writes().length === 1);
check('Erzeugen sendet Objekt und Zeitraum', erz && erz.body.objekt_id === 1 && !!erz.body.von && !!erz.body.bis);
check('Vorschau schliesst nach dem Erzeugen', !(await page.isVisible('#dlgVorschau.on')));

// ══════════ FEIERTAGE
await page.waitForTimeout(300);
check('Objekt-Schublade bleibt nach dem Erzeugen offen', await page.isVisible('#drawer.on'));
await page.evaluate(() => closeDrawer());
await page.waitForTimeout(300);
// Feiertage haengen an der Planung, nicht an Kunden -- zurueck navigieren.
await page.click('#nav-planung');
await page.waitForTimeout(200);
await page.click('#ptab-uebersicht');
await page.waitForTimeout(200);
calls = [];
// Seit ENT-038 auf der Reiter-Trennlinie, reiterübergreifend statt nur hier.
await page.click('.tabs button:has-text("Feiertage")');
await page.waitForSelector('#dlgFeiertage.on');
await page.waitForTimeout(400);
check('Feiertagsdialog laedt die Liste', calls.some(c => c.path.includes('feiertage_list')));
check('Feiertagsdialog schreibt nichts', writes().length === 0);
const ft = await page.textContent('#ftInhalt');
check('Halber Feiertag wird als solcher gezeigt', ft.includes('ab 12:00'));
check('Ganzer Feiertag wird unterschieden', ft.includes('ganzer Tag'));
check('Quelle wird genannt', ft.includes('Arbeitsinspektorat'));
check('Nicht enthaltene Tage werden benannt', ft.includes('Berchtoldstag') && ft.includes('GAV-AUS-006'));
check('Dialogkopf grenzt gegen Lohnaussagen ab', (await page.textContent('#dlgFeiertage .dlg-hd')).includes('nicht'));
calls = [];
await page.click('#dlgFeiertage button:has-text("Jahr eintragen")');
await page.waitForTimeout(400);
const gen = calls.find(c => c.path.includes('feiertage_generieren'));
check('Eintragen ruft den Generator', gen && gen.body.kanton === 'SO');
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

// ══════════ MOBIL
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
const scrollX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check('Kein Seiten-Scroll auf 390px trotz Matrix', scrollX <= 1);
await page.screenshot({ path: `${OUT}/34-matrix-mobil.png` });
await page.setViewportSize({ width: 1440, height: 1000 });

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
