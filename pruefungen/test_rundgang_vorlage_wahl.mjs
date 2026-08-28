// Auswahl der Kontrollrunde beim Rundgang-Start (ENT-204).
//
// Der eigentliche Rechenkern (Fremdobjekt-Pruefung, Vorlagen-Filter bei
// Restliste/Fortschritt) laeuft echt gegen SQLite in pruef_rundgang.php --
// hier nur, dass die App abhaengig von der Anzahl verfuegbarer Kontroll-
// runden das Richtige tut:
//   0 Vorlagen -> unveraendertes Verhalten von vor ENT-204, kein Zwischen-
//                 schritt, kein vorlage_id im Aufruf.
//   1 Vorlage  -> ebenfalls kein Zwischenschritt (keine echte Entscheidung),
//                 aber die einzige Vorlage wird automatisch gesendet.
//   2+ Vorlagen -> ein Auswahlbildschirm mit einem Knopf je Vorlage; erst der
//                 Klick loest mein_rundgang_starten.php mit der gewaehlten
//                 vorlage_id aus.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const tag = n => iso(new Date(Date.now() + n * 864e5));
const GESTERN = tag(-1);

const KP = [{ id: 1, bezeichnung: 'Eingang', reihenfolge: 1, typ: 'geofence' }];

// Drei Einsaetze, je einer pro Fall -- gleiche Zugangsbedingungen wie in
// test_rundgang.mjs (zugesagt, nicht abgesagt, bereits begonnen, Objekt mit
// Kontrollpunkten).
const SCHICHTEN = () => ({ status: 'ok', von: tag(-30), bis: tag(90), schichten: [
  { id: 71, kunde_name: 'Kunde Keine', titel: 'Keine Vorlagen', strasse: null, ort: '4600 Musterdorf',
    einsatzart: 'Revierdienst', sparte: 'sicherheit', datum: GESTERN, von: '20:00:00', bis: '06:00:00',
    status: 'bestaetigt', bemerkung: null, zusage: 'zugesagt', objekt_name: 'Objekt Keine', objekt_id: 11,
    hat_kontrollpunkte: true, im_team: 1 },
  { id: 72, kunde_name: 'Kunde Eine', titel: 'Eine Vorlage', strasse: null, ort: '4600 Musterdorf',
    einsatzart: 'Revierdienst', sparte: 'sicherheit', datum: GESTERN, von: '20:00:00', bis: '06:00:00',
    status: 'bestaetigt', bemerkung: null, zusage: 'zugesagt', objekt_name: 'Objekt Eine', objekt_id: 12,
    hat_kontrollpunkte: true, im_team: 1 },
  { id: 73, kunde_name: 'Kunde Mehrere', titel: 'Mehrere Vorlagen', strasse: null, ort: '4600 Musterdorf',
    einsatzart: 'Revierdienst', sparte: 'sicherheit', datum: GESTERN, von: '20:00:00', bis: '06:00:00',
    status: 'bestaetigt', bemerkung: null, zusage: 'zugesagt', objekt_name: 'Objekt Mehrere', objekt_id: 13,
    hat_kontrollpunkte: true, im_team: 1 },
]});

const PROFIL = { status: 'ok', monat: { anzahl: 0, stunden: 0 }, profil: {
  name: 'm.muster', ist_admin: false, personalnummer: 'P-001',
  vorname: 'Max', nachname: 'Muster', erstellt_am: GESTERN + ' 10:00:00' } };

// objekt_id -> aktive Vorlagen, wie mein_rundgang_vorlagen.php sie liefern wuerde.
const VORLAGEN = {
  11: [],
  12: [{ id: 501, name: 'Nachtrunde' }],
  13: [{ id: 601, name: 'Öffnungsrunde' }, { id: 602, name: 'Schlusskontrolle' }],
};

let rufe = [];
let naechsteRundgangId = 900;

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

// ══════════ KEINE VORLAGE: UNVERAENDERTES VERHALTEN VON VOR ENT-204
await page.evaluate(id => blattAuf(id), 71);
await page.waitForSelector('#blRundgang button');
rufe = [];
await page.click('#blRundgang button');
await page.waitForTimeout(300);
check('mein_rundgang_vorlagen wurde abgefragt', rufe.some(r => r.p.includes('mein_rundgang_vorlagen')));
check('Kein Auswahlbildschirm -- direkt die Checkliste', await page.isVisible('#rdListe'));
const startAufrufKeine = rufe.find(r => r.p.includes('mein_rundgang_starten'));
check('KRITISCH: ohne Vorlagen wird kein vorlage_id mitgeschickt',
  startAufrufKeine && !('vorlage_id' in startAufrufKeine.body));
await page.click('#blFuss button');
await page.waitForTimeout(200);

// ══════════ GENAU EINE VORLAGE: KEINE ECHTE ENTSCHEIDUNG, DIREKT STARTEN
await page.evaluate(id => blattAuf(id), 72);
await page.waitForSelector('#blRundgang button');
rufe = [];
await page.click('#blRundgang button');
await page.waitForTimeout(300);
check('Kein Auswahlbildschirm bei nur einer Vorlage', await page.isVisible('#rdListe'));
const startAufrufEine = rufe.find(r => r.p.includes('mein_rundgang_starten'));
check('KRITISCH: die einzige Vorlage wird automatisch mitgeschickt',
  startAufrufEine && startAufrufEine.body.vorlage_id === 501);
await page.click('#blFuss button');
await page.waitForTimeout(200);

// ══════════ MEHRERE VORLAGEN: AUSWAHLBILDSCHIRM
await page.evaluate(id => blattAuf(id), 73);
await page.waitForSelector('#blRundgang button');
rufe = [];
await page.click('#blRundgang button');
await page.waitForTimeout(300);
check('KRITISCH: bei mehreren Vorlagen erscheint ein Auswahlbildschirm statt der Checkliste',
  !(await page.isVisible('#rdListe')) && await page.isVisible('#rdVorlageListe'));
check('Kein Startaufruf, bevor gewaehlt wurde',
  !rufe.some(r => r.p.includes('mein_rundgang_starten')));
const wahlText = await page.textContent('#rdVorlageListe');
check('Beide Vorlagen stehen als Knopf da', wahlText.includes('Öffnungsrunde') && wahlText.includes('Schlusskontrolle'));

// "Zurueck" fuehrt zur Schicht zurueck, ohne zu starten.
await page.click('#blFuss button');
await page.waitForTimeout(200);
check('Zurueck aus der Auswahl startet nichts', !rufe.some(r => r.p.includes('mein_rundgang_starten')));
check('Zurueck zeigt wieder die Schicht (Rundgang-Knopf erneut da)', await page.isVisible('#blRundgang button'));

// Erneut oeffnen und diesmal wirklich waehlen.
await page.click('#blRundgang button');
await page.waitForTimeout(300);
await page.click('#rdVorlageListe button:has-text("Schlusskontrolle")');
await page.waitForTimeout(300);
const startAufrufMehrere = rufe.find(r => r.p.includes('mein_rundgang_starten'));
check('KRITISCH: die angeklickte Vorlage wird gesendet, nicht die andere',
  startAufrufMehrere && startAufrufMehrere.body.vorlage_id === 602);
check('Nach der Wahl erscheint die Checkliste', await page.isVisible('#rdListe'));

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
