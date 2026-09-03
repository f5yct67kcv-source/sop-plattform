// Dienstfahrzeuge -- Fahrzeugstamm unter Administration > Einstellungen (ENT-313).
//
// WORAUF DIESE SUITE BESONDERS ACHTET:
//
// 1. VIER verschiedene Aussagen duerfen nicht gleich aussehen. "Tabelle noch
//    nicht eingerichtet", "eingerichtet, aber kein Fahrzeug erfasst", "kein
//    MFK-Termin hinterlegt" und "MFK ueberfaellig" sind vier Sachverhalte mit
//    vier Folgen. Genau diese Regel ist in diesem Repository mehrfach
//    verletzt worden; sie steht in CLAUDE.md als die wichtigste.
//
// 2. Ein Kilometerstand ohne Ablesedatum ist NICHT beurteilbar. Er wird
//    zurueckgewiesen, statt still auf "heute" gesetzt zu werden -- das waere
//    eine erfundene Tatsache an genau der Stelle, an der spaeter eine
//    Abweichung gerechnet werden soll.
//
// 3. Die Karte ist STAMMDATEN und behauptet das auch. Sie rechnet nichts und
//    kontrolliert nichts; das Fahrtenbuch ist ein eigener Schritt. Waechst
//    hier eine Kilometerkontrolle hinein, faellt diese Suite um.
//
// 4. Zwei Felder haben nur in einem Teil der Faelle Bedeutung (Vertragsende
//    bei Leasing/Miete, Grund bei "Ausser Betrieb"). Sie werden ausgeblendet
//    statt bloss serverseitig verworfen -- ein Feld, das man ausfuellen kann
//    und das beim Speichern verschwindet, ist stiller Datenverlust.
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const HEUTE = iso(new Date());
// Kein festes Datum nahe beim heutigen Tag (test_datumsfest.mjs) -- beide
// werden aus HEUTE gerechnet.
const LAENGST_VORBEI = iso(new Date(Date.now() - 400 * 864e5));
const WEIT_VORAUS    = iso(new Date(Date.now() + 400 * 864e5));

// ══════════════════════════════════════════════════════════════════════════
// TEIL 1 — Schema und Endpunkt (Quelltext)
// ══════════════════════════════════════════════════════════════════════════
const EINR = readFileSync(`${WURZEL}/backend/api/planung_einrichten.php`, 'utf8');
const FZ   = readFileSync(`${WURZEL}/backend/api/fahrzeuge.php`, 'utf8');

check('KRITISCH: die Tabelle fahrzeuge steht im Einrichtungsschema',
  /CREATE TABLE IF NOT EXISTS fahrzeuge/.test(EINR));
check('KRITISCH: das Kontrollschild ist eindeutig — zwei Zeilen fuer dasselbe Auto waeren zwei Wahrheiten',
  /UNIQUE KEY \w+ \(kennzeichen\)/.test(EINR));
// Nur der fahrzeuge-Block, nicht die ganze Datei: Ein "aktiv TINYINT"
// irgendwo weiter unten gehoert einer anderen Tabelle und sagt hier nichts.
const FZ_BLOCK = (EINR.match(/CREATE TABLE IF NOT EXISTS fahrzeuge[\s\S]*?ENGINE=InnoDB/) || [''])[0];
check('KRITISCH: der Zustand ist ein Status, kein Ja/Nein — "in der Werkstatt" ist nicht "verkauft"',
  /status VARCHAR\(20\) NOT NULL DEFAULT 'aktiv'/.test(FZ_BLOCK) && !/\baktiv TINYINT/.test(FZ_BLOCK));
check('Der Kilometerstand traegt sein Ablesedatum bei sich',
  /tacho_km INT NULL/.test(EINR) && /tacho_am DATE NULL/.test(EINR));
check('Der Standort zeigt auf die Anstellungsorte — dort haengen die gepflegten Wegstrecken',
  /FOREIGN KEY \(standort_id\) REFERENCES anstellungsorte\(id\)/.test(EINR));

check('KRITISCH: Aendern verlangt das Recht "betrieb"', /require_recht\(\$user, 'betrieb'\)/.test(FZ));
check('KRITISCH: Lesen steht vor der Betriebs-Rechtepruefung — die Planung braucht die Auswahlliste',
  FZ.indexOf("REQUEST_METHOD'] === 'GET'") < FZ.indexOf("require_recht($user, 'betrieb')"));
check('KRITISCH: eine fehlende Tabelle meldet "eingerichtet: false" statt einer leeren Liste ohne Hinweis',
  /hat_tabelle\(\$pdo, 'fahrzeuge'\)[\s\S]{0,400}'eingerichtet' => false/.test(FZ));
check('KRITISCH: ein Kilometerstand ohne Ablesedatum wird serverseitig abgewiesen',
  /\$tachoKm !== null && \$tachoAm === null/.test(FZ));
check('Ein doppeltes Kontrollschild wird abgewiesen, nicht als zweites Fahrzeug angelegt',
  /SELECT id FROM fahrzeuge WHERE kennzeichen = \? AND id <> \?/.test(FZ));
check('Das Kontrollschild wird vereinheitlicht, sonst waeren "so 1" und "SO 1" zwei Fahrzeuge',
  /strtoupper/.test(FZ) && /preg_replace\('\/\\s\+\/', ' '/.test(FZ));
check('KRITISCH: nicht erfasste Zahlen bleiben NULL und werden nicht zu 0',
  /\$r\[\$z\] = \$r\[\$z\] === null \? null : \(int\)\$r\[\$z\]/.test(FZ));
// Diese Datei fuehrt Stammdaten. Entstuende hier eine Kilometerkontrolle,
// waere sie am falschen Ort -- und die Trennung, auf der ENT-313 beruht,
// waere still aufgehoben. Geprueft wird nicht der Wortlaut (ein Kommentar
// darf ueber das Fahrtenbuch reden), sondern WAS der Endpunkt anfasst.
//
// Geschrieben wird ausschliesslich in `fahrzeuge`. Gelesen werden zusaetzlich
// `anstellungsorte` (der Standort) und seit ENT-328 `einsaetze` -- fuer die
// Zaehlung, die das Loeschen eines eingeteilten Fahrzeugs verhindert. Ein
// Fahrtenbuch braeuchte eine eigene Tabelle und einen Schreibweg dorthin;
// beides faellt hier auf.
const FZ_SCHREIBT = [...FZ.matchAll(/\b(?:INSERT INTO|UPDATE|DELETE FROM)\s+([a-z_]+)/g)]
  .map(m => m[1]);
const FZ_LIEST = [...FZ.matchAll(/\b(?:FROM|JOIN)\s+([a-z_]+)/g)]
  .map(m => m[1]).filter(t => t !== 'DUPLICATE');
check('KRITISCH: geschrieben wird ausschliesslich in die Fahrzeug-Stammdaten',
  FZ_SCHREIBT.length > 0 && FZ_SCHREIBT.every(t => t === 'fahrzeuge'));
check('KRITISCH: gelesen wird nur, was der Stamm braucht — kein Fahrtenbuch',
  FZ_LIEST.length > 0
  && FZ_LIEST.every(t => ['fahrzeuge', 'anstellungsorte', 'einsaetze'].includes(t)));

// ══════════════════════════════════════════════════════════════════════════
// TEIL 2 — Die Oberflaeche
// ══════════════════════════════════════════════════════════════════════════
const ORTE = [
  { id: 1, bezeichnung: 'Hauptsitz', rolle: 'hao', strasse: 'Musterweg 1', plz: '4600',
    ort: 'Olten', km_zum_anderen: null, aktiv: 1, bemerkung: null },
];
// Erfundene Kontrollschilder -- hohe Nummern, damit sie keinem echten
// Fahrzeug entsprechen (CLAUDE.md: keine echten Daten in Testdaten).
let FAHRZEUGE = [
  { id: 1, kennzeichen: 'SO 999001', bezeichnung: 'Patrouille 1', marke: 'Muster',
    modell: 'Kombi 2.0', art: 'kombi', treibstoff: 'Benzin', farbe: 'weiss',
    stammnummer: null, fahrgestellnummer: null, erstzulassung: null,
    besitzart: 'leasing', besitz_bis: WEIT_VORAUS, standort_id: 1, standort_name: 'Hauptsitz',
    status: 'aktiv', ausser_betrieb_grund: null,
    mfk_naechste: LAENGST_VORBEI, vignette_jahr: null, versicherung: null, police_nr: null,
    service_naechster: null, service_naechste_km: null,
    tacho_km: 41200, tacho_am: HEUTE, bemerkung: null },
  // Zweites Fahrzeug: alles, was unbekannt sein kann, ist unbekannt. Es
  // haelt die vier Aussagen aus Punkt 1 der Kopfzeile pruefbar.
  { id: 2, kennzeichen: 'SO 999002', bezeichnung: null, marke: null, modell: null,
    art: 'personenwagen', treibstoff: null, farbe: null,
    stammnummer: null, fahrgestellnummer: null, erstzulassung: null,
    besitzart: 'eigentum', besitz_bis: null, standort_id: null, standort_name: null,
    status: 'ausser_betrieb', ausser_betrieb_grund: 'in der Werkstatt',
    mfk_naechste: null, vignette_jahr: null, versicherung: null, police_nr: null,
    service_naechster: null, service_naechste_km: null,
    tacho_km: null, tacho_am: null, bemerkung: null },
];
let EINGERICHTET = true;
const gesendet = [];
let naechsteAntwort = null;   // erzwingt eine Fehlerantwort fuer den naechsten POST

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));

await page.route('**/api/**', route => {
  const req = route.request(), u = req.url();
  let body = null;
  try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch (e) {}
  const s = x => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) });
  if (u.includes('login')) return s({ status: 'ok', token: 't', name: 'adrian', ist_admin: true });
  if (u.includes('me.php')) return s({ status: 'ok', name: 'adrian', ist_admin: true,
    rollen: ['verwaltung'], rechte: ['betrieb', 'plan', 'kunden', 'abgleich', 'personal_lesen'] });
  if (u.includes('anstellungsorte')) return s({ status: 'ok', orte: ORTE });
  if (u.includes('fahrzeuge.php')) {
    if (body) {
      gesendet.push(body);
      if (naechsteAntwort) {
        const a = naechsteAntwort; naechsteAntwort = null;
        return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify(a) });
      }
      if (body.loeschen) { FAHRZEUGE = FAHRZEUGE.filter(f => f.id !== body.id); }
    }
    return s({ status: 'ok', eingerichtet: EINGERICHTET, fahrzeuge: EINGERICHTET ? FAHRZEUGE : [] });
  }
  if (u.includes('betrieb.php')) return s({ status: 'ok', betrieb: { firma: 'Muster AG', zusatz: '' } });
  if (u.includes('mitarbeiter_list')) return s({ status: 'ok', mitarbeiter: [] });
  if (u.includes('dashboard_stats')) return s({ status: 'ok', kpi: {}, verlauf: [], angemeldet: [],
    pro_mitarbeiter: [], letzte_rapporte: [], sperr_ereignisse: [] });
  return s({ status: 'ok', einsaetze: [], rapporte: [], objekte: [], feiertage: [], gepflegt: {},
    sperren: [], adressen: [], wege: [], fahrzeuge: [], dokumente: [], positionen: [], orte: [] });
});

await page.goto(`file://${WURZEL}/dashboard.html`);
await page.fill('#gName', 'adrian'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#shell.on'); await page.waitForTimeout(600);

// ── Die Kachel steht in der Uebersicht und fuehrt auf ihre Unteransicht ──
await page.evaluate(() => { go('betrieb'); });
await page.waitForTimeout(600);
check('KRITISCH: die Kachel "Dienstfahrzeuge" steht in den Einstellungen',
  await page.isVisible('.bk-kachel:has-text("Dienstfahrzeuge")'));
check('Sie steht auf der Kachel-Uebersicht, nicht in einer schon offenen Sektion',
  await page.isVisible('#bkUebersicht') && !(await page.isVisible('#fzKarte')));

await page.click('.bk-kachel:has-text("Dienstfahrzeuge")');
await page.waitForTimeout(300);
check('KRITISCH: die Kachel fuehrt auf die Karte "Dienstfahrzeuge"',
  await page.isVisible('#fzKarte') && !(await page.isVisible('#bkUebersicht')));
// Der Hinweistext ist im Quelltext umgebrochen -- verglichen wird der
// gelesene Satz, nicht seine Zeilenaufteilung.
const kartenText = (await page.textContent('#fzKarte')).replace(/\s+/g, ' ');
check('KRITISCH: die Karte sagt, dass hier nichts kontrolliert und nichts gerechnet wird',
  /nichts kontrolliert und nichts gerechnet/.test(kartenText));

// ── Die Liste unterscheidet, was verschieden ist ──────────────────────────
const listeText = await page.textContent('#fzListe');
check('KRITISCH: ein fehlender MFK-Termin heisst "nicht hinterlegt" — nicht "–" und nicht nichts',
  /nicht hinterlegt/.test(listeText));
check('KRITISCH: ein abgelaufener MFK-Termin heisst "ueberfaellig"',
  /überfällig/.test(listeText));
check('KRITISCH: ein nie abgelesener Kilometerstand heisst "nie abgelesen", nicht "0 km"',
  /nie abgelesen/.test(listeText) && !/\b0 km\b/.test(listeText));
check('Ein abgelesener Kilometerstand steht mit seinem Ablesedatum da',
  /41.200 km/.test(listeText) || /41'200 km/.test(listeText));
check('Ein Fahrzeug ohne Standort heisst "nicht zugeordnet"', /nicht zugeordnet/.test(listeText));
check('Der Grund fuer "Ausser Betrieb" steht in der Zeile', /in der Werkstatt/.test(listeText));

// ── Felder, die nur manchmal Bedeutung haben, sind nur manchmal da ────────
check('KRITISCH: bei "In Betrieb" ist das Grundfeld ausgeblendet — es wuerde beim Speichern verworfen',
  !(await page.isVisible('#fzGrundFeld')));
check('Bei Eigentum ist das Vertragsende ausgeblendet', !(await page.isVisible('#fzBesitzBisFeld')));
await page.selectOption('#fzStatus', 'ausser_betrieb');
await page.selectOption('#fzBesitzart', 'leasing');
await page.waitForTimeout(150);
check('KRITISCH: bei "Ausser Betrieb" erscheint das Grundfeld', await page.isVisible('#fzGrundFeld'));
check('Bei Leasing erscheint das Vertragsende', await page.isVisible('#fzBesitzBisFeld'));
await page.selectOption('#fzStatus', 'aktiv');
await page.selectOption('#fzBesitzart', 'eigentum');

// ── Die Standortwahl kennt "nicht zugeordnet" und "keine Orte erfasst" ────
check('KRITISCH: die Standortwahl bietet ausdruecklich "keinem Standort zugeordnet" an',
  /keinem Standort zugeordnet/.test(await page.textContent('#fzStandort')));
check('Der erfasste Anstellungsort steht zur Wahl',
  /Hauptsitz/.test(await page.textContent('#fzStandort')));

// ── Ein Kilometerstand ohne Ablesedatum geht gar nicht erst hinaus ────────
const vorher = gesendet.length;
await page.fill('#fzKennzeichen', 'SO 999003');
await page.fill('#fzTachoKm', '55000');
await page.click('#fzBtn');
await page.waitForTimeout(300);
check('KRITISCH: ein Kilometerstand ohne Ablesedatum wird abgelehnt',
  /abgelesen/.test(await page.textContent('#fzErr')) && await page.isVisible('#fzErr'));
check('KRITISCH: er wird dabei gar nicht erst an den Server geschickt',
  gesendet.length === vorher);

// ── Vollstaendig ausgefuellt: alles kommt an ──────────────────────────────
await page.fill('#fzTachoAm', HEUTE);
await page.fill('#fzBezeichnung', 'Patrouille 3');
await page.fill('#fzMarke', 'Muster');
await page.selectOption('#fzArt', 'lieferwagen');
await page.selectOption('#fzStandort', '1');
await page.fill('#fzMfk', WEIT_VORAUS);
await page.fill('#fzServiceKm', "120'000");
await page.click('#fzBtn');
await page.waitForTimeout(400);
const letzte = gesendet[gesendet.length - 1] || {};
check('KRITISCH: das Fahrzeug wird gespeichert', letzte.kennzeichen === 'SO 999003');
check('Die Fahrzeugart geht mit', letzte.art === 'lieferwagen');
check('Der Standort geht als Verweis mit, nicht als Text', String(letzte.standort_id) === '1');
check('KRITISCH: ein Tausendertrennzeichen im Kilometerfeld bricht das Speichern nicht',
  letzte.service_naechste_km === '120000');
check('Kilometerstand und Ablesedatum gehen zusammen mit',
  letzte.tacho_km === '55000' && letzte.tacho_am === HEUTE);
check('Nach dem Speichern ist das Formular wieder leer',
  (await page.inputValue('#fzKennzeichen')) === '');

// ── Eine Serverabweisung wird angezeigt, nicht verschluckt ────────────────
naechsteAntwort = { status: 'error', message: 'Ein Fahrzeug mit dem Kontrollschild SO 999001 ist bereits erfasst.' };
await page.fill('#fzKennzeichen', 'SO 999001');
await page.click('#fzBtn');
await page.waitForTimeout(400);
check('KRITISCH: eine Abweisung des Servers steht in der Karte, nicht nur in der Konsole',
  /bereits erfasst/.test(await page.textContent('#fzErr')));
check('Der Knopf ist danach wieder bedienbar',
  await page.evaluate(() => !document.getElementById('fzBtn').disabled));

// ── Aendern fuellt das Formular, ohne Reste des vorigen Standes ───────────
await page.evaluate(() => fzBearbeiten(2));
await page.waitForTimeout(250);
check('KRITISCH: "Ändern" laedt das gewaehlte Fahrzeug',
  (await page.inputValue('#fzKennzeichen')) === 'SO 999002');
check('KRITISCH: Felder, die dieses Fahrzeug nicht hat, bleiben leer — kein Rest des vorigen',
  (await page.inputValue('#fzMarke')) === '' && (await page.inputValue('#fzTachoKm')) === '');
check('Der Knopf heisst jetzt "Speichern", nicht "Hinzufügen"',
  (await page.textContent('#fzBtn')).includes('Speichern'));

// ── Loeschen fragt nach und nennt den schonenderen Weg ────────────────────
await page.evaluate(() => fzLoeschen(2));
await page.waitForTimeout(250);
check('KRITISCH: Loeschen fragt zurueck', await page.isVisible('#dlgConfirm'));
check('Die Rueckfrage nennt "Ausser Betrieb" als den schonenderen Weg',
  /Ausser Betrieb/.test(await page.textContent('#dlgConfirm')));
await page.click('#cfBtn');
await page.waitForTimeout(400);
check('KRITISCH: das Fahrzeug wird geloescht',
  gesendet.some(b => b.loeschen === true && b.id === 2));
check('Die Liste zeigt es danach nicht mehr',
  !/SO 999002/.test(await page.textContent('#fzListe')));

// ── "Nicht eingerichtet" ist etwas anderes als "kein Fahrzeug" ────────────
EINGERICHTET = false;
await page.evaluate(() => ladeFahrzeuge().then(() => fzListeZeichnen()));
await page.waitForTimeout(400);
const leerText = await page.textContent('#fzListe');
check('KRITISCH: eine fehlende Tabelle sagt "noch nicht eingerichtet"',
  /nicht eingerichtet/i.test(leerText));
check('KRITISCH: sie sagt NICHT "kein Fahrzeug erfasst" — das waere eine andere Aussage',
  !/kein Fahrzeug erfasst/i.test(leerText));
check('KRITISCH: ohne Einrichtung laesst sich nichts anlegen — der Knopf ist gesperrt',
  await page.evaluate(() => document.getElementById('fzBtn').disabled));

EINGERICHTET = true;
FAHRZEUGE = [];
await page.evaluate(() => ladeFahrzeuge().then(() => fzListeZeichnen()));
await page.waitForTimeout(400);
const keineText = await page.textContent('#fzListe');
check('KRITISCH: eingerichtet und leer sagt "Noch kein Fahrzeug erfasst"',
  /Noch kein Fahrzeug erfasst/.test(keineText));
check('KRITISCH: und eben NICHT "nicht eingerichtet"', !/nicht eingerichtet/i.test(keineText));
check('Der Knopf ist wieder bedienbar',
  await page.evaluate(() => !document.getElementById('fzBtn').disabled));

// ── "Zurück" fuehrt auf die Kachel-Uebersicht ─────────────────────────────
await page.click('#view-betrieb .bk-abschnitt#bkAb-fz .bk-zurueck');
await page.waitForTimeout(200);
check('KRITISCH: "Zurück" fuehrt wieder auf die Kachel-Uebersicht',
  await page.isVisible('#bkUebersicht') && !(await page.isVisible('#fzKarte')));

// ══════════════════════════════════════════════════════════════════════════
// TEIL 3 — Gestaltung, am gerenderten Zustand GEMESSEN (nicht im Code gelesen)
// ══════════════════════════════════════════════════════════════════════════
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
await page.evaluate(() => { go('betrieb'); bkAbschnittZeigen('fz'); });
await page.waitForTimeout(400);

const masse = await page.evaluate(() => {
  const knopf = document.getElementById('fzBtn');
  const feld = document.getElementById('fzKennzeichen');
  const wahl = document.getElementById('fzArt');
  return {
    knopfHoehe: knopf.getBoundingClientRect().height,
    feldHoehe: feld.getBoundingClientRect().height,
    feldSchrift: parseFloat(getComputedStyle(feld).fontSize),
    wahlSchrift: parseFloat(getComputedStyle(wahl).fontSize),
    breiter: document.getElementById('fzKarte').scrollWidth > document.documentElement.clientWidth + 1,
  };
});
check('Handy: der Speichern-Knopf ist mindestens 44 px hoch', masse.knopfHoehe >= 44);
check('Handy: das Eingabefeld ist mindestens 44 px hoch', masse.feldHoehe >= 44);
check('KRITISCH: Handy: Eingabefelder haben mindestens 16 px Schrift — darunter zoomt iOS hinein',
  masse.feldSchrift >= 16 && masse.wahlSchrift >= 16);
check('KRITISCH: Handy: die Karte laeuft nicht ueber den Bildschirmrand hinaus', !masse.breiter);

// Die Beschriftung steht UEBER dem Feld, nicht darunter (CLAUDE.md).
const labelOben = await page.evaluate(() => {
  const l = document.querySelector('label[for="fzKennzeichen"]');
  const i = document.getElementById('fzKennzeichen');
  return l.getBoundingClientRect().top < i.getBoundingClientRect().top;
});
check('KRITISCH: die Beschriftung steht ueber dem Feld, nicht darunter', labelOben);

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
