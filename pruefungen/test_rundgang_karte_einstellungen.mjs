// Das Einstellungsblatt der Karte (ENT-640).
//
// Anlass, Projektinhaber mit vier Bildschirmfotos und einem Vergleich mit
// Coredinate: „Ich möchte den Bereich sinnvoll und innovativ verändern.
// Die Tag/Ansicht soll in einen Einstellungsbereich wandern (Zahnrad oben
// rechts evtl), da hinein soll auch die Funktion, dass der Bildschirm ON
// bleibt. Ebenso ist es sehr sinnvoll wie bei Coredinate, GPS nach
// Entfernung zu filtern und auch besuchte auszublenden. [...] Also
// Nachtsicht oder Satellit."
//
// Vier Entscheidungen, die diese Suite absichert, weil sie gegen den
// naheliegenden Weg gehen:
//
//  1. Das Kartenbild ist EINE Wahl mit drei Zustaenden, kein Satz
//     Umschalter. „Nachtsicht + Satellit" gibt es nicht, weil ein
//     Farbschema an einem Luftbild nichts faerbt -- das waere ein Schalter,
//     der nichts tut.
//  2. Das Luftbild endet mit der Runde. Es ist bei Tag aufgenommen und
//     bleibt auch nachts hell; genau dagegen gibt es die Nachtsicht
//     (ENT-331). Gemerkt wuerde es jede folgende Nachtrunde blenden.
//  3. „Besuchte ausblenden" verschont Punkte mit offener Aufgabe (ENT-305)
//     und nennt, wie viele es ausblendet.
//  4. „Nach Entfernung sortieren" aendert nur die ANSICHT. Der Pfeil
//     „naechster Kontrollpunkt" (ENT-541) bleibt an seinem planmaessigen
//     Punkt und wandert bloss mit -- er springt nicht auf den
//     naechstgelegenen um.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { GOOGLE_MAPS_MOCK } from './google_maps_mock.mjs';
import { chromium } from 'playwright';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);
// Kurze Frist statt 30 Sekunden ins Leere: In einer Gegenprobe fehlt das
// Ziel regelmaessig, und eine abgestuerzte Suite meldet gar nichts.
const klick = async (page, s) => { try { await page.click(s, { timeout: 2500 }); return true; }
                                   catch (e) { return false; } };

const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const tag = n => iso(new Date(Date.now() + n * 864e5));
const uhr = m => { const d = new Date(Date.now() + m * 60000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:00`; };

const ORT = { lat: 47.3500, lng: 7.9000 };

/* Die Punkte sind so gewaehlt, dass Sortierung und Ausblenden sich nicht
   gegenseitig verdecken:
     1 Eingang Nord  erledigt, KEINE offene Aufgabe  -> wird ausgeblendet
     2 Lager B       offen, rund 1.1 km              -> der planmaessig naechste
     3 Nahpunkt      offen, rund 56 m                -> der naechstgelegene
     4 Tor NFC       offen, ohne Koordinaten         -> ans Ende der Sortierung
     5 Rampe         erledigt, MIT offener Aufgabe   -> bleibt trotz Ausblenden
   Der Unterschied zwischen 2 und 3 ist der Kern: Sortiert steht 3 oben,
   der Pfeil gehoert trotzdem 2. */
const PUNKTE = () => ([
  { id: 1, bezeichnung: 'Eingang Nord', reihenfolge: 1, typ: 'geofence',
    lat: 47.3560, lng: 7.9000, geofence_radius_m: 20, aufgaben: [],
    erledigt: { status: 'bestaetigt', erfasst_am: `${tag(0)} ${uhr(-30)}` } },
  { id: 2, bezeichnung: 'Lager B', reihenfolge: 2, typ: 'geofence',
    lat: 47.3600, lng: 7.9000, geofence_radius_m: 20, erledigt: null, aufgaben: [] },
  { id: 3, bezeichnung: 'Nahpunkt', reihenfolge: 3, typ: 'geofence',
    lat: 47.3505, lng: 7.9000, geofence_radius_m: 20, erledigt: null, aufgaben: [] },
  { id: 4, bezeichnung: 'Tor NFC', reihenfolge: 4, typ: 'nfc',
    lat: null, lng: null, geofence_radius_m: null, erledigt: null, aufgaben: [] },
  { id: 5, bezeichnung: 'Rampe', reihenfolge: 5, typ: 'geofence',
    lat: 47.3620, lng: 7.9000, geofence_radius_m: 20,
    erledigt: { status: 'bestaetigt', erfasst_am: `${tag(0)} ${uhr(-20)}` },
    aufgaben: [{ id: 9, bezeichnung: 'Türe prüfen', information: null, erledigt: null }] },
]);

const RUNDE = () => ({
  id: 951, status: 'laeuft', pausiert_seit: null,
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
await page.waitForTimeout(1600);
await klick(page, '#rgsRt-karte'); await page.waitForTimeout(800);

// ══════════ DAS ZAHNRAD OEFFNET UND SCHLIESST ═════════════════════════
check('KRITISCH: die Karte traegt ein Zahnrad',
  await page.evaluate(() => !!document.getElementById('rgsEinstKnopf')));
check('KRITISCH: das Blatt ist zu, solange niemand es oeffnet',
  await page.evaluate(() => document.getElementById('rgsEinst').hidden === true));
/* Beim ersten Messlauf lag eine KARTENMARKE sichtbar ueber dem Blatt.
   Grund: Google gibt seinen Marken zweistellige z-index-Werte, und
   #rgsKarte bildete keinen eigenen Stapelkontext -- die Marken standen
   damit auf derselben Ebene wie die Bedienelemente daneben. Gemessen
   gefunden, nicht vermutet, und darum auch gemessen abgesichert: Was an
   der Stelle eines Bedienelements liegt, muss dieses Bedienelement sein. */
check('KRITISCH: keine Kartenmarke uebermalt das Zahnrad',
  await page.evaluate(() => {
    const r = document.getElementById('rgsEinstKnopf').getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!el && !!el.closest('#rgsEinstKnopf');
  }));
await klick(page, '#rgsEinstKnopf'); await page.waitForTimeout(300);
check('KRITISCH: ein Tipp aufs Zahnrad oeffnet das Blatt',
  await page.evaluate(() => {
    const e = document.getElementById('rgsEinst');
    return !e.hidden && e.getBoundingClientRect().height > 0;
  }));
check('KRITISCH: und keine Kartenmarke uebermalt das offene Blatt',
  await page.evaluate(() => {
    const b = document.querySelector('.rgs-einst-box').getBoundingClientRect();
    const punkte = [];
    for (let i = 1; i <= 8; i++) { punkte.push([b.left + b.width / 2, b.top + b.height * i / 9]); }
    return punkte.every(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      return !!el && !!el.closest('.rgs-einst');
    });
  }));
await page.screenshot({ path: `${OUT}/einst-01-offen.png` });

// Zwei der vier Einstellungen wirken auf die LISTE, nicht auf die Karte.
// Das Zahnrad sitzt trotzdem auf dem Kartenreiter (Entscheid des
// Projektinhabers) -- dann muss wenigstens dastehen, worauf sie wirken.
check('KRITISCH: die Listen-Schalter tragen eine Ueberschrift, die sie der Liste zuordnet',
  await page.evaluate(() => {
    const lbs = [...document.querySelectorAll('.rgs-einst-lb')].map(e => e.textContent.trim());
    const sort = document.getElementById('rgsEinstSort');
    if (!sort) { return false; }
    // Die Ueberschrift unmittelbar UEBER dem Schalter -- nicht irgendeine
    // im Blatt. Sonst bestuende die Pruefung auch, wenn sie ganz woanders
    // stuende.
    let e = sort.previousElementSibling;
    while (e && !e.classList.contains('rgs-einst-lb')) { e = e.previousElementSibling; }
    return lbs.length >= 3 && !!e && /liste/i.test(e.textContent);
  }));
check('Alle vier Einstellungen stehen im Blatt',
  await page.evaluate(() => ['rgsKb-nacht', 'rgsEinstSort', 'rgsEinstBesucht', 'rgsEinstWach']
    .every(id => !!document.getElementById(id))));

// ══════════ KARTENBILD: EINE WAHL, DREI ZUSTAENDE ═════════════════════
const kartentyp = () => page.evaluate(() =>
  (document.getElementById('rgsKarte') || {}).dataset?.kartentyp || 'roadmap');
const kartenstil = () => page.evaluate(() =>
  (document.getElementById('rgsKarte') || {}).dataset?.kartenstil || null);
const aktiv = () => page.evaluate(() =>
  [...document.querySelectorAll('.rgs-seg-b')].filter(b => b.classList.contains('an')).map(b => b.id));

check('KRITISCH: genau eine Wahl ist aktiv, und es ist die Nachtsicht',
  JSON.stringify(await aktiv()) === JSON.stringify(['rgsKb-nacht']));

// Der Neubau-Zaehler: Nachtsicht kostet einen Kartenneubau (das Farbschema
// laesst sich nur beim Erzeugen setzen), das Luftbild NICHT. Das ist keine
// Feinheit -- ein Neubau kostet auf dem Geraet sichtbar Zeit.
const bauLauf = () => page.evaluate(() => rgsKarteBauLauf);
const vorSat = await bauLauf();
await klick(page, '#rgsKb-satellit'); await page.waitForTimeout(400);
check('KRITISCH: Satellit stellt die Karte wirklich auf ein Luftbild um (gemessen)',
  (await kartentyp()) === 'hybrid');
check('KRITISCH: und zwar OHNE die Karte neu zu bauen',
  (await bauLauf()) === vorSat);
check('KRITISCH: das Luftbild traegt Beschriftungen — im Revier zaehlen die Strassennamen',
  (await kartentyp()) === 'hybrid');   // 'satellite' waere ohne Namen
check('Nur noch Satellit ist aktiv — die Nachtsicht nicht mehr',
  JSON.stringify(await aktiv()) === JSON.stringify(['rgsKb-satellit']));
check('KRITISCH: dabei steht der Hinweis, dass das Luftbild auch nachts hell bleibt',
  await page.evaluate(() => {
    const t = document.getElementById('rgsKbSatTxt');
    return !!t && /hell/i.test(t.textContent) && /Runde/i.test(t.textContent);
  }));
await page.screenshot({ path: `${OUT}/einst-02-satellit.png` });

// Zurueck auf Tagansicht: DAS kostet einen Neubau -- und das Blatt muss ihn
// ueberleben, sonst faende sich der Waechter nach jedem Tippen wieder auf
// der Karte und muesste das Zahnrad erneut suchen.
const vorTag = await bauLauf();
await klick(page, '#rgsKb-tag'); await page.waitForTimeout(600);
check('KRITISCH: die Tagansicht macht die Karte wirklich hell (gemessen)',
  (await kartenstil()) === 'standard');
check('Das Luftbild ist dabei abgeraeumt',
  (await kartentyp()) === 'roadmap');
check('KRITISCH: ein Wechsel des Farbschemas baut die Karte neu — anders geht es nicht',
  (await bauLauf()) > vorTag);
check('KRITISCH: das Einstellungsblatt ueberlebt diesen Neubau',
  await page.evaluate(() => {
    const e = document.getElementById('rgsEinst');
    return !!e && e.hidden === false && !!document.getElementById('rgsKb-tag');
  }));

// Das Blatt gehoert zur Karte: Wer den Reiter wechselt, legt es weg.
await klick(page, '#rgsRt-punkte'); await page.waitForTimeout(400);
await klick(page, '#rgsRt-karte'); await page.waitForTimeout(800);
check('KRITISCH: nach einem Reiterwechsel ist das Blatt zu — es verdeckt die Karte nicht, auf die man schauen wollte',
  await page.evaluate(() => {
    const e = document.getElementById('rgsEinst');
    return !!e && e.hidden === true;
  }));
await klick(page, '#rgsEinstKnopf'); await page.waitForTimeout(300);

// ══════════ DAS LUFTBILD ENDET MIT DER RUNDE, DIE NACHTSICHT NICHT ════
await klick(page, '#rgsKb-satellit'); await page.waitForTimeout(400);
check('Ausgangslage: Satellit ist gewaehlt und die Tagansicht gespeichert',
  (await kartentyp()) === 'hybrid'
  && await page.evaluate(() => localStorage.getItem('sop_rundgang_nachtsicht') === 'aus'));
const nachNeustart = await page.evaluate(async () => {
  rgSeiteZu();
  await new Promise(r => setTimeout(r, 300));
  rundgangFortsetzen(71);
  await new Promise(r => setTimeout(r, 1800));
  const el = document.getElementById('rgsKarte');
  return { satellit: rgsSatellit, typ: el ? el.dataset.kartentyp : null,
           stil: el ? el.dataset.kartenstil : null };
});
check('KRITISCH: das Luftbild ueberdauert die Runde NICHT — es wuerde sonst jede Nachtrunde blenden',
  nachNeustart.satellit === false && nachNeustart.typ !== 'hybrid');
check('KRITISCH: die Wahl hell/dunkel ueberdauert sie sehr wohl — sie ist Arbeitsgewohnheit, keine Blendgefahr',
  nachNeustart.stil === 'standard');
// Und zurueck auf die Vorgabe, damit die folgenden Pruefungen von der
// dokumentierten Ausgangslage ausgehen.
await klick(page, '#rgsRt-karte'); await page.waitForTimeout(800);
await klick(page, '#rgsEinstKnopf'); await page.waitForTimeout(300);
await klick(page, '#rgsKb-nacht'); await page.waitForTimeout(600);

// ══════════ DIE LISTE: SORTIEREN UND AUSBLENDEN ═══════════════════════
const liste = () => page.evaluate(() => ({
  zeilen: [...document.querySelectorAll('#rdListe .rd-zeile .rd-bez')].map(e => e.textContent.trim()),
  jetzt: (document.querySelector('#rdListe .rd-jetzt .rd-bez') || {}).textContent?.trim() || null,
  versteckt: (document.getElementById('rdVersteckt') || {}).textContent?.trim() || null,
}));

await klick(page, '#rgsEinstX'); await page.waitForTimeout(200);
await klick(page, '#rgsRt-punkte'); await page.waitForTimeout(600);
const vorher = await liste();
check('Ausgangslage: die Liste steht in der Reihenfolge der Runde, vollstaendig',
  JSON.stringify(vorher.zeilen) === JSON.stringify(
    ['Eingang Nord', 'Lager B', 'Nahpunkt', 'Tor NFC', 'Rampe']));
check('Ausgangslage: der Pfeil steht am ersten offenen Punkt der Runde',
  vorher.jetzt === 'Lager B');
check('Ausgangslage: nichts ist ausgeblendet, und es steht auch nichts davon da',
  vorher.versteckt === null);

const schalter = async (id) => {
  await klick(page, '#rgsRt-karte'); await page.waitForTimeout(700);
  await klick(page, '#rgsEinstKnopf'); await page.waitForTimeout(250);
  await klick(page, id); await page.waitForTimeout(250);
  await klick(page, '#rgsEinstX'); await page.waitForTimeout(150);
  await klick(page, '#rgsRt-punkte'); await page.waitForTimeout(500);
};

await schalter('#rgsEinstSort');
const sortiert = await liste();
check('KRITISCH: nach Entfernung sortiert steht der naechstgelegene Punkt oben',
  sortiert.zeilen[0] === 'Nahpunkt');
check('KRITISCH: der Pfeil bleibt trotzdem am planmaessig naechsten Punkt — er springt nicht mit',
  sortiert.jetzt === 'Lager B');
check('KRITISCH: Punkte ohne Koordinaten stehen am Ende — nicht irgendwo dazwischen',
  sortiert.zeilen[sortiert.zeilen.length - 1] === 'Tor NFC');
check('KRITISCH: es verschwindet dabei kein Punkt — sortieren ist nicht filtern',
  sortiert.zeilen.length === vorher.zeilen.length);
check('Die Wahl bleibt auf dem Geraet',
  await page.evaluate(() => localStorage.getItem('sop_rundgang_sortnah')) === 'an');

await schalter('#rgsEinstBesucht');
const gefiltert = await liste();
check('KRITISCH: ein erfasster Punkt ohne offene Aufgabe wird ausgeblendet',
  !gefiltert.zeilen.includes('Eingang Nord'));
check('KRITISCH: ein erfasster Punkt MIT offener Aufgabe bleibt stehen (ENT-305)',
  gefiltert.zeilen.includes('Rampe'));
check('KRITISCH: es steht da, wie viele Zeilen fehlen — ausgeblendet darf nie wie nicht vorhanden aussehen',
  !!gefiltert.versteckt && /1/.test(gefiltert.versteckt));
check('Offene Punkte sind unangetastet',
  gefiltert.zeilen.includes('Lager B') && gefiltert.zeilen.includes('Nahpunkt')
  && gefiltert.zeilen.includes('Tor NFC'));
await page.screenshot({ path: `${OUT}/einst-03-liste.png` });

// Und wieder aus: Ein Schalter, der nur in eine Richtung geht, ist keiner.
await schalter('#rgsEinstBesucht');
const zurueck = await liste();
check('KRITISCH: ausgeschaltet sind alle Punkte wieder da',
  zurueck.zeilen.length === vorher.zeilen.length && zurueck.versteckt === null);
await schalter('#rgsEinstSort');
check('KRITISCH: und ohne Sortierung gilt wieder die Reihenfolge der Runde',
  JSON.stringify((await liste()).zeilen) === JSON.stringify(vorher.zeilen));

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
