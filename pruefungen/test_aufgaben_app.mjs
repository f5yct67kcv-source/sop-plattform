// Aufgaben je Kontrollpunkt in der App (ENT-304).
//
// Katalog und Verknuepfung stammen aus ENT-302 (Verwaltungsseite, parallele
// Sitzung: objekt_aufgabe / kontrollpunkt_aufgabe). Hier werden sie zum
// ersten Mal dem gezeigt, der sie ausfuehrt. Vom Projektinhaber ausdruecklich
// "rein visuell, damit der Mitarbeiter sieht, welche Aufgabe am Objekt
// bestehen" -- kein Abhaken, das ist ein eigener Schritt.
//
// Die drei Punkte, auf die es hier ankommt:
//  1. Die Aufgaben sind nach Kontrollpunkt GRUPPIERT. "Tuere verschliessen"
//     heisst an der Tiefgarage etwas anderes als am Haupteingang.
//  2. Ein Punkt OHNE Aufgabe bleibt sichtbar und sagt das auch. Sonst liesse
//     sich nicht unterscheiden, ob er keine Aufgabe hat oder in dieser Runde
//     gar nicht vorkommt (CLAUDE.md: "unbekannt" darf nie wie "keine"
//     aussehen).
//  3. Der Hinweis sagt, dass nichts abgehakt wird -- niemand soll auf einen
//     Haken warten, den es noch nicht gibt.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const tag = n => iso(new Date(Date.now() + n * 864e5));

// ══════════ DER ENDPUNKT, STATISCH GEPRÜFT ════════════════════════════
const UEB = readFileSync(`${WURZEL}/backend/api/mein_rundgang_uebersicht.php`, 'utf8');
check('KRITISCH: die Vorschau liefert die Aufgaben je Kontrollpunkt mit',
  /FROM kontrollpunkt_aufgabe ka/.test(UEB) && /JOIN objekt_aufgabe a ON a\.id = ka\.aufgabe_id/.test(UEB));
// ENT-302: Entfernt wird ueber aktiv = 0, nie per DELETE -- damit ein
// spaeterer Nachweis nicht mitgerissen wird. Wer die inaktiven trotzdem
// ausliefert, laesst Waechter Arbeit tun, die die Verwaltung abgeschafft hat.
check('KRITISCH: entfernte (inaktive) Aufgaben werden NICHT ausgeliefert',
  /JOIN objekt_aufgabe a ON a\.id = ka\.aufgabe_id AND a\.aktiv = 1/.test(UEB));
check('KRITISCH: die Punkt-Ids gehen als Platzhalter in die Abfrage, nicht als eingesetzter Text',
  /array_fill\(0, count\(\$ids\), '\?'\)/.test(UEB) && /\$aStmt->execute\(\$ids\)/.test(UEB));
check('Fehlt die Tabelle noch, fällt die ganze Rundgang-Vorschau nicht aus',
  /hat_tabelle\(\$pdo, 'kontrollpunkt_aufgabe'\)/.test(UEB));
// Klassische Falle bei foreach mit Referenz: ohne unset() zeigt $kpZeile
// weiter auf den letzten Eintrag, und die naechste Schleife ueberschreibt ihn.
check('KRITISCH: die Referenz aus der Zuordnungsschleife wird aufgelöst',
  /foreach \(\$kontrollpunkte as &\$kpZeile\)[\s\S]{0,200}unset\(\$kpZeile\)/.test(UEB));

// ══════════ ANZEIGE IN DER APP ════════════════════════════════════════
const SCHICHTEN = { status: 'ok', von: tag(-30), bis: tag(90), schichten: [
  { id: 71, kunde_name: 'Musterliegenschaften AG', titel: 'Nachtwache', strasse: 'Musterweg 4', ort: '9999 Musterdorf',
    einsatzart: 'Revierdienst', sparte: 'sicherheit', datum: tag(-1), von: '20:00:00', bis: '06:00:00',
    status: 'bestaetigt', bemerkung: null, zusage: 'zugesagt', objekt_name: 'Musterobjekt Industrie', objekt_id: 7,
    hat_kontrollpunkte: true, im_team: 1 },
]};
const PROFIL = { status: 'ok', monat: { anzahl: 0, stunden: 0 }, profil: {
  name: 'm.muster', ist_admin: false, personalnummer: 'P-001',
  vorname: 'Max', nachname: 'Muster', erstellt_am: tag(-30) + ' 10:00:00' } };

const objekt = { id: 7, name: 'Musterobjekt Industrie', strasse: 'Musterweg 4', ort: '9999 Musterdorf',
  kanton: 'SO', bemerkung: null };

const UEBERSICHT = {
  901: { status: 'ok',
    vorlage: { id: 901, name: 'Runde mit Aufgaben', fenster_von: null, fenster_bis: null },
    objekt, kunde_name: 'Musterliegenschaften AG',
    kontrollpunkte: [
      { id: 1, bezeichnung: 'Haupteingang', typ: 'geofence', aufgaben: [
        { id: 11, bezeichnung: 'Türe verschliessen', information: 'Beide Flügel, Riegel prüfen.' },
        { id: 12, bezeichnung: 'Licht löschen', information: null },
      ]},
      // Punkt OHNE Aufgabe -- muss sichtbar bleiben und das auch sagen.
      { id: 2, bezeichnung: 'Tiefgarage', typ: 'nfc', aufgaben: [] },
      { id: 3, bezeichnung: 'Tor Nord', typ: 'geofence', aufgaben: [
        { id: 11, bezeichnung: 'Türe verschliessen', information: 'Beide Flügel, Riegel prüfen.' },
      ]},
    ],
    ansprechpartner: [], laufend: null, zentrale: null },
  902: { status: 'ok',
    vorlage: { id: 902, name: 'Runde ohne Aufgaben', fenster_von: null, fenster_bis: null },
    objekt, kunde_name: 'Musterliegenschaften AG',
    kontrollpunkte: [{ id: 4, bezeichnung: 'Eingang Süd', typ: 'geofence', aufgaben: [] }],
    ansprechpartner: [], laufend: null, zentrale: null },
};

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));

await page.route('**/api/**', route => {
  const url = new URL(route.request().url());
  const p = url.pathname.split('/api/')[1];
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'm.muster', ist_admin: false });
  if (p.includes('meine_schichten')) return send(SCHICHTEN);
  if (p.includes('mein_profil')) return send(PROFIL);
  if (p.includes('rapport_list')) return send({ status: 'ok', rapporte: [] });
  if (p.includes('mein_rundgang_offen')) return send({ status: 'ok', rundgang: null });
  if (p.includes('mein_rundgang_uebersicht')) {
    return send(UEBERSICHT[Number(url.searchParams.get('vorlage_id'))] || { status: 'error', message: 'unbekannt' });
  }
  if (p.includes('mein_rundgang_vorlagen_alle')) return send({ status: 'ok', vorlagen: [
    { id: 901, name: 'Runde mit Aufgaben', objekt_id: 7, objekt_name: 'Musterobjekt Industrie',
      kunde_name: 'Musterliegenschaften AG', fenster_von: null, fenster_bis: null },
    { id: 902, name: 'Runde ohne Aufgaben', objekt_id: 7, objekt_name: 'Musterobjekt Industrie',
      kunde_name: 'Musterliegenschaften AG', fenster_von: null, fenster_bis: null }] });
  return send({ status: 'ok' });
});

await page.goto(`file://${WURZEL}/app.html`);
await page.fill('#gName', 'm.muster'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('.app.on');
await page.waitForTimeout(400);

const oeffne = async name => {
  await page.evaluate(() => { blattZu(); rgSeiteZu(); });
  await page.evaluate(() => rundgangUebersichtOeffnen());
  await page.waitForTimeout(300);
  await page.click(`#blBody button:has-text("${name}")`);
  await page.waitForTimeout(400);
};

await oeffne('Runde mit Aufgaben');
check('KRITISCH: "Aufgaben anzeigen" steht in den Funktionen',
  await page.isVisible('#rgsModAufgaben')
  && (await page.textContent('#rgsModAufgaben')).includes('Aufgaben anzeigen'));
// Die Zahl zaehlt VERKNUEPFUNGEN, nicht Katalogeintraege: "Tuere
// verschliessen" haengt an zwei Punkten und ist zweimal zu tun.
check('KRITISCH: die Zahl nennt die Verknüpfungen (3), nicht die verschiedenen Aufgaben (2)',
  (await page.textContent('#rgsModAufgaben .rgs-modul-zahl')) === '3');
check('Sie steht direkt nach den Kontrollpunkten, vor "Ereignis erfassen" (gemessen)',
  await page.evaluate(() => {
    const y = s => document.querySelector(s).getBoundingClientRect().top;
    return y('#rgsModKp') < y('#rgsModAufgaben') && y('#rgsModAufgaben') < y('#rgsModEreignis');
  }));
check('Die Funktion ist mindestens 44px hoch (CLAUDE.md)',
  await page.evaluate(() => document.getElementById('rgsModAufgaben').getBoundingClientRect().height >= 44));

await page.click('#rgsModAufgaben');
await page.waitForTimeout(300);
check('KRITISCH: der Tipp öffnet eine eigene Unterseite',
  (await page.textContent('#rgsTitel')) === 'Aufgaben');
check('KRITISCH: der Hinweis sagt, dass noch nichts abgehakt wird',
  await page.isVisible('#afHinweis')
  && (await page.textContent('#afHinweis')).includes('Abgehakt wird noch nichts'));

const gruppen = await page.evaluate(() => [...document.querySelectorAll('.af-punkt')].map(el => ({
  bez: el.querySelector('.af-punkt-bez').textContent,
  zahl: el.querySelector('.af-punkt-zahl')?.textContent || null,
  ohne: el.classList.contains('ohne'),
  hoehe: el.getBoundingClientRect().height,
  mitte: getComputedStyle(el.querySelector('.af-punkt-kopf')).textAlign,
  aufgaben: [...el.querySelectorAll('.af-bez')].map(a => a.textContent),
  infos: [...el.querySelectorAll('.af-info')].map(a => a.textContent),
  ohne: el.querySelector('.af-ohne')?.textContent || null,
  y: el.getBoundingClientRect().top,
})));
check('KRITISCH: die Aufgaben sind nach Kontrollpunkt gruppiert, alle Punkte der Runde',
  gruppen.length === 3 && gruppen[0].bez === 'Haupteingang'
  && gruppen[1].bez === 'Tiefgarage' && gruppen[2].bez === 'Tor Nord');

// Netz: Fehlt eine Gruppe, haengt alles Folgende daran. Ohne diese Weiche
// stuerzt die Suite ab, statt die verletzte Aussage zu benennen -- genau der
// Mangel, den ENT-302 bei der eigenen Gegenprobe festgehalten hat. Beim
// Gegenprobieren hier ("Punkte ohne Aufgabe ausgeblendet") ist er sofort
// wieder aufgetreten.
if (gruppen.length !== 3) {
  bad.push('KRITISCH: es fehlen Gruppen -- die folgenden Aussagen liessen sich nicht mehr pruefen '
    + `(erwartet 3, gefunden ${gruppen.length})`);
} else {
check('KRITISCH: die Reihenfolge der Punkte bleibt die der Runde (gemessen)',
  gruppen[0].y < gruppen[1].y && gruppen[1].y < gruppen[2].y);
check('KRITISCH: die Aufgaben stehen beim richtigen Punkt',
  gruppen[0].aufgaben.join('|') === 'Türe verschliessen|Licht löschen'
  && gruppen[2].aufgaben.join('|') === 'Türe verschliessen');
check('KRITISCH: ein Punkt OHNE Aufgabe bleibt sichtbar und sagt das ausdrücklich',
  gruppen[1].ohne && gruppen[1].aufgaben.length === 0
  && (gruppen[1].ohne || '').includes('keine Aufgabe'));
check('Ein Punkt ohne Aufgabe trägt keine Zahl -- eine 0 sähe aus wie ein Zähler',
  gruppen[1].zahl === null && gruppen[0].zahl === '2');
// Erste Fassung hiess der Zusatz ".leer" -- und .leer ist bereits eine
// globale Klasse dieser App (text-align:center, padding:46px 22px) fuer
// ganzseitige Leerzustaende. Der Block war dadurch doppelt so hoch und der
// Text stand mittig. Im Quelltext unsichtbar; darum hier GEMESSEN.
check('KRITISCH: der Punkt ohne Aufgabe ist nicht höher als der mit zwei Aufgaben',
  gruppen[1].hoehe < gruppen[0].hoehe);
check('KRITISCH: sein Text steht links wie überall sonst, nicht mittig',
  gruppen[1].mitte !== 'center');
check('KRITISCH: die Erläuterung zur Aufgabe wird mitgezeigt, nicht nur der Titel',
  gruppen[0].infos.some(t => t.includes('Riegel prüfen')));
check('Eine Aufgabe ohne Erläuterung erzeugt keine leere Zeile',
  gruppen[0].infos.length === 1);
check('KRITISCH: die Bezeichnung steht ÜBER der Erläuterung, nicht darunter (gemessen)',
  await page.evaluate(() => {
    const p = document.querySelector('.af-punkt');
    return p.querySelector('.af-bez').getBoundingClientRect().top
      < p.querySelector('.af-info').getBoundingClientRect().top;
  }));
}

check('KRITISCH: nichts ist anklickbar -- die Seite ist rein lesend (rein visuell)',
  await page.evaluate(() => document.querySelectorAll('#rgsBody button, #rgsBody input, #rgsBody a').length === 0));
check('KRITISCH: kein waagrechter Seiten-Scroll bei 390px', await page.evaluate(() =>
  document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
await page.screenshot({ path: `${OUT}/aufgaben-01-mobil.png` });

// ══════════ ZURÜCK ════════════════════════════════════════════════════
await page.click('#rgsZurueck');
await page.waitForTimeout(300);
check('KRITISCH: der Zurück-Pfeil führt auf die Übersicht, nicht aus der Seite heraus',
  await page.isVisible('#rgSeite') && await page.isVisible('#rgsModAufgaben'));

// ══════════ RUNDE OHNE AUFGABEN ═══════════════════════════════════════
await oeffne('Runde ohne Aufgaben');
check('Ohne verknüpfte Aufgabe steht die Zahl auf 0 und ist als leer gekennzeichnet',
  (await page.textContent('#rgsModAufgaben .rgs-modul-zahl')) === '0'
  && await page.evaluate(() => document.querySelector('#rgsModAufgaben .rgs-modul-zahl').classList.contains('leer')));
await page.click('#rgsModAufgaben');
await page.waitForTimeout(300);
check('KRITISCH: die Unterseite erklärt die Leere und sagt, wer sie füllt',
  await page.isVisible('#afLeer')
  && (await page.textContent('#afLeer')).includes('Verwaltung'));

// ══════════ DESKTOP ═══════════════════════════════════════════════════
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(250);
await oeffne('Runde mit Aufgaben');
await page.click('#rgsModAufgaben');
await page.waitForTimeout(300);
check('Am Desktop bleibt die Liste innerhalb der App-Breite',
  await page.evaluate(() => {
    const a = document.querySelector('.af-punkt').getBoundingClientRect();
    const s = document.getElementById('rgSeite').getBoundingClientRect();
    return a.width <= s.width && s.width <= 561;
  }));
check('KRITISCH: am Desktop kein waagrechter Seiten-Scroll', await page.evaluate(() =>
  document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
await page.screenshot({ path: `${OUT}/aufgaben-02-desktop.png` });

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
