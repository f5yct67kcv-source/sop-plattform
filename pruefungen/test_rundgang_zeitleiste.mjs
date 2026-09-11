// Der Reiter "Kontrollpunkte" der laufenden Runde als Zeitleiste (ENT-541).
//
// Anlass: ein Bildschirmfoto des Projektinhabers -- Zustandszeile, Name der
// Runde, Zeitfenster, Fortschrittsbalken, darunter Zaehler und verbleibende
// Zeit; die Punkte als eine Karte mit Uhrzeit links, Kennzeichen rechts und
// genau einer hervorgehobenen Zeile. Vier Punkte hat er vorab einzeln
// entschieden (2026-09-11):
//
//   1. Knoepfe zeigt nur, wer sie braucht -- der naechste Punkt. Die
//      uebrigen Zeilen klappen beim Antippen auf. KEINE erzwungene
//      Reihenfolge: zugeklappt heisst erreichbar, nicht gesperrt.
//   2. Rechts unter dem Balken steht eine MESSUNG ("noch 49 min"), kein
//      Urteil ("im Rahmen"). Fuer ein Urteil gibt es keine Regel.
//   3. Der Kopf nennt Name der Runde und Zeitfenster -- beides liefert der
//      Server seit ENT-541 mit.
//   4. Keine zweite Knopfzeile ueber der Reiterleiste.
//
// Was hier besonders genau geprueft wird, weil es leicht kippt:
//  - Die Rechnung der Restzeit ueber Mitternacht. Eine Nachtrunde laeuft
//    22:00-02:00; ohne Umbruch stuende dort "noch -1260 min".
//  - Dass "kein Zeitfenster hinterlegt" NICHT wie "keine Zeit mehr" und
//    nicht wie eine leere Zeile aussieht (CLAUDE.md, wichtigste Regel).
//  - Dass eine zugeklappte Zeile ihre ENTFERNUNG trotzdem zeigt. Sie
//    beantwortet "wohin als naechstes" -- dafuer darf man nicht erst
//    tippen muessen.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { GOOGLE_MAPS_MOCK } from './google_maps_mock.mjs';
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const OFFEN   = readFileSync(`${WURZEL}/backend/api/mein_rundgang_offen.php`, 'utf8');
const STARTEN = readFileSync(`${WURZEL}/backend/api/mein_rundgang_starten.php`, 'utf8');
const SPONTAN = readFileSync(`${WURZEL}/backend/api/mein_rundgang_spontan_starten.php`, 'utf8');

const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const tag = n => iso(new Date(Date.now() + n * 864e5));
// Uhrzeiten relativ zu JETZT -- ein fester Wert kippte beim Tageswechsel
// und, schlimmer, machte die Restzeit von der Laufzeit der Suite abhaengig.
const uhr = minVerschoben => {
  const d = new Date(Date.now() + minVerschoben * 60000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:00`;
};
const stempel = minVorher => {
  const d = new Date(Date.now() - minVorher * 60000);
  return `${tag(0)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:00`;
};

// ══════════ DER SERVER LIEFERT NAME UND ZEITFENSTER ══════════════════
// Ohne diese drei Felder bliebe der Kopf leer -- und zwar still.
check('KRITISCH: der Wiedereinstieg liefert Name und Zeitfenster der Runde mit',
  /\$rundgang\['vorlage_name'\]/.test(OFFEN)
  && /\$rundgang\['fenster_von'\]/.test(OFFEN)
  && /\$rundgang\['fenster_bis'\]/.test(OFFEN));
check('KRITISCH: ohne gewaehlte Kontrollrunde bleiben sie null statt zu fehlen',
  /\$rundgang\['vorlage_name'\] = null;/.test(OFFEN));
check('KRITISCH: auch der geplante Start liefert sie mit',
  /'vorlage_name' => \$vorlageName/.test(STARTEN)
  && /'fenster_von' => \$fensterVon/.test(STARTEN));
check('KRITISCH: und der spontane Start ebenso -- sonst haette dieselbe Runde je nach Einstieg einen Kopf oder keinen',
  /'vorlage_name' => \$v\['name'\]/.test(SPONTAN)
  && /'fenster_bis' => \$v\['fenster_bis'\]/.test(SPONTAN));

// ══════════ TESTDATEN ════════════════════════════════════════════════
// Fuenf erfasste Punkte (darunter ein Ersatzscan), ein naechster mit
// Aufgabe, zwei spaetere. Punkt 8 liegt GENAU auf der vorgetaeuschten
// Position -- an ihm wird geprueft, dass "ich stehe davor" die Knoepfe
// holt, auch wenn der Punkt nicht an der Reihe ist.
const RUNDE = () => ({
  id: 951, status: 'laeuft', pausiert_seit: null,
  vorbereitet_am: stempel(41), pause_minuten: 0,
  vorlage_name: 'Runde Nacht A',
  fenster_von: uhr(-60), fenster_bis: uhr(49),
  objekt: { id: 7, name: 'Musterobjekt Ost', strasse: 'Musterweg 4', ort: '9999 Musterdorf' },
  kunde_name: 'Musterliegenschaften AG', ansprechpartner: [], zentrale: null,
  kontrollpunkte: [
    { id: 1, bezeichnung: 'Eingang Nord', reihenfolge: 1, typ: 'nfc', lat: null, lng: null,
      geofence_radius_m: null, aufgaben: [],
      erledigt: { status: 'bestaetigt', erfasst_am: stempel(38), beschreibung: null } },
    { id: 2, bezeichnung: 'Lager B', reihenfolge: 2, typ: 'nfc', lat: null, lng: null,
      geofence_radius_m: null, aufgaben: [],
      erledigt: { status: 'bestaetigt', erfasst_am: stempel(30), beschreibung: null } },
    { id: 3, bezeichnung: 'Parkdeck 2', reihenfolge: 3, typ: 'geofence', lat: 47.3500, lng: 7.9000,
      geofence_radius_m: 25, aufgaben: [],
      erledigt: { status: 'bestaetigt', erfasst_am: stempel(22), beschreibung: null } },
    { id: 4, bezeichnung: 'Technikraum', reihenfolge: 4, typ: 'nfc', lat: null, lng: null,
      geofence_radius_m: null, aufgaben: [],
      erledigt: { status: 'bestaetigt', erfasst_am: stempel(14), beschreibung: null } },
    { id: 5, bezeichnung: 'Tor 3', reihenfolge: 5, typ: 'nfc', lat: null, lng: null,
      geofence_radius_m: null, aufgaben: [],
      erledigt: { status: 'ersatzscan', erfasst_am: stempel(5), beschreibung: 'Chip zerstoert' } },
    { id: 6, bezeichnung: 'Buero EG', reihenfolge: 6, typ: 'geofence', lat: 47.3580, lng: 7.9000,
      geofence_radius_m: 20, erledigt: null,
      aufgaben: [{ id: 11, bezeichnung: 'Fenster pruefen', information: null, erledigt: null }] },
    { id: 7, bezeichnung: 'Rampe Sued', reihenfolge: 7, typ: 'nfc', lat: null, lng: null,
      geofence_radius_m: null, erledigt: null, aufgaben: [] },
    { id: 8, bezeichnung: 'Schlussrunde', reihenfolge: 8, typ: 'geofence',
      lat: 47.3500, lng: 7.9000, geofence_radius_m: 25, erledigt: null, aufgaben: [] },
    // Punkt 9 ist WEIT weg und nicht an der Reihe -- die einzige Zeile, an
    // der sich pruefen laesst, dass eine ZUGEKLAPPTE Zeile ihre Entfernung
    // trotzdem zeigt. Ohne ihn blieb diese Pruefung eine Behauptung: Die
    // Gegenprobe (Entfernung nur noch aufgeklappt) wurde nicht rot, weil
    // jede geofence-Zeile in den Daten ohnehin aufgeklappt war.
    { id: 9, bezeichnung: 'Nebentor', reihenfolge: 9, typ: 'geofence',
      lat: 47.3580, lng: 7.9000, geofence_radius_m: 20, erledigt: null, aufgaben: [] },
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

async function seite(breite = 390) {
  const page = await browser.newPage({
    viewport: { width: breite, height: 844 }, deviceScaleFactor: 2,
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
  await page.waitForTimeout(1500);
  await page.click('#rgsRt-punkte'); await page.waitForTimeout(600);
  return page;
}

const page = await seite(390);

// ══════════ KOPFBLOCK: GEMESSEN, NICHT NACHGELESEN ═══════════════════
const kopf = await page.evaluate(() => {
  const g = s => { const e = document.querySelector(s); if (!e) return null;
    const r = e.getBoundingClientRect(); const c = getComputedStyle(e);
    return { t: r.top, b: r.bottom, l: r.left, w: r.width, h: r.height,
             fs: parseFloat(c.fontSize), tx: e.textContent.trim() }; };
  const bahn = document.querySelector('.rgp-balken');
  const fuellung = document.querySelector('.rgp-balken > span');
  return {
    lage: g('#rgpLage'), uhr: g('#rgsTimer'), name: g('#rgpName'),
    fenster: g('#rgpFenster'), zahl: g('#rgsZaehler'), rest: g('#rgpRest'),
    anteil: (bahn && fuellung)
      ? Math.round(fuellung.getBoundingClientRect().width / bahn.getBoundingClientRect().width * 100) : null,
    balkenOben: bahn ? bahn.getBoundingClientRect().top : null,
  };
});

// Ohne diese Pruefung liefen alle folgenden auf null und meldeten
// irrefuehrend "rot", statt "nicht vorhanden".
for (const [nm, el] of [['Zustandszeile', kopf.lage], ['Laufzeit', kopf.uhr],
                        ['Name der Runde', kopf.name], ['Zeitfenster', kopf.fenster],
                        ['Zaehler', kopf.zahl], ['Restzeit', kopf.rest]]) {
  check(`Bauteil vorhanden: ${nm}`, !!el);
}
check('KRITISCH: die Zustandszeile sagt, dass die Runde laeuft',
  /Rundgang läuft/.test(kopf.lage?.tx || ''));
check('KRITISCH: der Name der Runde steht da -- an einem Objekt mit mehreren Runden der einzige Unterschied',
  (kopf.name?.tx || '') === 'Runde Nacht A');
check('KRITISCH: das Zeitfenster steht darunter',
  /Zeitfenster \d{2}:\d{2}–\d{2}:\d{2}/.test(kopf.fenster?.tx || ''));
check('KRITISCH: der Zaehler nennt BEIDE Zahlen und die Einheit (CLAUDE.md: keine Zahl ohne Bezug)',
  /5\D+9\D*Kontrollpunkten/.test((kopf.zahl?.tx || '').replace(/\s+/g, ' ')));
check('KRITISCH: rechts steht eine Messung, kein Urteil ueber das Tempo',
  /^noch \d+ min$/.test(kopf.rest?.tx || ''));
// Der Balken ist der einzige Teil, den man nur MESSEN kann: Eine
// CSS-Breite, die nicht ankommt, faellt im Quelltext nicht auf.
check('KRITISCH: der Balken zeigt tatsaechlich den Anteil der erledigten Punkte (5 von 9 = 56 %)',
  kopf.anteil !== null && Math.abs(kopf.anteil - 56) <= 2);
// Aufbau: Ueberschrift oben, Wert darunter -- nie umgekehrt (CLAUDE.md).
check('Zustand steht ueber dem Namen, der Name ueber dem Zeitfenster',
  kopf.lage.t < kopf.name.t && kopf.name.t < kopf.fenster.t
  && kopf.fenster.t < kopf.balkenOben);
check('Der Name ist die groesste Schrift im Kopf, nicht die Zustandszeile',
  kopf.name.fs > kopf.lage.fs && kopf.name.fs >= 20);
// Zahl und Restzeit sind ein Paar -- gleiche Groesse, gleiche Grundlinie.
check('KRITISCH: Zaehler und Restzeit stehen auf derselben Zeile und in derselben Groesse (gleiches Muster auf beiden Seiten)',
  Math.abs(kopf.zahl.t - kopf.rest.t) <= 1 && kopf.zahl.fs === kopf.rest.fs);
check('Die Restzeit steht rechtsbuendig am Rand, nicht irgendwo in der Mitte',
  Math.abs((kopf.rest.l + kopf.rest.w) - (kopf.zahl.l + 358)) <= 2);

// ══════════ DIE LISTE ALS ZEITLEISTE ═════════════════════════════════
const zeilen = await page.evaluate(() => [...document.querySelectorAll('#rdListe .rd-zeile')].map(z => ({
  bez: (z.querySelector('.rd-bez') || {}).textContent,
  zeit: ((z.querySelector('.rd-zeit') || {}).textContent || '').trim(),
  marke: ((z.querySelector('.rd-marke') || {}).textContent || '').trim(),
  meta: ((z.querySelector('.rd-meta') || {}).textContent || '').trim(),
  ort: ((z.querySelector('.rd-ort') || {}).textContent || '').trim(),
  knoepfe: z.querySelectorAll('.rd-akt button').length,
  jetzt: z.classList.contains('rd-jetzt'),
  hoehe: z.getBoundingClientRect().height,
  kopfHoehe: (z.querySelector('.rd-kopf, .rd-fertig') || z).getBoundingClientRect().height,
  text: z.textContent,
})));

check('Alle neun Punkte stehen in der Liste, in ihrer Reihenfolge', zeilen.length === 9
  && zeilen[0].bez === 'Eingang Nord' && zeilen[8].bez === 'Nebentor');
check('KRITISCH: erledigte Punkte tragen ihre Uhrzeit in der Zeitspalte -- sie IST der Nachweis',
  zeilen.slice(0, 5).every(z => /^\d{2}:\d{2}$/.test(z.zeit)));
check('KRITISCH: das Kennzeichen rechts nennt bei erledigten Punkten, WIE der Nachweis zustande kam',
  zeilen[0].marke === 'NFC' && zeilen[2].marke === 'Geofence' && zeilen[4].marke === 'Ersatzscan');
check('KRITISCH: der gruene Haken allein reicht nicht -- das Statuswort steht (unsichtbar) daneben',
  /Bestätigt/.test(zeilen[0].text) && !/Bestätigt/.test(zeilen[4].text));
check('Der Ersatzscan ist als solcher erkennbar, nicht als gewoehnliche Bestaetigung',
  /Ersatzscan/.test(zeilen[4].text));

// ══════════ GENAU EINE ZEILE IST "JETZT" ═════════════════════════════
check('KRITISCH: genau ein Punkt ist als naechster ausgewiesen',
  zeilen.filter(z => z.jetzt).length === 1 && zeilen[5].jetzt);
check('Der naechste Punkt traegt einen Pfeil statt eines Strichs', zeilen[5].zeit === '→');
check('Spaetere Punkte tragen einen Strich -- kein leeres Feld, das wie ein Fehler aussieht',
  zeilen[6].zeit === '–');
check('KRITISCH: die Aufgabe am naechsten Punkt steht da, bevor man hingeht',
  /Aufgabe: Fenster pruefen/.test(zeilen[5].meta));

// ══════════ KNOEPFE NUR, WO SIE GEBRAUCHT WERDEN ═════════════════════
check('KRITISCH: der naechste Punkt zeigt seine drei Knoepfe', zeilen[5].knoepfe === 3);
check('KRITISCH: wer IM BEREICH eines spaeteren Punktes steht, bekommt dessen Knoepfe ohne Zutun',
  zeilen[7].knoepfe === 3 && /Du bist im Bereich/.test(zeilen[7].ort));
check('KRITISCH: die uebrigen Zeilen bleiben ruhig -- keine Knoepfe',
  zeilen[6].knoepfe === 0);
check('KRITISCH: eine zugeklappte NFC-Zeile sagt trotzdem, warum hier kein Scan geht',
  /NFC wird auf diesem Gerät nicht unterstützt/.test(zeilen[6].text));
// Die Entfernung beantwortet "wohin als naechstes". Dafuer darf man nicht
// erst aufklappen muessen -- sonst waere die ruhige Liste eine stumme.
check('KRITISCH: eine zugeklappte Geofence-Zeile zeigt trotzdem ihre Entfernung',
  zeilen[8].knoepfe === 0 && /^noch \d+ m$/.test(zeilen[8].ort));
// Zugeklappt heisst erreichbar. Eine erzwungene Reihenfolge waere eine
// fachliche Aenderung -- und eine Sperre in der Oberflaeche waere ohnehin
// keine (CLAUDE.md: Sperren gehoeren in den Server).
await page.click('#rdKopf7');
await page.waitForTimeout(250);
check('KRITISCH: ein Tipp auf die Zeile bringt die Knoepfe -- der Punkt ist nicht gesperrt, nur ruhig',
  await page.evaluate(() => document.querySelectorAll('#rdListe .rd-zeile')[6]
    .querySelectorAll('.rd-akt button').length === 2));
check('Und der Zustand steht auch fuer Hilfsmittel da (aria-expanded)',
  await page.getAttribute('#rdKopf7', 'aria-expanded') === 'true');
await page.click('#rdKopf7');
await page.waitForTimeout(250);
check('Ein zweiter Tipp klappt sie wieder zu',
  await page.evaluate(() => document.querySelectorAll('#rdListe .rd-zeile')[6]
    .querySelectorAll('.rd-akt button').length === 0));

// ══════════ GESTALTUNG, GEMESSEN ═════════════════════════════════════
const mass = await page.evaluate(() => {
  const zeit = [...document.querySelectorAll('#rdListe .rd-zeit')]
    .map(e => Math.round(e.getBoundingClientRect().right));
  const bez = [...document.querySelectorAll('#rdListe .rd-bez')]
    .map(e => Math.round(e.getBoundingClientRect().left));
  const ort = document.querySelector('#rdListe .rd-ort');
  const ersteBez = document.querySelector('#rdListe .rd-bez');
  return {
    zeitSpalten: new Set(zeit).size, bezSpalten: new Set(bez).size,
    ortFluchtet: (ort && ersteBez)
      ? Math.abs(ort.getBoundingClientRect().left - ersteBez.getBoundingClientRect().left) : 99,
    koepfe: [...document.querySelectorAll('#rdListe .rd-kopf, #rdListe .rd-fertig')]
      .map(e => e.getBoundingClientRect().height),
    quer: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  };
});
check('KRITISCH: die Zeitspalte fluchtet ueber alle Zeilen -- sonst liest die Liste sich nicht als Leiste',
  mass.zeitSpalten === 1);
check('Und die Bezeichnungen fluchten ebenso', mass.bezSpalten === 1);
check('Die Entfernungszeile fluchtet mit dem Text darueber, nicht mit der Zeitspalte',
  mass.ortFluchtet <= 2);
check('KRITISCH: jede antippbare Zeile ist mindestens 44px hoch (CLAUDE.md)',
  mass.koepfe.length === 9 && mass.koepfe.every(h => h >= 44));
check('KRITISCH: kein waagrechter Seiten-Scroll bei 390px', mass.quer === false);
await page.screenshot({ path: `${OUT}/zeitleiste-01-390.png`, fullPage: true });

// Handy-Aenderung zusaetzlich am Desktop pruefen (CLAUDE.md) und umgekehrt.
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(300);
check('KRITISCH: am Desktop kein waagrechter Seiten-Scroll', await page.evaluate(() =>
  document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
check('Der Kopfblock bleibt am Desktop in der App-Breite',
  await page.evaluate(() => {
    const k = document.getElementById('rgpKopf');
    const s = document.getElementById('rgSeite');
    return !!k && !!s && k.getBoundingClientRect().width <= s.getBoundingClientRect().width + 1;
  }));
await page.setViewportSize({ width: 320, height: 640 });
await page.waitForTimeout(300);
check('KRITISCH: auch auf dem schmalsten Geraet kein waagrechter Scroll', await page.evaluate(() =>
  document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
await page.close();

// ══════════ DIE RECHNUNG DER RESTZEIT ════════════════════════════════
// Direkt an der Funktion, mit gestellter Uhr: Die Faelle, die kippen,
// treten sonst nur zu bestimmten Tageszeiten auf -- eine Pruefung, die nur
// nachts rot wird, ist keine.
const rechner = await seite(390);
const rest = await rechner.evaluate(tagHeute => {
  const stelleUhr = hhmm => { window.jetztDatetime = () => `${tagHeute} ${hhmm}:00`; };
  const messe = (von, bis, jetzt) => {
    rundgangAktiv.fenster_von = von; rundgangAktiv.fenster_bis = bis;
    stelleUhr(jetzt);
    return { min: rgpRestMin(), txt: (rgpRestTxt() || {}).txt };
  };
  const e = {
    tags:        messe('14:00:00', '18:00:00', '17:11'),
    nachtVor:    messe('22:00:00', '02:00:00', '23:00'),   // vor Mitternacht
    nachtNach:   messe('22:00:00', '02:00:00', '01:30'),   // nach Mitternacht
    vorbei:      messe('14:00:00', '16:00:00', '16:40'),
    lang:        messe('20:00:00', '23:30:00', '20:15'),
    ohne:        messe(null, null, '12:00'),
  };
  return e;
}, tag(0));
check('KRITISCH: im Tagfenster stimmt die verbleibende Zeit auf die Minute',
  rest.tags.min === 49 && rest.tags.txt === 'noch 49 min');
check('KRITISCH: eine Nachtrunde ueber Mitternacht rechnet VOR Mitternacht richtig -- nicht "noch -1260 min"',
  rest.nachtVor.min === 180 && rest.nachtVor.txt === 'noch 3 h 00 min');
check('KRITISCH: und NACH Mitternacht ebenso',
  rest.nachtNach.min === 30 && rest.nachtNach.txt === 'noch 30 min');
check('KRITISCH: ein abgelaufenes Fenster sagt das, statt eine negative Zahl zu zeigen',
  rest.vorbei.min === -40 && rest.vorbei.txt === 'Zeitfenster vorbei');
check('Ueber einer Stunde wird in Stunden und Minuten geschrieben',
  rest.lang.txt === 'noch 3 h 15 min');
// Die wichtigste Regel des Hauses: vier verschiedene Aussagen, vier Texte.
check('KRITISCH: "kein Zeitfenster hinterlegt" ist eine eigene Auskunft -- nicht leer und nicht "vorbei"',
  rest.ohne.min === null && rest.ohne.txt === 'kein Zeitfenster'
  && rest.ohne.txt !== 'Zeitfenster vorbei');
await rechner.close();

// ══════════ RUNDE OHNE KONTROLLRUNDE ════════════════════════════════
const ohne = await browser.newPage({
  viewport: { width: 390, height: 844 }, permissions: ['geolocation'],
  geolocation: { latitude: 47.3500, longitude: 7.9000, accuracy: 8 } });
ohne.on('pageerror', e => bad.push('JS-Fehler (ohne Vorlage): ' + e.message));
await ohne.route('**/api/**', route => {
  const p = new URL(route.request().url()).pathname.split('/api/')[1];
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'm.muster', ist_admin: false });
  if (p.includes('meine_schichten')) return send(SCHICHTEN);
  if (p.includes('mein_profil')) return send(PROFIL);
  if (p.includes('rapport_list')) return send({ status: 'ok', rapporte: [] });
  if (p.includes('mein_rundgang_offen')) {
    const r = RUNDE(); r.vorlage_name = null; r.fenster_von = null; r.fenster_bis = null;
    return send({ status: 'ok', rundgang: r });
  }
  return send({ status: 'ok' });
});
await ohne.route('**maps.googleapis.com/**', route =>
  route.fulfill({ status: 200, contentType: 'application/javascript', body: GOOGLE_MAPS_MOCK }));
await ohne.goto(`file://${WURZEL}/app.html`);
await ohne.fill('#gName', 'm.muster'); await ohne.fill('#gPass', 'x'); await ohne.click('#gBtn');
await ohne.waitForSelector('.app.on'); await ohne.waitForTimeout(400);
await ohne.evaluate(() => ladeSchichten().then(() => rundgangFortsetzen(71)));
await ohne.waitForTimeout(1500);
await ohne.click('#rgsRt-punkte'); await ohne.waitForTimeout(500);
const o = await ohne.evaluate(() => ({
  name: (document.getElementById('rgpName') || {}).textContent,
  fenster: (document.getElementById('rgpFenster') || {}).textContent,
  rest: (document.getElementById('rgpRest') || {}).textContent,
}));
check('KRITISCH: ohne gewaehlte Kontrollrunde steht da, was die Runde IST -- keine leere Zeile',
  (o.name || '').trim() === 'Alle Kontrollpunkte');
check('KRITISCH: und "kein Zeitfenster" statt eines leeren Platzes -- "unbekannt" darf nie wie "keine" aussehen',
  (o.fenster || '').trim() === 'Ohne Zeitfenster' && (o.rest || '').trim() === 'kein Zeitfenster');
await ohne.close();

// ══════════ ABGEBROCHEN UND ABGESCHLOSSEN ════════════════════════════
const zu = await seite(390);
const nachAbbruch = await zu.evaluate(() => {
  rundgangAktiv.status = 'abgebrochen';
  rgLaufZeichnen();
  return {
    lage: (document.getElementById('rgpLage') || {}).textContent,
    rest: getComputedStyle(document.getElementById('rgpRest')).display,
    pfeile: document.querySelectorAll('#rdListe .rd-jetzt').length,
    knoepfe: document.querySelectorAll('#rdListe button').length,
  };
});
check('KRITISCH: eine abgebrochene Runde sagt das im Kopf -- im selben Muster wie die anderen Zustaende',
  /Rundgang abgebrochen/.test(nachAbbruch.lage || ''));
check('KRITISCH: dort steht keine Restzeit mehr -- "noch 49 min" waere eine Aufforderung ins Leere',
  nachAbbruch.rest === 'none');
check('KRITISCH: und kein Punkt ist mehr "der naechste" -- es geht keiner mehr hin',
  nachAbbruch.pfeile === 0);
check('KRITISCH: nach einem Abbruch gibt es keine Knoepfe in der Liste',
  nachAbbruch.knoepfe === 0);

const nachEnde = await zu.evaluate(() => {
  rundgangAktiv.status = 'laeuft';
  // Alle Punkte erfasst, aber der Server weiss es noch nicht (Funkloch).
  const jetzt = new Date();
  const p = n => String(n).padStart(2, '0');
  const am = `${jetzt.getFullYear()}-${p(jetzt.getMonth() + 1)}-${p(jetzt.getDate())} `
    + `${p(jetzt.getHours())}:${p(jetzt.getMinutes())}:00`;
  rundgangAktiv.kontrollpunkte.forEach(k => {
    if (!k.erledigt) { k.erledigt = { status: 'bestaetigt', erfasst_am: am, beschreibung: null }; } });
  rgLaufZeichnen();
  return { lage: (document.getElementById('rgpLage') || {}).textContent,
           zahl: (document.getElementById('rgsZaehler') || {}).textContent };
});
check('KRITISCH: eine offline vollstaendig abgelaufene Runde gilt als abgeschlossen -- Erfassung zaehlt, nicht Uebermittlung (ENT-321)',
  /Rundgang abgeschlossen/.test(nachEnde.lage || ''));
check('Und der Zaehler steht auf 9 von 9',
  /9\D+9/.test((nachEnde.zahl || '').replace(/\s+/g, ' ')));
await zu.close();

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
