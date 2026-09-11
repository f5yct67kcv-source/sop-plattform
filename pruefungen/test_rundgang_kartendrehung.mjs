// Die Karte der laufenden Runde behält ihren Zustand — und lässt sich
// drehen (ENT-543).
//
// Anlass: „Die Karte innerhalb der Kontrollrunde kann man zwar zoomen,
// jedoch nicht rotieren."
//
// Beim Nachmessen kam heraus, dass eine Drehung allein nichts genützt
// hätte: `rgKarteZeichnen()` hat bei JEDEM Aufruf den ganzen Rumpf ersetzt
// und eine neue Karte gebaut. Gemessen auf dem Stand davor: Zoomstufe 19
// und ein selbst gewählter Ausschnitt waren nach einer einzigen neuen
// Position wieder auf Stufe 16 und auf der Übersicht. Eine Drehung wäre
// genauso weggeworfen worden.
//
// Ausgelöst wird das nicht von der Position selbst, sondern vom Wechsel des
// Ortungszustands: Ein kurzer Aussetzer setzt `rgsOrtFehler`, die nächste
// Position räumt ihn weg, und beide zeichnen neu. Draussen zwischen Häusern
// passiert das dauernd.
//
// Was diese Suite NICHT kann: beweisen, dass sich eine echte Google-Karte
// am Gerät mit zwei Fingern drehen lässt. Das Testdouble zeichnet keine
// Kacheln. Sie belegt, dass die Karte in genau dem Modus gebaut wird, in
// dem Google das Drehen erlaubt (Vektor + headingInteractionEnabled), und
// dass die App mit einem gedrehten Kartenwinkel richtig umgeht.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { GOOGLE_MAPS_MOCK } from './google_maps_mock.mjs';
import { chromium } from 'playwright';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const tag = n => iso(new Date(Date.now() + n * 864e5));

const RUNDE = () => ({ id: 951, status: 'laeuft', pausiert_seit: null,
  vorbereitet_am: tag(0) + ' 02:00:00', pause_minuten: 0,
  vorlage_name: 'Runde Nacht A', fenster_von: null, fenster_bis: null,
  objekt: { id: 7, name: 'Musterobjekt', strasse: 'Musterweg 4', ort: '9999 Musterdorf' },
  kunde_name: 'Musterliegenschaften AG', ansprechpartner: [], zentrale: null,
  kontrollpunkte: [
    { id: 1, bezeichnung: 'Haupteingang', reihenfolge: 1, typ: 'geofence',
      lat: 47.3500, lng: 7.9000, geofence_radius_m: 25, erledigt: null, aufgaben: [] },
    { id: 2, bezeichnung: 'Parkhaus', reihenfolge: 2, typ: 'geofence',
      lat: 47.3520, lng: 7.9020, geofence_radius_m: 20, erledigt: null, aufgaben: [] },
  ] });
const SCHICHTEN = { status: 'ok', von: tag(-30), bis: tag(90), schichten: [
  { id: 71, kunde_name: 'Musterliegenschaften AG', titel: 'Nachtwache',
    strasse: 'Musterweg 4', ort: '9999 Musterdorf', einsatzart: 'Revierdienst',
    sparte: 'sicherheit', datum: tag(0), von: '20:00:00', bis: '06:00:00',
    status: 'bestaetigt', bemerkung: null, zusage: 'zugesagt',
    objekt_name: 'Musterobjekt', objekt_id: 7, hat_kontrollpunkte: true, im_team: 1 }] };
const PROFIL = { status: 'ok', monat: { anzahl: 0, stunden: 0 },
  profil: { name: 'm.muster', ist_admin: false, personalnummer: 'P-001',
    vorname: 'Max', nachname: 'Muster', erstellt_am: tag(-30) + ' 10:00:00' } };

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
  permissions: ['geolocation'],
  geolocation: { latitude: 47.3500, longitude: 7.9000, accuracy: 8 },
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
await page.waitForTimeout(1600);
await page.click('#rgsRt-karte');
await page.waitForTimeout(1000);

// ══════════ IN WELCHEM MODUS DIE KARTE GEBAUT WIRD ═══════════════════
// Am Container gemessen, nicht im Quelltext nachgelesen: Die Attrappe
// schreibt dorthin, was ihr beim Bauen übergeben wurde.
const modus = await page.evaluate(() => {
  const el = document.getElementById('rgsKarte');
  return el ? { darstellung: el.dataset.darstellung, drehbar: el.dataset.drehbar,
                neigbar: el.dataset.neigbar, stil: el.dataset.kartenstil } : null;
});
check('KRITISCH: die Karte überhaupt gebaut', !!modus);
check('KRITISCH: sie wird als VEKTORkarte gebaut — nur dort kennt Google einen Kartenwinkel',
  modus && modus.darstellung === 'VECTOR');
check('KRITISCH: und das Drehen ist eingeschaltet — sonst hätte die Vektorkarte nichts genützt',
  modus && modus.drehbar === 'ja');
check('Das NEIGEN bleibt aus: gefragt war Drehen, und eine gekippte Karte liest sich nachts schlechter',
  modus && modus.neigbar === 'nein');
check('KRITISCH: die Nachtsicht kommt auf der Vektorkarte an — dort wird eine Stilvorschrift aus dem Code ignoriert',
  modus && modus.stil !== 'standard');

// ══════════ DER KERN: DER ZUSTAND ÜBERLEBT EINE NEUE POSITION ════════
// Der Wächter stellt sich die Karte ein, wie er sie braucht.
await page.evaluate(() => {
  rgsKarte.setZoom(19);
  rgsKarte.setCenter({ lat: 47.3560, lng: 7.9060 });
  if (typeof rgsKarte.setHeading === 'function') { rgsKarte.setHeading(70); }
});
await page.waitForTimeout(200);
// Ab hier zählen, wie oft eine NEUE Karte gebaut wird.
await page.evaluate(() => {
  window.__gebaut = 0;
  const echt = google.maps.Map;
  const huelle = function (c, o) { window.__gebaut++; return new echt(c, o); };
  huelle.prototype = echt.prototype;
  google.maps.Map = huelle;
});
const vor = await page.evaluate(() => ({
  zoom: rgsKarte.getZoom(),
  lat: +rgsKarte.getCenter().lat().toFixed(4),
  winkel: rgsKarte.getHeading(),
}));
// Eine neue Position, mitsamt dem Aussetzer davor, den watchPosition in
// der Praxis liefert (genau der löste den Neubau aus).
await page.context().setGeolocation({ latitude: 47.35020, longitude: 7.9000, accuracy: 8 });
await page.waitForTimeout(1500);
const nach = await page.evaluate(() => ({
  zoom: rgsKarte.getZoom(),
  lat: +rgsKarte.getCenter().lat().toFixed(4),
  winkel: rgsKarte.getHeading(),
  gebaut: window.__gebaut,
  marken: document.querySelectorAll('#rgsKarte .gm-mock-marker').length,
}));
check('KRITISCH: eine neue Position baut die Karte NICHT neu', nach.gebaut === 0);
check('KRITISCH: der selbst gewählte Zoom bleibt stehen', nach.zoom === vor.zoom && vor.zoom === 19);
check('KRITISCH: der selbst gewählte Ausschnitt bleibt stehen', nach.lat === vor.lat);
check('KRITISCH: und die Drehung bleibt ebenfalls stehen — sonst wäre sie nutzlos',
  nach.winkel === vor.winkel && vor.winkel === 70);
// Zwei gleichzeitige Aufbauten hinterliessen früher doppelte Marken, und die
// App versetzte danach die falsche: Das Wächter-Schild blieb auf der alten
// Stelle stehen. Drei Marken sind richtig: zwei Kontrollpunkte und das
// Schild (der Richtungspfeil kommt dazu, sobald eine Richtung bekannt ist).
check('KRITISCH: es steht jede Marke genau einmal da, nicht doppelt',
  nach.marken <= 4 && nach.marken >= 3);

// ══════════ DER HINWEIS WIRD TROTZDEM NACHGEFÜHRT ════════════════════
// Ohne Neubau muss die Warnung trotzdem erscheinen — sonst hätte der
// Verzicht auf den Neubau eine Auskunft gekostet, die ENT-317 verlangt.
await page.evaluate(() => {
  rgsOrtFehler = 'verweigert';
  rgLaufZeichnen();
});
await page.waitForTimeout(300);
const warn = await page.evaluate(() => ({
  warnung: !!document.getElementById('rgsOrtWarn'),
  zoom: rgsKarte.getZoom(),
  gebaut: window.__gebaut,
}));
check('KRITISCH: eine verweigerte Ortung wird weiterhin gemeldet, auch ohne Neubau',
  warn.warnung === true);
check('Und die Karte bleibt dabei stehen, wie sie war',
  warn.zoom === 19 && warn.gebaut === 0);
await page.evaluate(() => { rgsOrtFehler = null; rgLaufZeichnen(); });
await page.waitForTimeout(300);
check('KRITISCH: kommt der Standort zurück, verschwindet die Warnung wieder',
  await page.evaluate(() => !document.getElementById('rgsOrtWarn')));

// ══════════ NACHTSICHT: NEUBAU, ABER MIT DER ANSICHT ═════════════════
// Das Farbschema lässt sich nur beim Bauen setzen. Dieser eine Neubau
// bleibt also — er darf aber die Ansicht nicht wegwerfen.
await page.click('#rgsNachtsicht');
await page.waitForTimeout(700);
const nachNacht = await page.evaluate(() => ({
  gebaut: window.__gebaut,
  stil: document.getElementById('rgsKarte').dataset.kartenstil,
  zoom: rgsKarte.getZoom(),
  lat: +rgsKarte.getCenter().lat().toFixed(4),
  winkel: rgsKarte.getHeading(),
  gedrueckt: document.getElementById('rgsNachtsicht').getAttribute('aria-pressed'),
}));
check('KRITISCH: der Nachtsicht-Schalter baut die Karte neu — anders geht das Farbschema nicht',
  nachNacht.gebaut === 1);
check('KRITISCH: und er wirkt auch wirklich (Karte wird hell)',
  nachNacht.stil === 'standard' && nachNacht.gedrueckt === 'false');
check('KRITISCH: dabei bleiben Zoom, Ausschnitt und Drehung erhalten — der Schalter wirft die Ansicht nicht weg',
  nachNacht.zoom === 19 && nachNacht.lat === vor.lat && nachNacht.winkel === 70);
await page.click('#rgsNachtsicht');
await page.waitForTimeout(700);
check('Zurück auf dunkel geht ebenso', await page.evaluate(() =>
  document.getElementById('rgsKarte').dataset.kartenstil !== 'standard'
  && document.getElementById('rgsNachtsicht').getAttribute('aria-pressed') === 'true'));
await page.screenshot({ path: `${OUT}/kartendrehung-01.png` });

// ══════════ ZURÜCK NACH NORDEN ══════════════════════════════════════
// Vom Projektinhaber gemeldet: „Zentrieren geht nicht." Es ging schon —
// Zoom und Ausschnitt wurden zurückgesetzt, die Drehung nicht. Wer auf
// seinem einzigen Kontrollpunkt steht, sieht vom Zentrieren ohnehin nichts;
// das Einzige, was sichtbar gewesen wäre, blieb liegen.
await page.evaluate(() => {
  rgsKarte.setHeading(40);
  rgsKarte.setZoom(19);
  rgsKarte.setCenter({ lat: 47.3590, lng: 7.9090 });
});
const verdreht = await page.evaluate(() => ({
  zoom: rgsKarte.getZoom(), winkel: rgsKarte.getHeading(),
  lat: +rgsKarte.getCenter().lat().toFixed(4),
}));
check('Vorbereitung: die Karte ist gedreht, gezoomt und verschoben',
  verdreht.winkel === 40 && verdreht.zoom === 19);
await page.click('#rgsZentrieren');
await page.waitForTimeout(900);
const zentriert = await page.evaluate(() => ({
  zoom: rgsKarte.getZoom(), winkel: rgsKarte.getHeading(),
  lat: +rgsKarte.getCenter().lat().toFixed(4),
}));
check('KRITISCH: „Zentrieren" dreht die Karte zurück nach Norden',
  zentriert.winkel === 0);
check('Und setzt weiterhin Zoom und Ausschnitt zurück',
  zentriert.zoom !== 19 && zentriert.lat !== verdreht.lat);

// ══════════ DER RICHTUNGSPFEIL HÄLT GEGEN DIE DREHUNG ════════════════
// Eine Marke dreht sich NICHT mit der Karte mit — ihre Drehung gilt
// gegenüber dem Bildschirm. Ist die Karte um 90 Grad gedreht, zeigt Norden
// nach links, und ein Pfeil, der stur auf 0 steht, zeigt in die falsche
// Richtung. Das ist der eine Punkt, an dem sich die beiden neuen
// Funktionen gegenseitig kaputtmachen können.
await page.evaluate(() => {
  rgsMeinOrt = rgsMeinOrt || { lat: 47.35, lng: 7.9, zeit: Date.now() };
  rgsMeinOrt.richtung = 0; rgsMeinOrt.richtungZeit = Date.now();
  rgsKarte.setHeading(0);
  rgLaufKopfZeichnen();
});
await page.waitForTimeout(300);
const dreh0 = await page.evaluate(() => {
  const e = [...document.querySelectorAll('#rgsKarte .gm-mock-marker')]
    .find(x => (x.dataset.pfad || '').startsWith('M12 1.5'));
  return e ? Number(e.dataset.drehung) : null;
});
check('KRITISCH: ohne gedrehte Karte zeigt der Pfeil unverändert die Bewegungsrichtung',
  dreh0 === 0);
/* Drehen und Messen im SELBEN Schritt, ohne Wartezeit dazwischen.

   Der Uhrentakt führt den Pfeil ohnehin jede Sekunde nach -- wer nach dem
   Drehen 300 ms wartet, misst je nach Zufall den Takt statt die Reaktion
   auf die Drehung. Genau so ist diese Prüfung beim Bauen durchgerutscht:
   Die Gegenprobe (Ereignis gar nicht angemeldet) blieb grün. Ohne
   Wartezeit kann nur der angemeldete Rückruf den Wert gesetzt haben. */
const dreh90 = await page.evaluate(() => {
  rgsKarte.setHeading(90);
  const e = [...document.querySelectorAll('#rgsKarte .gm-mock-marker')]
    .find(x => (x.dataset.pfad || '').startsWith('M12 1.5'));
  return e ? Number(e.dataset.drehung) : null;
});
check('KRITISCH: dreht der Wächter die Karte um 90 Grad, hält der Pfeil dagegen (270 statt 0)',
  dreh90 === 270);
check('KRITISCH: und er tut das von selbst, ohne dass sich die Position ändert',
  await page.evaluate(() => window.__gebaut === 2));

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
