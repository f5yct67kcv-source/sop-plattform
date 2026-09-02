// Gemeldete Ereignisse in der Verwaltung sichtbar machen (ENT-297).
//
// Bis hierher landeten die Vorfallmeldungen aus der App (ENT-295) in der
// Datenbank, ohne dass ein Planer sie je zu Gesicht bekam. Zwei Orte mit
// verschiedenen Aufgaben, beide hier geprueft:
//   - Die LISTE im Revierdienst: der Ort zum Nachschlagen (filterbar).
//   - Der FEED auf der Uebersicht: der Ort zum Bemerken. Eine Meldung
//     "Brandgefahr" darf nicht darauf warten, dass jemand zufaellig eine
//     Liste oeffnet.
//
// Bewusst NICHT unter "Berichte" der einzelnen Kontrollrunde (Ueberlegung
// des Projektinhabers): Eine Meldung haengt am Objekt und darf ohne
// laufende Runde entstehen -- unter einer Vorlage waeren genau diese
// unauffindbar. Das wird unten mitgeprueft (Meldung ohne rundgang_id).
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const SEITE = `file://${WURZEL}/dashboard.html`;
const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const HEUTE = iso(new Date());

const OBJEKTE = { status: 'ok', objekte: [
  { id: 1, kunde_id: 1, kunde_name: 'Muster Liegenschaften AG', name: 'Testliegenschaft Nord',
    strasse: 'Testweg 1', ort: '9999 Beispielhausen', kanton: 'SO', einsatzart: 'Revierdienst',
    aktiv: 1, bemerkung: null, masterschichten: 0, stunden_je_einsatz: 0 },
  { id: 2, kunde_id: 2, kunde_name: 'Beispiel Immobilien GmbH', name: 'Testliegenschaft Süd',
    strasse: 'Musterstrasse 2', ort: '9998 Beispielhausen', kanton: 'SO', einsatzart: 'Revierdienst',
    aktiv: 1, bemerkung: null, masterschichten: 0, stunden_je_einsatz: 0 },
]};

const ARTEN = { status: 'ok', arten: [
  { id: 3, bezeichnung: 'Brandgefahr' },
  { id: 2, bezeichnung: 'Vandalismus / Sachbeschädigung' },
]};

// Ein winziges, gueltiges PNG (1x1) als Foto-Antwort.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');

const EREIGNISSE = { status: 'ok', gesamt: 2, ereignisse: [
  { id: 41, erfasst_am: `${HEUTE} 23:14:00`, vorfall_am: `${HEUTE} 22:40:00`,
    uebermittelt_am: `${HEUTE} 23:14:05`, gesehen_am: null,
    art: 'Brandgefahr', ereignisart_id: 3, bemerkung: 'Kartonstapel vor dem Notausgang',
    objekt_id: 1, objekt: 'Testliegenschaft Nord', kunde: 'Muster Liegenschaften AG',
    ort: '9999 Beispielhausen', person: 'Erika Muster', mitarbeiter_id: 5,
    // OHNE Rundgang gemeldet -- genau der Fall, der unter "Berichte" einer
    // Kontrollrunde unauffindbar waere.
    rundgang_id: null, einsatz_id: null, hat_foto: true, lat: 47.35, lng: 7.9 },
  { id: 42, erfasst_am: `${HEUTE} 21:02:00`, vorfall_am: null,
    uebermittelt_am: `${HEUTE} 21:02:03`, gesehen_am: `${HEUTE} 21:30:00`,
    art: 'Vandalismus / Sachbeschädigung', ereignisart_id: 2, bemerkung: null,
    objekt_id: 2, objekt: 'Testliegenschaft Süd', kunde: 'Beispiel Immobilien GmbH',
    ort: '9998 Beispielhausen', person: 'Hans Beispiel', mitarbeiter_id: 6,
    rundgang_id: 7, einsatz_id: 12, hat_foto: false, lat: null, lng: null },
]};

// Der Feed liefert dieselbe Meldung als Ereignis-Art "vorfall".
// Flach, genau wie dashboard_stats.php es liefert (ereignisse,
// ereignisse_gesamt, ereignisse_gekuerzt, ereignisse_unvollstaendig) --
// nicht verschachtelt, wie ereignisse_sammeln() intern zurueckgibt.
const STATS = { status: 'ok', kpi: {}, verlauf: [], angemeldet: [], pro_mitarbeiter: [],
  letzte_rapporte: [],
  ereignisse: [
    { typ: 'vorfall', id: 41, zeit: `${HEUTE} 23:14:00`,
      person: { id: 5, name: 'e.muster', vorname: 'Erika', nachname: 'Muster' },
      titel: 'Ereignis gemeldet', art: 'Brandgefahr',
      objekt_id: 1, objekt: 'Testliegenschaft Nord', kunde: 'Muster Liegenschaften AG',
      bemerkung: 'Kartonstapel vor dem Notausgang', vorfall_am: `${HEUTE} 22:40:00`, hat_foto: true },
  ],
  ereignisse_gesamt: 1, ereignisse_gekuerzt: false, ereignisse_unvollstaendig: [] };

let calls = [];
let listeAntwort = EREIGNISSE;
let fotoStatus = 200;

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));

await page.route('**/api/**', route => {
  const u = new URL(route.request().url());
  const path = u.pathname.split('/api/')[1];
  calls.push({ path, query: Object.fromEntries(u.searchParams),
    kopf: route.request().headers() });
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });

  if (path.includes('login')) return send({ status: 'ok', token: 't', name: 'adrian', ist_admin: true });
  if (path.includes('dashboard_stats')) return send(STATS);
  if (path.includes('mitarbeiter_list')) return send({ status: 'ok', mitarbeiter: [] });
  if (path.includes('kunden_list')) return send({ status: 'ok', kunden: [] });
  if (path.includes('einsatz_list')) return send({ status: 'ok', einsaetze: [] });
  if (path.includes('objekt_list')) return send(OBJEKTE);
  if (path.includes('masterschicht_list')) return send({ status: 'ok', masterschichten: [] });
  if (path.includes('rundgang_liste')) return send({ status: 'ok', rundgaenge: [] });
  if (path.includes('pensen.php')) return send({ status: 'ok', jahr: 2026, mitarbeiter: [] });
  if (path.includes('ereignisart_liste')) return send(ARTEN);
  if (path.includes('ereignis_foto')) {
    if (fotoStatus !== 200) {
      return route.fulfill({ status: fotoStatus, contentType: 'application/json',
        body: JSON.stringify({ status: 'error', message: 'nicht gefunden' }) });
    }
    return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
  }
  if (path.includes('ereignis_liste')) return send(listeAntwort);
  return send({ status: 'ok' });
});

await page.goto(SEITE);
await page.evaluate(() => localStorage.clear());
await page.goto(SEITE);
await page.fill('#gName', 'adrian'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#kpiGrid .kpi-val');

// ══════════ FEED AUF DER ÜBERSICHT: DER ORT ZUM BEMERKEN ══════════════
const feed = await page.textContent('#ereignisFeed');
check('KRITISCH: eine gemeldete Vorfallmeldung erscheint im Feed der Übersicht',
  feed.includes('Brandgefahr'));
check('KRITISCH: der Feed nennt das Objekt -- ohne Ort ist die Meldung wertlos',
  feed.includes('Testliegenschaft Nord'));
check('Die Beschreibung steht mit dabei',
  feed.includes('Notausgang'));
check('KRITISCH: die Meldung ist als auffällig markiert (warn), nicht als Routinemeldung',
  await page.evaluate(() => {
    const z = [...document.querySelectorAll('#ereignisFeed *')]
      .find(e => e.className && /warn/.test(String(e.className)));
    return !!z;
  }));

// ══════════ LISTE IM REVIERDIENST: DER ORT ZUM NACHSCHLAGEN ═══════════
await page.click('#nav-revierdienst');
await page.waitForTimeout(250);
check('Die Übersicht bietet eine Kachel "Ereignisse" an', await page.isVisible('#rdKachelEreignisse'));
check('KRITISCH: alle fünf Kacheln stehen nebeneinander, keine allein in einer zweiten Zeile',
  await page.evaluate(() => {
    const k = [...document.querySelectorAll('#rdUebersicht .bk-kachel-grid .bk-kachel')];
    if (k.length < 5) return false;
    const oben = k[0].getBoundingClientRect().top;
    return k.every(x => Math.abs(x.getBoundingClientRect().top - oben) < 2);
  }));

calls = [];
await page.click('#rdKachelEreignisse');
await page.waitForSelector('#evfListe table');
check('KRITISCH: die Kachel öffnet die Ereignis-Unterseite', await page.isVisible('#rdAb-ereignisse'));
check('Die Kopfzeile sagt, wo man ist', (await page.textContent('#pgTitle')) === 'Ereignisse');
check('KRITISCH: die Liste wird über ereignis_liste.php geladen',
  calls.some(c => c.path.includes('ereignis_liste')));
check('Der Zeitraum ist vorbelegt, statt ungefiltert alles zu laden',
  await page.evaluate(() => !!document.getElementById('evfVon').value));

const tab = await page.textContent('#evfListe');
check('KRITISCH: beide Meldungen stehen in der Liste, mit Art, Objekt und Person',
  tab.includes('Brandgefahr') && tab.includes('Testliegenschaft Nord') && tab.includes('Erika Muster')
  && tab.includes('Vandalismus'));
check('KRITISCH: eine ohne Rundgang gemeldete Meldung erscheint ebenfalls -- sie wäre unter "Berichte" einer Kontrollrunde unauffindbar',
  tab.includes('Brandgefahr'));
// Nicht nur "das Wort steht da": Die erste Fassung nutzte die Klasse
// .marke aus der APP -- im Dashboard heisst sie .chip, das Kennzeichen war
// also unsichtbarer Fliesstext. Genau die Sorte Fehler, die eine reine
// Textpruefung durchgewunken haette (CLAUDE.md: messen, nicht nachlesen).
check('KRITISCH: noch nicht gesehene Meldungen tragen ein sichtbares Kennzeichen, keinen blossen Text',
  await page.evaluate(() => {
    const z = [...document.querySelectorAll('#evfListe tbody tr')]
      .find(r => r.textContent.includes('Brandgefahr'));
    if (!z) return false;
    const chip = [...z.querySelectorAll('span')].find(s => s.textContent.trim() === 'neu');
    if (!chip) return false;
    const st = getComputedStyle(chip);
    // Eine wirkungslose Klasse liesse Hintergrund und Polsterung leer.
    return st.backgroundColor !== 'rgba(0, 0, 0, 0)' && parseFloat(st.paddingLeft) > 0;
  }));
check('Eine bereits gesehene Meldung trägt die Kennzeichnung NICHT',
  await page.evaluate(() => {
    const z = [...document.querySelectorAll('#evfListe tbody tr')]
      .find(r => r.textContent.includes('Vandalismus'));
    return !!z && ![...z.querySelectorAll('span')].some(s => s.textContent.trim() === 'neu');
  }));
check('Die Anzahl der Treffer steht dabei', (await page.textContent('#evfAnzahl')).includes('2'));

// ══════════ FILTER ═════════════════════════════════════════════════════
check('Die Objekt-Auswahl kommt aus den Stammdaten, nicht aus den Treffern',
  await page.evaluate(() => document.getElementById('evfObjekt').options.length >= 3));
check('Die Arten-Auswahl ebenso',
  await page.evaluate(() => document.getElementById('evfArt').options.length >= 3));
calls = [];
await page.selectOption('#evfObjekt', '1');
await page.waitForTimeout(300);
const gefiltert = calls.find(c => c.path.includes('ereignis_liste'));
check('KRITISCH: ein Objektfilter wird serverseitig angewendet, nicht nur in der Anzeige',
  !!gefiltert && gefiltert.query.objekt_id === '1');

// Ein Filter, der alles ausblendet, darf nie wie "nichts vorhanden"
// aussehen (CLAUDE.md).
listeAntwort = { status: 'ok', gesamt: 0, ereignisse: [] };
await page.selectOption('#evfArt', '3');
await page.waitForTimeout(300);
check('KRITISCH: ein Filter ohne Treffer sagt "kein Treffer", nicht "nichts vorhanden"',
  (await page.textContent('#evfListe')).includes('Filter'));
await page.selectOption('#evfObjekt', '');
await page.selectOption('#evfArt', '');
await page.waitForTimeout(300);
check('Ohne Filter lautet der Leertext anders -- die beiden Aussagen sind nicht dasselbe',
  (await page.textContent('#evfListe')).includes('kein Ereignis gemeldet'));
listeAntwort = EREIGNISSE;
await page.selectOption('#evfObjekt', '');
await page.waitForTimeout(300);

// ══════════ DETAIL UND FOTO ════════════════════════════════════════════
calls = [];
await page.click('#evfListe tbody tr:has-text("Brandgefahr")');
await page.waitForTimeout(300);
check('KRITISCH: ein Klick öffnet die Detailansicht mit Art im Titel',
  (await page.textContent('#drTitle')).includes('Brandgefahr'));
const detail = await page.textContent('#drBody');
check('Das Detail nennt Objekt, Kunde und meldende Person',
  detail.includes('Testliegenschaft Nord') && detail.includes('Muster Liegenschaften')
  && detail.includes('Erika Muster'));
check('KRITISCH: Erfassungszeit UND abweichender Vorfallzeitpunkt stehen getrennt da (ENT-295)',
  detail.includes('Gemeldet') && detail.includes('Vorfall war'));
check('Der Standort ist als Kartenlink hinterlegt',
  await page.evaluate(() => !!document.querySelector('#drBody a[href*="maps"]')));
await page.waitForTimeout(400);
check('KRITISCH: das Foto wird tatsächlich geladen und angezeigt',
  await page.evaluate(() => {
    const img = document.querySelector('#evfFoto img');
    return !!img && img.src.startsWith('blob:');
  }));
// Der Token gehört NICHT in die URL (test_php.mjs prüft dieselbe Regel
// serverseitig) -- er muss als Kopfzeile mitgehen.
const fotoRuf = calls.find(c => c.path.includes('ereignis_foto'));
check('KRITISCH: das Foto wird mit dem Token als Kopfzeile geholt, nicht über die URL',
  !!fotoRuf && !!fotoRuf.kopf['x-auth-token'] && !('token' in fotoRuf.query));

// Eine Meldung ohne Foto darf keine leere Bildfläche zeigen.
await page.click('#drawer .dr-x, #drawer button[aria-label="Schliessen"], #scrim');
await page.waitForTimeout(200);
await page.click('#evfListe tbody tr:has-text("Vandalismus")');
await page.waitForTimeout(300);
check('Eine Meldung ohne Foto zeigt gar keinen Fotobereich',
  await page.evaluate(() => !document.getElementById('evfFoto')));
check('Bei einer bereits gesehenen Meldung steht das im Fuss',
  (await page.textContent('#drFoot')).includes('gesehen'));

// ══════════ FOTO NICHT LADBAR ══════════════════════════════════════════
fotoStatus = 404;
await page.click('#drawer .dr-x, #drawer button[aria-label="Schliessen"], #scrim');
await page.waitForTimeout(200);
await page.click('#evfListe tbody tr:has-text("Brandgefahr")');
await page.waitForTimeout(500);
check('KRITISCH: ein nicht ladbares Foto sagt das, statt still leer zu bleiben',
  (await page.textContent('#evfFoto')).includes('nicht laden'));
fotoStatus = 200;

await page.screenshot({ path: `${OUT}/evf-01-liste.png` });
check('KRITISCH: kein waagrechter Seiten-Scroll', await page.evaluate(() =>
  document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
