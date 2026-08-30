// Briefkopf fuer den Rapport-Ausdruck und Rechnungsadresse am Kunden (ENT-155).
//
// WORAUF DIESE SUITE BESONDERS ACHTET:
//
// 1. Der Rapport-Ausdruck geht AN KUNDEN. Solange der Briefkopf nicht
//    gepflegt ist, darf dort kein erfundener Firmenname stehen -- lieber eine
//    leere Ecke als eine falsche Angabe auf einem fremden Schreibtisch.
//
// 2. Die Tabelle rapporte traegt KEIN kunde_id, nur den Kundennamen als Text.
//    Verlaesslich verknuepft ist nur, was aus einer Schicht entstanden ist --
//    rapport.einsatz_id -> einsaetze.kunde_id. Diesen Weg geht der SERVER
//    (rapport_list.php) und liefert die Stammdaten am Rapport mit; die
//    Oberflaeche sucht sie NICHT aus den Listen einsaetze/kunden zusammen,
//    weil die dort erst beim Oeffnen ihrer Ansicht geladen werden -- beim
//    Bauen dieser Aenderung genau so aufgefallen: die Kundennummer stand je
//    nach zuvor besuchter Ansicht mal auf dem Blatt und mal nicht.
//    Ueber Namensgleichheit wird NIE geraten: der Treffer landet auf einem
//    Beleg, der Richtung Rechnung geht.
//
// 3. Die abweichende Rechnungsadresse hat KEINEN Schalter "abweichend
//    ja/nein". Gefuellt heisst abweichend, leer heisst gleich. Ein Schalter
//    koennte auf "ja" stehen, waehrend die Felder leer sind -- dann stuende
//    auf dem Beleg eine leere Adresse.
//
// 4. Das Logo wird beim Anmelden geholt, nicht beim Drucken: window.print()
//    wartet nicht auf einen laufenden Abruf, und dann fehlte der Kopf genau
//    auf dem Blatt.
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const HEUTE = iso(new Date());

// ══════════════════════════════════════════════════════════════════════════
// TEIL 1 — Endpunkt und Schema (Quelltext)
// ══════════════════════════════════════════════════════════════════════════
const BET = readFileSync(`${WURZEL}/backend/api/betrieb.php`, 'utf8');
const EINR = readFileSync(`${WURZEL}/backend/api/planung_einrichten.php`, 'utf8');
const LIST = readFileSync(`${WURZEL}/backend/api/kunden_list.php`, 'utf8');
const KUN = readFileSync(`${WURZEL}/backend/kunden.php`, 'utf8');
const RLIST = readFileSync(`${WURZEL}/backend/api/rapport_list.php`, 'utf8');

check('KRITISCH: die Tabelle betrieb steht im Schema',
  /CREATE TABLE IF NOT EXISTS betrieb/.test(EINR));
check('KRITISCH: sie laesst nur EINE Zeile zu (id als Primaerschluessel mit Vorgabe 1)',
  /id TINYINT UNSIGNED NOT NULL PRIMARY KEY DEFAULT 1/.test(EINR));
check('Das Logo liegt als LONGBLOB in der Datenbank, nicht als Pfad im Dateisystem',
  /logo LONGBLOB NULL/.test(EINR) && !/logo_pfad/.test(EINR));
check('KRITISCH: die Betriebszeile wird LEER angelegt — keine erfundenen Firmenangaben',
  /INSERT INTO betrieb \(id, firma, zusatz\) VALUES \(1, '', ''\)/.test(EINR));

check('KRITISCH: Aendern verlangt das Recht "betrieb"', /require_recht\(\$user, 'betrieb'\)/.test(BET));
check('KRITISCH: Lesen steht vor der Rechtepruefung — wer drucken darf, braucht den Kopf',
  BET.indexOf("REQUEST_METHOD'] === 'GET'") < BET.indexOf("require_recht($user, 'betrieb')"));
check('KRITISCH: das Logo ist auf 512 KB begrenzt', /LOGO_MAX = 512 \* 1024/.test(BET));
check('KRITISCH: nur Bildformate werden angenommen',
  /LOGO_MIME_ERLAUBT = \['image\/png', 'image\/jpeg', 'image\/svg\+xml', 'image\/webp'\]/.test(BET));
check('Ein unerlaubtes Format wird abgewiesen, nicht gespeichert',
  /!in_array\(\$mime, LOGO_MIME_ERLAUBT, true\)/.test(BET));
check('KRITISCH: die Groesse wird gegen die ROHE Datei geprueft, nicht gegen base64',
  /\$roh = base64_decode\([\s\S]*?strlen\(\$roh\) > LOGO_MAX/.test(BET));
check('KRITISCH: eine fehlende Betriebszeile wird angelegt — ein UPDATE ins Leere meldet sonst Erfolg',
  /INSERT IGNORE INTO betrieb \(id, firma, zusatz\)/.test(BET));
check('Das Logo geht als Daten-URL heraus — der Ausdruck braucht keinen zweiten Abruf',
  /'data:' \. \$r\['logo_mime'\] \. ';base64,' \. base64_encode\(\$roh\)/.test(BET));

// KRITISCH (ENT-245): der echte Server speichert Hauptdomizil in einem
// EIGENEN, frueh zurueckkehrenden Zweig -- nicht im generischen
// Textfelder-Zweig, der firma/zusatz/fusszeile/qr_* mitschreibt. Ohne diese
// Trennung wuerde ein Speichern des Hauptdomizils (das Firma/Zusatz gar
// nicht kennt) den bestehenden Briefkopf mit leeren Werten ueberschreiben --
// derselbe Fehler, den der Mock-Server unten fuer die Playwright-Ebene
// nachstellt. Die Reihenfolge im Quelltext MUSS stimmen: array_key_exists
// vor der ersten Verwendung von $firma.
check('KRITISCH: betrieb.php hat einen eigenen Speicherzweig fuer domizil_strasse',
  /array_key_exists\('domizil_strasse', \$in\)/.test(BET));
check('KRITISCH: dieser Zweig kehrt frueh zurueck (json_response vor dem generischen UPDATE)',
  (() => {
    const posZweig = BET.indexOf("array_key_exists('domizil_strasse'");
    const posFirma = BET.indexOf('$firma  = trim');
    return posZweig > -1 && posFirma > -1 && posZweig < posFirma;
  })());

check('KRITISCH: der Server verknuepft den Kunden ueber die SCHICHT, nicht ueber den Namen',
  /LEFT JOIN einsaetze e ON e\.id = r\.einsatz_id/.test(RLIST)
  && /LEFT JOIN kunden k ON k\.id = e\.kunde_id/.test(RLIST));
check('KRITISCH: nirgends wird auf den Kundennamen verknuepft — Namen wiederholen und aendern sich',
  !/JOIN kunden[\s\S]{0,80}k\.name\s*=/.test(RLIST) && !/ON\s+k\.name/.test(RLIST));
check('KRITISCH: die Kundenstammdaten gehen nur an den Zugang, der ohnehin alle Rapporte sieht',
  /if \(darf\(\$user, 'abgleich'\)\)[\s\S]{0,200}\$kundenFelder/.test(RLIST)
  && /\} else \{[\s\S]{0,200}\$basis \. \$von/.test(RLIST));

check('KRITISCH: die sechs Rechnungsadress-Spalten werden nachgetragen',
  ['re_name', 're_zusatz', 're_strasse', 're_hausnummer', 're_plz', 're_ort']
    .every(s => new RegExp(`\\['kunden', '${s}',`).test(EINR)));
check('KRITISCH: es gibt KEINEN Schalter "abweichende Rechnungsadresse" — gefuellt heisst abweichend',
  !/re_abweichend|rechnung_abweichend/.test(EINR) && !/re_abweichend/.test(KUN));
check('KRITISCH: die Kundenliste liefert die Rechnungsadresse mit',
  /re_name, re_zusatz, re_strasse, re_hausnummer, re_plz, re_ort/.test(LIST));
check('KRITISCH: das Speichern des Kunden kennt die Felder ebenfalls',
  ['re_name', 're_zusatz', 're_strasse', 're_hausnummer', 're_plz', 're_ort']
    .every(s => new RegExp(`'${s}' => \\$wert\\('${s}'\\)`).test(KUN)));

// ══════════════════════════════════════════════════════════════════════════
// TEIL 2 — Oberflaeche und Ausdruck
// ══════════════════════════════════════════════════════════════════════════
const MA = [{ id: 1, name: 'adrian', vorname: 'Adrian', nachname: 'Von Arb', aktiv: 1, ist_admin: 1 }];
const KUNDEN = [
  // 1 — gewoehnliche Adresse, KEINE abweichende Rechnungsadresse
  { id: 1, kundennummer: 'K-0001', name: 'pzu Consulting GmbH', strasse: 'Mustergasse',
    hausnummer: '2', adresszusatz: null, plz: '8200', ort: 'Schaffhausen', aktiv: 1,
    re_name: null, re_zusatz: null, re_strasse: null, re_hausnummer: null, re_plz: null, re_ort: null },
  // 2 — mit abweichender Rechnungsadresse
  { id: 2, kundennummer: 'K-0002', name: 'Strabag AG', strasse: 'Kantonsstrasse',
    hausnummer: '3', adresszusatz: null, plz: '6000', ort: 'Luzern', aktiv: 1,
    re_name: 'Strabag AG, Buchhaltung', re_zusatz: 'Postfach 44', re_strasse: 'Finanzweg',
    re_hausnummer: '9', re_plz: '8005', re_ort: 'Zürich' },
];
const EINSAETZE = [
  { id: 500, kunde_id: 1, kunde_name: 'pzu Consulting GmbH', titel: null, strasse: 'Mustergasse 2',
    ort: '8200 Schaffhausen', einsatzart: 'Verkehrsdienst', datum: HEUTE, von: '07:15:00',
    bis: '15:30:00', bedarf: 1, status: 'abgeschlossen', mitarbeiter: [], objekt_id: null },
  { id: 501, kunde_id: 2, kunde_name: 'Strabag AG', titel: null, strasse: 'Kantonsstrasse 3',
    ort: '6000 Luzern', einsatzart: 'Verkehrsdienst', datum: HEUTE, von: '08:00:00',
    bis: '12:00:00', bedarf: 1, status: 'abgeschlossen', mitarbeiter: [], objekt_id: null },
];
const RAPPORTE = [
  // 10 — haengt ueber einsatz_id sauber am Kunden 1
  { id: 10, datum: HEUTE, mitarbeiter_id: 1, einsatz_id: 500, mitarbeiter: 'adrianvonarb',
    kunde_id: 1, kunde_nr: 'K-0001', k_name: 'pzu Consulting GmbH', k_strasse: 'Mustergasse',
    k_hausnummer: '2', k_adresszusatz: null, k_plz: '8200', k_ort: 'Schaffhausen',
    re_name: null, re_zusatz: null, re_strasse: null, re_hausnummer: null, re_plz: null, re_ort: null,
    kunde: 'pzu Consulting GmbH', strasse: 'Mustergasse 2', ort: '8200 Schaffhausen',
    auftrag_nr: null, einsatzart: 'Verkehrsdienst', von: '07:15:00', bis: '15:15:00',
    pause_min: 30, netto_h: 7.5, unterzeichner: 'M. Beispiel', unterschrift: null,
    bemerkung: null, erfasst_am: HEUTE + ' 15:17:00' },
  // 11 — von Hand erfasst, OHNE einsatz_id: nur der Kundenname als Text.
  //      Hier darf NICHT ueber den Namen auf Kunde 1 geschlossen werden.
  { id: 11, datum: HEUTE, mitarbeiter_id: 1, einsatz_id: null, mitarbeiter: 'adrianvonarb',
    kunde_id: null, kunde_nr: null,
    kunde: 'pzu Consulting GmbH', strasse: 'Mustergasse 2', ort: '8200 Schaffhausen',
    auftrag_nr: null, einsatzart: 'Verkehrsdienst', von: '09:00:00', bis: '12:00:00',
    pause_min: 0, netto_h: 3, unterzeichner: null, unterschrift: null,
    bemerkung: null, erfasst_am: HEUTE + ' 12:05:00' },
  // 12 — haengt am Kunden MIT abweichender Rechnungsadresse
  { id: 12, datum: HEUTE, mitarbeiter_id: 1, einsatz_id: 501, mitarbeiter: 'adrianvonarb',
    kunde_id: 2, kunde_nr: 'K-0002', k_name: 'Strabag AG', k_strasse: 'Kantonsstrasse',
    k_hausnummer: '3', k_adresszusatz: null, k_plz: '6000', k_ort: 'Luzern',
    re_name: 'Strabag AG, Buchhaltung', re_zusatz: 'Postfach 44', re_strasse: 'Finanzweg',
    re_hausnummer: '9', re_plz: '8005', re_ort: 'Zürich',
    kunde: 'Strabag AG', strasse: 'Kantonsstrasse 3', ort: '6000 Luzern',
    auftrag_nr: 'A-77', einsatzart: 'Verkehrsdienst', von: '08:00:00', bis: '12:00:00',
    pause_min: 0, netto_h: 4, unterzeichner: null, unterschrift: null,
    bemerkung: null, erfasst_am: HEUTE + ' 12:10:00' },
  // 13 — kunde_id FEHLT, Stammfelder waeren aber gefuellt. Kann der Server so
  //      heute nicht liefern; die Fixtur haelt den Riegel in
  //      rapportRechnungsadresse() pruefbar. Ohne sie bliebe eine Gegenprobe,
  //      die den Riegel entfernt, gruen -- beim Schreiben genau so passiert.
  { id: 13, datum: HEUTE, mitarbeiter_id: 1, einsatz_id: null, mitarbeiter: 'adrianvonarb',
    kunde_id: null, kunde_nr: null, k_name: 'Fremd AG', k_strasse: 'Irrweg',
    k_hausnummer: '1', k_adresszusatz: null, k_plz: '9999', k_ort: 'Nirgendwo',
    re_name: null, re_zusatz: null, re_strasse: null, re_hausnummer: null, re_plz: null, re_ort: null,
    kunde: 'Fremd AG', strasse: 'Baustelle 5', ort: '3000 Bern',
    auftrag_nr: null, einsatzart: 'Verkehrsdienst', von: '10:00:00', bis: '11:00:00',
    pause_min: 0, netto_h: 1, unterzeichner: null, unterschrift: null,
    bemerkung: null, erfasst_am: HEUTE + ' 11:05:00' },
];

let BETRIEB = { firma: '', zusatz: '', fusszeile: null, fusszeile2: null,
  qr_iban: null, qr_strasse: null, qr_hausnummer: null, qr_plz: null, qr_ort: null, qr_iban_gueltig: false,
  logo: null, logo_mime: null, logo_groesse: null,
  domizil_strasse: null, domizil_plz: null, domizil_ort: null };
const gesendet = [];

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));

await page.route('**/api/**', route => {
  const req = route.request(), u = req.url();
  let body = null;
  try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch (e) {}
  const s = x => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) });
  if (u.includes('login')) return s({ status: 'ok', token: 't', name: 'adrian', ist_admin: true });
  if (u.includes('me.php')) return s({ status: 'ok', name: 'adrian', ist_admin: true, rollen: [], rechte: ['betrieb'] });
  if (u.includes('betrieb.php')) {
    if (body) {
      gesendet.push(body);
      if (body.logo_weg) { BETRIEB = { ...BETRIEB, logo: null, logo_mime: null, logo_groesse: null }; }
      else if (body.logo) { BETRIEB = { ...BETRIEB, logo: 'data:' + body.logo_mime + ';base64,' + body.logo, logo_mime: body.logo_mime, logo_groesse: 120 }; }
      // Eigener Zweig wie beim echten Server (betrieb.php, ENT-245): ein
      // Speichern des Hauptdomizils darf NICHT im generischen Textfelder-Zweig
      // landen, sonst ueberschreiben die dort fehlenden firma/zusatz-Schluessel
      // (undefined) den bestehenden Stand -- genau der Fehler, den die
      // Gegenprobe beim Bauen nachgestellt hat.
      else if ('domizil_strasse' in body) { BETRIEB = { ...BETRIEB,
        domizil_strasse: body.domizil_strasse || null, domizil_plz: body.domizil_plz || null,
        domizil_ort: body.domizil_ort || null }; }
      else { BETRIEB = { ...BETRIEB, firma: body.firma, zusatz: body.zusatz,
        fusszeile: body.fusszeile || null, fusszeile2: body.fusszeile2 || null,
        qr_iban: body.qr_iban || null, qr_strasse: body.qr_strasse || null,
        qr_hausnummer: body.qr_hausnummer || null, qr_plz: body.qr_plz || null,
        qr_ort: body.qr_ort || null }; }
    }
    return s({ status: 'ok', betrieb: BETRIEB });
  }
  if (u.includes('mitarbeiter_list')) return s({ status: 'ok', mitarbeiter: MA });
  if (u.includes('kunden_list')) return s({ status: 'ok', kunden: KUNDEN });
  if (u.includes('einsatz_list')) return s({ status: 'ok', einsaetze: EINSAETZE });
  if (u.includes('rapport_list')) return s({ status: 'ok', rapporte: RAPPORTE });
  if (u.includes('dashboard_stats')) return s({ status: 'ok', kpi: {}, verlauf: [], angemeldet: [],
    pro_mitarbeiter: [], letzte_rapporte: [], sperr_ereignisse: [] });
  return s({ status: 'ok', einsaetze: [], rapporte: [], objekte: [], feiertage: [], gepflegt: {},
    sperren: [], adressen: [], wege: [], fahrzeuge: [], dokumente: [], positionen: [], orte: [] });
});

await page.goto(`file://${WURZEL}/dashboard.html`);
await page.fill('#gName', 'adrian'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#shell.on'); await page.waitForTimeout(600);

// Drucken darf die Suite nicht wirklich -- window.print() haelt den Browser an.
await page.evaluate(() => { window.__gedruckt = 0; window.print = () => { window.__gedruckt++; }; });

const drucken = id => page.evaluate(i => { drawerId = i; printReport(); return $('printArea').innerHTML; }, id);

// ── Leerer Briefkopf: nichts erfinden
let html = await drucken(10);
check('KRITISCH: ohne gepflegten Briefkopf steht KEIN erfundener Firmenname auf dem Blatt',
  !/CUPI 24/.test(html));
check('Der Ausdruck entsteht trotzdem — ein fehlender Briefkopf blockiert nichts',
  /Arbeitsrapport/.test(html));
check('Ohne Fusszeile steht keine leere Fusszeile da',
  !/border-top:1px solid #E5E8EC;font-size:10.5px/.test(html));

// ── Betrieb: Kachel-Uebersicht statt einer langen Kartenspalte (ENT-210) ──
await page.evaluate(() => { go('betrieb'); });
await page.waitForTimeout(500);
check('KRITISCH: der Betriebsbereich startet auf der Kachel-Uebersicht, nicht mitten in einer Sektion',
  await page.isVisible('#bkUebersicht') && !(await page.isVisible('#bkKarte')));
// Nicht auf "4 Kacheln" pruefen: "Rollen im Betrieb" bleibt ohne das Recht
// "rechte" absichtlich weg (siehe rvLaden(), ENT-210) -- dieser Mock-Nutzer
// hat nur "betrieb". Stattdessen: mindestens die Briefkopf-Kachel steht da,
// mit einem deutlich groesseren Icon als frueher in der Kartenkopfzeile
// (dort 16px, siehe ".card-ic svg.i").
check('KRITISCH: die Briefkopf-Kachel hat ein deutlich groesseres Icon als das alte Karten-Icon',
  await page.evaluate(() => {
    const svg = document.querySelector('#bkUebersicht .bk-kachel .bk-kachel-ic svg.i');
    return !!svg && svg.getBoundingClientRect().width >= 24;
  }));
await page.click('.bk-kachel:has-text("Briefkopf für Rapporte")');
await page.waitForTimeout(200);
check('KRITISCH: die Kachel fuehrt auf die Karte "Briefkopf für Rapporte"',
  await page.isVisible('#bkKarte') && !(await page.isVisible('#bkUebersicht')));
check('Sie sagt, dass diese Angaben an Kunden herausgehen',
  /Kunden zu sehen/.test(await page.textContent('#bkKarte')));
await page.click('.bk-zurueck');
await page.waitForTimeout(150);
check('KRITISCH: "Zurück" fuehrt wieder auf die Kachel-Uebersicht',
  await page.isVisible('#bkUebersicht') && !(await page.isVisible('#bkKarte')));
await page.click('.bk-kachel:has-text("Briefkopf für Rapporte")');
await page.waitForTimeout(200);
await page.fill('#bkFirma', 'CUPI 24 GmbH');
await page.fill('#bkZusatz', 'Sicherheits- und Verkehrsdienst');
await page.fill('#bkFuss', 'Musterweg 1 · 4600 Olten · 062 000 00 00');
await page.fill('#bkFuss2', 'Zweigstelle · Bahnhofstrasse 3 · 8200 Schaffhausen');
await page.click('#bkKarte .btn-primary');
await page.waitForTimeout(400);
check('KRITISCH: der Briefkopf wird gespeichert',
  gesendet.some(b => b.firma === 'CUPI 24 GmbH' && b.zusatz === 'Sicherheits- und Verkehrsdienst'));
check('Die zweite Fusszeile wird mitgeschickt',
  gesendet.some(b => b.fusszeile2 === 'Zweigstelle · Bahnhofstrasse 3 · 8200 Schaffhausen'));

// ── QR-Rechnung: Absenderadresse und IBAN (ENT-205) ───────────────────────
check('KRITISCH: die Karte hat Felder fuer die QR-Rechnungs-Absenderadresse und -IBAN',
  await page.isVisible('#bkQrStrasse') && await page.isVisible('#bkQrHausnummer')
  && await page.isVisible('#bkQrPlz') && await page.isVisible('#bkQrOrt') && await page.isVisible('#bkQrIban'));

// Ohne Eingabe: neutraler Hinweistext, keine Bewertung.
check('Ohne IBAN steht dort kein Urteil ("gueltig"/"ungueltig")',
  !/gültig|ungültig/i.test(await page.textContent('#bkQrIbanHinweis')));

// Offensichtlich unvollstaendige IBAN.
await page.fill('#bkQrIban', 'CH93');
await page.dispatchEvent('#bkQrIban', 'input');
check('KRITISCH: eine erkennbar unvollstaendige IBAN wird sofort als ungueltig markiert',
  /nicht.*gültig|noch nicht/i.test(await page.textContent('#bkQrIbanHinweis')));

// Gueltige IBAN, aber KEINE QR-IBAN (bekanntes Wikipedia-Beispiel, IID 00762).
await page.fill('#bkQrIban', 'CH93 0076 2011 6238 5295 7');
await page.dispatchEvent('#bkQrIban', 'input');
check('KRITISCH: eine gueltige, aber normale IBAN wird als "keine QR-IBAN" erkannt, nicht stillschweigend akzeptiert',
  /keine QR-IBAN/i.test(await page.textContent('#bkQrIbanHinweis')));

// Echte QR-IBAN (oeffentliches Beispiel, IID 31999).
await page.fill('#bkQrIban', 'CH44 3199 9123 0008 8901 2');
await page.dispatchEvent('#bkQrIban', 'input');
check('KRITISCH: eine echte QR-IBAN wird als gueltig erkannt',
  /Gültige QR-IBAN erkannt/.test(await page.textContent('#bkQrIbanHinweis')));

await page.fill('#bkQrStrasse', 'Baslerstrasse');
await page.fill('#bkQrHausnummer', '67');
await page.fill('#bkQrPlz', '4632');
await page.fill('#bkQrOrt', 'Trimbach');
gesendet.length = 0;
await page.click('#bkKarte .btn-primary');
await page.waitForTimeout(300);
check('KRITISCH: die QR-Rechnungsangaben werden mitgespeichert',
  gesendet.some(b => b.qr_iban === 'CH44 3199 9123 0008 8901 2' && b.qr_strasse === 'Baslerstrasse'
    && b.qr_hausnummer === '67' && b.qr_plz === '4632' && b.qr_ort === 'Trimbach'));

// Erneutes Oeffnen der Ansicht laedt die gespeicherten Werte wieder ein.
await page.evaluate(() => { go('kunden'); });
await page.waitForTimeout(200);
await page.evaluate(() => { go('betrieb'); bkAbschnittZeigen('bk'); });
await page.waitForTimeout(400);
check('KRITISCH: die QR-IBAN steht nach dem Neuladen wieder im Feld',
  (await page.inputValue('#bkQrIban')) === 'CH44 3199 9123 0008 8901 2');
check('Und der Hinweis zeigt sofort wieder "gueltig", ohne erneute Eingabe',
  /Gültige QR-IBAN erkannt/.test(await page.textContent('#bkQrIbanHinweis')));

html = await drucken(10);
check('KRITISCH: der gepflegte Firmenname steht jetzt im Kopf', /CUPI 24 GmbH/.test(html));
check('Der Zusatz ebenfalls', /Sicherheits- und Verkehrsdienst/.test(html));
check('KRITISCH: die Fusszeile steht am Seitenende', /Musterweg 1 · 4600 Olten/.test(html));
check('KRITISCH: die zweite Fusszeile (Zweitsitz) steht daneben', /Bahnhofstrasse 3/.test(html));
check('KRITISCH: beide Fusszeilen-Bloecke stehen vertikal zueinander zentriert, nicht oben ausgerichtet',
  await page.evaluate(() => {
    const bloecke = [...document.querySelectorAll('#printArea div[style*="white-space:pre-line"]')];
    if (bloecke.length !== 2) return false;
    return getComputedStyle(bloecke[0].parentElement).alignItems === 'center';
  }));
check('KRITISCH: Firma und Zusatz im Kopf sind zueinander zentriert, nicht rechtsbuendig',
  /text-align:center;font-size:12px;color:#6B7280;line-height:1.5">[\s\S]*?CUPI 24 GmbH/.test(html)
    && !/text-align:right;font-size:12px;color:#6B7280;line-height:1.5">[\s\S]*?CUPI 24 GmbH/.test(html));

// ── Kundennummer und Adresse: nur bei sauberer Verknuepfung
check('KRITISCH: bei einem aus einer Schicht entstandenen Rapport steht die Kunden-Nr.',
  /Kunden-Nr\./.test(html) && /K-0001/.test(html));
check('KRITISCH: die Adresse des Einsatzes heisst jetzt "Einsatzort", nicht mehr nur "Adresse"',
  /Einsatzort/.test(html));
check('KRITISCH: die Kundenadresse aus dem Stamm steht als eigener Block',
  /Mustergasse 2/.test(html) && /8200 Schaffhausen/.test(html));
check('Ohne abweichende Rechnungsadresse ist der Block mit "Kunde" ueberschrieben, nicht mit "Rechnungsadresse"',
  />Kunde</.test(html) && !/Rechnungsadresse/.test(html));

const htmlOhne = await drucken(11);
check('KRITISCH: ein von Hand erfasster Rapport ohne Schichtbezug zeigt KEINE Kunden-Nr. — der Name allein wird nicht geraten',
  !/Kunden-Nr\./.test(htmlOhne));
check('KRITISCH: und auch keine Rechnungs-/Kundenadresse aus dem Stamm',
  !/Rechnungsadresse/.test(htmlOhne));
check('Der Rapport selbst wird trotzdem gedruckt', /Arbeitsrapport/.test(htmlOhne));

const htmlOhneId = await drucken(13);
check('KRITISCH: ohne kunde_id bleibt der Adressblock weg, selbst wenn Stammfelder mitkaemen',
  !/Irrweg/.test(htmlOhneId) && !/Nirgendwo<\/div>/.test(htmlOhneId));

const htmlRe = await drucken(12);
check('KRITISCH: bei abweichender Rechnungsadresse steht diese und nicht die gewoehnliche',
  /Finanzweg 9/.test(htmlRe) && /8005 Zürich/.test(htmlRe) && !/Kantonsstrasse 3<br>/.test(htmlRe));
check('KRITISCH: der Block heisst dann ausdruecklich "Rechnungsadresse"', /Rechnungsadresse/.test(htmlRe));
check('Der Zusatz der Rechnungsadresse steht mit', /Postfach 44/.test(htmlRe));
check('Der Einsatzort bleibt trotzdem sichtbar — er ist nicht dasselbe',
  /Kantonsstrasse 3/.test(htmlRe));

// ── Unterzeichner
check('KRITISCH: ein hinterlegter Unterzeichner steht unter der Unterschrift',
  /M\. Beispiel/.test(html));
check('Ohne Unterzeichner steht dort keine leere Zeile mit Beschriftung',
  !/Name in Blockschrift/.test(htmlOhne));

// ── Logo
await page.evaluate(() => { go('betrieb'); bkAbschnittZeigen('be'); });
await page.waitForTimeout(400);
check('Ohne Logo sagt die Karte das ausdruecklich',
  /Kein Logo hinterlegt/.test(await page.textContent('#bkLogoStand')));
// 1x1-PNG, kleinstes gueltiges Bild
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
await page.setInputFiles('#bkLogoDatei', {
  name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from(PNG, 'base64') });
await page.waitForTimeout(500);
check('KRITISCH: das Logo wird hochgeladen', gesendet.some(b => b.logo && b.logo_mime === 'image/png'));
check('Die Karte zeigt danach das Logo selbst, nicht nur "vorhanden"',
  await page.evaluate(() => !!document.querySelector('#bkLogoStand img')));
check('Und bietet an, es wieder zu entfernen', await page.isVisible('#bkLogoWeg'));

html = await drucken(10);
check('KRITISCH: das Logo steht im Kopf des Ausdrucks',
  await page.evaluate(() => !!document.querySelector('#printArea img[src^="data:image/png"]')));
// Groesser und praesenter (ENT-169) -- vorher max-height:56px.
check('KRITISCH: das Logo im Ausdruck ist groesser als vor der Ueberarbeitung',
  /max-height:88px/.test(html));
check('KRITISCH: das Logo steht ueber Firma/Zusatz zentriert statt daneben rechtsbuendig',
  await page.evaluate(() => {
    const logo = document.querySelector('#printArea img[src^="data:image/png"]');
    const firma = [...document.querySelectorAll('#printArea div')].find(d => d.textContent === 'CUPI 24 GmbH');
    if (!logo || !firma) return false;
    const lr = logo.getBoundingClientRect(), fr = firma.getBoundingClientRect();
    return Math.abs((lr.left + lr.width / 2) - (fr.left + fr.width / 2)) < 1;
  }));

await page.evaluate(() => { go('betrieb'); bkAbschnittZeigen('be'); });
await page.waitForTimeout(300);
await page.click('#bkLogoWeg');
await page.waitForTimeout(400);
check('KRITISCH: das Logo laesst sich wieder entfernen', gesendet.some(b => b.logo_weg === true));
check('Danach sagt die Karte wieder, dass keines hinterlegt ist',
  /Kein Logo hinterlegt/.test(await page.textContent('#bkLogoStand')));

// ── Hauptdomizil (ENT-245): eigene Kachel "Betrieb", eigener Speicherweg.
check('KRITISCH: die Betrieb-Kachel steht vorne, nicht die alte Anstellungsorte-Kachel',
  await page.evaluate(() => {
    const erste = document.querySelector('#bkUebersicht .bk-kachel');
    return !!erste && erste.textContent.includes('Betrieb') && !erste.textContent.includes('Anstellungsorte');
  }));
await page.evaluate(() => { go('betrieb'); bkAbschnittZeigen('be'); });
await page.waitForTimeout(300);
check('Die Kachel fuehrt auf eine Karte "Hauptdomizil"', await page.isVisible('#bdKarte'));
check('KRITISCH: die Anstellungsorte stehen in derselben Unteransicht, nicht separat',
  await page.isVisible('#anKarte'));
check('KRITISCH: das Logo steht ebenfalls hier, nicht mehr bei Briefkopf für Rapporte',
  await page.isVisible('#btLogoKarte') && await page.isVisible('#bkLogoStand'));

await page.fill('#bdStrasse', 'Musterweg 1');
await page.fill('#bdPlz', '4600');
await page.fill('#bdOrt', 'Olten');
await page.click('#bdKarte .btn-primary');
await page.waitForTimeout(400);
check('KRITISCH: das Hauptdomizil wird eigenstaendig gespeichert',
  gesendet.some(b => b.domizil_strasse === 'Musterweg 1' && b.domizil_plz === '4600' && b.domizil_ort === 'Olten'));
check('KRITISCH: dabei werden Firma/Zusatz aus dem Briefkopf NICHT mitgeschickt',
  !gesendet.some(b => 'domizil_strasse' in b && 'firma' in b));
check('KRITISCH: der zuvor gespeicherte Briefkopf bleibt dabei unveraendert stehen',
  BETRIEB.firma === 'CUPI 24 GmbH' && BETRIEB.zusatz === 'Sicherheits- und Verkehrsdienst');

await page.evaluate(() => { go('kunden'); });
await page.waitForTimeout(150);
await page.evaluate(() => { go('betrieb'); bkAbschnittZeigen('be'); });
await page.waitForTimeout(400);
check('Nach dem Neuladen steht das Hauptdomizil wieder im Formular',
  (await page.inputValue('#bdStrasse')) === 'Musterweg 1'
  && (await page.inputValue('#bdPlz')) === '4600'
  && (await page.inputValue('#bdOrt')) === 'Olten');
check('Und der Briefkopf ist beim erneuten Oeffnen ebenfalls noch da',
  BETRIEB.firma === 'CUPI 24 GmbH');

// ── Der Ausdruck loest tatsaechlich das Drucken aus
check('KRITISCH: printReport() ruft window.print() auf',
  await page.evaluate(() => window.__gedruckt > 0));

// ── Rechnungsadresse im Kundendialog
await page.evaluate(() => { go('kunden'); });
await page.waitForTimeout(500);
await page.evaluate(() => { if (typeof openKundeNeu === 'function') openKundeNeu(); });
await page.waitForTimeout(500);
const felderDa = await page.evaluate(() => ['re_name', 're_zusatz', 're_strasse',
  're_hausnummer', 're_plz', 're_ort'].every(f => !!document.getElementById('ku_' + f)));
check('KRITISCH: der Kundendialog hat Felder fuer die Rechnungsadresse', felderDa);
check('Er sagt, dass Leerlassen "gleiche Adresse" heisst',
  /Leer lassen heisst/.test(await page.content()));

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
