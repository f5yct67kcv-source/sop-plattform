// Rundgang-Übersicht für die Einsatzleitung im Dashboard (ENT-183/ENT-193).
//
// Reine Anzeige über den seit ENT-180/183 bestehenden Endpunkt
// rundgang_liste.php (Recht rundgang_einsehen) -- die Fachlogik
// (rundgang_fortschritt) läuft bereits echt gegen SQLite in
// pruef_rundgang.php, hier nur, dass die Oberfläche Zeitraum/Objekt-Filter
// richtig bedient und das Recht tatsächlich entscheidet, ob "Kontrolle"
// bzw. die Kachel "Rundgänge" überhaupt erscheint.
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
    objekt_name: 'Testliegenschaft Nord', vorname: 'Erika', nachname: 'Muster',
    fortschritt: { gesamt: 3, bestaetigt: 2, nicht_verfuegbar: 1 } },
  { id: 2, einsatz_id: 11, objekt_id: 2, mitarbeiter_id: 6, status: 'laeuft',
    vorbereitet_am: `${HEUTE} 21:00:00`, rohzeit_start: `${HEUTE} 21:02:00`,
    rohzeit_ende: null, datum: HEUTE, kunde_name: 'Beispiel Immobilien GmbH',
    objekt_name: 'Testliegenschaft Süd', vorname: 'Hans', nachname: 'Beispiel',
    fortschritt: { gesamt: 4, bestaetigt: 1, nicht_verfuegbar: 0 }, pause_minuten: 0 },
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
// Die Kinder der Gruppe "Kontrolle" sind per CSS erst sichtbar, sobald die
// Gruppe aufgeklappt ist (.nav-gruppe.offen .nav-kinder) -- die Sichtbarkeit
// einer Kachel lässt sich darum erst NACH dem Öffnen sinnvoll prüfen, nicht
// direkt nach der Anmeldung (gleiches Muster wie zurObjekt() in
// test_kontrollpunkte.mjs, das ebenfalls erst öffnet und dann prüft).
await setup(page, null);
await anmelden();
calls = [];
await page.click('#nav-kontrolle');
await page.waitForTimeout(150);
check('Die Kachel "Rundgänge" ist unter Kontrolle sichtbar', await page.isVisible('#nav-kontrolle-rundgaenge'));
await page.click('#nav-kontrolle-rundgaenge');
await page.waitForSelector('#rgListe .pn-zeile');
await page.waitForTimeout(150);

const gerufen = calls.find(c => c.path.includes('rundgang_liste'));
check('KRITISCH: rundgang_liste.php wird mit einem Zeitraum aufgerufen', !!gerufen && !!gerufen.query.von && !!gerufen.query.bis);
check('Der Zeitraum steht standardmässig auf heute (von = bis)',
  gerufen && gerufen.query.von === gerufen.query.bis);

const kopf = await page.textContent('#rgKopf');
check('Der Kopf nennt die Anzahl Rundgänge', kopf.includes('4 Rundgänge'));

const liste = await page.textContent('#rgListe');
check('KRITISCH: Objekt, Kunde und Person je Rundgang erscheinen',
  liste.includes('Testliegenschaft Nord') && liste.includes('Muster Liegenschaften AG') && liste.includes('Erika Muster'));
check('KRITISCH: der Status wird angezeigt', liste.includes('Abgeschlossen') && liste.includes('Läuft'));
check('KRITISCH: Fortschritt trennt bestätigt und nicht verfügbar, nicht nur eine Summe (ENT-145)',
  liste.includes('2 bestätigt, 1 nicht verfügbar von 3') && liste.includes('1 bestätigt, 0 nicht verfügbar von 4'));
check('KRITISCH: Rohzeit-Start und -Ende werden angezeigt', liste.includes('20:04–20:41'));
check('KRITISCH: ein noch laufender Rundgang zeigt "läuft noch" statt eines leeren Endes',
  liste.includes('21:02') && liste.includes('läuft noch'));

// ── Pausiert/Abgebrochen (ENT-146)
check('KRITISCH: der Status "Pausiert" wird angezeigt', liste.includes('Pausiert'));
check('KRITISCH: pausierte Minuten werden angezeigt', liste.includes('12 Min. pausiert'));
check('KRITISCH: der Status "Abgebrochen" wird angezeigt', liste.includes('Abgebrochen'));
check('KRITISCH: der Abbruchgrund erscheint ausgeschrieben, nicht als Code',
  liste.includes('Durch Notfall anderweitig gebunden') && !liste.includes('notfall_gebunden'));
check('KRITISCH: der Freitext des Abbruchs erscheint', liste.includes('Kollege krank, musste einspringen'));
check('KRITISCH: ein abgebrochener Rundgang ohne Ende zeigt NICHT "läuft noch" (waere irrefuehrend)',
  !liste.includes('23:03 – läuft noch') && !liste.includes('23:03– läuft noch'));

// ── Objekt-Filter
await page.selectOption('#rgObjekt', '2');
await page.waitForTimeout(150);
const gefiltert = await page.textContent('#rgListe');
check('KRITISCH: der Objekt-Filter blendet das andere Objekt aus',
  gefiltert.includes('Testliegenschaft Süd') && !gefiltert.includes('Testliegenschaft Nord'));
check('Ein Filter, der alles ausblendet, meldet nichts an einen Netzfehler',
  !(await page.textContent('#rgKopf')).includes('undefined'));
await page.selectOption('#rgObjekt', '');

// ── Leerer Zeitraum: "kein Treffer" statt "nichts vorhanden"
calls = [];
await page.route('**/api/rundgang_liste.php**', route =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', rundgaenge: [] }) }));
await page.fill('#rgVon', '2020-01-01');
await page.fill('#rgBis', '2020-01-02');
await page.waitForTimeout(200);
check('KRITISCH: ein leerer Zeitraum sagt "kein Rundgang", nicht "keine Zone"/leer',
  (await page.textContent('#rgListe')).includes('liegt kein Rundgang vor'));

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

// ══════════ OHNE JEDES RECHT: WEDER "KONTROLLE" NOCH DIE KACHEL
await setup(page, ['kunden']);
await anmelden();
check('KRITISCH: ohne plan/rundgang_einsehen erscheint die Gruppe "Kontrolle" gar nicht',
  !(await page.isVisible('#navg-kontrolle')));

// ══════════ NUR rundgang_einsehen (KEIN plan): "KONTROLLE" ERSCHEINT,
// ABER NUR MIT DER KACHEL "RUNDGÄNGE" -- PENSEN/AUSLAGENERSATZ BLEIBEN VERBORGEN
await setup(page, ['kunden', 'rundgang_einsehen']);
await anmelden();
check('KRITISCH: mit nur rundgang_einsehen erscheint die Gruppe "Kontrolle" trotzdem (ENT-193)',
  await page.isVisible('#navg-kontrolle'));
// Der Klick auf die Elterngruppe selbst darf nicht auf einer fuer diese
// Person unsichtbaren Kachel (Pensen) landen -- er oeffnet die Gruppe UND
// waehlt gleich die richtige Ziel-Kachel (kontrolleNavKlick()).
calls = [];
await page.click('#nav-kontrolle');
await page.waitForSelector('#rgListe .pn-zeile');
check('KRITISCH: ein Klick auf "Kontrolle" landet bei nur rundgang_einsehen auf Rundgänge, nicht auf Pensen',
  await page.evaluate(() => document.getElementById('view-rundgaenge').classList.contains('on')));
check('Die Kachel "Rundgänge" ist sichtbar', await page.isVisible('#nav-kontrolle-rundgaenge'));
check('KRITISCH: "Pensen" bleibt ohne das Recht "plan" verborgen',
  !(await page.isVisible('#nav-kontrolle-pensen')));
check('KRITISCH: "Auslagenersatz" bleibt ohne das Recht "plan" verborgen',
  !(await page.isVisible('#nav-kontrolle-auslagen')));

// ══════════ OHNE rundgang_einsehen, ABER MIT plan: WIE VORHER, KEINE REGRESSION
await setup(page, ['plan', 'kunden']);
await anmelden();
check('Mit plan bleibt "Kontrolle" sichtbar (bestehendes Verhalten unveraendert)',
  await page.isVisible('#navg-kontrolle'));
await page.click('#nav-kontrolle');
await page.waitForTimeout(150);
check('KRITISCH: ohne rundgang_einsehen bleibt "Rundgänge" verborgen',
  !(await page.isVisible('#nav-kontrolle-rundgaenge')));
check('"Pensen" bleibt wie bisher sichtbar', await page.isVisible('#nav-kontrolle-pensen'));

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
