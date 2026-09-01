// Geofence-Bereiche (ENT-286): freies Vieleck auf der Kartenansicht der
// Kontrollrunden-Bearbeitung, eigenstaendig von den Kontrollpunkten (deren
// Kreis-Geofences fuer die Rundgang-Bestaetigung bleiben unveraendert).
// Ausdrueckliche Vorgabe des Projektinhabers fuer diesen ersten Schritt:
// rein darstellende Referenzflaeche, ohne Wirkung auf Rundgang-Scans --
// diese Suite prueft darum nur Anlegen/Umbenennen/Loeschen und die
// Zeichnen-Bedienung, keine Rundgang-Fachlogik.
//
// Kachel-Test mit eigenem Google-Maps-Mock (wie test_kontrollpunkt_karte.mjs),
// weil hier echte Kartenklicks (Ecken setzen, letzte Ecke entfernen per
// Rechtsklick, Vieleck-Vorschau) dazukommen.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { GOOGLE_MAPS_MOCK } from './google_maps_mock.mjs';
import { chromium } from 'playwright';

const SEITE = `file://${WURZEL}/dashboard.html`;
const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const OBJEKTE = { status: 'ok', objekte: [
  { id: 1, kunde_id: 1, kunde_name: 'Muster Liegenschaften AG', name: 'Testliegenschaft Nord',
    strasse: 'Testweg 1', ort: '9999 Beispielhausen', kanton: 'SO', einsatzart: 'Revierdienst',
    aktiv: 1, bemerkung: null, masterschichten: 0, stunden_je_einsatz: 0 },
]};
const VORLAGEN_ALLE = { status: 'ok', vorlagen: [
  { id: 10, objekt_id: 1, kunde_name: 'Muster Liegenschaften AG', objekt_name: 'Testliegenschaft Nord',
    name: 'Öffnungsrunde', beschreibung: null, ansprechpartner_name: null, ansprechpartner_telefon: null,
    aktiv: 1, erstellt_am: '2026-01-01 00:00:00',
    punkte: [{ id: 1, bezeichnung: 'Eingang', reihenfolge: 1 }] },
]};
const KONTROLLPUNKTE_OBJ1 = { status: 'ok', kontrollpunkte: [
  { id: 1, objekt_id: 1, bezeichnung: 'Eingang', typ: 'nfc', chip_id: 'A1', reihenfolge: 1, aktiv: 1, beschreibung: null },
]};

// Zustandsbehaftet (gleiches Prinzip wie test_rundgaenge_verwaltung.mjs,
// ENT-273): geofence_bereich_save/loeschen schreiben tatsaechlich in dieses
// Array zurueck, damit die anschliessende Liste den echten Stand zeigt.
let GEOFENCE_BEREICHE = [];
let naechsteGeoId = 1;

let calls = [];

function setup(page) {
  const p = page.route('**/api/**', async route => {
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
    if (path.includes('kontrollpunkt_liste')) return send(KONTROLLPUNKTE_OBJ1);
    if (path.includes('rundgang_vorlage_liste')) {
      const objektId = Number(u.searchParams.get('objekt_id'));
      return send({ status: 'ok', vorlagen: VORLAGEN_ALLE.vorlagen.filter(v => v.objekt_id === objektId) });
    }
    if (path.includes('geofence_bereich_liste')) {
      const objektId = Number(u.searchParams.get('objekt_id'));
      return send({ status: 'ok', bereiche: GEOFENCE_BEREICHE.filter(b => b.objekt_id === objektId) });
    }
    if (path.includes('geofence_bereich_save')) {
      if (!body.name) { return send({ status: 'error', message: 'Objekt und Name erforderlich' }); }
      if (!Array.isArray(body.koordinaten) || body.koordinaten.length < 3) {
        return send({ status: 'error', message: 'Mindestens drei gueltige Eckpunkte erforderlich' });
      }
      if (body.id) {
        const b = GEOFENCE_BEREICHE.find(x => x.id === Number(body.id));
        if (b) { b.name = body.name; b.koordinaten = body.koordinaten; }
        return send({ status: 'ok', id: Number(body.id) });
      }
      const id = naechsteGeoId++;
      GEOFENCE_BEREICHE.push({ id, objekt_id: body.objekt_id, name: body.name, koordinaten: body.koordinaten, aktiv: 1 });
      return send({ status: 'ok', id });
    }
    if (path.includes('geofence_bereich_loeschen')) {
      const vor = GEOFENCE_BEREICHE.length;
      GEOFENCE_BEREICHE = GEOFENCE_BEREICHE.filter(b => b.id !== Number(body.id));
      return send(GEOFENCE_BEREICHE.length < vor ? { status: 'ok' } : { status: 'error', message: 'nicht gefunden' });
    }
    return send({ status: 'ok' });
  });
  // Reihenfolge wichtig (ENT-269): NACH der allgemeinen "/api/"-Route
  // registrieren, sonst faengt diese "/maps/api/js" faelschlich ab.
  return p.then(() => page.route('**/maps.googleapis.com/**', route =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: GOOGLE_MAPS_MOCK })));
}

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));

await setup(page);
await page.goto(SEITE);
await page.evaluate(() => localStorage.clear());
await page.goto(SEITE);
await page.fill('#gName', 'adrian'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#kpiGrid .kpi-val');

await page.evaluate(() => go('rundgaenge'));
await page.waitForSelector('#rdUebersicht');
await page.click('#view-rundgaenge .bk-kachel:has-text("Rundgänge")');
await page.waitForSelector('#rdAb-liste table');
await page.click('#rdAb-liste tr:has-text("Öffnungsrunde") button:has-text("Bearbeiten")');
await page.waitForFunction(() => document.getElementById('rdAb-kr').style.display !== 'none');
calls = [];
await page.click('#rdKrReiter .rdkr-tab[data-reiter="karte"]');
await page.waitForSelector('#rdKarteUebersicht.gm-mock-map');
await page.waitForTimeout(200);

// ══════════ LEERER ZUSTAND
check('KRITISCH: ohne Bereich steht "noch kein Geofence-Bereich" da, nicht "keine Einträge"',
  (await page.textContent('#rdKarteBereiche')).includes('Noch kein Geofence-Bereich angelegt'));
check('Der Knopf "Geofence-Bereich anlegen" ist da', await page.isVisible('#rdGeoStartenBtn'));
check('Die Zeichnen-Leiste ist noch unsichtbar', !(await page.isVisible('#rdGeoZeichnenLeiste')));

// ══════════ ZEICHNEN STARTEN: LEISTE ERSETZT DIE NORMALE KNOPFZEILE
await page.click('#rdGeoStartenBtn');
await page.waitForTimeout(100);
check('KRITISCH: die Zeichnen-Leiste erscheint', await page.isVisible('#rdGeoZeichnenLeiste'));
check('Die normale Knopfzeile weicht dabei', !(await page.isVisible('#rdGeoCta')));

// ══════════ FRUEHZEITIG "FERTIG": WENIGER ALS DREI ECKEN WIRD ABGEWIESEN
await page.click('#rdGeoZeichnenLeiste button:has-text("Fertig")');
await page.waitForTimeout(100);
check('KRITISCH: "Fertig" ohne jede Ecke öffnet keinen Namens-Dialog', !(await page.isVisible('#dlgGeoName.on')));

// ══════════ DREI ECKEN SETZEN (KLICKS AN VERSCHIEDENEN STELLEN)
const box = await page.$eval('#rdKarteUebersicht', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
const ecke = (dx, dy) => page.mouse.click(box.x + box.w / 2 + dx, box.y + box.h / 2 + dy);
await ecke(-80, -60);
await page.waitForTimeout(80);
check('Nach der ersten Ecke steht ein Marker da, aber noch kein Vieleck (< 2 Punkte)',
  (await page.$$('#rdKarteUebersicht .gm-mock-marker')).length === 1
  && (await page.$$('#rdKarteUebersicht .gm-mock-polygon')).length === 0);
await ecke(80, -60);
await page.waitForTimeout(80);
check('KRITISCH: ab der zweiten Ecke erscheint die Vieleck-Vorschau', (await page.$$('#rdKarteUebersicht .gm-mock-polygon')).length === 1);
await ecke(0, 80);
await page.waitForTimeout(80);
check('Drei Ecken stehen als drei Marker da', (await page.$$('#rdKarteUebersicht .gm-mock-marker')).length === 3);

// ══════════ KLICK INS INNERE DER BEREITS UMSCHLOSSENEN FLAECHE SETZT TROTZDEM
// EINE VIERTE ECKE (Gegenprobe zur clickable:false-Vorschau -- ohne die waere
// dieser Klick von der Vorschau-Flaeche abgefangen worden, statt beim
// Kartencontainer anzukommen).
await ecke(0, -10);
await page.waitForTimeout(80);
check('KRITISCH: ein Klick innerhalb der bereits gezeichneten Fläche setzt trotzdem eine weitere Ecke (konkaves Vieleck möglich)',
  (await page.$$('#rdKarteUebersicht .gm-mock-marker')).length === 4);

// ══════════ RECHTSKLICK ENTFERNT DIE LETZTE ECKE
// Bewusst an einer Stelle ohne Marker/Vieleck darunter -- ein Marker stoppt
// die Ereignis-Ausbreitung selbst (gleiches Prinzip wie beim Linksklick),
// die Position des Rechtsklicks spielt fuer "letzte Ecke entfernen" sonst
// keine Rolle.
await page.mouse.click(box.x + box.w / 2 + 160, box.y + box.h / 2 + 160, { button: 'right' });
await page.waitForTimeout(100);
check('KRITISCH: Rechtsklick entfernt die zuletzt gesetzte Ecke', (await page.$$('#rdKarteUebersicht .gm-mock-marker')).length === 3);

// ══════════ ESC BRICHT DAS ZEICHNEN VOLLSTAENDIG AB
await page.keyboard.press('Escape');
await page.waitForTimeout(100);
check('KRITISCH: Esc bricht das Zeichnen ab -- keine Marker, keine Vorschau mehr',
  (await page.$$('#rdKarteUebersicht .gm-mock-marker')).length === 0
  && (await page.$$('#rdKarteUebersicht .gm-mock-polygon')).length === 0);
check('Die normale Knopfzeile steht wieder da', await page.isVisible('#rdGeoCta'));
check('Die Zeichnen-Leiste ist wieder weg', !(await page.isVisible('#rdGeoZeichnenLeiste')));

// ══════════ NEU ZEICHNEN, DIESMAL BIS ZUM SPEICHERN (TASTATUR: ENTER STATT KNOPF)
await page.click('#rdGeoStartenBtn');
await ecke(-80, -60);
await ecke(80, -60);
await ecke(0, 80);
await page.waitForTimeout(80);
await page.keyboard.press('Enter');
await page.waitForTimeout(100);
check('KRITISCH: Enter mit drei Ecken öffnet den Namens-Dialog', await page.isVisible('#dlgGeoName.on'));
check('Titel des Dialogs ist die Neuanlage, nicht "umbenennen"', (await page.textContent('#dlgGeoNameTitel')) === 'Geofence-Bereich benennen');
check('Der Löschen-Knopf ist bei einer neuen Fläche unsichtbar', !(await page.isVisible('#geoNameLoeschenBtn')));

// ══════════ SPEICHERN OHNE NAME WIRD ABGEWIESEN
await page.click('#dlgGeoName button:has-text("Speichern")');
await page.waitForTimeout(100);
check('KRITISCH: ohne Namen bleibt der Dialog offen und zeigt einen Fehler',
  await page.isVisible('#dlgGeoName.on') && (await page.textContent('#geoNameErr')).includes('Name erforderlich'));

await page.fill('#geoName', 'Betriebsgelände Nord');
calls = [];
await page.click('#dlgGeoName button:has-text("Speichern")');
await page.waitForFunction(() => !document.getElementById('dlgGeoName').classList.contains('on'));
await page.waitForTimeout(150);
const speicherAnfrage = calls.find(c => c.path.includes('geofence_bereich_save'));
check('KRITISCH: geofence_bereich_save.php wird mit dem richtigen Objekt gerufen', speicherAnfrage && speicherAnfrage.body.objekt_id === 1);
check('KRITISCH: genau drei Koordinaten werden geschickt', speicherAnfrage && speicherAnfrage.body.koordinaten.length === 3);
check('Der Name wird mitgeschickt', speicherAnfrage && speicherAnfrage.body.name === 'Betriebsgelände Nord');
check('KRITISCH: die Liste links zeigt den neuen Bereich', (await page.textContent('#rdKarteBereiche')).includes('Betriebsgelände Nord'));
check('Die Zeichnen-Leiste ist nach dem Speichern wieder weg', !(await page.isVisible('#rdGeoZeichnenLeiste')));
check('Das gespeicherte Vieleck steht als eigenes Polygon auf der Karte', (await page.$$('#rdKarteUebersicht .gm-mock-polygon')).length === 1);

// ══════════ KLICK AUF DEN LISTENEINTRAG OEFFNET DEN DIALOG ZUM UMBENENNEN
await page.click('#rdKarteBereiche button:has-text("Betriebsgelände Nord")');
await page.waitForSelector('#dlgGeoName.on');
check('Titel ist jetzt "umbenennen"', (await page.textContent('#dlgGeoNameTitel')) === 'Geofence-Bereich umbenennen');
check('Der Name ist vorbefüllt', (await page.inputValue('#geoName')) === 'Betriebsgelände Nord');
check('KRITISCH: der Löschen-Knopf ist jetzt sichtbar', await page.isVisible('#geoNameLoeschenBtn'));

// ══════════ UMBENENNEN
await page.fill('#geoName', 'Betriebsgelände Süd');
calls = [];
await page.click('#dlgGeoName button:has-text("Speichern")');
await page.waitForFunction(() => !document.getElementById('dlgGeoName').classList.contains('on'));
await page.waitForTimeout(150);
const umbenennenAnfrage = calls.find(c => c.path.includes('geofence_bereich_save'));
check('KRITISCH: das Umbenennen schickt die vorhandene id, keine Neuanlage', umbenennenAnfrage && umbenennenAnfrage.body.id === 1);
check('Die Liste zeigt den neuen Namen', (await page.textContent('#rdKarteBereiche')).includes('Betriebsgelände Süd'));

// ══════════ LOESCHEN MIT RUECKFRAGE
await page.click('#rdKarteBereiche button:has-text("Betriebsgelände Süd")');
await page.waitForSelector('#dlgGeoName.on');
await page.click('#geoNameLoeschenBtn');
await page.waitForSelector('#dlgConfirm.on');
check('Die Rückfrage nennt den Namen', (await page.textContent('#cfText')).includes('Betriebsgelände Süd'));
calls = [];
await page.click('#cfBtn');
await page.waitForTimeout(150);
check('KRITISCH: geofence_bereich_loeschen.php wird gerufen', calls.some(c => c.path.includes('geofence_bereich_loeschen')));
check('KRITISCH: die Liste zeigt wieder den leeren Zustand', (await page.textContent('#rdKarteBereiche')).includes('Noch kein Geofence-Bereich angelegt'));
check('Kein Vieleck mehr auf der Karte', (await page.$$('#rdKarteUebersicht .gm-mock-polygon')).length === 0);

await page.screenshot({ path: `${OUT}/geo-01-karte.png` });

// ══════════ MOBIL: DIE ZEICHNEN-LEISTE UEBERLAUFT NICHT
await page.click('#rdGeoStartenBtn');
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(200);
await page.evaluate(() => google.maps.event.trigger(rdKarteMapa, 'resize'));
await page.waitForTimeout(150);
const leisteBreite = await page.$eval('#rdGeoZeichnenLeiste', el => el.getBoundingClientRect().width);
const buehneBreite = await page.$eval('.rdkarte-buehne', el => el.getBoundingClientRect().width);
check('KRITISCH: die Zeichnen-Leiste überragt die Karten-Bühne auf dem Handy nicht (gemessen, nicht angenommen)',
  leisteBreite <= buehneBreite + 1);
await page.screenshot({ path: `${OUT}/geo-02-mobil.png` });
await page.setViewportSize({ width: 1440, height: 1000 });

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
