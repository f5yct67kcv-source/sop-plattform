// Revierdienst-Übersicht: Kachel-Landingpage (ENT-225, Vorbild Betrieb
// ENT-211) mit einer Liste der letzten Rundgänge darunter. Ersetzt seit
// ENT-225 die vormals direkt verlinkte filterbare Rundgang-Liste
// (ENT-183/193) als Standardinhalt von "Übersicht" -- diese lebt jetzt
// dormant im Code (#rgAlt), bis sie hinter der Kachel "Rundgänge" wieder
// auftaucht.
//
// Reine Anzeige über den seit ENT-180/183 bestehenden Endpunkt
// rundgang_liste.php (Recht rundgang_einsehen) -- die Fachlogik
// (rundgang_fortschritt) läuft bereits echt gegen SQLite in
// pruef_rundgang.php, hier nur, dass die Oberfläche die letzten Rundgänge
// richtig anzeigt und das Recht tatsächlich entscheidet, ob "Revierdienst"
// bzw. die Kachel "Übersicht" überhaupt erscheint.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const SEITE = `file://${WURZEL}/dashboard.html`;
const EXE = browserPfad();

// Relatives Datum statt eines festen Werts -- kippt sonst beim
// Datumswechsel (CLAUDE.md, test_datumsfest.mjs).
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const HEUTE = iso(new Date());

const RUNDGAENGE = { status: 'ok', rundgaenge: [
  { id: 1, einsatz_id: 10, objekt_id: 1, mitarbeiter_id: 5, status: 'abgeschlossen',
    vorbereitet_am: `${HEUTE} 20:00:00`, rohzeit_start: `${HEUTE} 20:04:00`,
    rohzeit_ende: `${HEUTE} 20:41:00`, datum: HEUTE, kunde_name: 'Muster Liegenschaften AG',
    objekt_name: 'Testliegenschaft Nord', titel: 'Öffnungsrunde', vorname: 'Erika', nachname: 'Muster',
    fortschritt: { gesamt: 3, bestaetigt: 2, nicht_verfuegbar: 1 } },
  { id: 2, einsatz_id: 11, objekt_id: 2, mitarbeiter_id: 6, status: 'laeuft',
    vorbereitet_am: `${HEUTE} 21:00:00`, rohzeit_start: `${HEUTE} 21:02:00`,
    rohzeit_ende: null, datum: HEUTE, kunde_name: 'Beispiel Immobilien GmbH',
    objekt_name: 'Testliegenschaft Süd', titel: null, vorname: 'Hans', nachname: 'Beispiel',
    // Ein Punkt per Ersatzscan (ENT-329): Er zaehlt als erledigt mit, wird
    // aber getrennt ausgewiesen. Der Punkt mit "nicht_verfuegbar" oben zaehlt
    // dagegen NICHT -- dort wurde der Punkt gar nicht erreicht.
    fortschritt: { gesamt: 4, bestaetigt: 1, nicht_verfuegbar: 0, ersatzscan: 1, erledigt: 2 },
    pause_minuten: 0 },
  // Pausiert (ENT-146) -- die Rohzeit "laeuft nicht noch", sie steht still.
  { id: 3, einsatz_id: 12, objekt_id: 1, mitarbeiter_id: 5, status: 'pausiert',
    vorbereitet_am: `${HEUTE} 22:00:00`, rohzeit_start: `${HEUTE} 22:05:00`,
    rohzeit_ende: null, datum: HEUTE, kunde_name: 'Muster Liegenschaften AG',
    objekt_name: 'Testliegenschaft Nord', vorname: 'Erika', nachname: 'Muster',
    fortschritt: { gesamt: 3, bestaetigt: 1, nicht_verfuegbar: 0 }, pause_minuten: 12 },
  // Abgebrochen (ENT-146) -- Grund und Freitext muessen erscheinen, "laeuft
  // noch" darf trotz fehlendem rohzeit_ende nicht angezeigt werden.
  { id: 4, einsatz_id: 13, objekt_id: 2, mitarbeiter_id: 6, status: 'abgebrochen',
    vorbereitet_am: `${HEUTE} 23:00:00`, rohzeit_start: `${HEUTE} 23:03:00`,
    rohzeit_ende: null, datum: HEUTE, kunde_name: 'Beispiel Immobilien GmbH',
    objekt_name: 'Testliegenschaft Süd', vorname: 'Hans', nachname: 'Beispiel',
    fortschritt: { gesamt: 4, bestaetigt: 2, nicht_verfuegbar: 0 }, pause_minuten: 0,
    abbruch_grund: 'notfall_gebunden', abbruch_freitext: 'Kollege krank, musste einspringen' },
]};

const OBJEKTE = { status: 'ok', objekte: [
  { id: 1, kunde_id: 1, kunde_name: 'Muster Liegenschaften AG', name: 'Testliegenschaft Nord',
    strasse: 'Testweg 1', ort: '9999 Beispielhausen', kanton: 'SO', einsatzart: 'Revierdienst',
    aktiv: 1, bemerkung: null, masterschichten: 0, stunden_je_einsatz: 0 },
  { id: 2, kunde_id: 2, kunde_name: 'Beispiel Immobilien GmbH', name: 'Testliegenschaft Süd',
    strasse: 'Musterstrasse 2', ort: '9998 Beispielhausen', kanton: 'SO', einsatzart: 'Revierdienst',
    aktiv: 1, bemerkung: null, masterschichten: 0, stunden_je_einsatz: 0 },
]};

let calls = [];

async function setup(page, rechte) {
  await page.route('**/api/**', async route => {
    const req = route.request();
    const u = new URL(req.url());
    const path = u.pathname.split('/api/')[1];
    let body = null;
    try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch {}
    calls.push({ path, body, query: Object.fromEntries(u.searchParams) });
    const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    const login = { status: 'ok', token: 't', name: 'adrian', ist_admin: true };
    if (rechte) { login.rechte = rechte; login.rollen = ['waechter']; }
    if (path.includes('login')) return send(login);
    if (path.includes('dashboard_stats')) return send({ status: 'ok', kpi: {}, verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [] });
    if (path.includes('mitarbeiter_list')) return send({ status: 'ok', mitarbeiter: [] });
    if (path.includes('kunden_list')) return send({ status: 'ok', kunden: [] });
    if (path.includes('einsatz_list')) return send({ status: 'ok', einsaetze: [] });
    if (path.includes('objekt_list')) return send(OBJEKTE);
    if (path.includes('masterschicht_list')) return send({ status: 'ok', masterschichten: [] });
    if (path.includes('rundgang_liste')) return send(RUNDGAENGE);
    // Wird angesteuert, wenn 'plan' vorhanden ist (kontrolleNavKlick() landet
    // dann auf Pensen statt auf Rundgängen) -- ohne dieses Fixture crasht
    // zeichnePensen() auf pensen.mitarbeiter.map(), weil der generische
    // Rückfall unten kein 'mitarbeiter' mitliefert. Nicht der Prüfgegenstand
    // dieser Suite, muss aber trotzdem ein gültiges Objekt sein.
    if (path.includes('pensen.php')) return send({ status: 'ok', jahr: 2026, mitarbeiter: [] });
    return send({ status: 'ok' });
  });
}

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));

const anmelden = async () => {
  await page.goto(SEITE);
  await page.evaluate(() => localStorage.clear());
  await page.goto(SEITE);
  await page.fill('#gName', 'adrian'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
  await page.waitForSelector('#kpiGrid .kpi-val');
};

// ══════════ MIT DEM RECHT: DIE KACHEL ERSCHEINT UND LÄDT
// Die Kinder der Gruppe "Revierdienst" sind per CSS erst sichtbar, sobald die
// Gruppe aufgeklappt ist (.nav-gruppe.offen .nav-kinder) -- die Sichtbarkeit
// einer Kachel lässt sich darum erst NACH dem Öffnen sinnvoll prüfen, nicht
// direkt nach der Anmeldung (gleiches Muster wie zurEinrichtung() in
// test_kontrollpunkte.mjs, das ebenfalls erst öffnet und dann prüft).
await setup(page, null);
await anmelden();
calls = [];
await page.click('#nav-revierdienst');
await page.waitForSelector('#rdLetzteListe table');
await page.waitForTimeout(150);
check('KRITISCH: ein Klick auf "Revierdienst" landet direkt auf Übersicht, nicht auf Einrichtung (seit ENT-241)',
  await page.evaluate(() => document.getElementById('view-rundgaenge').classList.contains('on')));
check('Die Kachel "Übersicht" ist unter Revierdienst sichtbar', await page.isVisible('#nav-revierdienst-uebersicht'));

// ── Kachel-Grid (ENT-225, Vorbild Betrieb ENT-211)
// Selektor auf #rdUebersicht eingeschraenkt, nicht die ganze view-rundgaenge:
// seit ENT-258 hat die Kontrollrunden-Seite (#rdAb-kr) ihr eigenes,
// verschachteltes Kachel-Raster mit teils gleichlautenden Beschriftungen
// (u. a. "Aufgaben") -- ein ungescopter Selektor traf sonst beide Raster
// zusammen, dieselbe Fehlerklasse wie schon bei .bk-zurueck (ENT-246).
const kachelLabels = await page.$$eval('#rdUebersicht .bk-kachel-lbl', els => els.map(e => e.textContent.trim()));
// "Ereignisse" ist seit ENT-297 die fuenfte Kachel und steht bewusst VOR
// "Auswertungen": Sie fuehrt auf echte, gemeldete Vorfaelle, waehrend
// "Auswertungen" noch ohne Funktion ist.
check('KRITISCH: alle fünf Kacheln stehen da, in der vorgegebenen Reihenfolge',
  JSON.stringify(kachelLabels) === JSON.stringify(['Rundgänge', 'GPS', 'Aufgaben', 'Ereignisse', 'Auswertungen']));
await page.click('#view-rundgaenge .bk-kachel:has-text("GPS")');
await page.waitForTimeout(100);
check('KRITISCH: eine Kachel ist noch ohne Funktion, sagt das aber statt nichts zu tun',
  await page.evaluate(() => document.getElementById('toast').classList.contains('on')));

// ── Letzte Rundgänge: derselbe Endpunkt wie zuvor, jetzt ohne Zeitraum-/
// Objekt-Filter durch die Person -- ein fester Rueckblick.
const gerufen = calls.find(c => c.path.includes('rundgang_liste'));
check('KRITISCH: rundgang_liste.php wird mit einem Zeitraum aufgerufen', !!gerufen && !!gerufen.query.von && !!gerufen.query.bis);
check('Der Zeitraum reicht mehrere Tage zurueck, nicht nur auf heute (ENT-225)',
  gerufen && gerufen.query.von !== gerufen.query.bis);

// ── Kennzahlen-Kacheln (ENT-274): vier ECHTE, aus rundgang_liste.php
// berechnete Werte -- kein erfundenes "Alarm"-Konzept, ausdrueckliche
// Vorgabe Projektinhaber. Alle vier Testrundgaenge liegen auf HEUTE.
const kpiTexte = await page.$$eval('#rdKpiGrid .kpi', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
check('KRITISCH: vier Kennzahlen-Kacheln stehen da, in dieser Reihenfolge',
  kpiTexte.length === 4
  && kpiTexte[0].includes('Aktive Wächter') && kpiTexte[1].includes('Rundgänge heute')
  && kpiTexte[2].includes('Kontrollpunkte heute') && kpiTexte[3].includes('Abgebrochen'));
check('KRITISCH: "Rundgänge heute" zaehlt nur die vier Testrundgaenge von HEUTE, nicht mehr',
  kpiTexte[1].includes('4'));
// 2 + 2 + 1 + 2 = 7 von 14. Der Ersatzscan der zweiten Runde zaehlt mit,
// der nicht verfuegbare Punkt der ersten nicht (ENT-329).
check('KRITISCH: "Kontrollpunkte heute" ist die echte Quote ueber alle Rundgaenge von heute (7 von 14 = 50 %), keine Scheinzahl',
  kpiTexte[2].includes('50') && kpiTexte[2].includes('7 von 14 erledigt'));
check('KRITISCH: der Ersatzscan wird dabei ausgewiesen, nicht unter "bestätigt" versteckt',
  kpiTexte[2].includes('1 per Ersatzscan'));
check('KRITISCH: "Abgebrochen" zaehlt den einen Rundgang mit status=abgebrochen',
  kpiTexte[3].includes('1'));
check('KRITISCH: ohne Wächter-Status-Antwort zeigt "Aktive Wächter" einen Strich, keine erfundene Zahl',
  kpiTexte[0].includes('–'));

const liste = await page.textContent('#rdLetzteListe');
check('KRITISCH: Kunde, Bereich (Objekt) und Mitarbeiter je Rundgang erscheinen',
  liste.includes('Muster Liegenschaften AG') && liste.includes('Testliegenschaft Nord') && liste.includes('Muster, Erika'));
check('KRITISCH: der Name (Einsatztitel) erscheint, wenn vorhanden', liste.includes('Öffnungsrunde'));
check('Ein Rundgang ohne Einsatztitel zeigt einen Strich statt einer Luecke',
  (await page.$$eval('#rdLetzteListe tbody tr', rs =>
    rs.some(r => r.children[2].textContent.trim() === '–'))));
check('KRITISCH: die Startzeit erscheint', liste.includes('20:04') && liste.includes('21:02'));
// Die zweite Runde steht jetzt auf 2/4 statt 1/4: Ihr zweiter Punkt wurde
// per Ersatzscan erledigt (ENT-329). Dass es ein Ersatzscan war, steht
// daneben -- sonst behauptete die Zahl eine technische Bestaetigung.
check('KRITISCH: der Fortschritt steht als Zahlenverhaeltnis da, nicht nur ein Balken (ENT-145)',
  liste.includes('2/3') && liste.includes('2/4'));
check('KRITISCH: ein per Ersatzscan erledigter Punkt wird in der Liste ausgewiesen',
  /1\s*Ersatz/.test(liste));
check('KRITISCH: ein abgebrochener Rundgang ist als solcher gekennzeichnet', liste.includes('Abgebrochen'));

// ── Leerer Zeitraum: "nichts vorhanden" statt einer leeren Flaeche
calls = [];
await page.route('**/api/rundgang_liste.php**', route =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', rundgaenge: [] }) }));
await page.evaluate(() => revierdienstUebersichtOeffnen());
await page.waitForTimeout(200);
check('KRITISCH: keine Rundgaenge im Rueckblick sagt das explizit, nicht "leere Zone"',
  (await page.textContent('#rdLetzteListe')).toLowerCase().includes('nichts vorhanden'));

check('KRITISCH: kein Seiten-Scroll am Desktop',
  await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
await page.screenshot({ path: `${OUT}/rg-uebersicht-01-desktop.png` });

// ── Handy: dieselbe Ansicht zusätzlich am Handy prüfen (CLAUDE.md)
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(200);
check('KRITISCH: kein Seiten-Scroll bei 390px', await page.evaluate(() =>
  document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
await page.screenshot({ path: `${OUT}/rg-uebersicht-02-mobil.png` });
await page.setViewportSize({ width: 1440, height: 1000 });

// ══════════ OHNE JEDES RECHT: WEDER "KONTROLLE" NOCH "REVIERDIENST"
await setup(page, ['kunden']);
await anmelden();
check('KRITISCH: ohne plan erscheint die Gruppe "Kontrolle" gar nicht',
  !(await page.isVisible('#navg-kontrolle')));
check('KRITISCH: ohne rundgang_verwalten/-einsehen erscheint die Gruppe "Revierdienst" gar nicht (ENT-224)',
  !(await page.isVisible('#navg-revierdienst')));

// ══════════ NUR rundgang_einsehen (KEIN plan): "REVIERDIENST" ERSCHEINT,
// ABER NUR MIT DER KACHEL "ÜBERSICHT" -- "EINRICHTUNG" BLEIBT VERBORGEN,
// UND "KONTROLLE" BLEIBT OHNE "PLAN" WEITERHIN GANZ VERBORGEN (ENT-224: das
// war vorher anders, als Rundgaenge noch zu "Kontrolle" gehoerte, ENT-193).
await setup(page, ['kunden', 'rundgang_einsehen']);
await anmelden();
check('KRITISCH: ohne plan bleibt die Gruppe "Kontrolle" verborgen (seit ENT-224 kein Sonderfall mehr)',
  !(await page.isVisible('#navg-kontrolle')));
check('KRITISCH: mit nur rundgang_einsehen erscheint die Gruppe "Revierdienst" (ENT-193/ENT-224)',
  await page.isVisible('#navg-revierdienst'));
// Der Klick auf die Elterngruppe selbst darf nicht auf einer fuer diese
// Person unsichtbaren Kachel (Einrichtung) landen -- er oeffnet die Gruppe
// UND waehlt gleich die richtige Ziel-Kachel (revierdienstNavKlick()).
calls = [];
await page.click('#nav-revierdienst');
await page.waitForSelector('#rdLetzteListe table');
check('KRITISCH: ein Klick auf "Revierdienst" landet bei nur rundgang_einsehen auf Übersicht, nicht auf Einrichtung',
  await page.evaluate(() => document.getElementById('view-rundgaenge').classList.contains('on')));
check('Die Kachel "Übersicht" ist sichtbar', await page.isVisible('#nav-revierdienst-uebersicht'));
check('KRITISCH: "Einrichtung" bleibt ohne das Recht "rundgang_verwalten" verborgen',
  !(await page.isVisible('#nav-revierdienst-einrichtung')));

// ══════════ MIT plan, ABER OHNE rundgang_einsehen/-verwalten: WIE VORHER,
// KEINE REGRESSION AN "KONTROLLE"; "REVIERDIENST" BLEIBT VERBORGEN
await setup(page, ['plan', 'kunden']);
await anmelden();
check('Mit plan bleibt "Kontrolle" sichtbar (bestehendes Verhalten unveraendert)',
  await page.isVisible('#navg-kontrolle'));
await page.click('#nav-kontrolle');
await page.waitForTimeout(150);
check('"Pensen" bleibt wie bisher sichtbar', await page.isVisible('#nav-kontrolle-pensen'));
check('"Auslagenersatz" bleibt wie bisher sichtbar', await page.isVisible('#nav-kontrolle-auslagen'));
check('KRITISCH: ohne rundgang_verwalten/-einsehen bleibt "Revierdienst" verborgen',
  !(await page.isVisible('#navg-revierdienst')));

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
