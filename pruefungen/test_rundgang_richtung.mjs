// Bewegungsrichtung auf der Rundgang-Karte (ENT-542).
//
// Wunsch des Projektinhabers: „ein ganz kleiner Pfeil beim Wachmann Symbol,
// in welche Richtung man sich gerade bewegt."
//
// Gemeint ist die Richtung der BEWEGUNG, nicht die Blickrichtung — der
// Kompass des Geräts bleibt bewusst aussen vor (eigene Erlaubnis auf dem
// iPhone, eigene Entscheidung). Ausgewertet wird nur, was die laufende
// Ortung (ENT-317) ohnehin liefert.
//
// Drei Dinge werden hier besonders genau geprüft, weil an ihnen der Wert
// der Anzeige hängt:
//  1. Der Pfeil zeigt WIRKLICH in die Bewegungsrichtung — gemessen an
//     seiner Lage auf dem Bildschirm, nicht nur an der gesetzten Zahl. Eine
//     Drehung, die im Code steht und in der Karte nicht ankommt, wäre im
//     Quelltext nicht zu sehen.
//  2. Er kreiselt nicht im Stand. Zwei GPS-Messungen am selben Ort
//     unterscheiden sich um Meter; eine Peilung daraus zeigt irgendwohin.
//  3. Er verschwindet, wenn die Richtung nicht mehr aktuell ist. Ein alter
//     Pfeil ist das Gegenteil einer Auskunft: Er sieht aus wie die
//     aktuelle Richtung („unbekannt" darf nie wie „bekannt" aussehen).
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

// ══════════ DIE RECHNUNG, FÜR SICH ═══════════════════════════════════
// Als reine Funktion prüfbar, ohne Karte und ohne Ortung — dieselbe
// Trennung wie bei rgDistanzMeter().
const peilung = await page.evaluate(() => ({
  nord: rgPeilung(47.3500, 7.9000, 47.3520, 7.9000),
  ost:  rgPeilung(47.3500, 7.9000, 47.3500, 7.9030),
  sued: rgPeilung(47.3500, 7.9000, 47.3480, 7.9000),
  west: rgPeilung(47.3500, 7.9000, 47.3500, 7.8970),
  nordost: rgPeilung(47.3500, 7.9000, 47.3510, 7.9015),
}));
check('KRITISCH: die Peilung rechnet Norden als 0 Grad',
  Math.abs(peilung.nord) < 0.5 || Math.abs(peilung.nord - 360) < 0.5);
check('KRITISCH: Osten als 90 Grad', Math.abs(peilung.ost - 90) < 0.5);
check('KRITISCH: Süden als 180 Grad', Math.abs(peilung.sued - 180) < 0.5);
check('KRITISCH: Westen als 270 Grad', Math.abs(peilung.west - 270) < 0.5);
check('Und dazwischen ebenfalls plausibel (Nordost liegt zwischen 0 und 90)',
  peilung.nordost > 20 && peilung.nordost < 70);

// ══════════ WAS ALS RICHTUNG GILT ════════════════════════════════════
const quelle = await page.evaluate(() => {
  const jetzt = Date.now();
  const mach = (vorher, neu, kurs) => {
    const n = Object.assign({ zeit: jetzt }, neu);
    rgRichtungBestimmen(vorher, n, kurs);
    return n.richtung;
  };
  const a = { lat: 47.3500, lng: 7.9000, zeit: jetzt - 5000, richtung: 42, richtungZeit: jetzt - 5000 };
  return {
    // Das Gerät weiss es selbst -- dann gilt sein Wert, auch wenn die
    // beiden Positionen etwas anderes ergäben.
    geraet: mach(a, { lat: 47.3520, lng: 7.9000 }, 270),
    // Kein Gerätewert: aus zwei Positionen, ab Mindeststrecke.
    ausPositionen: mach(a, { lat: 47.3520, lng: 7.9000 }, null),
    // Stillstand meldet das Gerät nach Norm als NaN -- das ist KEIN Kurs.
    beiNaN: mach(a, { lat: 47.3520, lng: 7.9000 }, NaN),
    // Unter der Mindeststrecke bleibt die alte Richtung stehen, statt zu
    // kreiseln.
    wackler: mach(a, { lat: 47.35003, lng: 7.90001 }, null),
    // Ganz ohne Vorgängerin gibt es keine Richtung -- eine einzelne
    // Messung sagt nichts über Bewegung.
    ersteMessung: mach(null, { lat: 47.3500, lng: 7.9000 }, null),
  };
});
check('KRITISCH: liefert das Gerät einen Kurs, gilt dieser',
  Math.abs(quelle.geraet - 270) < 0.5);
check('KRITISCH: sonst wird aus zwei Positionen gepeilt',
  Math.abs(quelle.ausPositionen) < 0.5 || Math.abs(quelle.ausPositionen - 360) < 0.5);
check('KRITISCH: NaN vom Gerät (Stillstand nach Norm) zählt NICHT als Kurs -- sonst zeigte der Pfeil nach Norden',
  Math.abs(quelle.beiNaN) < 0.5 || Math.abs(quelle.beiNaN - 360) < 0.5);
check('KRITISCH: unter der Mindeststrecke bleibt die alte Richtung -- kein Kreiseln im Stand',
  quelle.wackler === 42);
check('KRITISCH: die allererste Messung hat keine Richtung', quelle.ersteMessung === null);

// ══════════ AUF DER KARTE, GEMESSEN ══════════════════════════════════
await page.evaluate(() => ladeSchichten().then(() => rundgangFortsetzen(71)));
await page.waitForTimeout(1600);
await page.click('#rgsRt-karte');
await page.waitForTimeout(900);

const lage = () => page.evaluate(() => {
  const alle = [...document.querySelectorAll('#rgsKarte .gm-mock-marker')];
  // Die beiden Marken sind an ihrem Pfad zu unterscheiden -- nicht an der
  // Reihenfolge im DOM, die sich beim Neuzeichnen ändern darf.
  const pfeil = alle.find(e => (e.dataset.pfad || '').startsWith('M12 1.5'));
  const schild = alle.find(e => (e.dataset.pfad || '').startsWith('M12 2 4'));
  const mitte = e => { if (!e) return null; const b = e.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; };
  return {
    pfeilDa: !!pfeil, schildDa: !!schild,
    drehung: pfeil ? Number(pfeil.dataset.drehung) : null,
    schildDrehung: schild ? Number(schild.dataset.drehung) : null,
    pfeil: mitte(pfeil), schild: mitte(schild),
    richtung: rgRichtungJetzt(),
  };
});

let m = await lage();
check('KRITISCH: das Wächter-Schild steht auf der Karte', m.schildDa === true);
check('KRITISCH: vor der ersten Bewegung gibt es KEINEN Pfeil -- eine Richtung, die niemand kennt, wird nicht erfunden',
  m.pfeilDa === false && m.richtung === null);

// Rund 22 m nach Norden.
await page.context().setGeolocation({ latitude: 47.35020, longitude: 7.9000, accuracy: 8 });
await page.waitForTimeout(900);
m = await lage();
check('KRITISCH: nach der Bewegung erscheint der Pfeil', m.pfeilDa === true);
check('Er trägt die Richtung Norden', m.drehung !== null
  && (m.drehung < 0.5 || m.drehung > 359.5));
check('KRITISCH: und er steht auch WIRKLICH über dem Schild -- gemessen, nicht nur gesetzt',
  m.pfeil && m.schild && m.pfeil.y < m.schild.y - 8
  && Math.abs(m.pfeil.x - m.schild.x) < 4);

// Rund 30 m nach Osten.
await page.context().setGeolocation({ latitude: 47.35020, longitude: 7.90040, accuracy: 8 });
await page.waitForTimeout(900);
m = await lage();
check('KRITISCH: nach Osten zeigt er nach Osten', m.drehung !== null
  && Math.abs(m.drehung - 90) < 1);
check('KRITISCH: und steht rechts vom Schild, nicht mehr darüber',
  m.pfeil && m.schild && m.pfeil.x > m.schild.x + 8
  && Math.abs(m.pfeil.y - m.schild.y) < 4);
check('KRITISCH: das Schild selbst bleibt aufrecht -- ein gekippter Mensch sähe nach Umfallen aus, nicht nach Nordost',
  m.schildDrehung === 0);
await page.screenshot({ path: `${OUT}/richtung-01-ost.png` });

// Dreht sich die Richtung, OHNE dass eine neue Position kommt, muss die
// bestehende Marke sie uebernehmen. Das ist der einzige Weg, den
// setIcon-Pfad zu treffen: Bei einem Positionswechsel wird die Karte
// bis ENT-543 ohnehin neu gebaut, und dann entstand die Marke neu --
// eine Pruefung ueber den Positionswechsel liefe also am gepruegten Weg
// vorbei und waere gruen, auch wenn setIcon gar nichts taete.
await page.evaluate(() => {
  rgsMeinOrt.richtung = 180; rgsMeinOrt.richtungZeit = Date.now();
  rgLaufKopfZeichnen();
});
await page.waitForTimeout(300);
m = await lage();
check('KRITISCH: eine Richtungsaenderung ohne Kartenneubau kommt bei der bestehenden Marke an',
  m.drehung !== null && Math.abs(m.drehung - 180) < 1);
check('KRITISCH: und der Pfeil steht dann UNTER dem Schild -- gemessen',
  m.pfeil && m.schild && m.pfeil.y > m.schild.y + 8
  && Math.abs(m.pfeil.x - m.schild.x) < 4);

// Ein Wackler unter der Mindeststrecke.
await page.context().setGeolocation({ latitude: 47.35020, longitude: 7.90080, accuracy: 8 });
await page.waitForTimeout(900);
const vorWackler = (await lage()).drehung;
check('Vorbereitung: nach weiterer Bewegung nach Osten steht die Richtung wieder auf Ost',
  vorWackler !== null && Math.abs(vorWackler - 90) < 1);
// Wenige Meter neben der eben gemeldeten Stelle -- unter RG_RICHTUNG_MIN_M.
// Der Versatz muss sich auf die LETZTE Position beziehen, nicht auf die
// davor: Sonst waere es eine echte Bewegung und die Pruefung pruefte das
// Gegenteil dessen, was sie behauptet (beim Bauen genau so passiert).
await page.context().setGeolocation({ latitude: 47.350203, longitude: 7.900803, accuracy: 8 });
await page.waitForTimeout(900);
m = await lage();
check('KRITISCH: ein Messrauschen von wenigen Metern dreht den Pfeil nicht',
  m.drehung === vorWackler);

// Stillstand: watchPosition meldet nichts mehr, die Uhr läuft weiter.
await page.evaluate(() => { rgsMeinOrt.richtungZeit = Date.now() - 40000; });
await page.evaluate(() => rgLaufKopfZeichnen());
await page.waitForTimeout(300);
m = await lage();
check('KRITISCH: eine veraltete Richtung wird nicht weitergezeigt -- der Pfeil verschwindet',
  m.pfeilDa === false && m.richtung === null);
check('Das Schild bleibt dabei stehen -- der Standort ist ja weiterhin bekannt',
  m.schildDa === true);

// ══════════ ENDE DER RUNDE ═══════════════════════════════════════════
// Nach dem Ende steht auch die Uhr, die das Altern nachführt. Der Pfeil
// darf darum nicht auf das Altern warten.
await page.context().setGeolocation({ latitude: 47.35045, longitude: 7.90040, accuracy: 8 });
await page.waitForTimeout(900);
check('Vorbereitung: der Pfeil ist wieder da', (await lage()).pfeilDa === true);
await page.evaluate(() => { rgOrtungStoppen(); });
await page.waitForTimeout(300);
m = await lage();
check('KRITISCH: endet die Ortung, verschwindet der Pfeil sofort -- ohne ihn wartete er 30 s auf eine Uhr, die steht',
  m.pfeilDa === false);

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
