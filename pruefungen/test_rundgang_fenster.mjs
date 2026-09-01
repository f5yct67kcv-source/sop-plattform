// Ausfuehrungsfenster einer Kontrollrunde (ENT-279).
//
// Der eigentliche Rechenkern (rundgang_im_fenster(), inkl. Toleranzgrenzen
// und Mitternacht-Ueberlauf) laeuft echt in pruef_rundgang.php -- hier nur,
// dass die App abhaengig vom Fenster der gewaehlten Vorlage das Richtige
// tut:
//   Vorlage OHNE Fenster + Einsatz noch nicht begonnen -> unveraendertes
//     Verhalten von vor ENT-279, kein Rundgang-Knopf.
//   Vorlage MIT Fenster, "jetzt" liegt darin -> Rundgang-Knopf erscheint
//     schon VOR der Einsatz-Sollzeit, Start ohne Zwischenschritt.
//   Vorlage MIT Fenster, "jetzt" liegt ausserhalb -> Start verlangt zuerst
//     einen Pflichtgrund (kein Senden ohne Auswahl), erst dann der Aufruf.
// Die Uhr ist fest eingefroren (page.clock), damit die Pruefung unabhaengig
// von der tatsaechlichen Tageszeit beim Ausfuehren immer dasselbe Ergebnis
// liefert -- gleiches Prinzip wie das feste Testdatum bei test_datumsfest.mjs,
// nur fuer die Uhrzeit statt das Kalenderdatum.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

// Eingefroren auf 22:00 an einem beliebigen, weit in der Zukunft liegenden
// Tag -- die Schichten unten liegen an genau diesem Datum.
const HEUTE = '2026-06-15';
const JETZT = new Date(`${HEUTE}T22:00:00`);

// von/bis spiegeln nur den Anfrage-Zeitraum, wie ihn meine_schichten.php
// zurueckgibt -- die Suite prueft nie gegen diese beiden Werte selbst. Aus
// HEUTE abgeleitet statt ein zweites festes Datum zu nennen (test_datumsfest.mjs).
const BIS_ANFRAGE = new Date(`${HEUTE}T00:00:00`);
BIS_ANFRAGE.setDate(BIS_ANFRAGE.getDate() + 90);
const SCHICHTEN = () => ({ status: 'ok', von: HEUTE, bis: BIS_ANFRAGE.toISOString().slice(0, 10), schichten: [
  // Kein Fenster an der Vorlage des Objekts -- Einsatz beginnt erst um
  // 23:30, also klar nach "jetzt" (22:00). Regressionsfall: muss weiterhin
  // gesperrt bleiben.
  { id: 81, kunde_name: 'Kunde Ohne', titel: 'Ohne Fenster', strasse: null, ort: '4600 Musterdorf',
    einsatzart: 'Revierdienst', sparte: 'sicherheit', datum: HEUTE, von: '23:30:00', bis: '23:45:00',
    status: 'bestaetigt', bemerkung: null, zusage: 'zugesagt', objekt_name: 'Objekt Ohne', objekt_id: 21,
    hat_kontrollpunkte: true, hat_zeitfenster: false, im_team: 1 },
  // Zwei Vorlagen am selben Objekt: eine mit Fenster 21:00-23:00 (bei
  // "jetzt" 22:00 also INNERHALB), eine mit Fenster 06:00-07:00 (klar
  // AUSSERHALB). Einsatz beginnt ebenfalls erst um 23:30 -- ohne die
  // Fenster-Erweiterung waere hier kein Start moeglich.
  { id: 82, kunde_name: 'Kunde Mit', titel: 'Mit Fenster', strasse: null, ort: '4600 Musterdorf',
    einsatzart: 'Revierdienst', sparte: 'sicherheit', datum: HEUTE, von: '23:30:00', bis: '23:45:00',
    status: 'bestaetigt', bemerkung: null, zusage: 'zugesagt', objekt_name: 'Objekt Mit', objekt_id: 22,
    hat_kontrollpunkte: true, hat_zeitfenster: true, im_team: 1 },
]});

const PROFIL = { status: 'ok', monat: { anzahl: 0, stunden: 0 }, profil: {
  name: 'm.muster', ist_admin: false, personalnummer: 'P-001',
  vorname: 'Max', nachname: 'Muster', erstellt_am: HEUTE + ' 10:00:00' } };

const KP = [{ id: 1, bezeichnung: 'Eingang', reihenfolge: 1, typ: 'geofence' }];

const VORLAGEN = {
  21: [],
  22: [
    { id: 901, name: 'Nachtrunde (im Fenster)', fenster_von: '21:00:00', fenster_bis: '23:00:00' },
    { id: 902, name: 'Frührunde (ausserhalb)', fenster_von: '06:00:00', fenster_bis: '07:00:00' },
  ],
};

let rufe = [];
let naechsteRundgangId = 950;

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
await page.clock.install({ time: JETZT });

await page.route('**/api/**', route => {
  const req = route.request();
  const url = new URL(req.url());
  const p = url.pathname.split('/api/')[1];
  let body = null;
  try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch { body = req.postData(); }
  rufe.push({ p, body, query: Object.fromEntries(url.searchParams) });
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });

  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'm.muster', ist_admin: false });
  if (p.includes('meine_schichten')) return send(SCHICHTEN());
  if (p.includes('mein_profil')) return send(PROFIL);
  if (p.includes('rapport_list')) return send({ status: 'ok', rapporte: [] });
  if (p.includes('mein_rundgang_offen')) return send({ status: 'ok', rundgang: null });

  if (p.includes('mein_rundgang_vorlagen')) {
    const einsatzId = Number(url.searchParams.get('einsatz_id'));
    const e = SCHICHTEN().schichten.find(x => x.id === einsatzId);
    return send({ status: 'ok', vorlagen: VORLAGEN[e ? e.objekt_id : 0] || [] });
  }
  if (p.includes('mein_rundgang_starten')) {
    return send({ status: 'ok', rundgang_id: ++naechsteRundgangId, kontrollpunkte: KP });
  }
  return send({ status: 'ok' });
});

await page.goto(`file://${WURZEL}/app.html`);
await page.fill('#gName', 'm.muster'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('.app.on');
await page.waitForTimeout(400);

// ══════════ REGRESSION: OHNE FENSTER BLEIBT DIE EINSATZ-SOLLZEIT MASSGEBLICH
await page.evaluate(id => blattAuf(id), 81);
await page.waitForTimeout(300);
check('KRITISCH: ohne Fenster an der Vorlage bleibt der Rundgang vor der Sollzeit gesperrt (unveraendertes Verhalten)',
  !(await page.isVisible('#blRundgang button')));

// ══════════ MIT FENSTER, "JETZT" INNERHALB: KNOPF SCHON VOR DER SOLLZEIT
await page.evaluate(id => blattAuf(id), 82);
await page.waitForTimeout(300);
check('KRITISCH: mit Fenster erscheint der Rundgang-Knopf schon vor der Einsatz-Sollzeit',
  await page.isVisible('#blRundgang button'));

rufe = [];
await page.click('#blRundgang button');
await page.waitForTimeout(300);
check('Bei zwei Vorlagen erscheint zuerst die Auswahl', await page.isVisible('#rdVorlageListe'));
await page.click('#rdVorlageListe button:has-text("Nachtrunde")');
await page.waitForTimeout(300);
check('KRITISCH: eine Vorlage INNERHALB ihres Fensters startet sofort, ohne Grundabfrage',
  await page.isVisible('#rdListe'));
const startInnerhalb = rufe.find(r => r.p.includes('mein_rundgang_starten'));
check('KRITISCH: kein ausnahme_grund, wenn innerhalb des Fensters gestartet wurde',
  startInnerhalb && !('ausnahme_grund' in startInnerhalb.body) && startInnerhalb.body.vorlage_id === 901);

// ══════════ MIT FENSTER, "JETZT" AUSSERHALB: PFLICHTGRUND ZUERST
// Direkt neu geoeffnet statt ueber einen Fuss-Knopf navigiert -- nach dem
// erfolgreichen Start oben zeigt der Fuss "Beenden", keinen Rueckweg. Ein
// frischer blattAuf() ist derselbe robuste Weg wie zwischen den Schichten
// oben, unabhaengig vom internen Zustand des zuvor gestarteten Rundgangs.
await page.evaluate(id => blattAuf(id), 82);
await page.waitForTimeout(300);
rufe = [];
await page.click('#blRundgang button');
await page.waitForTimeout(300);
await page.click('#rdVorlageListe button:has-text("Frührunde")');
await page.waitForTimeout(300);
check('KRITISCH: eine Vorlage AUSSERHALB ihres Fensters fragt zuerst einen Grund ab, statt sofort zu starten',
  !(await page.isVisible('#rdListe')) && await page.isVisible('#rfGrund'));
check('Kein Startaufruf, bevor ein Grund gewaehlt wurde',
  !rufe.some(r => r.p.includes('mein_rundgang_starten')));

// Ohne Auswahl abschicken -> Fehleranzeige, kein Aufruf.
await page.click('#rfBtn');
await page.waitForTimeout(200);
check('KRITISCH: ohne gewaehlten Grund erscheint eine Fehlermeldung statt eines Aufrufs',
  await page.isVisible('#rfErr') && !rufe.some(r => r.p.includes('mein_rundgang_starten')));

// Grund waehlen und senden.
await page.selectOption('#rfGrund', 'kurzfristige_umdisposition');
await page.click('#rfBtn');
await page.waitForTimeout(300);
const startAussen = rufe.find(r => r.p.includes('mein_rundgang_starten'));
check('KRITISCH: der gewaehlte Grund wird mitgeschickt',
  startAussen && startAussen.body.ausnahme_grund === 'kurzfristige_umdisposition' && startAussen.body.vorlage_id === 902);
check('Nach dem Senden erscheint die Checkliste', await page.isVisible('#rdListe'));

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
