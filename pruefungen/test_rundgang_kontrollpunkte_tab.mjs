// Kontrollrunden-Seite: Reiter "Kontrollpunkte" (Filterliste ALLER
// Kontrollpunkte des Objekts) und "Kartenansicht" (Uebersichtskarte aller
// GPS-Punkte, ENT-259).
//
// Anlass: Referenz-Screenshots eines Fremdsystems (Filterliste mit Typ/
// Name/Tag-Identifikator-Spalten samt "+ Kontrollpunkt anlegen",
// und eine Kartenansicht mit "GPS-Punkt anlegen"/"Geofence anlegen").
// Klaerung mit dem Projektinhaber: "GPS-Punkt" = unser bestehender Typ
// "geofence" (Kreis mit Radius, kein neues Datenmodell). "Geofence-Bereich"
// (freies Vieleck, mehrere Ecken) ist eine EIGENSTAENDIGE Tabelle, keine
// Erweiterung des Kontrollpunkt-Typs -- der Knopf dafuer zeigte bis ENT-286
// nur einen Hinweis statt eines erfundenen Zeichenwerkzeugs; das eigentliche
// Zeichnen/Anlegen/Umbenennen/Loeschen wird seither in der eigenen Suite
// test_geofence_bereich.mjs geprueft, nicht hier -- diese Datei prueft nur
// noch, dass der Knopf den Zeichnen-Modus ueberhaupt startet, ohne die
// GPS-Punkte-Bedienung dieser Suite zu stoeren. NFC-Punkte werden laut
// Projektinhaber
// kuenftig per Smartphone-Scan erfasst, nicht ueber diese Karte -- "+
// GPS-Punkt anlegen" oeffnet darum den bestehenden Kontrollpunkt-Dialog
// direkt mit Typ Geofence vorbelegt, nicht mit dem sonst ueblichen NFC.
//
// ENT-269: Google Maps statt Leaflet/OpenStreetMap (Revision von ENT-248,
// ausdruecklicher Wunsch des Projektinhabers). Das Testdouble aus
// google_maps_mock.mjs ersetzt die echte Google-Maps-API -- der Testbrowser
// in dieser Sandbox hat kein echtes Internet (auch nicht ueber den
// Sitzungs-Proxy, geprueft), und selbst wenn: automatisierte Anfragen gegen
// einen echten, kostenpflichtigen Google-Dienst waeren hier weder
// zuverlaessig noch angemessen.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { GOOGLE_MAPS_MOCK } from './google_maps_mock.mjs';
import { chromium } from 'playwright';

const SEITE = `file://${WURZEL}/dashboard.html`;
const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const OBJEKTE = { status: 'ok', objekte: [
  { id: 1, kunde_id: 1, kunde_name: 'Muster Liegenschaften AG', name: 'Testliegenschaft Nord', strasse: 'Testweg 1',
    ort: '9999 Beispielhausen', kanton: 'SO', einsatzart: 'Revierdienst', aktiv: 1, bemerkung: null,
    masterschichten: 0, stunden_je_einsatz: 0 },
]};

const KONTROLLPUNKTE = { status: 'ok', kontrollpunkte: [
  { id: 1, objekt_id: 1, bezeichnung: 'Hintereingang', beschreibung: null, reihenfolge: 1, typ: 'nfc', chip_id: 'AB12',
    lat: null, lng: null, geofence_radius_m: 20, aktiv: 1, bereichszeit_beginn: 0, bereichszeit_ende: 0 },
  { id: 2, objekt_id: 1, bezeichnung: 'Parkplatz', beschreibung: null, reihenfolge: 2, typ: 'geofence', chip_id: null,
    lat: 47.37690, lng: 8.54170, geofence_radius_m: 35, aktiv: 1, bereichszeit_beginn: 0, bereichszeit_ende: 0 },
  // "Tor Süd" traegt den Bereichszeit-Beginn -- damit prueft die Suite, dass
  // der gespeicherte Stand der Schalter wirklich uebernommen wird (ENT-265).
  { id: 3, objekt_id: 1, bezeichnung: 'Tor Süd', beschreibung: null, reihenfolge: 3, typ: 'geofence', chip_id: null,
    lat: 47.37820, lng: 8.54350, geofence_radius_m: 15, aktiv: 0, bereichszeit_beginn: 1, bereichszeit_ende: 0 },
]};

const VORLAGEN_ALLE = { status: 'ok', vorlagen: [
  { id: 10, objekt_id: 1, kunde_name: 'Muster Liegenschaften AG', objekt_name: 'Testliegenschaft Nord',
    name: 'Öffnungsrunde', beschreibung: '', aktiv: 1, erstellt_am: '2026-01-01 00:00:00', punkte: [] },
]};

let calls = [];

// Aufgabenkatalog des Objekts (ENT-302). Bewusst veraenderlich: Legt die
// Oberflaeche eine Aufgabe an, muss sie danach auch in der Liste stehen --
// eine feste Antwort haette das nie gezeigt.
const AUFGABEN = {
  status: 'ok', eingerichtet: true,
  aufgaben: [
    { id: 11, objekt_id: 1, bezeichnung: 'Türe verschliessen', information: 'Panikschloss beachten', aktiv: 1 },
    { id: 12, objekt_id: 1, bezeichnung: 'Sichtkontrolle Fenster', information: null, aktiv: 1 },
  ],
  zuordnung: { 2: [11] },
};
let aufgabeNaechsteId = 13;
let gesetzt = null;   // letzter Aufruf von kontrollpunkt_aufgaben_setzen

const NOMINATIM_TREFFER = [
  { display_name: 'Industriestrasse 44, 4600 Olten, Schweiz', lat: '47.37820', lon: '7.91270' },
  { display_name: 'Industriestrasse 12, 8005 Zürich, Schweiz', lat: '47.39000', lon: '8.52000' },
];

function setup(page) {
  // Echte Netzwerkzugriffe auf den fremden Nominatim-Dienst waeren in einer
  // automatisierten Pruefung weder zuverlaessig noch angemessen (ENT-267).
  page.route('**/nominatim.openstreetmap.org/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(NOMINATIM_TREFFER) }));
  page.route('**/api/**', async route => {
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
    // Echte Antwort nachstellen: Beim Aendern gibt der Server dieselbe id
    // zurueck, beim Anlegen die neue. Eine feste Fantasie-id waehlt im
    // Fenster sonst einen Punkt aus, den es nicht gibt.
    if (path.includes('kontrollpunkt_save')) {
      const letzte = KONTROLLPUNKTE.kontrollpunkte[KONTROLLPUNKTE.kontrollpunkte.length - 1];
      return send({ status: 'ok', id: (body && body.id) ? body.id : letzte.id });
    }
    if (path.includes('kontrollpunkt_loeschen')) return send({ status: 'ok' });
    if (path.includes('aufgabe_liste')) return send(AUFGABEN);
    if (path.includes('aufgabe_save')) {
      const id = aufgabeNaechsteId++;
      AUFGABEN.aufgaben.push({ id, objekt_id: 1, bezeichnung: body.bezeichnung,
        information: body.information || null, aktiv: 1 });
      return send({ status: 'ok', id });
    }
    if (path.includes('kontrollpunkt_aufgaben_setzen')) {
      gesetzt = body;
      return send({ status: 'ok', gesetzt: body.aufgabe_ids, abgewiesen: [] });
    }
    if (path.includes('rundgang_vorlage_liste')) return send({ status: 'ok', vorlagen: [] });
    return send({ status: 'ok' });
  });
  // Reihenfolge wichtig (ENT-269): Playwright ruft bei mehreren passenden
  // Routen die zuletzt registrierte zuerst auf. "**/api/**" trifft wegen des
  // Pfadstuecks "/maps/api/js" auch auf Google Maps selbst zu -- die
  // host-genaue Maps-Route muss darum NACH der allgemeinen "/api/"-Route
  // registriert werden, sonst faengt Letztere die Maps-Anfrage faelschlich
  // ab und liefert JSON statt JavaScript aus.
  return page.route('**/maps.googleapis.com/**', route =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: GOOGLE_MAPS_MOCK }));
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

// ══════════ CTA: "+ KONTROLLPUNKT ANLEGEN" ÖFFNET DAS FENSTER AN ORT UND STELLE
// Bis ENT-302 wechselte dieser Knopf zur Kartenansicht -- dort lag das
// einzige Bearbeitungsfenster. Jetzt steht dasselbe Fenster auch neben der
// Liste, also gibt es keinen Grund mehr, den Reiter zu verlassen.
await page.click('button:has-text("+ Kontrollpunkt anlegen")');
await page.waitForTimeout(300);
check('KRITISCH: der Klick öffnet KEINEN Dialog', !(await page.isVisible('#dlgKp.on')));
check('KRITISCH: das Kontrollpunkt-Fenster steht offen', await page.isVisible('#rdKarteDetail'));
check('KRITISCH: es steht neben der LISTE, nicht in der Kartenansicht',
  await page.evaluate(() => !!document.getElementById('rdKpRaum')
    .contains(document.getElementById('rdKarteDetail'))));
check('Die Kontrollpunkte-Liste bleibt dabei sichtbar', await page.isVisible('#rdKrAb-kontrollpunkte'));
check('Die Liste bekommt daneben eine zweite Spalte',
  await page.evaluate(() => document.getElementById('rdKpRaum').classList.contains('mit-detail')));
await page.click('#rdKarteDetail .card-hd button:has-text("Schliessen")');
await page.waitForTimeout(200);
check('Schliessen räumt die zweite Spalte wieder weg -- eine leere Spalte sieht aus wie ein Ladefehler',
  await page.evaluate(() => !document.getElementById('rdKpRaum').classList.contains('mit-detail')));

// Alles Folgende haengt daran, dass sich das Fenster ueberhaupt oeffnet.
// Ohne dieses Netz endete die Suite beim Gegenproben mit einem
// Playwright-Stapelauszug: Man sah, DASS etwas kaputt ist, aber nicht,
// welche Aussage nicht mehr gilt.
try {
  // ══════════ ENT-302: JEDE ZEILE ÖFFNET DAS FENSTER, AUCH DER NFC-PUNKT
  // Bis hierher fuehrte ein Knopf "Bearbeiten" in einen modalen Dialog, und
  // das Fenster gab es nur fuer GPS-Punkte. Verlangt ist: jeder Punkt
  // anklickbar, dasselbe Fenster, an beiden Orten.
  await page.click('#rdKpTabelle tbody tr:has-text("Hintereingang")');
  await page.waitForTimeout(300);
  // Bleibt das Fenster zu, hat das Tippen in seine Felder keinen Sinn -- und
  // eine Suite, die daran abstuerzt, sagt nur DASS etwas kaputt ist, nicht
  // welche Aussage nicht mehr gilt. Beim Gegenprobieren genau so aufgefallen.
  const fensterAuf = await page.isVisible('#rdKarteDetail');
  check('KRITISCH: ein Klick auf die Zeile öffnet das Fenster', fensterAuf);
  check('KRITISCH: kein modaler Dialog mehr', !(await page.isVisible('#dlgKp.on')));
  check('KRITISCH: auch ein NFC-Punkt lässt sich hier öffnen — nicht nur GPS-Punkte',
    (await page.inputValue('#rdKdTyp')) === 'nfc');
  check('Die Chip-ID steht im Fenster', (await page.inputValue('#rdKdChipId')) === 'AB12');
  check('Beim NFC-Punkt ist das Chip-Feld sichtbar', await page.isVisible('#rdKdNfcFeld'));
  check('KRITISCH: und die Koordinatenfelder sind es NICHT — ein Chip hat keinen Ort',
    !(await page.isVisible('#rdKdLat')));
  check('Name und Beschreibung sind bearbeitbar',
    (await page.inputValue('#rdKdName')) === 'Hintereingang' && await page.isVisible('#rdKdBeschreibung'));
  check('Die offene Zeile ist in der Liste hervorgehoben',
    await page.evaluate(() => !!document.querySelector('#rdKpTabelle tr.gewaehlt')));

  // Umbenennen und beschreiben geht jetzt aus der Liste heraus.
  calls.length = 0;
  if (fensterAuf) {
    await page.fill('#rdKdName', 'Hintereingang Nord');
    await page.fill('#rdKdBeschreibung', 'Chip klebt innen am Rahmen');
    await page.click('#rdKdSpeichern');
    await page.waitForTimeout(400);
  }
  const gespeichert = calls.find(c => c.path.includes('kontrollpunkt_save'));
  check('KRITISCH: Umbenennen aus der Liste heraus wird gesendet',
    gespeichert && gespeichert.body.bezeichnung === 'Hintereingang Nord');
  check('KRITISCH: die Beschreibung ebenfalls — sie war im alten Dialog gar nicht erfassbar',
    gespeichert && gespeichert.body.beschreibung === 'Chip klebt innen am Rahmen');
  check('Der Typ bleibt NFC und wird nicht stillschweigend zu Geofence',
    gespeichert && gespeichert.body.typ === 'nfc');

  // ══════════ ENT-302: AUFGABEN AM KONTROLLPUNKT
  await page.click('#rdKpTabelle tbody tr:has-text("Parkplatz")');
  await page.waitForTimeout(300);
  await page.click('#rdKdReiterAufg');
  await page.waitForTimeout(300);
  check('KRITISCH: der Reiter "Aufgaben" ist kein Platzhalter mehr',
    !(await page.textContent('#rdKdAufgaben')).includes('Folgt in einem späteren Schritt'));
  check('KRITISCH: der Katalog des Objekts steht da',
    (await page.textContent('#rdKdAufListe')).includes('Türe verschliessen')
    && (await page.textContent('#rdKdAufListe')).includes('Sichtkontrolle Fenster'));
  check('KRITISCH: die bereits verknüpfte Aufgabe ist angehakt, die andere nicht',
    await page.evaluate(() => {
      const k = [...document.querySelectorAll('#rdKdAufListe .rdkd-auf')];
      const tuere = k.find(e => e.textContent.includes('Türe verschliessen'));
      const fenster = k.find(e => e.textContent.includes('Sichtkontrolle'));
      return tuere.querySelector('input').checked && !fenster.querySelector('input').checked;
    }));
  check('Die Zahl nennt beide Einheiten getrennt — Katalog und Verknüpfungen',
    /2 Aufgaben im Katalog/.test(await page.textContent('#rdKdAufZahl'))
    && /1 an diesem Punkt verknüpft/.test(await page.textContent('#rdKdAufZahl')));

  // Filter: greift, und ein leeres Ergebnis sagt etwas anderes als ein leerer Katalog.
  await page.fill('#rdKdAufFilter', 'Fenster');
  await page.waitForTimeout(150);
  check('Der Filter engt den Katalog ein',
    (await page.$$('#rdKdAufListe .rdkd-auf')).length === 1);
  check('KRITISCH: bei gefilterter Liste steht die Bezugsgrösse dabei',
    /1 von 2/.test(await page.textContent('#rdKdAufZahl')));
  await page.fill('#rdKdAufFilter', 'gibtesnicht');
  await page.waitForTimeout(150);
  check('KRITISCH: "Kein Treffer" sagt ausdrücklich, dass der Katalog nicht leer ist',
    (await page.textContent('#rdKdAufListe')).includes('Kein Treffer')
    && (await page.textContent('#rdKdAufListe')).includes('nicht leer'));
  await page.fill('#rdKdAufFilter', '');
  await page.waitForTimeout(150);

  // Neue Aufgabe anlegen: inline, ohne weiteren Dialog.
  await page.click('#rdKdAufgaben button:has-text("+ Aufgabe anlegen")');
  await page.waitForTimeout(150);
  check('Anlegen geschieht inline, nicht in einem weiteren Dialog',
    await page.isVisible('#rdKdAufNeu') && !(await page.isVisible('#dlgConfirm.on')));
  await page.fill('#rdKdAufName', 'Licht löschen');
  await page.fill('#rdKdAufInfo', 'Nur im Treppenhaus');
  await page.click('#rdKdAufNeu button:has-text("Anlegen")');
  await page.waitForTimeout(400);
  check('KRITISCH: die neue Aufgabe steht sofort in der Liste',
    (await page.textContent('#rdKdAufListe')).includes('Licht löschen'));
  check('KRITISCH: und ist gleich angehakt — man legt sie an, WEIL sie hierher gehört',
    await page.evaluate(() => [...document.querySelectorAll('#rdKdAufListe .rdkd-auf')]
      .find(e => e.textContent.includes('Licht löschen')).querySelector('input').checked));

  // Haken setzen und speichern -- die Verknüpfungen gehen mit dem Punkt weg.
  await page.evaluate(() => [...document.querySelectorAll('#rdKdAufListe .rdkd-auf')]
    .find(e => e.textContent.includes('Sichtkontrolle')).querySelector('input').click());
  await page.waitForTimeout(150);
  calls.length = 0;
  await page.click('#rdKdSpeichern');
  await page.waitForTimeout(500);
  const setzen = calls.find(c => c.path.includes('kontrollpunkt_aufgaben_setzen'));
  check('KRITISCH: beim Speichern gehen die Verknüpfungen an den Server', !!setzen);
  check('KRITISCH: und zwar alle drei angehakten, nicht nur die zuletzt geklickte',
    setzen && setzen.body.aufgabe_ids.length === 3
    && setzen.body.aufgabe_ids.includes(11) && setzen.body.aufgabe_ids.includes(12));
  check('Die Verknüpfung nennt den richtigen Kontrollpunkt — Parkplatz, nicht den zuletzt offenen',
    setzen && Number(setzen.body.kontrollpunkt_id) === 2);

  // ══════════ ENT-302: DAS FENSTER IST GROSS GENUG (gemessen, nicht angenommen)
  // Ausdrueckliche Vorgabe des Projektinhabers ("achte auf genug Grösse").
  // Vorher war die Spalte auf 340-420px gedeckelt; im Referenzbild nimmt das
  // Fenster rund die Haelfte des Fensters ein.
  {
    const mass = await page.evaluate(() => {
      const f = document.getElementById('rdKarteDetail').getBoundingClientRect();
      return { breite: f.width, seite: innerWidth,
               scroll: document.documentElement.scrollWidth > document.documentElement.clientWidth };
    });
    check(`KRITISCH: das Fenster ist mindestens 420 px breit (gemessen ${Math.round(mass.breite)} px)`,
      mass.breite >= 420);
    check('Es überragt den Bildschirm nicht', mass.breite <= mass.seite);
    check('Kein Seiten-Scroll durch das offene Fenster (1440px)', !mass.scroll);
  }

  // Auf dem Handy stapeln Liste und Fenster, statt in zwei zu schmale Spalten
  // zu zerfallen.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  {
    const handy = await page.evaluate(() => {
      const f = document.getElementById('rdKarteDetail').getBoundingClientRect();
      return { breite: f.width,
               spalten: getComputedStyle(document.getElementById('rdKpRaum')).gridTemplateColumns,
               scroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 };
    });
    check('KRITISCH: kein Seiten-Scroll auf dem Handy bei offenem Fenster', !handy.scroll);
    check(`Auf dem Handy steht das Fenster einspaltig (gemessen ${handy.spalten})`,
      handy.spalten.trim().split(/\s+/).length === 1);
    check(`Und nutzt dort die Breite (gemessen ${Math.round(handy.breite)} px von 390)`,
      handy.breite >= 320);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForTimeout(250);

  await page.click('#rdKarteDetail .card-hd button:has-text("Schliessen")');
  await page.waitForTimeout(200);
} catch (e) {
  bad.push('ENT-302 (Fenster und Aufgaben): abgebrochen -- '
    + String(e.message || e).split('\n')[0]);
}

// ══════════ KARTENANSICHT: ALLE GEOFENCE-PUNKTE ALS KREIS+MARKER
await page.click('#rdKrReiter .rdkr-tab:has-text("Kartenansicht")');
await page.waitForTimeout(300);
await page.waitForSelector('#rdKarteUebersicht.gm-mock-map');
await page.waitForTimeout(200);
check('KRITISCH: beide Geofence-Punkte erscheinen als Marker auf der Karte (der NFC-Punkt nicht, er hat keinen Ort)',
  (await page.$$('#rdKarteUebersicht .gm-mock-marker')).length === 2);
check('Je ein Geofence-Kreis pro Punkt', (await page.$$('#rdKarteUebersicht .gm-mock-circle')).length === 2);
await page.screenshot({ path: `${OUT}/rg-kp-tab-01-kartenansicht.png` });

// ══════════ ENT-260: LISTEN LINKS, CTA UEBER DER KARTE, DETAIL RECHTS
// (Aufbau nach dem Referenzbild des Projektinhabers.)
check('KRITISCH: links neben der Karte stehen beide GPS-Punkte namentlich',
  (await page.textContent('#rdKartePunkteListe')).includes('Parkplatz')
  && (await page.textContent('#rdKartePunkteListe')).includes('Tor Süd'));
check('Der NFC-Punkt steht NICHT in der GPS-Punkte-Liste (er hat keinen Ort)',
  !(await page.textContent('#rdKartePunkteListe')).includes('Hintereingang'));
check('Die Geofence-Bereiche-Liste sagt ausdrücklich, dass es noch keine gibt',
  (await page.textContent('#rdKarteBereiche')).includes('Noch kein Geofence-Bereich angelegt'));

const ctaBox = await page.$eval('.rdkarte-cta', el => el.getBoundingClientRect());
const karteBox = await page.$eval('#rdKarteUebersicht', el => el.getBoundingClientRect());
check('KRITISCH: die beiden Anlegen-Knöpfe liegen oben rechts ÜBER der Karte (gemessen, nicht angenommen)',
  ctaBox.top >= karteBox.top && ctaBox.top < karteBox.top + 60
  && ctaBox.right <= karteBox.right + 1 && karteBox.right - ctaBox.right < 40);
const listeBox = await page.$eval('#rdKartePunkteListe', el => el.getBoundingClientRect());
check('KRITISCH: die Listen stehen links NEBEN der Karte, nicht darüber', listeBox.right <= karteBox.left + 1);
// ENT-261: Karte nutzt die Bildschirmhoehe, Listenspalte reicht genauso weit
// hinunter -- am gerenderten Zustand gemessen, nicht im CSS nachgelesen.
const seiteBox = await page.$eval('.rdkarte-seite', el => el.getBoundingClientRect());
check('KRITISCH: die Karte nutzt die Bildschirmhöhe aus (deutlich höher als die früheren 520px)',
  karteBox.height > 600);
check('KRITISCH: die Listenspalte links endet auf derselben Höhe wie die Karte, nicht auf halbem Weg',
  Math.abs(seiteBox.bottom - karteBox.bottom) <= 2);

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
await page.click('#rdKarteUebersicht .gm-mock-marker');
await page.waitForTimeout(250);
check('KRITISCH: der Klick auf einen GPS-Punkt öffnet rechts das Detailfenster',
  await page.isVisible('#rdKarteDetail'));
const detailBox = await page.$eval('#rdKarteDetail', el => el.getBoundingClientRect());
const karteBox2 = await page.$eval('#rdKarteUebersicht', el => el.getBoundingClientRect());
check('KRITISCH: das Detailfenster steht rechts NEBEN der Karte', detailBox.left >= karteBox2.right - 1);
// ENT-265: "genügend breit und bis runtergezogen" (Vorgabe Projektinhaber) --
// am gerenderten Zustand gemessen, nicht im CSS nachgelesen.
check('KRITISCH: das Fenster ist breit genug für ein Formular (mindestens 340px)', detailBox.width >= 340);
check('KRITISCH: es reicht bis zur Kartenunterkante und steht nicht tiefer',
  Math.abs(detailBox.bottom - karteBox2.bottom) <= 2);
check('Es zeigt den Namen des angeklickten Punktes', (await page.textContent('#rdKarteDetailTitel')) === 'Parkplatz');
// ENT-265: Das Fenster ist das Formular selbst -- kein eigener Dialog mehr.
check('KRITISCH: das Fenster ist ein Formular, kein Dialog geht auf',
  await page.inputValue('#rdKdName') === 'Parkplatz' && !(await page.isVisible('#dlgKp.on')));
check('KRITISCH: Breitengrad, Längengrad und Radius stehen als bearbeitbare Felder darin',
  (await page.inputValue('#rdKdLat')).startsWith('47.376')
  && (await page.inputValue('#rdKdLng')).startsWith('8.541')
  && (await page.inputValue('#rdKdRadius')) === '35');
check('KRITISCH: im Fenster steht KEINE zweite Karte (Vorgabe Projektinhaber)',
  await page.evaluate(() => !document.querySelector('#rdKarteDetail .gm-mock-map')));
check('Der Bereich wird als Anzeige geführt, nicht als Eingabefeld',
  (await page.textContent('#rdKdBereich')).includes('Testliegenschaft Nord'));
check('Der zugehörige Listeneintrag links ist markiert',
  await page.evaluate(() => document.querySelector('#rdKartePunkteListe .rdkarte-eintrag.aktiv')?.textContent.trim() === 'Parkplatz'));

// Funktionen: NUR Bereichszeiterfassung (Vorgabe Projektinhaber auf Rueckfrage)
const funktionen = await page.textContent('.rdkd-funktionen');
check('KRITISCH: die Funktionen-Tabelle führt Bereichszeiterfassung mit Beginn und Ende',
  funktionen.includes('Bereichszeiterfassung') && funktionen.includes('Beginn') && funktionen.includes('Ende'));
check('KRITISCH: Arbeitszeiterfassung und Auto-Abmelden stehen NICHT darin (bewusst nicht gebaut)',
  !funktionen.includes('Arbeitszeiterfassung') && !funktionen.includes('automatisch abmelden'));
check('KRITISCH: es steht ausdrücklich da, dass die Einstellung noch nicht wirkt (kein Etikettenschwindel)',
  (await page.textContent('#rdKdAllgemeines')).includes('wirkt aber noch nicht'));

// Aufgaben-Reiter und "Übersicht" als Platzhalter (Vorgabe Projektinhaber)
await page.click('#rdKdReiterAufg');
await page.waitForTimeout(100);
check('Der Aufgaben-Reiter im Fenster zeigt einen Hinweis statt erfundenem Inhalt',
  await page.isVisible('#rdKdAufgaben') && !(await page.isVisible('#rdKdAllgemeines')));
await page.click('#rdKdReiterAllg');
await page.waitForTimeout(100);
check('Und zurück auf "Allgemeines"', await page.isVisible('#rdKdAllgemeines'));

// Klick auf einen Listeneintrag links waehlt ebenso aus
await page.click('#rdKartePunkteListe .rdkarte-eintrag:has-text("Tor Süd")');
await page.waitForTimeout(300);
check('KRITISCH: auch der Klick in der Liste links öffnet denselben Bereich',
  (await page.textContent('#rdKarteDetailTitel')) === 'Tor Süd'
  && (await page.inputValue('#rdKdName')) === 'Tor Süd');
check('Die Bereichszeit-Schalter übernehmen den gespeicherten Stand',
  await page.isChecked('#rdKdBzBeginn') && !(await page.isChecked('#rdKdBzEnde')));

// Speichern schickt die neuen Felder wirklich mit
await page.fill('#rdKdBeschreibung', 'Hintere Zufahrt');
await page.check('#rdKdBzEnde');
const [speichern] = await Promise.all([
  page.waitForRequest(r => r.url().includes('kontrollpunkt_save') && r.method() === 'POST'),
  page.click('#rdKdSpeichern'),
]);
const gesendet = speichern.postDataJSON();
check('KRITISCH: Beschreibung und beide Bereichszeit-Schalter werden gespeichert',
  gesendet.beschreibung === 'Hintere Zufahrt' && gesendet.bereichszeit_beginn === 1 && gesendet.bereichszeit_ende === 1);
check('KRITISCH: der Punkt wird als Geofence mit seinen Koordinaten gespeichert, nicht als NFC',
  gesendet.typ === 'geofence' && Math.abs(gesendet.lat - 47.3782) < 0.001 && gesendet.id === 3);
await page.waitForTimeout(300);

// Gegenprobe zum gemeldeten Fehler (ENT-265): Ein Dialog oeffnete sich HINTER
// der Karte, weil Leaflet seine Ebenen auf z-index 400-1000 legt und der
// Dialog-Schleier nur auf 70 liegt. Hier gemessen statt im CSS nachgelesen:
// der Schleier muss im Stapel VOR der Karte liegen.
await page.click('#rdKdLoeschen');
await page.waitForTimeout(250);
check('KRITISCH: das Bestätigungsfenster liegt VOR der sichtbaren Karte, nicht dahinter',
  await page.evaluate(() => {
    const karte = document.getElementById('rdKarteUebersicht');
    const scrim = document.querySelector('.dlg-scrim.on');
    if (!scrim || !karte.offsetParent) return false;
    const r = scrim.getBoundingClientRect();
    const oben = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
    return scrim.contains(oben);
  }));
await page.click('.dlg-scrim.on .dlg-ft .btn-plain');
await page.waitForTimeout(200);

await page.click('#rdKarteDetail button:has-text("Schliessen")');
await page.waitForTimeout(250);
check('Das Fenster lässt sich wieder schliessen', !(await page.isVisible('#rdKarteDetail')));
check('KRITISCH: nach dem Schliessen stehen wieder ALLE Punkte auf der Karte',
  (await page.$$('#rdKarteUebersicht .gm-mock-marker')).length === 2);

// ══════════ "+ GPS-PUNKT ANLEGEN": DASSELBE FENSTER, KEIN DIALOG
await page.click('#rdKrAb-karte button:has-text("+ GPS-Punkt anlegen")');
await page.waitForTimeout(300);
check('KRITISCH: "+ GPS-Punkt anlegen" öffnet das Fenster rechts, KEINEN Dialog',
  await page.isVisible('#rdKarteDetail') && !(await page.isVisible('#dlgKp.on')));
check('Es öffnet leer und mit dem Anlege-Titel',
  (await page.textContent('#rdKarteDetailTitel')) === 'Neuer GPS-Punkt' && (await page.inputValue('#rdKdName')) === '');
check('KRITISCH: die Lage ist mit der Kartenmitte vorbelegt, es braucht keine zweite Karte im Fenster',
  (await page.inputValue('#rdKdLat')).length > 0 && (await page.inputValue('#rdKdLng')).length > 0);
check('KRITISCH: die bestehenden Punkte bleiben dabei auf der Karte sichtbar',
  (await page.$$('#rdKarteUebersicht .gm-mock-marker')).length === 3);
check('Ohne Namen wird nicht gespeichert, sondern begründet abgelehnt', await (async () => {
  await page.click('#rdKdSpeichern');
  await page.waitForTimeout(150);
  return await page.isVisible('#rdKdErr');
})());
await page.click('#rdKarteDetail button:has-text("Schliessen")');
await page.waitForTimeout(200);

// ══════════ "GEOFENCE-BEREICH ANLEGEN" STARTET DEN ZEICHNEN-MODUS (ENT-286)
// Nur ein Rauchtest, dass der Knopf ueberhaupt den Modus startet und sich
// wieder sauber abbrechen laesst, ohne die GPS-Punkte-Bedienung dieser Suite
// zu stoeren -- das eigentliche Zeichnen/Speichern/Loeschen steht in der
// eigenen Suite test_geofence_bereich.mjs.
await page.click('#rdKrAb-karte button:has-text("Geofence-Bereich anlegen")');
await page.waitForTimeout(150);
check('KRITISCH: der Zeichnen-Modus startet, statt eines ungebauten Werkzeugs',
  await page.isVisible('#rdGeoZeichnenLeiste') && !(await page.isVisible('#rdGeoCta')));
await page.keyboard.press('Escape');
await page.waitForTimeout(150);
check('Abbrechen stellt die normale Knopfzeile wieder her', await page.isVisible('#rdGeoCta'));

// ══════════ ENT-260: DER WECHSEL LAEUFT UEBER DIE REITER, NICHT UEBER ZURUECK
check('KRITISCH: auf der Seite steht gar kein Zurück-Knopf mehr (ENT-261)',
  await page.evaluate(() => document.querySelectorAll('#rdAb-kr .bk-zurueck').length === 0));
await page.click('#rdKrReiter .rdkr-tab:has-text("Allgemeines")');
await page.waitForTimeout(150);
check('KRITISCH: über den Reiter "Allgemeines" kommt man zum Formular, nicht zur Liste',
  await page.isVisible('#rdKrAb-allgemeines') && await page.isVisible('#rdAb-kr') && !(await page.isVisible('#rdAb-liste')));

// ══════════ NEUER PUNKT ZIEHT DIE TABELLE UND DIE KARTE SOFORT NACH
await page.click('#rdKrReiter .rdkr-tab:has-text("Kontrollpunkte")');
await page.waitForTimeout(150);
await page.click('#rdKrReiter .rdkr-tab:has-text("Kartenansicht")');
await page.waitForTimeout(200);
await page.click('#rdKrAb-karte button:has-text("+ GPS-Punkt anlegen")');
await page.waitForTimeout(250);
await page.fill('#rdKdName', 'Nordtor');
await page.fill('#rdKdLat', '47.38');
await page.fill('#rdKdLng', '8.55');
KONTROLLPUNKTE.kontrollpunkte.push(
  { id: 4, objekt_id: 1, bezeichnung: 'Nordtor', beschreibung: null, reihenfolge: 4, typ: 'geofence', chip_id: null,
    lat: 47.38, lng: 8.55, geofence_radius_m: 20, aktiv: 1, bereichszeit_beginn: 0, bereichszeit_ende: 0 });
await page.click('#rdKdSpeichern');
await page.waitForTimeout(400);
check('KRITISCH: die Karte zeigt den neuen Punkt sofort, ohne den Reiter neu zu öffnen',
  (await page.$$('#rdKarteUebersicht .gm-mock-marker')).length === 3);
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
await page.click('#rdKrReiter .rdkr-tab:has-text("Kartenansicht")');
await page.waitForSelector('#rdKarteUebersicht.gm-mock-map');
await page.evaluate(() => google.maps.event.trigger(rdKarteMapa, 'resize'));
await page.waitForTimeout(200);
const karteBreite = await page.$eval('#rdKarteUebersicht', el => el.getBoundingClientRect().width);
check('KRITISCH: die Karte überragt den Bildschirm auf dem Handy nicht (gemessen, nicht angenommen)',
  karteBreite <= 390 + 1);
await page.screenshot({ path: `${OUT}/rg-kp-tab-03-karte-mobil.png` });
await page.setViewportSize({ width: 1440, height: 1000 });

// ══════════ ENT-267: ADRESSSUCHE (NOMINATIM) UND VOLLBILD
// Von der vorigen Pruefung (Nordtor) steht rdKarteAuswahl noch auf einem
// mittlerweile aus der Fixture entfernten Punkt -- dessen Vorschau wuerde
// die folgenden Marker-Zaehlungen verfaelschen, darum hier sauber schliessen.
await page.evaluate(() => rdKarteDetailSchliessen());
await page.waitForTimeout(150);
await page.fill('#rdKarteOrtSuche', 'Industriestrasse');
await page.waitForTimeout(700);
check('KRITISCH: die Trefferliste erscheint mit beiden gemockten Treffern',
  (await page.$$('#rdKarteOrtTreffer button')).length === 2);
check('Beide Treffer zeigen den vollen Anzeigenamen',
  (await page.textContent('#rdKarteOrtTreffer')).includes('4600 Olten')
  && (await page.textContent('#rdKarteOrtTreffer')).includes('8005 Zürich'));

// Daneben klicken schliesst die Trefferliste, ohne etwas auszuwaehlen
// (gleiches Muster wie Glocke/Seitenleiste, ENT-059/ENT-197).
await page.click('#rdKarteDetail, body', { position: { x: 5, y: 5 } });
await page.waitForTimeout(150);
check('KRITISCH: ein Klick daneben schliesst die Trefferliste', !(await page.isVisible('#rdKarteOrtTreffer')));

// Klick auf einen Treffer schwenkt die Karte zum gewaehlten Ort
await page.fill('#rdKarteOrtSuche', 'Industriestrasse');
await page.waitForTimeout(700);
await page.click('#rdKarteOrtTreffer button:nth-child(1)');
await page.waitForTimeout(200);
// google.maps.Map#getCenter() liefert Funktions-Zugriffe (.lat()/.lng()),
// keine einfachen Eigenschaften -- anders als zuvor bei Leaflet.
const mitteNachSuche = await page.evaluate(() => { const c = rdKarteMapa.getCenter(); return { lat: c.lat(), lng: c.lng() }; });
check('KRITISCH: die Karte schwenkt zum gewählten Treffer (Olten, nicht Zürich)',
  Math.abs(mitteNachSuche.lat - 47.3782) < 0.01 && Math.abs(mitteNachSuche.lng - 7.9127) < 0.01);
// Drei statt zwei Marker: der zuvor angelegte "Nordtor"-Punkt (voriger
// Abschnitt) bleibt im geladenen Bestand, auch nachdem ihn die Fixture oben
// wieder aus der API-Antwort entfernt hat -- ohne erneuten Ladevorgang
// aendert sich der bereits im Browser gehaltene Stand nicht, das ist hier
// kein Fehler. Entscheidend ist nur: die Suche selbst legt nichts NEU an.
check('KRITISCH: die Adresssuche legt KEINEN GPS-Punkt an — nur der Kartenklick tut das',
  (await page.$$('#rdKarteUebersicht .gm-mock-marker')).length === 3);

// "Kein Treffer" ist erkennbar, keine leere, wortlose Liste
await page.route('**/nominatim.openstreetmap.org/**', route =>
  route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
await page.fill('#rdKarteOrtSuche', 'gibtesnirgends');
await page.waitForTimeout(700);
check('"Kein Treffer" steht da, statt einer leeren Trefferliste',
  (await page.textContent('#rdKarteOrtTreffer')).includes('Kein Treffer'));
await page.fill('#rdKarteOrtSuche', '');
await page.keyboard.press('Escape');
await page.waitForTimeout(150);

// Vollbild: schaltet die Kartenbuehne in den Browser-Vollbildmodus
check('Vor dem Klick ist kein Vollbildmodus aktiv', !(await page.evaluate(() => !!document.fullscreenElement)));
await page.click('.rdkarte-vollbild-knopf');
await page.waitForTimeout(200);
check('KRITISCH: der Vollbild-Knopf schaltet den Browser-Vollbildmodus auf die Kartenbühne (nicht die ganze Seite)',
  await page.evaluate(() => document.fullscreenElement === document.querySelector('#rdKrAb-karte .rdkarte-buehne')));
await page.click('.rdkarte-vollbild-knopf');
await page.waitForTimeout(200);
check('Ein zweiter Klick schaltet das Vollbild wieder aus',
  await page.evaluate(() => !document.fullscreenElement));

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
