// Kachel "Rundgänge" (ENT-242): Schublade mit allen aktiven Kontrollrunden
// objektübergreifend, plus Einstieg zum Anlegen. Bisher zeigte die Kachel nur
// "Folgt in einem späteren Schritt." -- diese Suite prüft die erste
// verdrahtete Funktion der vier Kacheln aus ENT-225.
//
// Bearbeiten/Anlegen nutzen denselben Dialog (dlgKr) wie die bestehende,
// objektgebundene Verwaltung unter Einrichtung -- hier wird nur geprüft, dass
// die Schublade ihn mit dem richtigen Objekt und den richtigen Werten öffnet,
// nicht das Speichern selbst (das deckt bereits die Einrichtung ab).
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

// Zwei Vorlagen an ZWEI verschiedenen Objekten -- beweist, dass die Schublade
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

// ══════════ KLICK AUF DIE KACHEL OEFFNET DIE SCHUBLADE
calls = [];
await page.click('#view-rundgaenge .bk-kachel:has-text("Rundgänge")');
await page.waitForSelector('#drawer.on');
check('KRITISCH: die Kachel "Rundgänge" ruft rundgang_vorlage_liste_alle.php statt eines Platzhalter-Toasts',
  calls.some(c => c.includes('rundgang_vorlage_liste_alle')));
check('Der Schubladentitel lautet "Rundgänge"', await page.textContent('#drTitle') === 'Rundgänge');

// ══════════ BEIDE OBJEKTE STEHEN OBJEKTUEBERGREIFEND DA
const inhalt = await page.textContent('#drBody');
check('KRITISCH: eine Kontrollrunde vom ersten Objekt erscheint', inhalt.includes('Öffnungsrunde') && inhalt.includes('Testliegenschaft Nord'));
check('KRITISCH: eine Kontrollrunde vom ZWEITEN Objekt erscheint (objektübergreifend, nicht nur das zuletzt gewählte)',
  inhalt.includes('Schliessrunde') && inhalt.includes('Testliegenschaft Süd'));
check('Die Anzahl Kontrollpunkte steht dabei', inhalt.includes('2 Kontrollpunkte'));
check('Eine Runde ohne Kontrollpunkt sagt das explizit', inhalt.includes('Noch kein Kontrollpunkt zugeordnet'));

// ══════════ ANLEGEN OHNE OBJEKT: HINWEIS STATT STILLEM NICHTSTUN
await page.click('#drBody button:has-text("Rundgang anlegen")');
await page.waitForTimeout(150);
check('KRITISCH: "Rundgang anlegen" ohne gewähltes Objekt zeigt einen Hinweis statt nichts zu tun',
  await page.evaluate(() => document.getElementById('toast').classList.contains('on')
    && document.getElementById('toast').textContent.includes('Objekt')));
check('Die Schublade bleibt dabei offen', await page.isVisible('#drawer.on'));

// ══════════ ANLEGEN MIT OBJEKT: SCHUBLADE ZU, DIALOG AUF, RICHTIGES OBJEKT
calls = [];
await page.selectOption('#rdNeuObjekt', '1');
await page.click('#drBody button:has-text("Rundgang anlegen")');
await page.waitForSelector('#dlgKr.on');
check('KRITISCH: die Schublade schliesst sich beim Öffnen des Anlege-Dialogs', !(await page.isVisible('#drawer.on')));
check('Der Dialog trägt den Anlege-Titel', (await page.textContent('#krTitel')).includes('Neue Kontrollrunde'));
check('Das Namensfeld ist leer', await page.inputValue('#krName') === '');
check('KRITISCH: die Kontrollpunkte des GEWÄHLTEN Objekts (1) werden geladen, nicht irgendwelche',
  calls.some(c => c.includes('kontrollpunkt_liste')) && await page.evaluate(() => rdEinObjekt === 1));
await page.click('#dlgKr .btn-quiet, #dlgKr button:has-text("Abbrechen")').catch(() => {});
await page.evaluate(() => closeDlg('dlgKr'));

// ══════════ BEARBEITEN: SCHUBLADE ZU, DIALOG MIT VORBEFUELLTEM NAMEN, ZWEITES OBJEKT
await page.evaluate(() => rundgaengeVerwaltungOeffnen());
await page.waitForSelector('#drawer.on');
calls = [];
await page.click('#drBody .kr-zeile:has-text("Schliessrunde") button:has-text("Bearbeiten")');
await page.waitForSelector('#dlgKr.on');
check('KRITISCH: "Bearbeiten" schliesst die Schublade', !(await page.isVisible('#drawer.on')));
check('Der Dialog trägt den Änderungs-Titel', (await page.textContent('#krTitel')).includes('Kontrollrunde ändern'));
check('KRITISCH: der Name ist vorbefüllt', await page.inputValue('#krName') === 'Schliessrunde');
check('KRITISCH: rdEinObjekt zeigt auf das Objekt DIESER Zeile (2), nicht das vorherige (1)',
  await page.evaluate(() => rdEinObjekt === 2));

check('KRITISCH: kein Seiten-Scroll am Desktop',
  await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
await page.screenshot({ path: `${OUT}/rg-verwaltung-01-desktop.png` });

// ══════════ LEERER ZUSTAND: "NICHTS VORHANDEN" STATT LEERER FLAECHE
await page.evaluate(() => closeDlg('dlgKr'));
await page.route('**/api/rundgang_vorlage_liste_alle.php**', route =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', vorlagen: [] }) }));
await page.evaluate(() => rundgaengeVerwaltungOeffnen());
await page.waitForTimeout(200);
check('KRITISCH: keine aktive Kontrollrunde sagt das explizit, nicht "leere Zone"',
  (await page.textContent('#drBody')).includes('Keine aktive Kontrollrunde vorhanden'));

// ══════════ HANDY: dieselbe Schublade zusätzlich am Handy prüfen (CLAUDE.md)
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(200);
check('KRITISCH: kein Seiten-Scroll bei 390px', await page.evaluate(() =>
  document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
await page.screenshot({ path: `${OUT}/rg-verwaltung-02-mobil.png` });

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
