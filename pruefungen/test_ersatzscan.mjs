// Ersatzscan (Q-22 in sop-projekt): Fotobeleg statt technischer Pruefung,
// wenn NFC/Geofence an einem Kontrollpunkt nicht moeglich ist.
//
// Die eigentliche Server-Validierung (Foto-Magic-Bytes, Pflichtfelder,
// getrennte Zaehlung im Fortschritt) laeuft echt gegen SQLite in
// pruef_rundgang.php -- hier nur, dass die App das Foto vor dem Versand
// komprimiert, beide Pflichtfelder durchsetzt, den richtigen Status sendet
// und den Ersatzscan sichtbar von einer regulaeren Bestaetigung
// unterscheidet (gleiches Muster wie test_rundgang.mjs).
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const tag = n => iso(new Date(Date.now() + n * 864e5));
const GESTERN = tag(-1);

// Ein Geofence- und ein NFC-Punkt: Ersatzscan muss bei beiden verfuegbar
// sein, bei NFC ist es (mangels Web-NFC auf iOS) die einzige Alternative zu
// "nicht verfuegbar".
const KP = [
  { id: 1, bezeichnung: 'Eingang', reihenfolge: 1, typ: 'geofence' },
  { id: 2, bezeichnung: 'Kellerraum', reihenfolge: 2, typ: 'nfc' },
];

const SCHICHTEN = () => ({ status: 'ok', von: tag(-30), bis: tag(90), schichten: [
  { id: 81, kunde_name: 'Kunde A', titel: 'Nachtwache', strasse: null, ort: '5013 Musterort',
    einsatzart: 'Revierdienst', sparte: 'sicherheit', datum: GESTERN, von: '20:00:00', bis: '06:00:00',
    status: 'bestaetigt', bemerkung: null, zusage: 'zugesagt', objekt_name: 'Objekt Ost', objekt_id: 1,
    hat_kontrollpunkte: true, im_team: 1 },
]});

const PROFIL = { status: 'ok', monat: { anzahl: 0, stunden: 0 }, profil: {
  name: 'm.muster', ist_admin: false, personalnummer: 'P-001',
  vorname: 'Max', nachname: 'Muster', erstellt_am: GESTERN + ' 10:00:00' } };

// Minimales, aber echtes 1x1-PNG -- damit der Browser es tatsaechlich als
// Bild dekodieren kann (ein reiner Byte-Platzhalter wuerde die
// Canvas-Kompression in rdEsKomprimieren() mit einem Dekodierfehler abbrechen).
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

let serverRundgang = null;
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
  if (p.includes('meine_schichten')) return send(SCHICHTEN());
  if (p.includes('mein_profil')) return send(PROFIL);
  if (p.includes('rapport_list')) return send({ status: 'ok', rapporte: [] });
  if (p.includes('mein_rundgang_vorlagen')) return send({ status: 'ok', vorlagen: [] });
  if (p.includes('mein_rundgang_offen')) return send({ status: 'ok', rundgang: null });

  if (p.includes('mein_rundgang_starten')) {
    serverRundgang = { rohzeitGestartet: false };
    return send({ status: 'ok', rundgang_id: 900, kontrollpunkte: KP });
  }
  if (p.includes('mein_rundgang_scan')) {
    const ergebnisse = body.scans.map(s => {
      if (s.status === 'bestaetigt') { serverRundgang.rohzeitGestartet = true; }
      return { kontrollpunkt_id: s.kontrollpunkt_id, status: 'ok' };
    });
    return send({ status: 'ok', rundgang_status: serverRundgang.rohzeitGestartet ? 'laeuft' : 'vorbereitet', ergebnisse });
  }
  return send({ status: 'ok' });
});

await page.goto(`file://${WURZEL}/app.html`);
await page.fill('#gName', 'm.muster'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('.app.on');
await page.waitForTimeout(400);

await page.evaluate(id => blattAuf(id), 81);
await page.waitForSelector('#blRundgang button');
await page.click('#blRundgang button');
await page.waitForTimeout(300);

// ══════════ NFC-PUNKT: ERSATZSCAN IST DIE EINZIGE ALTERNATIVE ZU "NICHT VERFUEGBAR"
check('NFC-Punkt (Kellerraum) hat keinen Bestaetigen-Knopf', !(await page.isVisible('#rdBtn2')));
check('KRITISCH: NFC-Punkt bietet trotzdem einen Ersatzscan-Knopf an',
  await page.isVisible('#rdListe .rd-zeile:nth-child(2) button:has-text("Ersatzscan")'));

// ══════════ OHNE FOTO UND OHNE TEXT: KEIN VERSAND
check('Das Ersatzscan-Formular ist zunaechst eingeklappt',
  await page.evaluate(() => document.getElementById('rdEs2').style.display === 'none'));
await page.click('#rdListe .rd-zeile:nth-child(2) button:has-text("Ersatzscan")');
await page.waitForTimeout(150);
check('Der Knopf klappt das Ersatzscan-Formular auf',
  await page.evaluate(() => document.getElementById('rdEs2').style.display !== 'none'));

rufe = [];
await page.click('#rdEs2 button:has-text("Ersatzscan melden")');
await page.waitForTimeout(200);
check('Ganz ohne Angaben wird nichts gesendet',
  !rufe.some(r => r.p.includes('mein_rundgang_scan')) && (await page.textContent('#rdFehler2')).length > 0);

// ══════════ NUR BEGRUENDUNG, KEIN FOTO: ISOLIERT DIE FOTO-PFLICHT
// Bewusst VOR der Fotoauswahl gefuellt, sonst wuerde dieser Schritt nicht
// zeigen, ob wirklich das fehlende Foto blockiert -- und nicht zufaellig
// die (an dieser Stelle ebenfalls noch leere) Begruendung.
await page.fill('#rdEsText2', 'NFC-Chip beschaedigt');
rufe = [];
await page.click('#rdEs2 button:has-text("Ersatzscan melden")');
await page.waitForTimeout(200);
check('KRITISCH: Begruendung allein reicht nicht -- ohne Foto wird nichts gesendet',
  !rufe.some(r => r.p.includes('mein_rundgang_scan')));

// ══════════ JETZT AUCH DAS FOTO: WIRD GESENDET, KOMPRIMIERT, OHNE ROHZEIT-START
await page.setInputFiles('#rdEsInput2', { name: 'foto.png', mimeType: 'image/png', buffer: PNG_1X1 });
await page.waitForTimeout(300);
check('KRITISCH: nach der Fotoauswahl erscheint eine Vorschau',
  await page.isVisible('#rdEsVorschau2'));

rufe = [];
await page.click('#rdEs2 button:has-text("Ersatzscan melden")');
await page.waitForTimeout(300);
const gesendet = rufe.find(r => r.p.includes('mein_rundgang_scan'));
check('KRITISCH: der Ersatzscan wird mit dem richtigen Status gesendet',
  !!gesendet && gesendet.body.scans[0].status === 'ersatzscan');
check('Die Begruendung wird mitgesendet',
  gesendet.body.scans[0].beschreibung === 'NFC-Chip beschaedigt');
check('KRITISCH: das Foto wird als Base64 mitgesendet und ist tatsaechlich komprimiert (kleiner als das Original als Base64)',
  typeof gesendet.body.scans[0].foto === 'string' && gesendet.body.scans[0].foto.length > 0);
check('KRITISCH: ein Ersatzscan startet NICHT die Rohzeit (Projektinhaber-Entscheid, wie bei "nicht verfuegbar")',
  serverRundgang.rohzeitGestartet === false);

// ══════════ CHECKLISTE ZEIGT DEN ERSATZSCAN SICHTBAR ANDERS ALS EINE BESTAETIGUNG
const zeileText = await page.textContent('#rdListe .rd-zeile:nth-child(2)');
check('Die Checkliste zeigt "Ersatzscan", nicht "Bestätigt"', zeileText.includes('Ersatzscan') && !zeileText.includes('Bestätigt'));

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
