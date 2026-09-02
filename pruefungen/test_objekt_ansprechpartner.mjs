// Ansprechpartner AM OBJEKT (ENT-300).
//
// Der Projektinhaber hat zwei Dinge entschieden:
//  1. Objekt-Kontakte ERGAENZEN die Kontaktpersonen des Kunden, sie ersetzen
//     sie nicht ("2").
//  2. Gepflegt werden sie direkt auf der Objekt-Uebersicht, nicht in einer
//     eigenen Maske.
//
// Die inhaltlich wichtigsten Punkte hier:
//  - Der Waechter muss SEHEN, wen er anruft. Der Hauswart vor Ort ist ein
//    anderer Anruf als die Kontaktperson beim Kunden; wer nachts den
//    Falschen weckt, ruft beim naechsten Mal niemanden mehr an. Darum traegt
//    jeder Eintrag seine Herkunft, und die Leute vor Ort stehen zuoberst.
//  - Eine Person NUR mit Funktion und Nummer ("Hauswart", ohne Namen) ist
//    gueltig. Um drei Uhr nachts ist die Funktion die Information.
//  - Leere Formularzeilen duerfen NICHT als Kontaktweg gespeichert werden:
//    In der App stuende sonst eine Zeile, die man antippen kann und die
//    nirgendwohin fuehrt.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const tag = n => iso(new Date(Date.now() + n * 864e5));

// ══════════ TEIL 1: DER ENDPUNKT, STATISCH GEPRÜFT ════════════════════
const EP = readFileSync(`${WURZEL}/backend/api/objekt_personen.php`, 'utf8');
// Seit ENT-308 steht die Zusammenfuehrung beider Quellen in
// backend/rundgang.php -- dieselbe Abfrage bedient Vorschau UND laufende
// Runde. Die Aussagen bleiben dieselben, nur die Datei ist eine andere.
const UEB = readFileSync(`${WURZEL}/backend/rundgang.php`, 'utf8');
const UEB_EP = readFileSync(`${WURZEL}/backend/api/mein_rundgang_uebersicht.php`, 'utf8');
const OFFEN = readFileSync(`${WURZEL}/backend/api/mein_rundgang_offen.php`, 'utf8');
const EINR = readFileSync(`${WURZEL}/backend/api/planung_einrichten.php`, 'utf8');

check('KRITISCH: es gibt eigene Tabellen für Objekt-Kontakte, nach dem Muster der Kunden',
  /CREATE TABLE IF NOT EXISTS objekt_person \(/.test(EINR)
  && /CREATE TABLE IF NOT EXISTS objekt_kontaktweg \(/.test(EINR));
check('KRITISCH: sie hängen am Objekt und verschwinden mit ihm',
  /FOREIGN KEY \(objekt_id\) REFERENCES objekte\(id\) ON DELETE CASCADE/.test(EINR));
check('Die Funktion vor Ort ist ein eigenes Feld -- sie ist der Grund für diese Tabelle',
  /objekt_person \([\s\S]{0,400}funktion VARCHAR\(100\) NULL/.test(EINR));
check('KRITISCH: Speichern verlangt ein Recht, es ist kein offener Endpunkt',
  /require_recht\(\$user, 'plan'\)/.test(EP));
check('KRITISCH: der Bestand wird vollständig ersetzt -- die Maske schickt den Endzustand',
  /DELETE FROM objekt_kontaktweg WHERE objekt_id = \?/.test(EP)
  && /DELETE FROM objekt_person WHERE objekt_id = \?/.test(EP));
check('KRITISCH: Löschen und Neuanlegen laufen in EINER Transaktion -- sonst stünde das Objekt bei einem Fehler ohne Kontakte da',
  /beginTransaction\(\)[\s\S]*DELETE FROM objekt_person[\s\S]*commit\(\)/.test(EP)
  && /rollBack\(\)/.test(EP));
check('KRITISCH: leere Kontaktwege werden verworfen, nicht gespeichert',
  /\$wert === ''[\s\S]{0,60}continue/.test(EP));
check('KRITISCH: nur bekannte Kontaktarten werden angenommen',
  /OP_WEG_ARTEN = \['telefon', 'mobil', 'email', 'webseite', 'fax'\]/.test(EP)
  && /!in_array\(\$art, OP_WEG_ARTEN, true\)/.test(EP));
check('Ein nicht vorhandenes Objekt wird abgewiesen, nicht stillschweigend angelegt',
  /SELECT COUNT\(\*\) FROM objekte WHERE id = \?/.test(EP));
check('Fehlt die Tabelle noch, sagt die Meldung, was zu tun ist',
  /op_tabellen_da\(\$pdo\)[\s\S]{0,200}Einrichtung/.test(EP));
// ENT-300: Der eigene Endpunkt ist kein Zierrat -- objekt_save.php kennt die
// Ansprechpartner nicht, ein gemeinsamer Weg wuerde sie beim Speichern der
// Stammdaten loeschen (derselbe Fehler, den betrieb.php mit getrennten
// Zweigen vermeidet, ENT-245).
check('KRITISCH: objekt_save.php fasst die Ansprechpartner nicht an',
  !/objekt_person|objekt_kontaktweg/.test(readFileSync(`${WURZEL}/backend/api/objekt_save.php`, 'utf8')));
check('KRITISCH: die Rundgang-Vorschau liest beide Quellen und kennzeichnet sie',
  /'quelle'\s*=>\s*'objekt'/.test(UEB) && /'quelle'\s*=>\s*'kunde'/.test(UEB));
// Unabhaengig von der Einrueckung gesucht: Eine erste Fassung verglich zwei
// wortgleiche Zeichenketten samt Leerzeichen -- nach dem Herausloesen in
// backend/rundgang.php stimmte die Einrueckung nicht mehr, indexOf lieferte
// -1, und die Pruefung wurde rot, ohne dass die Reihenfolge falsch war.
check('KRITISCH: die Leute vor Ort stehen VOR denen des Kunden (Reihenfolge im Quelltext)',
  (() => {
    const objekt = UEB.search(/'quelle'\s*=>\s*'objekt'/);
    const kunde = UEB.search(/'quelle'\s*=>\s*'kunde'/);
    return objekt > -1 && kunde > -1 && objekt < kunde;
  })());
check('Fehlt die Objekt-Tabelle noch, fällt die Vorschau nicht aus',
  /\$tabelleDa\(\$pdo, 'objekt_person'\)/.test(UEB));
// ENT-308: Beide Endpunkte nutzen denselben Baustein -- nicht je eine eigene
// Kopie, die auseinanderlaufen kann.
check('KRITISCH: Vorschau UND laufende Runde nutzen dieselbe Abfrage, nicht zwei Kopien',
  /rundgang_ansprechpartner\(/.test(UEB_EP) && /rundgang_ansprechpartner\(/.test(OFFEN)
  && !/FROM objekt_person/.test(UEB_EP) && !/FROM objekt_person/.test(OFFEN));

// ══════════ TEIL 2: PFLEGE AUF DER OBJEKT-ÜBERSICHT ═══════════════════
const OBJEKTE = { status: 'ok', objekte: [
  { id: 1, kunde_id: 1, kunde_name: 'Musterliegenschaften AG', name: 'Musterobjekt Industrie',
    strasse: 'Musterweg 4', ort: '9999 Musterdorf', kanton: 'SO', einsatzart: 'Revierdienst',
    sparte: 'sicherheit', aktiv: 1, bemerkung: null, masterschichten: 0, stunden_je_einsatz: 0 },
]};
// Der Server ersetzt den Bestand vollstaendig und gibt zurueck, was wirklich
// gespeichert wurde -- der Mock stellt genau das nach, samt Verwerfen leerer
// Kontaktwege. Ohne dieses Verwerfen liesse sich nicht pruefen, dass die
// Maske den Serverstand uebernimmt statt ihren eigenen.
let GESPEICHERT = { personen: [] };
let dashRufe = [];

const browser = await chromium.launch({ executablePath: EXE });
const dash = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
dash.on('pageerror', e => bad.push('JS-Fehler (Dashboard): ' + e.message));

await dash.route('**/api/**', route => {
  const req = route.request();
  const url = new URL(req.url());
  const p = url.pathname.split('/api/')[1];
  let body = null;
  try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch {}
  dashRufe.push({ p, body, query: Object.fromEntries(url.searchParams) });
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'adrian', ist_admin: true });
  if (p.includes('me.php')) return send({ status: 'ok', name: 'adrian', ist_admin: true, rollen: [], rechte: ['plan'] });
  if (p.includes('dashboard_stats')) return send({ status: 'ok',
    kpi: { rapporte_monat: 0, rapporte_vormonat: 0, stunden_monat: 0, stunden_vormonat: 0,
           mitarbeiter: 1, kunden: 1, rapporte_total: 0 },
    verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [] });
  if (p.includes('objekt_personen')) {
    if (body) {
      GESPEICHERT = { personen: (body.personen || [])
        .map(x => ({ ...x, kontaktwege: (x.kontaktwege || []).filter(w => String(w.wert || '').trim() !== '') }))
        .filter(x => x.vorname || x.nachname || x.funktion || x.kontaktwege.length) };
    }
    return send({ status: 'ok', personen: GESPEICHERT.personen, kontaktwege: [] });
  }
  if (p.includes('objekt_list')) return send(OBJEKTE);
  if (p.includes('masterschicht_list')) return send({ status: 'ok', masterschichten: [] });
  if (p.includes('kunden_list')) return send({ status: 'ok', kunden: [
    { id: 1, name: 'Musterliegenschaften AG', strasse: 'Musterweg 1', ort: '9999 Musterdorf' }] });
  if (p.includes('mitarbeiter_list')) return send({ status: 'ok', mitarbeiter: [] });
  if (p.includes('einsatz_list')) return send({ status: 'ok', einsaetze: [] });
  if (p.includes('rapport_list')) return send({ status: 'ok', rapporte: [] });
  return send({ status: 'ok' });
});

await dash.goto(`file://${WURZEL}/dashboard.html`);
await dash.fill('#gName', 'adrian'); await dash.fill('#gPass', 'x'); await dash.click('#gBtn');
await dash.waitForSelector('#kpiGrid .kpi-val');
await dash.waitForTimeout(400);

// Erst die Objektliste laden: openObjekt() sucht das Objekt im lokalen
// Array, das ausschliesslich vom Server kommt.
await dash.evaluate(() => loadObjekte());
await dash.waitForTimeout(400);
dashRufe = [];
await dash.evaluate(() => openObjekt(1));
await dash.waitForTimeout(600);

check('KRITISCH: die Pflege steht auf der Objekt-Übersicht, nicht in einer eigenen Maske',
  await dash.isVisible('#opZone') && await dash.isVisible('#ob-uebersicht'));
check('KRITISCH: beim Öffnen des Objekts werden dessen Ansprechpartner geladen',
  dashRufe.some(r => r.p.includes('objekt_personen') && r.query.objekt_id === '1'));
check('Der Hinweis sagt, dass sie die Kundenkontakte ergänzen statt ersetzen',
  (await dash.textContent('#opZone')).includes('ergänzen'));
check('Er sagt auch, wo Mitarbeitende die Angaben zu sehen bekommen',
  (await dash.textContent('#opZone')).includes('Rundgang'));
check('Es gibt ein Feld für die Funktion vor Ort',
  await dash.isVisible('#opp_funktion_0'));
check('Der Hinweis dort sagt ausdrücklich, dass eine Zeile ohne Namen in Ordnung ist',
  (await dash.textContent('#opZone')).includes('ohne Namen'));
check('KRITISCH: die Zone steht über dem Löschbereich -- Gefährliches gehört ans Ende (gemessen)',
  await dash.evaluate(() => document.getElementById('opZone').getBoundingClientRect().top
    < document.querySelector('#ob-uebersicht .zone.danger').getBoundingClientRect().top));

// Eine Person NUR mit Funktion und Nummer -- ohne Namen.
await dash.fill('#opp_funktion_0', 'Hauswart');
await dash.fill('#opPersonenListe [data-opw="wert"][data-pi="0"][data-wi="0"]', '079 000 11 22');
// Zweite Person, vollstaendig leer -- sie darf NICHT gespeichert werden.
await dash.click('#opZone button:has-text("Ansprechpartner hinzufügen")');
await dash.waitForTimeout(200);
check('Ein zweiter Block lässt sich hinzufügen', await dash.isVisible('#opp_funktion_1'));
dashRufe = [];
await dash.click('#opSpeichern');
await dash.waitForTimeout(400);

const gesendet = dashRufe.find(r => r.p.includes('objekt_personen') && r.body);
check('KRITISCH: gespeichert wird mit der Objekt-Id und dem vollständigen Stand',
  !!gesendet && gesendet.body.objekt_id === 1 && Array.isArray(gesendet.body.personen));
check('KRITISCH: eine Person nur mit Funktion und Nummer wird mitgeschickt -- ohne Namen ist gültig',
  !!gesendet && gesendet.body.personen.some(p => p.funktion === 'Hauswart'
    && (p.kontaktwege || []).some(w => w.wert === '079 000 11 22')));
check('KRITISCH: die leere Zeile wird nicht als Ansprechpartner gespeichert',
  GESPEICHERT.personen.length === 1);
check('KRITISCH: die Maske übernimmt danach den Serverstand, nicht ihren eigenen',
  await dash.evaluate(() => document.querySelectorAll('#opPersonenListe .ku-person').length === 1));
await dash.screenshot({ path: `${OUT}/objap-01-dashboard.png` });

// ══════════ TEIL 3: ANZEIGE IM RUNDGANG ═══════════════════════════════
const SCHICHTEN = { status: 'ok', von: tag(-30), bis: tag(90), schichten: [
  { id: 71, kunde_name: 'Musterliegenschaften AG', titel: 'Nachtwache', strasse: 'Musterweg 4', ort: '9999 Musterdorf',
    einsatzart: 'Revierdienst', sparte: 'sicherheit', datum: tag(-1), von: '20:00:00', bis: '06:00:00',
    status: 'bestaetigt', bemerkung: null, zusage: 'zugesagt', objekt_name: 'Musterobjekt Industrie', objekt_id: 7,
    hat_kontrollpunkte: true, im_team: 1 },
]};
const PROFIL = { status: 'ok', monat: { anzahl: 0, stunden: 0 }, profil: {
  name: 'm.muster', ist_admin: false, personalnummer: 'P-001',
  vorname: 'Max', nachname: 'Muster', erstellt_am: tag(-30) + ' 10:00:00' } };

const UEBERSICHT = { status: 'ok',
  vorlage: { id: 801, name: 'Schliessrunde', fenster_von: null, fenster_bis: null },
  objekt: { id: 7, name: 'Musterobjekt Industrie', strasse: 'Musterweg 4', ort: '9999 Musterdorf',
    kanton: 'SO', bemerkung: null },
  kunde_name: 'Musterliegenschaften AG',
  kontrollpunkte: [{ id: 1, bezeichnung: 'Eingang Nord', typ: 'geofence' }],
  // Reihenfolge wie der echte Endpunkt sie liefert: Objekt zuerst.
  ansprechpartner: [
    { name: 'Ruedi Beispiel', anrede: 'Herr', funktion: 'Hauswart', quelle: 'objekt',
      wege: [{ art: 'mobil', wert: '079 000 11 22' }] },
    { name: 'Hauswart', anrede: null, funktion: null, quelle: 'objekt',
      wege: [{ art: 'telefon', wert: '062 000 00 11' }] },
    { name: 'Vreni Beispiel', anrede: 'Frau', funktion: null, quelle: 'kunde',
      wege: [{ art: 'telefon', wert: '062 000 00 00' }] },
  ],
  laufend: null, zentrale: null };

const app = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
app.on('pageerror', e => bad.push('JS-Fehler (App): ' + e.message));
await app.route('**/api/**', route => {
  const url = new URL(route.request().url());
  const p = url.pathname.split('/api/')[1];
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'm.muster', ist_admin: false });
  if (p.includes('meine_schichten')) return send(SCHICHTEN);
  if (p.includes('mein_profil')) return send(PROFIL);
  if (p.includes('rapport_list')) return send({ status: 'ok', rapporte: [] });
  if (p.includes('mein_rundgang_offen')) return send({ status: 'ok', rundgang: null });
  if (p.includes('mein_rundgang_uebersicht')) return send(UEBERSICHT);
  if (p.includes('mein_rundgang_vorlagen_alle')) return send({ status: 'ok', vorlagen: [
    { id: 801, name: 'Schliessrunde', objekt_id: 7, objekt_name: 'Musterobjekt Industrie',
      kunde_name: 'Musterliegenschaften AG', fenster_von: null, fenster_bis: null }] });
  return send({ status: 'ok' });
});

await app.goto(`file://${WURZEL}/app.html`);
await app.fill('#gName', 'm.muster'); await app.fill('#gPass', 'x'); await app.click('#gBtn');
await app.waitForSelector('.app.on');
await app.waitForTimeout(400);
await app.evaluate(() => rundgangUebersichtOeffnen());
await app.waitForTimeout(300);
await app.click('#blBody button:has-text("Schliessrunde")');
await app.waitForTimeout(400);
await app.click('#rgsKlappAp .rgs-klapp-kopf');
await app.waitForTimeout(250);

check('KRITISCH: die Zahl am Block zählt beide Quellen zusammen',
  (await app.textContent('#rgsKlappAp .rgs-klapp-zahl')) === '3');
const leute = await app.evaluate(() => [...document.querySelectorAll('#rgsKlappAp .rgs-person')]
  .map(el => ({
    name: el.querySelector('.rgs-person-name').textContent,
    quelle: el.querySelector('.rgs-quelle')?.textContent.trim(),
    vorort: !!el.querySelector('.rgs-quelle.vorort'),
    fkt: el.querySelector('.rgs-person-fkt')?.textContent.trim() || null,
    y: el.getBoundingClientRect().top,
  })));
check('KRITISCH: die Leute vor Ort stehen zuoberst, der Kunde darunter (gemessen)',
  leute.length === 3 && leute[0].vorort && leute[1].vorort && !leute[2].vorort
  && leute[0].y < leute[2].y);
check('KRITISCH: jeder Eintrag sagt, wen man da anruft -- als Wort, nicht nur als Farbe',
  leute[0].quelle === 'Vor Ort' && leute[2].quelle === 'Beim Kunden');
check('Die Funktion vor Ort steht beim Namen',
  leute[0].fkt === 'Hauswart');
check('Ein Eintrag ohne Namen zeigt die Funktion als Bezeichnung',
  leute[1].name === 'Hauswart');
check('KRITISCH: alle Nummern sind Anruf-Ziele, auch die vom Objekt',
  await app.evaluate(() => document.querySelectorAll('#rgsKlappAp a[href^="tel:"]').length === 3));
check('KRITISCH: die Trefferflächen bleiben mindestens 44px hoch (CLAUDE.md)',
  await app.evaluate(() => [...document.querySelectorAll('#rgsKlappAp .rgs-weg')]
    .every(a => a.getBoundingClientRect().height >= 44)));
check('KRITISCH: kein waagrechter Seiten-Scroll bei 390px', await app.evaluate(() =>
  document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
await app.screenshot({ path: `${OUT}/objap-02-app.png` });

await app.setViewportSize({ width: 1440, height: 900 });
await app.waitForTimeout(250);
check('Am Desktop bleibt der Block innerhalb der App-Breite',
  await app.evaluate(() => {
    const k = document.getElementById('rgsKlappAp').getBoundingClientRect();
    const s = document.getElementById('rgSeite').getBoundingClientRect();
    return k.width <= s.width && s.width <= 561;
  }));
check('KRITISCH: am Desktop kein waagrechter Seiten-Scroll', await app.evaluate(() =>
  document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
