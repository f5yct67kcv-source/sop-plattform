// Fehlender oder gesperrter Standort fällt auf (ENT-320).
//
// Vom Projektinhaber im Betrieb gefunden, mit zwei Bildschirmfotos: Safari
// stand bei den Ortungsdiensten auf „Nie" -- und die App zeigte trotzdem
// „Standort wird während der Runde verfolgt". Sein Urteil: „Das darf nicht
// sein!"
//
// Er hatte recht, und es war der schlimmste Fehler dieser Reihe: Der
// Fehler-Rueckruf von watchPosition war mit () => {} verschluckt. Damit
// war alles still kaputt -- keine Entfernungen, keine gesperrten Knoepfe,
// keine Signale, keine Spur -- und die Oberflaeche behauptete das
// Gegenteil.
//
// Diese Suite prueft vor allem das: dass die App nie behauptet zu orten,
// wenn sie es nicht tut.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { GOOGLE_MAPS_MOCK } from './google_maps_mock.mjs';
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);
const APP = readFileSync(`${WURZEL}/app.html`, 'utf8');

/* Text eines Elements, das es vielleicht nicht gibt.
   Wozu: In dieser Sitzung sind SECHS Gegenproben abgestuerzt, statt eine
   Aussage rot zu melden -- immer nach demselben Muster, naemlich
   textContent auf einem Element, das genau durch die Gegenprobe
   verschwunden ist. Ein Absturz nennt die kaputte Aussage NICHT und
   verdeckt alle folgenden Pruefungen gleich mit. Diese vier Zeilen
   beenden die Klasse an dieser Stelle. */
const textVon = async sel => (await page.$(sel)) ? (await page.textContent(sel)) : null;

const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const tag = n => iso(new Date(Date.now() + n * 864e5));

// ══════════ QUELLTEXT ═════════════════════════════════════════════════
// Genau diese Zeile war der Fehler.
check('KRITISCH: der Fehler-Rückruf wird ausgewertet, nicht verschluckt',
  !/watchPosition\([\s\S]{0,2000}\}, \(\) => \{\}, \{ enableHighAccuracy/.test(APP));
check('KRITISCH: "gesperrt" wird von "gerade kein Empfang" unterschieden',
  /fehler\.code === 1\) \? 'verweigert' : 'nicht_da'/.test(APP));
// watchPosition versucht nach einem Zeitablauf weiter -- ihn als Fehler zu
// zeigen hiesse, im Minutentakt zu warnen.
check('KRITISCH: ein Zeitablauf gilt NICHT als Fehlschlag',
  /fehler\.code === 3\) \{ return; \}/.test(APP));
// Auf die AUSSAGE geprueft, nicht auf den Wortlaut: Die erste Fassung
// verglich die Zeile Zeichen fuer Zeichen und wurde rot, als eine
// Bedingung dazukam -- ohne dass sich am Verhalten etwas geaendert haette.
// Dritter Fall dieser Art in dieser Reihe (ENT-308, ENT-311). Das
// eigentliche Verhalten steht ohnehin weiter unten als echte Pruefung am
// laufenden Browser; hier geht es nur darum, dass es ueberhaupt vorgesehen
// ist.
check('Eine erfolgreiche Messung räumt die Warnung von selbst weg',
  /rgsOrtFehler !== null[\s\S]{0,60}\{\s*\n?\s*rgsOrtFehler = null;/.test(APP));

const RUNDE = { id: 951, status: 'laeuft', pausiert_seit: null,
  vorbereitet_am: tag(0) + ' 02:00:00', pause_minuten: 0,
  objekt: { id: 7, name: 'Musterobjekt' }, kunde_name: 'Musterliegenschaften AG',
  ansprechpartner: [], zentrale: null,
  kontrollpunkte: [
    { id: 1, bezeichnung: 'Haupteingang', reihenfolge: 1, typ: 'geofence',
      lat: 47.35, lng: 7.9, geofence_radius_m: 25, erledigt: null, aufgaben: [] },
  ] };
const SCHICHTEN = { status: 'ok', von: tag(-30), bis: tag(90), schichten: [
  { id: 71, kunde_name: 'Musterliegenschaften AG', titel: 'Nachtwache',
    strasse: 'Musterweg 4', ort: '9999 Musterdorf', einsatzart: 'Revierdienst',
    sparte: 'sicherheit', datum: tag(0), von: '20:00:00', bis: '06:00:00',
    status: 'bestaetigt', bemerkung: null, zusage: 'zugesagt',
    objekt_name: 'Musterobjekt', objekt_id: 7, hat_kontrollpunkte: true, im_team: 1 }]};

const EXE = browserPfad();
const browser = await chromium.launch({ executablePath: EXE });
// KEINE geolocation-Berechtigung -- genau die Lage des Projektinhabers.
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
await page.route('**/api/**', route => {
  const p = new URL(route.request().url()).pathname.split('/api/')[1];
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'm.muster', ist_admin: false });
  if (p.includes('meine_schichten')) return send(SCHICHTEN);
  if (p.includes('mein_profil')) return send({ status: 'ok', monat: { anzahl: 0, stunden: 0 },
    profil: { name: 'm.muster', ist_admin: false, vorname: 'Max', nachname: 'Muster',
      erstellt_am: tag(-30) + ' 10:00:00' } });
  if (p.includes('rapport_list')) return send({ status: 'ok', rapporte: [] });
  if (p.includes('mein_rundgang_offen')) return send({ status: 'ok', rundgang: JSON.parse(JSON.stringify(RUNDE)) });
  return send({ status: 'ok' });
});
await page.route('**maps.googleapis.com/**', route =>
  route.fulfill({ status: 200, contentType: 'application/javascript', body: GOOGLE_MAPS_MOCK }));

await page.goto(`file://${WURZEL}/app.html`);
await page.fill('#gName', 'm.muster');
await page.fill('#gPass', 'x');
await page.click('#gBtn');
await page.waitForSelector('.app.on');
await page.waitForTimeout(400);
await page.evaluate(() => ladeSchichten().then(() => rundgangFortsetzen(71)));
await page.waitForTimeout(1200);

// ══════════ GESPERRTER STANDORT ═══════════════════════════════════════
// Den Fall des Projektinhabers nachstellen: Safari auf "Nie".
await page.evaluate(() => {
  navigator.geolocation.watchPosition = (gut, schlecht) => {
    setTimeout(() => schlecht({ code: 1, message: 'User denied Geolocation' }), 10);
    return 42;
  };
  rgOrtungErneut();
});
await page.waitForTimeout(500);

check('KRITISCH: die App behauptet NICHT mehr zu orten, wenn sie es nicht tut',
  await page.evaluate(() => {
    const el = document.getElementById('rgsOrtungHinweis');
    return !el || !el.textContent.includes('wird während der Runde verfolgt');
  }));
check('KRITISCH: es steht eine deutliche Warnung da',
  (await page.$('#rgsOrtWarn')) !== null && await page.isVisible('#rgsOrtWarn'));
// Wer nachts vor einem Punkt steht, den er nicht bestaetigen kann, braucht
// den WEG zur Einstellung -- nicht die Diagnose.
const warnTxt = await textVon('#rgsOrtWarn');
check('KRITISCH: die Warnung sagt, WAS zu tun ist, nicht nur was fehlt',
  warnTxt !== null && warnTxt.includes('Einstellungen') && warnTxt.includes('Standort'));
// Der Weg unterscheidet sich je Geraet, und der iPhone-Weg ist der, den
// der Projektinhaber braucht -- er hat ZWEI Ebenen (Systemeinstellung UND
// Website-Einstellung in Safari). Wer nur die erste nennt, schickt jemanden
// los, der danach immer noch keinen Standort hat.
check('KRITISCH: auf dem iPhone werden BEIDE Ebenen genannt, nicht nur die Systemeinstellung',
  await page.evaluate(() => {
    const t = w('rgOrtWegIos');
    return t.includes('Ortungsdienste') && t.includes('Safari')
      && t.includes('Website-Einstellungen');
  }));
check('KRITISCH: sie sagt auch, was die Folge ist — kein Kontrollpunkt bestätigbar',
  warnTxt !== null && warnTxt.includes('keinen Kontrollpunkt bestätigen'));
check('Es gibt einen Weg zurück, ohne die App neu zu laden',
  (await page.$('#rgsOrtWarn button')) !== null && await page.isVisible('#rgsOrtWarn button'));
await page.screenshot({ path: `${OUT}/ortfehler-01-karte.png` });

// ══════════ AUCH IM KONTROLLPUNKT-REITER ══════════════════════════════
// Der Waechter steht vor dem Punkt und tippt auf "Bestaetigen", nicht auf
// die Karte -- nur dort zu warnen hiesse, es zu verstecken.
await page.click('#rgsRt-punkte');
await page.waitForTimeout(400);
check('KRITISCH: die Warnung steht auch im Kontrollpunkt-Reiter',
  (await page.$('#rgsOrtWarn')) !== null && await page.isVisible('#rgsOrtWarn'));
// "Standort noch unbekannt" ist zu harmlos, wenn er gesperrt ist: Das eine
// geht vorbei, das andere nie.
check('KRITISCH: am Punkt steht "gesperrt", nicht das harmlose "noch unbekannt"',
  await page.evaluate(() => {
    const e = document.querySelector('.rd-ort');
    return e && !e.textContent.includes('noch unbekannt') && e.className.includes('weit');
  }));
check('KRITISCH: kein waagrechter Seiten-Scroll durch die Warnung', await page.evaluate(() =>
  document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
await page.screenshot({ path: `${OUT}/ortfehler-02-punkte.png` });

// ══════════ KEIN EMPFANG IST ETWAS ANDERES ════════════════════════════
await page.evaluate(() => {
  navigator.geolocation.watchPosition = (gut, schlecht) => {
    setTimeout(() => schlecht({ code: 2, message: 'Position unavailable' }), 10);
    return 43;
  };
  rgOrtungErneut();
});
await page.waitForTimeout(500);
const empfTxt = await textVon('#rgsOrtWarn');
check('KRITISCH: "kein Empfang" bekommt einen anderen Text als "gesperrt"',
  empfTxt !== null && empfTxt.includes('nicht verfügbar') && !empfTxt.includes('Ortungsdienste'));

// ══════════ ZEITABLAUF WARNT NICHT ════════════════════════════════════
await page.evaluate(() => {
  rgsOrtFehler = null;
  navigator.geolocation.watchPosition = (gut, schlecht) => {
    setTimeout(() => schlecht({ code: 3, message: 'Timeout' }), 10);
    return 44;
  };
  rgOrtungErneut();
});
await page.waitForTimeout(500);
check('KRITISCH: ein Zeitablauf erzeugt keine Warnung — sonst warnt es im Minutentakt',
  await page.evaluate(() => rgsOrtFehler === null && !document.getElementById('rgsOrtWarn')));

// ══════════ DIE WARNUNG VERSCHWINDET VON SELBST ═══════════════════════
// Wer aus dem Keller herauskommt, soll sie nicht wegklicken muessen.
await page.evaluate(() => {
  navigator.geolocation.watchPosition = gut => {
    setTimeout(() => gut({ coords: { latitude: 47.35, longitude: 7.9, accuracy: 8 } }), 10);
    return 45;
  };
  rgsOrtFehler = 'verweigert';
  rgOrtungErneut();
});
await page.waitForTimeout(600);
check('KRITISCH: kommt der Standort zurück, verschwindet die Warnung von selbst',
  await page.evaluate(() => rgsOrtFehler === null && !document.getElementById('rgsOrtWarn')));
check('Und der Hinweis, dass geortet wird, steht dann wieder da',
  await page.evaluate(() => {
    const el = document.getElementById('rgsOrtungHinweis');
    return !!el && el.textContent.includes('verfolgt');
  }));

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
