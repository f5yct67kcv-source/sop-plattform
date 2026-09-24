// Fassungen und Sperre eines Belegs (ENT-688).
//
// WARUM DIESE SUITE
//
// Bis ENT-688 zeigte der Link immer den lebenden Beleg: Wer nach dem
// Versand etwas aenderte, aenderte auch, was der Empfaenger sah -- und was
// er angenommen hatte. Daran haengen jetzt fuenf Zusagen, und jede
// verschwindet lautlos beim naechsten Umbau:
//
//   1. DER LINK ZEIGT DIE VERSENDETE FASSUNG. Beide oeffentlichen Seiten
//      rechnen nicht neu, sondern zeigen das Abbild.
//   2. DIE FASSUNG ENTSTEHT ERST NACH DER MAIL. Scheitert der Versand, gibt
//      es keine Fassung, die als versendet dastuende.
//   3. ANGENOMMEN HEISST GESPERRT -- IM SERVER. Speichern und Status weisen
//      einen angenommenen Beleg ab, bevor sie schreiben.
//   4. DIE ENTSCHEIDUNG KENNT IHRE FASSUNG.
//   5. BEIDE OBERFLAECHEN ZEIGEN DASSELBE: den Chip im Kopf, die Leiste bei
//      einer Annahme, den Menuepunkt "Neue Fassung senden".
//
// Was sich ausfuehren laesst, laeuft in pruef_beleg_fassung.php wirklich;
// die Oberflaeche wird im Browser GEMESSEN.
import { WURZEL, HIER, browserPfad } from './pfade.mjs';
import { readFileSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { chromium } from 'playwright';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const lies = p => readFileSync(join(WURZEL, p), 'utf8');
const nurCode = q => q.replace(/\/\*[\s\S]*?\*\//g, '')
                      .replace(/<!--[\s\S]*?-->/g, '')
                      .replace(/^\s*\/\/.*$/gm, '')
                      .replace(/^\s*--.*$/gm, '');
const API = 'backend/api/';

// ── 0. Die reinen Funktionen wirklich ausfuehren ─────────────────────
let phpAus = '', phpCode = 0;
try {
  phpAus = execFileSync('php', [`${HIER}/pruef_beleg_fassung.php`], { encoding: 'utf8' });
} catch (e) {
  phpAus = String(e.stdout || '') + String(e.stderr || '');
  phpCode = e.status || 1;
}
const phpAnzahl = Number((phpAus.match(/^(\d+) bestanden/m) || [0, 0])[1]);
check(`KRITISCH: pruef_beleg_fassung.php laeuft durch (${phpAnzahl} Pruefungen)`,
  phpCode === 0 && phpAnzahl > 0);
if (phpCode !== 0) { console.log(phpAus); }

const SEITEN = [
  { name: 'Betreiber', praefix: 'betreiber_', tab: 'be_belege', satz: "'be_'" },
  { name: 'Cockpit',   praefix: '',           tab: 'belege',    satz: null },
];

for (const s of SEITEN) {
  // ── 1. Der Link zeigt die Fassung ───────────────────────────────────
  const ansicht = nurCode(lies(API + s.praefix + 'beleg_oeffentlich.php'));
  check(`KRITISCH: ${s.name} — die oeffentliche Seite liest die letzte Fassung`,
    /beleg_letzte_fassung\(/.test(ansicht));
  // Wer hier wieder aus der lebenden Zeile rechnet, zeigt dem Empfaenger den
  // Entwurf -- genau der Zustand, den ENT-688 beendet.
  check(`KRITISCH: ${s.name} — die oeffentliche Seite rechnet Positionen und Summen nicht neu`,
    !/beleg_positionen_lesen\(/.test(ansicht) && !/beleg_summen(_perioden)?\(/.test(ansicht));
  check(`KRITISCH: ${s.name} — eine Fassung mit falscher Pruefsumme wird nicht angezeigt`,
    /\['echt'\][\s\S]{0,40}portal_fehler\(/.test(ansicht));

  // ── 2. Die Fassung entsteht nach der Mail ───────────────────────────
  const versand = nurCode(lies(API + s.praefix + 'beleg_versenden.php'));
  const iMail = versand.indexOf('smtp_senden(');
  const iFassung = versand.indexOf('beleg_fassung_anlegen(');
  check(`KRITISCH: ${s.name} — der Versand legt eine Fassung an, und zwar NACH der Mail`,
    iMail > 0 && iFassung > iMail);
  check(`KRITISCH: ${s.name} — ein angenommener Beleg bekommt beim Versand keine neue Fassung`,
    /if \(\$gesperrt\) \{ \$naechste\['neu'\] = false; \}/.test(versand));

  // ── 3. Die Sperre steht im Server, vor dem Schreiben ────────────────
  const speichern = nurCode(lies(API + s.praefix + 'beleg_speichern.php'));
  const iSperre = speichern.indexOf('beleg_gesperrt(');
  const iUpdate = speichern.indexOf(`UPDATE ${s.tab} SET $satz`);
  check(`KRITISCH: ${s.name} — Speichern prueft die Sperre, bevor es schreibt`,
    iSperre > 0 && iUpdate > iSperre
    && /beleg_gesperrt\([\s\S]{0,80}\)\) \{\s*\$pdo->rollBack\(\);\s*json_response\([^;]*409\)/.test(speichern));
  const status = nurCode(lies(API + s.praefix + 'beleg_status.php'));
  check(`KRITISCH: ${s.name} — der Status eines angenommenen Belegs laesst sich nicht zuruecknehmen`,
    status.indexOf('beleg_gesperrt(') > 0
    && status.indexOf('beleg_gesperrt(') < status.indexOf(`UPDATE ${s.tab} SET status`)
    && /beleg_gesperrt\(\$zeile\)[\s\S]{0,300}409\)/.test(status));

  // ── 4. Die Entscheidung kennt ihre Fassung ──────────────────────────
  const entscheid = nurCode(lies(API + s.praefix + 'beleg_entscheidung.php'));
  check(`KRITISCH: ${s.name} — die Entscheidung haelt fest, welche Fassung entschieden wurde`,
    /entscheidung_fassung = \?/.test(entscheid) && /beleg_letzte_fassung\(/.test(entscheid));
  check(`KRITISCH: ${s.name} — ein Beleg ohne Fassung haelt bei der Entscheidung fest, was er zeigt`,
    /beleg_fassung_anlegen\([\s\S]{0,120}'annahme'/.test(entscheid));

  // ── Lesen liefert den Stand mit ─────────────────────────────────────
  const lesen = nurCode(lies(API + s.praefix + 'beleg_lesen.php'));
  check(`${s.name} — beleg_lesen liefert den Fassungsstand mit`,
    /beleg_fassung_stand\(/.test(lesen) && /'fassung' => \$fassung/.test(lesen));
}

// ── Die Betreiberseite wirklich rendern ──────────────────────────────
// pruef_betreiber_beleg_rendern.php laeuft den echten Code gegen SQLite.
// Die Cockpit-Seite rendert test_beleg_oeffentlich.mjs (Variante
// offerte_fassung).
const rendern = v => {
  try {
    return execFileSync('php', [`${HIER}/pruef_betreiber_beleg_rendern.php`, v], { encoding: 'utf8' });
  } catch (e) {
    return 'FEHLER ' + String(e.stdout || '') + String(e.stderr || '');
  }
};
const ohne = rendern('ohne_fassung');
const mit  = rendern('fassung');
const falsch = rendern('verfaelscht');
check('KRITISCH: Betreiber — ohne Fassung zeigt die Seite den Beleg wie bisher',
  ohne.includes('</html>') && ohne.includes('2\u2019500.00 CHF') && !/Fassung \d vom/.test(ohne));
check('KRITISCH: Betreiber — mit Fassung zeigt der Link den VERSENDETEN Preis, nicht den Entwurf',
  mit.includes('</html>') && mit.includes('2\u2019200.00 CHF')
  && !mit.includes('2\u2019500.00') && !mit.includes('1\u2019111.00'));
check('KRITISCH: Betreiber — die Anschrift ist die der Fassung, nicht die heutige',
  mit.includes('Musterweg') && !mit.includes('Umzugsweg'));
check('Betreiber — die Seitenspalte nennt die Fassung', /Fassung 2 vom \d\d\.\d\d\.\d{4}/.test(mit));
check('KRITISCH: Betreiber — eine verfaelschte Fassung wird nicht angezeigt',
  falsch.includes('Dokument nicht verfügbar') && !falsch.includes('1\u2019200.00'));

// ── Die Tabellen stehen auf beiden Seiten ────────────────────────────
const modul = lies('backend/betreiber.php');
const kern  = lies('backend/planung_einrichten_kern.php');
const defBe = (modul.match(/'be_beleg_fassung' => "CREATE TABLE[\s\S]*?\) ENGINE/) || [''])[0];
const defCo = (kern.match(/'beleg_fassung' => "CREATE TABLE[\s\S]*?\) ENGINE/) || [''])[0];
check('KRITISCH: die Fassungstabelle steht auf beiden Seiten', defBe !== '' && defCo !== '');
// Eine Fassung ueberlebt ihren Beleg: Aufbewahrungspflicht (Art. 958f OR).
check('KRITISCH: keine Fassung verschwindet mit ihrem Beleg (kein ON DELETE CASCADE)',
  !/CASCADE/i.test(defBe) && !/CASCADE/i.test(defCo));
check('KRITISCH: eine Fassung ist je Beleg und Nummer eindeutig',
  /UNIQUE KEY[^\n]*\(beleg_id, nummer\)/.test(defBe) && /UNIQUE KEY[^\n]*\(beleg_id, nummer\)/.test(defCo));
check('KRITISCH: die Spalte entscheidung_fassung kommt auf beiden Seiten ueber die Einrichtung nach',
  /\['be_belege', 'entscheidung_fassung',/.test(modul) && /\['belege', 'entscheidung_fassung',/.test(kern));

// ── 5. Beide Oberflaechen: derselbe Code ─────────────────────────────
const betreiberSeite = lies('betreiber.html');
const cockpitSeite   = lies('dashboard.html');
const kernBlock = q => (q.match(/let ofFormFassung = null;[\s\S]*?function ofNeueFassungAnstehend\(\) \{[\s\S]*?\n\}/) || [''])[0];
check('KRITISCH: Chip und Sperre sind in beiden Oberflaechen derselbe Code',
  kernBlock(betreiberSeite) !== '' && kernBlock(betreiberSeite) === kernBlock(cockpitSeite));
for (const [name, q] of [['Betreiber', betreiberSeite], ['Cockpit', cockpitSeite]]) {
  check(`${name} — ofOeffnen zeichnet den Fassungsstand aus der Serverantwort`,
    /ofFassungZeichnen\((a|data)\.fassung\)/.test(q));
  check(`${name} — ein neuer Beleg startet ohne Chip und ohne Sperre`,
    /ofFassungZeichnen\(null\)/.test(q));
}

// ── Gemessen im Browser ──────────────────────────────────────────────
const POSITION = { produkt_id: 1, produkt_name: 'Nutzung', beschreibung: 'Monatliche Nutzung',
                   menge: 12, einheit: 'Monat', einzelpreis_rappen: 12000,
                   rabatt_bp: 0, mwst_satz_bp: 810 };
const ADRESSE = { id: 1, name: 'Musterbetrieb AG', kundennummer: 'K0001', plz: '3000',
                  ort: 'Musterstadt', aktiv: 1, personen: [], kontaktwege: [] };
const PRODUKT = { id: 1, nummer: 'P0001', name: 'Nutzung', beschreibung: '',
                  einzelpreis_rappen: 12000, einheit: 'Monat', mwst_satz_bp: 810,
                  sortierung: 10, aktiv: 1 };

const browser = await chromium.launch({ executablePath: browserPfad() });

async function cockpit(seite) {
  await seite.route('**/api/**', route => {
    const url = route.request().url();
    const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (url.includes('login.php')) { return send({ status: 'ok', token: 't', name: 'pruef', ist_admin: true }); }
    if (url.includes('me.php')) {
      return send({ status: 'ok', name: 'pruef', ist_admin: true, rollen: [],
        rechte: ['kunden_lesen', 'kunden_schreiben', 'offerten_lesen', 'offerten_schreiben',
                 'leistungen_lesen', 'leistungen_schreiben', 'betrieb_lesen'] });
    }
    if (url.includes('produkt_list')) { return send({ status: 'ok', produkte: [PRODUKT] }); }
    if (url.includes('beleg_list')) { return send({ status: 'ok', naechste_nummer: 'OF-0001', belege: [] }); }
    if (url.includes('kunden_list')) { return send({ status: 'ok', kunden: [ADRESSE] }); }
    if (url.includes('dashboard_stats')) {
      return send({ status: 'ok', kpi: { rapporte_monat: 0, rapporte_vormonat: 0, stunden_monat: 0,
        stunden_vormonat: 0, mitarbeiter: 0, kunden: 0, rapporte_total: 0 },
        verlauf: [], angemeldet: [], letzte_rapporte: [], ereignisse: [],
        ereignisse_unvollstaendig: [], pro_mitarbeiter: [] });
    }
    return send({ status: 'ok' });
  });
  await seite.goto(`file://${WURZEL}/dashboard.html`);
  await seite.fill('#gName', 'pruef'); await seite.fill('#gPass', 'x'); await seite.click('#gBtn');
  await seite.waitForSelector('#shell.on');
  await seite.waitForTimeout(350);
}

async function betreiber(seite) {
  await seite.route('**/api/**', route => {
    const url = route.request().url();
    const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (url.includes('betreiber_beleg_list.php')) {
      return send({ status: 'ok', eingerichtet: true, naechste_nummer: 'OF-0001', belege: [] });
    }
    if (url.includes('betreiber_kunden_list.php')) {
      return send({ status: 'ok', eingerichtet: true, naechste_nummer: 'K0002', kunden: [ADRESSE] });
    }
    if (url.includes('betreiber_produkt_list.php')) {
      return send({ status: 'ok', eingerichtet: true, produkte: [PRODUKT] });
    }
    return send({ status: 'ok' });
  });
  await seite.goto(`file://${WURZEL}/betreiber.html`);
  await seite.evaluate(([adr, prod]) => {
    document.getElementById('tor').classList.add('versteckt');
    document.getElementById('haus').classList.remove('versteckt');
    offertenBereit = true;
    ofNaechsteNummer = 'OF-0001';
    produkte = [prod];
    adressen = [Object.assign({ mandant_id: null }, adr)];
    belege = [];
  }, [ADRESSE, PRODUKT]);
}

// Was gemessen wird: Sichtbarkeit, Text und Gestalt des Chips, die Leiste,
// ob Felder bearbeitbar sind und ob der Kopf bedienbar bleibt.
const MESSEN = () => {
  const sicht = el => !!el && el.offsetParent !== null;
  const chip = document.getElementById('ofFormFassung');
  const c = getComputedStyle(chip);
  const pop = document.getElementById('rowmenuPop');
  return {
    chipSicht: sicht(chip), chipText: chip.textContent.trim(), chipKlasse: chip.className,
    chipStil: [c.fontSize, c.fontWeight, c.padding, c.borderRadius].join(' | '),
    leisteSicht: sicht(document.getElementById('ofFormSperre')),
    leisteText: document.getElementById('ofFormSperre').textContent.trim(),
    speichernSicht: sicht(document.getElementById('ofFormSaveBtn')),
    titelGesperrt: document.getElementById('of_titel').disabled,
    positionGesperrt: !!document.querySelector('[id^="ofp_name"]')?.disabled,
    druckenFrei: !document.getElementById('ofFormDruckBtn').disabled,
    personGesperrt: document.getElementById('of_person').disabled,
    menue: pop ? pop.textContent.replace(/\s+/g, ' ') : '',
    pdfLink: (document.querySelector('#ofFormSperre a') || {}).getAttribute
      ? document.querySelector('#ofFormSperre a').getAttribute('href') : '',
  };
};

const STAND = {
  gesperrt: { fassungen: [{ nummer: 1, versendet_am: '2031-02-20 09:00:00' },
                          { nummer: 2, versendet_am: '2031-03-01 09:00:00' }],
              fassung_geaendert: false, gesperrt: true,
              // Schritt 2 und 3: wer angenommen hat, und dass ein PDF vorliegt.
              unterschrift: { art: 'annahme', fassung: 2, name: 'Erika Beispiel', funktion: 'Geschäftsführerin',
                              firma: 'Musterbetrieb AG', email: 'leitung@musterbetrieb.example',
                              empfaenger_email: 'post@musterbetrieb.example', abweichend: true,
                              grund: '', bestaetigt_am: '2031-03-02 10:15:00', pdf_da: true } },
  geaendert: { fassungen: [{ nummer: 2, versendet_am: '2031-03-01 09:00:00' }],
               fassung_geaendert: true, gesperrt: false },
};

async function durchgang(name, oeffnen) {
  const seite = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const fehler = [];
  seite.on('pageerror', e => fehler.push(e.message));
  await oeffnen(seite);
  await seite.evaluate(p => { ofNeu('offerte'); ofPos = [p]; ofZeilenZeichnen(); ofFormId = 5; }, POSITION);
  await seite.waitForTimeout(150);

  const vorher = await seite.evaluate(MESSEN);
  await seite.evaluate(st => {
    ofFormEntschiedenAm = '2031-03-02 10:15:00';
    ofFormToken = 'tokPruef';
    ofFassungZeichnen(st);
  }, STAND.gesperrt);
  await seite.waitForTimeout(60);
  const zu = await seite.evaluate(MESSEN);
  await seite.evaluate(st => { ofFormEntschiedenAm = null; ofFassungZeichnen(st); }, STAND.geaendert);
  await seite.waitForTimeout(60);
  const auf = await seite.evaluate(MESSEN);
  await seite.evaluate(() => {
    document.getElementById('ofFormMenuBtn').style.display = '';
    document.getElementById('ofFormMenuBtn').click();
  });
  await seite.waitForTimeout(80);
  const menue = await seite.evaluate(MESSEN);
  await seite.close();
  return { name, vorher, zu, auf, menue, fehler };
}

const ergebnisse = [await durchgang('Betreiber', betreiber), await durchgang('Cockpit', cockpit)];

for (const e of ergebnisse) {
  check(`${e.name} — keine Skriptfehler (${e.fehler.join(' / ')})`, e.fehler.length === 0);
  check(`KRITISCH: ${e.name} — ein neuer Entwurf zeigt keinen Chip und keine Sperrleiste`,
    !e.vorher.chipSicht && !e.vorher.leisteSicht && e.vorher.speichernSicht);

  check(`KRITISCH: ${e.name} — angenommen: Leiste mit Datum sichtbar`,
    e.zu.leisteSicht && e.zu.leisteText.includes('Angenommen am 02.03.2031')
    && e.zu.leisteText.includes('duplizieren'));
  check(`KRITISCH: ${e.name} — angenommen: Kopf- und Positionsfelder gesperrt, Speichern weg`,
    e.zu.titelGesperrt && e.zu.positionGesperrt && !e.zu.speichernSicht);
  check(`KRITISCH: ${e.name} — angenommen: Drucken im Kopf bleibt bedienbar`, e.zu.druckenFrei);
  check(`KRITISCH: ${e.name} — angenommen: die Leiste nennt, wer angenommen hat, und warnt bei abweichender Codeadresse`,
    e.zu.leisteText.includes('von Erika Beispiel, Geschäftsführerin, Musterbetrieb AG')
    && e.zu.leisteText.includes('Achtung: Der Bestätigungscode ging an leitung@musterbetrieb.example'));
  // ENT-710: intern das PDF MIT Pruefprotokoll, ueber die Anmeldung und
  // die id -- nicht den Link des Kunden.
  check(`KRITISCH: ${e.name} — angenommen: die Leiste verlinkt das PDF mit Pruefprotokoll des eigenen Endpunkts`,
    new RegExp('^api/' + (e.name === 'Betreiber' ? 'betreiber_beleg_pdf_intern' : 'beleg_pdf_intern')
      + '\\.php\\?id=\\d+$').test(e.zu.pdfLink));
  check(`${e.name} — ohne Annahme kein PDF-Link`, e.auf.pdfLink === '');
  check(`${e.name} — angenommen: der Chip nennt die angenommene Fassung`,
    e.zu.chipSicht && e.zu.chipText === 'Fassung 2 · versendet 01.03.2031' && /chip-a/.test(e.zu.chipKlasse));

  check(`KRITISCH: ${e.name} — geaendert: oranger Chip "Geändert, noch nicht versendet"`,
    e.auf.chipSicht && e.auf.chipText === 'Geändert, noch nicht versendet' && /chip-w/.test(e.auf.chipKlasse));
  check(`KRITISCH: ${e.name} — nach der Sperre ist das Formular wieder bearbeitbar`,
    !e.auf.titelGesperrt && !e.auf.positionGesperrt && e.auf.speichernSicht && !e.auf.leisteSicht);
  // GEGENPROBE zu "nur was sie selbst gesperrt hat": Die Ansprechperson ist
  // gesperrt, weil der Betrieb keine Personen hat -- das darf das Aufheben
  // der Sperre nicht mitnehmen.
  check(`KRITISCH: ${e.name} — ein aus anderem Grund gesperrtes Feld bleibt gesperrt`,
    e.vorher.personGesperrt && e.auf.personGesperrt);
  check(`KRITISCH: ${e.name} — das Menue bietet "Neue Fassung senden" an`,
    e.menue.menue.includes('Neue Fassung senden') && !e.menue.menue.includes('Per E-Mail versenden'));
}
const [be, co] = ergebnisse;
check('KRITISCH: der Chip sieht auf beiden Seiten gleich aus (gemessen)',
  be.auf.chipStil === co.auf.chipStil && be.zu.chipStil === co.zu.chipStil);

await browser.close();

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
