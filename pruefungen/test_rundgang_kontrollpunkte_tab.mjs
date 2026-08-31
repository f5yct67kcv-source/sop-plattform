// Kontrollrunden-Seite: Reiter "Kontrollpunkte" (Filterliste ALLER
// Kontrollpunkte des Objekts) und "Kartenansicht" (Uebersichtskarte aller
// GPS-Punkte, ENT-259).
//
// Anlass: Referenz-Screenshots eines Fremdsystems (Filterliste mit Typ/
// Name/Tag-Identifikator-Spalten samt "+ GPS-Punkt / Geofence anlegen",
// und eine Kartenansicht mit "GPS-Punkt anlegen"/"Geofence anlegen").
// Klaerung mit dem Projektinhaber: "GPS-Punkt" = unser bestehender Typ
// "geofence" (Kreis mit Radius, kein neues Datenmodell). "Geofence-Bereich"
// (freies Vieleck, mehrere Ecken) ist ein NEUER, hier noch nicht gebauter
// Kontrollpunkt-Typ -- der Knopf dafuer zeigt bewusst nur einen Hinweis,
// kein erfundenes Zeichenwerkzeug. NFC-Punkte werden laut Projektinhaber
// kuenftig per Smartphone-Scan erfasst, nicht ueber diese Karte -- "+
// GPS-Punkt anlegen" oeffnet darum den bestehenden Kontrollpunkt-Dialog
// direkt mit Typ Geofence vorbelegt, nicht mit dem sonst ueblichen NFC.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const SEITE = `file://${WURZEL}/dashboard.html`;
const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

// Kleinste gueltige PNG-Datei (1x1, transparent) als Kachel-Ersatz --
// echte Netzwerkzugriffe auf OpenStreetMap waeren in einer automatisierten
// Pruefung weder zuverlaessig noch angemessen (gleiches Vorgehen wie
// test_kontrollpunkt_karte.mjs).
const KACHEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64');

const OBJEKTE = { status: 'ok', objekte: [
  { id: 1, kunde_id: 1, kunde_name: 'Muster Liegenschaften AG', name: 'Testliegenschaft Nord', strasse: 'Testweg 1',
    ort: '9999 Beispielhausen', kanton: 'SO', einsatzart: 'Revierdienst', aktiv: 1, bemerkung: null,
    masterschichten: 0, stunden_je_einsatz: 0 },
]};

const KONTROLLPUNKTE = { status: 'ok', kontrollpunkte: [
  { id: 1, objekt_id: 1, bezeichnung: 'Hintereingang', reihenfolge: 1, typ: 'nfc', chip_id: 'AB12',
    lat: null, lng: null, geofence_radius_m: 20, aktiv: 1 },
  { id: 2, objekt_id: 1, bezeichnung: 'Parkplatz', reihenfolge: 2, typ: 'geofence', chip_id: null,
    lat: 47.37690, lng: 8.54170, geofence_radius_m: 35, aktiv: 1 },
  { id: 3, objekt_id: 1, bezeichnung: 'Tor Süd', reihenfolge: 3, typ: 'geofence', chip_id: null,
    lat: 47.37820, lng: 8.54350, geofence_radius_m: 15, aktiv: 0 },
]};

const VORLAGEN_ALLE = { status: 'ok', vorlagen: [
  { id: 10, objekt_id: 1, kunde_name: 'Muster Liegenschaften AG', objekt_name: 'Testliegenschaft Nord',
    name: 'Öffnungsrunde', beschreibung: '', aktiv: 1, erstellt_am: '2026-01-01 00:00:00', punkte: [] },
]};

let calls = [];

function setup(page) {
  page.route('**/*.tile.openstreetmap.org/**', route =>
    route.fulfill({ status: 200, contentType: 'image/png', body: KACHEL_PNG }));
  return page.route('**/api/**', async route => {
    const req = route.request();
    const u = new URL(req.url());
    const path = u.pathname.split('/api/')[1];
    let body = null;
    try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch {}
    calls.push({ path, body });
    const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (path.includes('login')) return send({ status: 'ok', token: 't', name: 'adrian', ist_admin: true });
    if (path.includes('dashboard_stats')) return send({ status: 'ok', kpi: {}, verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [] });
    if (path.includes('objekte_revierdienst')) return send(OBJEKTE);
    if (path.includes('rundgang_vorlage_liste_alle')) return send(VORLAGEN_ALLE);
    if (path.includes('rundgang_liste')) return send({ status: 'ok', rundgaenge: [] });
    if (path.includes('revierdienst_status')) return send({ status: 'ok', leute: [] });
    if (path.includes('kontrollpunkt_liste')) return send(KONTROLLPUNKTE);
    if (path.includes('kontrollpunkt_save')) return send({ status: 'ok', id: 99 });
    if (path.includes('kontrollpunkt_loeschen')) return send({ status: 'ok' });
    if (path.includes('rundgang_vorlage_liste')) return send({ status: 'ok', vorlagen: [] });
    return send({ status: 'ok' });
  });
}

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));

setup(page);
await page.goto(SEITE);
await page.evaluate(() => localStorage.clear());
await page.goto(SEITE);
await page.fill('#gName', 'adrian'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#kpiGrid .kpi-val');
await page.evaluate(() => go('rundgaenge'));
await page.waitForSelector('#view-rundgaenge.on');
await page.click('#view-rundgaenge .bk-kachel:has-text("Rundgänge")');
await page.waitForSelector('#rdAb-liste table');
await page.click('#rdAb-liste tr:has-text("Öffnungsrunde") button:has-text("Bearbeiten")');
await page.waitForFunction(() => document.getElementById('rdAb-kr').style.display !== 'none');
await page.waitForTimeout(200);

// ══════════ KONTROLLPUNKTE-KACHEL: TABELLE MIT ALLEN PUNKTEN DES OBJEKTS
await page.click('#rdKrReiter .rdkr-tab:has-text("Kontrollpunkte")');
await page.waitForTimeout(200);
check('KRITISCH: das Formular (Reiter "Allgemeines") wird ausgeblendet', !(await page.isVisible('#rdKrAb-allgemeines')));
check('KRITISCH (ENT-260): die Reiterleiste bleibt dabei stehen', await page.isVisible('#rdKrReiter'));
check('KRITISCH: alle drei Kontrollpunkte des Objekts stehen da, nicht nur die dieser Runde',
  (await page.$$('#rdKpTabelle tbody tr')).length === 3);
const tabelleText = await page.textContent('#rdKpTabelle');
check('NFC-Punkt mit Tag-Identifikator (Chip-ID) erscheint', tabelleText.includes('Hintereingang') && tabelleText.includes('AB12'));
check('Geofence-Punkt ohne Tag-Identifikator zeigt einen Strich, keine leere Zelle', /Parkplatz[\s\S]*?–/.test(tabelleText));
check('Nicht aktiver Punkt ist gekennzeichnet', tabelleText.includes('nicht aktiv'));

// ══════════ FILTER: NAME
await page.fill('#rdKpFilterName', 'Parkplatz');
await page.waitForTimeout(100);
check('KRITISCH: Namensfilter engt die Liste ein', (await page.$$('#rdKpTabelle tbody tr')).length === 1);
await page.fill('#rdKpFilterName', '');

// ══════════ FILTER: TYP
await page.selectOption('#rdKpFilterTyp', 'geofence');
await page.waitForTimeout(100);
check('KRITISCH: Typfilter "Geofence" zeigt nur die zwei Geofence-Punkte', (await page.$$('#rdKpTabelle tbody tr')).length === 2);
await page.selectOption('#rdKpFilterTyp', 'nfc');
await page.waitForTimeout(100);
check('KRITISCH: Typfilter "NFC" zeigt nur den einen NFC-Punkt', (await page.$$('#rdKpTabelle tbody tr')).length === 1);
await page.selectOption('#rdKpFilterTyp', '');

// ══════════ FILTER: TAG IDENTIFIKATOR
await page.fill('#rdKpFilterTag', 'AB12');
await page.waitForTimeout(100);
check('KRITISCH: Filter nach Tag Identifikator engt die Liste ein', (await page.$$('#rdKpTabelle tbody tr')).length === 1);
await page.fill('#rdKpFilterTag', 'nicht-vorhanden');
await page.waitForTimeout(100);
check('KRITISCH: kein Treffer sagt das explizit, nicht wie eine leere Tabelle', (await page.textContent('#rdKpTabelle')).includes('Kein Treffer'));
await page.fill('#rdKpFilterTag', '');
await page.waitForTimeout(100);

// ══════════ CTA: "+ GPS-PUNKT / GEOFENCE ANLEGEN" WECHSELT NUR DEN REITER
await page.click('button:has-text("+ GPS-Punkt / Geofence anlegen")');
await page.waitForTimeout(300);
check('KRITISCH: der Klick öffnet KEINEN Dialog, sondern wechselt zur Kartenansicht',
  await page.isVisible('#rdKrAb-karte') && !(await page.isVisible('#dlgKp.on')));
check('Die Kontrollpunkte-Tabelle ist dabei ausgeblendet', !(await page.isVisible('#rdKrAb-kontrollpunkte')));

// ══════════ KARTENANSICHT: ALLE GEOFENCE-PUNKTE ALS KREIS+MARKER
await page.waitForSelector('#rdKarteUebersicht.leaflet-container');
await page.waitForTimeout(200);
check('KRITISCH: beide Geofence-Punkte erscheinen als Marker auf der Karte (der NFC-Punkt nicht, er hat keinen Ort)',
  (await page.$$('#rdKarteUebersicht .leaflet-marker-icon')).length === 2);
// .leaflet-interactive traegt sowohl die Kreise (SVG-<path>) als auch die
// Marker-Symbole selbst (Leaflet-Standardmarker sind anklickbar) -- auf
// <path> eingeschraenkt, um wirklich nur die Kreise zu zaehlen.
check('Je ein Geofence-Kreis pro Punkt', (await page.$$('#rdKarteUebersicht path.leaflet-interactive')).length === 2);
check('KRITISCH: der Marker nutzt das selbst ausgelieferte Symbol, kein kaputtes Bild (ENT-248)',
  await page.$eval('#rdKarteUebersicht .leaflet-marker-icon', img => img.complete && img.naturalWidth > 0));
await page.screenshot({ path: `${OUT}/rg-kp-tab-01-kartenansicht.png` });

// ══════════ ENT-260: LISTEN LINKS, CTA UEBER DER KARTE, DETAIL RECHTS
// (Aufbau nach dem Referenzbild des Projektinhabers.)
check('KRITISCH: links neben der Karte stehen beide GPS-Punkte namentlich',
  (await page.textContent('#rdKartePunkteListe')).includes('Parkplatz')
  && (await page.textContent('#rdKartePunkteListe')).includes('Tor Süd'));
check('Der NFC-Punkt steht NICHT in der GPS-Punkte-Liste (er hat keinen Ort)',
  !(await page.textContent('#rdKartePunkteListe')).includes('Hintereingang'));
check('Die Geofence-Bereiche-Liste sagt ausdrücklich, dass es noch keine gibt',
  (await page.textContent('#rdKarteBereiche')).includes('Keine Einträge vorhanden'));

const ctaBox = await page.$eval('.rdkarte-cta', el => el.getBoundingClientRect());
const karteBox = await page.$eval('#rdKarteUebersicht', el => el.getBoundingClientRect());
check('KRITISCH: die beiden Anlegen-Knöpfe liegen oben rechts ÜBER der Karte (gemessen, nicht angenommen)',
  ctaBox.top >= karteBox.top && ctaBox.top < karteBox.top + 60
  && ctaBox.right <= karteBox.right + 1 && karteBox.right - ctaBox.right < 40);
const listeBox = await page.$eval('#rdKartePunkteListe', el => el.getBoundingClientRect());
check('KRITISCH: die Listen stehen links NEBEN der Karte, nicht darüber', listeBox.right <= karteBox.left + 1);

// Suche in der GPS-Punkte-Liste
await page.fill('#rdKarteSuche', 'Tor');
await page.waitForTimeout(100);
check('KRITISCH: die Suche engt die GPS-Punkte-Liste ein',
  (await page.$$('#rdKartePunkteListe .rdkarte-eintrag')).length === 1);
await page.fill('#rdKarteSuche', 'gibtesnicht');
await page.waitForTimeout(100);
check('"Kein Treffer" und "noch keiner angelegt" bleiben unterscheidbar',
  (await page.textContent('#rdKartePunkteListe')).includes('Kein Treffer'));
await page.fill('#rdKarteSuche', '');
await page.waitForTimeout(100);

// Klick auf einen Punkt AUF DER KARTE oeffnet das Detailfenster rechts
check('Vor dem Klick ist das Detailfenster zu', !(await page.isVisible('#rdKarteDetail')));
await page.click('#rdKarteUebersicht .leaflet-marker-icon');
await page.waitForTimeout(250);
check('KRITISCH: der Klick auf einen GPS-Punkt öffnet rechts das Detailfenster',
  await page.isVisible('#rdKarteDetail'));
const detailBox = await page.$eval('#rdKarteDetail', el => el.getBoundingClientRect());
const karteBox2 = await page.$eval('#rdKarteUebersicht', el => el.getBoundingClientRect());
check('KRITISCH: das Detailfenster steht rechts NEBEN der Karte', detailBox.left >= karteBox2.right - 1);
check('Es zeigt den Namen des angeklickten Punktes', (await page.textContent('#rdKarteDetailTitel')) === 'Parkplatz');
const detailText = await page.textContent('#rdKarteDetailInhalt');
check('KRITISCH: es zeigt Koordinaten und Radius des Punktes',
  detailText.includes('47.376') && detailText.includes('8.541') && detailText.includes('35'));
check('Der zugehörige Listeneintrag links ist markiert',
  await page.evaluate(() => document.querySelector('#rdKartePunkteListe .rdkarte-eintrag.aktiv')?.textContent.trim() === 'Parkplatz'));

// Klick auf einen Listeneintrag links waehlt ebenso aus
await page.click('#rdKartePunkteListe .rdkarte-eintrag:has-text("Tor Süd")');
await page.waitForTimeout(250);
check('KRITISCH: auch der Klick in der Liste links öffnet denselben Detailbereich',
  (await page.textContent('#rdKarteDetailTitel')) === 'Tor Süd');

// Bearbeiten fuehrt in den bestehenden, bereits geprueften Dialog
await page.click('#rdKarteDetailInhalt button:has-text("Bearbeiten")');
await page.waitForSelector('#dlgKp.on');
check('KRITISCH: "Bearbeiten" öffnet den bestehenden Kontrollpunkt-Dialog mit DIESEM Punkt',
  (await page.inputValue('#kpBezeichnung')) === 'Tor Süd');
await page.click('#dlgKp .dlg-ft .btn-plain');
await page.waitForTimeout(150);

await page.click('#rdKarteDetail button:has-text("Schliessen")');
await page.waitForTimeout(200);
check('Das Detailfenster lässt sich wieder schliessen', !(await page.isVisible('#rdKarteDetail')));

// ══════════ "+ GPS-PUNKT ANLEGEN": BESTEHENDER DIALOG, TYP GEOFENCE VORBELEGT
await page.click('#rdKrAb-karte button:has-text("+ GPS-Punkt anlegen")');
await page.waitForSelector('#dlgKp.on');
check('KRITISCH: der Dialog öffnet mit Typ Geofence vorbelegt, nicht mit dem sonst üblichen NFC',
  (await page.inputValue('#kpTyp')) === 'geofence');
check('Die Kartenauswahl (ENT-248) ist darin sichtbar', await page.isVisible('#kpKarte'));
await page.click('#dlgKp .dlg-ft .btn-plain');
await page.waitForTimeout(150);
check('Der Dialog schliesst wieder, die Kartenansicht bleibt darunter', !(await page.isVisible('#dlgKp.on')) && await page.isVisible('#rdKrAb-karte'));

// ══════════ "GEOFENCE-BEREICH ANLEGEN": HINWEIS STATT ERFUNDENEM WERKZEUG
// (Vieleck-Zeichenwerkzeug ist noch nicht gebaut, siehe Kopfkommentar.)
await page.click('#rdKrAb-karte button:has-text("Geofence-Bereich anlegen")');
await page.waitForTimeout(150);
check('KRITISCH: statt eines nicht existierenden Zeichenwerkzeugs erscheint ein Hinweis',
  await page.evaluate(() => document.getElementById('toast').classList.contains('on')));

// ══════════ ENT-260: DER WECHSEL LAEUFT UEBER DIE REITER, NICHT UEBER ZURUECK
check('KRITISCH: auf der Kartenansicht steht nur noch EIN Zurück-Knopf (der zur Liste)',
  await page.evaluate(() => document.querySelectorAll('#rdAb-kr .bk-zurueck').length === 1));
await page.click('#rdKrReiter .rdkr-tab:has-text("Allgemeines")');
await page.waitForTimeout(150);
check('KRITISCH: über den Reiter "Allgemeines" kommt man zum Formular, nicht zur Liste',
  await page.isVisible('#rdKrAb-allgemeines') && await page.isVisible('#rdAb-kr') && !(await page.isVisible('#rdAb-liste')));

// ══════════ NEUER PUNKT ZIEHT DIE TABELLE UND DIE KARTE SOFORT NACH
await page.click('#rdKrReiter .rdkr-tab:has-text("Kontrollpunkte")');
await page.waitForTimeout(150);
await page.click('button:has-text("+ GPS-Punkt / Geofence anlegen")');
await page.waitForTimeout(150);
await page.click('#rdKrAb-karte button:has-text("+ GPS-Punkt anlegen")');
await page.waitForSelector('#dlgKp.on');
await page.fill('#kpBezeichnung', 'Nordtor');
await page.fill('#kpLat', '47.38');
await page.fill('#kpLng', '8.55');
KONTROLLPUNKTE.kontrollpunkte.push(
  { id: 4, objekt_id: 1, bezeichnung: 'Nordtor', reihenfolge: 4, typ: 'geofence', chip_id: null, lat: 47.38, lng: 8.55, geofence_radius_m: 20, aktiv: 1 });
await page.click('#kpBtn');
await page.waitForTimeout(300);
check('KRITISCH: die Karte zeigt den neuen Punkt sofort, ohne den Reiter neu zu öffnen',
  (await page.$$('#rdKarteUebersicht .leaflet-marker-icon')).length === 3);
await page.click('#rdKrReiter .rdkr-tab:has-text("Kontrollpunkte")');
await page.waitForTimeout(150);
check('KRITISCH: auch die Tabelle zeigt den neuen Punkt sofort', (await page.$$('#rdKpTabelle tbody tr')).length === 4);
check('KRITISCH: der Anzahl-Chip am Reiter zieht ebenfalls nach (4)',
  (await page.textContent('#rdKrKpBadge')).trim() === '4');
KONTROLLPUNKTE.kontrollpunkte.pop();

// ══════════ HANDY: BEIDE REITER ZUSAETZLICH GEPRUEFT (CLAUDE.md)
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(200);
check('KRITISCH: kein Seiten-Scroll auf der Kontrollpunkte-Tabelle bei 390px', await page.evaluate(() =>
  document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
await page.screenshot({ path: `${OUT}/rg-kp-tab-02-mobil.png` });
await page.click('button:has-text("+ GPS-Punkt / Geofence anlegen")');
await page.waitForSelector('#rdKarteUebersicht.leaflet-container');
await page.evaluate(() => rdKarteMapa.invalidateSize());
await page.waitForTimeout(200);
const karteBreite = await page.$eval('#rdKarteUebersicht', el => el.getBoundingClientRect().width);
check('KRITISCH: die Karte überragt den Bildschirm auf dem Handy nicht (gemessen, nicht angenommen)',
  karteBreite <= 390 + 1);
await page.screenshot({ path: `${OUT}/rg-kp-tab-03-karte-mobil.png` });
await page.setViewportSize({ width: 1440, height: 1000 });

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
