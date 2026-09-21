// Die Blase am Kontrollpunkt und der Weg in die Navigation (ENT-654).
//
// Anlass: Der Projektinhaber mit zwei Bildschirmfotos des Wettbewerbers --
// ein Tipp auf eine Kartenmarke zeigt dort den Punkt samt Entfernung und
// oeffnet auf Wunsch die Navigation des Geraets. „Cooles Feature."
//
// Beim Nachsehen kam mehr heraus als die Blase:
//
//  1. Es GAB schon einen Routen-Knopf im Haus -- an der Objektadresse und
//     in den Schichtdetails. Beide zeigten woertlich auf google.com/maps.
//     Auf einem iPhone landet der Waechter damit in Safari oder in Google
//     Maps, nicht in Apple Karten. Das ist nicht, was im Vorbild passiert.
//  2. Ein Tipp auf die Marke TAT schon etwas: Er sprang in die Liste. Eine
//     Blase durfte das nicht ersatzlos wegnehmen.
//
// Geprueft wird darum beides, und die AUSSAGE, nicht der Wortlaut: dass
// die Adresse zur Plattform passt, dass beide Wege aus der Blase fuehren,
// dass die Blase die Anbieterleiste von Google nicht verdeckt, und dass
// sie auf einer pausierten Runde KEINE Entfernung nennt (ENT-648).
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { GOOGLE_MAPS_MOCK } from './google_maps_mock.mjs';
import { chromium } from 'playwright';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

/* Ein Klick auf etwas, das es nicht gibt oder das verdeckt ist, laeuft in
   Playwright 30 Sekunden ins Leere und reisst danach die ganze Suite mit.
   In einer Gegenprobe ist das der Normalfall -- und eine abgestuerzte
   Suite meldet KEINE rote Pruefung, sie meldet gar nichts. Genau das ist
   beim Bauen dieser Datei passiert, und vorher schon bei ENT-638,
   ENT-640 und ENT-647. Darum kurze Frist und ein Rueckgabewert. */
const klick = async (page, s, opt) => {
  try { await page.click(s, Object.assign({ timeout: 2500 }, opt || {})); return true; }
  catch (e) { return false; }
};
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const tag = n => iso(new Date(Date.now() + n * 864e5));

// Der eigene Standort liegt bewusst WEIT weg: So ist die Entfernung
// zweistellig in Kilometern und die Kilometer-Schreibweise wird
// mitgeprueft, ohne dass eine feste Zahl abgeschrieben wird.
const ORT = { lat: 47.3500, lng: 7.8900 };
const PUNKTE = () => ([
  { id: 1, bezeichnung: 'Tor Nord', reihenfolge: 1, erledigt: null, typ: 'geofence',
    lat: 47.3600, lng: 7.9000, geofence_radius_m: 20, aufgaben: [] },
  { id: 2, bezeichnung: 'Halle Ost', reihenfolge: 2, erledigt: null, typ: 'geofence',
    lat: 47.3620, lng: 7.9040, geofence_radius_m: 20, aufgaben: [] },
  // Ein Punkt ohne Koordinaten: Er hat keine Marke und darf auch keine
  // Blase bekommen -- Navigation zu einem Ort, den niemand kennt, gibt es
  // nicht.
  { id: 3, bezeichnung: 'Technikraum', reihenfolge: 3, erledigt: null, typ: 'nfc',
    lat: null, lng: null, geofence_radius_m: null, aufgaben: [] },
]);
const RUNDE = status => ({ status, einsatz_id: 71, rundgang_id: 5, name: 'Musterrunde',
  vorbereitet_am: tag(0) + ' 20:00:00',
  pausiert_seit: status === 'pausiert' ? tag(0) + ' 21:00:00' : null,
  kontrollpunkte: PUNKTE() });
const SCHICHTEN = { status: 'ok', von: tag(-30), bis: tag(90), schichten: [
  { id: 71, kunde_name: 'Musterliegenschaften AG', titel: 'Nachtwache', strasse: 'Musterweg 4',
    ort: '9999 Musterdorf', einsatzart: 'Revierdienst', sparte: 'sicherheit', datum: tag(0),
    von: '20:00:00', bis: '06:00:00', status: 'bestaetigt', bemerkung: null, zusage: 'zugesagt',
    objekt_name: 'Musterobjekt', objekt_id: 7, hat_kontrollpunkte: true, im_team: 1 }] };
const PROFIL = { status: 'ok', monat: { anzahl: 0, stunden: 0 },
  profil: { name: 'm.muster', ist_admin: false, personalnummer: 'P-001',
    vorname: 'Max', nachname: 'Muster', erstellt_am: tag(-30) + ' 10:00:00' } };

const browser = await chromium.launch({ executablePath: browserPfad() });

async function seite(status, breite = 390, hoehe = 844) {
  const page = await browser.newPage({ viewport: { width: breite, height: hoehe }, deviceScaleFactor: 2,
    permissions: ['geolocation'], geolocation: { latitude: ORT.lat, longitude: ORT.lng, accuracy: 8 } });
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
  await page.route('**maps.googleapis.com/**', r =>
    r.fulfill({ status: 200, contentType: 'application/javascript', body: GOOGLE_MAPS_MOCK }));
  await page.goto(`file://${WURZEL}/app.html`);
  await page.fill('#gName', 'm.muster'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
  await page.waitForSelector('.app.on'); await page.waitForTimeout(400);
  await page.evaluate(() => ladeSchichten().then(() => rundgangFortsetzen(71)));
  await page.waitForTimeout(1800);
  await page.click('#rgsRt-karte'); await page.waitForTimeout(900);
  return page;
}

// Alles ueber die Blase am GERENDERTEN Zustand, nicht am Quelltext.
const blase = page => page.evaluate(() => {
  const b = document.getElementById('rgsBlase');
  if (!b) { return { da: false }; }
  const huelle = document.querySelector('.rgs-karte-huelle');
  const r = b.getBoundingClientRect(), h = huelle.getBoundingClientRect();
  const navi = document.getElementById('rgsBlaseNavi');
  const liste = document.getElementById('rgsBlaseListe');
  const x = b.querySelector('.rgs-blase-x');
  const zen = document.getElementById('rgsZentrieren');
  const pkt = document.getElementById('rgsPunkteZeigen');
  const hoehe = e => e ? e.getBoundingClientRect().height : null;
  return {
    da: true, offen: !b.hidden,
    text: (b.textContent || '').replace(/\s+/g, ' ').trim(),
    entf: (b.querySelector('.rgs-blase-entf') || {}).textContent || null,
    mut: (b.querySelector('.rgs-blase-mut') || {}).textContent || null,
    name: (b.querySelector('.rgs-blase-name') || {}).textContent || null,
    lb: (b.querySelector('.rgs-blase-lb') || {}).textContent || null,
    inHuelle: r.left >= h.left - 1 && r.right <= h.right + 1
      && r.top >= h.top - 1 && r.bottom <= h.bottom + 1,
    lufUnten: h.bottom - r.bottom,
    ueberKnoepfen: zen && pkt
      ? r.bottom <= zen.getBoundingClientRect().top + 1
        && r.bottom <= pkt.getBoundingClientRect().top + 1
      : false,
    naviH: hoehe(navi), listeH: hoehe(liste), xH: hoehe(x),
    xB: x ? x.getBoundingClientRect().width : null,
    href: navi ? navi.getAttribute('href') : null,
    ziel: navi ? navi.getAttribute('target') : null,
    rel: navi ? navi.getAttribute('rel') : null,
  };
});

// ══════════ DER WEG NACH DRAUSSEN: EINE STELLE, ZWEI PLATTFORMEN ══════
let page = await seite('laeuft');
const nav = await page.evaluate(() => {
  const mitPlattform = (name, f) => {
    const alt = window.Capacitor;
    window.Capacitor = { getPlatform: () => name };
    let r; try { r = f(); } finally {
      if (alt === undefined) { delete window.Capacitor; } else { window.Capacitor = alt; }
    }
    return r;
  };
  return {
    web: rgNavUrl('47.36,7.9'),
    ios: mitPlattform('ios', () => rgNavUrl('47.36,7.9')),
    android: mitPlattform('android', () => rgNavUrl('47.36,7.9')),
    adresse: mitPlattform('ios', () => rgNavUrl('Musterweg 4, 9999 Musterdorf')),
    leer: rgNavUrl(''),
    leer2: rgNavUrl(null),
  };
});
/* Geprueft wird, WOHIN die Adresse zeigt -- nicht, wie sie buchstabiert
   ist. Der Wirt entscheidet: Apple auf iOS, Google sonst. Ein Vergleich
   auf die ganze Zeichenkette waere eine Abschrift des Quelltextes. */
check('KRITISCH: auf dem iPhone fuehrt die Navigation zu Apple Karten',
  /^https:\/\/maps\.apple\.com\//.test(nav.ios || ''));
check('KRITISCH: auf Android und im Browser zu Google Maps',
  /^https:\/\/www\.google\.com\/maps\//.test(nav.android || '')
  && /^https:\/\/www\.google\.com\/maps\//.test(nav.web || ''));
check('KRITISCH: das Koordinatenpaar kommt als Ziel an, und das Komma bleibt lesbar',
  (nav.ios || '').includes('47.36,7.9') && (nav.android || '').includes('47.36,7.9'));
check('Eine Adresse geht denselben Weg -- der Routen-Knopf im Haus und die Blase teilen sich die Stelle',
  /^https:\/\/maps\.apple\.com\//.test(nav.adresse || '')
  && decodeURIComponent(nav.adresse || '').includes('Musterweg 4'));
check('KRITISCH: ohne Ziel gibt es keine Adresse -- ein Knopf ins Nichts ist schlimmer als keiner',
  nav.leer === '' && nav.leer2 === '');
/* Und der Routen-Knopf im Haus benutzt sie auch WIRKLICH. Ohne diese
   Pruefung koennte er weiterhin seine eigene Adresse bauen, und die
   Vereinheitlichung waere nur behauptet. */
const hausWege = await page.evaluate(() =>
  [...document.querySelectorAll('a[href*="maps."], a[href*="/maps"]')]
    .map(a => a.getAttribute('href')));
check('KRITISCH: kein Kartenlink im Wächterbereich baut seine Adresse noch selbst zusammen',
  hausWege.every(h => /^https:\/\/(maps\.apple\.com|www\.google\.com)\//.test(h || '')));

// ══════════ DIE BLASE: ZU, BIS JEMAND TIPPT ══════════════════════════
let b = await blase(page);
check('Vorbedingung: das Bauteil der Blase steht auf der Karte',
  b.da === true);
check('KRITISCH: ungetippt ist sie zu -- sie verdeckt nichts, solange niemand sie will',
  b.offen === false);

// Der Tipp auf die MARKE, nicht der Aufruf der Funktion: So wird der Weg
// vom Finger bis zur Blase mitgeprueft und nicht nur ihr Inhalt.
const getippt = await page.evaluate(() => {
  const m = [...document.querySelectorAll('.gm-mock-marker')].filter(e => e.dataset.zeichen);
  if (m.length < 2) { return { marken: m.length }; }
  m[1].click();
  return { marken: m.length };
});
await page.waitForTimeout(300);
check('Vorbedingung: die Karte traegt eine nummerierte Marke je Kontrollpunkt mit Koordinaten',
  getippt.marken === 2);
b = await blase(page);
check('KRITISCH: ein Tipp auf die Marke oeffnet die Blase',
  b.offen === true);
check('KRITISCH: und sie nennt den Punkt, der getippt wurde -- nicht irgendeinen',
  (b.name || '').includes('Halle Ost'));
check('Die Nummer steht als feine Ueberschrift ueber dem Namen (CLAUDE.md), im Singular',
  /^Kontrollpunkt #2$/.test((b.lb || '').trim()));

// ══════════ LAGE: SIE VERDECKT NICHTS, WAS BLEIBEN MUSS ══════════════
/* Die Anbieterleiste von Google (Kartendaten-Hinweis und Link auf die
   Nutzungsbedingungen) darf nach deren Bedingungen weder entfernt noch
   verdeckt werden -- dieselbe Auflage, aus der die beiden Kartenknoepfe
   seit ENT-355 ihre 28 px Abstand haben. Die Blase sitzt ueber ihnen und
   damit erst recht darueber. */
check('KRITISCH: die Blase bleibt innerhalb der Karte',
  b.inHuelle === true);
check('KRITISCH: sie haelt Abstand zur Anbieterleiste am unteren Rand',
  b.lufUnten >= 24);
check('KRITISCH: sie liegt ueber beiden Kartenknoepfen, statt sie zu verdecken',
  b.ueberKnoepfen === true);
check('KRITISCH: beide Knoepfe in der Blase halten 44 px Trefferflaeche (CLAUDE.md)',
  b.naviH >= 44 && b.listeH >= 44);
check('KRITISCH: auch das Schliessen-Kreuz haelt sie',
  b.xH >= 44 && b.xB >= 44);
/* Nichts darf ueber der Blase liegen. Die Marken der Karte tragen eigene
   Stapelwerte -- daran ist bei ENT-640 schon einmal etwas
   haengengeblieben, und dort fiel es nur beim MESSEN auf. */
const frei = await page.evaluate(() => {
  const treffer = s => {
    const e = document.querySelector(s);
    if (!e) { return null; }
    const r = e.getBoundingClientRect();
    const o = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!(o && (o === e || e.contains(o) || o.contains(e)));
  };
  return { navi: treffer('#rgsBlaseNavi'), liste: treffer('#rgsBlaseListe'),
           x: treffer('.rgs-blase-x') };
});
check('KRITISCH: nichts liegt ueber der Blase -- ihre drei Knoepfe sind tatsaechlich treffbar',
  frei.navi === true && frei.liste === true && frei.x === true);

// ══════════ DIE ENTFERNUNG IN DER BLASE ══════════════════════════════
check('KRITISCH: die Blase nennt die Entfernung zum Punkt',
  /^noch \d+(\.\d\d)? (m|km)$/.test((b.entf || '').trim()));
check('Und ueber einem Kilometer in Kilometern, wie in der Liste (ENT-638)',
  /km$/.test((b.entf || '').trim()));
check('KRITISCH: der Knopf fuehrt zu genau diesem Punkt und nach draussen',
  (b.href || '').includes('47.362,7.904') && b.ziel === '_blank'
  && /noopener/.test(b.rel || ''));

// ══════════ BEIDE WEGE, NICHT NUR EINER ══════════════════════════════
/* Vor ENT-654 fuehrte ein Tipp auf die Marke in die Liste. Die Blase
   ersetzt das nicht, sie macht es zur Wahl -- gemeldet wird weiterhin in
   der Liste. Geprueft wird die WIRKUNG: Nach dem Tipp steht der Waechter
   im Punkte-Reiter, und die Zeile des gewaehlten Punktes ist offen. */
check('KRITISCH: der Knopf "In der Liste zeigen" laesst sich ueberhaupt treffen',
  await klick(page, '#rgsBlaseListe'));
await page.waitForTimeout(500);
const drueben = await page.evaluate(() => ({
  reiter: rgsReiter,
  zeileDa: !!document.getElementById('rdZeile2'),
  offen: !!(document.getElementById('rdZeile2')
    && document.getElementById('rdZeile2').classList.contains('rd-auf')),
  blaseZu: document.getElementById('rgsBlase') === null
    || document.getElementById('rgsBlase').hidden,
}));
check('KRITISCH: "In der Liste zeigen" fuehrt in den Punkte-Reiter',
  drueben.reiter === 'punkte');
check('KRITISCH: und die Zeile des gewaehlten Punktes steht dort offen -- nicht irgendeine',
  drueben.zeileDa === true && drueben.offen === true);

// Zurueck auf die Karte: Die Blase darf nicht wieder offen dastehen.
await page.click('#rgsRt-karte'); await page.waitForTimeout(700);
b = await blase(page);
check('KRITISCH: nach dem Reiterwechsel ist die Blase zu -- sie gehoert zu der Marke, die eben getippt wurde',
  b.offen === false);

// ══════════ EIN TIPP NEBEN DIE MARKE LEGT SIE WEG ════════════════════
await page.evaluate(() => rgKarteBlaseAuf(1));
await page.waitForTimeout(250);
check('Vorbedingung: die Blase ist wieder offen', (await blase(page)).offen === true);
/* Ein ECHTER Klick auf die Kartenflaeche, kein von Hand ausgeloestes
   Ereignis: Nur so wird mitgeprueft, dass der Horcher ueberhaupt an der
   Karte haengt. Ein erster Entwurf rief hier das Ereignis selbst auf und
   hatte einen Rueckfall auf rgKarteBlaseZu() -- der haette die Pruefung
   stillschweigend entschaerft und waere gruen geblieben, auch wenn gar
   kein Horcher da ist.

   Oben links, weit weg von den Marken und ueber der Blase: Die
   Nachbildung laesst ein Klickereignis nur durch, wenn es die Flaeche
   selbst trifft (Marken halten es auf) -- genau wie die echte Karte. */
const STELLE = { x: 30, y: 200 };
const kartenTipp = await page.evaluate(s => {
  const el = document.getElementById('rgsKarte');
  const r = el.getBoundingClientRect();
  const ziel = document.elementFromPoint(r.left + s.x, r.top + s.y);
  return { trifftKarte: ziel === el };
}, STELLE);
/* Die Stelle ist mit Bedacht gewaehlt: Oben links liegen die Zahlen-Chips
   ueber der Karte, oben rechts das Zahnrad, unten die beiden Knoepfe und
   die Blase selbst. Der erste Anlauf tippte auf (30,30) und lief in die
   Chips -- die Suite stuerzte ab, statt rot zu werden. */
check('Vorbedingung: an der gewaehlten Stelle liegt die Kartenflaeche selbst -- sonst trifft der Tipp etwas anderes',
  kartenTipp.trifftKarte === true);
check('KRITISCH: die Kartenflaeche nimmt den Tipp ueberhaupt an',
  await klick(page, '#rgsKarte', { position: STELLE }));
await page.waitForTimeout(250);
check('KRITISCH: ein Tipp neben die Marken legt die Blase weg',
  (await blase(page)).offen === false);

// ══════════ PUNKTE OHNE KOORDINATEN HABEN KEINE BLASE ════════════════
await page.evaluate(() => rgKarteBlaseAuf(3));
await page.waitForTimeout(250);
b = await blase(page);
check('KRITISCH: ein Punkt ohne Koordinaten bekommt keine Blase -- es gibt nichts anzusteuern',
  b.offen === false);
await page.screenshot({ path: `${OUT}/blase-01-laufend.png` });
await page.close();

/* ══════════ SCHMAL UND BREIT ════════════════════════════════════════
   Die beiden Knoepfe stehen nebeneinander, und "Navigation oeffnen" und
   "In der Liste zeigen" sind lange deutsche Woerter. Auf dem schmalsten
   noch gebauten Handy (320 px) ist das der Engpass; CLAUDE.md verlangt
   ausserdem, jede Aenderung am Handy-Layout zusaetzlich am Schreibtisch
   zu pruefen. Beide Male dieselbe Aussage: Die Blase bleibt in der
   Karte, die Knoepfe behalten 44 px und stossen nicht ineinander. */
for (const [br, ho] of [[320, 568], [1280, 800]]) {
  const p2 = await seite('laeuft', br, ho);
  await p2.evaluate(() => rgKarteBlaseAuf(2));
  await p2.waitForTimeout(300);
  const m = await blase(p2);
  const knoepfe = await p2.evaluate(() => {
    const a = document.getElementById('rgsBlaseNavi');
    const b = document.getElementById('rgsBlaseListe');
    if (!a || !b) { return null; }
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    return { luft: rb.left - ra.right, beideDa: true,
             // Passt die Beschriftung in ihren Knopf, oder laeuft sie hinaus?
             textA: a.querySelector('span').getBoundingClientRect().right <= ra.right,
             textB: b.querySelector('span').getBoundingClientRect().right <= rb.right };
  });
  check(`${br} px breit: die Blase bleibt innerhalb der Karte`, m.inHuelle === true);
  check(`${br} px breit: sie liegt weiterhin ueber den Kartenknoepfen`, m.ueberKnoepfen === true);
  check(`${br} px breit: beide Knoepfe behalten 44 px`, m.naviH >= 44 && m.listeH >= 44);
  check(`${br} px breit: die Knoepfe stossen nicht ineinander`,
    !!knoepfe && knoepfe.luft >= 4);
  check(`${br} px breit: keine Beschriftung laeuft aus ihrem Knopf hinaus`,
    !!knoepfe && knoepfe.textA && knoepfe.textB);
  await p2.screenshot({ path: `${OUT}/blase-03-${br}.png` });
  await p2.close();
}

// ══════════ PAUSIERT: KEINE ZAHL, ABER EIN GRUND (ENT-648) ═══════════
/* Waehrend der Pause ist die Ortung bewusst aus, die letzte Position
   steht aber noch im Speicher. Eine Entfernung daraus saehe aktuell aus
   und waere es nicht. Die Blase schweigt darum -- aber nicht stumm:
   "unbekannt darf nie wie keine aussehen" (CLAUDE.md), also sagt sie,
   warum keine Zahl da steht.

   Die Position wird ausdruecklich VORGELEGT. Ohne sie waere die Pruefung
   wertlos: Sie wuerde auch gruen, wenn nur zufaellig keine Position da
   ist. Die Vorbedingung unten sichert das ab. */
const pause = await seite('pausiert');
const pv = await pause.evaluate(ort => {
  rgsMeinOrt = { lat: ort.lat, lng: ort.lng, genauigkeit: 8, zeit: Date.now(),
                 richtung: null, richtungZeit: 0, anker: null };
  rgKarteBlaseAuf(2);
  const k = rundgangAktiv.kontrollpunkte.find(x => Number(x.id) === 2);
  return { messbar: rdEntfernungZu(k) !== null, ortungAus: rgsOrtWache === null };
}, ORT);
await pause.waitForTimeout(300);
const pb = await blase(pause);
check('Vorbedingung: pausiert laeuft keine Ortung mehr', pv.ortungAus === true);
check('Vorbedingung: die Entfernung waere trotzdem berechenbar -- sonst prueft der naechste Punkt nichts',
  pv.messbar === true);
check('KRITISCH: pausiert nennt die Blase KEINE Entfernung (ENT-648)',
  pb.offen === true && !pb.entf && !/noch \d/.test(pb.text || ''));
check('KRITISCH: sie schweigt aber nicht stumm -- sie sagt, warum keine Zahl da steht',
  (pb.mut || '').trim().length > 3);
check('Und die Navigation bleibt auch pausiert erreichbar -- wohin es geht, weiss man ohne Ortung',
  /^https:\/\//.test(pb.href || ''));
await pause.screenshot({ path: `${OUT}/blase-02-pausiert.png` });
await pause.close();

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { console.log(bad.map(n => '  ✗ ' + n).join('\n')); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
