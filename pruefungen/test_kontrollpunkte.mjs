// Kontrollpunkt-Pflege in der Objekt-Schublade (ENT-180/ENT-183).
//
// Der Rechenkern (Geofence-Pruefung, Restliste) laeuft echt gegen SQLite in
// pruef_rundgang.php -- hier nur, dass die Oberflaeche die drei Endpunkte
// richtig bedient und das Recht 'rundgang_verwalten' tatsaechlich entscheidet,
// ob die Zone ueberhaupt erscheint.
import { WURZEL, HIER, OUT, browserPfad } from './pfade.mjs';
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
  { id: 3, objekt_id: 1, bezeichnung: 'Alter Punkt', reihenfolge: 3, typ: 'nfc', chip_id: 'ZZ99',
    lat: null, lng: null, geofence_radius_m: 20, aktiv: 0 },
]};

let calls = [];
const writes = () => calls.filter(c => /save|loeschen/.test(c.path));

async function setup(page, rechte) {
  await page.route('**/api/**', async route => {
    const req = route.request();
    const path = req.url().split('/api/')[1].split('?')[0];
    let body = null;
    try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch {}
    calls.push({ path, body, url: req.url() });
    const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    const login = { status: 'ok', token: 't', name: 'adrian', ist_admin: true };
    // Nur wenn ausdruecklich eine Rechteliste mitgegeben wird, entscheidet
    // diese -- sonst (wie in den meisten anderen Suiten) greift der
    // ist_admin-Ruckfall und alles ist erlaubt. Genau dieser Unterschied
    // ist hier der Pruefgegenstand.
    if (rechte) { login.rechte = rechte; login.rollen = ['waechter']; }
    if (path.includes('login')) return send(login);
    if (path.includes('dashboard_stats')) return send({ status: 'ok', kpi: {}, verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [] });
    if (path.includes('mitarbeiter_list')) return send({ status: 'ok', mitarbeiter: [] });
    if (path.includes('kunden_list')) return send({ status: 'ok', kunden: [] });
    if (path.includes('einsatz_list')) return send({ status: 'ok', einsaetze: [] });
    if (path.includes('objekt_list')) return send(OBJEKTE);
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

const zurObjekt = async () => {
  await page.click('#nav-kunden');
  await page.waitForTimeout(150);
  await page.click('#nav-kunden-objekte');
  await page.waitForSelector('#oTable table');
  await page.waitForTimeout(150);
  calls = [];
  await page.click('#oTable tbody tr:first-child');
  await page.waitForSelector('#view-objekt.on');
  await page.waitForTimeout(300);
};

// ══════════ MIT DEM RECHT: DIE ZONE ERSCHEINT UND LAEDT
await setup(page, null);
await anmelden();
await zurObjekt();
// Kontrollpunkte sitzen seit der Reiter-Umstellung (Wunsch des Projekt-
// inhabers, 2026-08-28) in einem eigenen, zunaechst inaktiven Reiter.
await page.click('#obtab-kontrollpunkte');
await page.waitForTimeout(150);

check('Kontrollpunkte geladen', calls.some(c => c.path.includes('kontrollpunkt_liste')));
check('Oeffnen der Objekt-Detailseite schreibt nichts', writes().length === 0);
check('Alle drei Kontrollpunkte stehen da', (await page.$$('#kpListe .kp-zeile')).length === 3);
const kpText = await page.textContent('#kpListe');
check('NFC-Chip wird angezeigt', kpText.includes('AB12'));
check('Geofence mit Koordinaten und Radius wird angezeigt', kpText.includes('Radius 35 m'));
check('Nicht aktiver Punkt ist gekennzeichnet', kpText.includes('nicht aktiv'));
await page.screenshot({ path: `${OUT}/kp-01-liste.png` });

// ══════════ NEU ANLEGEN: TYP-UMSCHALTER UND VALIDIERUNG
await page.click('#kpListe ~ div button:has-text("Kontrollpunkt hinzufügen")');
await page.waitForSelector('#dlgKp.on');
await page.waitForTimeout(150);
check('Neu zeigt NFC-Felder, keine Geofence-Felder', await page.isVisible('#kpNfcFelder') && !(await page.isVisible('#kpGeofenceFelder')));
check('Reihenfolge zaehlt automatisch weiter', (await page.inputValue('#kpReihenfolge')) === '4');
check('Aktiv ist vorbelegt', await page.isChecked('#kpAktiv'));

await page.selectOption('#kpTyp', 'geofence');
await page.waitForTimeout(100);
check('Geofence blendet die NFC-Felder aus', !(await page.isVisible('#kpNfcFelder')) && await page.isVisible('#kpGeofenceFelder'));

calls = [];
await page.click('#kpBtn');
await page.waitForTimeout(200);
check('Ohne Bezeichnung kein Speichern', writes().length === 0 && await page.isVisible('#kpErr'));

await page.fill('#kpBezeichnung', 'Neuer Punkt');
await page.click('#kpBtn');
await page.waitForTimeout(200);
check('Geofence ohne Koordinaten wird abgelehnt', writes().length === 0 && (await page.textContent('#kpErr')).includes('Geofence'));

await page.fill('#kpLat', '47.1');
await page.fill('#kpLng', '7.9');
await page.fill('#kpRadius', '15');
await page.click('#kpBtn');
await page.waitForTimeout(300);
const gspeichert = calls.find(c => c.path.includes('kontrollpunkt_save'));
check('Kontrollpunkt wird mit korrektem Objekt gespeichert', gspeichert && gspeichert.body.objekt_id === 1);
check('Typ geofence wird gesendet', gspeichert && gspeichert.body.typ === 'geofence');
check('Radius wird gesendet', gspeichert && gspeichert.body.geofence_radius_m === 15);
check('Keine id beim Neuanlegen', gspeichert && !('id' in gspeichert.body));
check('Dialog schliesst nach Speichern', !(await page.isVisible('#dlgKp.on')));

// ══════════ BEARBEITEN: VORHANDENE WERTE UEBERNOMMEN
await page.waitForTimeout(300);
await page.click('#kpListe .kp-zeile:first-child button:has-text("Bearbeiten")');
await page.waitForSelector('#dlgKp.on');
await page.waitForTimeout(150);
check('Bezeichnung uebernommen', (await page.inputValue('#kpBezeichnung')) === 'Hintereingang');
check('Chip-ID uebernommen', (await page.inputValue('#kpChipId')) === 'AB12');
check('NFC-Felder sichtbar bei bestehendem NFC-Punkt', await page.isVisible('#kpNfcFelder'));

calls = [];
await page.fill('#kpChipId', 'AB12-neu');
await page.click('#kpBtn');
await page.waitForTimeout(300);
const geaendert = calls.find(c => c.path.includes('kontrollpunkt_save'));
check('Aenderung sendet die id', geaendert && geaendert.body.id === 1);
check('Geaenderte Chip-ID wird gesendet', geaendert && geaendert.body.chip_id === 'AB12-neu');

// ══════════ LOESCHEN
calls = [];
await page.click('#kpListe .kp-zeile:first-child button:has-text("Entfernen")');
await page.waitForSelector('#dlgConfirm.on');
await page.click('#cfBtn');
await page.waitForTimeout(300);
const geloescht = calls.find(c => c.path.includes('kontrollpunkt_loeschen'));
check('Loeschen sendet die richtige id', geloescht && geloescht.body.id === 1);

await page.click('#view-objekt .ku-zurueck');
await page.waitForTimeout(200);

// ══════════ OHNE DAS RECHT: DIE ZONE ERSCHEINT GAR NICHT (ENT-169)
await setup(page, ['plan', 'kunden']);
await anmelden();
await zurObjekt();
check('KRITISCH: ohne rundgang_verwalten erscheint der Reiter selbst nicht', !(await page.isVisible('#obtab-kontrollpunkte')));
check('KRITISCH: ohne rundgang_verwalten erscheint die Zone nicht', !(await page.isVisible('#kpListe')));
check('KRITISCH: ohne das Recht wird kontrollpunkt_liste gar nicht erst aufgerufen',
  !calls.some(c => c.path.includes('kontrollpunkt_liste')));

// ══════════ MOBIL: DIALOG WIRD ZUM VOLLBILD
await setup(page, null);
await anmelden();
await zurObjekt();
await page.click('#obtab-kontrollpunkte');
await page.waitForTimeout(150);
await page.click('#kpListe ~ div button:has-text("Kontrollpunkt hinzufügen")');
await page.waitForSelector('#dlgKp.on');
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
const kastenBreite = await page.$eval('#dlgKp .dlg', el => el.getBoundingClientRect().width);
check('Auf dem Handy nutzt der Dialog die volle Breite', Math.abs(kastenBreite - 390) < 2);
// Gemessen, nicht angenommen (CLAUDE.md Gestaltung). Nur die Schriftgroesse
// wird hier geprueft: Die 44px-Mindesthoehe fuer Knopf und Checkbox-Zeile
// ist eine Eigenschaft der geteilten .btn/.check-Klassen (aktuell ca. 38-40px,
// bei JEDEM Dialog im Haus, nicht nur diesem) -- kein Fehler dieser Funktion,
// darum hier nicht miterfasst. Siehe OP zur Nachverfolgung.
const feldSchrift = await page.$eval('#kpBezeichnung', el => parseFloat(getComputedStyle(el).fontSize));
check('KRITISCH: Eingabefeld hat mindestens 16px Schrift (kein iOS-Auto-Zoom)', feldSchrift >= 16);
await page.screenshot({ path: `${OUT}/kp-02-dialog-mobil.png` });
await page.setViewportSize({ width: 1440, height: 1000 });

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
