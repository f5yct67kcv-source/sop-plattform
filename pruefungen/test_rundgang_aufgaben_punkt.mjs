// Aufgaben stehen AM Kontrollpunkt, aufklappbar (ENT-638).
//
// Anlass: Bildschirmfoto-Vergleich des Projektinhabers mit Coredinate --
// „Aufgaben, die an Kontrollpunkte gebunden sind, sind entsprechend
// markiert und lassen sich ausklappen. Sie gehören auch da hin, weil sie
// direkt gekoppelt sind. Dafür entfallen sie im Bereich Funktionen!"
//
// Der Befund beim Nachsehen war groesser als die Gestaltungsfrage: Der
// ERKLAERTEXT einer Aufgabe (`information`) stand ueberhaupt nicht an der
// Zeile. Er war nur ueber Funktionen -> „Aufgaben anzeigen" zu finden. In
// der Zeile stand die blosse Bezeichnung.
//
// Geprueft wird die AUSSAGE, nicht der Wortlaut: dass der Erklaertext am
// Punkt ERREICHBAR ist, dass er zugeklappt NICHT im Weg steht, dass er
// auch auf einer PAUSIERTEN Runde erreichbar bleibt (dort ist die
// Zeilen-Aufklappung gesperrt -- genau deshalb ist es ein eigener
// Aufklapper), und dass der Funktionen-Reiter den Eintrag nicht mehr
// fuehrt.
//
// Dazu die Entfernung: ab 1000 m in Kilometern („noch 2.75 km") statt in
// Metern. Geprueft wird die Form, nicht ein fester Zahlenwert -- der
// haengt an der vorgetaeuschten Position und waere eine Abschrift der
// Rechnung, keine Pruefung.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { GOOGLE_MAPS_MOCK } from './google_maps_mock.mjs';
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

/* Ein Klick auf ein Element, das es nicht gibt, laeuft in Playwright 30
   Sekunden ins Leere und reisst danach die ganze Suite mit. In einer
   Gegenprobe ist genau das der Normalfall -- und eine abgestuerzte Suite
   meldet KEINE rote Pruefung, sie meldet gar nichts. Bei der ersten
   Gegenprobe zu dieser Datei ist sie prompt abgestuerzt statt rot zu
   werden; darum kurze Frist und ein Rueckgabewert statt eines Absturzes
   (dasselbe Mittel wie in test_rundgang_karte.mjs). */
const klick = async (page, s) => { try { await page.click(s, { timeout: 2500 }); return true; }
                                   catch (e) { return false; } };

const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const tag = n => iso(new Date(Date.now() + n * 864e5));
const uhr = minVerschoben => {
  const d = new Date(Date.now() + minVerschoben * 60000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:00`;
};

// Die vorgetaeuschte Position. Alle Punkte liegen bewusst AUSSERHALB ihres
// Radius -- sonst uebernaehme die automatische Erfassung waehrend der
// Messung und die Zeilen wechselten unter der Pruefung hinweg den Zustand.
const ORT = { lat: 47.3500, lng: 7.9000 };

/* Fuenf Punkte, jeder fuer genau einen Fall:
     1  keine Aufgabe                  -> gar kein Block
     2  zwei Aufgaben, eine mit Text   -> aufklappbar, Bezeichnungen + Text
     3  eine Aufgabe MIT Erklaertext   -> aufklappbar, nur der Text
     4  eine Aufgabe OHNE Erklaertext  -> starre Zeile, kein Knopf
     5  weit entfernt (rund 2.7 km)    -> Entfernung in Kilometern */
const PUNKTE = () => ([
  { id: 1, bezeichnung: 'Eingang Nord', reihenfolge: 1, typ: 'nfc', lat: null, lng: null,
    geofence_radius_m: null, erledigt: null, aufgaben: [] },
  { id: 2, bezeichnung: 'Lager B', reihenfolge: 2, typ: 'geofence', lat: 47.3520, lng: 7.9000,
    geofence_radius_m: 20, erledigt: null, aufgaben: [
      { id: 11, bezeichnung: 'Türverschluss kontrollieren',
        information: 'Bei Alarm Meldung an die Einsatzzentrale', erledigt: null },
      { id: 12, bezeichnung: 'Littering auf Platz', information: null, erledigt: null },
    ] },
  { id: 3, bezeichnung: 'Technikraum', reihenfolge: 3, typ: 'nfc', lat: null, lng: null,
    geofence_radius_m: null, erledigt: null, aufgaben: [
      { id: 13, bezeichnung: 'Ölstand ablesen',
        information: 'Wert in den Rapport übernehmen', erledigt: null },
    ] },
  { id: 4, bezeichnung: 'Tor 3', reihenfolge: 4, typ: 'nfc', lat: null, lng: null,
    geofence_radius_m: null, erledigt: null, aufgaben: [
      { id: 14, bezeichnung: 'Sichtkontrolle Fenster', information: null, erledigt: null },
    ] },
  { id: 5, bezeichnung: 'Nebentor', reihenfolge: 5, typ: 'geofence', lat: 47.3745, lng: 7.9000,
    geofence_radius_m: 20, erledigt: null, aufgaben: [] },
  // Eine absichtlich lange Bezeichnung. Die Liste ist „overflow: hidden" --
  // ein Aufklapper, der breiter wird als sie, wuerde STILL abgeschnitten.
  { id: 6, bezeichnung: 'Rampe Sued', reihenfolge: 6, typ: 'nfc', lat: null, lng: null,
    geofence_radius_m: null, erledigt: null, aufgaben: [
      { id: 15, bezeichnung: 'Türverschlusskontrolle Nordseite inklusive Nebeneingang und Anlieferungsrampe',
        information: 'Auffälligkeiten im Rapport festhalten', erledigt: null },
    ] },
]);

const RUNDE = (status) => ({
  id: 951, status, pausiert_seit: status === 'pausiert' ? `${tag(0)} ${uhr(-30)}` : null,
  vorbereitet_am: `${tag(0)} ${uhr(-41)}`, pause_minuten: 0,
  vorlage_name: 'Runde Nacht A', fenster_von: uhr(-60), fenster_bis: uhr(120),
  objekt: { id: 7, name: 'Musterobjekt Ost', strasse: 'Musterweg 4', ort: '9999 Musterdorf' },
  kunde_name: 'Musterliegenschaften AG', ansprechpartner: [], zentrale: null,
  kontrollpunkte: PUNKTE(),
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

// ══════════ DER SERVER LIEFERT DEN ERKLAERTEXT UEBERHAUPT MIT ═════════
/* Die Anzeige am Punkt haengt daran. Ohne dieses Feld zeigte die App
   hartnaeckig nichts an, und zwar STILL -- die Oberflaechenpruefungen
   unten liefen gegen ihre eigenen Testdaten weiter gruen. Nachgesehen und
   bestaetigt: Das Feld kommt aus der gemeinsamen Hilfsdatei, nicht aus den
   Endpunkten -- darum wird hier dort geprueft. */
const RUNDGANG_PHP = readFileSync(`${WURZEL}/backend/rundgang.php`, 'utf8');
check('KRITISCH: die Abfrage der Aufgaben holt den Erklaertext aus der Datenbank',
  /SELECT[\s\S]{0,120}a\.information/.test(RUNDGANG_PHP));
check('KRITISCH: und er steht auch wirklich in der Antwort an die App',
  /'information'\s*=>/.test(RUNDGANG_PHP));

const browser = await chromium.launch({ executablePath: EXE });

async function seite(status) {
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
    if (p.includes('mein_rundgang_offen')) return send({ status: 'ok', rundgang: RUNDE(status) });
    return send({ status: 'ok' });
  });
  await page.route('**maps.googleapis.com/**', route =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: GOOGLE_MAPS_MOCK }));
  await page.goto(`file://${WURZEL}/app.html`);
  await page.fill('#gName', 'm.muster'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
  await page.waitForSelector('.app.on'); await page.waitForTimeout(400);
  await page.evaluate(() => ladeSchichten().then(() => rundgangFortsetzen(71)));
  await page.waitForTimeout(1200);
  await page.click('#rgsRt-punkte'); await page.waitForTimeout(500);
  return page;
}

// Alles, was an einer Zeile ueber Aufgaben ausgesagt wird -- am
// GERENDERTEN Zustand, nicht am Quelltext (CLAUDE.md).
const zeile = (page, id) => page.evaluate(kid => {
  const knopf = document.getElementById('rdAufg' + kid);
  const starr = [...document.querySelectorAll('.rd-aufg-starr')].find(e =>
    e.closest('.rd-zeile') && e.closest('.rd-zeile').textContent.includes(
      (rundgangAktiv.kontrollpunkte.find(k => Number(k.id) === kid) || {}).bezeichnung || '\u0000'));
  const liste = document.getElementById('rdAufgListe' + kid);
  const sichtbar = el => {
    if (!el) { return false; }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  };
  return {
    knopfDa: !!knopf,
    knopfText: knopf ? knopf.textContent.trim() : null,
    knopfHoehe: knopf ? knopf.getBoundingClientRect().height : 0,
    knopfOffen: knopf ? knopf.getAttribute('aria-expanded') : null,
    starrDa: !!starr,
    starrText: starr ? starr.textContent.trim() : null,
    listeSichtbar: sichtbar(liste),
    listeText: liste ? liste.textContent.replace(/\s+/g, ' ').trim() : null,
  };
}, id);

// ══════════ LAUFENDE RUNDE ════════════════════════════════════════════
const page = await seite('laeuft');

const p1 = await zeile(page, 1);
check('KRITISCH: ein Punkt ohne Aufgabe bekommt gar keinen Aufgabenblock — leer darf nicht wie „nichts zu tun" aussehen, es steht schlicht nichts da',
  !p1.knopfDa && !p1.starrDa);

const p2vor = await zeile(page, 2);
check('KRITISCH: zwei Aufgaben ergeben einen Aufklapper, nicht zwei lose Zeilen',
  p2vor.knopfDa && /2 Aufgaben/.test(p2vor.knopfText || ''));
check('KRITISCH: zugeklappt steht der Erklaertext NICHT im Weg',
  p2vor.listeSichtbar === false);
check('Der Aufklapper ist mindestens 44 px hoch (Handy-Trefferflaeche)',
  p2vor.knopfHoehe >= 44);
check('Zugeklappt meldet er sich auch Vorlesehilfen gegenueber als zu',
  p2vor.knopfOffen === 'false');

await klick(page, '#rdAufg2');
await page.waitForTimeout(250);
const p2auf = await zeile(page, 2);
check('KRITISCH: aufgeklappt steht der ERKLAERTEXT der Aufgabe am Punkt — bis hierher war er nur ueber den Funktionen-Reiter zu finden',
  p2auf.listeSichtbar && /Bei Alarm Meldung an die Einsatzzentrale/.test(p2auf.listeText || ''));
check('KRITISCH: bei mehreren Aufgaben stehen auch ihre Bezeichnungen darin, sonst waere nicht zu sehen, wozu der Text gehoert',
  /Türverschluss kontrollieren/.test(p2auf.listeText || '')
  && /Littering auf Platz/.test(p2auf.listeText || ''));
check('Aufgeklappt meldet er sich als offen',
  p2auf.knopfOffen === 'true');

await page.screenshot({ path: `${OUT}/aufgaben-punkt-01-aufgeklappt.png` });

await klick(page, '#rdAufg2');
await page.waitForTimeout(250);
check('KRITISCH: nochmal tippen klappt wieder zu — der Knopf geht in beide Richtungen',
  (await zeile(page, 2)).listeSichtbar === false);

// Eine einzelne Aufgabe: Die Bezeichnung steht im Kopf, aufgeklappt kommt
// der Erklaertext dazu. Sie ZWEIMAL zu zeigen waere Fuellmaterial.
const p3vor = await zeile(page, 3);
check('KRITISCH: bei genau einer Aufgabe steht ihre Bezeichnung schon im Kopf der Zeile',
  p3vor.knopfDa && /Ölstand ablesen/.test(p3vor.knopfText || ''));
await klick(page, '#rdAufg3');
await page.waitForTimeout(250);
const p3auf = await zeile(page, 3);
check('KRITISCH: aufgeklappt kommt ihr Erklaertext dazu',
  p3auf.listeSichtbar && /Wert in den Rapport übernehmen/.test(p3auf.listeText || ''));
check('KRITISCH: und ihre Bezeichnung wird darin NICHT wiederholt — sie steht schon darueber',
  !/Ölstand ablesen/.test(p3auf.listeText || ''));

// Der Fall, in dem ein Knopf nichts freigaebe.
const p4 = await zeile(page, 4);
check('KRITISCH: eine einzelne Aufgabe OHNE Erklaertext bekommt keinen Knopf — ein Knopf, der nichts freigibt, ist schlimmer als keiner',
  !p4.knopfDa && p4.starrDa && /Sichtkontrolle Fenster/.test(p4.starrText || ''));

// ══════════ ENTFERNUNG: AB EINEM KILOMETER IN KILOMETERN ══════════════
const entfernungen = await page.evaluate(() =>
  [...document.querySelectorAll('.rd-ort.weit')].map(e => e.textContent.trim()));
check('KRITISCH: ein weit entfernter Punkt wird in Kilometern angegeben, nicht als vierstellige Meterzahl',
  entfernungen.some(t => /^noch \d+\.\d\d km$/.test(t)));
check('KRITISCH: ein naher Punkt bleibt in Metern — unter einem Kilometer denkt man einen Fussweg in Metern',
  entfernungen.some(t => /^noch \d+ m$/.test(t)));
// Und die Rechnung selbst, unabhaengig von der Karte: Die Grenze liegt bei
// genau 1000, und die Kilometerangabe hat zwei Stellen.
check('KRITISCH: 999 m bleiben Meter, 1000 m werden Kilometer',
  await page.evaluate(() => /999 m/.test(rdEntfernungText(999))
    && /1\.00 km/.test(rdEntfernungText(1000))));

// ══════════ LANGE BESCHRIFTUNGEN WERDEN NICHT ABGESCHNITTEN ══════════
// Die Punkteliste ist „overflow: hidden". Ein Aufklapper, der breiter wird
// als sie, verloere sein Ende lautlos -- und zwar genau bei den langen
// Aufgabentexten, bei denen es darauf ankommt.
check('KRITISCH: ein langer Aufgabentext bricht um, statt am Rand der Liste abgeschnitten zu werden',
  await page.evaluate(() => {
    const liste = document.querySelector('.rd-liste');
    if (!liste) { return false; }
    const rand = liste.getBoundingClientRect().right;
    const alle = [...document.querySelectorAll('.rd-aufg, .rd-aufg-liste')];
    return alle.length > 0 && alle.every(e => e.getBoundingClientRect().right <= rand + 0.5);
  }));
check('Und er bleibt dabei einzeilig lesbar — mehr Hoehe statt weniger Text',
  await page.evaluate(() => {
    const k = document.getElementById('rdAufg6');
    return !!k && k.getBoundingClientRect().height > 44
      && k.textContent.includes('Anlieferungsrampe');
  }));

// ══════════ DER FUNKTIONEN-REITER FUEHRT DIE AUFGABEN NICHT MEHR ══════
await klick(page, '#rgsRt-funktionen');
await page.waitForTimeout(400);
check('KRITISCH: der Funktionen-Reiter bietet „Aufgaben anzeigen" nicht mehr an — sie stehen am Punkt',
  await page.evaluate(() => !document.getElementById('rgsLaufAufgaben')));
check('Die uebrigen Funktionen stehen unveraendert da — entfallen ist genau EIN Eintrag',
  await page.evaluate(() => !!document.getElementById('rgsLaufEreignis')
    && !!document.getElementById('rgsLaufPause')
    && !!document.getElementById('rgsLaufKontakte')
    && !!document.getElementById('rgsLaufAbbrechen')));
await page.close();

// ══════════ PAUSIERTE RUNDE: AUFGABEN BLEIBEN LESBAR ══════════════════
/* Der eigentliche Grund fuer einen EIGENEN Aufklapper. Die bestehende
   Zeilen-Aufklappung (Bestaetigen/Ersatzscan/Nicht verfuegbar) ist auf
   einer pausierten Runde bewusst gesperrt -- dort gibt es nichts zu
   bestaetigen. Haengten die Aufgaben daran, waeren sie im pausierten
   Zustand unsichtbar. Genau dieser Zustand stand auf dem Bildschirmfoto
   des Projektinhabers. */
const pausePage = await seite('pausiert');
check('Ausgangslage: die Runde ist wirklich pausiert',
  await pausePage.evaluate(() => rundgangAktiv.status === 'pausiert'));
check('KRITISCH: pausiert ist die Zeile selbst NICHT aufklappbar — es gibt nichts zu bestaetigen',
  await pausePage.evaluate(() => !document.getElementById('rdKopf2')));
const pp = await zeile(pausePage, 2);
check('KRITISCH: die Aufgaben sind trotzdem aufklappbar — wer ueberlegt, ob er fortsetzt, darf nachlesen, was ihn erwartet',
  pp.knopfDa);
await klick(pausePage, '#rdAufg2');
await pausePage.waitForTimeout(250);
check('KRITISCH: und der Erklaertext erscheint auch pausiert',
  /Bei Alarm Meldung an die Einsatzzentrale/.test((await zeile(pausePage, 2)).listeText || ''));

/* ══════════ KEINE ENTFERNUNG AUF EINER PAUSIERTEN RUNDE (ENT-648) ═════
   Die offene Frage aus ENT-638, vom Projektinhaber entschieden: nicht
   zeigen. Das Datum steht im Protokoll und ausdruecklich NICHT hier --
   ein festes Datum nahe beim heutigen Tag kippt beim Datumswechsel, und
   test_datumsfest.mjs hat es prompt gefunden.

   Der Grund ist nicht Platzmangel. Waehrend der Pause ist die Ortung
   BEWUSST aus (ENT-131: keine fortlaufende Verfolgung ohne laufende
   Runde). Die zuletzt gemessene Position bleibt aber im Speicher stehen
   -- rgOrtungStoppen raeumt nur die Richtung weg, nicht den Ort. Eine
   Entfernung daraus waere eine Zahl, die aktuell AUSSIEHT und es nicht
   ist. Wer in der Pause 300 m weitergeht, liest weiterhin den alten Wert.

   Genau das wird hier geprueft, und zwar in der Lage, die nach dem
   Pausieren einer laufenden Runde tatsaechlich herrscht: Position im
   Speicher, Ortung aus. Ohne das Vorlegen der Position waere die Pruefung
   wertlos -- sie wuerde auch gruen, wenn nur zufaellig keine Position da
   ist. Die beiden Vorbedingungen unten sichern das ab. */
const pausiertOrt = await pausePage.evaluate(ort => {
  rgsMeinOrt = { lat: ort.lat, lng: ort.lng, genauigkeit: 8, zeit: Date.now(),
                 richtung: null, richtungZeit: 0, anker: null };
  rundgangListeZeichnen();
  const geo = rundgangAktiv.kontrollpunkte.filter(k => k.typ === 'geofence');
  return {
    ortungAus: rgsOrtWache === null,
    messbar: geo.length > 0 && geo.every(k => rdEntfernungZu(k) !== null),
    texte: [...document.querySelectorAll('#rdListe .rd-ort')].map(e => e.textContent.trim()),
    zeilen: document.querySelectorAll('#rdListe .rd-zeile').length,
  };
}, ORT);
check('Vorbedingung: pausiert laeuft keine Ortung mehr',
  pausiertOrt.ortungAus === true);
check('Vorbedingung: die letzte Position liegt trotzdem noch im Speicher -- sonst prueft der naechste Punkt nichts',
  pausiertOrt.messbar === true);
check('Vorbedingung: die Liste zeigt ueberhaupt Zeilen',
  pausiertOrt.zeilen >= 5);
check('KRITISCH: pausiert steht an keiner Zeile eine Entfernung -- eine Zahl aus einer abgeschalteten Ortung saehe aktuell aus und waere es nicht',
  pausiertOrt.texte.length === 0);

await pausePage.screenshot({ path: `${OUT}/aufgaben-punkt-02-pausiert.png` });
await pausePage.close();

await browser.close();

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { console.log(bad.map(n => '  ✗ ' + n).join('\n')); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
