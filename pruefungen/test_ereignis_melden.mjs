// Ereignis erfassen: Vorfallmeldung aus dem Revierdienst (ENT-295).
//
// Der Projektinhaber hat das Vorbild (Coredinate) ausdruecklich NICHT als
// Vorlage zum Nachbauen verstanden wissen wollen: "Es sind elementare und
// logische funktionen die solch eine App braucht. Aber vom design nicht 1:1
// nachbauen." Zwei Abweichungen sind darum bewusst und werden hier
// festgehalten, damit sie nicht spaeter versehentlich "angeglichen" werden:
//
//  1. KEIN "Anzahl"-Feld. Es stuende bei den meisten Arten dauerhaft auf 1.
//  2. Der Erfassungszeitpunkt ist NICHT aenderbar. Bei einer Vorfallmeldung
//     ist er Teil des Nachweises; ein abweichender Vorfallzeitpunkt wird
//     DANEBEN erfasst, nicht darueber -- gleiches Prinzip wie Rohzeit und
//     bewertete Zeit im GAV-Teil.
//
// Die Ereignisarten kommen aus dem Stammdaten-Katalog (ENT-164: "manuell
// erweiterbar, kein starres Set"), nicht aus einer Liste im Quelltext.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const tag = n => iso(new Date(Date.now() + n * 864e5));

const SCHICHTEN = { status: 'ok', von: tag(-30), bis: tag(90), schichten: [
  { id: 71, kunde_name: 'Musterliegenschaften AG', titel: 'Nachtwache', strasse: 'Musterweg 4', ort: '9999 Musterdorf',
    einsatzart: 'Revierdienst', sparte: 'sicherheit', datum: tag(-1), von: '20:00:00', bis: '06:00:00',
    status: 'bestaetigt', bemerkung: null, zusage: 'zugesagt', objekt_name: 'Musterobjekt Industrie', objekt_id: 7,
    hat_kontrollpunkte: true, im_team: 1 },
]};
const PROFIL = { status: 'ok', monat: { anzahl: 0, stunden: 0 }, profil: { name: 'm.muster' } };

const VORLAGEN_ALLE = [{ id: 501, name: 'Schliessrunde Musterobjekt', objekt_id: 7,
  objekt_name: 'Musterobjekt Industrie', kunde_name: 'Musterliegenschaften AG', fenster_von: null, fenster_bis: null }];

const UEBERSICHT = { status: 'ok',
  vorlage: { id: 501, name: 'Schliessrunde Musterobjekt', fenster_von: null, fenster_bis: null },
  objekt: { id: 7, name: 'Musterobjekt Industrie', strasse: 'Musterweg 4', ort: '9999 Musterdorf', kanton: 'SO' },
  kunde_name: 'Musterliegenschaften AG',
  kontrollpunkte: [{ id: 1, bezeichnung: 'Tor', typ: 'geofence' }],
  ansprechpartner: [] };

// Startbestand aus ENT-164, wie er beim Einrichten angelegt wird.
const ARTEN = [
  { id: 1, bezeichnung: 'Diebstahl / Einbruch(-versuch)' },
  { id: 2, bezeichnung: 'Vandalismus / Sachbeschädigung' },
  { id: 3, bezeichnung: 'Brandgefahr' },
  { id: 9, bezeichnung: 'Sonstiges' },
];

let rufe = [];
let meldenAntwort = null;      // null = Standard "ok"
let meldenScheitert = false;   // Netzfehler erzwingen

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));

// Standort steuerbar halten (wie in test_rundgang.mjs) -- die Meldung haelt
// ihn einmalig fest, ohne Verfolgung.
await page.addInitScript(() => {
  window.__geoAn = true;
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: (okCb, failCb) => {
      if (!window.__geoAn) { failCb({ code: 1 }); return; }
      okCb({ coords: { latitude: 47.35, longitude: 7.9 } });
    } },
  });
});

await page.route('**/api/**', route => {
  const req = route.request();
  const url = new URL(req.url());
  const p = url.pathname.split('/api/')[1];
  if (p.includes('mein_ereignis_melden') && meldenScheitert) { return route.abort('internetdisconnected'); }
  let body = null;
  try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch { body = req.postData(); }
  rufe.push({ p, body, query: Object.fromEntries(url.searchParams) });
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });

  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'm.muster', ist_admin: false });
  if (p.includes('meine_schichten')) return send(SCHICHTEN);
  if (p.includes('mein_profil')) return send(PROFIL);
  if (p.includes('rapport_list')) return send({ status: 'ok', rapporte: [] });
  if (p.includes('mein_rundgang_offen')) return send({ status: 'ok', rundgang: null });
  if (p.includes('mein_rundgang_uebersicht')) return send(UEBERSICHT);
  if (p.includes('mein_rundgang_vorlagen_alle')) return send({ status: 'ok', vorlagen: VORLAGEN_ALLE });
  if (p.includes('ereignisart_liste')) return send({ status: 'ok', arten: ARTEN });
  if (p.includes('mein_ereignis_melden')) {
    if (meldenAntwort) return send(meldenAntwort);
    const m = (body.meldungen || [])[0] || {};
    return send({ status: 'ok', ergebnisse: [{ lokal_id: m.lokal_id, status: 'ok', id: 4711 }] });
  }
  return send({ status: 'ok' });
});

await page.goto(`file://${WURZEL}/app.html`);
await page.fill('#gName', 'm.muster'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('.app.on');
await page.waitForTimeout(400);

const vorschauOeffnen = async () => {
  await page.evaluate(() => { blattZu(); rgSeiteZu(); });
  await page.evaluate(() => rundgangUebersichtOeffnen());
  await page.waitForTimeout(300);
  await page.click('#blBody button:has-text("Schliessrunde Musterobjekt")');
  await page.waitForTimeout(350);
};

// ══════════ WEG ZUM FORMULAR ══════════════════════════════════════════
await vorschauOeffnen();
check('Die Vorschau bietet "Ereignis erfassen" als eigenes Modul an',
  await page.isVisible('#rgsModEreignis'));
rufe = [];
await page.click('#rgsModEreignis');
await page.waitForTimeout(350);
check('KRITISCH: das Modul öffnet eine eigene Unterseite mit eigenem Titel',
  (await page.textContent('#rgsTitel')) === 'Ereignis erfassen' && await page.isVisible('#evArt'));
check('KRITISCH: die Ereignisarten kommen aus dem Katalog, nicht aus dem Quelltext',
  rufe.some(r => r.p.includes('ereignisart_liste'))
  && (await page.textContent('#evArt')).includes('Brandgefahr'));
check('Die Auswahl steht zunächst auf leer -- keine stillschweigende Vorbelegung',
  (await page.inputValue('#evArt')) === '');

// ══════════ BEWUSSTE ABWEICHUNGEN VOM VORBILD ═════════════════════════
check('KRITISCH: es gibt KEIN "Anzahl"-Feld (bewusst weggelassen)',
  await page.evaluate(() => !document.querySelector('#evAnzahl')
    && !/Anzahl/i.test(document.getElementById('rgsBody').textContent)));
check('KRITISCH: der Erfassungszeitpunkt ist Anzeige, kein Eingabefeld',
  await page.evaluate(() => {
    const el = document.getElementById('evErfasstWert');
    return !!el && el.tagName !== 'INPUT' && !el.isContentEditable;
  }));
check('Der Grund dafür steht dabei, statt den Nutzer raten zu lassen',
  (await page.textContent('#rgsBody')).includes('Nachweis'));
// Erste Fassung stellte den Hinweis als zweite Spalte NEBEN die Kennzahl --
// links Beschriftung plus Wert, rechts Fliesstext in anderer Groesse. Genau
// das untersagt CLAUDE.md ("gleiches Muster auf beiden Seiten").
check('KRITISCH: Zeitpunkt und Hinweis stehen untereinander, nicht als ungleiches Nebeneinander',
  await page.evaluate(() => {
    const karte = document.getElementById('evErfasstKarte');
    if (!karte) return false;
    const wert = karte.querySelector('.rgs-fakt-wert').getBoundingClientRect();
    const hinweis = karte.querySelector('.rgs-leer').getBoundingClientRect();
    return hinweis.top >= wert.bottom - 1;   // darunter, nicht daneben
  }));
check('Ein abweichender Vorfallzeitpunkt ist möglich, aber eingeklappt und optional',
  await page.evaluate(() => getComputedStyle(document.querySelector('#evKlappZeit .rgs-klapp-bd')).display === 'none'));

// ══════════ PFLICHTFELD ═══════════════════════════════════════════════
rufe = [];
await page.click('#evSpeichern');
await page.waitForTimeout(250);
check('KRITISCH: ohne Ereignisart wird nichts gesendet, mit sichtbarer Meldung',
  await page.isVisible('#evErr') && !rufe.some(r => r.p.includes('mein_ereignis_melden')));

// ══════════ ERFOLGREICHE MELDUNG ══════════════════════════════════════
await page.selectOption('#evArt', '3');
await page.fill('#evText', 'Kartonstapel vor dem Notausgang');
rufe = [];
await page.click('#evSpeichern');
await page.waitForTimeout(500);
const gemeldet = rufe.find(r => r.p.includes('mein_ereignis_melden'));
const m = gemeldet && gemeldet.body.meldungen[0];
check('KRITISCH: die Meldung geht mit Art, Beschreibung und Objekt an den Server',
  !!m && m.ereignisart_id === 3 && m.bemerkung.includes('Notausgang') && m.objekt_id === 7);
check('KRITISCH: der Erfassungszeitpunkt ist geräteseitig im MySQL-Format gesetzt',
  !!m && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(m.erfasst_am));
check('Ohne abweichende Angabe bleibt der Vorfallzeitpunkt leer -- nicht stillschweigend gefüllt',
  !!m && m.vorfall_am === null);
check('KRITISCH: der Standort wird einmalig mitgeschickt (Nachweis, keine Verfolgung)',
  !!m && typeof m.lat === 'number' && typeof m.lng === 'number');
check('Nach dem Melden steht wieder die Übersicht da',
  await page.isVisible('#rgsModEreignis'));
check('KRITISCH: nach erfolgreicher Übermittlung liegt nichts mehr in der Warteschlange',
  await page.evaluate(() => JSON.parse(localStorage.getItem('sop_ereignis_warteschlange') || '[]').length === 0));

// ══════════ ABWEICHENDER VORFALLZEITPUNKT ════════════════════════════
await vorschauOeffnen();
await page.click('#rgsModEreignis');
await page.waitForTimeout(350);
await page.click('#evKlappZeit .rgs-klapp-kopf');
await page.waitForTimeout(200);
check('Der Vorfallzeitpunkt lässt sich aufklappen', await page.isVisible('#evVorfall'));
await page.selectOption('#evArt', '1');
// Zukunft: muss abgelehnt werden, der Vorfall kann nicht nach der Meldung liegen.
const morgen = tag(1) + 'T12:00';
await page.fill('#evVorfall', morgen);
rufe = [];
await page.click('#evSpeichern');
await page.waitForTimeout(300);
check('KRITISCH: ein Vorfallzeitpunkt nach der Erfassung wird abgelehnt, nicht gespeichert',
  await page.isVisible('#evErr') && !rufe.some(r => r.p.includes('mein_ereignis_melden')));
const gestern = tag(-1) + 'T23:30';
await page.fill('#evVorfall', gestern);
rufe = [];
await page.click('#evSpeichern');
await page.waitForTimeout(500);
const m2 = (rufe.find(r => r.p.includes('mein_ereignis_melden')) || {}).body?.meldungen?.[0];
check('KRITISCH: ein früherer Vorfallzeitpunkt wird ZUSÄTZLICH zur Erfassungszeit übermittelt',
  !!m2 && m2.vorfall_am === gestern.replace('T', ' ') + ':00'
  && m2.erfasst_am !== m2.vorfall_am);

// ══════════ OFFLINE ══════════════════════════════════════════════════
meldenScheitert = true;
await vorschauOeffnen();
await page.click('#rgsModEreignis');
await page.waitForTimeout(350);
await page.selectOption('#evArt', '2');
await page.fill('#evText', 'Scheibe eingeschlagen');
await page.click('#evSpeichern');
await page.waitForTimeout(500);
const wartend = await page.evaluate(() => JSON.parse(localStorage.getItem('sop_ereignis_warteschlange') || '[]'));
check('KRITISCH: ohne Netz bleibt die Meldung lokal in der Warteschlange (ENT-132)',
  wartend.length === 1 && wartend[0].ereignisart_id === 2);
check('KRITISCH: der Zeitstempel der Warteschlange ist der Moment der ERFASSUNG, nicht der Übermittlung',
  wartend.length === 1 && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(wartend[0].erfasst_am));
check('Die Oberfläche sagt ehrlich, dass noch übermittelt wird',
  (await page.textContent('#toast')).includes('übermittelt'));

meldenScheitert = false;
rufe = [];
await page.evaluate(() => window.dispatchEvent(new Event('online')));
await page.waitForTimeout(500);
check('KRITISCH: sobald wieder Netz da ist, wird automatisch nachgesendet',
  rufe.some(r => r.p.includes('mein_ereignis_melden')));
check('KRITISCH: danach ist die Warteschlange leer',
  await page.evaluate(() => JSON.parse(localStorage.getItem('sop_ereignis_warteschlange') || '[]').length === 0));

// ══════════ INHALTLICHE ABLEHNUNG BLOCKIERT NICHT DAUERHAFT ══════════
meldenAntwort = { status: 'ok', ergebnisse: [{ lokal_id: null, status: 'fehler', message: 'Diese Ereignisart gibt es nicht (mehr).' }] };
await vorschauOeffnen();
await page.click('#rgsModEreignis');
await page.waitForTimeout(350);
await page.selectOption('#evArt', '9');
await page.click('#evSpeichern');
await page.waitForTimeout(500);
check('KRITISCH: eine inhaltlich abgelehnte Meldung nennt den Grund',
  await page.isVisible('#evErr') && (await page.textContent('#evErr')).includes('nicht (mehr)'));
check('KRITISCH: sie bleibt NICHT in der Warteschlange liegen -- sonst scheitert sie bei jedem Netzkontakt erneut',
  await page.evaluate(() => JSON.parse(localStorage.getItem('sop_ereignis_warteschlange') || '[]').length === 0));
meldenAntwort = null;

// ══════════ LEERER KATALOG ═══════════════════════════════════════════
ARTEN.length = 0;
await vorschauOeffnen();
await page.click('#rgsModEreignis');
await page.waitForTimeout(350);
check('Ohne hinterlegte Ereignisarten erscheint ein erklärender Hinweis statt eines leeren Feldes',
  (await page.textContent('#rgsBody')).includes('keine Ereignisarten'));
ARTEN.push({ id: 3, bezeichnung: 'Brandgefahr' });

// ══════════ GESTALTUNG ════════════════════════════════════════════════
await vorschauOeffnen();
await page.click('#rgsModEreignis');
await page.waitForTimeout(350);
check('KRITISCH: Eingabefelder sind mindestens 16px gross -- sonst zoomt iOS hinein (CLAUDE.md)',
  await page.evaluate(() => ['evArt', 'evText'].every(id => {
    const el = document.getElementById(id);
    return el && parseFloat(getComputedStyle(el).fontSize) >= 16;
  })));
check('KRITISCH: der Zurück-Pfeil führt eine Ebene zurück auf die Übersicht, nicht aus der Seite heraus',
  await (async () => {
    await page.click('#rgsZurueck');
    await page.waitForTimeout(250);
    return await page.isVisible('#rgSeite') && await page.isVisible('#rgsModEreignis');
  })());
check('Erst von der Übersicht aus schliesst der Pfeil die Seite',
  await (async () => {
    await page.click('#rgsZurueck');
    await page.waitForTimeout(250);
    return !(await page.isVisible('#rgSeite'));
  })());

await vorschauOeffnen();
await page.click('#rgsModEreignis');
await page.waitForTimeout(350);
await page.screenshot({ path: `${OUT}/ev-01-mobil.png` });
check('KRITISCH: kein waagrechter Seiten-Scroll bei 390px', await page.evaluate(() =>
  document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));

await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(250);
check('Am Desktop bleibt das Formular bedienbar und auf App-Breite',
  await page.isVisible('#evSpeichern')
  && await page.evaluate(() => document.getElementById('rgSeite').getBoundingClientRect().width <= 561));
check('KRITISCH: am Desktop kein waagrechter Seiten-Scroll', await page.evaluate(() =>
  document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
await page.screenshot({ path: `${OUT}/ev-02-desktop.png` });

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
