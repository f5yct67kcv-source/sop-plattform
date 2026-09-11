// Auswertung > Arbeitsergebnisse > "Wachbuch" (ENT-480).
//
// Die chronologische Chronik des Revierdienstes: vier Arten von Vorgängen
// (Kontrollpunkt erfasst, Rundgang erledigt/abgebrochen, Aufgabe beantwortet,
// Ereignis gemeldet) in EINER Zeitleiste, nach Tagen gruppiert.
//
// Was hier NICHT geprüft wird: das Zusammenführen, Sortieren und Kappen im
// Server. Das läuft echt gegen SQLite in pruef_wachbuch.php -- diese Suite
// täuscht die Serverantwort vor und käme an einer SQL-Regel nie vorbei.
// Hier geht es um die Oberfläche: welcher Satz bei welchem Status steht,
// wohin die Verweise führen, was das Seitenfenster zeigt, und ob das
// Gemessene mit dem Gemeinten übereinstimmt.
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const SEITE = `file://${WURZEL}/dashboard.html`;
const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);
async function klick(sel) {
  try { await page.click(sel, { timeout: 3000 }); return true; }
  catch (e) { bad.push('nicht anklickbar: ' + sel); return false; }
}

// Relative Daten statt fester Werte -- ein festes Datum nahe beim heutigen
// Tag kippt beim Datumswechsel (CLAUDE.md, test_datumsfest.mjs).
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const vorTagen = n => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };
const T0 = vorTagen(0), T1 = vorTagen(1);
const dmy = t => t.split('-').reverse().join('.');

// Erfundene Namen, keine echten Kunden oder Personen (CLAUDE.md).
const rahmen = {
  kunde_id: 7, kunde_name: 'Muster Liegenschaften AG',
  objekt_id: 4, objekt_name: 'Testliegenschaft Nord',
  rundgang_id: 201, rundgang_name: 'Schliessrunde',
  fenster_von: '22:00:00', fenster_bis: '06:00:00',
  einsatz_id: 101, einsatz_titel: 'Nachtdienst', person: 'Muster, Erika',
};
const EINTRAEGE = [
  // Neuester zuoberst -- so liefert es der Server, und die Oberflaeche
  // sortiert bewusst nicht nach.
  { ...rahmen, art: 'rundgang', id: 'rundgang-202', quelle_id: 202, zeit: `${T0} 02:40:00`,
    status: 'abgebrochen', rundgang_id: 202, rohzeit_start: `${T0} 02:00:00`,
    rohzeit_ende: null, pause_minuten: 0, abbruch_grund: 'notfall',
    text: 'Alarm am Nachbarobjekt', scans_anzahl: 2, hat_foto: false,
    uebermittelt_am: null },
  { ...rahmen, art: 'ereignis', id: 'ereignis-501', quelle_id: 501, zeit: `${T1} 23:10:00`,
    status: null, bezeichnung: 'Feststellung', vorfall_am: `${T1} 22:50:00`,
    text: 'Tür stand offen', hat_foto: true, uebermittelt_am: `${T1} 23:11:00` },
  { ...rahmen, art: 'rundgang', id: 'rundgang-201', quelle_id: 201, zeit: `${T1} 22:40:00`,
    status: 'abgeschlossen', rohzeit_start: `${T1} 22:05:00`,
    rohzeit_ende: `${T1} 22:40:00`, pause_minuten: 4, abbruch_grund: null,
    text: null, scans_anzahl: 3, hat_foto: false, uebermittelt_am: null },
  { ...rahmen, art: 'aufgabe', id: 'aufgabe-401', quelle_id: 401, zeit: `${T1} 22:22:00`,
    status: 'nicht_moeglich', bezeichnung: 'Licht löschen', punkt_name: 'Keller',
    punkt_id: 12, text: 'Schalter defekt', hat_foto: false,
    uebermittelt_am: `${T1} 22:23:00` },
  // Ersatzscan mit langer Offline-Phase: erfasst um 22:20, uebermittelt erst
  // am Morgen. Genau der Fall, den ENT-132 sichtbar halten will.
  { ...rahmen, art: 'scan', id: 'scan-302', quelle_id: 302, zeit: `${T1} 22:20:00`,
    status: 'ersatzscan', punkt_name: 'Keller', punkt_id: 12,
    text: 'Chip defekt', hat_foto: true, uebermittelt_am: `${T0} 06:40:00` },
  { ...rahmen, art: 'scan', id: 'scan-301', quelle_id: 301, zeit: `${T1} 22:05:00`,
    status: 'bestaetigt', punkt_name: 'Eingang', punkt_id: 11,
    text: null, hat_foto: false, uebermittelt_am: `${T1} 22:06:00` },
  // Ein Scan auf einen inzwischen entfernten Kontrollpunkt, ohne Kunden-
  // kennung: der Nachweis bleibt, der Verweis kann es nicht.
  { ...rahmen, art: 'scan', id: 'scan-300', quelle_id: 300, zeit: `${T1} 21:55:00`,
    status: 'nicht_verfuegbar', punkt_name: null, punkt_id: null,
    kunde_id: null, text: null, hat_foto: false,
    uebermittelt_am: `${T1} 21:56:00` },
];
const WACHBUCH = {
  status: 'ok', eintraege: EINTRAEGE, gezeigt: EINTRAEGE.length, gesamt: EINTRAEGE.length,
  gekuerzt: false, grenze: 400,
  je_art: { scan: 3, rundgang: 2, aufgabe: 1, ereignis: 1 },
  quellen: { scans: 'ok', runden: 'ok', aufgaben: 'ok', ereignisse: 'ok' },
};

let calls = [];
let antwort = WACHBUCH;
// Ein WIRKLICHES PNG. Eine JSON-Antwort mit Bildkopfzeile wuerde als <img>
// stumm nicht dekodieren -- und die Pruefung "ein Bild ist da" bliebe gruen,
// obwohl nichts zu sehen ist. Gemessen wird darum an naturalWidth, und dafuer
// muss das Bild echt sein.
//
// 400x300, also GROESSER als die Huelle: Ein 4x4-Bild wuerde nie gedeckelt
// und liesse die Frage offen, ob der Deckel ueberhaupt greift. Ein echtes
// Handyfoto ist immer groesser.
const PNG_BREIT = 400, PNG_HOCH = 300;
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAZAAAAEsCAIAAABi1XKVAAAC90lEQVR42u3UQQ0AAAgDsWmafwHIQgekSRXc4zItwAmRADAsAMMCDAvAsAAMCzAsAMMCMCzAsAAMC8CwAMMCMCwAwwIMC8CwAAwLMCwAwwIwLMCwAAwLwLAAwwIwLADDAgwLwLAAw1IBMCwAwwIMC8CwAAwLMCwAwwIwLMCwAAwLwLAAwwIwLADDAgwLwLAADAswLADDAjAswLAADAvAsADDAjAsAMMCDAvAsADDUgEwLADDAgwLwLAADAswLADDAjAswLAADAvAsADDAjAsAMMCDAvAsAAMCzAsAMMCMCzAsAAMC8CwAMMCMCwAwwIMC8CwAMMCMCwAwwIMC8CwAAwLMCwAwwIwLMCwAAwLwLAAwwIwLADDAgwLwLAADAswLADDAjAswLAADAvAsADDAjAsAMMCDAvAsADDAjAsAMMCDAvAsAAMCzAsAMMCMCzAsAAMC8CwAMMCMCwAwwIMC8CwAAwLMCwAwwIwLMCwAAwLwLAAwwIwLADDAgwLwLAAwwIwLADDAgwLwLAADAswLADDAjAswLAADAvAsADDAjAsAMMCDAvAsAAMCzAsAMMCMCzAsAAMC8CwAMMCMCwAwwIMC8CwAMMCMCwAwwIMC8CwAAwLMCwAwwIwLMCwAAwLwLAAwwIwLADDAgwLwLAADAswLADDAjAswLAADAvAsADDAjAsAMMCDAvAsADDAjAsAMMCDAvAsAAMCzAsAMMCMCzAsAAMC8CwAMMCMCwAwwIMC8CwAAwLMCwAwwIwLMCwAAwLwLAAwwIwLADDAgwLwLAAwwIwLADDAgwLwLAADAswLADDAjAswLAADAvAsADDAjAsAMMCDAvAsAAMCzAsAMMCMCzAsAAMC8CwAMMCMCzAsCQADAvAsADDAjAsAMMCDAvAsAAMCzAsAMMCMCzAsAAMC8CwAMMCMCwAwwIMC8CwAAwLMCwAwwIwLMCwAAwLwLAAwwIwLMCwVAAMC8CwAMMCMCwAwwIMC8CwAAwLMCwAwwIwLOCzBf0vcSw0UxrUAAAAAElFTkSuQmCC',
  'base64');
// Die Ereignisse, die rundgang_detail.php zur Runde meldet. Veraenderbar,
// weil dieselbe Suite die Runde mit und ohne Foto ansieht.
let rundgangEreignisse = [];
async function mock(p) {
  await p.route('**/api/*', route => {
    const req = route.request();
    const u = new URL(req.url());
    const path = u.pathname.split('/api/')[1];
    calls.push({ path, query: Object.fromEntries(u.searchParams) });
    const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (path.includes('login')) return send({ status: 'ok', token: 't', name: 'adrian', ist_admin: true });
    if (path.includes('dashboard_stats')) return send({ status: 'ok', kpi: {}, verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [] });
    if (path.includes('wachbuch_liste')) return send(antwort);
    if (path.includes('ereignis_foto') || path.includes('rundgang_scan_foto')) {
      return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    }
    if (path.includes('kunden_list')) return send({ status: 'ok', kunden: [
      { id: 7, name: 'Muster Liegenschaften AG', kundennummer: 'K-0007', aktiv: 1,
        art: 'firma', kontaktwege: [], personen: [] }] });
    if (path.includes('objekt_list')) return send({ status: 'ok', objekte: [
      { id: 4, kunde_id: 7, kunde_name: 'Muster Liegenschaften AG', name: 'Testliegenschaft Nord',
        strasse: 'Musterweg 1', ort: 'Musterhausen', kanton: 'SO', einsatzart: 'Revierdienst',
        sparte: 'sicherheit', aktiv: 1 }] });
    if (path.includes('rundgang_detail')) return send({ status: 'ok', rundgang: {
      id: 201, status: 'abgeschlossen', datum: T1, objekt_name: 'Testliegenschaft Nord',
      kunde_name: 'Muster Liegenschaften AG', vorlage_name: 'Schliessrunde',
      vorname: 'Erika', nachname: 'Muster', rohzeit_start: `${T1} 22:05:00`,
      rohzeit_ende: `${T1} 22:40:00`, pause_minuten: 4,
      fortschritt: { gesamt: 3, bestaetigt: 3, erledigt: 3, ersatzscan: 1 },
      kontrollpunkte: [], ereignisse: rundgangEreignisse } });
    if (path.includes('pensen.php')) return send({ status: 'ok', jahr: 2026, mitarbeiter: [] });
    if (path.includes('mitarbeiter_list')) return send({ status: 'ok', mitarbeiter: [] });
    return send({ status: 'ok' });
  });
}

const browser = await chromium.launch({ executablePath: EXE });
// Dieselbe schmale Desktop-Breite wie test_arbeitsergebnisse.mjs: Auf einem
// breiteren Fenster zu prüfen wäre bequemer und wertloser.
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));

await mock(page);
await page.goto(SEITE);
await page.evaluate(() => localStorage.clear());
await page.goto(SEITE);
await page.fill('#gName', 'adrian'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#kpiGrid .kpi-val');
// Den Weg gehen, den auch ein Mensch geht: Gruppe aufklappen, Menuepunkt
// anklicken. Als eigene Funktion, weil die Suite ihn mehrfach braucht -- wer
// von der Objekt- oder Kundenansicht zurueckkommt, findet die Gruppe wieder
// zugeklappt, und ein Klick auf einen unsichtbaren Knopf beweist nichts.
async function zumWachbuch() {
  await page.evaluate(() => {
    if (!document.getElementById('navg-kontrolle').classList.contains('offen')) {
      document.getElementById('nav-kontrolle').click();
    }
  });
  await page.waitForTimeout(150);
  await klick('#nav-kontrolle-arbeitsergebnisse');
  await page.waitForSelector('.wb-zeile', { timeout: 4000 })
    .catch(() => bad.push('Die Zeitleiste erscheint nicht'));
}

calls = [];
await zumWachbuch();

// ══════════════ DER ENDPUNKT UND SEIN ZEITRAUM
const ruf = calls.find(c => c.path.includes('wachbuch_liste')) || { query: {} };
check('KRITISCH: das Wachbuch ruft wachbuch_liste.php auf', !!calls.find(c => c.path.includes('wachbuch_liste')));
check('KRITISCH: Vorgabe ist der zurückliegende Monat bis heute (wie Auslagenersatz, ENT-045)',
  !!ruf.query.von && !!ruf.query.bis && ruf.query.von !== ruf.query.bis);
check('Ohne gesetzten Filter wird keine Art mitgeschickt', ruf.query.arten === undefined);

// ══════════════ NACH TAGEN GRUPPIERT, NEUESTE ZUOBERST
const tage = await page.$$eval('.wb-tag b', els => els.map(e => e.textContent.trim()));
check('KRITISCH: die Vorgänge stehen unter Tagesüberschriften',
  tage.length === 2 && tage[0] === dmy(T0) && tage[1] === dmy(T1));
check('KRITISCH: der neueste Tag steht zuoberst', tage[0] === dmy(T0));
const zeiten = await page.$$eval('.wb-zeile .wb-zeit b', els => els.map(e => e.textContent.trim()));
check('KRITISCH: innerhalb des Tages läuft die Zeit abwärts -- die Oberfläche '
  + 'sortiert die Serverantwort nicht um',
  JSON.stringify(zeiten) === JSON.stringify(['02:40', '23:10', '22:40', '22:22', '22:20', '22:05', '21:55']));
// Zwei Tage, sieben Vorgänge -- die Zahl am Tagestrenner zählt Vorgänge, und
// zwar nur die dieses Tages.
const tagZahl = await page.$$eval('.wb-tag span', els => els.map(e => e.textContent.trim()));
check('Jeder Tag nennt, wie viele Vorgänge auf ihn entfallen',
  tagZahl[0] === '1 Vorgang' && tagZahl[1] === '6 Vorgänge');

// ══════════════ DIE AUSSAGE STEHT IM SATZ, NICHT NUR IN DER FARBE
const saetze = await page.$$eval('.wb-zeile .wb-satz', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
check('KRITISCH: ein bestätigter Scan sagt "erfasst"',
  saetze.some(t => t === 'Muster, Erika hat den Kontrollpunkt Eingang erfasst.'));
check('KRITISCH: ein nicht verfügbarer Punkt sagt NICHT "erfasst" -- das wäre '
  + 'eine falsche Aussage, auch für den, der die Farbe nicht sieht',
  saetze.some(t => t.includes('als nicht verfügbar gemeldet'))
  && !saetze.some(t => t.includes('nicht verfügbar') && t.includes('erfasst.')));
check('KRITISCH: ein Ersatzscan sagt "per Ersatzscan belegt", nicht "erfasst"',
  saetze.some(t => t.includes('per Ersatzscan belegt')));
// Der Nachweis bleibt, der Name des Punktes nicht. Geprüft wird die
// Aussage, nicht der Wortlaut: Der Satz muss sagen, DASS der Punkt entfernt
// wurde -- und er muss ein Satz bleiben. Bis zum 08.09.2026 stand der Ersatz
// an der Stelle des ganzen Satzteils statt an der des Namens, und der Satz
// las sich „den Kontrollpunkt einen inzwischen entfernten Kontrollpunkt
// erfasst". Die alte Prüfung deckte nur den Fall ab, in dem das zufällig
// aufging.
check('KRITISCH: ein entfernter Kontrollpunkt wird benannt, nicht weggelassen',
  saetze.some(t => /inzwischen entfernt/.test(t)));
check('KRITISCH: der Satz bleibt dabei ein Satz -- "Kontrollpunkt" steht nur einmal darin',
  saetze.filter(t => /inzwischen entfernt/.test(t))
    .every(t => (t.match(/Kontrollpunkt/g) || []).length === 1));
check('KRITISCH: eine erledigte Runde und eine abgebrochene haben verschiedene Sätze',
  saetze.some(t => t.includes('hat den Rundgang Schliessrunde erledigt'))
  && saetze.some(t => t.includes('hat den Rundgang Schliessrunde abgebrochen')));
check('Eine nicht mögliche Aufgabe sagt das, statt als erledigt dazustehen',
  saetze.some(t => t.includes('hat die Aufgabe Licht löschen als nicht möglich gemeldet')));
check('Ein Ereignis nennt seine Art', saetze.some(t => t.includes('hat ein Ereignis gemeldet: Feststellung')));

// ══════════════ WAS SONST NOCH IN DER ZEILE STEHT
const inhalt = await page.textContent('#aeWbListe');
check('Der Grund eines Abbruchs steht in der Zeile, nicht erst im Seitenfenster',
  inhalt.includes('Alarm am Nachbarobjekt') && inhalt.includes('Grund: notfall'));
check('Eine erledigte Runde sagt, wie viele Punkte erfasst wurden -- mit Einheit',
  inhalt.includes('3 Kontrollpunkte erfasst'));
check('Das Zeitfenster der Vorlage steht dabei', inhalt.includes('Fenster 22:00–06:00'));
check('Der Vorfallzeitpunkt eines Ereignisses ergänzt den Erfassungszeitpunkt',
  inhalt.includes('Vorfall ' + dmy(T1) + ', 22:50'));
// ENT-132: geräteseitig erfasst, offline zwischengespeichert. Wer die späte
// Übermittlung nicht sieht, hält den Nachweis für zeitnah.
check('KRITISCH: eine lange Offline-Phase ist an der Zeile zu sehen',
  await page.evaluate(() => {
    const s = [...document.querySelectorAll('.wb-zeile')].find(z => z.dataset.wb === 'scan-302');
    const spaet = s && s.querySelector('.wb-zeit span.spaet');
    return !!spaet && spaet.textContent.includes('06:40');
  }));
// Erfasst am Vorabend, übermittelt am Morgen darauf: Ein blosses "06:40"
// unter der Tagesüberschrift des Vortages liest sich wie derselbe Tag.
check('KRITISCH: liegt die Übermittlung an einem anderen Tag, steht das Datum dabei',
  await page.evaluate(t => {
    const s = [...document.querySelectorAll('.wb-zeile')].find(z => z.dataset.wb === 'scan-302');
    const spaet = s && s.querySelector('.wb-zeit span.spaet');
    return !!spaet && spaet.textContent.includes(t);
  }, dmy(T0)));
check('Ein Verzug von Stunden wird als Stunden gesagt, nicht als 500 Minuten',
  await page.evaluate(() => {
    const s = [...document.querySelectorAll('.wb-zeile')].find(z => z.dataset.wb === 'scan-302');
    const t = s.querySelector('.wb-zeit span.spaet').getAttribute('title') || '';
    return t.includes('Std.') && !/\b\d{3,} Min\./.test(t);
  }));
check('KRITISCH: eine zeitnah übermittelte Zeile trägt diesen Hinweis NICHT -- '
  + 'sonst sagte er nichts mehr aus',
  await page.evaluate(() => {
    const s = [...document.querySelectorAll('.wb-zeile')].find(z => z.dataset.wb === 'scan-301');
    return !!s && !s.querySelector('.wb-zeit span.spaet');
  }));

// ══════════════ GEMESSEN, NICHT NACHGELESEN
check('KRITISCH: kein waagrechter Scroll im Inhalt',
  await page.evaluate(() => {
    const i = document.getElementById('aeInhalt');
    return i.scrollWidth <= i.clientWidth + 1;
  }));
check('KRITISCH: die Überschrift (der Pfad) steht ÜBER dem Wert (dem Satz), nicht darunter',
  await page.evaluate(() => {
    const z = document.querySelector('.wb-zeile');
    const p = z.querySelector('.wb-pfad').getBoundingClientRect();
    const s = z.querySelector('.wb-satz').getBoundingClientRect();
    return p.top < s.top && p.bottom <= s.top + 1;
  }));
check('Die Zeit steht rechts vom Satz, nicht darunter',
  await page.evaluate(() => {
    const z = document.querySelector('.wb-zeile');
    const s = z.querySelector('.wb-satz').getBoundingClientRect();
    const t = z.querySelector('.wb-zeit').getBoundingClientRect();
    return t.left >= s.right - 1;
  }));
check('Das Sinnbild der Zeile ist wirklich sichtbar und rund gezeichnet',
  await page.evaluate(() => {
    const i = document.querySelector('.wb-zeile .wb-ic');
    const r = i.getBoundingClientRect();
    return r.width >= 30 && Math.abs(r.width - r.height) < 2 && i.querySelector('svg');
  }));
// Vier Arten, vier erkennbare Farben -- gemessen an der tatsächlich
// gerenderten Farbe, nicht an einer Klasse allein: Eine CSS-Regel kann
// wirkungslos bleiben, ohne dass etwas kaputtgeht.
//
// Die Zeilen sind mit Absicht so gewählt, dass jede einen ANDEREN Status hat
// (bestätigt / erledigt / nicht möglich / ohne Status): Wären alle vier
// unbescholten, bliebe die Prüfung grün, auch wenn jeder Vorbehalt die
// Artfarbe überfärbt -- genau der Fehler, der beim Messen aufgefallen ist.
const wbFarbe = id => page.evaluate(i => {
  const z = [...document.querySelectorAll('.wb-zeile')].find(x => x.dataset.wb === i);
  return z ? getComputedStyle(z.querySelector('.wb-ic')).color : null;
}, id);
const artFarben = [await wbFarbe('scan-301'), await wbFarbe('rundgang-201'),
                   await wbFarbe('aufgabe-401'), await wbFarbe('ereignis-501')];
check('KRITISCH: die vier Arten sind an der gerenderten Farbe zu unterscheiden',
  artFarben.every(Boolean) && new Set(artFarben).size === 4);
// Die Abstufung trägt der Chip und der Satz, nicht das Sinnbild -- sonst
// sähen vier Arten mit Vorbehalt alle gleich aus.
check('KRITISCH: ein Vorbehalt färbt die Art NICHT um -- Ersatzscan und '
  + '"nicht verfügbar" behalten die Farbe des Kontrollpunkts',
  await wbFarbe('scan-302') === artFarben[0]
  && await wbFarbe('scan-300') === artFarben[0]);
// Die eine Ausnahme: die schwerste Stufe des Hauses (chip-x). Ein
// abgebrochener Rundgang darf nicht aussehen wie ein erledigter.
check('KRITISCH: ein abgebrochener Rundgang trägt nicht die Farbe eines erledigten',
  await wbFarbe('rundgang-202') !== artFarben[1]);
// Ein Verweis muss auch ohne Mauszeiger als solcher zu erkennen sein.
check('KRITISCH: ein verlinkter Name sieht anders aus als ein nicht verlinkter',
  await page.evaluate(() => {
    const mit = document.querySelector('.wb-zeile .wb-pfad a');
    const ohne = [...document.querySelectorAll('.wb-zeile')]
      .find(z => z.dataset.wb === 'scan-300').querySelector('.wb-pfad span:not(.tr)');
    if (!mit || !ohne) { return false; }
    return getComputedStyle(mit).color !== getComputedStyle(ohne).color;
  }));

// ══════════════ DIE VERWEISE FÜHREN IN DIE RUBRIK
// Objekt: führt auf die Objektseite, nicht bloss irgendwohin.
await page.evaluate(() => {
  const z = [...document.querySelectorAll('.wb-zeile')].find(x => x.dataset.wb === 'scan-301');
  z.querySelectorAll('.wb-pfad a')[1].click();
});
await page.waitForTimeout(300);
check('KRITISCH: der Klick auf das Objekt führt in die Objektansicht',
  await page.evaluate(() => document.getElementById('view-objekt').classList.contains('on')
    && document.getElementById('obDetName').textContent.includes('Testliegenschaft Nord')));

await zumWachbuch();
await page.evaluate(() => {
  const z = [...document.querySelectorAll('.wb-zeile')].find(x => x.dataset.wb === 'scan-301');
  z.querySelectorAll('.wb-pfad a')[0].click();
});
await page.waitForTimeout(300);
check('KRITISCH: der Klick auf den Kunden führt auf die Kunden-Detailseite',
  await page.evaluate(() => document.getElementById('view-kunden').classList.contains('on')
    && document.getElementById('kdName').textContent.includes('Muster Liegenschaften AG')));

await zumWachbuch();
calls = [];
await page.evaluate(() => {
  const z = [...document.querySelectorAll('.wb-zeile')].find(x => x.dataset.wb === 'rundgang-201');
  z.querySelector('.wb-satz a').click();
});
await page.waitForTimeout(400);
check('KRITISCH: der Klick auf den Rundgang öffnet die Rundgang-Detailansicht',
  await page.evaluate(() => document.getElementById('dlgRundgang').classList.contains('on'))
  && calls.some(c => c.path.includes('rundgang_detail')));
check('KRITISCH: der Klick auf einen Verweis öffnet NICHT zusätzlich das Seitenfenster',
  await page.evaluate(() => !document.getElementById('drawer').classList.contains('on')));
await page.evaluate(() => rgdZu());
await page.waitForTimeout(150);

// ══════════════ DAS SEITENFENSTER
await page.evaluate(() => {
  [...document.querySelectorAll('.wb-zeile')].find(x => x.dataset.wb === 'scan-302').click();
});
await page.waitForTimeout(250);
check('KRITISCH: der Klick auf die Zeile klappt ein seitliches Fenster aus',
  await page.evaluate(() => {
    const d = document.getElementById('drawer');
    const r = d.getBoundingClientRect();
    // Gemessen, nicht an der Klasse abgelesen: eine Schublade, die "on" heisst
    // und rechts ausserhalb des Fensters steht, ist nicht ausgeklappt.
    return d.classList.contains('on') && r.right <= window.innerWidth + 1
      && r.left < window.innerWidth && r.width > 300;
  }));
const dr = await page.textContent('#drawer');
check('Das Fenster nennt die Art des Vorgangs im Titel',
  (await page.textContent('#drTitle')) === 'Kontrollpunkt');
check('Es zeigt Zeitpunkt, Übermittlung und deren Abstand',
  dr.includes('Zeitpunkt') && dr.includes('Übermittelt') && dr.includes('später')
  && dr.includes('Std.'));
check('Es zeigt Kontrollpunkt, Rundgang, Einsatz und Person',
  dr.includes('Keller') && dr.includes('Schliessrunde') && dr.includes('Nachtdienst')
  && dr.includes('Muster, Erika'));
check('Ein vorhandenes Foto wird erwähnt, statt stillschweigend zu fehlen', dr.includes('Foto'));
// ── Das Foto selbst (ENT-530) ──────────────────────────────────────────
// Geprüft wird die Sache, nicht der Wortlaut: Bis hierher stand im Fenster
// nur das Wort „vorhanden", und genau darum blieb die Zeile darüber grün,
// während nie ein Bild zu sehen war.
await page.waitForTimeout(250);
check('KRITISCH: beim Ersatzscan holt das Fenster das Bild vom Scan-Endpunkt',
  calls.some(c => c.path.startsWith('rundgang_scan_foto') && c.query.id === '302'));
check('KRITISCH: das Bild ist wirklich dekodiert, nicht nur ein leerer Rahmen',
  await page.evaluate(() => {
    const i = document.querySelector('#wbDrFoto img');
    // naturalWidth ist der einzige Wert, der sagt, dass der Browser das Bild
    // auch lesen konnte -- ein <img> mit kaputter Quelle steht sonst genauso da.
    return !!i && i.naturalWidth > 0 && i.getBoundingClientRect().width > 0;
  }));
check('Der Sitzungs-Token steht nicht in der Bild-Adresse',
  calls.filter(c => c.path.includes('_foto')).every(c => !('token' in c.query)));
check('KRITISCH: aus dem Fenster führt ein Knopf in die Rundgang-Ansicht',
  await page.evaluate(() => (document.getElementById('drFoot').textContent || '').includes('Rundgang ansehen')));

// Der gemeldete Fall: ein Ereignis MIT Foto. Es holt sein Bild von einem
// anderen Endpunkt als der Scan -- eine Verwechslung liefert entweder nichts
// oder, schlimmer, das Bild eines fremden Vorgangs mit derselben Nummer.
await page.evaluate(() => { closeDrawer(); });
calls = [];
await page.evaluate(() => {
  [...document.querySelectorAll('.wb-zeile')].find(x => x.dataset.wb === 'ereignis-501').click();
});
await page.waitForTimeout(300);
check('KRITISCH: beim Ereignis holt das Fenster das Bild vom Ereignis-Endpunkt',
  calls.some(c => c.path.startsWith('ereignis_foto') && c.query.id === '501'));
check('KRITISCH: und nicht vom Scan-Endpunkt -- zwei Nummernkreise, zwei Wege',
  !calls.some(c => c.path.startsWith('rundgang_scan_foto')));
check('KRITISCH: das Ereignisfoto ist im Fenster wirklich zu sehen',
  await page.evaluate(() => {
    const i = document.querySelector('#wbDrFoto img');
    return !!i && i.naturalWidth > 0 && i.getBoundingClientRect().width > 0;
  }));
check('Das Wort „vorhanden" ersetzt das Bild nicht mehr',
  !(await page.textContent('#drawer')).includes('vorhanden'));
// Gemessen, nicht im Quelltext nachgelesen (CLAUDE.md): ".sig-box img"
// deckelt im selben Haus auf 110 px und legt einen weissen Grund unter --
// richtig fuer eine Unterschrift, falsch fuer ein Foto. Darum eine eigene
// Huelle; ob sie greift, sagt nur der gerenderte Zustand.
check('KRITISCH: das Bild bleibt im Fenster, statt seitlich hinauszuragen',
  await page.evaluate(() => {
    const i = document.querySelector('#wbDrFoto img');
    const d = document.getElementById('drawer');
    if (!i) { return false; }
    const bi = i.getBoundingClientRect(), bd = d.getBoundingClientRect();
    return bi.right <= bd.right + 1 && bi.left >= bd.left - 1
      // Gedeckelt, aber nicht verschwunden -- und nicht verzerrt: Ein Foto,
      // das breiter gestaucht als gekuerzt wird, sagt etwas anderes aus als
      // das aufgenommene.
      && bi.width > 100 && bi.width <= 220 && bi.height <= 160
      && Math.abs((bi.width / bi.height) - (400 / 300)) < 0.05;
  }));
// Die Masse merken: Dasselbe Foto darf im Seitenfenster nicht anders gross
// sein als im Rundgang-Dialog. Zwei Groessen fuer dasselbe Bild sind zwei
// Aussagen darueber, wie wichtig es ist -- und genau so eine stille
// Abweichung entsteht, wenn eine zweite Stelle ihre eigene Huelle bekommt.
const fotoMassFenster = await page.evaluate(() => {
  const i = document.querySelector('#wbDrFoto img');
  if (!i) { return null; }
  const b = i.getBoundingClientRect();
  return { w: Math.round(b.width), h: Math.round(b.height) };
});
check('Die Überschrift steht ÜBER dem Bild, nicht darunter',
  await page.evaluate(() => {
    const k = document.querySelector('.wb-dr-foto .lb');
    const i = document.querySelector('#wbDrFoto img');
    return !!k && !!i
      && k.getBoundingClientRect().bottom <= i.getBoundingClientRect().top + 1;
  }));
await page.evaluate(() => { closeDrawer(); });
// Eine Runde ohne Endzeit: "nicht erfasst" ist eine Aussage, ein leeres Feld
// wäre keine.
await page.evaluate(() => { closeDrawer(); });
await page.evaluate(() => {
  [...document.querySelectorAll('.wb-zeile')].find(x => x.dataset.wb === 'rundgang-202').click();
});
await page.waitForTimeout(200);
const dr2 = await page.textContent('#drawer');
check('KRITISCH: eine Runde ohne Endzeit sagt das, statt das Feld leer zu lassen',
  dr2.includes('nicht erfasst'));
check('Der Abbruchgrund steht auch im Fenster', dr2.includes('notfall'));
await page.evaluate(() => { closeDrawer(); });

// ══════════════ DAS FOTO IN DER RUNDGANG-DETAILANSICHT (ENT-530)
// Der Weg, den das Seitenfenster anbietet: „Rundgang ansehen". Dort stand das
// Ereignisfoto bis hierher als Wort „Mit Foto" da -- im SELBEN Dialog, in dem
// der Fotobeleg eines Ersatzscans längst als Bild erscheint.
rundgangEreignisse = [
  { id: 501, erfasst_am: `${T1} 23:10:00`, vorfall_am: `${T1} 22:50:00`,
    bemerkung: 'Tür stand offen', hat_foto: true, art: 'Feststellung' },
  // Eine zweite Meldung OHNE Foto: Sie darf keinen leeren Rahmen bekommen.
  { id: 502, erfasst_am: `${T1} 23:20:00`, vorfall_am: null,
    bemerkung: 'Nichts Besonderes', hat_foto: false, art: 'Feststellung' },
];
await zumWachbuch();
calls = [];
check('Die LISTE selbst lädt weiterhin kein einziges Bild',
  !calls.some(c => c.path.includes('_foto')));
await page.evaluate(() => {
  const z = [...document.querySelectorAll('.wb-zeile')].find(x => x.dataset.wb === 'rundgang-201');
  z.querySelector('.wb-satz a').click();
});
await page.waitForTimeout(400);
check('KRITISCH: das Ereignisfoto erscheint im Rundgang-Dialog als BILD',
  await page.evaluate(() => {
    const i = document.querySelector('#rgdEvFoto501 img');
    return !!i && i.naturalWidth > 0 && i.getBoundingClientRect().width > 0;
  }));
check('KRITISCH: geholt wird es beim Ereignis-Endpunkt, mit der Ereignisnummer',
  calls.some(c => c.path.startsWith('ereignis_foto') && c.query.id === '501'));
check('KRITISCH: dasselbe Foto ist hier genauso gross wie im Seitenfenster',
  !!fotoMassFenster && await page.evaluate(m => {
    const i = document.querySelector('#rgdEvFoto501 img');
    if (!i) { return false; }
    const b = i.getBoundingClientRect();
    return Math.abs(Math.round(b.width) - m.w) <= 1
      && Math.abs(Math.round(b.height) - m.h) <= 1;
  }, fotoMassFenster));
check('Das Wort „Mit Foto" steht nicht mehr anstelle des Bildes',
  !(await page.textContent('#rgdBody')).includes('Mit Foto'));
check('KRITISCH: eine Meldung ohne Foto bekommt keinen leeren Rahmen',
  await page.evaluate(() => !document.getElementById('rgdEvFoto502')));
await page.evaluate(() => rgdZu());
await page.waitForTimeout(150);
check('Beim Schliessen wird die Objekt-URL wieder freigegeben',
  await page.evaluate(() => Object.keys(rgdEreignisFotos).length === 0));
rundgangEreignisse = [];

// Mit der Tastatur genauso wie mit der Maus.
await page.evaluate(() => {
  const z = [...document.querySelectorAll('.wb-zeile')].find(x => x.dataset.wb === 'scan-301');
  z.focus();
  z.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
});
await page.waitForTimeout(200);
check('KRITISCH: die Zeile lässt sich auch mit der Tastatur öffnen',
  await page.evaluate(() => document.getElementById('drawer').classList.contains('on')));
await page.evaluate(() => { closeDrawer(); });

// ══════════════ DER ART-FILTER LÄUFT IM SERVER
calls = [];
await klick('.wb-art[data-art="ereignis"]');
await page.waitForTimeout(300);
const gefiltert = calls.find(c => c.path.includes('wachbuch_liste')) || { query: {} };
check('KRITISCH: der Art-Filter geht an den Server -- ein Filter über eine '
  + 'bereits gekappte Liste zeigte gefilterte Zahlen wie Gesamtzahlen',
  gefiltert.query.arten === 'ereignis');
check('Der gewählte Filter ist an der Schaltfläche zu sehen',
  await page.evaluate(() => {
    const b = document.querySelector('.wb-art[data-art="ereignis"]');
    return b.classList.contains('on') && b.getAttribute('aria-pressed') === 'true';
  }));
check('KRITISCH: jede Art nennt ihre WIRKLICHE Zahl im Zeitraum, auch die '
  + 'ausgeblendete -- sonst sähe man nicht, dass hinter dem Filter etwas liegt',
  await page.evaluate(() => {
    const n = a => document.querySelector(`.wb-art[data-art="${a}"] .n`).textContent.trim();
    return n('scan') === '3' && n('rundgang') === '2' && n('aufgabe') === '1' && n('ereignis') === '1';
  }));

// ══════════════ VIER LEERE ZUSTÄNDE, VIER VERSCHIEDENE TEXTE
// Das ist die Hausregel, die hier am häufigsten gebrochen wurde: "unbekannt"
// darf nie wie "keine" aussehen.
async function neuLaden(a) {
  antwort = a;
  await page.evaluate(() => aeLadeWachbuch());
  await page.waitForTimeout(250);
  return page.textContent('#aeWbListe');
}
const leerGefiltert = await neuLaden({ ...WACHBUCH, eintraege: [], gezeigt: 0, gesamt: 7 });
check('KRITISCH: ein Filter ohne Treffer sagt "Kein Treffer" und nennt, wie viel es sonst gibt',
  leerGefiltert.includes('Kein Treffer') && leerGefiltert.includes('7 Vorgänge'));
// Filter aus -- danach ist "nichts im Zeitraum" die richtige Aussage.
await klick('.wb-art[data-art="ereignis"]');
await page.waitForTimeout(250);
const leer = await neuLaden({ ...WACHBUCH, eintraege: [], gezeigt: 0, gesamt: 0,
  je_art: { scan: 0, rundgang: 0, aufgabe: 0, ereignis: 0 } });
check('KRITISCH: nichts im Zeitraum sagt "Nichts geschehen", nicht "Kein Treffer"',
  leer.includes('Nichts geschehen') && !leer.includes('Kein Treffer'));
const nichtEingerichtet = await neuLaden({ ...WACHBUCH, eintraege: [], gezeigt: 0, gesamt: 0,
  quellen: { scans: 'fehlt', runden: 'fehlt', aufgaben: 'fehlt', ereignisse: 'fehlt' } });
check('KRITISCH: eine nicht eingerichtete Datenbank sagt das ausdrücklich -- '
  + 'das ist etwas anderes als "im Zeitraum nichts"',
  nichtEingerichtet.includes('Noch nicht eingerichtet')
  && !nichtEingerichtet.includes('Nichts geschehen'));
antwort = { status: 'fehler' };
await page.evaluate(() => aeLadeWachbuch());
await page.waitForTimeout(250);
check('KRITISCH: eine nicht ladbare Antwort sagt das, statt leer auszusehen',
  (await page.textContent('#aeWbListe')).includes('nicht verfügbar'));

// Eine Quelle fehlt, die übrigen liefern: Die Liste sieht vollständig aus,
// ist es aber nicht. Das gehört in eine eigene Zeile, nicht in eine graue
// Notiz -- dieselbe Lehre wie beim Ereignis-Feed (ENT-090).
const luecke = await neuLaden({ ...WACHBUCH,
  quellen: { scans: 'ok', runden: 'ok', aufgaben: 'ok', ereignisse: 'fehler' } });
check('KRITISCH: eine ausgefallene Quelle wird gemeldet, obwohl die Liste gefüllt ist',
  luecke.includes('Unvollständig') && luecke.includes('Ereignisse'));
check('Die ausgefallene Art zeigt statt einer Null ein Fragezeichen -- eine "0" '
  + 'für eine Quelle, die nicht antwortet, wäre eine Behauptung',
  await page.evaluate(() =>
    document.querySelector('.wb-art[data-art="ereignis"] .n').textContent.trim() === '?'));

// Gekappt: die gezeigte Zahl darf nie wie die Gesamtzahl aussehen.
await neuLaden({ ...WACHBUCH, gezeigt: EINTRAEGE.length, gesamt: 1238, gekuerzt: true });
check('KRITISCH: eine gekappte Liste nennt beide Zahlen und sagt, was zu tun ist',
  await page.evaluate(() => {
    const t = (document.querySelector('.wb-zahl') || {}).textContent || '';
    return t.includes('1’238') && t.includes('Zeitraum eingrenzen');
  }));

// ══════════════ AM HANDY BEWUSST NICHT DA (ENT-235)
// Was im Cockpit entsteht, wird nicht automatisch auch fürs Handy gebaut.
// Die Auswertung ist mobil ausgeblendet; das Wachbuch erbt das und baut
// keinen eigenen Weg dorthin.
const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
m.on('pageerror', e => bad.push('JS-Fehler (mobil): ' + e.message));
await mock(m);
await m.goto(SEITE);
await m.evaluate(() => localStorage.clear());
await m.goto(SEITE);
await m.fill('#gName', 'adrian'); await m.fill('#gPass', 'x'); await m.click('#gBtn');
await m.waitForSelector('#kpiGrid .kpi-val');
check('KRITISCH: am Handy führt kein Weg ins Wachbuch (ENT-235, bewusst nicht gebaut)',
  await m.evaluate(() => {
    const n = document.getElementById('nav-kontrolle-arbeitsergebnisse');
    return !n || !n.getClientRects().length;
  }));

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
