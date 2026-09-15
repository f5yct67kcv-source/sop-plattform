// Erfassung von selbst beim Betreten des Bereichs (ENT-531).
//
// Vom Projektinhaber verlangt: "wenn man zu meinem Kontrollpunkt kommt und
// innerhalb des Bereiches ist, dass der Kontrollpunkt automatisch erfasst
// und als erledigt markiert wird und man nicht noch manuell zuerst einen
// Kontrollpunkt bestaetigen muss. Die Aufgabe ist etwas anderes. Das muss
// man ja explizit bestaetigen ... dass der Kreis bereits gruen wird und die
// Aufgabe aufploppt."
//
// Der Kern dieser Suite ist nicht, DASS erfasst wird -- das ist die leichte
// Haelfte. Geprueft wird vor allem, wann NICHT erfasst wird. Seit die
// Erfassung ohne Zutun laeuft, entscheidet das Telefon allein darueber, was
// im Nachweis steht; jeder Fall, in dem es faelschlich zugreift, ist eine
// Falschaussage gegenueber einem Kunden, die niemand mehr bemerkt.
//
// Ausdruecklich OHNE Verweilzeit -- erster Messwert im Radius genuegt, so
// vom Projektinhaber entschieden (ENT-531). Die Weiche dagegen ist die
// bestehende aus ENT-319.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { GOOGLE_MAPS_MOCK } from './google_maps_mock.mjs';
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);
const APP = readFileSync(`${WURZEL}/app.html`, 'utf8');
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const tag = n => iso(new Date(Date.now() + n * 864e5));

// ══════════ DIE WEICHE ALS REINE FUNKTION ════════════════════════════
// Sie laesst sich ohne Geraet pruefen -- gleiches Muster wie rgSignalNoetig
// und rgSpurNehmen. Geprueft wird die Aussage, nicht der Wortlaut.
check('KRITISCH: es gibt eine eigene, prüfbare Weiche für die Erfassung',
  /function rdAutoErfassbar/.test(APP));
// Der Server bleibt die letzte Instanz -- daran aendert die Automatik
// nichts. Sonst genuegte ein veraenderter Browser. Geprueft am VERHALTEN,
// nicht am Quelltext: Eine Regex ueber die Funktion wurde mit jeder
// Erweiterung laenger und waere irgendwann stillschweigend gerissen.
const durchDieselbeTuer = () => page.evaluate(() => {
  const rufe = [];
  const echt = window.rdMitOrt;
  window.rdMitOrt = function (k) { rufe.push(Number(k.id)); return echt.apply(this, arguments); };
  erfassenJetzt();
  window.rdMitOrt = echt;
  return rufe;
});

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
  permissions: ['geolocation'],
  geolocation: { latitude: 47.3500, longitude: 7.9000, accuracy: 8 },
});
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
// Reihenfolge ist wichtig: Die Maps-URL heisst selbst ".../maps/api/js" und
// faellt sonst in die API-Attrappe -- Playwright nimmt die ZULETZT
// registrierte Route. Steht sie falsch herum, bekommt der Browser JSON
// statt eines Skripts und die Karte bleibt ohne erkennbaren Grund leer.
await page.route('**/api/**', route => route.fulfill({ status: 200,
  contentType: 'application/json', body: JSON.stringify({ status: 'ok' }) }));
await page.route('**maps.googleapis.com/**', route =>
  route.fulfill({ status: 200, contentType: 'application/javascript', body: GOOGLE_MAPS_MOCK }));
await page.goto(`file://${WURZEL}/app.html`);
await page.waitForTimeout(300);

// Ein Punkt genau auf der Position, einer 900 m entfernt.
/* Die Verweilzeit aus ENT-576 vorziehen, statt in jeder Pruefung fuenf
   Sekunden zu warten. Der erste Durchlauf startet die Frist, dann wird ihr
   Beginn zurueckdatiert, der zweite erfasst. Das prueft denselben Weg wie
   der Betrieb -- nur ohne die Wartezeit. */
await page.evaluate(() => {
  window.fristVorziehen = () => (rundgangAktiv.kontrollpunkte || []).forEach(k => {
    if (k._drinSeit) { k._drinSeit -= RG_AUTO_VERWEIL_MS; }
  });
  window.erfassenJetzt = () => { rgBereichPruefen(); fristVorziehen(); rgBereichPruefen(); };
});

// Dieselbe Ausgangslage, aber innerhalb des Browsers aufrufbar -- fuer
// Faelle, die mehrere Schritte in EINEM evaluate brauchen.
await page.evaluate(() => {
  window.bauen2 = async () => {
    rundgangAktiv = { id: 900, status: 'laeuft', einsatz_id: 1, kontrollpunkte: [
      { id: 1, bezeichnung: 'Punkt nah', typ: 'geofence', lat: 47.3500, lng: 7.9000,
        geofence_radius_m: 25, erledigt: null, aufgaben: [] }] };
    rgsMeinOrt = { lat: 47.3500, lng: 7.9000, genauigkeit: 8, zeit: Date.now() };
    try { localStorage.removeItem('sop_rundgang_warteschlange'); } catch (e) {}
  };
});

const bauen = () => page.evaluate(() => {
  rundgangAktiv = { id: 900, status: 'laeuft', einsatz_id: 1, kontrollpunkte: [
    { id: 1, bezeichnung: 'Punkt nah', typ: 'geofence', lat: 47.3500, lng: 7.9000,
      geofence_radius_m: 25, erledigt: null, aufgaben: [] },
    { id: 2, bezeichnung: 'Punkt fern', typ: 'geofence', lat: 47.3580, lng: 7.9000,
      geofence_radius_m: 20, erledigt: null, aufgaben: [] },
  ] };
  rgsMeinOrt = { lat: 47.3500, lng: 7.9000, genauigkeit: 8, zeit: Date.now() };
  try { localStorage.removeItem('sop_rundgang_warteschlange'); } catch (e) {}
});

const lage = async () => page.evaluate(() => {
  const f = (...a) => rdAutoErfassbar(...a);
  const nah = () => ({ id: 9, typ: 'geofence', lat: 47.35, lng: 7.9,
    geofence_radius_m: 25, erledigt: null, offen: null });
  const mit = z => Object.assign(nah(), z);
  return {
    normal:      f(nah(), 'laeuft', true),
    erledigt:    f(mit({ erledigt: { status: 'bestaetigt' } }), 'laeuft', true),
    nfc:         f(mit({ typ: 'nfc', lat: null }), 'laeuft', true),
    ohneOrt:     f(mit({ lat: null }), 'laeuft', true),
    formularEs:  f(mit({ offen: 'es' }), 'laeuft', true),
    formularNv:  f(mit({ offen: 'nv' }), 'laeuft', true),
    pausiert:    f(nah(), 'pausiert', true),
    abgebrochen: f(nah(), 'abgebrochen', true),
    beendet:     f(nah(), 'abgeschlossen', true),
    alterOrt:    f(nah(), 'laeuft', false),
  };
});
const L = await lage();
check('KRITISCH: der normale Fall wird erfasst', L.normal === true);
// Ein zweites Mal erfassen hiesse, denselben Nachweis doppelt zu fuehren.
check('KRITISCH: ein bereits erfasster Punkt wird nicht noch einmal erfasst', L.erledigt === false);
// NFC hat keinen Radius -- dort gibt es nichts zu betreten.
check('KRITISCH: ein NFC-Punkt wird nicht über den Standort erfasst', L.nfc === false);
check('Ein Punkt ohne Koordinaten wird nicht erfasst', L.ohneOrt === false);
// Wer gerade "nicht verfuegbar" schreibt, meint etwas anderes als
// "bestaetigt". Ihm das Formular unter den Fingern wegzuschreiben waere
// eine Falschaussage im Nachweis.
check('KRITISCH: ein offenes Ersatzscan-Formular wird nicht überschrieben', L.formularEs === false);
check('KRITISCH: ein offenes "nicht verfügbar"-Formular wird nicht überschrieben', L.formularNv === false);
// Eine pausierte Runde ist angehalten -- auch der Knopf ist dort gesperrt,
// und der Server wiese den Scan ohnehin ab.
check('KRITISCH: eine pausierte Runde erfasst nichts', L.pausiert === false);
check('KRITISCH: eine abgebrochene Runde erfasst nichts', L.abgebrochen === false);
check('KRITISCH: eine abgeschlossene Runde erfasst nichts', L.beendet === false);
// Eine Position von vor zwei Minuten sagt nichts darueber, wo jemand JETZT
// steht -- ein Nachweis darf nicht auf ihr beruhen.
check('KRITISCH: eine veraltete Position erfasst nichts', L.alterOrt === false);

// ══════════ DIE VERWEILZEIT (ENT-576) ════════════════════════════════
// Der Projektinhaber nach dem ersten Betrieb: "es klappt, wird aber etwas zu
// zackig gruen. ich oeffne die runde, und swippt grad in den aufgabebereich
// des kontrollpunkts." ENT-531 hatte die Verweilzeit ausdruecklich
// verworfen; ENT-576 holt sie mit 5 Sekunden nach.
const frist = await page.evaluate(() => {
  const f = (seit, jetzt) => rdAutoRestSek(seit, jetzt);
  const t = 1000000;
  return {
    ms: RG_AUTO_VERWEIL_MS,
    garNicht: f(null, t),
    ganzFrisch: f(t, t),
    haelfte: f(t - 2500, t),
    knappDavor: f(t - 4999, t),
    genau: f(t - 5000, t),
    laengstUm: f(t - 60000, t),
  };
});
check('KRITISCH: die Frist ist gesetzt und liegt in einer sinnvollen Groesse',
  frist.ms >= 2000 && frist.ms <= 15000);
// Drei Antworten fuer drei Lagen -- null heisst "es zaehlt gar nicht" und
// darf nie mit 0 ("jetzt erfassen") verwechselt werden.
check('KRITISCH: wer nicht im Bereich steht, hat gar keine Frist', frist.garNicht === null);
check('KRITISCH: wer gerade eingetreten ist, wird NICHT sofort erfasst', frist.ganzFrisch > 0);
check('Auf halbem Weg steht noch etwas aus', frist.haelfte > 0 && frist.haelfte <= 3);
check('KRITISCH: eine Millisekunde vor Ablauf wird noch nicht erfasst', frist.knappDavor > 0);
check('KRITISCH: nach Ablauf wird erfasst', frist.genau === 0);
check('Und danach bleibt es dabei', frist.laengstUm === 0);
// Aufgerundet: Wer 4,2 s vor sich hat, soll "5" lesen und dann "4" --
// abgerundet begaenne die Anzeige bei 4 und der erste Schritt fehlte.
check('Die Anzeige beginnt bei der vollen Sekundenzahl, nicht eine darunter',
  frist.ganzFrisch === Math.round(frist.ms / 1000));

// Der Fall, der den Anlass gab: Runde geoeffnet, waehrend man schon im
// Bereich steht. Vorher war der Punkt sofort gruen und das Aufgabenblatt
// sprang auf, bevor jemand hingesehen hatte.
const sofort = await page.evaluate(() => {
  abPunktId = null;
  rundgangAktiv = { id: 890, status: 'laeuft', einsatz_id: 1, kontrollpunkte: [
    { id: 71, bezeichnung: 'Punkt', typ: 'geofence', lat: 47.3500, lng: 7.9000,
      geofence_radius_m: 25, erledigt: null,
      aufgaben: [{ id: 81, bezeichnung: 'Türe kontrollieren', information: null, erledigt: null }] }] };
  try { localStorage.removeItem('sop_rundgang_warteschlange'); } catch (e) {}
  try { localStorage.removeItem('sop_rundgang_aufgaben'); } catch (e) {}
  rgsMeinOrt = { lat: 47.3500, lng: 7.9000, genauigkeit: 8, zeit: Date.now() };
  rgBereichPruefen();                       // erste Messung beim Oeffnen
  const k = rundgangAktiv.kontrollpunkte[0];
  const nachOeffnen = { erledigt: !!k.erledigt, blatt: abPunktId, rest: k._autoRest };
  // Zweite Messung eine Sekunde spaeter -- immer noch zu frueh.
  k._drinSeit = Date.now() - 1000;
  rgBereichPruefen();
  const nachEinerSek = { erledigt: !!k.erledigt, rest: k._autoRest };
  // Und jetzt die Frist vorziehen, statt fuenf Sekunden zu warten.
  k._drinSeit = Date.now() - RG_AUTO_VERWEIL_MS;
  rgBereichPruefen();
  return { nachOeffnen, nachEinerSek,
    danach: { erledigt: !!rundgangAktiv.kontrollpunkte[0].erledigt, blatt: abPunktId } };
});
check('KRITISCH: beim Oeffnen der Runde im Bereich wird NICHT sofort erfasst',
  sofort.nachOeffnen.erledigt === false);
check('KRITISCH: und das Aufgabenblatt springt nicht auf', sofort.nachOeffnen.blatt === null);
check('KRITISCH: die Zeile sagt, dass gerade gezaehlt wird — kein stummes Warten',
  sofort.nachOeffnen.rest > 0);
check('Auch nach einer Sekunde ist noch nichts erfasst',
  sofort.nachEinerSek.erledigt === false && sofort.nachEinerSek.rest > 0);
check('KRITISCH: nach Ablauf der Frist wird erfasst', sofort.danach.erledigt === true);
check('KRITISCH: und dann poppt die Aufgabe auf', sofort.danach.blatt === 71);

// Wer den Bereich wieder verlaesst, faengt neu an -- sonst summierten sich
// zwei Vorbeifahrten zu einem Nachweis.
const verlassen = await page.evaluate(() => {
  abPunktId = null;
  rundgangAktiv = { id: 891, status: 'laeuft', einsatz_id: 1, kontrollpunkte: [
    { id: 72, bezeichnung: 'Punkt', typ: 'geofence', lat: 47.3500, lng: 7.9000,
      geofence_radius_m: 25, erledigt: null, aufgaben: [] }] };
  try { localStorage.removeItem('sop_rundgang_warteschlange'); } catch (e) {}
  const k = rundgangAktiv.kontrollpunkte[0];
  rgsMeinOrt = { lat: 47.3500, lng: 7.9000, genauigkeit: 8, zeit: Date.now() };
  rgBereichPruefen();
  // Vier der fuenf Sekunden sind vorbei -- eine steht noch aus.
  k._drinSeit -= RG_AUTO_VERWEIL_MS - 1000;
  rgBereichPruefen();
  const kurzDavor = k._autoRest;
  // Jetzt weg: 890 m, ausserhalb auch des Hysteresebands.
  rgsMeinOrt = { lat: 47.3580, lng: 7.9000, genauigkeit: 8, zeit: Date.now() };
  rgBereichPruefen();
  const nachWeg = { seit: k._drinSeit, rest: k._autoRest };
  // Und zurueck. Die Frist muss von vorn beginnen, nicht bei der einen
  // Sekunde weitermachen, die noch ausstand.
  rgsMeinOrt = { lat: 47.3500, lng: 7.9000, genauigkeit: 8, zeit: Date.now() };
  rgBereichPruefen();
  return { kurzDavor, nachWeg, wiederRest: k._autoRest,
    voll: Math.round(RG_AUTO_VERWEIL_MS / 1000), erledigt: !!k.erledigt };
});
check('Vorbedingung: kurz vor Ablauf steht genau noch eine Sekunde aus',
  verlassen.kurzDavor === 1);
check('KRITISCH: beim Verlassen wird die Frist verworfen',
  verlassen.nachWeg.seit === null && verlassen.nachWeg.rest === null);
check('KRITISCH: beim Wiederkommen beginnt sie von vorn — zwei kurze Besuche ergeben keinen Nachweis',
  verlassen.wiederRest === verlassen.voll && verlassen.erledigt === false);

// ══════════ DER TAKT TREIBT DIE FRIST, NICHT DIE BEWEGUNG ════════════
// Der wichtigste Fall im Betrieb und der unauffaelligste im Code:
// watchPosition meldet nur bei BEWEGUNG. Wer am Kontrollpunkt steht und
// seine Arbeit tut, erzeugt keine neue Position -- haengt die Frist allein
// an den Positionsmeldungen, liefe sie fuer ihn nie ab. Geprueft wird darum
// OHNE jede weitere Positionsmeldung und ohne Aufruf von Hand: nur die Uhr.
const taktAn = await page.evaluate(async () => {
  abPunktId = null;
  rgsModus = 'lauf';
  rgsReiter = 'punkte';
  rundgangAktiv = { id: 892, status: 'laeuft', einsatz_id: 1,
    vorbereitet_am: null, gestartet_am: null, pause_minuten: 0,
    kontrollpunkte: [
    { id: 73, bezeichnung: 'Punkt', typ: 'geofence', lat: 47.3500, lng: 7.9000,
      geofence_radius_m: 25, erledigt: null, aufgaben: [] }] };
  try { localStorage.removeItem('sop_rundgang_warteschlange'); } catch (e) {}
  const k = rundgangAktiv.kontrollpunkte[0];
  rgsMeinOrt = { lat: 47.3500, lng: 7.9000, genauigkeit: 8, zeit: Date.now() };
  rgBereichPruefen();                 // die eine Messung beim Eintreffen
  const sofortErledigt = !!k.erledigt;
  k._drinSeit -= RG_AUTO_VERWEIL_MS;  // die Frist ist abgelaufen
  rgTimerStarten();                   // ab jetzt nur noch die Uhr
  // Grosszuegig warten statt auf eine feste Frist zu messen: Unter Last
  // kann ein Sekundentakt spaeter kommen (siehe OP-464/OP-485).
  for (let i = 0; i < 40 && !k.erledigt; i++) {
    await new Promise(r => setTimeout(r, 100));
  }
  rgTimerStoppen();
  // Aufraeumen: Die folgenden Pruefungen bauen ihre eigene Lage auf und
  // duerfen den Reiter-/Moduszustand von hier nicht erben.
  rgsModus = null; rgsReiter = 'karte'; abPunktId = null;
  return { sofortErledigt, danach: !!k.erledigt };
});
check('Vorbedingung: die eine Messung allein erfasst noch nicht', taktAn.sofortErledigt === false);
check('KRITISCH: die Frist läuft auch OHNE neue Position ab — wer stillsteht, wird erfasst',
  taktAn.danach === true);

// ══════════ EIN SIGNAL PRO PUNKT, IM AUGENBLICK DER ERFASSUNG ════════
// Bis ENT-576 fielen Eintritt und Erfassung zusammen. Jetzt liegen fuenf
// Sekunden dazwischen -- und die Versuchung ist, beides zu melden. Zweimal
// pro Punkt zu piepen ist genau das, wonach der Waechter den Ton abschaltet
// (ENT-319); dann ist die ganze Funktion weg.
const toene = await page.evaluate(() => {
  abPunktId = null;
  rundgangAktiv = { id: 893, status: 'laeuft', einsatz_id: 1, kontrollpunkte: [
    { id: 74, bezeichnung: 'Punkt', typ: 'geofence', lat: 47.3500, lng: 7.9000,
      geofence_radius_m: 25, erledigt: null, aufgaben: [] }] };
  try { localStorage.removeItem('sop_rundgang_warteschlange'); } catch (e) {}
  const gerufen = [];
  const echt = window.rgSignalGeben;
  window.rgSignalGeben = t => gerufen.push(t);
  rgsMeinOrt = { lat: 47.3500, lng: 7.9000, genauigkeit: 8, zeit: Date.now() };
  rgBereichPruefen();                       // Eintritt
  const beimEintritt = gerufen.length;
  rgBereichPruefen(); rgBereichPruefen();    // waehrend die Frist laeuft
  const waehrendFrist = gerufen.length;
  fristVorziehen();
  rgBereichPruefen();                       // Erfassung
  window.rgSignalGeben = echt;
  return { beimEintritt, waehrendFrist, gesamt: gerufen.length, texte: gerufen,
    erfasstWort: w('rgSignalErfasst') };
});
check('KRITISCH: beim Eintritt schweigt es — der Ton gehört dem Augenblick der Erfassung',
  toene.beimEintritt === 0);
check('KRITISCH: und während die Frist läuft, piept es nicht im Sekundentakt',
  toene.waehrendFrist === 0);
check('KRITISCH: genau EIN Signal pro Punkt', toene.gesamt === 1);
check('KRITISCH: und es sagt "erfasst", nicht "erreicht"',
  toene.texte[0].includes(toene.erfasstWort));

// ══════════ DER TAKT ZEICHNET NACH, OHNE SICH ZU VERHEDDERN ══════════
// Der Takt zeichnet die Zeile neu, damit der Countdown laeuft -- und das
// Neuzeichnen ruft ueber den Fuss wieder in den Takt zurueck. Ohne Riegel
// laeuft das endlos, und die Seite steht.
const nachziehen = await page.evaluate(async () => {
  abPunktId = null;
  rgsModus = 'lauf';
  rgsReiter = 'punkte';
  rundgangAktiv = { id: 894, status: 'laeuft', einsatz_id: 1,
    vorbereitet_am: null, gestartet_am: null, pause_minuten: 0,
    kontrollpunkte: [
    { id: 75, bezeichnung: 'Punkt', typ: 'geofence', lat: 47.3500, lng: 7.9000,
      geofence_radius_m: 25, erledigt: null, aufgaben: [] }] };
  try { localStorage.removeItem('sop_rundgang_warteschlange'); } catch (e) {}
  rgLaufZeichnen();
  const k = rundgangAktiv.kontrollpunkte[0];
  rgsMeinOrt = { lat: 47.3500, lng: 7.9000, genauigkeit: 8, zeit: Date.now() };
  rgBereichPruefen();
  const zuerst = k._autoRest;
  rgTimerStarten();
  // Zwei Takte abwarten -- danach muss die Anzeige gesunken sein.
  await new Promise(r => setTimeout(r, 2300));
  const gesunken = k._autoRest;
  const zeileTxt = (document.getElementById('rdOrt75') || {}).textContent || '';
  // Und bis zum Ende laufen lassen.
  for (let i = 0; i < 60 && !k.erledigt; i++) { await new Promise(r => setTimeout(r, 100)); }
  rgTimerStoppen();
  const txtDanach = (document.getElementById('rdOrt75') || {}).textContent || '';
  rgsModus = null; rgsReiter = 'karte'; abPunktId = null;
  return { zuerst, gesunken, zeileTxt, erledigt: !!k.erledigt, txtDanach };
});
check('Vorbedingung: die Frist beginnt bei der vollen Sekundenzahl', nachziehen.zuerst >= 4);
check('KRITISCH: der Takt zählt herunter, ohne sich im Neuzeichnen zu verfangen',
  nachziehen.gesunken !== null && nachziehen.gesunken < nachziehen.zuerst);
check('KRITISCH: und die Zeile zeigt die verbleibenden Sekunden wirklich an',
  /\d/.test(nachziehen.zeileTxt) && nachziehen.zeileTxt.length > 5);
check('KRITISCH: am Ende wird erfasst', nachziehen.erledigt === true);
// Ein Countdown, der bei "1 s" stehenbleibt, waere schlimmer als gar keiner.
check('KRITISCH: und die Countdown-Zeile bleibt danach nicht stehen',
  nachziehen.txtDanach === '' || !/\d\s*s/.test(nachziehen.txtDanach));

// Wie OFT dabei neu gezeichnet wird. Der Takt zeichnet die Zeile neu, und
// das Neuzeichnen ruft ueber den Fuss wieder in den Takt zurueck: ohne
// Riegel ist das eine Endlosschleife. Sie faellt sonst NICHT auf -- der
// Takt faengt seine Fehler ab, verschluckt damit auch den Stapelueberlauf,
// und der Countdown liefe weiter, waehrend das Geraet heiss wird. Gezaehlt
// statt gehofft.
const takte = await page.evaluate(async () => {
  abPunktId = null;
  rgsModus = 'lauf';
  rgsReiter = 'punkte';
  rundgangAktiv = { id: 895, status: 'laeuft', einsatz_id: 1,
    vorbereitet_am: null, gestartet_am: null, pause_minuten: 0,
    kontrollpunkte: [
    { id: 76, bezeichnung: 'Punkt', typ: 'geofence', lat: 47.3500, lng: 7.9000,
      geofence_radius_m: 25, erledigt: null, aufgaben: [] }] };
  try { localStorage.removeItem('sop_rundgang_warteschlange'); } catch (e) {}
  rgLaufZeichnen();
  rgsMeinOrt = { lat: 47.3500, lng: 7.9000, genauigkeit: 8, zeit: Date.now() };
  rgBereichPruefen();
  let n = 0;
  const echt = window.rundgangListeZeichnen;
  window.rundgangListeZeichnen = function () { n++; return echt.apply(this, arguments); };
  rgTimerStarten();
  await new Promise(r => setTimeout(r, 2300));
  rgTimerStoppen();
  window.rundgangListeZeichnen = echt;
  rgsModus = null; rgsReiter = 'karte'; abPunktId = null;
  return n;
});
check('KRITISCH: zwei Takte zeichnen die Liste ein paar Mal neu, nicht hundertfach',
  takte > 0 && takte <= 8);

// Und der Fall, in dem der Countdown ohne Erfassung endet: Die Ortung
// bleibt stehen. Dann kommt per Definition keine neue Position mehr, die
// neu zeichnen koennte -- ohne eigenes Nachziehen bliebe "wird in 3 s
// erfasst" fuer immer stehen, waehrend in Wahrheit gar nichts mehr laeuft.
// Dieselbe Familie wie "unbekannt darf nie wie keine aussehen".
const stehen = await page.evaluate(async () => {
  abPunktId = null;
  rgsModus = 'lauf';
  rgsReiter = 'punkte';
  rundgangAktiv = { id: 896, status: 'laeuft', einsatz_id: 1,
    vorbereitet_am: null, gestartet_am: null, pause_minuten: 0,
    kontrollpunkte: [
    { id: 77, bezeichnung: 'Punkt', typ: 'geofence', lat: 47.3500, lng: 7.9000,
      geofence_radius_m: 25, erledigt: null, aufgaben: [] }] };
  try { localStorage.removeItem('sop_rundgang_warteschlange'); } catch (e) {}
  rgLaufZeichnen();
  /* Die echte Ortung hier abschalten. Sie laeuft in dieser Umgebung
     wirklich (die Pruefung gibt eine Position vor) und zeichnet bei jeder
     Meldung selbst nach -- damit waere nicht mehr zu erkennen, ob das
     NACHZIEHEN AUS DEM TAKT wirkt oder nur eine neue Position. Beim ersten
     Anlauf war genau das der Fall: Die Pruefung blieb gruen, auch als das
     Nachziehen ausgebaut war. */
  /* Die echte Ortung abschalten, die Wache aber als GESETZT belassen. Das
     ist genau die Lage, um die es geht: Die Verfolgung laeuft (der Browser
     hat sie registriert), es kommt nur nichts mehr an -- der haeufigste
     Fall draussen, wenn sich der Bildschirm sperrt. Wuerde hier einfach
     gestoppt, waere die Lage 'aus' statt 'steht', und der Countdown
     erschiene gar nicht erst. */
  rgOrtungStoppen();
  rgsOrtWache = -1;
  const k = rundgangAktiv.kontrollpunkte[0];
  rgsMeinOrt = { lat: 47.3500, lng: 7.9000, genauigkeit: 8, zeit: Date.now() };
  rgBereichPruefen();
  rundgangListeZeichnen();            // der Countdown steht jetzt in der Zeile
  const txtVorher = (document.getElementById('rdOrt77') || {}).textContent || '';
  // Die Ortung bleibt stehen: die Position altert ueber die Schwelle hinaus.
  // Ab hier kommt per Definition nichts mehr, was von selbst neu zeichnet.
  rgsMeinOrt.zeit = Date.now() - RG_ORT_STILL_MS - 5000;
  rgLaufKopfZeichnen();               // ein Takt
  const txtNachher = (document.getElementById('rdOrt77') || {}).textContent || '';
  rgsModus = null; rgsReiter = 'karte'; abPunktId = null; rgsOrtWache = null;
  return { txtVorher, txtNachher, erledigt: !!k.erledigt };
});
check('Vorbedingung: vorher lief der Countdown sichtbar', /\d\s*s/.test(stehen.txtVorher));
check('KRITISCH: bleibt die Ortung stehen, verschwindet der Countdown — er verspricht sonst etwas, das niemand einlöst',
  !/\d\s*s/.test(stehen.txtNachher));
check('KRITISCH: und erfasst wird auf einer veralteten Position ohnehin nichts',
  stehen.erledigt === false);

// ══════════ IM BEREICH: ES PASSIERT VON SELBST ═══════════════════════
await bauen();
const e1 = await page.evaluate(() => {
  erfassenJetzt();
  return {
    nah: rundgangAktiv.kontrollpunkte[0].erledigt,
    fern: rundgangAktiv.kontrollpunkte[1].erledigt,
    schlange: rdWarteschlangeLesen().map(x => ({ id: Number(x.kontrollpunkt_id),
      status: x.status, lat: x.lat })),
  };
});
check('KRITISCH: die Erfassung läuft durch dieselbe Tür wie der Knopf (rdMitOrt)',
  (await (async () => { await bauen(); return durchDieselbeTuer(); })()).join() === '1');
await bauen();
const e1b = await page.evaluate(() => { erfassenJetzt(); return {
  nah: rundgangAktiv.kontrollpunkte[0].erledigt,
  fern: rundgangAktiv.kontrollpunkte[1].erledigt,
  schlange: rdWarteschlangeLesen().map(x => ({ id: Number(x.kontrollpunkt_id),
    status: x.status, lat: x.lat })) }; });
Object.assign(e1, e1b);
check('KRITISCH: der Punkt im Bereich ist ohne jeden Klick erledigt',
  !!e1.nah && e1.nah.status === 'bestaetigt');
// 890 m. Eine Erfassung, die hier anschlaegt, ist das Gegenteil eines
// Nachweises.
check('KRITISCH: der Punkt ausserhalb bleibt offen', e1.fern === null);
check('KRITISCH: er geht mit Position in die Warteschlange — sonst kann der Server nichts nachprüfen',
  e1.schlange.length === 1 && e1.schlange[0].id === 1
  && e1.schlange[0].status === 'bestaetigt' && e1.schlange[0].lat !== null);

// ══════════ KEINE DOPPELTE ERFASSUNG ═════════════════════════════════
// watchPosition meldet im Sekundentakt. Ohne Riegel schriebe jede Messung
// einen neuen Scan, solange jemand am Punkt steht.
// Gezaehlt wird der Eintrag selbst, nicht die Warteschlange: Die wird im
// Hintergrund geleert, sobald der Server quittiert -- eine leere
// Warteschlange hiesse dann faelschlich "nichts erfasst".
const e2 = await page.evaluate(async () => {
  await bauen2();
  let n = 0;
  const echt = window.rdScanEintragen;
  window.rdScanEintragen = function () { n++; return echt.apply(this, arguments); };
  rgBereichPruefen(); fristVorziehen();
  for (let i = 0; i < 11; i++) { rgBereichPruefen(); }
  window.rdScanEintragen = echt;
  return n;
});
check('KRITISCH: elf Messungen am selben Ort erfassen genau EINMAL', e2 === 1);

// ══════════ DAS HYSTERESEBAND ERFASST NICHT ══════════════════════════
// rgSignalNoetig laesst bis RG_SIGNAL_ABSTAND Meter ausserhalb noch als
// "drin" gelten, damit eine springende Messung keine Signalkette erzeugt.
// Diese Grosszuegigkeit darf der Nachweis nicht erben: Der Server misst
// hart, und ein aus dem Band heraus erfasster Punkt kaeme als Fehler
// zurueck -- nach Stunden, wenn das Netz wieder da ist.
const band = await page.evaluate(() => {
  rundgangAktiv = { id: 901, status: 'laeuft', einsatz_id: 1, kontrollpunkte: [
    { id: 5, bezeichnung: 'Punkt', typ: 'geofence', lat: 47.3500, lng: 7.9000,
      geofence_radius_m: 25, erledigt: null, aufgaben: [] }] };
  try { localStorage.removeItem('sop_rundgang_warteschlange'); } catch (e) {}
  // Erst drin (setzt _drin = true), dann knapp ausserhalb des Radius, aber
  // innerhalb des Hysteresebands.
  rgsMeinOrt = { lat: 47.3500, lng: 7.9000, genauigkeit: 8, zeit: Date.now() };
  erfassenJetzt();
  const nachDrin = !!rundgangAktiv.kontrollpunkte[0].erledigt;
  rundgangAktiv.kontrollpunkte[0].erledigt = null;   // zuruecksetzen
  rundgangAktiv.kontrollpunkte[0]._drin = true;
  // rund 33 m noerdlich -- ausserhalb der 25 m, innerhalb von 25+15
  rgsMeinOrt = { lat: 47.35030, lng: 7.9000, genauigkeit: 8, zeit: Date.now() };
  const dist = rdEntfernungZu(rundgangAktiv.kontrollpunkte[0]);
  // Was gesagt wurde, mitschneiden: Ein Signal "erfasst", dem keine
  // Erfassung folgt, waere eine Falschauskunft an den Waechter.
  const gesagt = [];
  const echtSignal = window.rgSignalGeben;
  window.rgSignalGeben = t => gesagt.push(t);
  rgBereichPruefen();
  window.rgSignalGeben = echtSignal;
  return { nachDrin, dist, imBand: !!rundgangAktiv.kontrollpunkte[0].erledigt,
    drinGemerkt: rundgangAktiv.kontrollpunkte[0]._drin,
    fehler: rundgangAktiv.kontrollpunkte[0].fehler || null, gesagt };
});
check('Die Hilfsposition liegt wirklich im Band, sonst prüft der Fall nichts',
  band.dist > 25 && band.dist < 40);
check('KRITISCH: im Bereich wird erfasst', band.nachDrin === true);
check('KRITISCH: im Hystereseband — also AUSSERHALB des Radius — wird NICHT erfasst',
  band.imBand === false);
// Und es wird auch nicht VERSUCHT. Bis hierher fing der Riegel in rdMitOrt
// den Versuch ab -- richtig, aber der Waechter saehe dann von selbst eine
// rote Fehlermeldung an einer Zeile, die er nie angetippt hat. Ein Werkzeug,
// das sich ohne Zutun beschwert, verliert genau dort Vertrauen, wo es
// zaehlt.
check('KRITISCH: es wird gar nicht erst versucht — keine Fehlermeldung aus dem Nichts',
  band.fehler === null);
check('KRITISCH: und es wird nicht "erfasst" gemeldet, wo nichts erfasst wurde',
  !band.gesagt.some(t => t.includes('erfasst')));
check('Das Band bleibt für das Signal trotzdem "drin" (keine Signalkette)',
  band.drinGemerkt === true);

// ══════════ FORMULAR GESCHLOSSEN: ES HOLT NACH ═══════════════════════
// Wer im Bereich ein Ersatzscan-Formular oeffnet und wieder schliesst, hat
// den Eintritts-Uebergang laengst verbraucht. Haenge die Erfassung daran,
// bliebe sein Punkt liegen, bis er den Bereich verlaesst und neu betritt --
// nachts vor einem Tor ist das eine Sackgasse.
const nachtrag = await page.evaluate(() => {
  rundgangAktiv = { id: 902, status: 'laeuft', einsatz_id: 1, kontrollpunkte: [
    { id: 6, bezeichnung: 'Punkt', typ: 'geofence', lat: 47.3500, lng: 7.9000,
      geofence_radius_m: 25, erledigt: null, offen: 'es', aufgaben: [] }] };
  try { localStorage.removeItem('sop_rundgang_warteschlange'); } catch (e) {}
  rgsMeinOrt = { lat: 47.3500, lng: 7.9000, genauigkeit: 8, zeit: Date.now() };
  erfassenJetzt();
  const mitFormular = !!rundgangAktiv.kontrollpunkte[0].erledigt;
  rundgangAktiv.kontrollpunkte[0].offen = null;      // Formular geschlossen
  // Die Frist lief waehrenddessen weiter -- wer fuenf Sekunden dort stand,
  // hat fuenf Sekunden dort gestanden, auch mit offenem Formular.
  rgBereichPruefen();                                // naechste Messung
  return { mitFormular, danach: !!rundgangAktiv.kontrollpunkte[0].erledigt };
});
check('KRITISCH: bei offenem Formular wird nicht erfasst', nachtrag.mitFormular === false);
check('KRITISCH: nach dem Schliessen holt die nächste Messung es nach — keine Sackgasse',
  nachtrag.danach === true);

// ══════════ PAUSIERT: NACHHOLEN NACH DEM FORTSETZEN ══════════════════
const pause = await page.evaluate(() => {
  rundgangAktiv = { id: 903, status: 'pausiert', einsatz_id: 1, kontrollpunkte: [
    { id: 7, bezeichnung: 'Punkt', typ: 'geofence', lat: 47.3500, lng: 7.9000,
      geofence_radius_m: 25, erledigt: null, aufgaben: [] }] };
  try { localStorage.removeItem('sop_rundgang_warteschlange'); } catch (e) {}
  rgsMeinOrt = { lat: 47.3500, lng: 7.9000, genauigkeit: 8, zeit: Date.now() };
  erfassenJetzt();
  const inPause = !!rundgangAktiv.kontrollpunkte[0].erledigt;
  rundgangAktiv.status = 'laeuft';
  rgBereichPruefen();
  return { inPause, danach: !!rundgangAktiv.kontrollpunkte[0].erledigt };
});
check('KRITISCH: in der Pause wird nicht erfasst', pause.inPause === false);
check('KRITISCH: nach dem Fortsetzen wird nachgeholt', pause.danach === true);

// ══════════ DIE AUFGABE POPPT AUF, WIRD ABER NICHT MITERLEDIGT ═══════
// Der ausdrueckliche Unterschied: "Die Aufgabe ist etwas anderes. Das muss
// man ja explizit bestaetigen."
const auf = await page.evaluate(() => {
  abPunktId = null;
  rundgangAktiv = { id: 904, status: 'laeuft', einsatz_id: 1, kontrollpunkte: [
    { id: 8, bezeichnung: 'Punkt mit Aufgabe', typ: 'geofence', lat: 47.3500, lng: 7.9000,
      geofence_radius_m: 25, erledigt: null,
      aufgaben: [{ id: 41, bezeichnung: 'Türe kontrollieren', information: null, erledigt: null }] }] };
  try { localStorage.removeItem('sop_rundgang_warteschlange'); } catch (e) {}
  try { localStorage.removeItem('sop_rundgang_aufgaben'); } catch (e) {}
  rgsMeinOrt = { lat: 47.3500, lng: 7.9000, genauigkeit: 8, zeit: Date.now() };
  erfassenJetzt();
  return {
    punktErledigt: !!rundgangAktiv.kontrollpunkte[0].erledigt,
    blattPunkt: abPunktId,
    offeneAufgaben: rdAufgabenOffen(rundgangAktiv.kontrollpunkte[0]).length,
  };
});
check('KRITISCH: der Punkt ist erfasst', auf.punktErledigt === true);
check('KRITISCH: die Aufgabe poppt von selbst auf', auf.blattPunkt === 8);
check('KRITISCH: die Aufgabe ist damit NICHT erledigt — sie bleibt zu bestätigen',
  auf.offeneAufgaben === 1);
await page.waitForTimeout(300);
check('Und das Blatt steht wirklich sichtbar da, nicht nur im Zustand',
  await page.isVisible('#blBody'));
await page.screenshot({ path: `${OUT}/autoerfassung-01-aufgabe.png` });

// ══════════ ZWEI ÜBERLAPPENDE BEREICHE: NUR EIN BLATT ════════════════
// Sonst ueberschriebe das zweite Blatt das erste, und dessen Aufgaben
// verschwaenden vor den Augen des Waechters.
const zwei = await page.evaluate(() => {
  abPunktId = null;
  blattZu && blattZu();
  rundgangAktiv = { id: 905, status: 'laeuft', einsatz_id: 1, kontrollpunkte: [
    { id: 11, bezeichnung: 'A', typ: 'geofence', lat: 47.3500, lng: 7.9000,
      geofence_radius_m: 40, erledigt: null,
      aufgaben: [{ id: 51, bezeichnung: 'A1', information: null, erledigt: null }] },
    { id: 12, bezeichnung: 'B', typ: 'geofence', lat: 47.35005, lng: 7.9000,
      geofence_radius_m: 40, erledigt: null,
      aufgaben: [{ id: 52, bezeichnung: 'B1', information: null, erledigt: null }] },
  ] };
  try { localStorage.removeItem('sop_rundgang_warteschlange'); } catch (e) {}
  try { localStorage.removeItem('sop_rundgang_aufgaben'); } catch (e) {}
  rgsMeinOrt = { lat: 47.3500, lng: 7.9000, genauigkeit: 8, zeit: Date.now() };
  erfassenJetzt();
  return { beide: rundgangAktiv.kontrollpunkte.every(k => !!k.erledigt),
    blattPunkt: abPunktId,
    karten: document.querySelectorAll('#blBody .ab-karte').length };
});
check('KRITISCH: beide Punkte werden erfasst', zwei.beide === true);
check('KRITISCH: aber nur EIN Aufgabenblatt steht offen', zwei.blattPunkt === 11);
check('Und es zeigt die Aufgaben genau eines Punktes', zwei.karten === 1);

// ══════════ DER KREIS AUF DER KARTE WIRD GRÜN ════════════════════════
// Wortlaut des Projektinhabers: "dass der Kreis bereits gruen wird".
// Gemessen, nicht nachgelesen: Die Karte wird nach der Erfassung
// nachgefuehrt, ohne dass jemand den Reiter wechselt -- und OHNE dass eine
// neue Karte gebaut wird, sonst spraenge der Ausschnitt zurueck.
check('KRITISCH: es gibt einen leichten Nachführ-Weg, der die Karte nicht neu baut',
  /function rgKartePunkteNachfuehren/.test(APP)
  && !/function rgKartePunkteNachfuehren[\s\S]{0,400}new google\.maps\.Map/.test(APP));
check('KRITISCH: die Erfassung führt die Karte nach',
  /function rdScanEintragen[\s\S]{0,1500}rgKartePunkteNachfuehren\(\)/.test(APP));

const karte = await page.evaluate(async () => {
  const farben = () => [...document.querySelectorAll('.gm-mock-circle')]
    .map(el => el.dataset.farbe || '');
  abPunktId = null;
  rgsModus = 'lauf';
  rgsReiter = 'karte';
  // Die Ortung wird hier bewusst NICHT laufen gelassen: sonst erfasst der
  // echte watchPosition den Punkt schon waehrend des Kartenaufbaus, und die
  // Pruefung saehe nie den Zustand "offen, blau". Der Punkt liegt darum
  // zuerst ausserhalb und wandert dann heran -- wie im Betrieb auch.
  rundgangAktiv = { id: 906, status: 'laeuft', einsatz_id: 1,
    vorbereitet_am: null, gestartet_am: null, pause_minuten: 0,
    objekt: { id: 7, name: 'Musterobjekt' }, kunde_name: 'Muster AG',
    ansprechpartner: [], zentrale: null, kontrollpunkte: [
    { id: 21, bezeichnung: 'Punkt', typ: 'geofence', lat: 47.3580, lng: 7.9000,
      geofence_radius_m: 25, erledigt: null, aufgaben: [] }] };
  try { localStorage.removeItem('sop_rundgang_warteschlange'); } catch (e) {}
  rgLaufZeichnen();
  await new Promise(r => setTimeout(r, 800));
  rgOrtungStoppen();
  const vorher = farben();
  // Jetzt steht der Waechter im Bereich. Kein Reiterwechsel, kein Klick.
  rundgangAktiv.kontrollpunkte[0].lat = 47.3500;
  rgsMeinOrt = { lat: 47.3500, lng: 7.9000, genauigkeit: 8, zeit: Date.now() };
  erfassenJetzt();
  return { vorher, nachher: farben(),
    erledigt: !!rundgangAktiv.kontrollpunkte[0].erledigt };
});
// Am GERENDERTEN Zustand abgelesen (CLAUDE.md: gemessen, nicht nachgelesen)
// -- die Attrappe schreibt die tatsaechlich uebergebene Farbe ans Element.
const gruen = f => typeof f === 'string' && /^#4FCE96$/i.test(f);
check('Vorbedingung: der Kreis war vorher nicht grün',
  karte.vorher.length === 1 && !gruen(karte.vorher[0]));
check('KRITISCH: nach der automatischen Erfassung ist der Kreis grün — ohne Reiterwechsel',
  karte.erledigt === true && karte.nachher.length === 1 && gruen(karte.nachher[0]));

// ══════════ ERFASST, WÄHREND DIE KARTE NOCH LÄDT ═════════════════════
// Der haeufigste Fall im Betrieb und beim Bauen dieser Funktion gefunden:
// Die Runde oeffnet auf dem Kartenreiter, die Kartenschluessel brauchen
// Sekunden -- und die erste Position kommt in genau dieses Fenster. Wird
// der Punkt dann erfasst, greift die Nachfuehrung noch ins Leere (es gibt
// noch keine Karte). Zeichnet der Kartenaufbau danach den Stand von VORHER,
// bleibt ein erfasster Punkt blau, bis jemand den Reiter wechselt.
const rennen = await page.evaluate(async () => {
  const farben = () => [...document.querySelectorAll('.gm-mock-circle')]
    .map(el => el.dataset.farbe || '');
  abPunktId = null;
  rgsModus = 'lauf';
  rgsReiter = 'karte';
  rgsKarte = null;
  rundgangAktiv = { id: 907, status: 'laeuft', einsatz_id: 1,
    vorbereitet_am: null, gestartet_am: null, pause_minuten: 0,
    objekt: { id: 7, name: 'Musterobjekt' }, kunde_name: 'Muster AG',
    ansprechpartner: [], zentrale: null, kontrollpunkte: [
    { id: 31, bezeichnung: 'Punkt', typ: 'geofence', lat: 47.3500, lng: 7.9000,
      geofence_radius_m: 25, erledigt: null, aufgaben: [] }] };
  try { localStorage.removeItem('sop_rundgang_warteschlange'); } catch (e) {}
  rgsMeinOrt = { lat: 47.3500, lng: 7.9000, genauigkeit: 8, zeit: Date.now() };
  rgLaufZeichnen();                 // Karte beginnt zu laden
  rgOrtungStoppen();                // die echte Ortung soll hier nicht dazwischen
  const karteSchonDa = !!rgsKarte;  // Vorbedingung: sie ist es noch NICHT
  erfassenJetzt();                  // Position trifft ein, waehrend sie laedt
  await new Promise(r => setTimeout(r, 900));
  return { karteSchonDa, farben: farben(),
    erledigt: !!rundgangAktiv.kontrollpunkte[0].erledigt };
});
check('Vorbedingung: die Karte stand beim Erfassen noch nicht',
  rennen.karteSchonDa === false);
check('KRITISCH: ein während des Kartenaufbaus erfasster Punkt ist danach trotzdem grün',
  rennen.erledigt === true && rennen.farben.length === 1 && gruen(rennen.farben[0]));

// ══════════ GEMESSEN, NICHT NACHGELESEN ══════════════════════════════
// Die Zeile hat einen Hinweis dazubekommen, wo vorher ein Knopf stand. Was
// im Quelltext richtig aussieht, kann am gerenderten Zustand ueberlaufen
// oder unlesbar klein sein -- und das faellt sonst erst nachts draussen auf.
//
// Dafuer eine EIGENE Seite, die den ganzen echten Weg geht (anmelden,
// Schichten, Runde oeffnen): Eine Runde, die nur ueber rundgangAktiv
// zusammengesetzt wird, ist nicht sichtbar -- ihre Elemente messen sich
// dann zu 0 x 0, und jede Messung daran waere gruen, ohne etwas zu sagen.
// Genau das ist beim Bauen dieser Suite passiert.
const iso2 = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const tag2 = n => iso2(new Date(Date.now() + n * 864e5));
const RUNDE = { id: 960, status: 'laeuft', pausiert_seit: null,
  vorbereitet_am: tag2(0) + ' 02:00:00', pause_minuten: 0,
  objekt: { id: 7, name: 'Musterobjekt', strasse: 'Musterweg 4', ort: '9999 Musterdorf' },
  kunde_name: 'Musterliegenschaften AG', ansprechpartner: [], zentrale: null,
  kontrollpunkte: [
    // Beide weit weg -- sonst erfasst die Ortung sie sofort und es gibt
    // keine offene Zeile mehr zu messen.
    { id: 41, bezeichnung: 'Ein Kontrollpunkt mit einer längeren Bezeichnung',
      reihenfolge: 1, typ: 'geofence', lat: 47.3580, lng: 7.9000,
      geofence_radius_m: 20, erledigt: null, aufgaben: [] },
  ] };
const SCHICHTEN = { status: 'ok', von: tag2(-30), bis: tag2(90), schichten: [
  { id: 71, kunde_name: 'Musterliegenschaften AG', titel: 'Nachtwache',
    strasse: 'Musterweg 4', ort: '9999 Musterdorf', einsatzart: 'Revierdienst',
    sparte: 'sicherheit', datum: tag2(0), von: '20:00:00', bis: '06:00:00',
    status: 'bestaetigt', bemerkung: null, zusage: 'zugesagt',
    objekt_name: 'Musterobjekt', objekt_id: 7, hat_kontrollpunkte: true, im_team: 1 }]};
const PROFIL = { status: 'ok', monat: { anzahl: 0, stunden: 0 },
  profil: { name: 'm.muster', ist_admin: false, personalnummer: 'P-001',
    vorname: 'Max', nachname: 'Muster', erstellt_am: tag2(-30) + ' 10:00:00' } };

const seite = await browser.newPage({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
  permissions: ['geolocation'],
  geolocation: { latitude: 47.3500, longitude: 7.9000, accuracy: 8 },
});
seite.on('pageerror', e => bad.push('JS-Fehler (Messseite): ' + e.message));
await seite.route('**/api/**', route => {
  const pf = new URL(route.request().url()).pathname.split('/api/')[1];
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (pf.includes('login')) return send({ status: 'ok', token: 't', name: 'm.muster', ist_admin: false });
  if (pf.includes('meine_schichten')) return send(SCHICHTEN);
  if (pf.includes('mein_profil')) return send(PROFIL);
  if (pf.includes('rapport_list')) return send({ status: 'ok', rapporte: [] });
  if (pf.includes('mein_rundgang_offen')) return send({ status: 'ok', rundgang: JSON.parse(JSON.stringify(RUNDE)) });
  return send({ status: 'ok' });
});
await seite.route('**maps.googleapis.com/**', route =>
  route.fulfill({ status: 200, contentType: 'application/javascript', body: GOOGLE_MAPS_MOCK }));
await seite.goto(`file://${WURZEL}/app.html`);
await seite.fill('#gName', 'm.muster');
await seite.fill('#gPass', 'x');
await seite.click('#gBtn');
await seite.waitForSelector('.app.on');
await seite.waitForTimeout(400);
await seite.evaluate(() => ladeSchichten().then(() => rundgangFortsetzen(71)));
await seite.waitForTimeout(1400);
await seite.click('#rgsRt-punkte');
await seite.waitForTimeout(500);

const mass = async () => seite.evaluate(() => {
  const h = document.getElementById('rdAuto41');
  const b = document.getElementById('rdBtn41');
  const r = h ? h.getBoundingClientRect() : null;
  return {
    hinweisDa: !!h && h.offsetParent !== null && r.height > 0,
    text: h ? h.textContent.trim() : '',
    schrift: h ? parseFloat(getComputedStyle(h).fontSize) : 0,
    imBild: !!r && r.left >= 0 && r.right <= window.innerWidth + 1,
    knopfHoehe: b ? b.getBoundingClientRect().height : null,
    ueberlauf: document.documentElement.scrollWidth
      <= document.documentElement.clientWidth + 1,
  };
});
// Und der Countdown am gerenderten Zustand -- der Punkt liegt dafuer kurz
// im Bereich. Gemessen, nicht nachgelesen (CLAUDE.md).
// Die Ortung laeuft dabei WEITER -- sonst zeigte die Zeile den Countdown
// und daneben "ohne laufende Ortung nicht automatisch". Genau dieser
// Widerspruch stand beim ersten Messen auf dem Bildschirm.
await seite.evaluate(() => {
  const k = rundgangAktiv.kontrollpunkte[0];
  k.lat = 47.3500;
  rgsMeinOrt = { lat: 47.3500, lng: 7.9000, genauigkeit: 8, zeit: Date.now() };
  rgBereichPruefen();
  rundgangListeZeichnen();
});
await seite.waitForTimeout(300);
const zaehlZeile = await seite.evaluate(() => {
  const el = document.getElementById('rdOrt41');
  if (!el) { return null; }
  const r = el.getBoundingClientRect();
  return { txt: el.textContent.trim(), schrift: parseFloat(getComputedStyle(el).fontSize),
    sichtbar: el.offsetParent !== null && r.height > 0,
    imBild: r.left >= 0 && r.right <= window.innerWidth + 1,
    ueberlauf: document.documentElement.scrollWidth
      <= document.documentElement.clientWidth + 1 };
});
check('KRITISCH: die Countdown-Zeile steht sichtbar da', !!zaehlZeile && zaehlZeile.sichtbar);
check('KRITISCH: sie nennt die verbleibenden Sekunden', !!zaehlZeile && /\d/.test(zaehlZeile.txt));
check('KRITISCH: sie sagt auch, WOZU gezählt wird — eine nackte Zahl wäre keine Auskunft',
  !!zaehlZeile && zaehlZeile.txt.length > 12);
check('Sie ist lesbar gross und läuft nicht aus dem Bild',
  !!zaehlZeile && zaehlZeile.schrift >= 12 && zaehlZeile.imBild && zaehlZeile.ueberlauf);
// Beide Zeilen der Zeile muessen aus derselben Quelle stammen. Ein
// Countdown neben "geht gerade nicht automatisch" sind zwei Aussagen, von
// denen eine falsch ist -- und der Waechter weiss nicht, welche.
check('KRITISCH: kein Widerspruch — neben dem Countdown steht nicht "geht nicht automatisch"',
  await seite.evaluate(() => {
    const zaehlt = document.getElementById('rdOrt41');
    const hinweis = document.getElementById('rdAuto41');
    if (!zaehlt || !/\d\s*s/.test(zaehlt.textContent)) { return true; }
    // Der Countdown ist die genauere Aussage; der allgemeine Hinweis
    // daneben waere bestenfalls doppelt und schlimmstenfalls das Gegenteil.
    return !hinweis || hinweis.textContent.trim() === w('rdAutoWartet');
  }));
check('Solange gezählt wird, steht der allgemeine Hinweis nicht zusätzlich da',
  await seite.evaluate(() => !document.getElementById('rdAuto41')));
check('KRITISCH: und solange gezählt wird, steht kein Bestätigen-Knopf da',
  await seite.evaluate(() => !document.getElementById('rdBtn41')));
await seite.screenshot({ path: `${OUT}/autoerfassung-05-countdown-handy.png` });
/* Zurueck in die Ausgangslage. Die Ortung muss dabei WIRKLICH wieder
   laufen: Die folgenden Messungen pruefen den Hinweis, der nur erscheint,
   solange die Automatik zustaendig ist -- und das haengt an rgOrtLage(). */
await seite.evaluate(() => {
  const k = rundgangAktiv.kontrollpunkte[0];
  k.lat = 47.3580; k._drinSeit = null; k._autoRest = null;
  rgsMeinOrt = { lat: 47.3500, lng: 7.9000, genauigkeit: 8, zeit: Date.now() };
  rundgangListeZeichnen();
});
await seite.waitForTimeout(600);
check('Vorbedingung: die Ortung läuft für die folgenden Messungen wieder',
  await seite.evaluate(() => rgOrtLage().art === 'laeuft'));

const handy = await mass();
// Vorbedingung: Es wird an etwas WIRKLICH Sichtbarem gemessen.
check('Vorbedingung: die Zeile ist tatsächlich gerendert, nicht 0 × 0', handy.hinweisDa);
check('KRITISCH: solange die Ortung läuft, steht dort ein Hinweis statt eines Knopfes',
  handy.knopfHoehe === null && handy.text.length > 10);
check('KRITISCH: er ist lesbar gross', handy.schrift >= 12);
check('KRITISCH: er läuft am Handy nicht aus dem Bild', handy.imBild && handy.ueberlauf);
await seite.screenshot({ path: `${OUT}/autoerfassung-02-zeile-handy.png` });

// Der Rueckfall-Knopf muss die Trefferflaeche behalten, die CLAUDE.md
// verlangt -- er ist nachts das letzte Mittel.
await seite.evaluate(() => { rgsOrtFehler = 'nicht_da'; rundgangListeZeichnen(); });
await seite.waitForTimeout(300);
const rueckfall = await mass();
check('KRITISCH: ohne Ortung steht der Knopf wieder da', rueckfall.knopfHoehe !== null);
check('KRITISCH: und ist mindestens 44 px hoch', rueckfall.knopfHoehe >= 44);
check('KRITISCH: der Hinweis sagt dann etwas anderes als vorher',
  rueckfall.text.length > 10 && rueckfall.text !== handy.text);
check('Auch dann kein waagrechter Überlauf', rueckfall.ueberlauf);

// Und die dritte Lage: Die Ortung LÄUFT, hat aber noch keine Position --
// die ersten Sekunden jeder Runde. Das geht von selbst vorbei und ist damit
// etwas anderes als "kein Standort". Drei Sachverhalte, drei Texte
// (CLAUDE.md: "unbekannt" darf nie wie "keine" aussehen).
await seite.evaluate(() => { rgsOrtFehler = null; rgsMeinOrt = null; rundgangListeZeichnen(); });
await seite.waitForTimeout(300);
const sucht = await mass();
check('KRITISCH: solange der Standort gesucht wird, steht der Knopf ebenfalls da',
  sucht.knopfHoehe !== null);
check('KRITISCH: aber mit einem eigenen Text — "wird gesucht" ist nicht "keine Ortung"',
  sucht.text.length > 10 && sucht.text !== rueckfall.text && sucht.text !== handy.text);
await seite.screenshot({ path: `${OUT}/autoerfassung-03-rueckfall-handy.png` });

// Und dasselbe am Desktop -- jede Aenderung am Handy-Layout wird dort
// zusaetzlich geprueft (CLAUDE.md).
await seite.setViewportSize({ width: 1440, height: 900 });
// Wieder in die Normallage: Ortung laeuft und hat eine Position.
await seite.evaluate(() => {
  rgsOrtFehler = null;
  rgsMeinOrt = { lat: 47.3500, lng: 7.9000, genauigkeit: 8, zeit: Date.now() };
  rundgangListeZeichnen();
});
await seite.waitForTimeout(400);
const desktop = await mass();
check('Am Desktop steht derselbe Hinweis sichtbar da',
  desktop.hinweisDa && desktop.imBild && desktop.knopfHoehe === null);
check('Am Desktop kein waagrechter Überlauf', desktop.ueberlauf);
await seite.screenshot({ path: `${OUT}/autoerfassung-04-zeile-desktop.png` });

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
