// Kachel "Rundgänge" (ENT-246, vorher Schublade ENT-242): volle Unterseite
// mit allen aktiven Kontrollrunden objektübergreifend, plus Einstieg zum
// Anlegen. Von der Schublade auf eine Unterseite umgestellt, weil eine
// mehrspaltige Tabelle in einer 420 px schmalen Schublade nicht passte
// (Rueckmeldung Projektinhaber, Referenz-Screenshot einer vollen Seite).
//
// Bearbeiten/Anlegen öffnen seit ENT-257 eine eigene volle Unterseite
// (rdKrZeigen(), NICHT dieselbe Schublade wie die Einrichtung) -- hier wird
// nur geprüft, dass die Seite mit dem richtigen Objekt und den richtigen
// Werten öffnet, nicht das Speichern der Punktzuordnung selbst im Detail
// (das deckt bereits die Einrichtung ab, siehe test_kontrollrunden.mjs).
// Seit ENT-258 ist diese Seite selbst eine kleine Übersicht (Name +
// Beschreibung) mit einem Kachel-Raster zu sechs Unterbereichen darunter;
// nur „Routenpunkte" ist verdrahtet (entspricht der bisherigen
// Kontrollpunkte-Auswahl), die übrigen fünf zeigen einen bleibenden
// Hinweis.
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
    name: 'Öffnungsrunde', beschreibung: 'Erste Kontrolle nach Schichtbeginn', aktiv: 1, erstellt_am: '2026-01-01 00:00:00',
    punkte: [{ id: 1, bezeichnung: 'Eingang', reihenfolge: 1 }, { id: 2, bezeichnung: 'Keller', reihenfolge: 2 }] },
  { id: 11, objekt_id: 2, kunde_name: 'Beispiel Immobilien GmbH', objekt_name: 'Testliegenschaft Süd',
    name: 'Schliessrunde', beschreibung: null, aktiv: 1, erstellt_am: '2026-01-02 00:00:00', punkte: [] },
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

// ══════════ RUNDGANG ANLEGEN (ENT-270): KLEINER DIALOG STATT VORHERIGEM
// OBJEKT-WAEHLER IN DER WERKZEUGLEISTE -- NAME, KUNDE, OBJEKT IN EINEM SCHRITT
await page.click('#rdAb-liste button:has-text("Rundgang anlegen")');
await page.waitForSelector('#dlgRdNeu.on');
check('KRITISCH: Kunde ist eine geschlossene Auswahl, kein Freitextfeld (nur bestehende Kunden)',
  await page.evaluate(() => document.getElementById('rdNeuKunde').tagName === 'SELECT'));
check('Beide Testkunden stehen zur Wahl, alphabetisch geordnet',
  (await page.$$eval('#rdNeuKunde option', o => o.map(x => x.textContent)))
    .join('|') === 'Kunde wählen …|Beispiel Immobilien GmbH|Muster Liegenschaften AG');
check('Das Objekt-Feld ist verborgen, solange kein Kunde gewählt ist', !(await page.isVisible('#rdNeuObjektFeld')));

// ══════════ ANLEGEN OHNE AUSFUELLEN: HINWEIS STATT STILLEM NICHTSTUN
await page.click('#dlgRdNeu button:has-text("Weiter")');
await page.waitForTimeout(100);
check('KRITISCH: "Weiter" ohne Namen zeigt einen Hinweis statt nichts zu tun', await page.isVisible('#rdNeuErr'));
check('Der Dialog bleibt dabei offen', await page.isVisible('#dlgRdNeu.on'));

// ══════════ KUNDE MIT NUR EINEM OBJEKT: DAS OBJEKT-FELD ERSCHEINT TROTZDEM
// (ausdrückliche Vorgabe Projektinhaber -- kein automatisches Uebersehen)
await page.selectOption('#rdNeuKunde', '1');
await page.waitForTimeout(100);
check('KRITISCH: das Objekt-Feld erscheint auch bei nur einem Objekt, vorausgewählt statt versteckt',
  await page.isVisible('#rdNeuObjektFeld'));
check('Genau das eine Objekt des gewählten Kunden steht zur Wahl',
  (await page.$$eval('#rdNeuObjekt option', o => o.map(x => x.textContent))).join('|') === 'Testliegenschaft Nord');

// ══════════ ANLEGEN MIT NAME/KUNDE/OBJEKT: VOLLE UNTERSEITE STATT SCHUBLADE
// (ENT-257, Revision von ENT-248 -- der Projektinhaber wollte hier
// ausdrücklich keine Schublade, sondern eine vollwertige Seite), RICHTIGES
// OBJEKT, NAME AUS DEM DIALOG UEBERNOMMEN
calls = [];
await page.fill('#rdNeuName', 'Mittagsrunde');
await page.selectOption('#rdNeuObjekt', '1');
await page.click('#dlgRdNeu button:has-text("Weiter")');
await page.waitForFunction(() => document.getElementById('rdAb-kr').style.display !== 'none');
check('KRITISCH: der Dialog schliesst sich', !(await page.isVisible('#dlgRdNeu.on')));
check('KRITISCH: es öffnet sich KEINE Schublade, sondern die volle Unterseite', !(await page.isVisible('#drawer.on')));
check('Die Kontrollrunden-Liste ist ausgeblendet, solange die Bearbeiten-Seite offen ist', !(await page.isVisible('#rdAb-liste')));
check('Die Seite trägt den Anlege-Titel', (await page.textContent('#rdKrTitel')) === 'Neue Kontrollrunde');
// ENT-261: Der Titel steht in der Kopfzeile, nicht mehr im Seiteninhalt --
// Ansichtstitel und Beschreibungszeile weichen dafuer.
check('KRITISCH: der Titel steht in der Kopfzeile', await page.evaluate(() =>
  document.getElementById('rdKrTitel').closest('header.topbar') !== null));
check('KRITISCH: Ansichtstitel und Beschreibungszeile weichen dafür',
  !(await page.isVisible('#pgTitle')) && !(await page.isVisible('#pgCrumb')));
check('KRITISCH: der im Dialog eingetragene Name wird übernommen, nicht ein zweites Mal verlangt',
  await page.inputValue('#rdKrName') === 'Mittagsrunde');
check('KRITISCH: die Kontrollpunkte des GEWÄHLTEN Objekts (1) werden geladen, nicht irgendwelche',
  calls.some(c => c.includes('kontrollpunkt_liste')) && await page.evaluate(() => rdEinObjekt === 1));
// ENT-261: Der Projektinhaber hat den Zurück-Knopf dieser Seite per Skizze
// ausdrücklich entfernt -- es gibt hier keinen sichtbaren Weg zurück zur
// Liste mehr, darum wird der Wechsel hier direkt ausgelöst statt geklickt.
await page.evaluate(() => rdAbschnittZeigen('liste'));
await page.waitForTimeout(150);
check('Der Wechsel zurück zur Liste zeigt wieder die Liste, nicht die Kachel-Übersicht',
  await page.isVisible('#rdAb-liste') && !(await page.isVisible('#rdUebersicht')));
check('KRITISCH: dabei steht wieder der Ansichtstitel in der Kopfzeile, nicht der Rundenname',
  await page.isVisible('#pgTitle') && !(await page.isVisible('#rdKrTitel')));

// ══════════ KRITISCH: DIE GANZE ZEILE OEFFNET, NICHT NUR DER "BEARBEITEN"-KNOPF
// (ENT-256, Bug-Meldung des Projektinhabers nach dem Ausliefern von ENT-248:
// "bei mir öffnet sich noch nichts" -- Klick auf die Tabellenzeile ausserhalb
// des Knopfes tat bis dahin buchstaeblich nichts.)
await page.click('#rdAb-liste tr:has-text("Öffnungsrunde") td:has-text("Testliegenschaft Nord")');
await page.waitForFunction(() => document.getElementById('rdAb-kr').style.display !== 'none');
check('KRITISCH: Klick auf die Tabellenzeile ausserhalb des Knopfes öffnet die Bearbeiten-Seite',
  (await page.textContent('#rdKrTitel')) === 'Kontrollrunde ändern');
check('Die richtige Zeile wird geladen', (await page.inputValue('#rdKrName')) === 'Öffnungsrunde');

// ══════════ ENT-260: DIE KACHELN SIND REITER -- SIE BLEIBEN STEHEN
// (Revision der Anordnung aus ENT-258: vorher verschwand das Kachel-Raster,
// sobald man einen Bereich öffnete. Der Projektinhaber wollte ausdrücklich,
// dass die Kacheln "bestehen angezeigt bleiben bei Wechsel innerhalb der
// versch. Reiter".)
check('Beim Öffnen steht der Reiter "Allgemeines" mit Name/Beschreibung da', await page.isVisible('#rdKrAb-allgemeines'));
check('KRITISCH: die Reiterleiste ist sichtbar', await page.isVisible('#rdKrReiter'));
check('KRITISCH: die Beschreibung wird vorbefüllt', (await page.inputValue('#rdKrBeschreibung')) === 'Erste Kontrolle nach Schichtbeginn');
check('KRITISCH: der Routenpunkte-Reiter zeigt die richtige Anzahl (2)', (await page.textContent('#rdKrRoutenBadge')).trim() === '2');
check('KRITISCH: der Kontrollpunkte-Reiter zeigt die Anzahl aller Punkte des Objekts (2)',
  (await page.textContent('#rdKrKpBadge')).trim() === '2');
check('KRITISCH: der aktive Reiter ist als solcher markiert',
  await page.evaluate(() => document.querySelector('#rdKrReiter .rdkr-tab.aktiv')?.dataset.reiter === 'allgemeines'));

// „Routenpunkte" ist die einzige verdrahtete Kachel -- entspricht der
// bisherigen Kontrollpunkte-Auswahl aus ENT-248/251.
await page.click('#rdKrReiter .rdkr-tab:has-text("Routenpunkte")');
check('KRITISCH: der Routenpunkte-Reiter öffnet den eigenen Bereich, das Formular wird ausgeblendet',
  await page.isVisible('#rdKrAb-routenpunkte') && !(await page.isVisible('#rdKrAb-allgemeines')));
check('KRITISCH: die Reiterleiste bleibt dabei stehen', await page.isVisible('#rdKrReiter'));
check('KRITISCH: jetzt ist der Routenpunkte-Reiter markiert',
  await page.evaluate(() => document.querySelector('#rdKrReiter .rdkr-tab.aktiv')?.dataset.reiter === 'routenpunkte'));
const routenInhalt = await page.textContent('#rdKrAb-routenpunkte');
check('Die zugeordneten Punkte erscheinen dort (Eingang, Keller)', routenInhalt.includes('Eingang') && routenInhalt.includes('Keller'));
check('KRITISCH: auf der Seite steht gar kein Zurück-Knopf mehr (ENT-261, vorher zwei übereinander)',
  await page.evaluate(() => document.querySelectorAll('#rdAb-kr .bk-zurueck').length === 0));

// Eine der fünf noch unverdrahteten Kacheln stichprobenartig geprüft --
// bleibender Hinweis statt erfundenem Inhalt (gleiches Vorgehen wie
// ENT-225/ENT-243), Inhalt wird gemäss Projektinhaber einzeln besprochen.
await page.click('#rdKrReiter .rdkr-tab:has-text("Aufgaben")');
check('Ein noch unverdrahteter Reiter zeigt einen bleibenden Hinweis statt erfundenem Inhalt',
  (await page.textContent('#rdKrAb-aufgaben')).includes('Folgt in einem späteren Schritt.'));
check('KRITISCH: ein unverdrahteter Reiter trägt bewusst KEINEN Anzahl-Chip ("0" hiesse fälschlich „keine")',
  await page.evaluate(() => !document.querySelector('#rdKrReiter .rdkr-tab[data-reiter="aufgaben"] .chip')));
await page.click('#rdKrReiter .rdkr-tab:has-text("Allgemeines")');
check('Über den Reiter "Allgemeines" kommt man zum Formular zurück',
  await page.isVisible('#rdKrAb-allgemeines') && await page.isVisible('#rdAb-kr'));

// ══════════ BEARBEITEN: VOLLE SEITE MIT VORBEFUELLTEM NAMEN, ZWEITES OBJEKT
calls = [];
await page.evaluate(() => rdAbschnittZeigen('liste'));
await page.waitForTimeout(150);
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
check('Die Beschreibung ist leer, weil "Schliessrunde" keine hat', await page.inputValue('#rdKrBeschreibung') === '');
await page.fill('#rdKrBeschreibung', 'Schliesskontrolle nach Ladenschluss');
calls = [];
const [speicherAnfrage] = await Promise.all([
  page.waitForRequest(r => r.url().includes('rundgang_vorlage_save') && r.method() === 'POST'),
  page.click('#rdKrBtn'),
]);
check('KRITISCH: die Beschreibung wird beim Speichern mitgesendet',
  speicherAnfrage.postDataJSON().beschreibung === 'Schliesskontrolle nach Ladenschluss');
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

// ══════════ HANDY: die Kontrollrunde-Bearbeiten-Seite (ENT-257) ebenfalls --
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
