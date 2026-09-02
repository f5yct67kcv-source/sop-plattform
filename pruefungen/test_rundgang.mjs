// Rundgang-Ausfuehrung in der App (Revierdienst-Tool V3, ENT-180/182/145).
//
// Der Mitarbeitende startet einen Rundgang aus der Schicht-Schublade heraus,
// bestaetigt Geofence-Kontrollpunkte per Standort, meldet NFC-Punkte ehrlich
// als auf diesem Geraet nicht verfuegbar (die Belegschaft nutzt fast
// ausschliesslich iPhone, Web-NFC gibt es dort plattformbedingt nicht), und
// nicht erreichbare Punkte ueber "nicht verfuegbar" mit Pflicht-Beschreibung.
//
// Geprueft wird vor allem:
//  - Der Knopf erscheint nur unter genau den in ENT-180/182 vorausgesetzten
//    Bedingungen (zugesagt, nicht abgesagt, Schicht begonnen, Objekt hat
//    aktive Kontrollpunkte) -- keine Einsatzart-Einschraenkung, anders als
//    beim Schicht-Rapport.
//  - Eine Ablehnung durch den Server (ausserhalb des Geofence-Radius) macht
//    den Punkt wieder offen und zeigt die Fehlermeldung samt Distanz
//    (ENT-182: erneuter Versuch moeglich, alternativ "nicht verfuegbar").
//  - Das Offline-Prinzip (ENT-132 Punkt 5): ohne Netz bleibt die Meldung in
//    einer lokalen Warteschlange und wird beim naechsten Netzkontakt
//    automatisch nachgereicht, mit dem Zeitstempel der ERFASSUNG.
//  - Wiedereinstieg nach Verlust des In-Memory-Zustands: der Server, nicht
//    der Browser, ist die Wahrheit ueber einen laufenden Rundgang.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const tag = n => iso(new Date(Date.now() + n * 864e5));
const GESTERN = tag(-1), MORGEN = tag(1);

const KP = [
  { id: 1, bezeichnung: 'Eingang', reihenfolge: 1, typ: 'geofence' },
  { id: 2, bezeichnung: 'Kellerraum', reihenfolge: 2, typ: 'nfc' },
  { id: 3, bezeichnung: 'Garage', reihenfolge: 3, typ: 'geofence' },
];

// Sechs Einsaetze, die genau die Faelle der Zugangsregel abdecken.
const SCHICHTEN = () => ({ status: 'ok', von: tag(-30), bis: tag(90), schichten: [
  // Rundgang moeglich: zugesagt, Objekt mit Kontrollpunkten, bereits begonnen.
  { id: 61, kunde_name: 'Kunde A', titel: 'Nachtwache Ost', strasse: 'Ostweg 1', ort: '5013 Musterort',
    einsatzart: 'Revierdienst', sparte: 'sicherheit', datum: GESTERN, von: '20:00:00', bis: '06:00:00',
    status: 'bestaetigt', bemerkung: null, zusage: 'zugesagt', objekt_name: 'Objekt Ost', objekt_id: 1,
    hat_kontrollpunkte: true, im_team: 1 },
  // Kein Objekt mit Kontrollpunkten -- kein Rundgang moeglich.
  { id: 62, kunde_name: 'Kunde B', titel: 'Nachtwache West', strasse: null, ort: '4632 Musterstadt',
    einsatzart: 'Revierdienst', sparte: 'sicherheit', datum: GESTERN, von: '20:00:00', bis: '06:00:00',
    status: 'bestaetigt', bemerkung: null, zusage: 'zugesagt', objekt_name: 'Objekt West', objekt_id: 2,
    hat_kontrollpunkte: false, im_team: 1 },
  // Nicht zugesagt.
  { id: 63, kunde_name: 'Kunde C', titel: 'Nachtwache Sued', strasse: null, ort: '4600 Musterdorf',
    einsatzart: 'Revierdienst', sparte: 'sicherheit', datum: GESTERN, von: '20:00:00', bis: '06:00:00',
    status: 'geplant', bemerkung: null, zusage: 'offen', objekt_name: 'Objekt Sued', objekt_id: 3,
    hat_kontrollpunkte: true, im_team: 1 },
  // Noch nicht begonnen.
  { id: 64, kunde_name: 'Kunde D', titel: 'Nachtwache Morgen', strasse: null, ort: '4600 Musterdorf',
    einsatzart: 'Revierdienst', sparte: 'sicherheit', datum: MORGEN, von: '20:00:00', bis: '06:00:00',
    status: 'bestaetigt', bemerkung: null, zusage: 'zugesagt', objekt_name: 'Objekt Nord', objekt_id: 4,
    hat_kontrollpunkte: true, im_team: 1 },
  // Abgesagt.
  { id: 65, kunde_name: 'Kunde E', titel: 'Nachtwache Abgesagt', strasse: null, ort: '4600 Musterdorf',
    einsatzart: 'Revierdienst', sparte: 'sicherheit', datum: GESTERN, von: '20:00:00', bis: '06:00:00',
    status: 'abgesagt', bemerkung: null, zusage: 'zugesagt', objekt_name: 'Objekt Abgesagt', objekt_id: 5,
    hat_kontrollpunkte: true, im_team: 1 },
  // Keine Einsatzart-Einschraenkung wie beim Rapport: ein Verkehrsdienst mit
  // Objekt und Kontrollpunkten darf ebenfalls einen Rundgang haben.
  { id: 66, kunde_name: 'Kunde F', titel: 'Baustelle mit Objektwache', strasse: null, ort: '4600 Musterdorf',
    einsatzart: 'Verkehrsdienst', sparte: 'sicherheit', datum: GESTERN, von: '08:00:00', bis: '17:00:00',
    status: 'bestaetigt', bemerkung: null, zusage: 'zugesagt', objekt_name: 'Objekt Baustelle', objekt_id: 6,
    hat_kontrollpunkte: true, im_team: 1 },
]});

const PROFIL = { status: 'ok', monat: { anzahl: 0, stunden: 0 }, profil: {
  name: 'm.muster', ist_admin: false, personalnummer: 'P-001',
  vorname: 'Max', nachname: 'Muster', erstellt_am: GESTERN + ' 10:00:00' } };

// ── serverseitiger Mock-Zustand: EIN Rundgang gleichzeitig, wie im echten
// Backend (mein_rundgang_starten.php lehnt einen zweiten offenen ab).
let serverRundgang = null;
let naechsteRundgangId = 900;
let geofenceAblehnen = false;   // naechste "bestaetigt"-Geofence-Meldung ablehnen
let scanOffline = false;        // mein_rundgang_scan.php-Aufrufe schlagen netzseitig fehl
let rufe = [];

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));

// Standort-Mock: navigator.geolocation existiert in Playwright/Chromium zwar,
// liefert ohne Berechtigungsdialog aber nichts Verwertbares. Ein direkter,
// steuerbarer Ersatz ist einfacher und zuverlaessiger als Playwright-Kontext-
// Berechtigungen fuer eine file://-Seite.
await page.addInitScript(() => {
  window.__geoModus = 'ok';
  window.__geoKoord = { lat: 47.20001, lng: 7.80001 };
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: (okCb, failCb) => {
        if (window.__geoModus === 'fehler') { failCb({ code: 1, message: 'Standort verweigert' }); return; }
        okCb({ coords: { latitude: window.__geoKoord.lat, longitude: window.__geoKoord.lng } });
      },
    },
  });
});

await page.route('**/api/**', route => {
  const req = route.request();
  const url = new URL(req.url());
  const p = url.pathname.split('/api/')[1];
  if (p.includes('mein_rundgang_scan') && scanOffline) { return route.abort('internetdisconnected'); }
  let body = null;
  try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch { body = req.postData(); }
  rufe.push({ p, body, query: Object.fromEntries(url.searchParams) });
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });

  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'm.muster', ist_admin: false });
  if (p.includes('meine_schichten')) return send(SCHICHTEN());
  if (p.includes('mein_profil')) return send(PROFIL);
  if (p.includes('rapport_list')) return send({ status: 'ok', rapporte: [] });

  if (p.includes('mein_rundgang_starten')) {
    if (serverRundgang && !['abgeschlossen', 'abgebrochen'].includes(serverRundgang.status)) {
      return send({ status: 'error', message: 'Es laeuft bereits ein Rundgang fuer diesen Einsatz' });
    }
    // vorbereitet_am wie der echte Server (SELECT * FROM rundgang): Der Timer
    // der Vollseite (ENT-306) zaehlt ab dieser Zeit, nicht ab dem Moment des
    // Fortsetzens -- sonst zeigte ein zweites Geraet 00:00:00.
    const vorAm = new Date(Date.now() - 5 * 60000);
    serverRundgang = { id: ++naechsteRundgangId, einsatz_id: Number(body.einsatz_id), status: 'vorbereitet', scans: {},
      pause_minuten: 0, pausiert_seit: null, abbruch_grund: null, abbruch_freitext: null,
      vorbereitet_am: vorAm.toISOString().slice(0, 19).replace('T', ' ') };
    return send({ status: 'ok', rundgang_id: serverRundgang.id, kontrollpunkte: KP });
  }
  if (p.includes('mein_rundgang_offen')) {
    const einsatzId = Number(url.searchParams.get('einsatz_id'));
    if (!serverRundgang || serverRundgang.einsatz_id !== einsatzId
      || ['abgeschlossen', 'abgebrochen'].includes(serverRundgang.status)) {
      return send({ status: 'ok', rundgang: null });
    }
    const kontrollpunkte = KP.map(k => ({ ...k, erledigt: serverRundgang.scans[k.id] || null }));
    return send({ status: 'ok', rundgang: { id: serverRundgang.id, einsatz_id: einsatzId, status: serverRundgang.status,
      pausiert_seit: serverRundgang.pausiert_seit, vorbereitet_am: serverRundgang.vorbereitet_am,
      pause_minuten: serverRundgang.pause_minuten, kontrollpunkte } });
  }
  if (p.includes('mein_rundgang_pausieren')) {
    if (!serverRundgang || serverRundgang.id !== Number(body.rundgang_id)) { return send({ status: 'error', message: 'unbekannt' }); }
    if (!['vorbereitet', 'laeuft'].includes(serverRundgang.status)) {
      return send({ status: 'error', message: 'Dieser Rundgang laesst sich jetzt nicht pausieren' });
    }
    serverRundgang.status = 'pausiert';
    serverRundgang.pausiert_seit = tag(0) + ' 21:10:00';
    return send({ status: 'ok' });
  }
  if (p.includes('mein_rundgang_fortsetzen')) {
    if (!serverRundgang || serverRundgang.id !== Number(body.rundgang_id)) { return send({ status: 'error', message: 'unbekannt' }); }
    if (serverRundgang.status !== 'pausiert') {
      return send({ status: 'error', message: 'Dieser Rundgang ist nicht pausiert' });
    }
    serverRundgang.status = serverRundgang.rohzeitGestartet ? 'laeuft' : 'vorbereitet';
    serverRundgang.pause_minuten += 5;
    serverRundgang.pausiert_seit = null;
    return send({ status: 'ok', rundgang_status: serverRundgang.status });
  }
  if (p.includes('mein_rundgang_abbrechen')) {
    if (!serverRundgang || serverRundgang.id !== Number(body.rundgang_id)) { return send({ status: 'error', message: 'unbekannt' }); }
    if (['abgeschlossen', 'abgebrochen'].includes(serverRundgang.status)) {
      return send({ status: 'error', message: 'Dieser Rundgang ist bereits beendet' });
    }
    if (!body.grund) { return send({ status: 'error', message: 'Grund erforderlich' }); }
    serverRundgang.status = 'abgebrochen';
    serverRundgang.abbruch_grund = body.grund;
    serverRundgang.abbruch_freitext = body.freitext || null;
    serverRundgang.pausiert_seit = null;
    return send({ status: 'ok' });
  }
  if (p.includes('mein_rundgang_scan')) {
    if (!serverRundgang || serverRundgang.id !== Number(body.rundgang_id)) {
      return send({ status: 'error', message: 'Dieser Rundgang gehoert nicht zu dir' });
    }
    if (serverRundgang.status === 'pausiert') {
      return send({ status: 'error', message: 'Dieser Rundgang ist pausiert -- erst fortsetzen' });
    }
    const ergebnisse = body.scans.map(s => {
      if (s.status === 'bestaetigt' && geofenceAblehnen) {
        geofenceAblehnen = false;
        return { kontrollpunkt_id: s.kontrollpunkt_id, status: 'fehler',
          message: 'Ausserhalb des Kontrollpunkt-Bereichs (438m entfernt).' };
      }
      if (serverRundgang.scans[s.kontrollpunkt_id]) {
        return { kontrollpunkt_id: s.kontrollpunkt_id, status: 'bereits_erfasst' };
      }
      serverRundgang.scans[s.kontrollpunkt_id] = { status: s.status, erfasst_am: s.erfasst_am, beschreibung: s.beschreibung || null };
      // Wie im echten Backend (mein_rundgang_scan.php): die Rohzeit -- hier
      // vereinfacht als Merker -- beginnt erst mit dem ERSTEN BESTAETIGTEN
      // Punkt, nicht mit "nicht verfuegbar" (ENT-145).
      if (s.status === 'bestaetigt') { serverRundgang.rohzeitGestartet = true; }
      return { kontrollpunkt_id: s.kontrollpunkt_id, status: 'ok' };
    });
    const alleErledigt = KP.every(k => serverRundgang.scans[k.id]);
    if (alleErledigt) { serverRundgang.status = 'abgeschlossen'; }
    return send({ status: 'ok', rundgang_status: serverRundgang.status, ergebnisse });
  }
  return send({ status: 'ok' });
});

await page.goto(`file://${WURZEL}/app.html`);
await page.fill('#gName', 'm.muster'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('.app.on');
await page.waitForTimeout(400);

// ══════════════════════════════ ZUGANGSREGEL ══════════════════════════════
const knopfDa = async id => {
  await page.evaluate(i => blattAuf(i), id);
  await page.waitForTimeout(250);
  const da = await page.evaluate(() =>
    [...document.querySelectorAll('#blRundgang button')].some(b => b.textContent.includes('Rundgang starten')));
  await page.evaluate(() => blattZu());
  await page.waitForTimeout(150);
  return da;
};
check('KRITISCH: Knopf erscheint bei zugesagtem, begonnenem Einsatz mit Kontrollpunkten', await knopfDa(61));
check('KRITISCH: kein Knopf ohne Kontrollpunkte am Objekt', !(await knopfDa(62)));
check('KRITISCH: kein Knopf ohne Zusage', !(await knopfDa(63)));
check('KRITISCH: kein Knopf, bevor die Schicht begonnen hat', !(await knopfDa(64)));
check('KRITISCH: kein Knopf bei abgesagtem Einsatz', !(await knopfDa(65)));
check('KRITISCH: keine Einsatzart-Einschraenkung -- auch Verkehrsdienst mit Objekt darf einen Rundgang haben',
  await knopfDa(66));
check('KRITISCH: das blosse Ansehen der Schicht startet noch keinen Rundgang',
  !rufe.some(r => r.p.includes('mein_rundgang_starten')));

// ══════════════════════════════ START ══════════════════════════════
rufe = [];
await page.evaluate(() => blattAuf(61));
await page.waitForTimeout(250);
await page.click('#blRundgang button:has-text("Rundgang starten")');
await page.waitForTimeout(300);
const gestartet = rufe.find(r => r.p.includes('mein_rundgang_starten'));
check('KRITISCH: Start ruft mein_rundgang_starten.php mit der richtigen einsatz_id',
  !!gestartet && gestartet.body.einsatz_id === 61);
// Seit ENT-306 ist die laufende Runde eine Vollseite, keine Schublade. Der
// Zaehler steht im Kopf, wo er auch beim Scrollen sichtbar bleibt.
check('KRITISCH: die laufende Runde oeffnet als Vollseite mit Reitern',
  await page.isVisible('#rgSeite') && await page.isVisible('#rgsReiter'));
check('KRITISCH: der Zaehler zeigt 0 von 3 -- nichts vorbelegt',
  (await page.textContent('#rgsZaehler')) === '0 / 3');
check('KRITISCH: der Zaehler nennt beide Zahlen, nicht nur die erledigten (CLAUDE.md: keine Zahl ohne Bezug)',
  (await page.textContent('#rgsZaehler')).includes('/'));
check('Der Timer laeuft und steht im Kopf',
  /^\d{2}:\d{2}:\d{2}$/.test((await page.textContent('#rgsTimer')).trim()));
check('Alle drei Kontrollpunkte erscheinen in der richtigen Reihenfolge',
  await page.evaluate(() => [...document.querySelectorAll('.rd-bez')].map(e => e.textContent)
    .join('|') === 'Eingang|Kellerraum|Garage'));
check('KRITISCH: NFC-Punkt zeigt ehrlich "nicht unterstuetzt" statt eine Scan-Funktion vorzutaeuschen',
  (await page.textContent('#rdListe')).includes('NFC wird auf diesem Gerät nicht unterstützt'));
check('KRITISCH: der NFC-Punkt hat keinen "Bestätigen"-Knopf',
  await page.evaluate(() => !document.getElementById('rdBtn2')));
check('Der Geofence-Punkt hat einen "Bestätigen"-Knopf', await page.evaluate(() => !!document.getElementById('rdBtn1')));
await page.screenshot({ path: `${OUT}/rd-01-checkliste.png` });

// ══════════════════════════════ GEOFENCE: ABLEHNUNG ══════════════════════
rufe = [];
geofenceAblehnen = true;
await page.evaluate(() => { window.__geoKoord = { lat: 47.9, lng: 7.1 }; });
await page.click('#rdBtn1');
await page.waitForTimeout(400);
const ersterVersuch = rufe.find(r => r.p.includes('mein_rundgang_scan'));
check('KRITISCH: der Standort wird im Moment des Antippens abgefragt und mitgeschickt',
  !!ersterVersuch && typeof ersterVersuch.body.scans[0].lat === 'number');
check('KRITISCH: eine Ablehnung durch den Server macht den Punkt wieder offen, nicht "erledigt"',
  await page.evaluate(() => !!document.getElementById('rdBtn1')));
check('KRITISCH: die Fehlermeldung samt Distanz wird angezeigt (ENT-182)',
  (await page.textContent('#rdListe')).includes('438m entfernt'));
check('Der Zaehler bleibt bei 0 von 3', (await page.textContent('#rgsZaehler')) === '0 / 3');

// ══════════════════════════════ GEOFENCE: ERFOLGREICH ══════════════════════
rufe = [];
await page.evaluate(() => { window.__geoKoord = { lat: 47.20001, lng: 7.80001 }; });
await page.click('#rdBtn1');
await page.waitForTimeout(400);
check('Der Punkt zeigt jetzt "Bestätigt"', (await page.textContent('#rdListe')).includes('Bestätigt'));
check('KRITISCH: der Zaehler zaehlt jetzt 1 von 3', (await page.textContent('#rgsZaehler')) === '1 / 3');
check('KRITISCH: der Zeitstempel ist geraeteseitig im MySQL-Format (Offline-Prinzip, ENT-132)',
  /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(
    rufe.find(r => r.p.includes('mein_rundgang_scan')).body.scans[0].erfasst_am));

// ══════════════════════════════ PAUSIEREN / FORTSETZEN (ENT-146) ══════════
// Seit ENT-306 stehen Pausieren und Abbrechen als eigene Funktionen im
// Reiter, nicht mehr hinter einem roten "Beenden" (dieselbe Ueberlegung wie
// ENT-298: ein Knopf, der nach Abbruch aussieht, ist der falsche Weg zum
// kurzen Unterbrechen).
rufe = [];
await page.click('#rgsRt-funktionen');
await page.waitForTimeout(200);
check('KRITISCH: Pausieren und Abbrechen stehen als eigene Funktionen da, solange die Runde laeuft',
  await page.isVisible('#rgsLaufPause') && await page.isVisible('#rgsLaufAbbrechen'));
check('KRITISCH: der Wechsel des Reiters sendet nichts', rufe.length === 0);

// Rueckfrage vor dem Pausieren (ENT-298) -- und "Nein" darf nichts ausloesen.
await page.click('#rgsLaufPause');
await page.waitForTimeout(200);
rufe = [];
await page.click('#rgsDlgNein');
await page.waitForTimeout(200);
check('KRITISCH: "Nein" in der Rueckfrage sendet nichts',
  rufe.length === 0 && !(await page.isVisible('#rgsDlg')));

// Jetzt tatsaechlich pausieren.
await page.click('#rgsLaufPause');
await page.waitForTimeout(200);
rufe = [];
await page.click('#rgsDlgJa');
await page.waitForTimeout(400);
check('KRITISCH: Pausieren ruft mein_rundgang_pausieren.php mit der richtigen rundgang_id',
  !!rufe.find(r => r.p.includes('mein_rundgang_pausieren') && r.body.rundgang_id === serverRundgang.id));
await page.click('#rgsRt-punkte');
await page.waitForTimeout(200);
check('KRITISCH: der Pausiert-Hinweis erscheint', (await page.textContent('#rdBanner')).includes('pausiert'));
check('KRITISCH: waehrend der Pause gibt es keine Kontrollpunkt-Aktionen mehr',
  await page.evaluate(() => !document.querySelector('#rdListe button')));
await page.click('#rgsRt-funktionen');
await page.waitForTimeout(200);
check('Aus "Pausieren" wird "Fortsetzen"',
  (await page.textContent('#rgsLaufPause')).includes('fortsetzen'));

// Sperre gehoert in den Server, nicht nur in die Oberflaeche: direkt gegen
// den Endpunkt geprueft, nicht nur ueber die (ohnehin fehlenden) Knoepfe.
const scanWaehrendPause = await page.evaluate(async (id) => {
  const r = await fetch('api/mein_rundgang_scan.php', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Auth-Token': 't' },
    body: JSON.stringify({ rundgang_id: id, scans: [{ kontrollpunkt_id: 3, status: 'bestaetigt',
      erfasst_am: '2026-01-01 00:00:00', lat: 47.2, lng: 7.8 }] }) });
  return r.json();
}, serverRundgang.id);
check('KRITISCH: der Server lehnt einen Scan waehrend der Pause ab, nicht nur die Oberflaeche',
  scanWaehrendPause.status === 'error');

// Fortsetzen.
rufe = [];
await page.click('#rgsLaufPause');
await page.waitForTimeout(400);
check('KRITISCH: Fortsetzen ruft mein_rundgang_fortsetzen.php',
  !!rufe.find(r => r.p.includes('mein_rundgang_fortsetzen') && r.body.rundgang_id === serverRundgang.id));
check('KRITISCH: nach dem Fortsetzen steht wieder "Pausieren" da',
  (await page.textContent('#rgsLaufPause')).includes('pausieren'));
await page.click('#rgsRt-punkte');
await page.waitForTimeout(250);
check('KRITISCH: kein Pausiert-Hinweis mehr',
  !(await page.textContent('#rdBanner')).includes('pausiert'));
check('KRITISCH: die Kontrollpunkt-Aktionen sind nach dem Fortsetzen wieder da',
  await page.evaluate(() => !!document.getElementById('rdBtn3')));

// ══════════════════════════════ NICHT VERFUEGBAR (NFC-Punkt) ══════════════
check('Die Beschreibung ist zunaechst eingeklappt',
  await page.evaluate(() => document.getElementById('rdNv2').style.display === 'none'));
await page.click('#rdListe .rd-zeile:nth-child(2) button:has-text("Nicht verfügbar")');
await page.waitForTimeout(150);
check('Der Knopf klappt das Beschreibungsfeld auf',
  await page.evaluate(() => document.getElementById('rdNv2').style.display !== 'none'));
await page.click('#rdNv2 button:has-text("Melden")');
await page.waitForTimeout(200);
check('KRITISCH: ohne Beschreibung wird nichts gesendet', (await page.textContent('#rdFehler2')).length > 0);
check('Das Beschreibungsfeld ist mindestens 16px -- sonst zoomt iOS hinein',
  await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('rdNvText2')).fontSize) >= 16));
await page.fill('#rdNvText2', 'Chip abgerissen');
rufe = [];
await page.click('#rdNv2 button:has-text("Melden")');
await page.waitForTimeout(300);
const nvGesendet = rufe.find(r => r.p.includes('mein_rundgang_scan'));
check('KRITISCH: "nicht verfuegbar" sendet Status und Beschreibung',
  !!nvGesendet && nvGesendet.body.scans[0].status === 'nicht_verfuegbar'
  && nvGesendet.body.scans[0].beschreibung === 'Chip abgerissen');
check('KRITISCH: der Zaehler zaehlt "nicht verfuegbar" ebenfalls als erledigt (ENT-145)',
  (await page.textContent('#rgsZaehler')) === '2 / 3');
check('Der Punkt zeigt ein Warnsymbol statt eines Hakens',
  await page.evaluate(() => !!document.querySelector('.rd-haken-nv')));

// ══════════════════════════════ OFFLINE-WARTESCHLANGE ══════════════════════
scanOffline = true;
rufe = [];
await page.evaluate(() => { window.__geoKoord = { lat: 47.20001, lng: 7.80001 }; });
await page.click('#rdBtn3');
await page.waitForTimeout(400);
check('KRITISCH: bei einer offline erfassten Meldung bleibt der Punkt sofort als erledigt sichtbar (Erfassung zaehlt, nicht Uebermittlung)',
  (await page.textContent('#rdFortschritt')).includes('Rundgang abgeschlossen'));
check('KRITISCH: der Hinweis "wird uebermittelt" erscheint, solange die Meldung nicht angekommen ist',
  (await page.textContent('#rdListe')).includes('wird übermittelt'));
const wartend = await page.evaluate(() => JSON.parse(localStorage.getItem('sop_rundgang_warteschlange') || '[]'));
check('KRITISCH: die Meldung liegt lokal in der Warteschlange, solange sie nicht angekommen ist',
  wartend.length === 1 && wartend[0].kontrollpunkt_id === 3);
check('KRITISCH: kein Rundgang-Scan-Aufruf hat den Server tatsaechlich erreicht (Verbindung war unterbrochen)',
  !serverRundgang.scans[3]);
await page.click('#rgsRt-funktionen');
await page.waitForTimeout(200);
check('KRITISCH: ein bereits vollstaendig erledigter Rundgang bietet weder Pausieren noch Abbrechen an',
  !(await page.isVisible('#rgsLaufPause')) && !(await page.isVisible('#rgsLaufAbbrechen')));
await page.click('#rgsRt-punkte');
await page.waitForTimeout(200);

// ── Netz kommt zurueck: automatisches Nachsenden ohne Nutzerzutun
scanOffline = false;
await page.evaluate(() => window.dispatchEvent(new Event('online')));
await page.waitForTimeout(400);
check('KRITISCH: sobald wieder Netz da ist, wird automatisch nachgesendet',
  !!serverRundgang.scans[3]);
check('Der Hinweis "wird uebermittelt" verschwindet nach erfolgreicher Uebermittlung',
  !(await page.textContent('#rdListe')).includes('wird übermittelt'));
const wartendDanach = await page.evaluate(() => JSON.parse(localStorage.getItem('sop_rundgang_warteschlange') || '[]'));
check('KRITISCH: die Warteschlange ist danach leer', wartendDanach.length === 0);
check('KRITISCH: der Status wird nach der Uebermittlung serverseitig auf abgeschlossen nachgezogen',
  await page.evaluate(() => rundgangAktiv.status === 'abgeschlossen'));

check('KRITISCH: kein Seiten-Scroll bei 390px', await page.evaluate(() =>
  document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
await page.screenshot({ path: `${OUT}/rd-02-abgeschlossen.png` });

// ══════════════════════════════ WIEDEREINSTIEG ══════════════════════════
// Der Server, nicht der Browser, ist die Wahrheit: der In-Memory-Zustand der
// App wird verworfen (Neuladen/Tab-Wechsel simuliert) und die Schicht erneut
// geoeffnet -- der Rundgang ist bereits abgeschlossen, also wieder "starten".
await page.evaluate(() => { rundgangAktiv = null; });
await page.evaluate(() => blattAuf(61));
await page.waitForTimeout(300);
check('KRITISCH: nach Abschluss bietet die Schicht wieder "Rundgang starten" an (mehrere Rundgaenge pro Schicht sind vorgesehen)',
  await page.evaluate(() =>
    [...document.querySelectorAll('#blRundgang button')].some(b => b.textContent.includes('Rundgang starten'))));
await page.evaluate(() => blattZu());

// Ein zweiter Rundgang, diesmal wird der In-Memory-Zustand MITTEN im Rundgang
// verworfen -- "Fortsetzen" muss den tatsaechlichen Serverstand zeigen, nicht
// wieder bei 0 beginnen.
await page.evaluate(() => blattAuf(61));
await page.waitForTimeout(250);
await page.click('#blRundgang button:has-text("Rundgang starten")');
await page.waitForTimeout(300);
await page.evaluate(() => { window.__geoKoord = { lat: 47.20001, lng: 7.80001 }; });
await page.click('#rdBtn1');
await page.waitForTimeout(300);
await page.evaluate(() => { rundgangAktiv = null; });
await page.evaluate(() => blattAuf(61));
await page.waitForTimeout(300);
check('KRITISCH: nach Verlust des In-Memory-Zustands zeigt der Knopf "Fortsetzen", nicht erneut "Starten"',
  await page.evaluate(() =>
    [...document.querySelectorAll('#blRundgang button')].some(b => b.textContent.includes('Rundgang fortsetzen'))));
await page.click('#blRundgang button:has-text("Rundgang fortsetzen")');
await page.waitForTimeout(300);
check('KRITISCH: Fortsetzen zeigt den tatsaechlichen Serverstand -- der bereits bestaetigte Punkt bleibt erledigt',
  (await page.textContent('#rgsZaehler')) === '1 / 3');
// Die Laufzeit kommt beim Fortsetzen vom SERVER (vorbereitet_am), nicht vom
// Geraet: Wer die Runde auf einem zweiten Geraet fortsetzt, soll dieselbe
// Zeit sehen -- eine geraeteseitig neu gestartete Uhr zeigte 00:00:00.
check('KRITISCH: der Timer zaehlt nach dem Fortsetzen ab dem echten Rundgangbeginn weiter',
  (await page.textContent('#rgsTimer')).trim() !== '00:00:00'
  && /^\d{2}:\d{2}:\d{2}$/.test((await page.textContent('#rgsTimer')).trim()));

// ══════════════════════════════ ABBRECHEN (ENT-146) ══════════════════════
await page.click('#rgsRt-funktionen');
await page.waitForTimeout(200);
await page.click('#rgsLaufAbbrechen');
await page.waitForTimeout(250);
check('KRITISCH: der Hinweis nennt den Abbruch als endgueltig', (await page.textContent('#blBody')).includes('endgültig'));
rufe = [];
await page.click('#blFuss button:has-text("Abbrechen bestätigen")');
await page.waitForTimeout(200);
check('KRITISCH: ohne ausgewaehlten Grund wird nichts gesendet',
  rufe.length === 0 && (await page.textContent('#raErr')).length > 0);
await page.selectOption('#raGrund', 'notfall_gebunden');
await page.fill('#raFreitext', 'Kollege krank, musste einspringen');
rufe = [];
await page.click('#blFuss button:has-text("Abbrechen bestätigen")');
await page.waitForTimeout(300);
const abbruchRuf = rufe.find(r => r.p.includes('mein_rundgang_abbrechen'));
check('KRITISCH: Abbrechen sendet Grund und Freitext an den Server',
  !!abbruchRuf && abbruchRuf.body.grund === 'notfall_gebunden' && abbruchRuf.body.freitext.includes('Kollege krank'));
check('KRITISCH: die Checkliste zeigt danach "Abgebrochen", nicht mehr den Fortschritt',
  (await page.textContent('#rdFortschritt')).includes('Abgebrochen'));
check('Der Zaehler im Kopf steht dabei weiterhin auf dem tatsaechlichen Stand',
  (await page.textContent('#rgsZaehler')) === '1 / 3');
check('KRITISCH: der Abbruchgrund wird angezeigt', (await page.textContent('#rdBanner')).includes('Durch Notfall anderweitig gebunden'));
check('KRITISCH: bereits bestaetigte Kontrollpunkte bleiben nach dem Abbruch sichtbar (ENT-146 Punkt 3)',
  (await page.textContent('#rdListe')).includes('Bestätigt'));
check('KRITISCH: nach einem Abbruch gibt es keine Aktions-Knoepfe mehr in der Liste',
  await page.evaluate(() => !document.querySelector('#rdListe button')));
// Seit ENT-306 fuehrt der Pfeil im Kopf aus der Seite heraus; einen
// Schubladenfuss gibt es hier nicht mehr.
await page.click('#rgsZurueck');
await page.waitForTimeout(250);
check('KRITISCH: der Zurueck-Pfeil schliesst die Seite',
  !(await page.isVisible('#rgSeite')));
await page.evaluate(() => blattAuf(61));
await page.waitForTimeout(300);
check('KRITISCH: nach einem Abbruch bietet die Schicht wieder "Rundgang starten" an',
  await page.evaluate(() =>
    [...document.querySelectorAll('#blRundgang button')].some(b => b.textContent.includes('Rundgang starten'))));
await page.evaluate(() => blattZu());

// ══════════════════════ ABBRECHEN WAEHREND DER PAUSE (gemeldeter Fehler) ══
// Bisher liess sich ein pausierter Rundgang zwar wieder aufnehmen, aber nie
// abbrechen -- der Fuss zeigte in "pausiert" nur "Fortsetzen" an, keinen Weg
// zum (bereits bestehenden) Pflichtgrund-Dialog. Ein vierter, frischer
// Rundgang: starten, pausieren, aus der Pause heraus abbrechen.
await page.evaluate(() => blattAuf(61));
await page.waitForTimeout(250);
await page.click('#blRundgang button:has-text("Rundgang starten")');
await page.waitForTimeout(300);
await page.click('#rgsRt-funktionen');
await page.waitForTimeout(200);
await page.click('#rgsLaufPause');
await page.waitForTimeout(200);
await page.click('#rgsDlgJa');
await page.waitForTimeout(400);
// Der gemeldete Fehler aus ENT-290: Ein pausierter Rundgang liess sich nur
// fortsetzen, nie abbrechen. Als Reiter stehen beide Wege nebeneinander --
// die Weiche entfaellt damit ganz.
check('KRITISCH: waehrend der Pause stehen Abbrechen UND Fortsetzen zur Wahl',
  await page.isVisible('#rgsLaufAbbrechen') && await page.isVisible('#rgsLaufPause')
  && (await page.textContent('#rgsLaufPause')).includes('fortsetzen'));
rufe = [];
await page.click('#rgsLaufAbbrechen');
await page.waitForTimeout(250);
check('KRITISCH: Abbrechen aus der Pause heraus oeffnet denselben Pflichtgrund-Dialog wie im laufenden Rundgang',
  (await page.textContent('#blBody')).includes('endgültig'));
await page.selectOption('#raGrund', 'notfall_gebunden');
await page.fill('#raFreitext', 'Pausiert und danach doch abgebrochen');
await page.click('#blFuss button:has-text("Abbrechen bestätigen")');
await page.waitForTimeout(300);
const abbruchAusPause = rufe.find(r => r.p.includes('mein_rundgang_abbrechen'));
check('KRITISCH: der Abbruch aus der Pause heraus erreicht tatsaechlich den Server',
  !!abbruchAusPause && abbruchAusPause.body.grund === 'notfall_gebunden');
check('KRITISCH: die Checkliste zeigt danach "Abgebrochen"',
  (await page.textContent('#rdFortschritt')).includes('Abgebrochen'));
await page.click('#rgsRt-funktionen');
await page.waitForTimeout(200);
check('KRITISCH: nach dem Abbruch steht weder Pausieren noch Abbrechen mehr da',
  !(await page.isVisible('#rgsLaufPause')) && !(await page.isVisible('#rgsLaufAbbrechen')));
await page.click('#rgsZurueck');
await page.waitForTimeout(250);
await page.evaluate(() => blattZu());

// Desktop: dieselbe Aenderung zusaetzlich am Desktop pruefen (CLAUDE.md).
// Der vorige Rundgang wurde soeben abgebrochen -- ein dritter, frischer
// Rundgang ist erwartungsgemaess wieder ueber "Rundgang starten" erreichbar.
await page.setViewportSize({ width: 1440, height: 900 });
await page.evaluate(() => { blattAuf(61); });
await page.waitForTimeout(250);
await page.click('#blRundgang button:has-text("Rundgang starten")');
await page.waitForTimeout(300);
check('Am Desktop bleibt die Checkliste vollstaendig bedienbar',
  await page.isVisible('#rdListe') && await page.isVisible('#rdBtn3'));
check('KRITISCH: am Desktop kein Seiten-Scroll', await page.evaluate(() =>
  document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
// Die Seite haelt am Desktop App-Breite (ENT-294) -- die Reiterleiste darf
// nicht darueber hinauslaufen.
check('KRITISCH: die Reiterleiste bleibt am Desktop in der App-Breite',
  await page.evaluate(() => {
    const r = document.getElementById('rgsReiter').getBoundingClientRect();
    const s = document.getElementById('rgSeite').getBoundingClientRect();
    return r.width <= s.width + 1 && s.width <= 561;
  }));
check('KRITISCH: die Reiter sind mindestens 44px hoch (CLAUDE.md)',
  await page.evaluate(() => [...document.querySelectorAll('#rgsReiter button')]
    .every(b => b.getBoundingClientRect().height >= 44)));
await page.click('#rgsRt-funktionen');
await page.waitForTimeout(200);
check('Die Funktionen sind auch am Desktop vollstaendig bedienbar, kein Seiten-Scroll',
  await page.isVisible('#rgsLaufPause')
  && await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
await page.screenshot({ path: `${OUT}/rd-03-desktop.png` });

await browser.close();

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
