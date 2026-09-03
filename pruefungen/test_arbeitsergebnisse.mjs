// Auswertung > "Arbeitsergebnisse" (ENT-243, umgebaut in ENT-325): eine
// eigene Ansicht mit derselben Kachelreihe wie "Kontrollrunde ändern"
// (.rdkr-reiter/.rdkr-tab), nicht mehr eine Schublade mit einer senkrechten
// Reiterliste. Volles Gerüst, aber nur "Kontrollpunktscans",
// "Rundgangerledigung" und "Fahrzeugübernahmen" (ENT-346) tatsächlich
// verdrahtet; die übrigen fünf haben noch kein Datenmodell und sagen das
// sichtbar, statt auszusehen wie die anderen und dann nichts zu zeigen.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const SEITE = `file://${WURZEL}/dashboard.html`;
const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);
// Klicken mit kurzer Frist und ohne Absturz: Fehlt ein Reiter, weil eine
// Gegenprobe ihn entfernt hat, wartete page.click() dreissig Sekunden und
// riss die Suite mit. Rot war sie dadurch zwar, aber die Zusammenfassung mit
// den BENANNTEN Aussagen kam nie -- und genau die braucht man.
async function klick(sel) {
  try { await page.click(sel, { timeout: 3000 }); return true; }
  catch (e) { bad.push('nicht anklickbar: ' + sel); return false; }
}

// Relative Daten statt fester Werte -- kippt sonst beim Datumswechsel
// (CLAUDE.md, test_datumsfest.mjs).
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const vorTagen = n => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };
const T0 = vorTagen(0), T1 = vorTagen(1), T2 = vorTagen(2);

const SCANS = { status: 'ok', scans: [
  { id: 1, erfasst_am: `${T2} 20:04:00`, status: 'bestaetigt', beschreibung: null,
    kontrollpunkt_name: 'Eingang', kunde_name: 'Muster Liegenschaften AG', objekt_name: 'Testliegenschaft Nord',
    titel: 'Öffnungsrunde', vorname: 'Erika', nachname: 'Muster' },
  { id: 2, erfasst_am: `${T1} 21:10:00`, status: 'nicht_verfuegbar', beschreibung: null,
    kontrollpunkt_name: 'Keller', kunde_name: 'Muster Liegenschaften AG', objekt_name: 'Testliegenschaft Nord',
    titel: 'Öffnungsrunde', vorname: 'Erika', nachname: 'Muster' },
  { id: 3, erfasst_am: `${T0} 22:15:00`, status: 'ersatzscan', beschreibung: 'NFC-Chip defekt, Foto beigelegt',
    kontrollpunkt_name: 'Garage', kunde_name: 'Beispiel Immobilien GmbH', objekt_name: 'Testliegenschaft Süd',
    titel: null, vorname: 'Hans', nachname: 'Beispiel' },
]};

const RUNDGAENGE = { status: 'ok', rundgaenge: [
  { id: 10, einsatz_id: 1, objekt_id: 1, mitarbeiter_id: 5, status: 'abgeschlossen',
    rohzeit_start: `${T2} 20:04:00`, rohzeit_ende: `${T2} 20:41:00`, datum: T2,
    kunde_name: 'Muster Liegenschaften AG', objekt_name: 'Testliegenschaft Nord', titel: 'Öffnungsrunde',
    vorname: 'Erika', nachname: 'Muster', fortschritt: { gesamt: 3, bestaetigt: 3, nicht_verfuegbar: 0 } },
]};

// Erfundene Kontrollschilder mit hoher Nummer -- kein echtes Fahrzeug
// (gleiche Konvention wie test_fahrzeug_uebernahme.mjs). Eine Zeile mit
// Foto, eine ohne, und eine "kein Dienstfahrzeug"-Antwort -- die drei Fälle,
// die sich am deutlichsten unterscheiden müssen.
const UEBERNAHMEN = { status: 'ok', eingerichtet: true, eintraege: [
  { id: 1, art: 'uebernahme', zeitpunkt: `${T1} 06:12:00`, tacho_km: 61200, quelle: 'qr', hat_foto: true,
    fahrzeug_id: 1, kennzeichen: 'SO 999001', fz_bezeichnung: 'Patrouille 1',
    person: 'Erika Muster', kunde_name: 'Muster Liegenschaften AG', titel: 'Öffnungsrunde' },
  { id: 2, art: 'uebernahme', zeitpunkt: `${T0} 07:03:00`, tacho_km: 40500, quelle: 'liste', hat_foto: false,
    fahrzeug_id: 2, kennzeichen: 'SO 999002', fz_bezeichnung: null,
    person: 'Hans Beispiel', kunde_name: null, titel: null },
  { id: 3, art: 'ohne_fahrzeug', zeitpunkt: `${T0} 07:05:00`, tacho_km: null, quelle: 'antwort', hat_foto: false,
    fahrzeug_id: null, kennzeichen: null, fz_bezeichnung: null,
    person: 'Hans Beispiel', kunde_name: null, titel: null },
]};

let calls = [];

function setup(page) {
  return page.route('**/api/**', async route => {
    const req = route.request();
    const u = new URL(req.url());
    const path = u.pathname.split('/api/')[1];
    calls.push({ path, query: Object.fromEntries(u.searchParams) });
    const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (path.includes('login')) return send({ status: 'ok', token: 't', name: 'adrian', ist_admin: true });
    if (path.includes('dashboard_stats')) return send({ status: 'ok', kpi: {}, verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [] });
    if (path.includes('rundgang_scan_liste')) return send(SCANS);
    if (path.includes('rundgang_liste')) return send(RUNDGAENGE);
    if (path.includes('fahrzeug_uebernahme_liste')) return send(UEBERNAHMEN);
    if (path.includes('mitarbeiter_list')) return send({ status: 'ok', mitarbeiter: [] });
    // kontrolleNavKlick() landet auf Pensen -- ohne dieses Fixture crasht
    // zeichnePensen() auf pensen.mitarbeiter.map() (gleiches Muster wie in
    // test_rundgaenge_verwaltung.mjs). Nicht der Pruefgegenstand hier.
    if (path.includes('pensen.php')) return send({ status: 'ok', jahr: 2026, mitarbeiter: [] });
    return send({ status: 'ok' });
  });
}

const browser = await chromium.launch({ executablePath: EXE });
// Bewusst die SCHMALSTE Desktop-Breite, auf der die Kachelreihe noch auf
// eine Ebene passt: Sie braucht rund 1110 px, hier stehen 1156 px zur
// Verfügung. Auf einem breiteren Fenster zu prüfen wäre bequemer und
// wertloser -- eine spätere Änderung, die die Kacheln breiter macht, fiele
// dort nicht auf und erst beim Projektinhaber (ENT-326).
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));

await setup(page);
await page.goto(SEITE);
await page.evaluate(() => localStorage.clear());
await page.goto(SEITE);
await page.fill('#gName', 'adrian'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#kpiGrid .kpi-val');

// Gruppe oeffnen (wie zurEinrichtung() in test_kontrollpunkte.mjs), dann den
// neuen Menuepunkt anklicken.
await page.evaluate(() => {
  if (!document.getElementById('navg-kontrolle').classList.contains('offen')) {
    document.getElementById('nav-kontrolle').click();
  }
});
await page.waitForTimeout(150);
check('Der Menuepunkt "Arbeitsergebnisse" ist sichtbar', await page.isVisible('#nav-kontrolle-arbeitsergebnisse'));

calls = [];
await klick('#nav-kontrolle-arbeitsergebnisse');
try { await page.waitForSelector('#view-arbeitsergebnisse.on', { timeout: 3000 }); }
catch (e) { bad.push('Die Ansicht öffnet sich nicht'); }
// Seit ENT-325 eine eigene Ansicht: Der Titel steht in der Kopfzeile der
// Seite, nicht in einem Schubladenkopf.
check('KRITISCH: es öffnet sich eine eigene Ansicht, keine Schublade',
  await page.evaluate(() => !document.getElementById('drawer').classList.contains('on')));
check('Der Seitentitel lautet "Arbeitsergebnisse"',
  await page.textContent('#pgTitle') === 'Arbeitsergebnisse');
// Man soll in der Navigation sehen, wo man steht -- als Schublade gab es
// diese Markierung nicht.
check('Der Menüpunkt ist als aktiv markiert',
  await page.evaluate(() => document.getElementById('nav-kontrolle-arbeitsergebnisse').classList.contains('on')));

// ══════════ ALLE ACHT KACHELN IN DER VORGEGEBENEN REIHENFOLGE
const reiter = await page.$$eval('#aeReiter .rdkr-tab .rdkr-tab-lbl', els => els.map(e => e.textContent.trim()));
check('KRITISCH: alle acht Reiter stehen da, in der vorgegebenen Reihenfolge', JSON.stringify(reiter) ===
  JSON.stringify(['Wachbuch', 'Kontrollpunktscans', 'Ereignisse', 'Rundgangerledigung', 'Aufgabenerledigung', 'Alarme', 'Schlüsselprotokoll', 'Fahrzeugübernahmen']));
// Dasselbe Muster wie "Kontrollrunde ändern" -- ein zweites Reiter-Aussehen
// im Haus für dieselbe Sache wäre eine zweite Sprache.
check('KRITISCH: sie benutzen dieselbe Kachelreihe wie "Kontrollrunde ändern"',
  await page.evaluate(() => {
    const r = document.getElementById('aeReiter');
    return r.classList.contains('rdkr-reiter')
      && r.querySelectorAll('.rdkr-tab').length === 8;
  }));
check('Jede Kachel trägt ein Sinnbild',
  await page.evaluate(() =>
    [...document.querySelectorAll('#aeReiter .rdkr-tab')].every(b => b.querySelector('.rdkr-tab-ic svg'))));
// Die Seite startet auf dem ersten Reiter, der wirklich etwas zeigt --
// auf einem dauerhaft leeren zu landen wäre ein schlechter erster Eindruck.
// Über einen Zugriff mit Rückfall statt direkt: Fehlt die Kachel, soll die
// Suite SAGEN, welche Aussage nicht mehr stimmt, statt in der Seite mit
// „classList of null" abzustürzen -- beim Gegenprobieren aufgefallen.
check('KRITISCH: die Ansicht startet auf einem verdrahteten Reiter',
  await page.evaluate(() => {
    const e = document.getElementById('ae-tab-scans');
    return !!e && e.classList.contains('aktiv');
  }));
// „Unbekannt darf nie wie keine aussehen": Ein Reiter, der aussieht wie die
// anderen und dann nichts zeigt, ist derselbe Fehler.
// Seit ENT-326 gedämpft statt mit einem "folgt"-Chip daneben: Der Chip war
// ehrlich, aber fünfmal 41 px in einer Zeile, die auf EINE Ebene passen soll.
// Geprüft wird die Aussage, nicht das Mittel -- gemessen an der tatsächlich
// gerenderten Farbe, nicht an einer Klasse allein.
check('KRITISCH: die noch nicht verdrahteten Reiter sind schon an der Kachel zu erkennen',
  await page.evaluate(() => {
    const mit = ['wachbuch', 'ereignisse', 'aufgaben', 'alarme', 'schluessel'];
    const ohne = ['scans', 'erledigung', 'fahrzeuguebernahmen'];
    const farbe = t => {
      const e = document.getElementById('ae-tab-' + t);
      return e ? getComputedStyle(e.querySelector('.rdkr-tab-lbl')).color : null;
    };
    const gedaempft = farbe('wachbuch'), normal = farbe('erledigung');
    return !!gedaempft && !!normal && gedaempft !== normal
      && mit.every(t => farbe(t) === gedaempft)
      && ohne.every(t => farbe(t) === normal);
  }));
// Und dort, wo Farbe allein nicht ankommt -- Vorleseprogramm, Mauszeiger.
check('KRITISCH: die Aussage steht auch im Text, nicht nur in der Farbe',
  await page.evaluate(() => {
    const e = document.getElementById('ae-tab-wachbuch');
    const f = document.getElementById('ae-tab-erledigung');
    return !!e && (e.getAttribute('title') || '').includes('folgt später')
      && (e.getAttribute('aria-label') || '').includes('folgt später')
      && !!f && !f.getAttribute('title');
  }));

// ══════════ UNVERDRAHTETE REITER: BLEIBENDER HINWEIS, KEIN TOAST
calls = [];
await klick('#ae-tab-wachbuch');
await page.waitForTimeout(150);
// Der Name steht im Hinweis: Zwei Reiter hintereinander angetippt zeigten
// sonst zweimal denselben Satz, und man wüsste nicht, ob sich etwas tat.
check('KRITISCH: "Wachbuch" zeigt einen bleibenden Hinweis statt nichts zu tun',
  (await page.textContent('#aeInhalt')).includes('Wachbuch folgt später'));
check('Kein API-Aufruf fuer einen unverdrahteten Reiter', calls.length === 0);

// ══════════ KONTROLLPUNKTSCANS: ECHTE DATEN, DREI STATUS-ARTEN
await klick('#ae-tab-scans');
await page.waitForTimeout(200);
check('KRITISCH: "Kontrollpunktscans" ruft rundgang_scan_liste.php auf', calls.some(c => c.path.includes('rundgang_scan_liste')));
// Mit Rückfall auf ein leeres Objekt: Kam der Aufruf gar nicht, soll die
// Suite das als eigene Aussage melden und nicht abstürzen.
const scanRuf = calls.find(c => c.path.includes('rundgang_scan_liste')) || { query: {} };
check('KRITISCH: Vorgabe ist der zurückliegende Monat bis heute (wie Auslagenersatz, ENT-045)',
  !!scanRuf.query.von && !!scanRuf.query.bis && scanRuf.query.von !== scanRuf.query.bis);
const scanInhalt = await page.textContent('#aeInhalt');
check('Alle drei Status-Arten erscheinen', scanInhalt.includes('Bestätigt') && scanInhalt.includes('Nicht verfügbar') && scanInhalt.includes('Ersatzscan'));
check('Die Bemerkung eines Ersatzscans erscheint', scanInhalt.includes('NFC-Chip defekt'));
check('Kunde/Objekt/Kontrollpunkt/Mitarbeiter je Scan erscheinen',
  scanInhalt.includes('Muster Liegenschaften AG') && scanInhalt.includes('Testliegenschaft Nord')
  && scanInhalt.includes('Eingang') && scanInhalt.includes('Muster, Erika'));
// Karten statt Tabelle stammen aus der Schubladenzeit (ENT-243). Sie
// bleiben: Ein Scan hat wenige Angaben, und die Karte trägt sie auf dem
// Handy wie am Desktop ohne waagrechten Scroll.
check('KRITISCH: kein waagrechter Scroll im Inhalt -- Karten statt einer zu breiten Tabelle',
  await page.evaluate(() => {
    const inhalt = document.getElementById('aeInhalt');
    return inhalt.scrollWidth <= inhalt.clientWidth + 1 && !inhalt.querySelector('table');
  }));

// Leerer Zeitraum
await page.route('**/api/rundgang_scan_liste.php**', route =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', scans: [] }) }));
await page.evaluate(() => aeLadeScans());
await page.waitForTimeout(150);
check('KRITISCH: kein Scan im Zeitraum sagt das explizit', (await page.textContent('#aeInhalt')).includes('Nichts vorhanden'));

// ══════════ RUNDGANGERLEDIGUNG: ECHTE DATEN, EIGENER LEERTEXT
calls = [];
await klick('#ae-tab-erledigung');
await page.waitForTimeout(200);
check('KRITISCH: "Rundgangerledigung" ruft rundgang_liste.php auf', calls.some(c => c.path.includes('rundgang_liste')));
const erlRuf = calls.find(c => c.path.includes('rundgang_liste')) || { query: {} };
check('Auch hier: Vorgabe ist der zurückliegende Monat bis heute', !!erlRuf.query.von && erlRuf.query.von !== erlRuf.query.bis);
const erlInhalt = await page.textContent('#aeInhalt');
check('Der Rundgang aus dem Zeitraum erscheint', erlInhalt.includes('Öffnungsrunde') && erlInhalt.includes('3/3'));
check('KRITISCH: auch hier Karten ohne waagrechten Scroll',
  await page.evaluate(() => {
    const inhalt = document.getElementById('aeInhalt');
    return inhalt.scrollWidth <= inhalt.clientWidth + 1 && !inhalt.querySelector('table');
  }));

await page.route('**/api/rundgang_liste.php**', route =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', rundgaenge: [] }) }));
await page.evaluate(() => aeLadeErledigung());
await page.waitForTimeout(150);
check('KRITISCH: kein Rundgang im Zeitraum sagt das mit eigenem Text (nicht "in den letzten 14 Tagen", das gilt nur der Kachel)',
  (await page.textContent('#aeInhalt')).includes('Im gewählten Zeitraum liegt kein Rundgang vor.'));

// ══════════ FAHRZEUGÜBERNAHMEN (ENT-346): NICHT UNTER EINSTELLUNGEN ═════
// ENT-313 hatte das ausdrücklich ausgeschlossen ("hier wird nichts
// kontrolliert und nichts gerechnet") -- dieser Reiter ist die Umsetzung
// von "dort, wo täglich gearbeitet wird".
calls = [];
await klick('#ae-tab-fahrzeuguebernahmen');
await page.waitForTimeout(200);
check('KRITISCH: "Fahrzeugübernahmen" ruft fahrzeug_uebernahme_liste.php auf',
  calls.some(c => c.path.includes('fahrzeug_uebernahme_liste')));
const uebRuf = calls.find(c => c.path.includes('fahrzeug_uebernahme_liste')) || { query: {} };
check('Auch hier: Vorgabe ist der zurückliegende Monat bis heute',
  !!uebRuf.query.von && uebRuf.query.von !== uebRuf.query.bis);
const uebInhalt = await page.textContent('#aeInhalt');
check('Die Übernahme mit Fahrzeug nennt Kontrollschild, Kilometerstand und Quelle',
  uebInhalt.includes('SO 999001') && uebInhalt.includes('61') && uebInhalt.includes('200')
  && uebInhalt.includes('QR-Aufkleber'));
check('Die zweite Übernahme nennt die manuelle Quelle',
  uebInhalt.includes('SO 999002') && uebInhalt.includes('Manuell'));
// "Kein Dienstfahrzeug" ist eine eigene Aussage, kein leerer Fahrzeugname --
// sie muss als solche benannt sein, nicht als "SO –" oder Ähnliches.
check('KRITISCH: "kein Dienstfahrzeug" steht als eigene Aussage da, nicht als leeres Fahrzeugfeld',
  uebInhalt.includes('Kein Dienstfahrzeug'));
check('Kunde/Einsatz erscheinen, wo einer bekannt ist',
  uebInhalt.includes('Muster Liegenschaften AG') && uebInhalt.includes('Öffnungsrunde'));
check('Person je Übernahme erscheint', uebInhalt.includes('Erika Muster') && uebInhalt.includes('Hans Beispiel'));
check('KRITISCH: auch hier Karten ohne waagrechten Scroll',
  await page.evaluate(() => {
    const inhalt = document.getElementById('aeInhalt');
    return inhalt.scrollWidth <= inhalt.clientWidth + 1 && !inhalt.querySelector('table');
  }));
// Nur die Übernahme MIT Foto (id 1) trägt einen "Foto ansehen"-Knopf --
// sonst wäre ein Knopf, der ins Leere klickt, dieselbe falsche Auskunft
// wie ein Feld, das etwas verspricht, was nicht da ist.
const fotoKnopfAnzahl = await page.$$eval('#aeInhalt button',
  els => els.filter(b => b.textContent.includes('Foto ansehen')).length);
check('KRITISCH: genau eine Karte hat einen Foto-Knopf -- nur die Übernahme, die ein Foto trägt',
  fotoKnopfAnzahl === 1);

// Der Foto-Knopf holt das Bild per fetch() (Token im Kopf, nicht in der
// URL -- test_php.mjs prüft das) und öffnet es in einem neuen Tab, statt
// es ungefragt für jede Karte vorzuladen. Nur geprüft, wenn der Knopf
// tatsächlich da ist -- ein Klick auf einen fehlenden Knopf soll den Lauf
// nicht mit einem Absturz statt eines roten Ergebnisses beenden.
if (fotoKnopfAnzahl !== 1) {
  bad.push('KRITISCH: der Foto-Knopf öffnet das Bild in einem neuen Tab, nicht in der Auswertung selbst — der Foto-Knopf fehlte bereits');
} else {
await page.route('**/api/fahrzeug_uebernahme_foto.php**', route =>
  route.fulfill({ status: 200, contentType: 'image/jpeg', body: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) }));
const [fotoTab] = await Promise.all([
  page.context().waitForEvent('page'),
  page.$$eval('#aeInhalt button', els => els.find(b => b.textContent.includes('Foto ansehen')).click()),
]);
await fotoTab.waitForLoadState('domcontentloaded').catch(() => {});
check('KRITISCH: der Foto-Knopf öffnet das Bild in einem neuen Tab, nicht in der Auswertung selbst',
  fotoTab.url().startsWith('blob:'));
await fotoTab.close();
}

// Leerer Zeitraum ist etwas anderes als "nicht eingerichtet" -- zwei
// verschiedene Aussagen, zwei verschiedene Texte.
await page.route('**/api/fahrzeug_uebernahme_liste.php**', route =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', eingerichtet: true, eintraege: [] }) }));
await page.evaluate(() => aeLadeUebernahmen());
await page.waitForTimeout(150);
check('KRITISCH: keine Übernahme im Zeitraum sagt das explizit',
  (await page.textContent('#aeInhalt')).includes('Im gewählten Zeitraum liegt keine Fahrzeugübernahme vor.'));

await page.route('**/api/fahrzeug_uebernahme_liste.php**', route =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', eingerichtet: false, eintraege: [] }) }));
await page.evaluate(() => aeLadeUebernahmen());
await page.waitForTimeout(150);
check('KRITISCH: fehlende Einrichtung sagt das explizit -- nicht dieselbe Meldung wie ein leerer Zeitraum',
  (await page.textContent('#aeInhalt')).includes('noch nicht eingerichtet'));

// ══════════ ZURUECK ZU EINEM UNVERDRAHTETEN REITER: KEIN HAENGENBLEIBEN
await klick('#ae-tab-ereignisse');
await page.waitForTimeout(100);
check('"Ereignisse" zeigt ebenfalls den bleibenden Hinweis',
  (await page.textContent('#aeInhalt')).includes('Ereignisse folgt später'));
check('Der Reiter "Ereignisse" ist jetzt aktiv, "Rundgangerledigung" nicht mehr',
  await page.evaluate(() => {
    const a = document.getElementById('ae-tab-ereignisse'), b = document.getElementById('ae-tab-erledigung');
    return !!a && !!b && a.classList.contains('aktiv') && !b.classList.contains('aktiv');
  }));
// Genau EINE Kachel ist aktiv -- zwei hervorgehobene wären zwei Antworten
// auf die Frage, wo man steht.
check('KRITISCH: immer genau eine Kachel ist hervorgehoben',
  await page.evaluate(() => document.querySelectorAll('#aeReiter .rdkr-tab.aktiv').length === 1));

// Ausdrückliche Vorgabe des Projektinhabers zu den ursprünglichen sieben
// Kacheln: „bitte die Kacheln wie gewünscht auf einer Ebene!" (ENT-326) --
// die Reihe brach damals um, weil sie 1401 px brauchte und die Lesebreite
// nach Abzug der Ränder nur 1388 px liess. Die sieben stehen bei dieser
// Fensterbreite weiterhin auf einer Ebene; erst die achte, mit ENT-346
// hinzugekommene Kachel bricht in eine zweite Zeile um -- gemessen und
// geprüft, statt anzunehmen, dass "eine Ebene" für acht genauso gilt wie
// für sieben. Der Umbruch selbst ist kein Mangel: Er reiht sich links
// unter die erste Zeile ein, statt irgendwo mittendrin zu brechen oder
// über den Rand zu laufen (nächste beide Prüfungen).
check('KRITISCH: die ersten sieben Kacheln stehen weiterhin auf einer Ebene',
  await page.evaluate(() => {
    const t = [...document.querySelectorAll('#aeReiter .rdkr-tab')];
    return t.length === 8
      && new Set(t.slice(0, 7).map(b => Math.round(b.getBoundingClientRect().top))).size === 1;
  }));
check('KRITISCH: die achte Kachel ("Fahrzeugübernahmen") bricht sauber in eine eigene Zeile um',
  await page.evaluate(() => {
    // t[7].getBoundingClientRect() auf einer fehlenden achten Kachel wuerde
    // den ganzen Lauf mit einem Absturz beenden statt rot zu werden -- die
    // Laenge wird darum zuerst geprueft, nicht erst beim Zugriff bemerkt.
    const t = [...document.querySelectorAll('#aeReiter .rdkr-tab')];
    if (t.length !== 8) { return false; }
    const ersteZeile = Math.round(t[0].getBoundingClientRect().top);
    const achte = t[7].getBoundingClientRect();
    return Math.round(achte.top) > ersteZeile
      && Math.round(achte.left) === Math.round(t[0].getBoundingClientRect().left);
  }));
// Die Reihe darf dafür breit werden, die Liste darunter nicht: Eine Karte
// mit vier kurzen Zeilen über die ganze Fensterbreite schiebt den Status-Chip
// so weit vom Text weg, dass er nicht mehr dazugehört.
check('KRITISCH: die Liste bleibt trotzdem auf Lesebreite',
  await page.evaluate(() => {
    const i = document.getElementById('aeInhalt').getBoundingClientRect();
    const r = document.getElementById('aeReiter').getBoundingClientRect();
    return i.width > 400 && i.width <= 1000 && r.width > i.width;
  }));
check('KRITISCH: die Kachelreihe steht bündig zum Inhalt darunter, nicht mittig',
  await page.evaluate(() => {
    const tab = document.querySelector('#aeReiter .rdkr-tab');
    const inhalt = document.getElementById('aeInhalt');
    return !!tab && !!inhalt
      && Math.abs(tab.getBoundingClientRect().left - inhalt.getBoundingClientRect().left) <= 2;
  }));
// Eine Karte mit vier kurzen Zeilen über die volle Fensterbreite schiebt den
// Status-Chip so weit vom Text weg, dass er nicht mehr dazugehört.
check('KRITISCH: kein Seiten-Scroll am Desktop',
  await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
await page.screenshot({ path: `${OUT}/ae-01-desktop.png` });

// ══════════ HANDY (CLAUDE.md: jede Aenderung zusaetzlich am Handy pruefen)
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(200);
check('KRITISCH: kein Seiten-Scroll bei 390px', await page.evaluate(() =>
  document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
// Die Kachelreihe bricht auf dem Handy um, statt zu schrumpfen oder aus
// dem Bild zu laufen -- gemessen am gerenderten Zustand.
check('KRITISCH: alle acht Kacheln bleiben auf dem Handy sichtbar und im Bild',
  await page.evaluate(() => {
    const breite = document.documentElement.clientWidth;
    return [...document.querySelectorAll('#aeReiter .rdkr-tab')].every(b => {
      const r = b.getBoundingClientRect();
      return b.getClientRects().length && r.left >= -1 && r.right <= breite + 1;
    });
  }));
check('KRITISCH: sie stehen dabei in mehreren Zeilen, nicht in einer gequetschten',
  await page.evaluate(() => {
    const oben = [...document.querySelectorAll('#aeReiter .rdkr-tab')]
      .map(b => Math.round(b.getBoundingClientRect().top));
    return new Set(oben).size > 1;
  }));
check('KRITISCH: jede Kachel ist auf dem Handy mindestens 44 px hoch (CLAUDE.md)',
  await page.evaluate(() => [...document.querySelectorAll('#aeReiter .rdkr-tab')].every(b => b.getBoundingClientRect().height >= 44)));
await klick('#ae-tab-erledigung');
await page.waitForTimeout(150);
check('Der gewaehlte Reiter laedt auch auf dem Handy', (await page.textContent('#aeInhalt')).includes('Im gewählten Zeitraum liegt kein Rundgang vor.'));
await page.screenshot({ path: `${OUT}/ae-02-mobil.png` });

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
