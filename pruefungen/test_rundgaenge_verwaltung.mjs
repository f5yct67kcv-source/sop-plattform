// Kachel "Rundgänge" (ENT-246, vorher Schublade ENT-242): volle Unterseite
// mit allen aktiven Kontrollrunden objektübergreifend, plus Einstieg zum
// Anlegen. Von der Schublade auf eine Unterseite umgestellt, weil eine
// mehrspaltige Tabelle in einer 420 px schmalen Schublade nicht passte
// (Rueckmeldung Projektinhaber, Referenz-Screenshot einer vollen Seite).
//
// Bearbeiten/Anlegen nutzen dieselbe Schublade (openKr(), ENT-248) wie die
// bestehende, objektgebundene Verwaltung unter Einrichtung -- hier wird nur
// geprüft, dass die Seite sie mit dem richtigen Objekt und den richtigen
// Werten öffnet, nicht das Speichern selbst (das deckt bereits die
// Einrichtung ab, siehe test_kontrollrunden.mjs).
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const SEITE = `file://${WURZEL}/dashboard.html`;
const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const OBJEKTE = { status: 'ok', objekte: [
  { id: 1, kunde_id: 1, kunde_name: 'Muster Liegenschaften AG', name: 'Testliegenschaft Nord',
    strasse: 'Testweg 1', ort: '9999 Beispielhausen', kanton: 'SO', einsatzart: 'Revierdienst',
    aktiv: 1, bemerkung: null, masterschichten: 0, stunden_je_einsatz: 0 },
  { id: 2, kunde_id: 2, kunde_name: 'Beispiel Immobilien GmbH', name: 'Testliegenschaft Süd',
    strasse: 'Musterstrasse 2', ort: '9998 Beispielhausen', kanton: 'SO', einsatzart: 'Revierdienst',
    aktiv: 1, bemerkung: null, masterschichten: 0, stunden_je_einsatz: 0 },
]};

// Zwei Vorlagen an ZWEI verschiedenen Objekten -- beweist, dass die Seite
// wirklich objektuebergreifend aggregiert, nicht nur das zuletzt gewaehlte
// Objekt aus der Einrichtung zeigt.
const VORLAGEN_ALLE = { status: 'ok', vorlagen: [
  { id: 10, objekt_id: 1, kunde_name: 'Muster Liegenschaften AG', objekt_name: 'Testliegenschaft Nord',
    name: 'Öffnungsrunde', aktiv: 1, erstellt_am: '2026-01-01 00:00:00',
    punkte: [{ id: 1, bezeichnung: 'Eingang', reihenfolge: 1 }, { id: 2, bezeichnung: 'Keller', reihenfolge: 2 }] },
  { id: 11, objekt_id: 2, kunde_name: 'Beispiel Immobilien GmbH', objekt_name: 'Testliegenschaft Süd',
    name: 'Schliessrunde', aktiv: 1, erstellt_am: '2026-01-02 00:00:00', punkte: [] },
]};

const KONTROLLPUNKTE_OBJ1 = { status: 'ok', kontrollpunkte: [
  { id: 1, objekt_id: 1, bezeichnung: 'Eingang', typ: 'nfc', chip_id: 'A1', reihenfolge: 1, aktiv: 1 },
  { id: 2, objekt_id: 1, bezeichnung: 'Keller', typ: 'nfc', chip_id: 'A2', reihenfolge: 2, aktiv: 1 },
]};

let calls = [];

function setup(page) {
  return page.route('**/api/**', async route => {
    const req = route.request();
    const u = new URL(req.url());
    const path = u.pathname.split('/api/')[1];
    calls.push(path);
    const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (path.includes('login')) return send({ status: 'ok', token: 't', name: 'adrian', ist_admin: true });
    if (path.includes('dashboard_stats')) return send({ status: 'ok', kpi: {}, verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [] });
    if (path.includes('objekte_revierdienst')) return send(OBJEKTE);
    if (path.includes('rundgang_vorlage_liste_alle')) return send(VORLAGEN_ALLE);
    if (path.includes('rundgang_liste')) return send({ status: 'ok', rundgaenge: [] });
    if (path.includes('revierdienst_status')) return send({ status: 'ok', leute: [] });
    if (path.includes('kontrollpunkt_liste')) return send(KONTROLLPUNKTE_OBJ1);
    // Respektiert objekt_id -- sonst faende "Bearbeiten" fuer Objekt 2 dessen
    // eigene Vorlage nie (openKr() sucht in genau dieser Liste per id).
    if (path.includes('rundgang_vorlage_liste')) {
      const objektId = Number(u.searchParams.get('objekt_id'));
      return send({ status: 'ok', vorlagen: VORLAGEN_ALLE.vorlagen.filter(v => v.objekt_id === objektId) });
    }
    return send({ status: 'ok' });
  });
}

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));

await setup(page);
await page.goto(SEITE);
await page.evaluate(() => localStorage.clear());
await page.goto(SEITE);
await page.fill('#gName', 'adrian'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#kpiGrid .kpi-val');

await page.evaluate(() => go('rundgaenge'));
await page.waitForSelector('#view-rundgaenge.on');
await page.waitForTimeout(150);

// ══════════ KLICK AUF DIE KACHEL OEFFNET DIE UNTERSEITE, KEINE SCHUBLADE
calls = [];
await page.click('#view-rundgaenge .bk-kachel:has-text("Rundgänge")');
await page.waitForSelector('#rdAb-liste table');
check('KRITISCH: die Kachel "Rundgänge" ruft rundgang_vorlage_liste_alle.php statt eines Platzhalter-Toasts',
  calls.some(c => c.includes('rundgang_vorlage_liste_alle')));
check('KRITISCH: es öffnet sich KEINE Schublade (ENT-246 hat sie ersetzt)', !(await page.isVisible('#drawer.on')));
check('Die Kachel-Übersicht ist ausgeblendet, solange die Unterseite offen ist', !(await page.isVisible('#rdUebersicht')));
check('Ein "Zurück"-Knopf führt zur Übersicht zurück', await page.isVisible('#rdAb-liste .bk-zurueck'));

// ══════════ BEIDE OBJEKTE STEHEN OBJEKTUEBERGREIFEND DA
const inhalt = await page.textContent('#rdAb-liste');
check('KRITISCH: eine Kontrollrunde vom ersten Objekt erscheint', inhalt.includes('Öffnungsrunde') && inhalt.includes('Testliegenschaft Nord'));
check('KRITISCH: eine Kontrollrunde vom ZWEITEN Objekt erscheint (objektübergreifend, nicht nur das zuletzt gewählte)',
  inhalt.includes('Schliessrunde') && inhalt.includes('Testliegenschaft Süd'));
check('Die Anzahl Kontrollpunkte steht dabei', inhalt.includes('2 Kontrollpunkte'));
check('Eine Runde ohne Kontrollpunkt sagt das explizit', inhalt.includes('Noch keiner zugeordnet'));

// ══════════ ANLEGEN OHNE OBJEKT: HINWEIS STATT STILLEM NICHTSTUN
await page.click('#rdAb-liste button:has-text("Rundgang anlegen")');
await page.waitForTimeout(150);
check('KRITISCH: "Rundgang anlegen" ohne gewähltes Objekt zeigt einen Hinweis statt nichts zu tun',
  await page.evaluate(() => document.getElementById('toast').classList.contains('on')
    && document.getElementById('toast').textContent.includes('Objekt')));
check('Die Unterseite bleibt dabei offen', await page.isVisible('#rdAb-liste'));

// ══════════ ANLEGEN MIT OBJEKT: VOLLE UNTERSEITE STATT SCHUBLADE (ENT-251,
// Revision von ENT-248 -- der Projektinhaber wollte hier ausdrücklich
// keine Schublade, sondern eine vollwertige Seite), RICHTIGES OBJEKT
calls = [];
await page.selectOption('#rdNeuObjekt', '1');
await page.click('#rdAb-liste button:has-text("Rundgang anlegen")');
await page.waitForFunction(() => document.getElementById('rdAb-kr').style.display !== 'none');
check('KRITISCH: es öffnet sich KEINE Schublade, sondern die volle Unterseite', !(await page.isVisible('#drawer.on')));
check('Die Kontrollrunden-Liste ist ausgeblendet, solange die Bearbeiten-Seite offen ist', !(await page.isVisible('#rdAb-liste')));
check('Die Seite trägt den Anlege-Titel', (await page.textContent('#rdKrTitel')) === 'Neue Kontrollrunde');
check('Das Namensfeld ist leer', await page.inputValue('#rdKrName') === '');
check('KRITISCH: die Kontrollpunkte des GEWÄHLTEN Objekts (1) werden geladen, nicht irgendwelche',
  calls.some(c => c.includes('kontrollpunkt_liste')) && await page.evaluate(() => rdEinObjekt === 1));
await page.click('#rdAb-kr .bk-zurueck');
await page.waitForTimeout(150);
check('KRITISCH: "Zurück" von der Bearbeiten-Seite führt zur Liste zurück (nicht bis zur Kachel-Übersicht)',
  await page.isVisible('#rdAb-liste') && !(await page.isVisible('#rdUebersicht')));

// ══════════ KRITISCH: DIE GANZE ZEILE OEFFNET, NICHT NUR DER "BEARBEITEN"-KNOPF
// (ENT-250, Bug-Meldung des Projektinhabers nach dem Ausliefern von ENT-248:
// "bei mir öffnet sich noch nichts" -- Klick auf die Tabellenzeile ausserhalb
// des Knopfes tat bis dahin buchstaeblich nichts.)
await page.click('#rdAb-liste tr:has-text("Öffnungsrunde") td:has-text("Testliegenschaft Nord")');
await page.waitForFunction(() => document.getElementById('rdAb-kr').style.display !== 'none');
check('KRITISCH: Klick auf die Tabellenzeile ausserhalb des Knopfes öffnet die Bearbeiten-Seite',
  (await page.textContent('#rdKrTitel')) === 'Kontrollrunde ändern');
check('Die richtige Zeile wird geladen', (await page.inputValue('#rdKrName')) === 'Öffnungsrunde');

// ══════════ BEARBEITEN: VOLLE SEITE MIT VORBEFUELLTEM NAMEN, ZWEITES OBJEKT
calls = [];
await page.click('#rdAb-kr .bk-zurueck');
await page.click('#rdAb-liste tr:has-text("Schliessrunde") button:has-text("Bearbeiten")');
await page.waitForFunction(() => document.getElementById('rdAb-kr').style.display !== 'none');
check('Die Seite trägt den Änderungs-Titel', (await page.textContent('#rdKrTitel')) === 'Kontrollrunde ändern');
check('KRITISCH: der Name ist vorbefüllt', await page.inputValue('#rdKrName') === 'Schliessrunde');
check('KRITISCH: rdEinObjekt zeigt auf das Objekt DIESER Zeile (2), nicht das vorherige (1)',
  await page.evaluate(() => rdEinObjekt === 2));

check('KRITISCH: kein Seiten-Scroll am Desktop',
  await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
await page.screenshot({ path: `${OUT}/rg-verwaltung-01-desktop.png` });

// ══════════ SPEICHERN FUEHRT ZURUECK ZUR LISTE, NICHT ZUR KACHEL-UEBERSICHT
calls = [];
await page.click('#rdKrBtn');
await page.waitForFunction(() => document.getElementById('rdAb-liste').style.display !== 'none');
check('KRITISCH: nach dem Speichern steht wieder die Liste da, nicht die Kachel-Übersicht',
  await page.isVisible('#rdAb-liste') && !(await page.isVisible('#rdUebersicht')));
check('Die Kontrollrunde wird gespeichert', calls.some(c => c.includes('rundgang_vorlage_save')));

// ══════════ "ZURUECK" VON DER LISTE FUEHRT WIEDER ZUR KACHEL-UEBERSICHT
await page.click('#rdAb-liste .bk-zurueck');
await page.waitForTimeout(150);
check('KRITISCH: "Zurück" zeigt wieder die Kachel-Übersicht', await page.isVisible('#rdUebersicht'));
check('Die Unterseite ist wieder ausgeblendet', !(await page.isVisible('#rdAb-liste')));

// ══════════ LEERER ZUSTAND: "NICHTS VORHANDEN" STATT LEERER FLAECHE
await page.route('**/api/rundgang_vorlage_liste_alle.php**', route =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', vorlagen: [] }) }));
await page.click('#view-rundgaenge .bk-kachel:has-text("Rundgänge")');
await page.waitForTimeout(200);
check('KRITISCH: keine aktive Kontrollrunde sagt das explizit, nicht "leere Zone"',
  (await page.textContent('#rdAb-liste')).includes('Keine aktive Kontrollrunde vorhanden'));

// ══════════ HANDY: dieselbe Unterseite zusätzlich am Handy prüfen (CLAUDE.md)
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(200);
check('KRITISCH: kein Seiten-Scroll bei 390px', await page.evaluate(() =>
  document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
await page.screenshot({ path: `${OUT}/rg-verwaltung-02-mobil.png` });

// ══════════ HANDY: die Kontrollrunde-Bearbeiten-Seite (ENT-251) ebenfalls --
// eigene Seite statt Schublade heisst neue Massverhaeltnisse, die am
// gerenderten Zustand geprueft werden muessen (CLAUDE.md "gemessen, nicht
// angenommen"), nicht nur die Liste oben. Der Leerzustand-Mock von oben
// wird zuerst entfernt, sonst faende "Öffnungsrunde" hier keine Zeile mehr;
// dafuer zurueck zur Kachel-Uebersicht und erneut hinein, damit die Liste
// mit den echten Testdaten neu laedt.
await page.unroute('**/api/rundgang_vorlage_liste_alle.php**');
await page.click('#rdAb-liste .bk-zurueck');
await page.waitForTimeout(150);
await page.click('#view-rundgaenge .bk-kachel:has-text("Rundgänge")');
await page.waitForSelector('#rdAb-liste table');
await page.click('#rdAb-liste tr:has-text("Öffnungsrunde") button:has-text("Bearbeiten")');
await page.waitForFunction(() => document.getElementById('rdAb-kr').style.display !== 'none');
check('KRITISCH: kein Seiten-Scroll auf der Bearbeiten-Seite bei 390px', await page.evaluate(() =>
  document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
const rdKrBtnBox = await page.$eval('#rdKrBtn', el => el.getBoundingClientRect());
check('KRITISCH: "Speichern" erreicht die 44px-Mindesttrefferflaeche auf dem Handy',
  rdKrBtnBox.height >= 43.9);
check('"Speichern" wird NICHT ueber die volle Breite gestreckt, nur weil es allein in seiner Zeile steht (CLAUDE.md Gestaltung)',
  rdKrBtnBox.width < 390 - 40);
const feldSchriftRd = await page.$eval('#rdKrName', el => parseFloat(getComputedStyle(el).fontSize));
check('KRITISCH: Namensfeld hat mindestens 16px Schrift (kein iOS-Auto-Zoom)', feldSchriftRd >= 16);
await page.screenshot({ path: `${OUT}/rg-verwaltung-03-kr-seite-mobil.png` });
await page.setViewportSize({ width: 1440, height: 1000 });

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
