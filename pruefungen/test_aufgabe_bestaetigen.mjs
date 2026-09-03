// Aufgabe bestaetigen waehrend der Runde (ENT-305).
//
// Vom Projektinhaber: "wenn der MA aktiv auf seiner Runde unterwegs ist und
// ein Kontrollpunkt erfasst mit einer gekoppelten Aufgabe, ploppt diese auf
// und er muss diese Aufgabe bestaetigen. Und ja, die muss in der
// Rundgangauswertung miterfasst werden alles mit Zeitstempel."
//
// Entschieden: ZWEI Wege, "Erledigt" oder "Nicht moeglich" mit Pflichtgrund.
// Gaebe es nur "Erledigt", tippte auch der darauf, der die Aufgabe nicht
// ausfuehren konnte -- und die Auswertung behauptete etwas, das nicht stimmt.
//
// Die vier Punkte, auf die es hier ankommt:
//  1. Der SCAN wird nicht zurueckgehalten. Der Punkt ist erfasst, das ist
//     eine Tatsache; wer die Schublade wegschiebt, darf sie nicht verlieren.
//  2. Wer sie wegschiebt, sieht an der Zeile weiter, dass etwas offen ist.
//  3. Antworten reisen ueber DIESELBE Warteschlange und Anfrage wie die
//     Scans -- offline getrennt zu senden hiesse, dass ein Punkt ankommt und
//     seine Aufgaben nicht.
//  4. Der Zeitstempel kommt vom Geraet, nicht vom Server.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const tag = n => iso(new Date(Date.now() + n * 864e5));

// ══════════ ENDPUNKT UND DATENMODELL, STATISCH ════════════════════════
const SCAN = readFileSync(`${WURZEL}/backend/api/mein_rundgang_scan.php`, 'utf8');
const EINR = readFileSync(`${WURZEL}/backend/api/planung_einrichten.php`, 'utf8');
const RG   = readFileSync(`${WURZEL}/backend/rundgang.php`, 'utf8');

check('KRITISCH: die Erledigung bekommt eine EIGENE Tabelle, wie ENT-302 vorgesehen hat',
  /CREATE TABLE rundgang_aufgabe \(/.test(EINR));
// Der Nachweiswert haengt daran: Wird "Tuere verschliessen" spaeter
// umbenannt, darf der Beleg von letzter Nacht nicht rueckwirkend etwas
// anderes behaupten.
check('KRITISCH: der Text wird KOPIERT, nicht per Verweis geholt',
  /rundgang_aufgabe \([\s\S]{0,400}bezeichnung VARCHAR\(200\) NOT NULL/.test(EINR));
check('KRITISCH: die Herkunft darf verschwinden, der Nachweis bleibt',
  /FOREIGN KEY \(aufgabe_id\) REFERENCES objekt_aufgabe\(id\) ON DELETE SET NULL/.test(EINR));
check('KRITISCH: zwei Zeitangaben getrennt -- Erfassung am Gerät, Übermittlung am Server',
  /rundgang_aufgabe \([\s\S]{0,500}erfasst_am DATETIME NOT NULL[\s\S]{0,120}uebermittelt_am/.test(EINR));
check('KRITISCH: dieselbe Aufgabe wird je Runde nur einmal beantwortet',
  /UNIQUE KEY uniq_runde_punkt_aufgabe \(rundgang_id, kontrollpunkt_id, aufgabe_id\)/.test(EINR));
check('KRITISCH: nur "erledigt" oder "nicht_moeglich" werden angenommen',
  /in_array\(\$aStatus, \['erledigt', 'nicht_moeglich'\], true\)/.test(SCAN));
check('KRITISCH: bei "nicht möglich" ist der Grund serverseitig Pflicht -- nicht nur im Formular',
  /\$aStatus === 'nicht_moeglich' && \$grund === ''/.test(SCAN));
// Ein Geraet darf nicht bestimmen, was als Nachweis in der Auswertung steht.
//
// Auf die AUSSAGE geprueft, nicht auf den Wortlaut der Abfrage: Die erste
// Fassung verglich die SELECT-Zeile Zeichen fuer Zeichen und wurde rot,
// als ENT-311 eine weitere Spalte dazunahm -- ohne dass sich am Verhalten
// etwas geaendert haette. Zweites Mal derselbe Fehler nach ENT-308
// (dort war es die Einrueckung); eine Pruefung, die den Umbau bestraft
// statt den Fehler, kostet Vertrauen.
check('KRITISCH: die Bezeichnung kommt aus dem Katalog, nicht aus der Anfrage',
  /SELECT[\s\S]{0,120}a\.bezeichnung[\s\S]{0,200}FROM kontrollpunkt_aufgabe ka/.test(SCAN)
  && !/'bezeichnung'\s*=>\s*\$eintrag/.test(SCAN));
check('KRITISCH: eine Aufgabe, die nicht an diesem Punkt hängt, wird abgewiesen',
  /WHERE ka\.kontrollpunkt_id = \? AND ka\.aufgabe_id = \?/.test(SCAN)
  && /gehoert nicht zu diesem Kontrollpunkt/.test(SCAN));
check('Entfernte (inaktive) Aufgaben lassen sich nicht mehr beantworten',
  /JOIN objekt_aufgabe a ON a\.id = ka\.aufgabe_id AND a\.aktiv = 1[\s\S]{0,120}ka\.kontrollpunkt_id = \?/.test(SCAN));
check('KRITISCH: ein doppelt gesendeter Eintrag legt keinen zweiten Nachweis an',
  /INSERT IGNORE INTO rundgang_aufgabe/.test(SCAN));
check('Antworten reisen über denselben Endpunkt wie die Scans',
  /\$aufgaben = is_array\(\$input\['aufgaben'\] \?\? null\)/.test(SCAN));
check('Die bereits gegebene Antwort wird mitgeliefert -- sonst fragt ein erneutes Öffnen noch einmal',
  /FROM rundgang_aufgabe WHERE rundgang_id = \?/.test(RG));

// ══════════ ABLAUF IN DER APP ═════════════════════════════════════════
const SCHICHTEN = { status: 'ok', von: tag(-30), bis: tag(90), schichten: [
  { id: 71, kunde_name: 'Musterliegenschaften AG', titel: 'Nachtwache', strasse: 'Musterweg 4', ort: '9999 Musterdorf',
    einsatzart: 'Revierdienst', sparte: 'sicherheit', datum: tag(0), von: '20:00:00', bis: '06:00:00',
    status: 'bestaetigt', bemerkung: null, zusage: 'zugesagt', objekt_name: 'Musterobjekt Industrie', objekt_id: 7,
    hat_kontrollpunkte: true, im_team: 1 },
]};
const PROFIL = { status: 'ok', monat: { anzahl: 0, stunden: 0 }, profil: {
  name: 'm.muster', ist_admin: false, personalnummer: 'P-001',
  vorname: 'Max', nachname: 'Muster', erstellt_am: tag(-30) + ' 10:00:00' } };

// Punkt 1 traegt zwei Aufgaben, Punkt 2 keine.
const KP = [
  { id: 1, bezeichnung: 'Haupteingang', reihenfolge: 1, typ: 'geofence', erledigt: null, aufgaben: [
    { id: 11, bezeichnung: 'Türe verschliessen', information: 'Beide Flügel, Riegel prüfen.', erledigt: null },
    { id: 12, bezeichnung: 'Licht löschen', information: null, erledigt: null },
  ]},
  { id: 2, bezeichnung: 'Tor Nord', reihenfolge: 2, typ: 'geofence', erledigt: null, aufgaben: [] },
];

let gesendet = [];

const browser = await chromium.launch({ executablePath: EXE });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
  permissions: ['geolocation'], geolocation: { latitude: 47.35, longitude: 7.9 } });
const page = await ctx.newPage();
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));

await page.route('**/api/**', route => {
  const req = route.request();
  const url = new URL(req.url());
  const p = url.pathname.split('/api/')[1];
  let body = null;
  try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch {}
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'm.muster', ist_admin: false });
  if (p.includes('meine_schichten')) return send(SCHICHTEN);
  if (p.includes('mein_profil')) return send(PROFIL);
  if (p.includes('rapport_list')) return send({ status: 'ok', rapporte: [] });
  if (p.includes('mein_rundgang_offen')) {
    return send({ status: 'ok', rundgang: { id: 951, status: 'vorbereitet', pausiert_seit: null,
      kontrollpunkte: JSON.parse(JSON.stringify(KP)) } });
  }
  if (p.includes('mein_rundgang_starten')) {
    return send({ status: 'ok', rundgang_id: 951, kontrollpunkte: JSON.parse(JSON.stringify(KP)) });
  }
  if (p.includes('mein_rundgang_scan')) {
    gesendet.push(body);
    return send({ status: 'ok', rundgang_status: 'laeuft',
      ergebnisse: (body.scans || []).map(s => ({ kontrollpunkt_id: s.kontrollpunkt_id, status: 'ok' })),
      aufgaben_ergebnisse: (body.aufgaben || []).map(a => ({ kontrollpunkt_id: a.kontrollpunkt_id,
        aufgabe_id: a.aufgabe_id, status: 'ok' })) });
  }
  return send({ status: 'ok' });
});

await page.goto(`file://${WURZEL}/app.html`);
await page.fill('#gName', 'm.muster'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('.app.on');
await page.waitForTimeout(400);

// Rundgang oeffnen (Einsatz 71, offener Rundgang aus dem Mock).
await page.evaluate(() => { ladeSchichten().then(() => rundgangFortsetzen(71)); });
await page.waitForTimeout(600);
// Seit ENT-331 beginnt eine Runde auf dem Kartenreiter. Diese Suite prueft
// die Aufgaben AN den Kontrollpunkten -- der Reiter wird darum ausdruecklich
// auf die Liste gestellt, statt sich auf den Startzustand zu verlassen.
await page.evaluate(() => rgLaufReiter('punkte'));
await page.waitForTimeout(300);
check('Die Checkliste ist offen', await page.isVisible('#rdListe'));

// ── Kontrollpunkt MIT Aufgaben erfassen ───────────────────────────────
gesendet = [];
await page.evaluate(() => {
  const k = rundgangAktiv.kontrollpunkte.find(x => Number(x.id) === 1);
  rdScanEintragen(k, 'bestaetigt', { lat: 47.35, lng: 7.9 });
});
await page.waitForTimeout(400);

check('KRITISCH: der Scan geht sofort raus -- er wartet NICHT auf die Aufgaben',
  gesendet.some(b => (b.scans || []).some(s => Number(s.kontrollpunkt_id) === 1 && s.status === 'bestaetigt')));
check('KRITISCH: die Aufgaben poppen auf',
  await page.isVisible('#blatt.on') && (await page.textContent('#blTitel')) === 'Aufgabe bestätigen');
check('Beide Aufgaben des Punktes stehen darin',
  await page.evaluate(() => document.querySelectorAll('#blBody .ab-karte').length === 2));
check('Die Schublade nennt den Kontrollpunkt, zu dem sie gehört',
  (await page.textContent('#blBody')).includes('Haupteingang'));
check('Die Erläuterung der Aufgabe steht dabei',
  (await page.textContent('#blBody')).includes('Riegel prüfen'));
check('KRITISCH: beide Wege stehen zur Wahl -- nicht nur "Erledigt"',
  (await page.textContent('#blBody')).includes('Erledigt')
  && (await page.textContent('#blBody')).includes('Nicht möglich'));
check('KRITISCH: die Wahlknöpfe sind mindestens 44px hoch (CLAUDE.md)',
  await page.evaluate(() => [...document.querySelectorAll('#blBody .ab-btn')]
    .every(b => b.getBoundingClientRect().height >= 44)));
// Das Neuzeichnen der Liste nach dem Senden der Warteschlange hat den Fuss
// dieser Schublade ueberschrieben und den Knopf geloescht -- die Schublade
// blieb offen und unbedienbar. Darum hier ausdruecklich gemessen.
// Netz: Ohne den Knopf haengt alles Folgende. Ohne diese Weiche stuerzt die
// Suite ab, statt die verletzte Aussage zu benennen -- derselbe Mangel, den
// ENT-302 bei sich festgehalten hat und der hier beim Gegenprobieren
// ("Fuss-Weiche entfernt") sofort wieder auftrat.
const knopfDa = await page.isVisible('#abBtn');
check('KRITISCH: der Bestätigen-Knopf überlebt das Neuzeichnen nach dem Senden', knopfDa);
if (!knopfDa) {
  bad.push('KRITISCH: ohne den Bestätigen-Knopf liessen sich die folgenden Aussagen nicht mehr prüfen '
    + '(Antworten senden, Pflichtgrund, Zeitstempel, offene Aufgaben an der Zeile)');
} else {
check('Das Grundfeld ist zunächst verborgen',
  await page.evaluate(() => document.getElementById('abG11').style.display === 'none'));
await page.screenshot({ path: `${OUT}/abaufg-01-popup.png` });

// ── Ohne Wahl senden: abgewiesen ──────────────────────────────────────
gesendet = [];
await page.click('#abBtn');
await page.waitForTimeout(250);
check('KRITISCH: ohne Antwort auf jede Aufgabe wird nichts gesendet',
  !gesendet.length && await page.isVisible('#abErr'));

// ── "Nicht möglich" ohne Grund: abgewiesen ────────────────────────────
await page.click('#abK11 .ab-btn[data-wert="nicht_moeglich"]');
await page.waitForTimeout(200);
check('KRITISCH: "Nicht möglich" blendet das Grundfeld ein',
  await page.evaluate(() => document.getElementById('abG11').style.display !== 'none'));
check('Die gewählte Antwort ist auch ohne Farbe erkennbar (Rahmen wechselt mit)',
  await page.evaluate(() => {
    const b = document.querySelector('#abK11 .ab-btn[data-wert="nicht_moeglich"]');
    const s = getComputedStyle(b);
    return b.classList.contains('ab-an') && s.borderTopColor !== 'rgba(0, 0, 0, 0)';
  }));
await page.click('#abK12 .ab-btn[data-wert="erledigt"]');
await page.waitForTimeout(150);
gesendet = [];
await page.click('#abBtn');
await page.waitForTimeout(250);
check('KRITISCH: "Nicht möglich" ohne Grund wird abgewiesen, auch in der App',
  !gesendet.length && (await page.textContent('#abErr')).includes('Grund'));

// ── Vollständig beantwortet ───────────────────────────────────────────
await page.fill('#abT11', 'Schloss defekt, Schlüsseldienst informiert.');
gesendet = [];
await page.click('#abBtn');
await page.waitForTimeout(500);

const mitAufgaben = gesendet.find(b => (b.aufgaben || []).length);
check('KRITISCH: die Antworten gehen an den Server, mit Rundgang und Kontrollpunkt',
  !!mitAufgaben && mitAufgaben.rundgang_id === 951
  && mitAufgaben.aufgaben.every(a => Number(a.kontrollpunkt_id) === 1));
check('KRITISCH: beide Antworten sind dabei, mit ihrem jeweiligen Status',
  !!mitAufgaben && mitAufgaben.aufgaben.length === 2
  && mitAufgaben.aufgaben.find(a => a.aufgabe_id === 11).status === 'nicht_moeglich'
  && mitAufgaben.aufgaben.find(a => a.aufgabe_id === 12).status === 'erledigt');
check('KRITISCH: der Grund reist mit',
  !!mitAufgaben && mitAufgaben.aufgaben.find(a => a.aufgabe_id === 11).grund.includes('Schloss defekt'));
// Der Waechter steht im Treppenhaus ohne Netz -- der Zeitstempel zaehlt den
// Moment der Erledigung, nicht den der Uebermittlung.
check('KRITISCH: jede Antwort trägt einen geräteseitigen Zeitstempel',
  !!mitAufgaben && mitAufgaben.aufgaben.every(a => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(a.erfasst_am)));
check('KRITISCH: Scans und Antworten reisen in DERSELBEN Anfrage -- nicht getrennt',
  !!mitAufgaben && 'scans' in mitAufgaben && 'aufgaben' in mitAufgaben);
check('Die Schublade ist danach zu und die Checkliste wieder da',
  await page.isVisible('#rdListe'));
check('KRITISCH: die Zeile meldet keine offenen Aufgaben mehr',
  !(await page.isVisible('#abOffen1')) && await page.isVisible('#abFertig1'));

// ── Wegschieben statt beantworten: Hinweis bleibt ─────────────────────
await page.evaluate(() => {
  const k = rundgangAktiv.kontrollpunkte.find(x => Number(x.id) === 2);
  k.aufgaben = [{ id: 21, bezeichnung: 'Rolltor prüfen', information: null, erledigt: null }];
  rdScanEintragen(k, 'bestaetigt', { lat: 47.35, lng: 7.9 });
});
await page.waitForTimeout(400);
check('Auch am zweiten Punkt poppt die Aufgabe auf', await page.isVisible('#blatt.on'));
await page.evaluate(() => blattZu());
await page.waitForTimeout(300);
await page.evaluate(() => rundgangAnzeigen(rundgangAktiv.einsatz_id));
await page.waitForTimeout(300);
check('KRITISCH: wer die Schublade wegschiebt, sieht an der Zeile weiter, dass etwas offen ist',
  await page.isVisible('#abOffen2') && (await page.textContent('#abOffen2')).includes('1 Aufgabe offen'));
check('KRITISCH: der Hinweis ist antippbar und mindestens 44px hoch (CLAUDE.md)',
  await page.evaluate(() => document.getElementById('abOffen2').getBoundingClientRect().height >= 44));
await page.click('#abOffen2');
await page.waitForTimeout(300);
check('KRITISCH: ein Tipp öffnet die Frage erneut',
  await page.isVisible('#blatt.on') && (await page.textContent('#blBody')).includes('Rolltor prüfen'));
await page.screenshot({ path: `${OUT}/abaufg-02-offen.png` });

// ── Punkt OHNE Aufgabe: keine Schublade ───────────────────────────────
await page.evaluate(() => { blattZu(); });
await page.waitForTimeout(200);
await page.evaluate(() => {
  rundgangAktiv.kontrollpunkte.forEach(k => { k.erledigt = null; k.aufgaben = []; });
  rundgangAnzeigen(rundgangAktiv.einsatz_id);
});
await page.waitForTimeout(300);
await page.evaluate(() => {
  const k = rundgangAktiv.kontrollpunkte.find(x => Number(x.id) === 2);
  rdScanEintragen(k, 'bestaetigt', { lat: 47.35, lng: 7.9 });
});
await page.waitForTimeout(400);
// An der SICHTBARKEIT gemessen, nicht am Text: Seit ENT-306 schliesst
// rundgangAnzeigen() die Schublade, ohne ihren Titel zu leeren -- eine
// Textpruefung haette hier den stehengebliebenen alten Titel gelesen und
// waere zufaellig rot geworden, ohne dass etwas kaputt ist.
check('KRITISCH: ein Punkt ohne Aufgabe fragt nichts -- kein Dialog aus dem Nichts',
  !(await page.isVisible('#blatt.on')));

}

check('KRITISCH: kein waagrechter Seiten-Scroll bei 390px', await page.evaluate(() =>
  document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));

// ══════════ RUNDGANGAUSWERTUNG IM DASHBOARD ═══════════════════════════
// Vom Projektinhaber ausdruecklich verlangt: "die muss in der
// Rundgangauswertung miterfasst werden alles mit Zeitstempel".
const HEUTE = tag(0);
const dash = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
dash.on('pageerror', e => bad.push('JS-Fehler (Dashboard): ' + e.message));
await dash.route('**/api/**', route => {
  const p2 = new URL(route.request().url()).pathname.split('/api/')[1];
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (p2.includes('login')) return send({ status: 'ok', token: 't', name: 'adrian', ist_admin: true });
  if (p2.includes('me.php')) return send({ status: 'ok', name: 'adrian', ist_admin: true, rollen: [],
    rechte: ['plan', 'rundgang_einsehen'] });
  if (p2.includes('dashboard_stats')) return send({ status: 'ok',
    kpi: { rapporte_monat: 0, rapporte_vormonat: 0, stunden_monat: 0, stunden_vormonat: 0,
           mitarbeiter: 1, kunden: 1, rapporte_total: 0 },
    verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [] });
  if (p2.includes('rundgang_scan_liste')) return send({ status: 'ok',
    scans: [{ id: 1, erfasst_am: HEUTE + ' 02:14:00', status: 'bestaetigt', beschreibung: null,
      kontrollpunkt_name: 'Haupteingang', kunde_name: 'Musterliegenschaften AG',
      objekt_name: 'Musterobjekt Industrie', titel: 'Nachtwache', vorname: 'Max', nachname: 'Muster' }],
    aufgaben: [
      { id: 91, erfasst_am: HEUTE + ' 02:16:00', uebermittelt_am: HEUTE + ' 02:31:00',
        status: 'erledigt', grund: null, bezeichnung: 'Licht löschen',
        kontrollpunkt_name: 'Haupteingang', kunde_name: 'Musterliegenschaften AG',
        objekt_name: 'Musterobjekt Industrie', titel: 'Nachtwache', vorname: 'Max', nachname: 'Muster' },
      { id: 92, erfasst_am: HEUTE + ' 02:17:00', uebermittelt_am: HEUTE + ' 02:31:00',
        status: 'nicht_moeglich', grund: 'Schloss defekt, Schlüsseldienst informiert.',
        bezeichnung: 'Türe verschliessen',
        kontrollpunkt_name: 'Haupteingang', kunde_name: 'Musterliegenschaften AG',
        objekt_name: 'Musterobjekt Industrie', titel: 'Nachtwache', vorname: 'Max', nachname: 'Muster' },
      // Antwort OHNE zugehoerigen Scan im Zeitraum -- darf nicht verschwinden.
      { id: 93, erfasst_am: HEUTE + ' 03:40:00', uebermittelt_am: HEUTE + ' 03:41:00',
        status: 'erledigt', grund: null, bezeichnung: 'Rolltor prüfen',
        kontrollpunkt_name: 'Tor Nord', kunde_name: 'Musterliegenschaften AG',
        objekt_name: 'Musterobjekt Industrie', titel: 'Nachtwache', vorname: 'Max', nachname: 'Muster' },
    ] });
  if (p2.includes('rapport_list')) return send({ status: 'ok', rapporte: [] });
  if (p2.includes('mitarbeiter_list')) return send({ status: 'ok', mitarbeiter: [] });
  if (p2.includes('kunden_list')) return send({ status: 'ok', kunden: [] });
  if (p2.includes('einsatz_list')) return send({ status: 'ok', einsaetze: [] });
  return send({ status: 'ok' });
});
await dash.goto(`file://${WURZEL}/dashboard.html`);
await dash.fill('#gName', 'adrian'); await dash.fill('#gPass', 'x'); await dash.click('#gBtn');
await dash.waitForSelector('#kpiGrid .kpi-val');
await dash.waitForTimeout(400);
await dash.evaluate(() => { arbeitsergebnisseOeffnen(); aeGoTab('scans'); });
await dash.waitForTimeout(600);

const karten = await dash.evaluate(() => [...document.querySelectorAll('#aeScanListe .ag-karte')]
  .map(el => el.textContent.replace(/\s+/g, ' ').trim()));
check('KRITISCH: die erledigte Aufgabe steht in der Rundgangauswertung',
  karten.some(t => t.includes('Licht löschen') && t.includes('Erledigt')));
check('KRITISCH: "Nicht möglich" steht als solches da, nicht als erledigt',
  karten.some(t => t.includes('Türe verschliessen') && t.includes('Nicht möglich')));
check('KRITISCH: der Grund steht dabei -- ohne ihn weiss niemand, was zu tun ist',
  karten.some(t => t.includes('Schloss defekt')));
check('KRITISCH: jede Aufgabe trägt ihren eigenen Zeitstempel, nicht den des Scans',
  karten.some(t => t.includes('02:16') && t.includes('02:17')));
check('Die Aufgaben stehen bei ihrem Kontrollpunkt, nicht in einer zweiten Liste',
  karten.some(t => t.includes('Haupteingang') && t.includes('Licht löschen') && t.includes('02:14')));
check('KRITISCH: eine Antwort ohne Scan im Zeitraum verschwindet NICHT',
  karten.some(t => t.includes('Rolltor prüfen')));
check('KRITISCH: kein waagrechter Seiten-Scroll im Dashboard', await dash.evaluate(() =>
  document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
await dash.screenshot({ path: `${OUT}/abaufg-03-auswertung.png` });

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
