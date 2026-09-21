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

// Ein Klick auf ein Element, das es nicht gibt, laeuft in Playwright 30
// Sekunden lang ins Leere und reisst dann die ganze Suite mit. In einer
// Gegenprobe ist genau das der Normalfall -- und eine abgestuerzte Suite
// meldet KEINE rote Pruefung, sie meldet gar nichts. Diesen Mangel gab es
// in diesem Projekt schon mehrfach; darum hier von Anfang an kurze
// Fristen und ein Rueckgabewert statt eines Absturzes.
const klick = async (page, s) => { try { await page.click(s, { timeout: 2500 }); return true; }
                                   catch (e) { return false; } };
const txt = async (page, s) => { try { return await page.textContent(s, { timeout: 2500 }); }
                                 catch (e) { return null; } };
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
// ENT-131 schloss die kontinuierliche Positionsverfolgung aus. Seit
// ENT-317 ist sie WAEHREND einer laufenden Runde erlaubt -- vom
// Projektinhaber entschieden, weil sich Radien von 20-25 m sonst nicht
// bedienen lassen. Geprueft wird darum nicht mehr die Abwesenheit von
// watchPosition, sondern die GRENZE: dass sie mit der Runde endet.
// Die Einzelheiten stehen in test_ortung.mjs.
check('KRITISCH: die Ortung endet mit der Runde und ueberdauert sie nicht (ENT-317)',
  /function rgOrtungStoppen/.test(APP) && /clearWatch/.test(APP)
  && /function rgOrtungNachfuehren/.test(APP));
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
let ohneOrt = false;
await page.exposeFunction('__ohneOrtSetzen', v => { ohneOrt = !!v; });
await page.route('**/api/**', route => {
  const url = new URL(route.request().url());
  const p = url.pathname.split('/api/')[1];
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'm.muster', ist_admin: false });
  if (p.includes('meine_schichten')) return send(SCHICHTEN);
  if (p.includes('mein_profil')) return send(PROFIL);
  if (p.includes('rapport_list')) return send({ status: 'ok', rapporte: [] });
  if (p.includes('mein_rundgang_offen')) {
    // __ohneOrt: derselbe Rundgang, aber alle Punkte ohne Koordinaten --
    // fuer die Pruefung, dass eine reine NFC-Runde nicht auf der Karte
    // oeffnet. Wird von der Seite selbst gesetzt.
    const kps = JSON.parse(JSON.stringify(KP));
    return send({ status: 'ok', rundgang: { id: 951, status: 'laeuft', pausiert_seit: null,
      vorbereitet_am: tag(0) + ' 02:00:00', pause_minuten: 0,
      kontrollpunkte: ohneOrt ? kps.map(k => ({ ...k, lat: null, lng: null })) : kps,
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
  // Gemessen am gezeichneten Zustand, nicht am Objekt: Die Marke traegt
  // ihr Zeichen im Dokument, und genau das liest der Waechter.
  check('KRITISCH: die gezeichneten Marken tragen dieselben Zeichen',
    await page.evaluate(() => {
      const soll = rgKarteDaten(rundgangAktiv.kontrollpunkte).zeigbar
        .map(p => rgPunktZustand(p).zeichen).sort().join('|');
      const ist = [...document.querySelectorAll('#rgsKarte [data-zeichen]')]
        .map(e => e.dataset.zeichen).sort().join('|');
      return soll.length > 0 && soll === ist;
    }));

// Die Durchsicht, die die native Karte sichtbar macht, darf NICHT die
// Seite darunter freilegen. Zweimal am Gerät danebengegriffen: einmal
// schienen die Revierdienst-Kacheln durch, einmal war gar keine Karte
// mehr da. Gemessen statt nachgelesen -- eine CSS-Regel kann wirkungslos
// bleiben, ohne dass etwas kaputtgeht (CLAUDE.md).
const gemessen = await page.evaluate(() => {
  const huelle = document.querySelector('.rgs-karte-huelle');
  const rgs = document.getElementById('rgSeite');
  const app = document.querySelector('.app');
  if (!huelle || !rgs || !app) { return null; }
  const lies = () => ({
    huelle: getComputedStyle(huelle).backgroundColor,
    rgs: getComputedStyle(rgs).backgroundColor,
    app: getComputedStyle(app).visibility,
  });
  const ohne = lies();
  document.body.classList.add('karte-nativ');
  const mit = lies();
  document.body.classList.remove('karte-nativ');
  return { ohne, mit };
});
const durchsichtig = (f) => f === 'transparent' || /rgba\(0, 0, 0, 0\)/.test(f);
check('KRITISCH: mit Durchsicht ist die Kartenhülle gemessen durchsichtig',
  !!gemessen && !durchsichtig(gemessen.ohne.huelle) && durchsichtig(gemessen.mit.huelle));
check('KRITISCH: und die Rundgang-Ebene ebenfalls -- sonst bleibt die Karte unsichtbar',
  !!gemessen && !durchsichtig(gemessen.ohne.rgs) && durchsichtig(gemessen.mit.rgs));
check('KRITISCH: dafür wird die App-Ebene ausgeblendet, sonst scheint sie durch',
  !!gemessen && gemessen.ohne.app !== 'hidden' && gemessen.mit.app === 'hidden');

// Und der Aufbau muss die Durchsicht auch wirklich einschalten. Die native
// Karte gibt es hier nicht -- also eine Attrappe an ihrer Stelle. Ohne
// diese Pruefung blieb das Weglassen unbemerkt: Die Regeln standen im
// Stilblock, nur setzte sie niemand.
// Erst die Grösse, dann die Karte. Die native Ansicht wird an die Stelle
// des Elements gelegt, und ihre Masse werden beim Erzeugen EINMAL
// abgelesen -- wer sie abliest, bevor die Seite fertig umgebrochen hat,
// bekommt eine Ansicht der Grösse Null. Vom Projektinhaber gemeldet: Beim
// Start der Runde blieb der Bildschirm schwarz, erst das Umschalten der
// Nachtsicht brachte die Karte.
check('KRITISCH: ein Element mit Grösse gilt als bereit',
  await page.evaluate(async () => {
    const el = document.getElementById('rgsKarte');
    return el ? await rgsElementBereit(el, 300) : false;
  }));
check('KRITISCH: ein Element OHNE Grösse gilt nicht als bereit',
  await page.evaluate(async () => {
    const h = document.createElement('div');
    document.body.appendChild(h);
    const r = await rgsElementBereit(h, 120);
    h.remove();
    return r === false;
  }));
check('Ein Element, das gar nicht im Dokument steht, ebenfalls nicht',
  await page.evaluate(async () => {
    const weg = document.createElement('div');
    return (await rgsElementBereit(weg, 120)) === false;
  }));
// Und der Aufbau fragt wirklich danach: Mit einem Element ohne Grösse darf
// keine Karte entstehen, sonst waere die Prüfung oben folgenlos.
check('KRITISCH: ohne Grösse wird gar keine native Karte gebaut',
  await page.evaluate(async () => {
    const merkN = window.KarteNativ, merkK = rgsNativKarte, merkE = rgsKarteEl;
    let gebaut = false;
    window.KarteNativ = { GoogleMap: { create: async () => { gebaut = true; return {}; } } };
    const el = document.getElementById('rgsKarte');
    const breite = el.style.width, hoehe = el.style.height, anz = el.style.display;
    el.style.display = 'none';
    rgsNativKarte = null;
    await rgKarteNativBauen(rgKarteDaten(rundgangAktiv.kontrollpunkte), rgsKarteBauLauf);
    el.style.display = anz; el.style.width = breite; el.style.height = hoehe;
    window.KarteNativ = merkN; rgsNativKarte = merkK; rgsKarteEl = merkE;
    document.body.classList.remove('karte-nativ');
    return gebaut === false;
  }));

check('KRITISCH: der Aufbau der nativen Karte schaltet die Durchsicht ein',
  await page.evaluate(async () => {
    const merkN = window.KarteNativ, merkK = rgsNativKarte, merkE = rgsKarteEl;
    const attrappe = {
      setCamera: async () => {}, fitBounds: async () => {},
      enableCurrentLocation: async () => {}, addCircles: async () => [],
      removeCircles: async () => {}, destroy: async () => {},
    };
    window.KarteNativ = { GoogleMap: { create: async () => attrappe } };
    document.body.classList.remove('karte-nativ');
    const d = rgKarteDaten(rundgangAktiv.kontrollpunkte);
    await rgKarteNativBauen(d, rgsKarteBauLauf);
    const an = document.body.classList.contains('karte-nativ');
    // Und der Abbau nimmt sie wieder weg -- sonst bliebe die App auf den
    // anderen Reitern unsichtbar.
    await rgKarteNativAbbauen();
    const aus = !document.body.classList.contains('karte-nativ');
    window.KarteNativ = merkN; rgsNativKarte = merkK; rgsKarteEl = merkE;
    return an && aus;
  }));

  // Der Aufbau muss genau den Zustand herstellen, in dem der Knopf sonst
  // wirkungslos bliebe: Die Karte gilt als STEHEND (das Element ist
  // dasselbe wie im Dokument). Ohne das lief die Prüfung an der Sache
  // vorbei und blieb auch dann grün, wenn der Abbau fehlte -- sie ist an
  // ihrer eigenen Gegenprobe aufgefallen.
  check('KRITISCH: der Schalter baut eine STEHENDE native Karte ab, damit sie neu entsteht',
    await page.evaluate(async () => {
      let abgebaut = false;
      const merkK = rgsNativKarte, merkE = rgsKarteEl;
      // Die Wahl selbst gehoert nicht dieser Pruefung: rgNachtUm schreibt
      // sie um, und die Pruefungen danach lesen sie. Sie wird darum
      // zurueckgestellt -- ohne das faerbte diese Pruefung der naechsten
      // die Ausgangslage um, und die waere ohne eigenes Zutun rot.
      const merkW = localStorage.getItem(RG_NACHT_SCHLUESSEL);
      rgsNativKarte = { destroy: async () => { abgebaut = true; } };
      rgsKarteEl = document.getElementById('rgsKarte');
      try { rgNachtUm(); } catch (e) {}
      await new Promise(r => setTimeout(r, 50));
      rgsNativKarte = merkK; rgsKarteEl = merkE;
      if (merkW === null) { localStorage.removeItem(RG_NACHT_SCHLUESSEL); }
      else { localStorage.setItem(RG_NACHT_SCHLUESSEL, merkW); }
      return abgebaut;
    }));

// ── OP-607 bis OP-610: drei Fehler, die erst die Durchsicht des Codes
// ── zutage gefoerdert hat ────────────────────────────────────────────────

/* OP-607: Die Radien tragen die Farbe des Zustands. Gezeichnet wurden sie
   aber NUR beim Aufbau -- steht die Karte, laeuft jeder weitere Durchlauf
   ueber rgKarteNativAktualisieren, und die ruehrte sie nicht an. Ein
   erfasster Kontrollpunkt blieb darum in der Farbe "offen".

   Geprueft wird die AUSSAGE (die Farbe folgt dem Zustand), nicht ein
   Funktionsaufruf: Die Attrappe merkt sich, mit welchen Farben zuletzt
   gezeichnet wurde, und die Pruefung vergleicht sie mit der Farbe, die
   rgPunktZustand fuer den erledigten Punkt nennt. */
check('KRITISCH: wird ein Kontrollpunkt erfasst, bekommt sein Radius auf der nativen Karte die neue Farbe',
  await page.evaluate(async () => {
    const merkN = window.KarteNativ, merkK = rgsNativKarte, merkE = rgsKarteEl;
    const merkS = rgsKartenSignatur;
    let farben = [];
    const attrappe = {
      setCamera: async () => {}, fitBounds: async () => {},
      enableCurrentLocation: async () => {}, destroy: async () => {},
      removeCircles: async () => {},
      addCircles: async (liste) => { farben = liste.map(c => c.fillColor); return liste.map((_, i) => 'k' + i); },
      getMapBounds: async () => null,
      setOnCameraIdleListener: async () => {},
    };
    window.KarteNativ = { GoogleMap: { create: async () => attrappe } };
    const kp = rundgangAktiv.kontrollpunkte.find(k => k.lat !== null && k.lat !== undefined);
    const merkErledigt = kp.erledigt;
    kp.erledigt = null;
    await rgKarteNativBauen(rgKarteDaten(rundgangAktiv.kontrollpunkte), rgsKarteBauLauf);
    const vorher = farben.slice();
    // Jetzt gilt der Punkt als erfasst -- genau der Fall aus der Runde.
    kp.erledigt = { status: 'ok' };
    const d = rgKarteDaten(rundgangAktiv.kontrollpunkte);
    rgKarteNativAktualisieren(d, '', '');
    await new Promise(r => setTimeout(r, 60));
    const nachher = farben.slice();
    const soll = rgPunktZustand(d.zeigbar.find(p => Number(p.id) === Number(kp.id))).farbe;
    kp.erledigt = merkErledigt;
    await rgKarteNativAbbauen();
    window.KarteNativ = merkN; rgsNativKarte = merkK; rgsKarteEl = merkE;
    rgsKartenSignatur = merkS;
    document.body.classList.remove('karte-nativ');
    // Neu gezeichnet UND in der richtigen Farbe.
    return vorher.length > 0 && nachher.length === vorher.length
      && nachher.join() !== vorher.join() && nachher.includes(soll);
  }));

/* Und die Gegenrichtung: Aendert sich NICHTS an den Punkten, darf auch
   nicht neu gezeichnet werden. Jede Positionsmeldung laeuft durch diese
   Funktion -- ohne die Weiche loeschte die App die Radien im Sekundentakt
   und legte sie wieder an. */
check('KRITISCH: ohne Änderung an den Punkten werden die Radien NICHT neu gezeichnet',
  await page.evaluate(async () => {
    const merkN = window.KarteNativ, merkK = rgsNativKarte, merkE = rgsKarteEl;
    const merkS = rgsKartenSignatur;
    let male = 0;
    const attrappe = {
      setCamera: async () => {}, fitBounds: async () => {},
      enableCurrentLocation: async () => {}, destroy: async () => {},
      removeCircles: async () => {},
      addCircles: async (liste) => { male++; return liste.map((_, i) => 'k' + i); },
      getMapBounds: async () => null,
      setOnCameraIdleListener: async () => {},
    };
    window.KarteNativ = { GoogleMap: { create: async () => attrappe } };
    await rgKarteNativBauen(rgKarteDaten(rundgangAktiv.kontrollpunkte), rgsKarteBauLauf);
    const nachAufbau = male;
    rgKarteNativAktualisieren(rgKarteDaten(rundgangAktiv.kontrollpunkte), '', '');
    rgKarteNativAktualisieren(rgKarteDaten(rundgangAktiv.kontrollpunkte), '', '');
    await new Promise(r => setTimeout(r, 60));
    const nachher = male;
    await rgKarteNativAbbauen();
    window.KarteNativ = merkN; rgsNativKarte = merkK; rgsKarteEl = merkE;
    rgsKartenSignatur = merkS;
    document.body.classList.remove('karte-nativ');
    return nachAufbau === 1 && nachher === 1;
  }));

/* OP-609: Wird der Reiter gewechselt, waehrend GoogleMap.create noch
   laeuft, kam der Aufbau danach trotzdem durch -- er setzte die Klasse
   'karte-nativ' auf den Koerper, und die blendet die Bedienoberflaeche
   aus. Der Waechter saehe auf dem Listen-Reiter eine leere Flaeche.

   Nachgestellt wird der echte Ablauf: Der Abbau faellt MITTEN in das
   Versprechen von create hinein. */
check('KRITISCH: ein Abbau während des Aufbaus lässt die Durchsicht nicht an',
  await page.evaluate(async () => {
    const merkN = window.KarteNativ, merkK = rgsNativKarte, merkE = rgsKarteEl;
    let zerstoert = false;
    const attrappe = {
      setCamera: async () => {}, fitBounds: async () => {},
      enableCurrentLocation: async () => {}, addCircles: async () => [],
      removeCircles: async () => {}, getMapBounds: async () => null,
      setOnCameraIdleListener: async () => {},
      destroy: async () => { zerstoert = true; },
    };
    window.KarteNativ = { GoogleMap: { create: async () => {
      // Genau hier wechselt der Waechter den Reiter.
      await rgKarteNativAbbauen();
      return attrappe;
    } } };
    document.body.classList.remove('karte-nativ');
    rgsNativKarte = null;
    const bauLauf = ++rgsKarteBauLauf;
    await rgKarteNativBauen(rgKarteDaten(rundgangAktiv.kontrollpunkte), bauLauf);
    await new Promise(r => setTimeout(r, 60));
    const durchsicht = document.body.classList.contains('karte-nativ');
    window.KarteNativ = merkN; rgsNativKarte = merkK; rgsKarteEl = merkE;
    document.body.classList.remove('karte-nativ');
    // Die Durchsicht ist aus UND die verwaiste Karte ist weggeräumt --
    // sonst laege sie weiterhin über der Seite.
    return durchsicht === false && zerstoert === true;
  }));

/* Die gruene Fuellung waehrend der Verweilzeit -- DURCHGAENGIG, mit
   echten Kartengrenzen (ENT-579 auf der nativen Karte).

   ANLASS: Vom Projektinhaber am Geraet gemeldet, dass man waehrend der
   fuenf Sekunden nichts sieht. Die bisherigen Pruefungen hatten die
   Geometrie einzeln geprueft und den Aufbau einzeln -- aber nie den
   ganzen Weg von "Waechter steht im Radius" bis "Element steht im
   Dokument und hat eine Groesse". Genau in dieser Luecke sass der Fehler.

   Gemessen wird am gerenderten Zustand, nicht im Quelltext nachgelesen. */
check('KRITISCH: steht der Wächter im Radius, wächst eine sichtbare Füllung auf der nativen Karte',
  await page.evaluate(async () => {
    const merkN = window.KarteNativ, merkK = rgsNativKarte, merkE = rgsKarteEl;
    const merkS = rgsKartenSignatur, merkO = rgsMeinOrt;
    const grenzen = { southwest: { lat: 47.0, lng: 8.0 },
                      northeast: { lat: 47.01, lng: 8.01 },
                      center: { lat: 47.005, lng: 8.005 } };
    const attrappe = {
      setCamera: async () => {}, fitBounds: async () => {},
      enableCurrentLocation: async () => {}, destroy: async () => {},
      removeCircles: async () => {}, addCircles: async () => [],
      removeMarkers: async () => {}, addMarkers: async (l) => l.map((_, i) => 'm' + i),
      setOnMarkerClickListener: async () => {}, setOnCameraIdleListener: async () => {},
      getMapBounds: async () => grenzen,
    };
    window.KarteNativ = { GoogleMap: { create: async () => attrappe } };
    const d = rgKarteDaten(rundgangAktiv.kontrollpunkte);
    await rgKarteNativBauen(d, rgsKarteBauLauf);
    // Der Waechter steht seit zwei Sekunden im Radius des ersten Punkts.
    const kp = rundgangAktiv.kontrollpunkte.find(k => k.lat !== null && k.lat !== undefined);
    const merkTyp = kp.typ, merkErl = kp.erledigt;
    kp.typ = 'geofence'; kp.erledigt = null;
    kp.lat = grenzen.center.lat; kp.lng = grenzen.center.lng;
    kp._drinSeit = Date.now() - 2000;
    kp._autoRest = 3;
    rgsMeinOrt = { lat: grenzen.center.lat, lng: grenzen.center.lng };
    /* Warten, bis die Fuellung steht -- und den Zustand dabei halten.

       Zwei Gruende, warum ein einzelnes requestAnimationFrame hier nicht
       genuegt und die Pruefung davon flackerte: Der Sekundentakt der App
       rechnet _autoRest und _drinSeit staendig neu und raeumte den
       gesetzten Zustand wieder weg, und die Bildfolge des Browsers ist
       nicht auf die Millisekunde verlaesslich. Also: den Waechter
       weiterhin im Radius stehen lassen und bis zu einer Sekunde lang
       nachsehen. Faellt die Fuellung in dieser Zeit nicht, faellt sie
       gar nicht. */
    let el = null;
    for (let i = 0; i < 40 && !el; i++) {
      kp.typ = 'geofence'; kp.erledigt = null;
      kp._drinSeit = Date.now() - 2000; kp._autoRest = 3;
      rgFuellungNachfuehren();
      await new Promise(r => setTimeout(r, 25));
      el = document.querySelector('.rgs-fuellung');
    }
    // Ablesen, SOLANGE das Element im Dokument steht: getComputedStyle
    // liefert eine LEBENDE Sicht -- nach dem Entfernen stuenden dort
    // leere Zeichenketten, und die Pruefung waere rot, ohne dass an der
    // Sache etwas fehlt. (Genau darauf bin ich hier hereingefallen.)
    const mass = el ? el.getBoundingClientRect() : null;
    const sicht = el ? (() => { const c = getComputedStyle(el);
      return { visibility: c.visibility, display: c.display,
               backgroundColor: c.backgroundColor }; })() : null;
    rgFuellungAus();
    kp.typ = merkTyp; kp.erledigt = merkErl;
    kp._drinSeit = null; kp._autoRest = null;
    rgsMeinOrt = merkO;
    await rgKarteNativAbbauen();
    window.KarteNativ = merkN; rgsNativKarte = merkK; rgsKarteEl = merkE;
    rgsKartenSignatur = merkS;
    document.body.classList.remove('karte-nativ');
    return !!el && mass.width > 1 && mass.height > 1
      && sicht.visibility === 'visible' && sicht.display !== 'none'
      && /rgba?\(/.test(sicht.backgroundColor)
      && sicht.backgroundColor !== 'rgba(0, 0, 0, 0)';
  }));

/* Und wenn die Grenzen beim Aufbau NICHT zu haben sind -- die native
   Ansicht ist da gerade erst entstanden --, darf das nicht das Ende sein:
   Die Fuellung fordert sie nach. Ohne das blieb sie fuer die ganze Runde
   unsichtbar, sofern der Waechter die Karte nie verschob. */
check('KRITISCH: scheitert das erste Lesen der Kartengrenzen, werden sie nachgefordert',
  await page.evaluate(async () => {
    const merkN = window.KarteNativ, merkK = rgsNativKarte, merkE = rgsKarteEl;
    const merkS = rgsKartenSignatur;
    const grenzen = { southwest: { lat: 47.0, lng: 8.0 },
                      northeast: { lat: 47.01, lng: 8.01 },
                      center: { lat: 47.005, lng: 8.005 } };
    let versuche = 0;
    const attrappe = {
      setCamera: async () => {}, fitBounds: async () => {},
      enableCurrentLocation: async () => {}, destroy: async () => {},
      removeCircles: async () => {}, addCircles: async () => [],
      removeMarkers: async () => {}, addMarkers: async (l) => l.map((_, i) => 'm' + i),
      setOnMarkerClickListener: async () => {}, setOnCameraIdleListener: async () => {},
      // Der erste Versuch scheitert, wie auf dem Geraet moeglich.
      getMapBounds: async () => {
        versuche++;
        if (versuche === 1) { throw new Error('noch nicht so weit'); }
        return grenzen;
      },
    };
    window.KarteNativ = { GoogleMap: { create: async () => attrappe } };
    await rgKarteNativBauen(rgKarteDaten(rundgangAktiv.kontrollpunkte), rgsKarteBauLauf);
    const nachAufbau = rgsNativGrenzen;
    // Ein Zeichenversuch ohne Grenzen muss das Nachfordern ausloesen.
    // Das Zeichnen laeuft in der Runde rahmenweise -- also auch hier
    // zweimal, mit der Bremse dazwischen. Beim ersten Mal ist das
    // Nachfordern noch gebremst (das Lesen beim Aufbau liegt keine
    // Millisekunde zurueck), beim zweiten greift es.
    const p = { lat: grenzen.center.lat, lng: grenzen.center.lng, geofence_radius_m: 20 };
    rgFuellungNativZeichnen(p, 0.5);
    await new Promise(r => setTimeout(r, 300));
    rgFuellungNativZeichnen(p, 0.5);
    await new Promise(r => setTimeout(r, 150));
    const danach = rgsNativGrenzen;
    await rgKarteNativAbbauen();
    window.KarteNativ = merkN; rgsNativKarte = merkK; rgsKarteEl = merkE;
    rgsKartenSignatur = merkS;
    document.body.classList.remove('karte-nativ');
    return nachAufbau === null && !!danach && !!danach.southwest;
  }));

/* Die Marken der Kontrollpunkte auf der nativen Karte (ENT-609).

   ANLASS (vom Projektinhaber am Geraet gemeldet): Beim Herauszoomen
   verschwanden die Kontrollpunkte vollstaendig. Es standen nur die
   Geofence-KREISE da, und die haben den echten Radius in Metern -- auf
   einer weiten Karte weniger als ein Bildpunkt. Eine Marke hat eine
   feste Groesse in Bildpunkten und bleibt sichtbar.

   Geprueft wird die AUSSAGE (die Marke traegt das Bild, das zum Zustand
   gehoert), nicht ein Dateiname im Quelltext: Der Sollwert kommt aus
   rgPunktZustand, derselben Quelle, die auch die Browser-Karte faerbt. */
check('KRITISCH: beim Aufbau bekommt jeder Kontrollpunkt eine Marke mit dem Bild seines Zustands',
  await page.evaluate(async () => {
    const merkN = window.KarteNativ, merkK = rgsNativKarte, merkE = rgsKarteEl;
    const merkS = rgsKartenSignatur;
    let gesetzt = [];
    const attrappe = {
      setCamera: async () => {}, fitBounds: async () => {},
      enableCurrentLocation: async () => {}, destroy: async () => {},
      removeCircles: async () => {}, addCircles: async () => [],
      getMapBounds: async () => null, setOnCameraIdleListener: async () => {},
      setOnMarkerClickListener: async () => {},
      removeMarkers: async () => {},
      addMarkers: async (liste) => { gesetzt = liste; return liste.map((_, i) => 'm' + i); },
    };
    window.KarteNativ = { GoogleMap: { create: async () => attrappe } };
    const d = rgKarteDaten(rundgangAktiv.kontrollpunkte);
    await rgKarteNativBauen(d, rgsKarteBauLauf);
    const soll = d.zeigbar.map(p => rgPunktZustand(p).bild);
    const ist = gesetzt.map(m => m.iconUrl);
    await rgKarteNativAbbauen();
    window.KarteNativ = merkN; rgsNativKarte = merkK; rgsKarteEl = merkE;
    rgsKartenSignatur = merkS;
    document.body.classList.remove('karte-nativ');
    return d.zeigbar.length > 0 && ist.length === d.zeigbar.length
      && ist.every((b, i) => b === soll[i]) && ist.every(b => /\.png$/.test(b));
  }));

/* Der Anker sitzt in der MITTE des Bildes, nicht unten.

   Die Voreinstellung des Plugins geht von einer Stecknadel aus und setzt
   den Anker unten mittig. Unsere Marke ist aber eine Scheibe wie in der
   Browser-Fassung -- mit der Voreinstellung haenge sie um ihren halben
   Durchmesser zu weit noerdlich, also neben dem Kontrollpunkt. */
check('KRITISCH: die Marke ist auf ihrer Mitte verankert, nicht auf ihrem unteren Rand',
  await page.evaluate(async () => {
    const merkN = window.KarteNativ, merkK = rgsNativKarte, merkE = rgsKarteEl;
    const merkS = rgsKartenSignatur;
    let gesetzt = [];
    const attrappe = {
      setCamera: async () => {}, fitBounds: async () => {},
      enableCurrentLocation: async () => {}, destroy: async () => {},
      removeCircles: async () => {}, addCircles: async () => [],
      getMapBounds: async () => null, setOnCameraIdleListener: async () => {},
      setOnMarkerClickListener: async () => {}, removeMarkers: async () => {},
      addMarkers: async (liste) => { gesetzt = liste; return liste.map((_, i) => 'm' + i); },
    };
    window.KarteNativ = { GoogleMap: { create: async () => attrappe } };
    await rgKarteNativBauen(rgKarteDaten(rundgangAktiv.kontrollpunkte), rgsKarteBauLauf);
    const m = gesetzt[0];
    await rgKarteNativAbbauen();
    window.KarteNativ = merkN; rgsNativKarte = merkK; rgsKarteEl = merkE;
    rgsKartenSignatur = merkS;
    document.body.classList.remove('karte-nativ');
    return !!m && m.iconSize && m.iconAnchor
      && m.iconSize.width > 0 && m.iconSize.height > 0
      && Math.abs(m.iconAnchor.x - m.iconSize.width / 2) < 0.01
      && Math.abs(m.iconAnchor.y - m.iconSize.height / 2) < 0.01;
  }));

/* Wird ein Punkt erfasst, muss auch die MARKE das neue Bild tragen --
   nicht nur der Kreis seine neue Farbe. Beides haengt an rgPunktZustand;
   die Marke war beim ersten Bauen aber nicht mitgezogen worden. */
check('KRITISCH: wird ein Kontrollpunkt erfasst, wechselt auch das Bild seiner Marke',
  await page.evaluate(async () => {
    const merkN = window.KarteNativ, merkK = rgsNativKarte, merkE = rgsKarteEl;
    const merkS = rgsKartenSignatur;
    let bilder = [];
    const attrappe = {
      setCamera: async () => {}, fitBounds: async () => {},
      enableCurrentLocation: async () => {}, destroy: async () => {},
      removeCircles: async () => {}, addCircles: async () => [],
      getMapBounds: async () => null, setOnCameraIdleListener: async () => {},
      setOnMarkerClickListener: async () => {}, removeMarkers: async () => {},
      addMarkers: async (liste) => { bilder = liste.map(m => m.iconUrl); return liste.map((_, i) => 'm' + i); },
    };
    window.KarteNativ = { GoogleMap: { create: async () => attrappe } };
    const kp = rundgangAktiv.kontrollpunkte.find(k => k.lat !== null && k.lat !== undefined);
    const merkErledigt = kp.erledigt;
    kp.erledigt = null;
    await rgKarteNativBauen(rgKarteDaten(rundgangAktiv.kontrollpunkte), rgsKarteBauLauf);
    const vorher = bilder.slice();
    kp.erledigt = { status: 'ok' };
    const d = rgKarteDaten(rundgangAktiv.kontrollpunkte);
    rgKarteNativAktualisieren(d, '', '');
    await new Promise(r => setTimeout(r, 60));
    const nachher = bilder.slice();
    const soll = rgPunktZustand(d.zeigbar.find(p => Number(p.id) === Number(kp.id))).bild;
    kp.erledigt = merkErledigt;
    await rgKarteNativAbbauen();
    window.KarteNativ = merkN; rgsNativKarte = merkK; rgsKarteEl = merkE;
    rgsKartenSignatur = merkS;
    document.body.classList.remove('karte-nativ');
    return vorher.length > 0 && nachher.join() !== vorher.join() && nachher.includes(soll);
  }));

/* Ein Tipp auf die Marke oeffnet die Blase -- dieselbe Verdrahtung wie in
   der Browser-Fassung (ENT-654).

   REVIDIERT: Bis ENT-654 sprang der Tipp unmittelbar in die Liste, und
   genau das stand hier. Die AUSSAGE bleibt und ist sogar schaerfer
   geworden: Der Tipp muss verdrahtet sein, er muss den RICHTIGEN Punkt
   treffen (das SDK meldet nur seine eigene Markenkennung zurueck -- ohne
   die Zuordnung waere jede Marke dieselbe), und gemeldet wird weiterhin
   nicht auf der Karte.

   Der Reiter wechselt dabei NICHT mehr. Das ist der ganze Unterschied. */
check('KRITISCH: ein Tipp auf eine native Marke oeffnet die Blase zu genau diesem Punkt',
  await page.evaluate(async () => {
    const merkN = window.KarteNativ, merkK = rgsNativKarte, merkE = rgsKarteEl;
    const merkS = rgsKartenSignatur, merkR = rgsReiter;
    let hoerer = null;
    const attrappe = {
      setCamera: async () => {}, fitBounds: async () => {},
      enableCurrentLocation: async () => {}, destroy: async () => {},
      removeCircles: async () => {}, addCircles: async () => [],
      getMapBounds: async () => null, setOnCameraIdleListener: async () => {},
      removeMarkers: async () => {}, addMarkers: async (l) => l.map((_, i) => 'm' + i),
      setOnMarkerClickListener: async (cb) => { hoerer = cb; },
      setOnMapClickListener: async () => {},
    };
    window.KarteNativ = { GoogleMap: { create: async () => attrappe } };
    await rgKarteNativBauen(rgKarteDaten(rundgangAktiv.kontrollpunkte), rgsKarteBauLauf);
    const verdrahtet = typeof hoerer === 'function';
    // Die Attrappe vergibt ihre Kennungen der Reihe nach ("m0", "m1", ...),
    // genau wie das SDK. 'm0' ist damit der erste darstellbare Punkt.
    const ersterId = rgKarteDaten(rundgangAktiv.kontrollpunkte).zeigbar[0].id;
    if (verdrahtet) { hoerer({ markerId: 'm0' }); }
    await new Promise(r => setTimeout(r, 120));
    const richtigerPunkt = rgsBlasePunktId === ersterId;
    const bleibtAufKarte = rgsReiter === 'karte';
    rgKarteBlaseZu();
    await rgKarteNativAbbauen();
    window.KarteNativ = merkN; rgsNativKarte = merkK; rgsKarteEl = merkE;
    rgsKartenSignatur = merkS;
    document.body.classList.remove('karte-nativ');
    // Der Tipp hat den Reiter wirklich gewechselt und damit den Rumpf
    // ersetzt. Zurueck auf den Karten-Reiter, sonst steht den Pruefungen
    // danach keine Karte mehr zur Verfuegung -- und sie waeren rot, ohne
    // dass an ihrer eigenen Sache etwas fehlt.
    if (merkR !== rgsReiter) { rgLaufReiter(merkR); }
    await new Promise(r => setTimeout(r, 400));
    return verdrahtet && richtigerPunkt && bleibtAufKarte;
  }));

/* OP-610: Abbau und Aufbau tragen dieselbe Kartenkennung. Bis hierher
   liefen sie nebeneinander -- destroy() der alten war noch unterwegs,
   waehrend create() die neue schon anlegte. */
check('KRITISCH: eine neue native Karte entsteht erst, wenn die alte ganz abgebaut ist',
  await page.evaluate(async () => {
    const merkN = window.KarteNativ, merkK = rgsNativKarte, merkE = rgsKarteEl;
    let abbauFertig = false, abbauLief = null;
    const attrappe = {
      setCamera: async () => {}, fitBounds: async () => {},
      enableCurrentLocation: async () => {}, addCircles: async () => [],
      removeCircles: async () => {}, getMapBounds: async () => null,
      setOnCameraIdleListener: async () => {},
      // Ein Abbau, der wirklich dauert -- so wie auf dem Geraet.
      destroy: () => new Promise(r => setTimeout(() => { abbauFertig = true; r(); }, 80)),
    };
    window.KarteNativ = { GoogleMap: { create: async () => {
      // Was beim Erzeugen gilt, ist die Frage: War der Abbau da schon durch?
      if (abbauLief === null) { abbauLief = abbauFertig; }
      return attrappe;
    } } };
    rgsNativKarte = attrappe;
    rgsKarteEl = document.getElementById('rgsKarte');
    // Der Abbau wird NICHT abgewartet -- genau so rufen ihn rgNachtUm und
    // rgKarteZeichnen auf.
    rgKarteNativAbbauen();
    const bauLauf = ++rgsKarteBauLauf;
    await rgKarteNativBauen(rgKarteDaten(rundgangAktiv.kontrollpunkte), bauLauf);
    await new Promise(r => setTimeout(r, 150));
    await rgKarteNativAbbauen();
    window.KarteNativ = merkN; rgsNativKarte = merkK; rgsKarteEl = merkE;
    document.body.classList.remove('karte-nativ');
    return abbauLief === true;
  }));
/* REVIDIERT durch ENT-654. Hier stand: "ein Tipp auf eine Marke fuehrt in
   die Kontrollpunkt-Liste, nicht in eine zweite Maske". Der erste Teil
   gilt nicht mehr -- der Tipp oeffnet jetzt eine Blase. Der ZWEITE Teil
   ist der eigentliche Inhalt und gilt unveraendert: Gemeldet wird in der
   Liste, nicht auf der Karte. Die Bestaetigung haengt an
   Standortpruefung, Ersatzscan und Aufgaben-Rueckfrage -- die alle in
   eine Kartenblase zu holen hiesse, denselben Ablauf ein zweites Mal zu
   bauen.

   Geprueft wird darum jetzt beides: dass die Blase KEINE zweite
   Meldemaske ist, und dass der Weg in die Liste von dort aus weiterhin
   offensteht. Ohne den zweiten Teil koennte die Blase den Weg in die
   Liste ersatzlos verschlucken und diese Pruefung bliebe gruen.

   dispatchEvent statt echtem Mausklick: Die Attrappe setzt ihre Marken
   frei positioniert in den Kartencontainer, und der Zentrieren-Knopf
   liegt als Ueberlagerung darueber. Geprueft wird hier die Verdrahtung,
   nicht die Treffergeometrie einer nachgebauten Karte. */
await page.dispatchEvent('#rgsKarte .gm-mock-marker', 'click');
await page.waitForTimeout(300);
const blaseAuf = await page.evaluate(() => {
  const b = document.getElementById('rgsBlase');
  if (!b || b.hidden) { return null; }
  return {
    // Irgendetwas, das eine Meldung ausloesen wuerde? Die Blase darf
    // zeigen und fuehren, nicht bestaetigen.
    meldeknopf: !!b.querySelector('[onclick*="rdBestaetigen"], [onclick*="rdEsUm"], [onclick*="rdNvUm"]'),
    wegZurListe: !!document.getElementById('rgsBlaseListe'),
  };
});
check('KRITISCH: ein Tipp auf eine Marke oeffnet die Blase',
  blaseAuf !== null);
check('KRITISCH: die Blase ist KEINE zweite Meldemaske -- gemeldet wird weiterhin in der Liste',
  !!blaseAuf && blaseAuf.meldeknopf === false);
check('KRITISCH: und der Weg in die Liste steht von der Blase aus weiterhin offen',
  !!blaseAuf && blaseAuf.wegZurListe === true);
await page.evaluate(() => rgKarteBlaseZu());
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

// ══════════ ENT-331: VOLLE BREITE UND NACHTSICHT ══════════════════════
// Vom Projektinhaber: "Innerhalb des Rundgangs, Kartenreiter. Hier moechte
// ich, dass die volle Breite ausgenuetzt wird vom Bildschirm. Ausserdem
// muss die Moeglichkeit bestehen, eine 'Nachtsicht' zu bekommen wie im
// Screenshot von Coredinate."
//
// Beides wird GEMESSEN, nicht im Quelltext nachgelesen (CLAUDE.md): Die
// Breite an den tatsaechlichen Rechtecken, die Nachtsicht an der Farbe,
// die die Karte dadurch wirklich annimmt. Eine CSS-Regel kann wirkungslos
// bleiben, ohne dass etwas kaputtgeht.
const breite = await page.evaluate(() => {
  const h = document.querySelector('.rgs-karte-huelle');
  const s = document.getElementById('rgSeite');
  if (!h || !s) return null;
  const k = h.getBoundingClientRect(), seite = s.getBoundingClientRect();
  return { kl: k.left, kr: k.right, kb: k.width, sl: seite.left, sr: seite.right, sb: seite.width };
}) || { kl: -1, kr: -1, kb: -1, sl: 0, sr: 0, sb: 0 };
check('KRITISCH: die Karte nutzt die volle Breite der Seite (gemessen, 390px)',
  Math.abs(breite.kb - breite.sb) <= 1);
check('KRITISCH: sie steht dabei bündig an beiden Rändern, nicht nur breiter',
  Math.abs(breite.kl - breite.sl) <= 1 && Math.abs(breite.kr - breite.sr) <= 1);
check('KRITISCH: die volle Breite erzeugt keinen waagrechten Seiten-Scroll',
  await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
// Ein Randstreifen des Rumpfes darf dabei nicht mitverschwinden: Die Liste
// und die Hinweise behalten ihren Rand, nur die Karte geht bis aussen.
await klick(page, '#rgsRt-punkte');
await page.waitForTimeout(250);
check('Der Rand des Rumpfes bleibt für alles andere erhalten',
  await page.evaluate(() => {
    const l = document.getElementById('rdListe');
    if (!l) return false;
    const seite = document.getElementById('rgSeite').getBoundingClientRect();
    return l.getBoundingClientRect().left - seite.left >= 12;
  }));
await klick(page, '#rgsRt-karte');
await page.waitForTimeout(700);

// ── Kartenbild: Nachtsicht / Tagansicht / Satellit ────────────────────
/* Bis ENT-640 war das ein einzelner Umschalter „Nachtsicht" unten rechts
   auf der Karte. Es ist jetzt eine Dreierwahl im Einstellungsblatt hinter
   dem Zahnrad -- Vorgabe des Projektinhabers. Die Aussagen dieses Blocks
   bleiben dieselben (Nachtsicht ist die Vorgabe, die Karte wird wirklich
   dunkel, es geht in beide Richtungen, die Wahl ueberdauert Reiterwechsel
   und Runde); nur der Weg dorthin fuehrt jetzt ueber das Zahnrad. */
const zahnDa = await page.$('#rgsEinstKnopf') !== null;
check('KRITISCH: es gibt ein Zahnrad, das die Einstellungen oeffnet', zahnDa);
await klick(page, '#rgsEinstKnopf');
await page.waitForTimeout(300);
const nachtDa = await page.$('#rgsKb-nacht') !== null;
check('KRITISCH: darin steht die Wahl des Kartenbildes', nachtDa);
check('KRITISCH: Nachtsicht ist die VORGABE — die Runde läuft nachts',
  nachtDa && await page.evaluate(() =>
    document.getElementById('rgsKb-nacht').getAttribute('aria-checked') === 'true'
    && document.getElementById('rgsKb-nacht').classList.contains('an')));
check('KRITISCH: immer genau EINE Wahl ist aktiv — „Nachtsicht und Satellit" gibt es nicht',
  await page.evaluate(() =>
    [...document.querySelectorAll('.rgs-seg-b')].filter(b => b.classList.contains('an')).length === 1));
// Der eigentliche Beweis: Die Karte wird dadurch wirklich dunkel. Die
// Attrappe faerbt ihren Container mit der Grundfarbe des uebergebenen
// Stils -- ohne das waere nur belegt, dass irgendein Array uebergeben wurde.
const dunkel = await page.evaluate(() => {
  const el = document.getElementById('rgsKarte');
  return el ? el.dataset.kartenstil : null;
});
check('KRITISCH: die Karte nimmt den dunklen Stil tatsächlich an (gemessen)',
  typeof dunkel === 'string' && dunkel !== 'standard' && dunkel !== undefined
  && (() => { const h = dunkel.replace('#', '');
       if (h.length !== 6) return false;
       const hell = (parseInt(h.slice(0,2),16) + parseInt(h.slice(2,4),16) + parseInt(h.slice(4,6),16)) / 3;
       return hell < 90; })());
check('Jede der drei Wahlen hat eine brauchbare Trefferfläche (CLAUDE.md)',
  nachtDa && await page.evaluate(() =>
    [...document.querySelectorAll('.rgs-seg-b')]
      .every(b => b.getBoundingClientRect().height >= 44)));
check('KRITISCH: das Blatt verdeckt die Reiterleiste nicht — wer sich verklickt, kommt weiter',
  await page.evaluate(() => {
    const bl = document.getElementById('rgsEinst').getBoundingClientRect();
    const rt = document.querySelector('.rgs-reiter');
    return !!rt && bl.bottom <= rt.getBoundingClientRect().top + 1;
  }));
await page.screenshot({ path: `${OUT}/karte-05-nachtsicht.png` });

// Abschalten muss auch wirklich abschalten -- sonst waere der Knopf eine
// Behauptung. Und die Wahl muss die Runde ueberdauern: Wer sie bei jedem
// Reiterwechsel neu treffen muesste, wuerde sie nicht treffen.
await klick(page, '#rgsKb-tag');
await page.waitForTimeout(400);
check('KRITISCH: Abschalten macht die Karte wieder hell (gemessen)',
  await page.evaluate(() => {
    const el = document.getElementById('rgsKarte');
    return !!el && el.dataset.kartenstil === 'standard';
  }));
check('Die Wahl zeigt den neuen Zustand an, nicht den alten',
  await page.evaluate(() => {
    const n = document.getElementById('rgsKb-nacht'), t = document.getElementById('rgsKb-tag');
    return !!n && !!t && n.getAttribute('aria-checked') === 'false'
      && t.getAttribute('aria-checked') === 'true';
  }));
await klick(page, '#rgsRt-punkte');
await page.waitForTimeout(200);
await klick(page, '#rgsRt-karte');
await page.waitForTimeout(700);
/* Das Blatt schliesst seit ENT-640 beim Reiterwechsel (es gehoert zur
   Karte). Geprueft wird darum zweierlei: die KARTE traegt die Wahl noch,
   und das Blatt zeigt sie nach dem Wiederoeffnen unveraendert an. Nur das
   zweite allein waere zu wenig -- ein Blatt kann die richtige Wahl zeigen
   und die Karte trotzdem falsch stehen. */
check('KRITISCH: die Wahl überdauert den Reiterwechsel',
  await page.evaluate(() => {
    const el = document.getElementById('rgsKarte');
    return !!el && el.dataset.kartenstil === 'standard';
  }));
await klick(page, '#rgsEinstKnopf');
await page.waitForTimeout(300);
check('Und das Blatt zeigt sie nach dem Wiederöffnen unverändert an',
  await page.evaluate(() => {
    const t = document.getElementById('rgsKb-tag');
    return !!t && t.getAttribute('aria-checked') === 'true';
  }));
await klick(page, '#rgsEinstX');
await page.waitForTimeout(150);
check('Sie überdauert auch das Verlassen und erneute Öffnen der Runde',
  await page.evaluate(async () => {
    rgSeiteZu();
    await new Promise(r => setTimeout(r, 250));
    rundgangFortsetzen(71);
    await new Promise(r => setTimeout(r, 1600));
    const el = document.getElementById('rgsKarte');
    return !!el && el.dataset.kartenstil === 'standard';
  }));
// Wieder einschalten und dabei pruefen, dass es in BEIDE Richtungen geht.
await klick(page, '#rgsEinstKnopf');
await page.waitForTimeout(300);
await klick(page, '#rgsKb-nacht');
await page.waitForTimeout(400);
check('KRITISCH: Einschalten geht ebenso — die Wahl kennt beide Richtungen',
  await page.evaluate(() => {
    const el = document.getElementById('rgsKarte'), n = document.getElementById('rgsKb-nacht');
    return !!el && !!n && el.dataset.kartenstil !== 'standard'
      && n.getAttribute('aria-checked') === 'true';
  }));

// ── Der Kartenreiter steht beim Start von selbst offen ────────────────
// Vom Projektinhaber: "beim Rundgang start bitte direkt zuerst den
// Kartenreiter zeigen." Beim Losgehen lautet die Frage "wo bin ich, wo ist
// der naechste Punkt" -- die beantwortet die Karte, nicht die Liste.
check('KRITISCH: eine frisch geöffnete Runde steht auf dem Kartenreiter',
  await page.evaluate(async () => {
    rgSeiteZu();
    await new Promise(r => setTimeout(r, 250));
    rundgangFortsetzen(71);
    await new Promise(r => setTimeout(r, 1600));
    const rt = document.getElementById('rgsRt-karte');
    return !!rt && rt.classList.contains('an') && rgsReiter === 'karte';
  }));
// Und der Reiter darf nicht kleben: Wer bewusst in die Liste wechselt, muss
// dort bleiben. Die Seite wird waehrend einer Runde bei JEDER neuen
// Position neu gezeichnet -- ohne diese Grenze spraenge die Ansicht im
// Sekundentakt auf die Karte zurueck.
// Neu gezeichnet wird ueber rundgangAnzeigen() -- dort sitzt die Weiche.
// rgLaufZeichnen() allein waere die falsche Stelle: Es zeichnet nur den
// gewaehlten Reiter und kann den Reiter gar nicht wechseln; eine Pruefung
// darauf koennte nie rot werden (in der Gegenprobe genau so aufgefallen).
check('KRITISCH: ein danach gewählter Reiter bleibt beim Neuzeichnen stehen',
  await page.evaluate(async () => {
    rgLaufReiter('punkte');
    await new Promise(r => setTimeout(r, 250));
    rundgangAnzeigen(71);
    await new Promise(r => setTimeout(r, 400));
    return rgsReiter === 'punkte' && !!document.getElementById('rdListe');
  }));
// Eine Runde ganz ohne darstellbare Punkte (nur NFC) darf NICHT auf der
// Karte oeffnen: Dort staende dann „keine darstellbaren Punkte" statt der
// Kontrollpunkte -- der Waechter wuerde mit einer Fehlanzeige begruesst.
check('KRITISCH: eine Runde ohne darstellbare Punkte öffnet auf der Liste, nicht auf der leeren Karte',
  await page.evaluate(async () => {
    rgSeiteZu();
    await new Promise(r => setTimeout(r, 250));
    await window.__ohneOrtSetzen(true);   // die Attrappe liefert dann Punkte ohne Koordinaten
    rundgangAktiv = null;
    rundgangFortsetzen(71);
    await new Promise(r => setTimeout(r, 1200));
    const ok = rgsReiter === 'punkte' && !!document.getElementById('rdListe');
    await window.__ohneOrtSetzen(false);
    return ok;
  }));
// Eine beendete oder abgebrochene Runde bleibt auf der Liste: Dort steht,
// was geschehen ist -- eine Karte ohne laufende Position sagt dazu nichts.
check('Eine abgeschlossene Runde öffnet weiterhin auf der Liste, nicht auf der Karte',
  await page.evaluate(async () => {
    rgSeiteZu();
    await new Promise(r => setTimeout(r, 250));
    rundgangAktiv = null;
    rundgangFortsetzen(71);
    await new Promise(r => setTimeout(r, 900));
    if (!rundgangAktiv) return false;
    rundgangAktiv.status = 'abgeschlossen';
    rundgangAnzeigen(71);
    await new Promise(r => setTimeout(r, 400));
    return rgsReiter === 'punkte';
  }));
// Zustand fuer die nachfolgenden Abschnitte wieder herstellen.
await page.evaluate(async () => {
  rgSeiteZu();
  await new Promise(r => setTimeout(r, 250));
  rundgangFortsetzen(71);
  await new Promise(r => setTimeout(r, 1600));
});
await klick(page, '#rgsRt-karte');
await page.waitForTimeout(700);

// ── Dritter Fehlerfall: Skript laedt, Schluessel wird abgelehnt ────────
// Live aufgetreten (ENT-309): Das Skript laedt, google.maps ist da, die
// Karte wird gebaut -- und erst danach meldet der Anbieter asynchron, dass
// der Schluessel fuer diese Seite nicht gilt. Er schreibt dann seine eigene
// graue Tafel in unseren Container: "Google Maps wurde auf dieser Seite
// nicht richtig geladen. Technische Details entnimmst du der
// JavaScript-Konsole." Das ist auf einem Diensthandy nachts keine Auskunft
// -- und es ist genau das graue Rechteck, das diese Karte vermeiden soll.
// Abfangbar ist es nur ueber gm_authFailure, das der Anbieter beim Namen
// aufruft.
// Erst pruefen, DASS es den Rueckruf gibt -- sonst stuerzt die Suite hier
// ab, statt eine Aussage rot zu melden. Genau dieser Mangel ist in ENT-302,
// ENT-304 und ENT-305 schon dreimal aufgetreten.
const rueckrufDa = await page.evaluate(() => typeof window.gm_authFailure === 'function');
check('KRITISCH: es gibt überhaupt einen Rückruf für den abgelehnten Schlüssel (gm_authFailure)', rueckrufDa);
if (rueckrufDa) {
// In der Datei auf der Platte steht immer der Platzhalter -- ersetzt wird
// er erst beim Ausliefern. Hier geht es um die AUSGELIEFERTE Fassung mit
// gueltigem Schluessel, bei der die Ablehnung wirklich eine Sache der
// Freigabe beim Anbieter ist. Der andere Fall steht weiter unten.
await page.evaluate(() => { rgsMapsSchluesselDa = true; });
await page.evaluate(() => window.gm_authFailure());
await page.waitForTimeout(300);
// STEHT die Karte, wird sie NICHT zugedeckt (ENT-312). Vom Projektinhaber
// gemeldet: "Die Karte laedt nun kurz und danach kommt deine Meldung, die
// die Karte wieder ueberdeckt." Der Anbieter ruft gm_authFailure auch dann,
// wenn die Kacheln schon gezeichnet sind -- die erste Fassung nahm dem
// Waechter damit genau das weg, wofuer die Meldung warnt.
check('KRITISCH: eine STEHENDE Karte wird nicht zugedeckt',
  await page.isVisible('#rgsKarte')
  && await page.$('#rgsKarteStand') === null
  && (await page.$$('#rgsKarte .gm-mock-marker')).length === 2);
// Erst pruefen, DASS es den Streifen gibt -- sonst stuerzt die Suite bei den
// Messungen darunter ab, statt eine Aussage rot zu melden. Fuenftes Mal
// derselbe Mangel (ENT-302, ENT-304, ENT-305, ENT-309); die Gegenprobe
// "wieder zudecken" hat ihn hier zum Vorschein gebracht.
const streifenDa = await page.$('#rgsKarteWarnung') !== null;
check('KRITISCH: die Warnung steht trotzdem da, als schmaler Streifen',
  streifenDa && await page.isVisible('#rgsKarteWarnung')
  && (await page.textContent('#rgsKarteWarnung')).includes('nicht freigegeben'));
// Ein Streifen, der die halbe Karte einnimmt, waere dasselbe Problem in
// kleiner. Gemessen, nicht angenommen.
check('KRITISCH: der Streifen nimmt höchstens ein Fünftel der Kartenhöhe ein',
  streifenDa && await page.evaluate(() => {
    const k = document.querySelector('.rgs-karte-huelle').getBoundingClientRect().height;
    const wn = document.getElementById('rgsKarteWarnung').getBoundingClientRect().height;
    return k > 100 && wn > 0 && wn < k / 5;
  }));
check('KRITISCH: der Streifen liegt UNTER der Karte, nicht darüber',
  streifenDa && await page.evaluate(() => {
    const k = document.querySelector('.rgs-karte-huelle').getBoundingClientRect();
    const wn = document.getElementById('rgsKarteWarnung').getBoundingClientRect();
    return wn.top >= k.bottom - 1;
  }));
// Eine CSS-Klasse, die es nicht gibt, bleibt wirkungslos, ohne dass etwas
// kaputtgeht -- beim Bauen von ENT-311 ist mir genau das passiert.
check('Die Warnfarbe ist auch wirklich definiert, nicht nur angehängt',
  /\.rgs-karte-hinweis\.fehler\s*\{/.test(APP));
check('Der Zentrieren-Knopf bleibt, weil es weiterhin etwas zu zentrieren gibt',
  await page.isVisible('#rgsZentrieren'));
// Wird die Freigabe beim Anbieter in Ordnung gebracht -- was bis zu fuenf
// Minuten dauert --, muss die Karte in derselben Sitzung wiederkommen.
await page.click('#rgsRt-punkte');
await page.waitForTimeout(200);
await page.click('#rgsRt-karte');
await page.waitForTimeout(700);
check('KRITISCH: beim erneuten Öffnen wird wieder gebaut, nicht dauerhaft gesperrt',
  await page.isVisible('#rgsKarte')
  && (await page.$$('#rgsKarte .gm-mock-marker')).length === 2);
check('Die Kontrollpunkt-Liste bleibt auch dann vollständig erreichbar',
  await page.evaluate(async () => {
    document.getElementById('rgsRt-punkte').click();
    await new Promise(r => setTimeout(r, 200));
    return document.querySelectorAll('#rdListe .rd-bez').length === 3;
  }));
await page.screenshot({ path: `${OUT}/karte-04-gesperrt.png` });
await page.evaluate(() => { rgsMapsAbgelehnt = false; });
} else {
  ['KRITISCH: eine STEHENDE Karte wird nicht zugedeckt',
   'KRITISCH: die Warnung steht trotzdem da, als schmaler Streifen',
   'KRITISCH: der Streifen nimmt höchstens ein Fünftel der Kartenhöhe ein',
   'KRITISCH: der Streifen liegt UNTER der Karte, nicht darüber',
   'Die Warnfarbe ist auch wirklich definiert, nicht nur angehängt',
   'Der Zentrieren-Knopf bleibt, weil es weiterhin etwas zu zentrieren gibt',
   'KRITISCH: beim erneuten Öffnen wird wieder gebaut, nicht dauerhaft gesperrt',
   'Die Kontrollpunkt-Liste bleibt auch dann vollständig erreichbar',
  ].forEach(n => check(n + ' (nicht prüfbar: kein gm_authFailure)', false));
}

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

// ══════════ GESPERRT UND GAR KEINE KARTE ══════════════════════════════
// Der andere Halbfall zu ENT-312: Steht KEINE Karte, muss weiterhin die
// volle Erklaerung erscheinen -- sonst bliebe genau das graue Rechteck
// ohne Auskunft zurueck, gegen das ENT-309 gebaut wurde. Der Streifen
// waere hier zu wenig: Es gibt nichts, worunter er stehen koennte.
// Hier ist die Maps-Attrappe abgewiesen, es existiert also keine Karte.
if (rueckrufDa) {
  await page.evaluate(() => { rgsMapsSchluesselDa = true; rgsKarte = null; window.gm_authFailure(); });
  await page.waitForTimeout(250);
  check('KRITISCH: ohne stehende Karte erscheint weiterhin die volle Erklärung (ENT-309)',
    await page.isVisible('#rgsKarteStand')
    && (await page.textContent('#rgsKarteStand')).includes('kein Fehler an deinem Gerät')
    && (await page.textContent('#rgsKarteStand')).includes('läuft normal weiter'));
  check('Und der Zentrieren-Knopf verschwindet, weil es nichts zu zentrieren gibt',
    await page.$('#rgsZentrieren') === null);
} else {
  ['KRITISCH: ohne stehende Karte erscheint weiterhin die volle Erklärung (ENT-309)',
   'Und der Zentrieren-Knopf verschwindet, weil es nichts zu zentrieren gibt',
  ].forEach(n => check(n + ' (nicht prüfbar: kein gm_authFailure)', false));
}

// ══════════ ABGELEHNT, WEIL GAR KEIN SCHLÜSSEL DRIN IST ═══════════════
// Vom Projektinhaber am Geraet gemeldet: In der laufenden Runde stand die
// graue Tafel des Anbieters, darunter unsere Meldung, die Seite sei nicht
// freigegeben. Das stimmte nicht. Im Buendel stand noch der Platzhalter
// __MAPS_JS_KEY__ statt eines Schluessels -- das Einsetzen beim Bauen war
// uebersprungen worden, weil mobile/.maps-key fehlte.
//
// Der Anbieter meldet beides ueber denselben Rueckruf und nennt keinen
// Grund. Unterscheiden laesst es sich nur am Schluessel selbst. Und es
// MUSS unterschieden werden: Wer liest, die Seite sei nicht freigegeben,
// meldet der Verwaltung eine Einstellung, die es gar nicht gibt --
// waehrend in Wahrheit ein Schritt beim Ausliefern fehlt.
check('KRITISCH: der Platzhalter gilt nicht als Schlüssel',
  await page.evaluate(() => mapsSchluesselTauglich('__MAPS_JS_KEY__') === false));
check('Ein leerer Schlüssel auch nicht',
  await page.evaluate(() => mapsSchluesselTauglich('') === false
    && mapsSchluesselTauglich(null) === false));
check('KRITISCH: ein echter Schlüssel gilt',
  await page.evaluate(() => mapsSchluesselTauglich('AIzaSyD-Beispiel_ohne_Bedeutung_123') === true));
// Der Fall, an dem es tatsächlich gescheitert ist: Beim Einrichten landete
// der Beispieltext aus der Anleitung im Bündel. Für die frühere Fassung
// dieser Funktion war das ein Schlüssel -- die App baute die Karte auf,
// Google lieferte nichts, und der Wächter las "nicht freigegeben", obwohl
// schlicht keiner da war.
check('KRITISCH: ein Platzhaltertext aus einer Anleitung gilt NICHT als Schlüssel',
  await page.evaluate(() => mapsSchluesselTauglich('DER_NEUE_SCHLUESSEL') === false
    && mapsSchluesselTauglich('HIER_DEINEN_ECHTEN_SCHLUESSEL_EINSETZEN') === false
    && mapsSchluesselTauglich('DEINEKENNUNG') === false));
check('Ein abgeschnittener Schlüssel gilt auch nicht',
  await page.evaluate(() => mapsSchluesselTauglich('AIzaSyD') === false));

if (rueckrufDa) {
  await page.evaluate(() => {
    rgsMapsSchluesselDa = false;
    rgsKarte = null;
    const w = document.getElementById('rgsKarteWarnung'); if (w) { w.remove(); }
    window.gm_authFailure();
  });
  await page.waitForTimeout(250);
  const t = await txt(page, '#rgsKarteStand');
  check('KRITISCH: ohne eingesetzten Schlüssel sagt die App, dass die Karte nicht eingerichtet ist',
    !!t && t.includes('nicht eingerichtet'));
  check('KRITISCH: und behauptet NICHT, es sei eine Freigabe-Einstellung',
    !!t && !t.includes('nicht freigegeben') && !t.includes('kein Fehler an deinem Gerät'));
  check('Sie sagt trotzdem, wie es weitergeht -- Punkte im Reiter daneben, Runde läuft',
    !!t && t.includes('Reiter daneben') && t.includes('läuft normal weiter'));
} else {
  ['KRITISCH: ohne eingesetzten Schlüssel sagt die App, dass die Karte nicht eingerichtet ist',
   'KRITISCH: und behauptet NICHT, es sei eine Freigabe-Einstellung',
   'Sie sagt trotzdem, wie es weitergeht -- Punkte im Reiter daneben, Runde läuft',
  ].forEach(n => check(n + ' (nicht prüfbar: kein gm_authFailure)', false));
}

// ══════════ NATIVE KARTE NUR IN DER APP (ENT-609) ═════════════════════
// In der App zeichnet das native Maps-SDK, im Browser weiterhin die
// JavaScript-Karte. Geprüft wird die ENTSCHEIDUNG, nicht das Zeichnen --
// die native Ansicht gibt es hier nicht, und genau darum muss sicher sein,
// dass sie im Browser nie gewählt wird. Ein Browser, der in den nativen
// Zweig liefe, bekäme gar keine Karte mehr.
check('KRITISCH: im Browser wird NICHT der native Weg gewählt',
  await page.evaluate(() => rgKarteNativMoeglich() === false));
check('KRITISCH: und die Karte steht als gewöhnliches Element da, nicht als natives',
  await page.evaluate(() => {
    const el = document.getElementById('rgsKarte');
    return !!el && el.tagName.toLowerCase() !== 'capacitor-google-map';
  }));
// Beide Bedingungen zählen einzeln. Nur die Hülle genügt nicht: Ohne
// eingesetzten Schlüssel käme eine leere Karte statt einer Auskunft.
check('KRITISCH: native Hülle allein genügt nicht -- ohne Schlüssel kein nativer Weg',
  await page.evaluate(() => {
    const merk = window.Capacitor;
    window.Capacitor = { isNativePlatform: () => true };
    try { return rgKarteNativMoeglich() === false; }
    finally { window.Capacitor = merk; }
  }));
check('KRITISCH: mit Hülle UND Schlüssel wird der native Weg gewählt',
  await page.evaluate(() => {
    const merkC = window.Capacitor, merkP = window.mapsSchluesselTauglich;
    window.Capacitor = { isNativePlatform: () => true };
    window.mapsSchluesselTauglich = () => true;
    try { return rgKarteNativMoeglich() === true; }
    finally { window.Capacitor = merkC; window.mapsSchluesselTauglich = merkP; }
  }));

// ══════════ DIE NATIVE KARTE DARF NICHT KLEBEN ════════════════════════
// Sie liegt nicht im Dokument: Sie verschwindet NICHT, wenn der Rumpf
// ersetzt wird. Wer sie beim Reiterwechsel stehen lässt, hat danach eine
// Kartenansicht über der Kontrollpunkt-Liste. Abgebaut werden muss sie an
// jeder Stelle, durch die man die Karte verlässt.
//
// Hier stand vorher dasselbe für eine CSS-Klasse ("Durchsicht"). Die ist
// entfallen -- sie war als Vermutung eingebaut worden und hat selbst einen
// Fehler verursacht (die Seite darunter schien durch). Die Sache, um die
// es geht, bleibt dieselbe.
{
  const abbauProbe = async (was) => await page.evaluate(async (w) => {
    let abgebaut = false;
    const merk = rgsNativKarte;
    rgsNativKarte = { destroy: async () => { abgebaut = true; } };
    if (w === 'raus') { rgSeiteZu(); }
    else { rgsReiter = w; rgLaufZeichnen(); }
    await new Promise(r => setTimeout(r, 60));
    if (rgsNativKarte) { rgsNativKarte = merk; }
    return abgebaut;
  }, was);

  check('KRITISCH: der Wechsel auf einen anderen Reiter baut die native Karte ab',
    await abbauProbe('punkte'));
  check('KRITISCH: auch der Wechsel auf die Funktionen baut sie ab',
    await abbauProbe('funktionen'));
  // Der Weg hinaus ist der wichtigste: Bleibt sie hier stehen, liegt sie
  // danach über der ganzen App, nicht nur über der Runde.
  check('KRITISCH: das Verlassen der Runde baut sie ab',
    await abbauProbe('raus'));

}

// ══════════ DIE FÜLLUNG AUF DER NATIVEN KARTE (ENT-609) ═══════════════
// Vom Projektinhaber verlangt: Der Radiuskreis füllt sich grün, bis die
// Verweilzeit durch ist (ENT-579). Im Browser wächst ein echter
// Kartenkreis; das native SDK kann einen bestehenden Kreis nicht ändern,
// darum liegt die Füllung dort als Element ÜBER der Karte. Dafür muss der
// Kontrollpunkt auf den Bildschirm gerechnet werden.
//
// Die Rechnung ist eine reine Funktion und wird hier gegen bekannte Werte
// geprüft -- ohne Karte, ohne Gerät.
{
  // Ein Ausschnitt von genau einem Zehntelgrad in beide Richtungen auf
  // einer Fläche von 1000 x 1000 Punkten: Dann ist die Rechnung von Hand
  // nachvollziehbar.
  const grenzen = { southwest: { lat: 47.0, lng: 8.0 }, northeast: { lat: 47.1, lng: 8.1 } };
  const masse = { width: 1000, height: 1000 };
  const mitte = await page.evaluate(([g, m]) =>
    rgKarteNativAufSchirm(g, m, 47.05, 8.05), [grenzen, masse]);
  check('KRITISCH: die Mitte des Ausschnitts liegt in der Mitte der Fläche',
    !!mitte && Math.abs(mitte.x - 500) < 1 && Math.abs(mitte.y - 500) < 1);

  const nordwest = await page.evaluate(([g, m]) =>
    rgKarteNativAufSchirm(g, m, 47.1, 8.0), [grenzen, masse]);
  // Norden ist OBEN: Die grösste Breite gehört an den oberen Rand, nicht
  // an den unteren. Ein Vorzeichenfehler hier legte die Füllung
  // spiegelverkehrt auf die Karte, ohne dass etwas kaputtginge.
  check('KRITISCH: Norden liegt oben, nicht unten',
    !!nordwest && Math.abs(nordwest.x - 0) < 1 && Math.abs(nordwest.y - 0) < 1);

  const suedost = await page.evaluate(([g, m]) =>
    rgKarteNativAufSchirm(g, m, 47.0, 8.1), [grenzen, masse]);
  check('Und Südost in der unteren rechten Ecke',
    !!suedost && Math.abs(suedost.x - 1000) < 1 && Math.abs(suedost.y - 1000) < 1);

  // 0,1 Grad Breite sind rund 11 132 m auf 1000 Punkten -- 20 m sind also
  // knapp zwei Punkte.
  const zwanzig = await page.evaluate(([g, m]) =>
    rgKarteNativMeterInPixel(g, m, 20), [grenzen, masse]);
  check('KRITISCH: 20 Meter ergeben eine plausible Pixelgrösse',
    zwanzig > 1.5 && zwanzig < 2.2);
  check('Doppelte Strecke, doppelte Grösse',
    Math.abs((await page.evaluate(([g, m]) =>
      rgKarteNativMeterInPixel(g, m, 40), [grenzen, masse])) - 2 * zwanzig) < 0.01);

  // Ohne Grenzen wird NICHTS gezeichnet: Lieber keine Füllung als eine an
  // der falschen Stelle -- sie sagt dem Wächter, wo er stehen muss.
  check('KRITISCH: ohne Kartengrenzen wird nichts gezeichnet',
    await page.evaluate(() => rgKarteNativAufSchirm(null, { width: 100, height: 100 }, 47, 8) === null));
  check('Und ein Ausschnitt ohne Ausdehnung ergibt ebenfalls nichts',
    await page.evaluate(() => rgKarteNativAufSchirm(
      { southwest: { lat: 47, lng: 8 }, northeast: { lat: 47, lng: 8 } },
      { width: 100, height: 100 }, 47, 8) === null));
}

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
