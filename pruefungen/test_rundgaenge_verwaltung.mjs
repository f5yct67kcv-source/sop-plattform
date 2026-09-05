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
// Seit ENT-258/260 ist diese Seite ein Formular "Allgemeines" mit einer
// bleibenden Reiterleiste zu weiteren Unterbereichen; ein Teil davon ist
// inzwischen verdrahtet (siehe die einzelnen ENT-Verweise unten), der Rest
// zeigt weiterhin einen bleibenden Hinweis.
// Seit ENT-277 ist „Ansprechpartner" keiner dieser Reiter mehr, sondern ein
// Paar Felder direkt im Formular "Allgemeines" (Rücksprache Projektinhaber:
// pro Kontrollrunde gibt es immer nur EINEN Ansprechpartner -- Person oder
// Pikett-Nummer, nie beides -- das rechtfertigt keinen eigenen Reiter).
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { GOOGLE_MAPS_MOCK } from './google_maps_mock.mjs';
import { zeitSetzen } from './zeitfeld.mjs';
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
    name: 'Öffnungsrunde', beschreibung: 'Erste Kontrolle nach Schichtbeginn',
    ansprechpartner_name: 'Pikett Sicherheit', ansprechpartner_telefon: '+41 79 111 22 33',
    fenster_von: '21:00:00', fenster_bis: '23:00:00',
    aktiv: 1, erstellt_am: '2026-01-01 00:00:00',
    punkte: [{ id: 1, bezeichnung: 'Eingang', reihenfolge: 1 }, { id: 2, bezeichnung: 'Keller', reihenfolge: 2 }] },
  { id: 11, objekt_id: 2, kunde_name: 'Beispiel Immobilien GmbH', objekt_name: 'Testliegenschaft Süd',
    name: 'Schliessrunde', beschreibung: null, ansprechpartner_name: null, ansprechpartner_telefon: null,
    fenster_von: null, fenster_bis: null,
    aktiv: 1, erstellt_am: '2026-01-02 00:00:00', punkte: [] },
]};

// Drittes Objekt-1-Kontrollpunkt (Garage) bewusst NICHT in VORLAGEN_ALLE[10]
// (Öffnungsrunde) enthalten -- steht fuer den Routenpunkte-Reiter als noch
// nicht zugeordneter, hinzufuegbarer Punkt bereit (ENT-273).
const KONTROLLPUNKTE_OBJ1 = { status: 'ok', kontrollpunkte: [
  { id: 1, objekt_id: 1, bezeichnung: 'Eingang', typ: 'nfc', chip_id: 'A1', reihenfolge: 1, aktiv: 1, beschreibung: 'Haupteingang Nord' },
  { id: 2, objekt_id: 1, bezeichnung: 'Keller', typ: 'nfc', chip_id: 'A2', reihenfolge: 2, aktiv: 1, beschreibung: null },
  { id: 3, objekt_id: 1, bezeichnung: 'Garage', typ: 'geofence', lat: 47.37, lng: 8.54, geofence_radius_m: 15, reihenfolge: 3, aktiv: 1, beschreibung: null },
]};

let calls = [];

function setup(page) {
  const p = page.route('**/api/**', async route => {
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
    // Ebenfalls zustandsbehaftet (ENT-273): eine neu angelegte Kontrollrunde
    // braucht eine ECHTE id, die loadRundgangVorlagen() danach auch findet --
    // rdSaveKr() wechselt nach dem ersten Speichern direkt in den
    // Bearbeiten-Modus derselben Runde (rdKrZeigen('aendern', data.id)),
    // statt wie bisher immer zur Liste zu springen.
    if (path.includes('rundgang_vorlage_save')) {
      const body = JSON.parse(req.postData() || '{}');
      if (body.id) {
        const v = VORLAGEN_ALLE.vorlagen.find(x => x.id === Number(body.id));
        if (v) {
          v.name = body.name; v.aktiv = body.aktiv; v.beschreibung = body.beschreibung;
          v.fenster_von = body.fenster_von || null; v.fenster_bis = body.fenster_bis || null;
        }
        return send({ status: 'ok', id: Number(body.id) });
      }
      const neueId = Math.max(0, ...VORLAGEN_ALLE.vorlagen.map(v => v.id)) + 1;
      VORLAGEN_ALLE.vorlagen.push({
        id: neueId, objekt_id: body.objekt_id, name: body.name, beschreibung: body.beschreibung,
        aktiv: body.aktiv, erstellt_am: '2026-01-03 00:00:00', punkte: [],
      });
      return send({ status: 'ok', id: neueId });
    }
    // Zustandsbehaftet (ENT-273): schreibt tatsaechlich in VORLAGEN_ALLE
    // zurueck, statt nur "ok" zu antworten -- die Routenpunkte-Tabelle laedt
    // nach jeder Aenderung per loadRundgangVorlagen() neu (sofort
    // speichernd, kein Sammel-"Speichern" mehr), das muss hier also
    // tatsaechlich wirken, sonst pruefte der Test nur sich selbst.
    if (path.includes('rundgang_vorlage_punkte_setzen')) {
      const body = JSON.parse(req.postData() || '{}');
      const v = VORLAGEN_ALLE.vorlagen.find(x => x.id === Number(body.vorlage_id));
      if (v) {
        v.punkte = (body.kontrollpunkt_ids || []).map((id, i) => {
          const k = KONTROLLPUNKTE_OBJ1.kontrollpunkte.find(x => x.id === Number(id));
          return { id: Number(id), bezeichnung: k ? k.bezeichnung : '?', reihenfolge: i };
        });
      }
      return send({ status: 'ok' });
    }
    // Respektiert objekt_id -- sonst faende "Bearbeiten" fuer Objekt 2 dessen
    // eigene Vorlage nie (openKr() sucht in genau dieser Liste per id).
    if (path.includes('rundgang_vorlage_liste')) {
      const objektId = Number(u.searchParams.get('objekt_id'));
      return send({ status: 'ok', vorlagen: VORLAGEN_ALLE.vorlagen.filter(v => v.objekt_id === objektId) });
    }
    return send({ status: 'ok' });
  });
  // Diese Suite oeffnet seit dem Navigations-Fehlertest (ENT-271-Fortsetzung)
  // auch den Kartenansicht-Reiter der Kontrollrunde -- der laedt Google Maps
  // nach (googleMapsLaden()). Muss NACH der allgemeinen "**/api/**"-Route
  // registriert werden, sonst faengt diese "/maps/api/js" faelschlich ab
  // (Playwright ruft bei mehreren Treffern die zuletzt registrierte zuerst).
  return p.then(() => page.route('**/maps.googleapis.com/**', route =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: GOOGLE_MAPS_MOCK })));
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
// Volle Leiste ausdruecklich erzwingen: Ein Teil dieser Suite prueft das
// Auf-/Zuklappen der Revierdienst-Gruppe an der Leiste selbst (ENT-271) --
// das gibt es nur im Zustand "voll", nicht in der Kopfleiste (ENT-407).
await page.evaluate(() => huelleSetzen('voll'));

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
// ENT-289: die Kopfzeile zeigte hier bisher weiterhin "Übersicht" -- den
// Ansichtstitel der Kachel-Landingpage --, obwohl tatsächlich die
// objektübergreifende Liste offen war (gemeldet vom Projektinhaber).
check('KRITISCH: die Kopfzeile trägt hier einen eigenen Titel, nicht mehr "Übersicht"',
  (await page.textContent('#pgTitle')) === 'Rundgänge');
check('Die Unterzeile beschreibt die Liste selbst', (await page.textContent('#pgCrumb')) === 'Alle Kontrollrunden über alle Objekte');

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

// ══════════ ROUTENPUNKTE (ENT-273): EINE NOCH NICHT GESPEICHERTE RUNDE HAT
// KEINE vorlage_id -- rundgang_vorlage_punkte_setzen.php braucht aber genau
// die. Der Reiter zeigt darum einen Hinweis statt einer leeren Tabelle
// ("noch nicht gespeichert" ist etwas anderes als "keine Routenpunkte",
// Hausregel: unbekannt darf nie wie keine aussehen) und der Hinzufuegen-
// Knopf ist deaktiviert, statt bei Klick unklar zu scheitern.
await page.click('#rdKrReiter .rdkr-tab[data-reiter="routenpunkte"]');
await page.waitForTimeout(150);
check('KRITISCH: eine noch nicht gespeicherte Runde zeigt einen Hinweis statt einer leeren Routenpunkte-Tabelle',
  (await page.textContent('#rdKrAb-routenpunkte')).includes('Zuerst speichern'));
check('KRITISCH: der Knopf "Routenpunkte hinzufügen" ist dabei deaktiviert',
  await page.isDisabled('#rpHinzuOeffnenBtn'));
await page.click('#rdKrReiter .rdkr-tab[data-reiter="allgemeines"]');
await page.waitForTimeout(100);

// ══════════ ZURÜCK ZUR HAUPTSEITE PER NAVIGATION (gemeldeter Fehler): wer
// aus der Kontrollrunden-Bearbeitung heraus ueber die Navigation (Klick auf
// "Revierdienst"/"Übersicht", clientseitig go('rundgaenge')) zurueckwill,
// landete bislang auf einer widerspruechlichen Seite: die Kopfzeile zeigte
// wieder "Übersicht" (go() setzt kopfSondertitel(null) immer), aber
// #rdAb-kr blieb sichtbar -- kein Weg zurueck ausser hartem Neuladen, weil
// revierdienstUebersichtOeffnen() nur Daten nachlud, nie den Unterbereich
// zuruecksetzte. Ohne die Behebung in revierdienstUebersichtOeffnen()
// (rdUebersichtZeigen() zu Beginn) bleibt dieser Block rot.
await page.evaluate(() => go('rundgaenge'));
await page.waitForTimeout(150);
check('KRITISCH: die Navigation aus der Kontrollrunden-Bearbeitung führt zurück zur Kachel-Übersicht, nicht zu einer hängenden Seite',
  await page.isVisible('#rdUebersicht') && !(await page.isVisible('#rdAb-kr')) && !(await page.isVisible('#rdAb-liste')));
check('Die Kopfzeile passt dazu wieder zum Ansichtstitel, nicht zum Rundennamen',
  await page.isVisible('#pgTitle') && !(await page.isVisible('#rdKrTitel')));
// ══════════ DASSELBE UEBER DEN TATSAECHLICHEN KLICK AUF DAS "REVIERDIENST"-
// ICON (ENT-271 behob nur den Weg ueber go('rundgaenge')/den Untermenuepunkt
// "Übersicht" -- das Icon selbst hat einen EIGENEN Kurzschluss in
// revierdienstNavKlick(): "die Ansicht ist schon offen" bleibt auch tief in
// der Kontrollrunden-Bearbeitung wahr, ein Klick klappte darum nur die
// Seitenleiste ein, ohne zurueckzufuehren -- vom Projektinhaber an genau
// diesem Reiter (Kartenansicht) erneut gemeldet, nachdem ENT-271 schon
// auslieferte. Ohne die Behebung dort bleibt dieser Block rot.)
await page.evaluate(() => rdKrZeigen('neu'));
await page.waitForFunction(() => document.getElementById('rdAb-kr').style.display !== 'none');
await page.click('#rdKrReiter .rdkr-tab[data-reiter="karte"]');
await page.waitForTimeout(150);
await page.click('#nav-revierdienst');
await page.waitForTimeout(150);
check('KRITISCH: der Klick auf das "Revierdienst"-Icon selbst führt aus der Kontrollrunden-Bearbeitung (auch vom Kartenansicht-Reiter aus) zurück zur Kachel-Übersicht',
  await page.isVisible('#rdUebersicht') && !(await page.isVisible('#rdAb-kr')));
// Gegenprobe zum Einklapp-Verhalten (ENT-271-Kommentar in
// revierdienstNavKlick()): auf der Landingpage selbst darf ein zweiter Klick
// weiterhin nur die Seitenleiste einklappen, nicht wegnavigieren.
const vorherOffen = await page.evaluate(() => document.getElementById('navg-revierdienst').classList.contains('offen'));
await page.click('#nav-revierdienst');
await page.waitForTimeout(150);
check('Ein zweiter Klick auf der Landingpage selbst klappt weiterhin nur die Seitenleiste ein',
  vorherOffen && !(await page.evaluate(() => document.getElementById('navg-revierdienst').classList.contains('offen')))
  && await page.isVisible('#rdUebersicht'));

// Fuer den Rest der Suite wieder in die Kontrollrunden-Bearbeitung, damit
// die folgenden Prüfungen unveraendert weiterlaufen -- rdEinObjekt ist
// durch die Navigation eben nicht veraendert worden (bewusst geprueft:
// nur der sichtbare Unterbereich wechselte), rdKrZeigen('neu') reicht.
await page.evaluate(() => rdKrZeigen('neu'));
await page.waitForFunction(() => document.getElementById('rdAb-kr').style.display !== 'none');

// ENT-261 hatte den Zurück-Knopf dieser Seite per Skizze ersatzlos entfernt
// und dabei ausdrücklich den Rückweg als "echter Bedienweg weniger" benannt,
// mit dem Angebot, stattdessen einen Zurück-Pfeil neben den Titel in die
// Kopfzeile zu setzen. ENT-289 setzt genau das um, nachdem der
// Projektinhaber den fehlenden Rückweg erneut gemeldet hat -- jetzt über
// den echten Knopf-Klick geprüft, nicht mehr über einen direkten Aufruf.
check('KRITISCH: ein Zurück-Pfeil steht neben dem Rundentitel in der Kopfzeile',
  await page.isVisible('#rdKrTitelWrap .btn-kopf-zurueck'));
await page.click('#rdKrTitelWrap .btn-kopf-zurueck');
await page.waitForTimeout(150);
check('KRITISCH: der Zurück-Pfeil führt zur Rundgänge-Liste, nicht zur Kachel-Übersicht',
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
check('KRITISCH: der Kontrollpunkte-Reiter zeigt die Anzahl aller Punkte des Objekts (3, inkl. dem noch nicht zugeordneten "Garage")',
  (await page.textContent('#rdKrKpBadge')).trim() === '3');
check('KRITISCH: der aktive Reiter ist als solcher markiert',
  await page.evaluate(() => document.querySelector('#rdKrReiter .rdkr-tab.aktiv')?.dataset.reiter === 'allgemeines'));

// ══════════ ENT-277: ANSPRECHPARTNER ALS FELD STATT EIGENEM REITER
check('KRITISCH: "Ansprechpartner" ist kein Reiter mehr in der Leiste',
  await page.evaluate(() => !document.querySelector('#rdKrReiter .rdkr-tab[data-reiter="ansprechpartner"]')));
check('KRITISCH: Bezeichnung des Ansprechpartners wird vorbefüllt (kann eine Pikett-Nummer sein, kein Personenname)',
  (await page.inputValue('#rdKrAnsprechpartnerName')) === 'Pikett Sicherheit');
check('KRITISCH: Telefonnummer des Ansprechpartners wird vorbefüllt',
  (await page.inputValue('#rdKrAnsprechpartnerTelefon')) === '+41 79 111 22 33');

// ══════════ ENT-279: AUSFUEHRUNGSFENSTER
check('KRITISCH: das Ausführungsfenster wird vorbefüllt (Von)',
  (await page.inputValue('#rdKrFensterVon')) === '21:00');
check('KRITISCH: das Ausführungsfenster wird vorbefüllt (Bis)',
  (await page.inputValue('#rdKrFensterBis')) === '23:00');

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

// ══════════ ROUTENPUNKTE (ENT-273): TABELLE, HINZUFÜGEN, VERSCHIEBEN,
// ENTFERNEN -- alles sofort speichernd, kein "Speichern"-Knopf in diesem
// Reiter. Vorbild: Referenz-Bildschirmfotos eines Fremdsystems.
check('KRITISCH: die Reihenfolge stimmt (Eingang vor Keller, wie in punkte[].reihenfolge)',
  await page.evaluate(() => {
    const namen = [...document.querySelectorAll('#rdKrRoutenTabelle tbody tr td:nth-child(2) b')].map(td => td.textContent);
    return namen[0] === 'Eingang' && namen[1] === 'Keller';
  }));
check('Die Informationen-Spalte zeigt die Kontrollpunkt-Beschreibung, ein Strich wenn keine gepflegt ist',
  routenInhalt.includes('Haupteingang Nord') && await page.evaluate(() =>
    [...document.querySelectorAll('#rdKrRoutenTabelle tbody tr')][1].textContent.includes('–')));

// ── Hinzufügen: nur der noch nicht zugeordnete Punkt (Garage) steht zur Wahl
calls = [];
await page.click('#rpHinzuOeffnenBtn');
await page.waitForSelector('#dlgRpHinzu.on');
const hinzuTexte = await page.textContent('#rpHinzuListe');
check('KRITISCH: im Hinzufügen-Dialog steht nur der noch nicht zugeordnete Kontrollpunkt (Garage)',
  hinzuTexte.includes('Garage') && !hinzuTexte.includes('Eingang') && !hinzuTexte.includes('Keller'));
await page.check('#rpHinzuListe .rp-hinzu-punkt[value="3"]');
const [hinzuAnfrage] = await Promise.all([
  page.waitForRequest(r => r.url().includes('rundgang_vorlage_punkte_setzen') && r.method() === 'POST'),
  page.click('#rpHinzuBtn'),
]);
check('KRITISCH: sofort gespeichert -- die Anfrage traegt Eingang/Keller UND das neue Garage in dieser Reihenfolge',
  JSON.stringify(hinzuAnfrage.postDataJSON().kontrollpunkt_ids) === '[1,2,3]');
await page.waitForFunction(() => !document.getElementById('dlgRpHinzu').classList.contains('on'));
await page.waitForTimeout(150);
check('Garage erscheint jetzt als dritter Routenpunkt in der Tabelle',
  await page.evaluate(() => [...document.querySelectorAll('#rdKrRoutenTabelle tbody tr td:nth-child(2) b')]
    .map(td => td.textContent).join('|') === 'Eingang|Keller|Garage'));
check('KRITISCH: der Anzahl-Chip des Reiters zieht sofort nach (3)',
  (await page.textContent('#rdKrRoutenBadge')).trim() === '3');

// ── Verschieben: Garage (Rang 3) einen Platz nach oben, vor Keller
calls = [];
const [verschiebenAnfrage] = await Promise.all([
  page.waitForRequest(r => r.url().includes('rundgang_vorlage_punkte_setzen') && r.method() === 'POST'),
  page.click('#rdKrRoutenTabelle tr:has-text("Garage") button[title="Nach oben"]'),
]);
check('KRITISCH: Verschieben sendet die neue Reihenfolge sofort (Garage vor Keller)',
  JSON.stringify(verschiebenAnfrage.postDataJSON().kontrollpunkt_ids) === '[1,3,2]');
await page.waitForTimeout(150);
check('Die Tabelle zeigt danach Eingang, Garage, Keller',
  await page.evaluate(() => [...document.querySelectorAll('#rdKrRoutenTabelle tbody tr td:nth-child(2) b')]
    .map(td => td.textContent).join('|') === 'Eingang|Garage|Keller'));

// ── Entfernen: Keller aus dieser Runde (nicht der Kontrollpunkt selbst) --
// mit Rueckfrage, gleiches Muster wie andere loeschende Aktionen im Haus.
calls = [];
await page.click('#rdKrRoutenTabelle tr:has-text("Keller") button:has-text("Entfernen")');
await page.waitForSelector('#dlgConfirm.on');
check('Die Rückfrage macht den Unterschied klar: nur die Zuordnung verschwindet, nicht der Kontrollpunkt',
  (await page.textContent('#cfText')).includes('bleibt bestehen'));
const [entfernenAnfrage] = await Promise.all([
  page.waitForRequest(r => r.url().includes('rundgang_vorlage_punkte_setzen') && r.method() === 'POST'),
  page.click('#cfBtn'),
]);
check('KRITISCH: Entfernen sendet die Liste ohne Keller (1, 3)',
  JSON.stringify(entfernenAnfrage.postDataJSON().kontrollpunkt_ids) === '[1,3]');
await page.waitForTimeout(150);
check('Keller ist aus der Tabelle verschwunden, Eingang und Garage bleiben',
  await page.evaluate(() => [...document.querySelectorAll('#rdKrRoutenTabelle tbody tr td:nth-child(2) b')]
    .map(td => td.textContent).join('|') === 'Eingang|Garage'));
check('Der Anzahl-Chip zeigt wieder 2', (await page.textContent('#rdKrRoutenBadge')).trim() === '2');

// Einer der noch unverdrahteten Reiter stichprobenartig geprüft --
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
check('KRITISCH: der Ansprechpartner ist leer, weil "Schliessrunde" keinen hat (kein "null" als Text)',
  await page.inputValue('#rdKrAnsprechpartnerName') === '' && await page.inputValue('#rdKrAnsprechpartnerTelefon') === '');
check('KRITISCH: das Ausführungsfenster ist leer, weil "Schliessrunde" keines hat',
  await page.inputValue('#rdKrFensterVon') === '' && await page.inputValue('#rdKrFensterBis') === '');

// ENT-279: nur EINE der beiden Fensterzeiten füllen -- muss abgewiesen werden,
// statt ein halbes Fenster stillschweigend zu speichern. Wie jedes Zeitfeld
// (ENT-110) ueber die Auswahlfelder gesetzt, nicht per page.fill() -- das
// urspruengliche <input type="time"> ist seit zeitwahl.js unsichtbar.
await zeitSetzen(page, '#rdKrFensterVon', '21:00');
calls = [];
await page.click('#rdKrBtn');
await page.waitForTimeout(150);
check('KRITISCH: nur "Von" gefüllt zeigt einen Hinweis statt zu speichern',
  await page.isVisible('#rdKrErr') && !calls.some(c => c.includes('rundgang_vorlage_save')));
await zeitSetzen(page, '#rdKrFensterVon', '');

await page.fill('#rdKrBeschreibung', 'Schliesskontrolle nach Ladenschluss');
await page.fill('#rdKrAnsprechpartnerName', 'Herr Meier');
await page.fill('#rdKrAnsprechpartnerTelefon', '079 123 45 67');
await zeitSetzen(page, '#rdKrFensterVon', '22:30');
await zeitSetzen(page, '#rdKrFensterBis', '00:30');
calls = [];
const [speicherAnfrage] = await Promise.all([
  page.waitForRequest(r => r.url().includes('rundgang_vorlage_save') && r.method() === 'POST'),
  page.click('#rdKrBtn'),
]);
check('KRITISCH: die Beschreibung wird beim Speichern mitgesendet',
  speicherAnfrage.postDataJSON().beschreibung === 'Schliesskontrolle nach Ladenschluss');
check('KRITISCH: die Bezeichnung des Ansprechpartners wird beim Speichern mitgesendet',
  speicherAnfrage.postDataJSON().ansprechpartner_name === 'Herr Meier');
check('KRITISCH: die Telefonnummer wird beim Speichern auf die internationale Schreibweise gebracht (ENT-118)',
  speicherAnfrage.postDataJSON().ansprechpartner_telefon === '+41 79 123 45 67');
check('KRITISCH: ein über Mitternacht gehendes Ausführungsfenster wird unverändert mitgesendet',
  speicherAnfrage.postDataJSON().fenster_von === '22:30' && speicherAnfrage.postDataJSON().fenster_bis === '00:30');
await page.waitForFunction(() => document.getElementById('rdAb-liste').style.display !== 'none');
check('KRITISCH: nach dem Speichern steht wieder die Liste da, nicht die Kachel-Übersicht',
  await page.isVisible('#rdAb-liste') && !(await page.isVisible('#rdUebersicht')));
check('Die Kontrollrunde wird gespeichert', calls.some(c => c.includes('rundgang_vorlage_save')));

// ══════════ "ZURUECK" VON DER LISTE FUEHRT WIEDER ZUR KACHEL-UEBERSICHT
await page.click('#rdAb-liste .bk-zurueck');
await page.waitForTimeout(150);
check('KRITISCH: "Zurück" zeigt wieder die Kachel-Übersicht', await page.isVisible('#rdUebersicht'));
check('Die Unterseite ist wieder ausgeblendet', !(await page.isVisible('#rdAb-liste')));
// ENT-289: rdUebersichtZeigen() wird hier NICHT ueber go() erreicht (das
// wuerde TITLES ohnehin neu setzen) -- ohne eigene Rueckstellung bliebe der
// Listentitel "Rundgänge" stehen, obwohl schon die Kachel-Uebersicht zeigt.
check('KRITISCH: die Kopfzeile zeigt wieder "Übersicht", nicht mehr den Listentitel',
  (await page.textContent('#pgTitle')) === 'Übersicht');

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
