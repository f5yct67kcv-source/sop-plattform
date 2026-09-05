// Kontrollrunden-Vorlagen unter Revierdienst > Einrichtung (ENT-204, Umzug
// aus der Objekt-Detailseite seit ENT-224; Anlegen/Aendern seit ENT-248 in
// der gemeinsamen Schublade statt im kleinen dlgKr-Dialog, weil dort jetzt
// auch Kontrollpunkte inklusive Karten-Punktwahl direkt bearbeitbar sind).
//
// Die eigentliche Pruef- und Ersetzungslogik der Punktzuordnung laeuft echt
// gegen SQLite in pruef_rundgang.php -- hier nur, dass die Oberflaeche die
// drei Endpunkte richtig bedient, die Punkteliste des Objekts korrekt in
// Checkboxen uebersetzt und das Recht 'rundgang_verwalten' tatsaechlich
// entscheidet, ob die Rubrik ueberhaupt erscheint (gleiches Muster wie
// test_kontrollpunkte.mjs).
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

const VORLAGEN = { status: 'ok', vorlagen: [
  { id: 10, objekt_id: 1, name: 'Öffnungsrunde', aktiv: 1, erstellt_am: '2026-01-01 07:00:00',
    punkte: [{ id: 1, bezeichnung: 'Hintereingang', reihenfolge: 0 }] },
  { id: 11, objekt_id: 1, name: 'Schlusskontrolle', aktiv: 0, erstellt_am: '2026-01-01 07:00:00', punkte: [] },
]};

let calls = [];
const writes = () => calls.filter(c => /save|loeschen|setzen/.test(c.path));

async function setup(page, rechte) {
  await page.route('**/api/**', async route => {
    const req = route.request();
    const path = req.url().split('/api/')[1].split('?')[0];
    let body = null;
    try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch {}
    calls.push({ path, body, url: req.url() });
    const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    const login = { status: 'ok', token: 't', name: 'adrian', ist_admin: true };
    if (rechte) { login.rechte = rechte; login.rollen = ['waechter']; }
    if (path.includes('login')) return send(login);
    if (path.includes('dashboard_stats')) return send({ status: 'ok', kpi: {}, verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [] });
    if (path.includes('mitarbeiter_list')) return send({ status: 'ok', mitarbeiter: [] });
    if (path.includes('kunden_list')) return send({ status: 'ok', kunden: [] });
    if (path.includes('einsatz_list')) return send({ status: 'ok', einsaetze: [] });
    // Seit ENT-227 holt die Revierdienst-Einrichtung ihre Objekte ueber
    // objekte_revierdienst.php statt objekt_list.php -- der alte Endpunkt
    // verlangt 'plan', das die Rolle "Waechtersystem" nicht hat. Beide
    // liefern dieselbe Menge, darum hier dieselbe Antwort.
    if (path.includes('objekt_list') || path.includes('objekte_revierdienst')) return send(OBJEKTE);
    if (path.includes('masterschicht_list')) return send({ status: 'ok', masterschichten: [] });
    if (path.includes('kontrollpunkt_liste')) return send(KONTROLLPUNKTE);
    if (path.includes('rundgang_vorlage_liste')) return send(VORLAGEN);
    if (path.includes('rundgang_vorlage_save')) return send({ status: 'ok', id: 99 });
    if (path.includes('rundgang_vorlage_punkte_setzen')) return send({ status: 'ok' });
    if (path.includes('rundgang_vorlage_loeschen')) return send({ status: 'ok' });
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

// Revierdienst > Einrichtung (ENT-224): eigene Rubrik statt Objekt-Reiter,
// mit einem Objekt-Waehler, weil Kontrollpunkte/-runden weiterhin an genau
// ein Objekt gebunden sind.
const zurEinrichtung = async () => {
  // Volle Leiste ausdruecklich erzwingen: Diese Suite prueft die
  // Kontrollrunden, nicht die Huelle (ENT-407).
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

// ══════════ MIT DEM RECHT: DIE ZONE ERSCHEINT UND LAEDT
await setup(page, null);
await anmelden();
await zurEinrichtung();

check('Kontrollrunden geladen', calls.some(c => c.path.includes('rundgang_vorlage_liste')));
check('Oeffnen der Einrichtung ohne Objektwahl schreibt nichts', writes().length === 0);
check('Beide Kontrollrunden stehen da', (await page.$$('#krListe .kr-zeile')).length === 2);
const krText = await page.textContent('#krListe');
check('Name der aktiven Runde erscheint', krText.includes('Öffnungsrunde'));
check('Zugeordneter Kontrollpunkt wird genannt', krText.includes('Hintereingang'));
check('Nicht aktive Runde ist gekennzeichnet', krText.includes('nicht aktiv'));
check('Runde ohne Punkte sagt das explizit (nicht wie "0 Kontrollpunkte")', krText.includes('Noch kein Kontrollpunkt zugeordnet'));
await page.screenshot({ path: `${OUT}/kr-01-liste.png` });

// ══════════ NEU ANLEGEN: PUNKTE-CHECKLISTE AUS DEN OBJEKT-KONTROLLPUNKTEN
await page.click('#krListe ~ div button:has-text("Kontrollrunde hinzufügen")');
await page.waitForSelector('#drawer.on');
await page.waitForTimeout(150);
check('Titel der Schublade stimmt', (await page.textContent('#drTitle')) === 'Neue Kontrollrunde');
check('Alle drei Kontrollpunkte des Objekts stehen zur Auswahl',
  (await page.$$('#krPunkteListe .kr-punkt')).length === 3);
check('Neu: kein Punkt vorausgewaehlt',
  (await page.$$('#krPunkteListe .kr-punkt:checked')).length === 0);
check('Der inaktive Kontrollpunkt ist trotzdem waehlbar, aber gekennzeichnet',
  (await page.textContent('#krPunkteListe')).includes('Alter Punkt') &&
  (await page.textContent('#krPunkteListe')).includes('nicht aktiv'));
check('"+ Kontrollpunkt" fuehrt direkt zum Kontrollpunkt-Dialog (ENT-248)',
  await page.isVisible('#drawer button:has-text("+ Kontrollpunkt")'));

calls = [];
await page.click('#krBtn');
await page.waitForTimeout(200);
check('Ohne Namen kein Speichern', writes().length === 0 && await page.isVisible('#krErr'));

await page.fill('#krName', 'Nachtrunde');
const boxen = await page.$$('#krPunkteListe .kr-punkt');
await boxen[0].check();
await boxen[1].check();
await page.click('#krBtn');
await page.waitForTimeout(300);

const gespeichert = calls.find(c => c.path.includes('rundgang_vorlage_save'));
check('Kontrollrunde wird mit korrektem Objekt gespeichert', gespeichert && gespeichert.body.objekt_id === 1);
check('Name wird gesendet', gespeichert && gespeichert.body.name === 'Nachtrunde');
check('Keine id beim Neuanlegen', gespeichert && !('id' in gespeichert.body));
const zugeordnet = calls.find(c => c.path.includes('rundgang_vorlage_punkte_setzen'));
check('KRITISCH: die Punktzuordnung wird MIT der neuen id aus dem Speichern gesendet',
  zugeordnet && zugeordnet.body.vorlage_id === 99);
check('KRITISCH: die Reihenfolge der Checkboxen wird als Reihenfolge uebernommen (Hintereingang vor Parkplatz)',
  zugeordnet && JSON.stringify(zugeordnet.body.kontrollpunkt_ids) === JSON.stringify([1, 2]));
check('Schublade schliesst nach Speichern', !(await page.isVisible('#drawer.on')));

// ══════════ KRITISCH: DIE GANZE ZEILE OEFFNET, NICHT NUR DER "BEARBEITEN"-KNOPF
// (ENT-256, Bug-Meldung des Projektinhabers nach dem Ausliefern von ENT-248:
// "bei mir öffnet sich noch nichts" -- Klick auf die Karte ausserhalb des
// Knopfes tat bis dahin buchstaeblich nichts.)
await page.waitForTimeout(300);
await page.click('#krListe .kr-zeile:nth-child(2) .kr-meta');
await page.waitForSelector('#drawer.on');
await page.waitForTimeout(150);
check('KRITISCH: Klick auf die Zeile ausserhalb des Knopfes oeffnet die Schublade',
  (await page.textContent('#drTitle')) === 'Kontrollrunde ändern');
check('Die richtige Runde wird geladen (zweite Zeile, nicht die erste)',
  (await page.inputValue('#krName')) === 'Schlusskontrolle');
await page.evaluate(() => closeDrawer());
await page.waitForTimeout(150);

// ══════════ BEARBEITEN: VORHANDENE WERTE UEBERNOMMEN
await page.waitForTimeout(150);
await page.click('#krListe .kr-zeile:first-child button:has-text("Bearbeiten")');
await page.waitForSelector('#drawer.on');
await page.waitForTimeout(150);
check('Titel der Schublade beim Aendern stimmt', (await page.textContent('#drTitle')) === 'Kontrollrunde ändern');
check('Name uebernommen', (await page.inputValue('#krName')) === 'Öffnungsrunde');
check('Aktiv-Status uebernommen', await page.isChecked('#krAktiv'));
check('Der bereits zugeordnete Punkt ist vorausgewaehlt',
  await page.isChecked('#krPunkteListe .kr-punkt[value="1"]'));
check('Ein nicht zugeordneter Punkt ist nicht vorausgewaehlt',
  !(await page.isChecked('#krPunkteListe .kr-punkt[value="2"]')));

// ══════════ "+ KONTROLLPUNKT" OEFFNET DIREKT DEN KONTROLLPUNKT-DIALOG,
// UND DIE LISTE IN DER SCHUBLADE ZIEHT SOFORT NACH (ENT-248,
// krPunkteAktualisieren()) -- ohne die Kontrollrunden-Schublade neu oeffnen
// zu muessen.
// Selektor auf die Schublade eingeschraenzt: seit ENT-257 gibt es denselben
// Knopftext auch, unsichtbar, in der statischen Rundgaenge-Unterseite
// (#rdAb-kr) -- ein ungescopter Selektor traf sonst den falschen (ENT-246
// hatte dasselbe Problem schon einmal mit .bk-zurueck).
await page.click('#drawer button:has-text("+ Kontrollpunkt")');
await page.waitForSelector('#dlgKp.on');
check('Die Kontrollrunden-Schublade bleibt hinter dem Kontrollpunkt-Dialog sichtbar (Dialog stapelt, statt zu ersetzen)',
  await page.isVisible('#drawer.on'));
await page.fill('#kpBezeichnung', 'Hintereingang unten');
await page.fill('#kpChipId', 'NEU01');
// Simuliert, was die echte API nach erfolgreichem Speichern zurueckgeben
// wuerde -- der Test-Stub fuer kontrollpunkt_liste.php antwortet mit genau
// diesem Array, darum hier von Hand ergaenzt statt echt in SQLite gespeichert.
KONTROLLPUNKTE.kontrollpunkte.push(
  { id: 4, objekt_id: 1, bezeichnung: 'Hintereingang unten', reihenfolge: 3, typ: 'nfc', chip_id: 'NEU01', lat: null, lng: null, geofence_radius_m: 20, aktiv: 1 });
calls = [];
await page.click('#kpBtn');
await page.waitForTimeout(300);
check('Kontrollpunkt wird gespeichert', calls.some(c => c.path.includes('kontrollpunkt_save')));
check('KRITISCH: der neue Kontrollpunkt erscheint sofort in der Kontrollrunden-Liste, ohne die Schublade neu zu oeffnen',
  (await page.textContent('#krPunkteListe')).includes('Hintereingang unten'));
check('Bereits angehakte Punkte bleiben nach dem Nachziehen angehakt',
  await page.isChecked('#krPunkteListe .kr-punkt[value="1"]'));
KONTROLLPUNKTE.kontrollpunkte.pop();

calls = [];
await page.click('#krPunkteListe .kr-punkt[value="2"]');
await page.click('#krBtn');
await page.waitForTimeout(300);
const geaendert = calls.find(c => c.path.includes('rundgang_vorlage_save'));
check('Aenderung sendet die id', geaendert && geaendert.body.id === 10);
const neuZugeordnet = calls.find(c => c.path.includes('rundgang_vorlage_punkte_setzen'));
check('Erweiterte Auswahl (beide Punkte) wird gesendet',
  neuZugeordnet && JSON.stringify(neuZugeordnet.body.kontrollpunkt_ids.sort()) === JSON.stringify([1, 2]));

// ══════════ LOESCHEN
calls = [];
await page.click('#krListe .kr-zeile:first-child button:has-text("Entfernen")');
await page.waitForSelector('#dlgConfirm.on');
check('KRITISCH: "Entfernen" oeffnet NICHT zusaetzlich die Bearbeiten-Schublade (event.stopPropagation, ENT-256)',
  !(await page.isVisible('#drawer.on')));
await page.click('#cfBtn');
await page.waitForTimeout(300);
const geloescht = calls.find(c => c.path.includes('rundgang_vorlage_loeschen'));
check('Loeschen sendet die richtige id', geloescht && geloescht.body.id === 10);

// ══════════ OHNE DAS RECHT: DIE RUBRIK ERSCHEINT GAR NICHT (ENT-169/ENT-224)
await setup(page, ['plan', 'kunden']);
await anmelden();
check('KRITISCH: ohne rundgang_verwalten/-einsehen erscheint die Rubrik Revierdienst selbst nicht',
  !(await page.isVisible('#nav-revierdienst')));
calls = [];
await page.evaluate(() => go('revierdienst'));
await page.waitForTimeout(200);
check('KRITISCH: ohne das Recht wird rundgang_vorlage_liste gar nicht erst aufgerufen, auch bei direktem Aufruf',
  !calls.some(c => c.path.includes('rundgang_vorlage_liste')));

// ══════════ MOBIL: SCHUBLADE WIRD ZUM VOLLBILD, TREFFERFLAECHE STIMMT
await setup(page, null);
await anmelden();
await zurEinrichtung();
await page.click('#krListe ~ div button:has-text("Kontrollrunde hinzufügen")');
await page.waitForSelector('#drawer.on');
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
const kastenBreite = await page.$eval('#drawer', el => el.getBoundingClientRect().width);
check('Auf dem Handy nutzt die Schublade die volle Breite', Math.abs(kastenBreite - 390) < 2);
// Gemessen, nicht angenommen (CLAUDE.md Gestaltung).
const feldSchrift = await page.$eval('#krName', el => parseFloat(getComputedStyle(el).fontSize));
check('KRITISCH: Eingabefeld hat mindestens 16px Schrift (kein iOS-Auto-Zoom)', feldSchrift >= 16);
const punktHoehe = await page.$eval('#krPunkteListe .check', el => el.getBoundingClientRect().height);
check('KRITISCH: eine Punkt-Checkbox-Zeile erreicht die 44px-Mindesttrefferflaeche (OP-111)',
  punktHoehe >= 43.9);
await page.screenshot({ path: `${OUT}/kr-02-dialog-mobil.png` });
await page.setViewportSize({ width: 1440, height: 1000 });

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
