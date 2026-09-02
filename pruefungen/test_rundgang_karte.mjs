// Karte der laufenden Runde (ENT-308, Schritt 2 zu ENT-306).
//
// Vom Projektinhaber: "Wir brauchen da eine Google-Maps-hinterlegte Ansicht,
// exakt die Kontrollpunkte, die mittels GPS im Dashboardbereich angelegt
// wurden."
//
// WICHTIG zur Pruefbarkeit: Echtes Google Maps laesst sich hier nicht laden
// -- die Pruefumgebung hat keinen Zugang zu maps.googleapis.com. Die Suite
// laeuft darum in DREI Zustaenden, und alle drei sind echte Betriebsfaelle:
//  1. Mit der Attrappe aus google_maps_mock.mjs (ENT-269, dieselbe wie im
//     Dashboard): Die Karte baut sich wirklich, Marken und Kreise sind
//     messbare DOM-Elemente. Nur so laesst sich pruefen, was Farbe und
//     Zeichen tatsaechlich aussagen -- im Quelltext nachlesen genuegt nicht.
//  2. Ohne Netz (abgewiesenes Skript): ein Satz, der sagt, was los ist und
//     wo die Punkte trotzdem stehen -- kein graues Rechteck.
//  3. Mit einer Antwort, die 200 liefert und trotzdem kein Maps ist
//     (Firmen-Proxy, Portal-WLAN): derselbe ehrliche Fehlschlag, und die
//     Karte bleibt fuer den naechsten Versuch offen.
// Die Aufbereitung der Punkte (rgKarteDaten) ist ausserdem als REINE
// Funktion geprueft, unabhaengig von jeder Karte.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { GOOGLE_MAPS_MOCK } from './google_maps_mock.mjs';
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const tag = n => iso(new Date(Date.now() + n * 864e5));

// ══════════ SERVER LIEFERT DIE KOORDINATEN ════════════════════════════
const OFFEN = readFileSync(`${WURZEL}/backend/api/mein_rundgang_offen.php`, 'utf8');
const APP = readFileSync(`${WURZEL}/app.html`, 'utf8');
// Der eigentliche Befund vor dieser Aenderung: Auf dem Startweg kamen die
// Koordinaten mit (SELECT k.*), beim FORTSETZEN nicht. Die Karte haette je
// nach Einstieg Punkte gezeigt oder nicht.
check('KRITISCH: auch beim Fortsetzen liefert der Server Koordinaten und Radius',
  /SELECT id, bezeichnung, reihenfolge, typ, lat, lng, geofence_radius_m FROM kontrollpunkt/.test(OFFEN)
  && /SELECT k\.id, k\.bezeichnung, p\.reihenfolge, k\.typ, k\.lat, k\.lng, k\.geofence_radius_m/.test(OFFEN));
check('KRITISCH: die laufende Runde bekommt Ansprechpartner und Zentrale mit',
  /rundgang_ansprechpartner\(/.test(OFFEN) && /rundgang_zentrale\(/.test(OFFEN));
// ENT-131 schliesst die kontinuierliche Positionsverfolgung aus. Ein
// watchPosition waere genau das -- und niemand saehe es der Oberflaeche an.
//
// Geprueft wird der AUFRUF, nicht das Wort: app.html nennt watchPosition an
// drei Stellen im Kommentar, gerade um zu begruenden, warum es fehlt. Eine
// Suche nach dem blossen Wort waere hier dauerhaft rot gewesen und haette
// den Kommentar bestraft statt den Code zu pruefen.
check('KRITISCH: die App verfolgt die Position NICHT laufend (ENT-131)',
  !/geolocation\s*\.\s*watchPosition/.test(APP)
  && !/\bwatchPosition\s*\(/.test(APP.replace(/\/\/[^\n]*/g, '')));
check('Der Kartenschluessel ist derselbe wie im Dashboard -- kein zweiter Anbieter',
  APP.includes('maps.googleapis.com/maps/api/js?key=')
  && readFileSync(`${WURZEL}/dashboard.html`, 'utf8').includes('maps.googleapis.com/maps/api/js?key='));

// ══════════ AUFBEREITUNG DER PUNKTE ═══════════════════════════════════
const SCHICHTEN = { status: 'ok', von: tag(-30), bis: tag(90), schichten: [
  { id: 71, kunde_name: 'Musterliegenschaften AG', titel: 'Nachtwache', strasse: 'Musterweg 4', ort: '9999 Musterdorf',
    einsatzart: 'Revierdienst', sparte: 'sicherheit', datum: tag(0), von: '20:00:00', bis: '06:00:00',
    status: 'bestaetigt', bemerkung: null, zusage: 'zugesagt', objekt_name: 'Musterobjekt Industrie', objekt_id: 7,
    hat_kontrollpunkte: true, im_team: 1 },
]};
const PROFIL = { status: 'ok', monat: { anzahl: 0, stunden: 0 }, profil: {
  name: 'm.muster', ist_admin: false, personalnummer: 'P-001',
  vorname: 'Max', nachname: 'Muster', erstellt_am: tag(-30) + ' 10:00:00' } };

// Zwei Punkte MIT Koordinaten, einer ohne (NFC) -- genau der Fall, den die
// Karte nicht verschweigen darf.
const KP = [
  { id: 1, bezeichnung: 'Haupteingang', reihenfolge: 1, typ: 'geofence',
    lat: 47.3500000, lng: 7.9000000, geofence_radius_m: 25, erledigt: null, aufgaben: [] },
  { id: 2, bezeichnung: 'Tor 3', reihenfolge: 2, typ: 'nfc',
    lat: null, lng: null, geofence_radius_m: 20, erledigt: null, aufgaben: [] },
  { id: 3, bezeichnung: 'Parkhaus', reihenfolge: 3, typ: 'geofence',
    lat: 47.3510000, lng: 7.9010000, geofence_radius_m: 40, erledigt: null, aufgaben: [] },
];

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
await page.route('**/api/**', route => {
  const url = new URL(route.request().url());
  const p = url.pathname.split('/api/')[1];
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'm.muster', ist_admin: false });
  if (p.includes('meine_schichten')) return send(SCHICHTEN);
  if (p.includes('mein_profil')) return send(PROFIL);
  if (p.includes('rapport_list')) return send({ status: 'ok', rapporte: [] });
  if (p.includes('mein_rundgang_offen')) {
    return send({ status: 'ok', rundgang: { id: 951, status: 'laeuft', pausiert_seit: null,
      vorbereitet_am: tag(0) + ' 02:00:00', pause_minuten: 0,
      kontrollpunkte: JSON.parse(JSON.stringify(KP)),
      objekt: { id: 7, name: 'Musterobjekt Industrie', strasse: 'Musterweg 4', ort: '9999 Musterdorf', kanton: 'SO' },
      kunde_name: 'Musterliegenschaften AG',
      ansprechpartner: [{ name: 'Ruedi Beispiel', anrede: 'Herr', funktion: 'Hauswart', quelle: 'objekt',
        wege: [{ art: 'mobil', wert: '079 000 11 22' }] }],
      zentrale: { name: 'Musterbetrieb GmbH', telefon: '079 111 22 33' } } });
  }
  return send({ status: 'ok' });
});

// Google Maps ist hier nicht erreichbar -- ausdruecklich abgewiesen, damit
// der Offline-Fall geprueft wird statt auf einen Zeitablauf zu warten.
//
// ZULETZT registriert, und das ist keine Kosmetik: Playwright nimmt die
// zuletzt passende Route. Die Maps-Adresse enthaelt selbst "/maps/api/js",
// also fing die Attrappe oben sie ab und beantwortete den Skript-Aufruf mit
// {"status":"ok"} -- was der Browser als JavaScript zu lesen versuchte
// ("Unexpected token ':'"). Der Fehler sah nach einem Fehler in app.html aus
// und war einer in dieser Datei.
await page.route('**maps.googleapis.com/**', route => route.abort());

await page.goto(`file://${WURZEL}/app.html`);
await page.fill('#gName', 'm.muster'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('.app.on');
await page.waitForTimeout(400);
await page.evaluate(() => { ladeSchichten().then(() => rundgangFortsetzen(71)); });
await page.waitForTimeout(700);

check('Die laufende Runde ist offen', await page.isVisible('#rgsReiter'));
check('KRITISCH: es gibt jetzt einen Karten-Reiter',
  await page.isVisible('#rgsRt-karte'));
check('Er steht an erster Stelle, vor Kontrollpunkten und Funktionen (gemessen)',
  await page.evaluate(() => {
    const x = s => document.querySelector(s).getBoundingClientRect().left;
    return x('#rgsRt-karte') < x('#rgsRt-punkte') && x('#rgsRt-punkte') < x('#rgsRt-funktionen');
  }));

// Reine Funktion -- unabhaengig davon, ob eine Karte laedt.
const daten = await page.evaluate(() => rgKarteDaten(rundgangAktiv.kontrollpunkte));
check('KRITISCH: nur Punkte MIT Koordinaten sind darstellbar',
  daten.zeigbar.length === 2 && daten.zeigbar.map(p => p.bezeichnung).join('|') === 'Haupteingang|Parkhaus');
check('KRITISCH: der NFC-Punkt ohne Koordinaten wird als solcher gezählt, nicht verschwiegen',
  daten.ohneOrt.length === 1 && daten.ohneOrt[0].bezeichnung === 'Tor 3');
check('KRITISCH: die Nummer auf der Karte ist die Nummer in der Liste -- nicht neu durchgezählt',
  daten.zeigbar[0].nr === 1 && daten.zeigbar[1].nr === 3);
check('Der Geofence-Radius jedes Punktes wird übernommen, nicht ein fester Wert',
  daten.zeigbar[0].radius === 25 && daten.zeigbar[1].radius === 40);
check('Ein Punkt ohne hinterlegten Radius bekommt den Vorgabewert 20, nicht 0',
  await page.evaluate(() => rgKarteDaten([{ id: 9, bezeichnung: 'X', lat: 47, lng: 7,
    geofence_radius_m: null }]).zeigbar[0].radius === 20));
check('KRITISCH: unbrauchbare Koordinaten gelten als "ohne Ort", nicht als Punkt bei 0/0',
  await page.evaluate(() => {
    const d = rgKarteDaten([{ id: 8, bezeichnung: 'Kaputt', lat: 'abc', lng: null }]);
    return d.zeigbar.length === 0 && d.ohneOrt.length === 1;
  }));

// ══════════ OHNE NETZ: EHRLICH SCHEITERN ══════════════════════════════
await page.click('#rgsRt-karte');
await page.waitForTimeout(600);
// Der Fall, den diese Zeile gefunden hat: Ein blockiertes Skript loest
// onload aus, OHNE google.maps zu definieren. Die erste Fassung entfernte
// daraufhin den Hinweis und scheiterte still -- graue Flaeche, keine
// Erklaerung, genau das, was diese Karte vermeiden soll.
check('KRITISCH: statt eines grauen Rechtecks steht da, warum die Karte fehlt',
  await page.isVisible('#rgsKarteStand')
  && (await page.textContent('#rgsKarteStand')).includes('ohne Netz'));
check('KRITISCH: der Hinweis nennt den Weg, der offline weiterhin funktioniert (die Liste)',
  (await page.textContent('#rgsKarteStand')).includes('Kontrollpunkte'));
check('KRITISCH: "nicht darstellbar" wird ausgewiesen und sieht nicht wie "nicht vorhanden" aus',
  await page.isVisible('#rgsKarteOhneOrt')
  && (await page.textContent('#rgsKarteOhneOrt')).includes('1')
  && (await page.textContent('#rgsKarteOhneOrt')).includes('nur in der Liste'));
check('Der Zentrieren-Knopf ist da und mindestens 44px hoch (CLAUDE.md)',
  await page.evaluate(() => document.getElementById('rgsZentrieren').getBoundingClientRect().height >= 44));
check('KRITISCH: kein waagrechter Seiten-Scroll bei 390px', await page.evaluate(() =>
  document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
await page.screenshot({ path: `${OUT}/karte-01-ohne-netz.png` });

// Ein Fehlschlag darf nicht dauerhaft haengen bleiben: Wer aus dem Keller
// kommt, muss die Karte erneut laden koennen.
check('KRITISCH: nach einem Fehlschlag wird beim naechsten Öffnen erneut versucht',
  await page.evaluate(() => rgsMapsVersprechen === null));

// Zweiter, ANDERER Fehlerfall: Das Skript antwortet mit 200 -- ist aber kein
// Maps. So verhaelt sich ein Firmen-Proxy oder ein Portal-WLAN, und so
// verhielt sich versehentlich diese Pruefung selbst. Dann laeuft onload,
// nicht onerror.
//
// Die Gegenprobe (Weiche in rgsMapsLaden() entfernt) zeigt genau, was daran
// haengt: Der Hinweis erscheint auch ohne sie, weil das Bauen der Karte
// mangels google.maps wirft und im catch landet. Was OHNE sie kaputtgeht,
// ist der zweite Versuch -- rgsMapsVersprechen bliebe auf dem gescheiterten
// Versprechen stehen, und der Waechter kaeme fuer den Rest der Sitzung nicht
// mehr an die Karte, auch nicht mit Netz. Darum stehen hier zwei Pruefungen
// und nicht eine.
await page.unroute('**maps.googleapis.com/**');
await page.route('**maps.googleapis.com/**', route =>
  route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* kein Maps */' }));
await page.click('#rgsRt-punkte');
await page.waitForTimeout(200);
await page.click('#rgsRt-karte');
await page.waitForTimeout(700);
check('KRITISCH: ein 200er, der kein Maps ist, wird als Fehler gezeigt -- nicht als leere Karte',
  await page.isVisible('#rgsKarteStand')
  && (await page.textContent('#rgsKarteStand')).includes('ohne Netz'));
check('Auch danach darf erneut versucht werden',
  await page.evaluate(() => rgsMapsVersprechen === null));
await page.unroute('**maps.googleapis.com/**');
await page.route('**maps.googleapis.com/**', route => route.abort());

// ══════════ MIT KARTE: WAS TATSÄCHLICH GEZEICHNET WIRD ════════════════
// Ab hier antwortet maps.googleapis.com mit der Attrappe aus ENT-269 --
// dieselbe, mit der das Dashboard geprueft wird. Erst dadurch laesst sich
// messen, was die Karte aussagt, statt es im Quelltext nachzulesen.
await page.unroute('**maps.googleapis.com/**');
await page.route('**maps.googleapis.com/**', route =>
  route.fulfill({ status: 200, contentType: 'application/javascript', body: GOOGLE_MAPS_MOCK }));
// Einen Punkt als erledigt und einen als abweichend setzen, damit sich die
// drei Zustaende unterscheiden lassen.
await page.evaluate(() => {
  rundgangAktiv.kontrollpunkte[0].erledigt = { status: 'bestaetigt' };
  rundgangAktiv.kontrollpunkte[2].erledigt = { status: 'nicht_verfuegbar' };
});
await page.click('#rgsRt-punkte');
await page.waitForTimeout(200);
await page.click('#rgsRt-karte');
await page.waitForTimeout(800);

check('KRITISCH: mit Maps steht die Karte -- und der Ladehinweis ist weg',
  await page.isVisible('#rgsKarte') && await page.$('#rgsKarteStand') === null);
check('KRITISCH: genau die Punkte MIT Koordinaten stehen als Marken auf der Karte',
  (await page.$$('#rgsKarte .gm-mock-marker')).length === 2);
check('KRITISCH: jeder Punkt bekommt seinen eigenen Geofence-Radius, keinen festen Wert',
  await page.evaluate(() => [...document.querySelectorAll('#rgsKarte .gm-mock-circle')]
    .map(e => e.dataset.radius).join('|') === '25|40'));
// CLAUDE.md: Farbe UND Form. Wer die Farben nicht unterscheidet, liest die
// Zeichen -- also muessen beide unterschiedlich sein, nicht nur eines.
check('KRITISCH: erledigt und abweichend tragen verschiedene ZEICHEN, nicht nur Farben',
  await page.evaluate(() => [...document.querySelectorAll('#rgsKarte .gm-mock-marker')]
    .map(e => e.dataset.zeichen).join('|') === '✓|!'));
check('KRITISCH: erledigt und abweichend tragen auch verschiedene FARBEN',
  await page.evaluate(() => {
    const f = [...document.querySelectorAll('#rgsKarte .gm-mock-marker')].map(e => e.dataset.farbe);
    return f.length === 2 && f[0] !== f[1];
  }));
check('Ein offener Punkt trägt seine Listen-Nummer als Zeichen',
  await page.evaluate(() => {
    rundgangAktiv.kontrollpunkte[0].erledigt = null;
    rgKartePunkteZeichnen(rgKarteDaten(rundgangAktiv.kontrollpunkte).zeigbar);
    return document.querySelector('#rgsKarte .gm-mock-marker').dataset.zeichen === '1';
  }));
// Ein Tipp auf die Marke fuehrt in die Liste: Die Bestaetigung haengt an
// Standortpruefung, Ersatzscan und Aufgaben-Rueckfrage -- die alle in eine
// Kartenblase zu holen hiesse, denselben Ablauf ein zweites Mal zu bauen.
// dispatchEvent statt echtem Mausklick: Die Attrappe setzt ihre Marken frei
// positioniert in den Kartencontainer, und der Zentrieren-Knopf liegt als
// Ueberlagerung darueber. Geprueft werden soll hier die Verdrahtung
// (Marke -> Liste), nicht die Treffergeometrie einer nachgebauten Karte.
await page.dispatchEvent('#rgsKarte .gm-mock-marker', 'click');
await page.waitForTimeout(300);
check('KRITISCH: ein Tipp auf eine Marke führt in die Kontrollpunkt-Liste, nicht in eine zweite Maske',
  await page.isVisible('#rdListe'));
await page.click('#rgsRt-karte');
await page.waitForTimeout(600);
// ENT-131 nicht nur im Quelltext, sondern am Verhalten: Ohne Knopfdruck darf
// keine Standortabfrage laufen.
check('KRITISCH: die eigene Position wird NUR auf Abruf geholt (ENT-131), nicht laufend',
  await page.evaluate(() => {
    let rufe = 0;
    const echt = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
    navigator.geolocation.getCurrentPosition = (...a) => { rufe++; return echt(...a); };
    window.__rufe = () => rufe;
    return true;
  }));
await page.waitForTimeout(900);
check('Ohne Antippen bleibt es bei null Standortabfragen',
  await page.evaluate(() => window.__rufe() === 0));
await page.screenshot({ path: `${OUT}/karte-03-mit-karte.png` });
await page.unroute('**maps.googleapis.com/**');
await page.route('**maps.googleapis.com/**', route => route.abort());

// ══════════ LISTE BLEIBT VOLLSTÄNDIG ══════════════════════════════════
await page.click('#rgsRt-punkte');
await page.waitForTimeout(300);
check('KRITISCH: in der Liste stehen ALLE Punkte, auch der ohne Koordinaten',
  await page.evaluate(() => [...document.querySelectorAll('#rdListe .rd-bez')]
    .map(e => e.textContent).join('|') === 'Haupteingang|Tor 3|Parkhaus'));

// ══════════ ANSPRECHPARTNER WÄHREND DER RUNDE ═════════════════════════
await page.click('#rgsRt-funktionen');
await page.waitForTimeout(250);
check('KRITISCH: Ansprechpartner und Notruf stehen jetzt auch während der Runde zur Verfügung',
  await page.isVisible('#rgsLaufKontakte'));
await page.click('#rgsLaufKontakte');
await page.waitForTimeout(300);
check('KRITISCH: die eigene Zentrale steht da, mit Anruf-Ziel',
  await page.isVisible('#rgsZentrale')
  && await page.evaluate(() => document.getElementById('rgsZentrale').getAttribute('href') === 'tel:0791112233'));
check('KRITISCH: die drei Notrufnummern stehen darunter',
  await page.evaluate(() => [...document.querySelectorAll('#rgsNotruf a')]
    .map(a => a.getAttribute('href')).join('|') === 'tel:117|tel:118|tel:144'));
await page.click('#rgsKlappAp .rgs-klapp-kopf');
await page.waitForTimeout(250);
check('Der Ansprechpartner vor Ort ist dabei, mit seiner Herkunft',
  (await page.textContent('#rgsKlappAp')).includes('Ruedi Beispiel')
  && (await page.textContent('#rgsKlappAp')).includes('Vor Ort'));
await page.screenshot({ path: `${OUT}/karte-02-kontakte.png` });
await page.click('#rgsZurueck');
await page.waitForTimeout(300);
check('Der Zurück-Weg führt in die Runde zurück, nicht aus ihr heraus',
  await page.isVisible('#rgsReiter') && await page.isVisible('#rgSeite'));

// ══════════ DESKTOP ═══════════════════════════════════════════════════
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(250);
await page.click('#rgsRt-karte');
await page.waitForTimeout(500);
check('Am Desktop bleibt die Karte innerhalb der App-Breite',
  await page.evaluate(() => {
    const k = document.querySelector('.rgs-karte-huelle').getBoundingClientRect();
    const s = document.getElementById('rgSeite').getBoundingClientRect();
    return k.width <= s.width && s.width <= 561;
  }));
check('KRITISCH: am Desktop kein waagrechter Seiten-Scroll', await page.evaluate(() =>
  document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
