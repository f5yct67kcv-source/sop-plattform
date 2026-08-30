// Karten-Punktwahl fuer Geofence-Kontrollpunkte (ENT-248): Leaflet/
// OpenStreetMap statt Google Maps -- ausdruecklicher Wunsch des
// Projektinhabers (kein API-Key, kein Kostenkonto, selbst ausgeliefert wie
// html2pdf.bundle.min.js, siehe deploy-hostpoint.yml).
//
// Kachel-Test statt Erweiterung von test_kontrollpunkte.mjs, weil hier
// echte Kartenbedienung (Klick, Ziehen, Kachel-Netz blockieren) dazukommt --
// das haette die bestehende Suite unuebersichtlich gemacht.
//
// Kachel-Anfragen an *.tile.openstreetmap.org werden abgefangen: echte
// Netzwerkzugriffe waeren in einer automatisierten Pruefung weder
// zuverlaessig (offline-faehig) noch angemessen (OpenStreetMaps
// Nutzungsbedingungen sind nicht fuer automatisierte Testlaeufe gedacht).
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const URL = `file://${WURZEL}/dashboard.html`;
const EXE = browserPfad();

// Kleinste gueltige PNG-Datei (1x1, transparent) als Kachel-Ersatz.
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
]};

let calls = [];

async function setup(page) {
  await page.route('**/*.tile.openstreetmap.org/**', route =>
    route.fulfill({ status: 200, contentType: 'image/png', body: KACHEL_PNG }));
  await page.route('**/api/**', async route => {
    const req = route.request();
    const path = req.url().split('/api/')[1].split('?')[0];
    let body = null;
    try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch {}
    calls.push({ path, body, url: req.url() });
    const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (path.includes('login')) return send({ status: 'ok', token: 't', name: 'adrian', ist_admin: true });
    if (path.includes('dashboard_stats')) return send({ status: 'ok', kpi: {}, verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [] });
    if (path.includes('mitarbeiter_list')) return send({ status: 'ok', mitarbeiter: [] });
    if (path.includes('kunden_list')) return send({ status: 'ok', kunden: [] });
    if (path.includes('einsatz_list')) return send({ status: 'ok', einsaetze: [] });
    if (path.includes('objekt_list') || path.includes('objekte_revierdienst')) return send(OBJEKTE);
    if (path.includes('masterschicht_list')) return send({ status: 'ok', masterschichten: [] });
    if (path.includes('kontrollpunkt_liste')) return send(KONTROLLPUNKTE);
    if (path.includes('kontrollpunkt_save')) return send({ status: 'ok', id: 99 });
    if (path.includes('kontrollpunkt_loeschen')) return send({ status: 'ok' });
    return send({ status: 'ok' });
  });
}

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));

const anmelden = async () => {
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.goto(URL);
  await page.fill('#gName', 'adrian'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
  await page.waitForSelector('#kpiGrid .kpi-val');
};

const zurEinrichtung = async () => {
  await page.evaluate(() => {
    if (!document.getElementById('navg-revierdienst').classList.contains('offen')) {
      document.getElementById('nav-revierdienst').click();
    }
  });
  await page.waitForTimeout(150);
  await page.click('#nav-revierdienst-einrichtung');
  await page.waitForSelector('#view-revierdienst.on');
  await page.waitForTimeout(150);
  calls = [];
  await page.selectOption('#rdObjektWahl', '1');
  await page.waitForTimeout(300);
};

await setup(page);
await anmelden();
await zurEinrichtung();

// ══════════ NEUER GEOFENCE-PUNKT: KARTE ERSCHEINT, HINWEISTEXT STEHT DA
await page.click('#kpListe ~ div button:has-text("Kontrollpunkt hinzufügen")');
await page.waitForSelector('#dlgKp.on');
await page.selectOption('#kpTyp', 'geofence');
await page.waitForSelector('#kpKarte.leaflet-container'); // Leaflet setzt die Klasse auf den Container selbst, nicht auf ein Kind
await page.waitForTimeout(200);
check('Hinweistext zum Klicken steht da', (await page.textContent('#kpKarteHinweis')).includes('Auf die Karte klicken'));
check('Ohne gesetzten Punkt steht noch kein Marker auf der Karte', (await page.$$('#kpKarte .leaflet-marker-icon')).length === 0);
check('Die Felder Breiten-/Laengengrad sind noch leer', (await page.inputValue('#kpLat')) === '' && (await page.inputValue('#kpLng')) === '');

// ══════════ KLICK AUF DIE KARTE SETZT DEN PUNKT
const box = await page.$eval('#kpKarte', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
await page.mouse.click(box.x + box.w / 2, box.y + box.h / 2);
await page.waitForTimeout(150);
check('KRITISCH: Klick auf die Karte fuellt Breitengrad', (await page.inputValue('#kpLat')).trim() !== '');
check('KRITISCH: Klick auf die Karte fuellt Laengengrad', (await page.inputValue('#kpLng')).trim() !== '');
check('Nach dem Klick erscheint genau ein Marker', (await page.$$('#kpKarte .leaflet-marker-icon')).length === 1);
check('KRITISCH: der Marker nutzt das selbst ausgelieferte Symbol, kein kaputtes Bild (ENT-248)',
  await page.$eval('#kpKarte .leaflet-marker-icon', img => img.complete && img.naturalWidth > 0));
check('Ein Geofence-Kreis erscheint um den Marker', (await page.$$('#kpKarte .leaflet-interactive')).length >= 1);

// ══════════ VON HAND EINGETRAGENE KOORDINATEN ZIEHEN MARKER UND KARTE NACH
await page.fill('#kpLat', '47.123456');
await page.fill('#kpLng', '8.654321');
await page.dispatchEvent('#kpLat', 'change');
await page.waitForTimeout(150);
const nachHand = await page.evaluate(() => {
  const p = kpMarker.getLatLng();
  const mitte = kpMapa.getCenter();
  return { lat: p.lat, lng: p.lng, mitteLat: mitte.lat, mitteLng: mitte.lng };
});
check('KRITISCH: von Hand eingetragener Breitengrad zieht den Marker nach', Math.abs(nachHand.lat - 47.123456) < 0.0001);
check('KRITISCH: von Hand eingetragener Laengengrad zieht den Marker nach', Math.abs(nachHand.lng - 8.654321) < 0.0001);
check('Die Karte zentriert auf den neu eingetragenen Punkt', Math.abs(nachHand.mitteLat - 47.123456) < 0.01 && Math.abs(nachHand.mitteLng - 8.654321) < 0.01);

// ══════════ RADIUS-AENDERUNG ZIEHT DEN KREIS NACH, OHNE DEN PUNKT ZU VERSCHIEBEN
await page.fill('#kpRadius', '77');
await page.dispatchEvent('#kpRadius', 'change');
await page.waitForTimeout(150);
const radiusNachher = await page.evaluate(() => kpKreis.getRadius());
check('KRITISCH: Radius-Feld steuert den gezeichneten Kreis', radiusNachher === 77);
const punktNachRadius = await page.evaluate(() => kpMarker.getLatLng());
check('Der Punkt selbst bleibt beim Radius-Aendern unveraendert', Math.abs(punktNachRadius.lat - 47.123456) < 0.0001);

// ══════════ MARKER ZIEHEN (DRAG) AKTUALISIERT DIE FELDER
const markerBox = await page.$eval('#kpKarte .leaflet-marker-icon', el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
await page.mouse.move(markerBox.x, markerBox.y);
await page.mouse.down();
await page.mouse.move(markerBox.x + 40, markerBox.y - 30, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(150);
const nachDrag = await page.evaluate(() => ({ lat: parseFloat($('kpLat').value), lng: parseFloat($('kpLng').value) }));
check('KRITISCH: Marker ziehen aktualisiert das Breitengrad-Feld', Math.abs(nachDrag.lat - 47.123456) > 0.00001);
check('KRITISCH: Marker ziehen aktualisiert das Laengengrad-Feld', Math.abs(nachDrag.lng - 8.654321) > 0.00001);
await page.screenshot({ path: `${OUT}/kp-karte-01-gesetzt.png` });

// ══════════ BEARBEITEN: BESTEHENDER GEOFENCE-PUNKT ZEIGT MARKER SOFORT
await page.click('#dlgKp .dlg-ft .btn-plain'); // Abbrechen schliesst den Dialog, ohne zu speichern
await page.waitForTimeout(200);
await page.click('#kpListe .kp-zeile:has-text("Parkplatz") button:has-text("Bearbeiten")');
await page.waitForSelector('#dlgKp.on');
await page.waitForSelector('#kpKarte .leaflet-marker-icon');
await page.waitForTimeout(150);
check('KRITISCH: beim Oeffnen eines bestehenden Geofence-Punkts steht der Marker sofort am gespeicherten Ort',
  await page.evaluate(() => {
    const p = kpMarker.getLatLng();
    return Math.abs(p.lat - 47.37690) < 0.0001 && Math.abs(p.lng - 8.54170) < 0.0001;
  }));
check('Der gespeicherte Radius wird als Kreis uebernommen', (await page.evaluate(() => kpKreis.getRadius())) === 35);

// ══════════ MOBIL: KARTE PASST IN DEN SCHMALEN DIALOG, KEIN UEBERLAUF
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
await page.evaluate(() => kpMapa.invalidateSize());
await page.waitForTimeout(150);
const karteBreite = await page.$eval('#kpKarte', el => el.getBoundingClientRect().width);
const dialogBreite = await page.$eval('#dlgKp .dlg-bd', el => el.getBoundingClientRect().width);
check('KRITISCH: die Karte ueberragt den Dialog auf dem Handy nicht (gemessen, nicht angenommen)',
  karteBreite <= dialogBreite + 1);
check('Marker bleibt nach dem Grössenwechsel sichtbar', (await page.$$('#kpKarte .leaflet-marker-icon')).length === 1);
await page.screenshot({ path: `${OUT}/kp-karte-02-mobil.png` });
await page.setViewportSize({ width: 1440, height: 1000 });

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
