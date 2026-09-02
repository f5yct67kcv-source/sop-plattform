// Drei im Feld gemeldete Fehler (ENT-324).
//
// Alle drei vom Projektinhaber nach einem echten Rundgang gemeldet:
//
//  1. „Bei einem gestarteten Rundgang darf der Bereich nicht über den Pfeil
//     verlassen werden ohne Grundangabe." — Das Sicherheitsmuster aus
//     ENT-146 hing am Knopf „Beenden"; der Zurück-Pfeil daneben ging daran
//     vorbei. Wer ihn drückte, liess eine Runde offen im System stehen: In
//     der Auswertung sieht das aus wie eine laufende Runde, während der
//     Wächter längst weg ist.
//
//  2. „Diese Info muss zwingend in die Ereignisse im Dashboard." — Ein
//     Abbruch stand bis hierher nur an der Runde selbst. Wer die Ereignisse
//     durchsieht — der Ort, an dem im Betrieb nachgesehen wird, was in der
//     Nacht vorgefallen ist —, sah davon nichts.
//
//  3. „Ersatzscan Foto kann man nicht tippen, verschwindet die Funktion
//     direkt wieder." — Seit ENT-317 zeichnet jede neue Position die Liste
//     neu. Das Formular lebte nur in style.display und war nach
//     Sekundenbruchteilen wieder zu, mitsamt eingetipptem Grund und Foto.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);
const APP = readFileSync(`${WURZEL}/app.html`, 'utf8');
const DASH = readFileSync(`${WURZEL}/dashboard.html`, 'utf8');
const ABBR = readFileSync(`${WURZEL}/backend/api/mein_rundgang_abbrechen.php`, 'utf8');
const EINR = readFileSync(`${WURZEL}/backend/api/planung_einrichten.php`, 'utf8');
const RG = readFileSync(`${WURZEL}/backend/rundgang.php`, 'utf8');

// ══════════ SERVER: DER ABBRUCH LANDET IM MELDEWEG ═══════════════════
check('KRITISCH: der Abbruch legt ein Ereignis an',
  /INSERT INTO ereignis_meldung/.test(ABBR));
check('KRITISCH: es hängt an DIESER Runde, nicht nur am Objekt',
  /VALUES \(\?, \?, \?, \?, \?, NOW\(\), \?\)/.test(ABBR) && /\$rundgangId,/.test(ABBR));
// Nachweis-Prinzip: Wer das Ereignis später liest, soll den Grund dort
// lesen können und nicht eine Kennung nachschlagen müssen.
check('KRITISCH: der Klartext des Grundes wird kopiert, nicht die Kennung abgelegt',
  /RUNDGANG_ABBRUCH_GRUENDE\[\$grund\]/.test(ABBR));
check('Der Freitext kommt mit, wenn einer da ist', /\$freitext !== ''/.test(ABBR));
// Der Abbruch selbst darf nicht an einem fehlenden Katalogeintrag scheitern.
check('KRITISCH: scheitert das Ereignis, gilt der Abbruch trotzdem',
  /catch \(Throwable \$e\) \{\s*\$ereignisFehler =/.test(ABBR));
// Aber es darf auch nicht STILL scheitern -- ein dauerhaft kaputter
// Meldeweg fiele sonst niemandem auf.
check('KRITISCH: ein gescheitertes Ereignis wird zurückgemeldet, nicht verschluckt',
  /'ereignis_fehler' => \$ereignisFehler/.test(ABBR));
check('Die Ereignisart steht als Konstante, nicht zweimal als Zeichenkette',
  /const EREIGNISART_ABBRUCH = /.test(RG) && /EREIGNISART_ABBRUCH/.test(ABBR));
// Der Endpunkt SUCHT die Art, die Einrichtung LEGT sie an -- laufen die
// beiden auseinander, entstehen Ereignisse ohne Art.
check('KRITISCH: die Einrichtung legt dieselbe Ereignisart an',
  /EREIGNISART_ABBRUCH, 96/.test(EINR));
check('Und zwar wiederholbar, auch bei einem Betrieb mit bestehenden Ereignissen',
  /INSERT IGNORE INTO ereignisart[\s\S]{0,200}EREIGNISART_ABBRUCH/.test(EINR));

// ══════════ DASHBOARD: DER GRUND IM KLARTEXT ═════════════════════════
// Bis ENT-324 stand in der Detailansicht und im Rapport das Codewort
// („stelle_nicht_gefunden") statt des Textes.
check('KRITISCH: die Detailansicht zeigt den Grund im Klartext',
  /function rgdAbbruchHtml[\s\S]{0,600}RUNDGANG_ABBRUCH_GRUENDE\[d\.abbruch_grund\]/.test(DASH));
check('KRITISCH: der Rapport ebenso',
  /Abbruchgrund'[\s\S]{0,200}RUNDGANG_ABBRUCH_GRUENDE\[d\.abbruch_grund\]/.test(DASH));
check('Und die Rundgangerledigung nennt ihn in der Karte',
  /RUNDGANG_ABBRUCH_GRUENDE\[r\.abbruch_grund\][\s\S]{0,200}Ohne Grundangabe/.test(DASH));
// „Ohne Grundangabe" statt einer leeren Zeile: unbekannt darf nie wie keine
// aussehen.
check('Fehlt der Grund, steht das da, statt leer zu bleiben',
  /Ohne Grundangabe/.test(DASH));

// ══════════ DIE APP ══════════════════════════════════════════════════
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const tag = n => iso(new Date(Date.now() + n * 864e5));
const orts = ms => {
  const d = new Date(ms); const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} `
    + `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const JETZT = Date.now();
const SCHICHTEN = { status: 'ok', von: tag(-30), bis: tag(90), schichten: [
  { id: 71, kunde_name: 'Musterliegenschaften AG', titel: 'Nachtwache',
    strasse: 'Musterweg 4', ort: '9999 Musterdorf', einsatzart: 'Revierdienst',
    sparte: 'sicherheit', datum: tag(0), von: '20:00:00', bis: '06:00:00',
    status: 'bestaetigt', bemerkung: null, zusage: 'zugesagt',
    objekt_name: 'Musterobjekt', objekt_id: 7, hat_kontrollpunkte: true, im_team: 1 }]};
// Zwei offene Geofence-Punkte, weit genug weg, dass "Bestätigen" gesperrt
// ist -- genau die Lage, in der jemand zum Ersatzscan greift.
const RUNDE = () => ({ id: 951, einsatz_id: 71, status: 'laeuft', pausiert_seit: null,
  vorbereitet_am: orts(JETZT - 20 * 60000), pause_minuten: 0, rohzeit_ende: null,
  objekt: { id: 7, name: 'Musterobjekt' }, kunde_name: 'Musterliegenschaften AG',
  ansprechpartner: [], zentrale: null,
  kontrollpunkte: [
    { id: 1, bezeichnung: 'Kreuzung Hochgasse', reihenfolge: 1, typ: 'geofence',
      lat: 47.35, lng: 7.9, geofence_radius_m: 20, erledigt: null, aufgaben: [] },
    { id: 2, bezeichnung: 'Türe Hochgasse 7', reihenfolge: 2, typ: 'geofence',
      lat: 47.36, lng: 7.9, geofence_radius_m: 20, erledigt: null, aufgaben: [] },
  ] });

// Klicken mit kurzer Frist und ohne Absturz (ENT-324, beim Gegenprobieren
// gelernt): Fehlt das Ziel, weil eine Sperre ausgebaut wurde, wartete
// page.click() dreissig Sekunden und riss dann die ganze Suite mit. Rot war
// sie dadurch zwar, aber die Zusammenfassung mit den BENANNTEN Aussagen kam
// nie -- und genau die braucht man, um zu sehen, was kaputt ist. Ein
// fehlgeschlagener Klick wird jetzt als eigene Beanstandung vermerkt und die
// Suite läuft weiter.
async function klick(sel) {
  try { await page.click(sel, { timeout: 3000 }); return true; }
  catch (e) { bad.push('nicht anklickbar: ' + sel); return false; }
}
async function tippe(sel, wert) {
  try { await page.fill(sel, wert, { timeout: 3000 }); return true; }
  catch (e) { bad.push('nicht beschreibbar: ' + sel); return false; }
}
async function waehle(sel, wert) {
  try { await page.selectOption(sel, wert, { timeout: 3000 }); return true; }
  catch (e) { bad.push('nicht auswählbar: ' + sel); return false; }
}
async function wert(sel) {
  try { return await page.inputValue(sel, { timeout: 3000 }); }
  catch (e) { return null; }
}

const gerufen = [];
let abbruchKoerper = null;
const browser = await chromium.launch({ executablePath: browserPfad() });
const kontext = await browser.newContext({ viewport: { width: 390, height: 844 },
  permissions: ['geolocation'], geolocation: { latitude: 47.3520, longitude: 7.9 } });
const page = await kontext.newPage();
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
await page.route('**/api/**', route => {
  const p = new URL(route.request().url()).pathname.split('/api/')[1];
  gerufen.push(p);
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'm.muster', ist_admin: false });
  if (p.includes('meine_schichten')) return send(SCHICHTEN);
  if (p.includes('mein_profil')) return send({ status: 'ok', monat: { anzahl: 0, stunden: 0 },
    profil: { name: 'm.muster', ist_admin: false, vorname: 'Max', nachname: 'Muster',
      erstellt_am: tag(-30) + ' 10:00:00' } });
  if (p.includes('rapport_list')) return send({ status: 'ok', rapporte: [] });
  if (p.includes('mein_rundgang_offen')) return send({ status: 'ok', rundgang: RUNDE() });
  if (p.includes('mein_rundgang_abbrechen')) {
    abbruchKoerper = JSON.parse(route.request().postData() || '{}');
    return send({ status: 'ok', ereignis_fehler: null });
  }
  return send({ status: 'ok' });
});
await page.route('**maps.googleapis.com/**', route => route.abort());

await page.goto(`file://${WURZEL}/app.html`);
await page.fill('#gName', 'm.muster');
await page.fill('#gPass', 'x');
await page.click('#gBtn');
await page.waitForSelector('.app.on');
await page.evaluate(() => ladeSchichten().then(() => rundgangFortsetzen(71)));
await page.waitForTimeout(1200);
check('Die laufende Runde ist offen', await page.isVisible('#rgSeite'));

// ══════════ 1. DER ZURÜCK-PFEIL ══════════════════════════════════════
await klick('#rgsZurueck');
await page.waitForTimeout(400);
check('KRITISCH: der Pfeil verlässt die laufende Runde NICHT einfach',
  await page.isVisible('#rgSeite'));
// Ueber die Klasse und nicht ueber isVisible(): Die Schublade liegt
// geschlossen per transform ausserhalb des Bildes und gilt Playwright
// trotzdem als sichtbar -- eine Pruefung darauf koennte nie rot werden.
const blattAuf = () => page.evaluate(() => document.getElementById('blatt').classList.contains('on'));
check('KRITISCH: er stellt stattdessen die Frage, wie fortgefahren wird',
  await blattAuf() && (await page.textContent('#blTitel')).includes('beenden'));
const knoepfe = await page.evaluate(() =>
  [...document.querySelectorAll('#blBody .btn, #blFuss .btn')].map(b => b.innerText.trim()));
// Über einen Zugriff mit Rückfall statt direkt über den Index: Erscheint der
// Dialog gar nicht, soll die Suite SAGEN, welche Aussage nicht mehr stimmt,
// statt mit einem TypeError abzustürzen. Beim Gegenprobieren aufgefallen --
// eine abgestürzte Suite ist zwar rot, nennt die Ursache aber nicht.
const kn = i => knoepfe[i] || '';
check('KRITISCH: die drei Wege stehen zur Wahl — pausieren, abbrechen, weiter',
  knoepfe.length === 3 && kn(0).startsWith('Pausieren')
  && kn(1).startsWith('Abbrechen') && kn(2).startsWith('Weiter'));
// „Abbrechen" ist der einzige Knopf hier, der sich nicht rückgängig machen
// lässt -- das darf nicht erst hinterher auffallen.
check('KRITISCH: unter jedem Knopf steht, was er bewirkt',
  knoepfe.length === 3 && knoepfe.every(k => k.split('\n').length >= 2)
  && kn(1).includes('Endgültig'));
check('Der sichere Weg ist der hervorgehobene',
  await page.evaluate(() => {
    const b = document.querySelector('#blFuss .btn');
    return b && b.classList.contains('btn-primary');
  }));
// Ein Knopf, dessen zweite Zeile aus dem Knopf herausläuft, ist auf dem
// Handy unlesbar -- gemessen, nicht im Quelltext nachgelesen.
check('KRITISCH: die zweizeiligen Knöpfe sind hoch genug und laufen nicht über',
  await page.evaluate(() => [...document.querySelectorAll('#blBody .btn, #blFuss .btn')]
    .every(b => b.getBoundingClientRect().height >= 56
      && b.scrollHeight <= b.clientHeight + 1)));
check('Und sind auf dem Handy gross genug zum Treffen',
  await page.evaluate(() => [...document.querySelectorAll('#blBody .btn, #blFuss .btn')]
    .every(b => b.getBoundingClientRect().height >= 44)));
await page.screenshot({ path: `${OUT}/verlassen-01-frage.png` });

// „Weiter" ist der sichere Ausgang und ändert gar nichts.
await klick('#blFuss .btn');
await page.waitForTimeout(400);
check('KRITISCH: "Weiter" schliesst nur die Frage', !(await blattAuf()));
check('KRITISCH: die Runde läuft danach unverändert weiter',
  await page.isVisible('#rgSeite')
  && await page.evaluate(() => rundgangAktiv.status === 'laeuft'));
// Und nicht die alte Schublade über der laufenden Seite -- zwei
// Darstellungen derselben Runde übereinander.
check('Es öffnet sich dabei keine zweite Ansicht derselben Runde',
  await page.evaluate(() => !document.getElementById('blatt').classList.contains('on')));

// ══════════ 2. DER ABBRUCH BRAUCHT EINEN GRUND ═══════════════════════
await klick('#rgsZurueck');
await page.waitForTimeout(300);
await klick('#blBody .btn-neg');
await page.waitForTimeout(400);
check('Der Abbruch fragt nach einem Grund', await page.isVisible('#raGrund'));
await klick('#raBtn');
await page.waitForTimeout(300);
check('KRITISCH: ohne Grund wird nicht abgebrochen',
  await page.isVisible('#raErr') && abbruchKoerper === null);
// Der Rückweg führt eine Ebene zurück, nicht gleich aus allem heraus.
await klick('#blFuss .btn-plain');
await page.waitForTimeout(300);
check('KRITISCH: "Zurück" führt auf die Frage zurück, nicht aus allem heraus',
  await blattAuf()
  && (await page.textContent('#blTitel')).includes('beenden'));

await klick('#blBody .btn-neg');
await page.waitForTimeout(300);
await waehle('#raGrund', 'nicht_genug_zeit');
await tippe('#raFreitext', 'Einsatz wurde umdisponiert');
await klick('#raBtn');
await page.waitForTimeout(600);
check('KRITISCH: mit Grund wird abgebrochen', abbruchKoerper !== null);
check('KRITISCH: der Grund geht mit an den Server',
  abbruchKoerper && abbruchKoerper.grund === 'nicht_genug_zeit'
  && abbruchKoerper.freitext === 'Einsatz wurde umdisponiert');

// ══════════ EINE BEENDETE RUNDE HÄLT NIEMANDEN FEST ══════════════════
// Die Gegenprobe im laufenden Betrieb: Die Sperre darf nur greifen, solange
// wirklich etwas offen ist. Sonst wäre sie eine Falle.
check('KRITISCH: eine abgebrochene Runde lässt sich verlassen',
  await page.evaluate(() => { rundgangAktiv.status = 'abgebrochen'; return !rgLaufOffen(); }));
check('Eine abgeschlossene ebenso',
  await page.evaluate(() => { rundgangAktiv.status = 'abgeschlossen'; return !rgLaufOffen(); }));
check('Eine pausierte dagegen nicht — sie steht weiterhin offen im System',
  await page.evaluate(() => { rundgangAktiv.status = 'pausiert'; return rgLaufOffen(); }));
await page.evaluate(() => { rundgangAktiv.status = 'abgeschlossen'; rgSeiteZurueck(); });
await page.waitForTimeout(400);
check('KRITISCH: und der Pfeil führt dann wirklich heraus',
  !(await page.isVisible('#rgSeite')));

// ══════════ 3. DAS ERSATZSCAN-FORMULAR ÜBERLEBT ══════════════════════
await page.evaluate(() => ladeSchichten().then(() => rundgangFortsetzen(71)));
await page.waitForTimeout(1200);
await klick('#rgsRt-punkte');
await page.waitForTimeout(400);
await page.evaluate(() => rdEsUm(1));
await page.waitForTimeout(300);
check('Das Ersatzscan-Formular öffnet sich', await page.isVisible('#rdEs1'));
await tippe('#rdEsText1', 'Chip zerstört, Foto als Beleg');
// Ein Foto legen wie rdEsFotoGewaehlt es täte -- die Kamera lässt sich hier
// nicht bedienen, der Zustand danach schon.
await page.evaluate(() => {
  // Ein wirklich gueltiges 1x1-PNG: Ein kaputtes Bild laedt nicht und waere
  // unsichtbar, ohne dass der Code etwas falsch macht -- die Pruefung haette
  // dann den Test gemessen, nicht die App.
  rdEsFotos[1] = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const v = document.getElementById('rdEsVorschau1');
  if (v) { v.src = rdEsFotos[1]; v.style.display = ''; }
});
// JETZT der Fehler: eine neue Position zeichnet die Liste neu.
await page.evaluate(() => rundgangListeZeichnen());
await page.waitForTimeout(300);
check('KRITISCH: das Formular ist nach dem Neuzeichnen noch offen',
  await page.isVisible('#rdEs1'));
check('KRITISCH: der eingetippte Grund steht noch da',
  (await wert('#rdEsText1')) === 'Chip zerstört, Foto als Beleg');
check('KRITISCH: die Fotovorschau ist noch da',
  await page.isVisible('#rdEsVorschau1'));
// Mehrfach neu zeichnen -- im Feld kommt alle paar Sekunden eine Position.
await page.evaluate(() => { for (let i = 0; i < 5; i++) { rundgangListeZeichnen(); } });
await page.waitForTimeout(300);
check('Auch nach mehreren Standortmeldungen hintereinander',
  await page.isVisible('#rdEs1')
  && (await wert('#rdEsText1')) === 'Chip zerstört, Foto als Beleg');
await page.screenshot({ path: `${OUT}/verlassen-02-ersatzscan.png` });

// Dasselbe für "nicht verfügbar" -- derselbe Mechanismus, dieselbe Falle.
await page.evaluate(() => rdNvUm(2));
await page.waitForTimeout(200);
await tippe('#rdNvText2', 'Tor verschlossen, kein Zugang');
await page.evaluate(() => rundgangListeZeichnen());
await page.waitForTimeout(300);
check('KRITISCH: dasselbe gilt für "nicht verfügbar"',
  await page.isVisible('#rdNv2')
  && (await wert('#rdNvText2')) === 'Tor verschlossen, kein Zugang');
// Zwei offene Formulare an EINEM Punkt wären zwei Antworten auf dieselbe
// Frage -- das Umschalten schliesst das andere.
check('An einem Punkt ist immer nur ein Formular offen',
  await page.evaluate(() => {
    rdEsUm(2);
    const k = rundgangAktiv.kontrollpunkte.find(x => Number(x.id) === 2);
    return k.offen === 'es';
  }));
check('Ein zweites Antippen schliesst es wieder',
  await page.evaluate(() => {
    rdEsUm(2);
    const k = rundgangAktiv.kontrollpunkte.find(x => Number(x.id) === 2);
    return k.offen === null;
  }));

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
