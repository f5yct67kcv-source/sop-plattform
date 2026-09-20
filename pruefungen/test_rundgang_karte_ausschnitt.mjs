// Die Karte behaelt ihren Ausschnitt, und „Zentrieren" findet den Standort
// (ENT-639).
//
// Zwei Meldungen des Projektinhabers vom Geraet:
//   „Beim Wechsel von hell zu dunkel ist der Wechsel sehr unruhig. Die
//    Karte zoomt immer Richtung Kontrollpunkt."
//   „Zentrieren geht nicht zurück zum Standort!"
//
// Befund 1: Die Browser-Fassung merkt sich Zoom, Mitte und Drehung vor
// einem Neubau (rgsKarteAnsicht). Die NATIVE Fassung -- also die in der App
// -- tat das nie; der Kommentar dort behauptete ausdruecklich das
// Gegenteil. Jeder Neuaufbau passte den Ausschnitt wieder auf die
// Kontrollpunkte ein. Und neu gebaut wird nicht nur beim Nachtsicht-
// Schalter, sondern bei JEDEM Reiterwechsel -- also auch, wenn man ins
// Menue geht, um hell/dunkel umzuschalten, und zurueckkommt.
//
// Befund 2: „Zentrieren" fuehrte nur dann auf den eigenen Standort, wenn
// die App bereits eine Position hatte -- die hat sie nur bei LAUFENDER
// Ortung und erst nach dem ersten Fix. Sonst fiel der Knopf still auf die
// Kontrollpunkte zurueck, ohne den Standort ueberhaupt zu ERFRAGEN.
//
// Gepruefte AUSSAGE, nicht Aufruf: Die Attrappe der nativen Karte merkt
// sich, auf welchen Ausschnitt sie gestellt wurde. Verglichen wird, ob das
// der zuletzt betrachtete ist oder der der Kontrollpunkte -- zwei bewusst
// weit auseinanderliegende Gebiete, damit eine Verwechslung nicht zufaellig
// durchgeht.
import { WURZEL, browserPfad } from './pfade.mjs';
import { GOOGLE_MAPS_MOCK } from './google_maps_mock.mjs';
import { chromium } from 'playwright';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const tag = n => iso(new Date(Date.now() + n * 864e5));
const uhr = min => {
  const d = new Date(Date.now() + min * 60000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:00`;
};

// Die Kontrollpunkte liegen um 47.35 / 7.90. Der „zuletzt betrachtete"
// Ausschnitt liegt bewusst weit weg davon (47.60 / 8.40) -- waere er
// benachbart, ginge eine Verwechslung durch die Pruefung hindurch.
const ORT = { lat: 47.3500, lng: 7.9000 };

const RUNDE = () => ({
  id: 951, status: 'laeuft', pausiert_seit: null,
  vorbereitet_am: `${tag(0)} ${uhr(-41)}`, pause_minuten: 0,
  vorlage_name: 'Runde Nacht A', fenster_von: uhr(-60), fenster_bis: uhr(120),
  objekt: { id: 7, name: 'Musterobjekt Ost', strasse: 'Musterweg 4', ort: '9999 Musterdorf' },
  kunde_name: 'Musterliegenschaften AG', ansprechpartner: [], zentrale: null,
  kontrollpunkte: [
    { id: 1, bezeichnung: 'Lager B', reihenfolge: 1, typ: 'geofence', lat: 47.3520, lng: 7.9000,
      geofence_radius_m: 20, erledigt: null, aufgaben: [] },
    { id: 2, bezeichnung: 'Nebentor', reihenfolge: 2, typ: 'geofence', lat: 47.3560, lng: 7.9060,
      geofence_radius_m: 20, erledigt: null, aufgaben: [] },
  ],
});

const SCHICHTEN = { status: 'ok', von: tag(-30), bis: tag(90), schichten: [
  { id: 71, kunde_name: 'Musterliegenschaften AG', titel: 'Nachtwache',
    strasse: 'Musterweg 4', ort: '9999 Musterdorf', einsatzart: 'Revierdienst',
    sparte: 'sicherheit', datum: tag(0), von: '20:00:00', bis: '06:00:00',
    status: 'bestaetigt', bemerkung: null, zusage: 'zugesagt',
    objekt_name: 'Musterobjekt Ost', objekt_id: 7, hat_kontrollpunkte: true, im_team: 1 }] };
const PROFIL = { status: 'ok', monat: { anzahl: 0, stunden: 0 },
  profil: { name: 'm.muster', ist_admin: false, personalnummer: 'P-001',
    vorname: 'Max', nachname: 'Muster', erstellt_am: tag(-30) + ' 10:00:00' } };

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
  permissions: ['geolocation'],
  geolocation: { latitude: ORT.lat, longitude: ORT.lng, accuracy: 8 },
});
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
await page.route('**/api/**', route => {
  const p = new URL(route.request().url()).pathname.split('/api/')[1];
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'm.muster', ist_admin: false });
  if (p.includes('meine_schichten')) return send(SCHICHTEN);
  if (p.includes('mein_profil')) return send(PROFIL);
  if (p.includes('rapport_list')) return send({ status: 'ok', rapporte: [] });
  if (p.includes('mein_rundgang_offen')) return send({ status: 'ok', rundgang: RUNDE() });
  return send({ status: 'ok' });
});
await page.route('**maps.googleapis.com/**', route =>
  route.fulfill({ status: 200, contentType: 'application/javascript', body: GOOGLE_MAPS_MOCK }));
await page.goto(`file://${WURZEL}/app.html`);
await page.fill('#gName', 'm.muster'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('.app.on'); await page.waitForTimeout(400);
await page.evaluate(() => ladeSchichten().then(() => rundgangFortsetzen(71)));
await page.waitForTimeout(1200);
await page.click('#rgsRt-karte');
await page.waitForTimeout(900);

check('Ausgangslage: die Kartenseite steht und traegt den Zentrieren-Knopf',
  await page.evaluate(() => !!document.getElementById('rgsZentrieren')));

/* Eine Attrappe der nativen Karte, die sich merkt, worauf sie gestellt
   wurde. Ihr getMapBounds() liefert IMMER den entfernten Ausschnitt -- das
   bildet den Waechter nach, der die Karte verschoben hat. */
const NATIV_AUFBAU = `
  window.__karte = { fit: [], cam: [] };
  window.KarteNativ = { GoogleMap: { create: async () => ({
    setCamera: async (o) => { window.__karte.cam.push(o); },
    fitBounds: async (b) => { window.__karte.fit.push(b); },
    getMapBounds: async () => window.__grenzen,
    setOnCameraIdleListener: async () => {},
    setOnMarkerClickListener: async () => {},
    enableCurrentLocation: async () => {},
    addCircles: async (l) => l.map((_, i) => 'k' + i),
    removeCircles: async () => {},
    addMarkers: async (l) => l.map((_, i) => 'm' + i),
    removeMarkers: async () => {},
    destroy: async () => {},
  }) } };`;

// ══════════ DER ERSTE AUFBAU ZEIGT DIE KONTROLLPUNKTE ═════════════════
// Wer die Karte zum ersten Mal oeffnet, will sehen, worum es geht. Ohne
// diese Pruefung koennte die Reparatur unten auch dadurch „gelingen", dass
// gar nichts mehr eingepasst wird.
const ersteFahrt = await page.evaluate(async (aufbau) => {
  eval(aufbau);
  window.__grenzen = null;
  rgsNativAnsicht = null; rgsNativKarte = null;
  const d = rgKarteDaten(rundgangAktiv.kontrollpunkte);
  await rgKarteNativBauen(d, ++rgsKarteBauLauf);
  const f = window.__karte.fit[0] || null;
  await rgKarteNativAbbauen();
  document.body.classList.remove('karte-nativ');
  return f;
}, NATIV_AUFBAU);
check('KRITISCH: der erste Aufbau einer Runde passt die Karte auf die Kontrollpunkte ein',
  !!ersteFahrt && Math.abs(ersteFahrt.southwest.lat - 47.3520) < 0.001
  && Math.abs(ersteFahrt.northeast.lat - 47.3560) < 0.001);

// ══════════ JEDER WEITERE AUFBAU BEHAELT DEN AUSSCHNITT ═══════════════
const zweiteFahrt = await page.evaluate(async (aufbau) => {
  eval(aufbau);
  // Der Waechter hat die Karte verschoben: Die Grenzen, die sie beim
  // Stillstand der Kamera meldet, liegen woanders.
  window.__grenzen = { southwest: { lat: 47.60, lng: 8.40 }, northeast: { lat: 47.62, lng: 8.44 } };
  rgsNativAnsicht = null; rgsNativKarte = null;
  const d = rgKarteDaten(rundgangAktiv.kontrollpunkte);
  await rgKarteNativBauen(d, ++rgsKarteBauLauf);      // erster Aufbau
  await new Promise(r => setTimeout(r, 60));          // Grenzen einlesen lassen
  const gemerkt = !!rgsNativAnsicht;
  await rgKarteNativAbbauen();                         // Nachtsicht / Reiterwechsel
  window.__karte.fit = [];
  rgsNativKarte = null;
  await rgKarteNativBauen(d, ++rgsKarteBauLauf);      // zweiter Aufbau
  const f = window.__karte.fit[0] || null;
  await rgKarteNativAbbauen();
  document.body.classList.remove('karte-nativ');
  return { gemerkt, f };
}, NATIV_AUFBAU);
check('Der betrachtete Ausschnitt wird ueberhaupt gemerkt',
  zweiteFahrt.gemerkt === true);
check('KRITISCH: nach dem Neubau steht die Karte wieder dort, wo der Waechter hingeschaut hat — nicht auf den Kontrollpunkten',
  !!zweiteFahrt.f && Math.abs(zweiteFahrt.f.southwest.lat - 47.60) < 0.001
  && Math.abs(zweiteFahrt.f.northeast.lat - 47.62) < 0.001);
check('KRITISCH: und ganz sicher NICHT auf den Kontrollpunkten — das war der gemeldete Fehler',
  !!zweiteFahrt.f && Math.abs(zweiteFahrt.f.southwest.lat - 47.3520) > 0.1);

// Ein fehlgeschlagener Grenzabruf darf den gemerkten Ausschnitt nicht
// loeschen -- sonst faellt die Karte beim naechsten Neubau doch wieder
// zurueck, und zwar unregelmaessig, was am schwersten zu finden ist.
check('KRITISCH: ein misslungener Grenzabruf loescht den gemerkten Ausschnitt nicht',
  await page.evaluate(async () => {
    rgsNativAnsicht = { southwest: { lat: 47.60, lng: 8.40 }, northeast: { lat: 47.62, lng: 8.44 } };
    rgsNativKarte = { getMapBounds: async () => { throw new Error('nichts'); } };
    await rgKarteNativGrenzenLesen();
    const heil = !!rgsNativAnsicht && rgsNativAnsicht.southwest.lat === 47.60;
    rgsNativKarte = null;
    return heil;
  }));

// Und er gehoert zu DIESER Runde: Wer die Runde verlaesst, darf die naechste
// Karte nicht ueber einem fremden Objekt oeffnen.
check('KRITISCH: beim Verlassen der Runde wird der gemerkte Ausschnitt vergessen',
  await page.evaluate(async () => {
    rgsNativAnsicht = { southwest: { lat: 47.60, lng: 8.40 }, northeast: { lat: 47.62, lng: 8.44 } };
    rgSeiteZu();
    return rgsNativAnsicht === null;
  }));

// ══════════ ZENTRIEREN FRAGT NACH DEM STANDORT ════════════════════════
await page.evaluate(() => ladeSchichten().then(() => rundgangFortsetzen(71)));
await page.waitForTimeout(1200);
await page.click('#rgsRt-karte');
await page.waitForTimeout(900);

/* Ohne bekannte Position: Der Knopf muss FRAGEN. Und bis die Antwort da
   ist, darf sich die Karte NICHT bewegen -- erst auf die Kontrollpunkte zu
   springen und Sekunden spaeter zum Standort weiter waere zweimal dieselbe
   Unruhe, ueber die der Bericht handelt. */
const zentriert = await page.evaluate(async (aufbau) => {
  eval(aufbau);
  window.__grenzen = null;
  rgsNativAnsicht = null; rgsNativKarte = null;
  const d = rgKarteDaten(rundgangAktiv.kontrollpunkte);
  await rgKarteNativBauen(d, ++rgsKarteBauLauf);
  // Keine laufende Ortung, keine bekannte Position -- der pausierte oder
  // eben erst geoeffnete Fall.
  rgOrtungStoppen();
  rgsMeinOrt = null;
  // Der Standortabruf antwortet erst nach einem Augenblick, wie auf dem
  // Geraet.
  let gefragt = false;
  const echt = navigator.geolocation.getCurrentPosition;
  navigator.geolocation.getCurrentPosition = (gut) => {
    gefragt = true;
    setTimeout(() => gut({ coords: { latitude: 46.9480, longitude: 7.4474, accuracy: 9 } }), 80);
  };
  window.__karte.fit = []; window.__karte.cam = [];
  rgKarteZentrieren();
  const sofort = { fit: window.__karte.fit.length, cam: window.__karte.cam.length };
  const knopfArbeitet = document.getElementById('rgsZentrieren')
    .getAttribute('aria-busy') === 'true';
  await new Promise(r => setTimeout(r, 250));
  const danach = window.__karte.cam[0] || null;
  const knopfFertig = !document.getElementById('rgsZentrieren').hasAttribute('aria-busy');
  navigator.geolocation.getCurrentPosition = echt;
  await rgKarteNativAbbauen();
  document.body.classList.remove('karte-nativ');
  return { gefragt, sofort, danach, knopfArbeitet, knopfFertig };
}, NATIV_AUFBAU);

check('KRITISCH: ohne bekannte Position FRAGT der Knopf nach dem Standort, statt still auf die Kontrollpunkte zu fallen',
  zentriert.gefragt === true);
check('KRITISCH: bis die Antwort da ist, bewegt sich die Karte nicht — kein Sprung auf den Kontrollpunkt',
  zentriert.sofort.fit === 0 && zentriert.sofort.cam === 0);
check('KRITISCH: mit der Antwort faehrt die Karte auf den eigenen Standort',
  !!zentriert.danach && Math.abs(zentriert.danach.coordinate.lat - 46.9480) < 0.001
  && Math.abs(zentriert.danach.coordinate.lng - 7.4474) < 0.001);
check('Der Knopf zeigt waehrend des Abrufs, dass er arbeitet, und hoert danach wieder auf',
  zentriert.knopfArbeitet && zentriert.knopfFertig);

// Und der Rueckfallweg bleibt: Ist der Standort NICHT zu haben (verweigert,
// Keller, Zeitablauf), zeigt der Knopf die Kontrollpunkte -- lieber das als
// ein Knopf, der nichts tut.
const verweigert = await page.evaluate(async (aufbau) => {
  eval(aufbau);
  window.__grenzen = null;
  rgsNativAnsicht = null; rgsNativKarte = null;
  const d = rgKarteDaten(rundgangAktiv.kontrollpunkte);
  await rgKarteNativBauen(d, ++rgsKarteBauLauf);
  rgOrtungStoppen();
  rgsMeinOrt = null;
  const echt = navigator.geolocation.getCurrentPosition;
  navigator.geolocation.getCurrentPosition = (_gut, schlecht) =>
    setTimeout(() => schlecht({ code: 1 }), 20);
  window.__karte.fit = []; window.__karte.cam = [];
  rgKarteZentrieren();
  await new Promise(r => setTimeout(r, 200));
  const f = window.__karte.fit[0] || null;
  navigator.geolocation.getCurrentPosition = echt;
  await rgKarteNativAbbauen();
  document.body.classList.remove('karte-nativ');
  return f;
}, NATIV_AUFBAU);
check('KRITISCH: wird der Standort verweigert, zeigt der Knopf die Kontrollpunkte statt gar nichts zu tun',
  !!verweigert && Math.abs(verweigert.southwest.lat - 47.3520) < 0.001);

// Dasselbe in der Browser-Fassung (Web-App, kein Geraet): auch dort fuhr der
// Knopf bis hierher nur die Kontrollpunkte an und setzte hinterher bloss die
// Marke, ohne den Ausschnitt zu bewegen.
check('KRITISCH: auch in der Browser-Fassung faehrt der Knopf auf den erfragten Standort',
  await page.evaluate(async () => {
    delete window.KarteNativ;
    rgsNativKarte = null;
    rgOrtungStoppen();
    rgsMeinOrt = null;
    if (!rgsKarte) { return false; }
    rgsKarte.setCenter({ lat: 47.3520, lng: 7.9000 });
    const echt = navigator.geolocation.getCurrentPosition;
    navigator.geolocation.getCurrentPosition = (gut) =>
      setTimeout(() => gut({ coords: { latitude: 46.9480, longitude: 7.4474, accuracy: 9 } }), 40);
    rgKarteZentrieren();
    await new Promise(r => setTimeout(r, 220));
    const m = rgsKarte.getCenter();
    navigator.geolocation.getCurrentPosition = echt;
    return Math.abs(m.lat() - 46.9480) < 0.001 && Math.abs(m.lng() - 7.4474) < 0.001;
  }));

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
