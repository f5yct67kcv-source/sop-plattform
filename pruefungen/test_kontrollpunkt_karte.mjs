// Karten-Punktwahl fuer Geofence-Kontrollpunkte (ENT-269, Revision von
// ENT-248): Google Maps statt Leaflet/OpenStreetMap -- ausdruecklicher
// Wunsch des Projektinhaber, nachdem der Google-Maps-API-Schluessel bereits
// eingerichtet war ("deshalb haben wir ja die API gerade eingerichtet!!").
// Ersetzt die fruehere Wahl aus ENT-248 (dort war Leaflet ausdruecklich
// gewaehlt worden) -- siehe Docs-Eintrag fuer die vollstaendige Begruendung
// und die Abgrenzung zu ENT-157 (Distanzberechnung, eigener Zweck).
//
// Der Testbrowser in dieser Sandbox hat kein echtes Internet (auch nicht
// ueber den Sitzungs-Proxy, geprueft) -- echte Google-Maps-Anfragen waeren
// hier ohnehin nie zuverlaessig. `**/maps.googleapis.com/**` wird deshalb
// auf ein selbst geschriebenes Testdouble umgeleitet (google_maps_mock.mjs),
// das Map/Marker/Circle so nachbildet, dass echte Playwright-Mausereignisse
// (Klick, Ziehen) weiterhin funktionieren -- dieselbe Kachel-Test-Idee wie
// zuvor bei den OSM-Kacheln, nur eine Ebene hoeher (die ganze API statt nur
// der Bilddateien).
//
// Kachel-Test statt Erweiterung von test_kontrollpunkte.mjs, weil hier
// echte Kartenbedienung (Klick, Ziehen, Kachel-Netz blockieren) dazukommt --
// das haette die bestehende Suite unuebersichtlich gemacht.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { GOOGLE_MAPS_MOCK } from './google_maps_mock.mjs';
import { chromium } from 'playwright';

const URL = `file://${WURZEL}/dashboard.html`;
const EXE = browserPfad();

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
  // Reihenfolge ist wichtig (ENT-269): Playwright ruft bei mehreren
  // passenden Routen die zuletzt registrierte zuerst auf. "**/api/**" trifft
  // wegen des Pfadstuecks "/maps/api/js" auch auf Google Maps selbst zu --
  // die host-genaue Maps-Route muss darum NACH der allgemeinen "/api/"-Route
  // registriert werden, sonst faengt Letztere die Maps-Anfrage faelschlich
  // ab und liefert JSON statt JavaScript aus (Skriptfehler beim Ausfuehren).
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
  await page.route('**/maps.googleapis.com/**', route =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: GOOGLE_MAPS_MOCK }));
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
  // Volle Leiste ausdruecklich erzwingen: Diese Suite prueft die
  // Kontrollpunkt-Karte, nicht die Huelle (ENT-407).
  await page.evaluate(() => huelleSetzen('voll'));
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
await page.waitForSelector('#kpKarte.gm-mock-map'); // das Testdouble setzt die Klasse auf den Container selbst
await page.waitForTimeout(200);
check('Hinweistext zum Klicken steht da', (await page.textContent('#kpKarteHinweis')).includes('Auf die Karte klicken'));
check('Ohne gesetzten Punkt steht noch kein Marker auf der Karte', (await page.$$('#kpKarte .gm-mock-marker')).length === 0);
check('Die Felder Breiten-/Laengengrad sind noch leer', (await page.inputValue('#kpLat')) === '' && (await page.inputValue('#kpLng')) === '');

// ══════════ KLICK AUF DIE KARTE SETZT DEN PUNKT
const box = await page.$eval('#kpKarte', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
await page.mouse.click(box.x + box.w / 2, box.y + box.h / 2);
await page.waitForTimeout(150);
check('KRITISCH: Klick auf die Karte fuellt Breitengrad', (await page.inputValue('#kpLat')).trim() !== '');
check('KRITISCH: Klick auf die Karte fuellt Laengengrad', (await page.inputValue('#kpLng')).trim() !== '');
check('Nach dem Klick erscheint genau ein Marker', (await page.$$('#kpKarte .gm-mock-marker')).length === 1);
check('Ein Geofence-Kreis erscheint um den Marker', (await page.$$('#kpKarte .gm-mock-circle')).length >= 1);

// ══════════ VON HAND EINGETRAGENE KOORDINATEN ZIEHEN MARKER UND KARTE NACH
await page.fill('#kpLat', '47.123456');
await page.fill('#kpLng', '8.654321');
await page.dispatchEvent('#kpLat', 'change');
await page.waitForTimeout(150);
const nachHand = await page.evaluate(() => {
  const p = kpMarker.getPosition();
  const mitte = kpMapa.getCenter();
  return { lat: p.lat(), lng: p.lng(), mitteLat: mitte.lat(), mitteLng: mitte.lng() };
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
const punktNachRadius = await page.evaluate(() => { const p = kpMarker.getPosition(); return { lat: p.lat(), lng: p.lng() }; });
check('Der Punkt selbst bleibt beim Radius-Aendern unveraendert', Math.abs(punktNachRadius.lat - 47.123456) < 0.0001);

// ══════════ MARKER ZIEHEN (DRAG) AKTUALISIERT DIE FELDER
const markerBox = await page.$eval('#kpKarte .gm-mock-marker', el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
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
await page.waitForSelector('#kpKarte .gm-mock-marker');
await page.waitForTimeout(150);
check('KRITISCH: beim Oeffnen eines bestehenden Geofence-Punkts steht der Marker sofort am gespeicherten Ort',
  await page.evaluate(() => {
    const p = kpMarker.getPosition();
    return Math.abs(p.lat() - 47.37690) < 0.0001 && Math.abs(p.lng() - 8.54170) < 0.0001;
  }));
check('Der gespeicherte Radius wird als Kreis uebernommen', (await page.evaluate(() => kpKreis.getRadius())) === 35);

// ══════════ MOBIL: KARTE PASST IN DEN SCHMALEN DIALOG, KEIN UEBERLAUF
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
await page.evaluate(() => google.maps.event.trigger(kpMapa, 'resize'));
await page.waitForTimeout(150);
const karteBreite = await page.$eval('#kpKarte', el => el.getBoundingClientRect().width);
const dialogBreite = await page.$eval('#dlgKp .dlg-bd', el => el.getBoundingClientRect().width);
check('KRITISCH: die Karte ueberragt den Dialog auf dem Handy nicht (gemessen, nicht angenommen)',
  karteBreite <= dialogBreite + 1);
check('Marker bleibt nach dem Grössenwechsel sichtbar', (await page.$$('#kpKarte .gm-mock-marker')).length === 1);
await page.screenshot({ path: `${OUT}/kp-karte-02-mobil.png` });
await page.setViewportSize({ width: 1440, height: 1000 });

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
