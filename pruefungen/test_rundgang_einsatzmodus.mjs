// Einsatzmodus Rundgang: die Vorschau-Vollseite vor dem Start (ENT-294).
//
// Der Projektinhaber hat drei Dinge festgelegt, die hier geprueft werden:
//  1. Eigene VOLLSEITE statt Schublade -- mit Zurueck-Weg, ueber der
//     Reiterleiste, aber unter der Schublade (kurze Eingaben wie die
//     Grundabfrage erscheinen weiterhin darueber).
//  2. DUNKLER Einsatzmodus nur hier: Der Rundgang ist der einzige
//     Bildschirm, den man nachts draussen anschaut (ENT-029 hatte den
//     Dunkelmodus aufs Dashboard begrenzt). Der Rest der App bleibt hell --
//     das wird ausdruecklich mitgeprueft, sonst faellt ein Durchschlagen
//     auf andere Ansichten erst im Betrieb auf.
//  3. Kopf zuoberst: Objekt, Kunde, Adresse -- in dieser Reihenfolge.
//
// Der wichtigste Punkt inhaltlich: Das blosse OEFFNEN darf NICHTS anlegen.
// Vor dieser Aenderung startete ein Antippen sofort und erzeugte
// serverseitig Einsatz samt Zuteilung -- daher die mehrfachen "Spontaner
// Rundgang"-Karteileichen im Einsatzplan. Erst der Knopf am Fuss startet.
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

const PROFIL = { status: 'ok', monat: { anzahl: 0, stunden: 0 }, profil: {
  name: 'm.muster', ist_admin: false, personalnummer: 'P-001',
  vorname: 'Max', nachname: 'Muster', erstellt_am: tag(-30) + ' 10:00:00' } };

const VORLAGEN_ALLE = [
  { id: 501, name: 'Schliessrunde Musterobjekt', objekt_id: 7, objekt_name: 'Musterobjekt Industrie',
    kunde_name: 'Musterliegenschaften AG', fenster_von: null, fenster_bis: null },
  // Zweite Runde OHNE zugeordnete Kontrollpunkte -- genau der gemeldete Fall
  // ("0 von 0 erledigt"), der bisher erst nach dem Start sichtbar wurde.
  { id: 502, name: 'Leere Runde', objekt_id: 7, objekt_name: 'Musterobjekt Industrie',
    kunde_name: 'Musterliegenschaften AG', fenster_von: '06:00:00', fenster_bis: '07:00:00' },
];

const UEBERSICHT = {
  501: { status: 'ok',
    vorlage: { id: 501, name: 'Schliessrunde Musterobjekt', fenster_von: null, fenster_bis: null },
    objekt: { id: 7, name: 'Musterobjekt Industrie', strasse: 'Musterweg 4', ort: '9999 Musterdorf',
      kanton: 'SO', bemerkung: null },
    kunde_name: 'Musterliegenschaften AG',
    kontrollpunkte: [
      { id: 1, bezeichnung: 'Eingang Nord', typ: 'geofence' },
      { id: 2, bezeichnung: 'Tor 3', typ: 'geofence' },
      { id: 3, bezeichnung: 'Parkplatz', typ: 'nfc' },
      { id: 4, bezeichnung: 'Parkhaus', typ: 'geofence' },
    ],
    ansprechpartner: [
      { name: 'Vreni Beispiel', anrede: 'Frau', wege: [
        { art: 'telefon', wert: '062 000 00 00' }, { art: 'email', wert: 'kontakt@example.invalid' }] },
    ] },
  502: { status: 'ok',
    vorlage: { id: 502, name: 'Leere Runde', fenster_von: '06:00:00', fenster_bis: '07:00:00' },
    objekt: { id: 7, name: 'Musterobjekt Industrie', strasse: 'Musterweg 4', ort: '9999 Musterdorf',
      kanton: 'SO', bemerkung: null },
    kunde_name: 'Musterliegenschaften AG',
    kontrollpunkte: [],
    ansprechpartner: [] },
};

let rufe = [];

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));

await page.route('**/api/**', route => {
  const req = route.request();
  const url = new URL(req.url());
  const p = url.pathname.split('/api/')[1];
  let body = null;
  try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch { body = req.postData(); }
  rufe.push({ p, body, query: Object.fromEntries(url.searchParams) });
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });

  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'm.muster', ist_admin: false });
  if (p.includes('meine_schichten')) return send(SCHICHTEN);
  if (p.includes('mein_profil')) return send(PROFIL);
  if (p.includes('rapport_list')) return send({ status: 'ok', rapporte: [] });
  if (p.includes('mein_rundgang_offen')) return send({ status: 'ok', rundgang: null });
  if (p.includes('mein_rundgang_uebersicht')) {
    return send(UEBERSICHT[Number(url.searchParams.get('vorlage_id'))] || { status: 'error', message: 'unbekannt' });
  }
  if (p.includes('mein_rundgang_vorlagen_alle')) return send({ status: 'ok', vorlagen: VORLAGEN_ALLE });
  if (p.includes('mein_rundgang_spontan_starten')) {
    return send({ status: 'ok', einsatz_id: 999, rundgang_id: 951, kontrollpunkte: [] });
  }
  return send({ status: 'ok' });
});

await page.goto(`file://${WURZEL}/app.html`);
await page.fill('#gName', 'm.muster'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('.app.on');
await page.waitForTimeout(400);

// ══════════ ÖFFNEN LEGT NICHTS AN ══════════════════════════════════════
await page.evaluate(() => rundgangUebersichtOeffnen());
await page.waitForTimeout(300);
rufe = [];
await page.click('#blBody button:has-text("Schliessrunde Musterobjekt")');
await page.waitForTimeout(400);

check('KRITISCH: das Öffnen einer Runde startet sie NICHT (kein Aufruf von mein_rundgang_spontan_starten)',
  !rufe.some(r => r.p.includes('mein_rundgang_spontan_starten')));
check('Stattdessen wird die rein lesende Vorschau geladen, mit der richtigen vorlage_id',
  rufe.some(r => r.p.includes('mein_rundgang_uebersicht') && r.query.vorlage_id === '501'));
check('KRITISCH: die Vollseite ist offen', await page.isVisible('#rgSeite'));
check('Die Schublade ist dabei geschlossen -- sie läge sonst darüber',
  !(await page.isVisible('#blatt.on')));
check('Die Kopfzeile trägt den Namen der Runde',
  (await page.textContent('#rgsTitel')) === 'Schliessrunde Musterobjekt');

// ══════════ KOPF: OBJEKT, KUNDE, ADRESSE -- IN DIESER REIHENFOLGE ══════
check('KRITISCH: Objekt, Kunde und Adresse stehen alle im Kopf',
  (await page.textContent('#rgsBody')).includes('Musterobjekt Industrie')
  && (await page.textContent('#rgsBody')).includes('Musterliegenschaften AG')
  && (await page.textContent('#rgsBody')).includes('Musterweg 4'));
// Nicht nur "steht drin", sondern in der vom Projektinhaber verlangten
// Reihenfolge -- am gerenderten Zustand gemessen, nicht im Quelltext gelesen.
const reihenfolge = await page.evaluate(() => {
  const y = s => { const el = document.querySelector(s); return el ? el.getBoundingClientRect().top : -1; };
  return { objekt: y('.rgs-obj-name'), kunde: y('.rgs-obj-kunde'), adresse: y('.rgs-obj-adr') };
});
check('KRITISCH: Objekt steht über Kunde, Kunde über Adresse (gemessen, nicht behauptet)',
  reihenfolge.objekt > 0 && reihenfolge.objekt < reihenfolge.kunde && reihenfolge.kunde < reihenfolge.adresse);

// ══════════ DUNKLER EINSATZMODUS ══════════════════════════════════════
const farben = await page.evaluate(() => {
  const rgb = s => getComputedStyle(document.querySelector(s));
  const zahl = c => c.match(/\d+/g).slice(0, 3).map(Number);
  const hell = c => { const [r, g, b] = zahl(c); return (r * 299 + g * 587 + b * 114) / 1000; };
  return {
    seiteBg: hell(rgb('#rgSeite').backgroundColor),
    seiteTxt: hell(rgb('#rgSeite').color),
    // body, NICHT .inhalt/.app: die sind transparent (rgba(0,0,0,0)) und
    // haetten hier eine Helligkeit von 0 ergeben -- die Pruefung waere
    // dauerhaft rot gewesen, ohne dass etwas kaputt ist.
    appBg: hell(rgb('body').backgroundColor),
    akzent: rgb('.rgs-modul-zahl').backgroundColor,
  };
});
check('KRITISCH: der Einsatzmodus ist wirklich dunkel (Hintergrund dunkel, Schrift hell)',
  farben.seiteBg < 60 && farben.seiteTxt > 180);
check('KRITISCH: der Rest der App bleibt hell -- ENT-029 gilt dort unverändert weiter',
  farben.appBg > 180);
check('Die blaue Dashboard-Farbe wird in der für dunklen Grund vorgesehenen Aufhellung verwendet (#7098F7)',
  farben.akzent.replace(/\s/g, '') === 'rgb(112,152,247)');

// ══════════ AUSKLAPPBARER BLOCK ANSPRECHPARTNER ═══════════════════════
check('Der Ansprechpartner-Block ist zunächst zugeklappt',
  await page.evaluate(() => getComputedStyle(document.querySelector('#rgsKlappAp .rgs-klapp-bd')).display === 'none'));
check('Die Telefonnummer ist zugeklappt nicht sichtbar',
  !(await page.isVisible('#rgsKlappAp .rgs-weg')));
await page.click('#rgsKlappAp .rgs-klapp-kopf');
await page.waitForTimeout(200);
check('KRITISCH: ein Tipp klappt ihn auf und zeigt die Ansprechperson',
  await page.isVisible('#rgsKlappAp .rgs-weg')
  && (await page.textContent('#rgsKlappAp')).includes('Vreni Beispiel'));
check('Die Telefonnummer ist als Anruf-Ziel hinterlegt, nicht nur als Text',
  await page.evaluate(() => !!document.querySelector('#rgsKlappAp a[href^="tel:"]')));
check('Die E-Mail-Adresse ebenso als Mail-Ziel',
  await page.evaluate(() => !!document.querySelector('#rgsKlappAp a[href^="mailto:"]')));
check('KRITISCH: Anruf- und Mail-Ziele sind mindestens 44px hoch (CLAUDE.md, Bedienung mit dem Daumen)',
  await page.evaluate(() => [...document.querySelectorAll('#rgsKlappAp .rgs-weg')]
    .every(a => a.getBoundingClientRect().height >= 44)));
await page.click('#rgsKlappAp .rgs-klapp-kopf');
await page.waitForTimeout(200);
check('Ein zweiter Tipp klappt ihn wieder zu',
  await page.evaluate(() => getComputedStyle(document.querySelector('#rgsKlappAp .rgs-klapp-bd')).display === 'none'));

// ══════════ KENNZAHLEN ════════════════════════════════════════════════
await page.screenshot({ path: `${OUT}/rgs-01-mobil.png` });
check('KRITISCH: die Anzahl Kontrollpunkte steht in der Vorschau -- vor dem Start, nicht erst danach',
  (await page.textContent('.rgs-fakten')).includes('4'));
check('Eine Runde ohne Zeitfenster wird als "Jederzeit" ausgewiesen, nicht als leeres Feld',
  (await page.textContent('.rgs-fakten')).includes('Jederzeit'));
check('KRITISCH: Beschriftung steht ÜBER dem Wert, nicht darunter (CLAUDE.md)',
  await page.evaluate(() => {
    const lb = document.querySelector('.rgs-fakt-lb').getBoundingClientRect().top;
    const wert = document.querySelector('.rgs-fakt-wert').getBoundingClientRect().top;
    return lb < wert;
  }));
check('Beide Kennzahlen folgen demselben Muster und derselben Schriftgrösse (CLAUDE.md)',
  await page.evaluate(() => {
    const g = [...document.querySelectorAll('.rgs-fakt-wert')].map(e => getComputedStyle(e).fontSize);
    return g.length === 2 && g[0] === g[1];
  }));

// ══════════ START ERST AUF KNOPFDRUCK ═════════════════════════════════
check('Der Startknopf steht am Fuss der Seite', await page.isVisible('#rgsStartBtn'));
rufe = [];
await page.click('#rgsStartBtn');
await page.waitForTimeout(400);
check('KRITISCH: erst der Knopf löst den Start aus, mit der richtigen vorlage_id',
  rufe.some(r => r.p.includes('mein_rundgang_spontan_starten') && r.body.vorlage_id === 501));

// ══════════ LEERE RUNDE: WARNUNG STATT STILLER LEERE ══════════════════
await page.evaluate(() => { blattZu(); rgSeiteZu(); });
await page.evaluate(() => rundgangUebersichtOeffnen());
await page.waitForTimeout(300);
await page.click('#blBody button:has-text("Leere Runde")');
await page.waitForTimeout(400);
check('KRITISCH: eine Runde ohne zugeordnete Kontrollpunkte warnt sichtbar VOR dem Start',
  await page.isVisible('#rgsWarnLeer'));
check('Die Warnung nennt die Ursache (fehlende Zuordnung), nicht nur "keine Daten"',
  (await page.textContent('#rgsWarnLeer')).includes('zugeordnet'));
check('Die Anzahl 0 wird als solche ausgewiesen, nicht verschwiegen',
  (await page.textContent('.rgs-fakten')).includes('0'));
check('Das Zeitfenster dieser Runde steht als Uhrzeit da',
  (await page.textContent('.rgs-fakten')).includes('06:00'));
check('Ohne Ansprechpartner erscheint ein erklärender Satz statt einer leeren Fläche',
  (await page.textContent('#rgsKlappAp .rgs-klapp-bd')).includes('keine Ansprechperson'));

// ══════════ ZURÜCK ════════════════════════════════════════════════════
// Die Groesse wird gemessen, SOLANGE die Seite offen ist -- eine
// geschlossene Seite hat display:none und liefert 0x0, womit die Pruefung
// nichts mehr aussagen wuerde.
check('Der Zurück-Pfeil ist mindestens 44px gross (CLAUDE.md)',
  await page.evaluate(() => {
    const b = document.getElementById('rgsZurueck').getBoundingClientRect();
    return b.height >= 44 && b.width >= 44;
  }));
await page.click('#rgsZurueck');
await page.waitForTimeout(250);
check('KRITISCH: der Zurück-Pfeil schliesst die Seite wieder',
  !(await page.isVisible('#rgSeite')));

// ══════════ SCHUBLADE LIEGT ÜBER DER SEITE ════════════════════════════
// Die Grundabfrage ausserhalb des Zeitfensters (ENT-279) ist eine Schublade.
// Sie muss über dem Einsatzmodus erscheinen, sonst wäre sie unbedienbar.
await page.evaluate(() => rundgangUebersichtOeffnen());
await page.waitForTimeout(300);
await page.click('#blBody button:has-text("Leere Runde")');
await page.waitForTimeout(400);
await page.click('#rgsStartBtn');
await page.waitForTimeout(300);
check('KRITISCH: die Grundabfrage ausserhalb des Zeitfensters erscheint weiterhin (ENT-279 unverändert)',
  await page.isVisible('#rfsGrund'));
check('KRITISCH: sie liegt ÜBER dem Einsatzmodus, nicht darunter',
  await page.evaluate(() => {
    const z = s => Number(getComputedStyle(document.querySelector(s)).zIndex);
    return z('#blatt') > z('#rgSeite');
  }));

// ══════════ KEIN SEITEN-SCROLL, DESKTOP MITGEPRÜFT ════════════════════
check('KRITISCH: kein waagrechter Seiten-Scroll bei 390px', await page.evaluate(() =>
  document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));

await page.evaluate(() => { blattZu(); });
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(250);
check('Am Desktop bleibt die Seite vollständig bedienbar',
  await page.isVisible('#rgsStartBtn') && await page.isVisible('.rgs-objekt'));
// Erste Fassung lief hier als EINZIGER Bereich der App über die volle
// Bildschirmbreite -- mit einem 1400px breiten "Rundgang starten". Die App
// hält sonst überall 560px zentriert (Media Query ab 700px).
check('KRITISCH: am Desktop bleibt die Seite auf App-Breite und wird nicht in die Breite gezogen',
  await page.evaluate(() => {
    const s = document.getElementById('rgSeite').getBoundingClientRect();
    const app = document.getElementById('app').getBoundingClientRect();
    return Math.abs(s.width - app.width) <= 1 && s.width <= 561;
  }));
check('Sie steht dabei mittig, nicht am linken Rand (CLAUDE.md: mittig heisst mittig)',
  await page.evaluate(() => {
    const s = document.getElementById('rgSeite').getBoundingClientRect();
    return Math.abs((window.innerWidth - s.width) / 2 - s.left) <= 1;
  }));
check('KRITISCH: am Desktop kein waagrechter Seiten-Scroll', await page.evaluate(() =>
  document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
await page.screenshot({ path: `${OUT}/rgs-02-desktop.png` });

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
