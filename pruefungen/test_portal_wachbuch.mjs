// Kundenportal > Wachbuch (ENT-484).
//
// Die Chronik derselben Objekte im selben Zeitraum wie die Rundgangliste
// darüber: Kontrollpunkt erfasst, Rundgang erledigt oder abgebrochen,
// Aufgabe beantwortet, Ereignis gemeldet.
//
// Was hier NICHT geprüft wird: das Zusammenführen, Sortieren und Kappen und
// die beiden Portal-Grenzen (nur beendete Runden, nur Ereignisse an einer
// Runde). Die laufen echt gegen SQLite in pruef_wachbuch.php -- diese Suite
// täuscht die Serverantwort vor und käme an einer SQL-Regel nie vorbei.
// Hier geht es um die Oberfläche: welcher Satz bei welchem Status steht,
// dass kein Personenname darin vorkommt, wohin ein Klick führt, und ob das
// Gemessene mit dem Gemeinten übereinstimmt -- auf 390 px zuerst, danach am
// Desktop, wie CLAUDE.md es verlangt.
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const SEITE = `file://${WURZEL}/portal.html`;
const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);
async function klick(sel, seite) {
  try { await (seite || page).click(sel, { timeout: 3000 }); return true; }
  catch (e) { bad.push('nicht anklickbar: ' + sel); return false; }
}
async function fuell(sel, wert, seite) {
  try { await (seite || page).fill(sel, wert, { timeout: 3000 }); return true; }
  catch (e) { bad.push('nicht ausfuellbar: ' + sel); return false; }
}

// Relative Daten statt fester Werte (CLAUDE.md, test_datumsfest.mjs).
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const vorTagen = n => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };
const T0 = vorTagen(0), T1 = vorTagen(1);
const dmy = t => t.split('-').reverse().join('.');

// Erfundene Namen, keine echten Kunden oder Personen (CLAUDE.md).
const RUNDGAENGE = {
  status: 'ok', kunde: 'Muster Liegenschaften AG', person: 'A. Beispielperson',
  // je_vorhanden kam mit ENT-482 dazu und entscheidet, ob es den
  // Revierdienst-Bereich ueberhaupt gibt. Das Wachbuch haengt darin.
  je_vorhanden: true,
  zeitraum: { von: vorTagen(30), bis: T0 },
  objekte: [{ id: 4, name: 'Testliegenschaft Nord', strasse: 'Musterweg 1', ort: 'Musterort' }],
  rundgaenge: [
    { id: 201, datum: T1, objekt_id: 4, objekt_name: 'Testliegenschaft Nord',
      status: 'abgeschlossen', beginn: `${T1} 22:05:00`,
      dauer: { sekunden: 2100, quelle: 'ende' },
      fortschritt: { gesamt: 3, erledigt: 3, bestaetigt: 2, ersatzscan: 1 } },
  ],
};

const r = {
  objekt_id: 4, objekt_name: 'Testliegenschaft Nord',
  rundgang_id: 201, rundgang_name: 'Schliessrunde', hat_foto: false,
};
const EINTRAEGE = [
  { ...r, art: 'rundgang', id: 'rundgang-202', zeit: `${T0} 02:40:00`, status: 'abgebrochen',
    rundgang_id: 202, scans_anzahl: 2, abbruch_grund: 'Notfall an einem anderen Objekt',
    text: 'Alarm am Nachbarobjekt' },
  { ...r, art: 'ereignis', id: 'ereignis-501', zeit: `${T1} 23:10:00`, status: null,
    bezeichnung: 'Feststellung', vorfall_am: `${T1} 22:50:00`,
    text: 'Tür stand offen', hat_foto: true },
  { ...r, art: 'rundgang', id: 'rundgang-201', zeit: `${T1} 22:40:00`, status: 'abgeschlossen',
    scans_anzahl: 3, abbruch_grund: null, text: null },
  { ...r, art: 'aufgabe', id: 'aufgabe-401', zeit: `${T1} 22:22:00`, status: 'nicht_moeglich',
    bezeichnung: 'Licht löschen', punkt_name: 'Keller', text: 'Schalter defekt' },
  { ...r, art: 'scan', id: 'scan-302', zeit: `${T1} 22:20:00`, status: 'ersatzscan',
    punkt_name: 'Keller', text: 'Chip defekt', hat_foto: true },
  { ...r, art: 'scan', id: 'scan-301', zeit: `${T1} 22:05:00`, status: 'bestaetigt',
    punkt_name: 'Eingang', text: null },
  // Ein Scan auf einen inzwischen entfernten Kontrollpunkt: Der Nachweis
  // bleibt, der Name des Punktes nicht.
  { ...r, art: 'scan', id: 'scan-300', zeit: `${T1} 21:55:00`, status: 'nicht_verfuegbar',
    punkt_name: null, text: null },
];
const WACHBUCH = {
  status: 'ok', kunde: 'Muster Liegenschaften AG', person: 'A. Beispielperson',
  zeitraum: { von: vorTagen(30), bis: T0 },
  eintraege: EINTRAEGE, gezeigt: EINTRAEGE.length, gesamt: EINTRAEGE.length,
  gekuerzt: false, grenze: 400,
  je_art: { scan: 3, rundgang: 2, aufgabe: 1, ereignis: 1 },
  quellen: { scans: 'ok', runden: 'ok', aufgaben: 'ok', ereignisse: 'ok' },
};

let calls = [];
let wbAntwort = WACHBUCH;
// Vorgabe: der Kunde bezieht NUR Revierdienst. Ein Fall weiter unten dreht
// das um.
let einsatzAntwort = { status: 'ok', je_vorhanden: false, einsaetze: [],
  zeitraum: { von: vorTagen(30), bis: T0 }, leer_grund: 'kein_verkehrsdienst' };
async function setup(seite) {
  await seite.route('**/api/**', route => {
    const u = new URL(route.request().url());
    const path = u.pathname.split('/api/')[1];
    calls.push({ path, query: Object.fromEntries(u.searchParams) });
    const send = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
    if (path.includes('portal_anmelden')) {
      return send({ status: 'ok', token: 't', name: 'A. Beispielperson',
        kunde: 'Muster Liegenschaften AG' });
    }
    if (path.includes('portal_wachbuch')) return send(wbAntwort);
    if (path.includes('portal_rundgaenge')) return send(RUNDGAENGE);
    // Der Verkehrsdienst-Bereich (ENT-482). Er gehoert nicht zum Pruefgegenstand,
    // aber ohne ihn faellt laden() auf halbem Weg aus.
    if (path.includes('portal_einsaetze')) return send(einsatzAntwort);
    if (path.includes('portal_rundgang_detail')) {
      return send({ status: 'ok', rundgang: {
        id: 201, datum: T1, objekt_name: 'Testliegenschaft Nord', strasse: 'Musterweg 1',
        ort: 'Musterort', status: 'abgeschlossen', vorlage_name: 'Schliessrunde',
        person: 'Erika Muster', abbruch_grund: null, abbruch_freitext: null,
        beginn: `${T1} 22:05:00`, rohzeit_ende: `${T1} 22:40:00`,
        dauer: { sekunden: 2100, quelle: 'ende' }, pause_minuten: 0,
        fortschritt: { gesamt: 3, erledigt: 3, bestaetigt: 2, ersatzscan: 1 },
        punkte: [], ereignisse: [] } });
    }
    return send({ status: 'ok' });
  });
}

// Seit ENT-486 ist das Wachbuch ein EIGENER Reiter und beim Laden nicht
// offen. Ohne diesen Wechsel misst die Suite ein verborgenes Element, und
// jede Groesse waere null -- eine Messung, die nichts aussagt.
async function zumWachbuch(seite) {
  await (seite || page).click('#reiter-wachbuch', { timeout: 3000 })
    .catch(() => bad.push('Die Kachel "Wachbuch" ist nicht anklickbar'));
  await (seite || page).waitForTimeout(200);
}

async function anmelden(seite) {
  await seite.goto(SEITE);
  await seite.evaluate(() => localStorage.clear());
  await seite.goto(SEITE);
  await fuell('#email', 'a.beispiel@example.invalid', seite);
  await fuell('#passwort', 'ein sicheres langes wort', seite);
  await klick('#anmelden-pw', seite);
  await seite.waitForSelector('#inhalt:not([hidden])', { timeout: 4000 })
    .catch(() => bad.push('Die Anmeldung führt nicht in die Liste'));
  await seite.waitForTimeout(300);
  await zumWachbuch(seite);
}

const browser = await chromium.launch({ executablePath: EXE });

// ══ Handy zuerst: das Portal wird überwiegend am Handy geöffnet ═════════
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
await setup(page);
calls = [];
await anmelden(page);

// ══════════════ DER EIGENE ENDPUNKT UND SEIN ZEITRAUM
const ruf = calls.find(c => c.path.includes('portal_wachbuch')) || { query: {} };
check('KRITISCH: das Portal ruft portal_wachbuch.php auf -- nicht wachbuch_liste.php',
  !!calls.find(c => c.path.includes('portal_wachbuch'))
  && !calls.some(c => /(^|\/)wachbuch_liste/.test(c.path)));
check('KRITISCH: es schickt KEINE Kunden- oder Objektkennung mit -- der '
  + 'Zuschnitt kommt aus der Sitzung',
  ruf.query.kunde_id === undefined && ruf.query.objekt_id === undefined
  && ruf.query.kunde === undefined);
// Beide Karten zeigen denselben Ausschnitt. Beim ersten Laden schickt die
// Rundgangliste noch gar keinen Zeitraum (der Server setzt seine Vorgabe);
// die Chronik uebernimmt DIE ANTWORT davon und ist damit deckungsgleich.
// Ohne das saehe der Kunde zwei Karten mit zwei verschiedenen Zeitraeumen
// nebeneinander, ohne dass es irgendwo staende.
check('KRITISCH: die Chronik uebernimmt den Zeitraum, den die Rundgangliste zurueckgibt',
  ruf.query.von === RUNDGAENGE.zeitraum.von && ruf.query.bis === RUNDGAENGE.zeitraum.bis);

// Und wenn der Kunde den Zeitraum aendert, folgt die Chronik dem, was die
// Rundgangliste WIRKLICH benutzt hat -- nicht dem, was im Feld stand.
//
// Die Attrappe meldet hier absichtlich einen ANDEREN Zeitraum zurueck, als
// gefragt wurde. Genau das tut der echte Server, wenn er eine verdrehte
// oder unsinnige Eingabe zurechtruecken muss. Wuerde die Chronik die Felder
// ein zweites Mal lesen, stuenden danach zwei Zeitraeume nebeneinander --
// beim Messen war es genau so.
{
  calls = [];
  await fuell('#von', vorTagen(9));
  await fuell('#bis', vorTagen(1));
  await klick('#zeigen');
  await page.waitForTimeout(500);
  const wb = calls.find(c => c.path.includes('portal_wachbuch')) || { query: {} };
  check('KRITISCH: die Chronik folgt dem zurueckgemeldeten Zeitraum der '
    + 'Rundgangliste, nicht dem Eingabefeld',
    wb.query.von === RUNDGAENGE.zeitraum.von && wb.query.bis === RUNDGAENGE.zeitraum.bis);
  check('Und die Rundgangliste hat wirklich das Eingetippte gefragt',
    (calls.find(c => c.path.includes('portal_rundgaenge')) || { query: {} }).query.von === vorTagen(9));
  // Ein neuer Zeitraum stellt den gewaehlten Reiter nicht um -- geprueft,
  // weil ein Rueckfall auf die Rundgaenge hier genau so aussaehe wie ein
  // Fehler beim Laden.
  check('KRITISCH: ein neuer Zeitraum laesst den gewählten Reiter stehen',
    await page.evaluate(() => !document.getElementById('bereich-wachbuch').hidden));
}

// ══════════════ ZWEI KARTEN, BEIDE BENANNT
check('KRITISCH: beide Karten tragen eine Überschrift -- eine mit und eine '
  + 'ohne wirken nebeneinander unruhig',
  await page.evaluate(() => {
    const t = [...document.querySelectorAll('#inhalt .karte-titel')].map(e => e.textContent.trim());
    return t.includes('Rundgänge') && t.includes('Wachbuch');
  }));

// ══════════════ NACH TAGEN GRUPPIERT, NEUESTE ZUOBERST
const tage = await page.$$eval('#wb-liste .wb-tg b', els => els.map(e => e.textContent.trim()));
check('KRITISCH: die Vorgänge stehen unter Tagesüberschriften, neueste zuoberst',
  tage.length === 2 && tage[0] === dmy(T0) && tage[1] === dmy(T1));
const zeiten = await page.$$eval('#wb-liste .wb-z .wb-t', els => els.map(e => e.textContent.trim()));
check('KRITISCH: die Oberfläche sortiert die Serverantwort nicht um',
  JSON.stringify(zeiten) === JSON.stringify(['02:40', '23:10', '22:40', '22:22', '22:20', '22:05', '21:55']));
check('Jeder Tag nennt, wie viele Vorgänge auf ihn entfallen',
  JSON.stringify(await page.$$eval('#wb-liste .wb-tg span', els => els.map(e => e.textContent.trim())))
  === JSON.stringify(['1 Vorgang', '6 Vorgänge']));

// ══════════════ KEIN PERSONENNAME IN DER CHRONIK
// Die Chronik ist eine Liste und folgt derselben Abstufung wie die
// Rundgangliste: Sie beantwortet „was ist geschehen", nicht „wer war es".
// Der Name steht seit ENT-481 im aufgeklappten Detail, einen Klick weiter.
check('KRITISCH: in der Chronik steht kein Name einer eingesetzten Person',
  !/Erika|Muster,|Beispielperson/.test(await page.textContent('#wb-liste')));
// Und die Oberfläche darf ihn auch dann nicht zeigen, wenn der Server ihn
// eines Tages doch mitschickt -- sonst wäre die Zusage von der Antwort
// abhängig statt von der Seite.
{
  wbAntwort = { ...WACHBUCH, eintraege: EINTRAEGE.map(e => ({ ...e, person: 'Muster, Erika' })) };
  await page.evaluate(() => wbLaden());
  await page.waitForTimeout(250);
  check('KRITISCH: auch ein mitgeschickter Name erscheint nicht in der Chronik',
    !/Muster, Erika/.test(await page.textContent('#wb-liste')));
  wbAntwort = WACHBUCH;
  await page.evaluate(() => wbLaden());
  await page.waitForTimeout(250);
}

// ══════════════ DIE AUSSAGE STEHT IM SATZ, NICHT IN DER FARBE
const saetze = await page.$$eval('#wb-liste .wb-s',
  els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
check('KRITISCH: ein bestätigter Scan sagt "erfasst"',
  saetze.includes('Kontrollpunkt Eingang erfasst.'));
check('KRITISCH: ein nicht verfügbarer Punkt sagt NICHT "erfasst"',
  saetze.some(t => t.includes('als nicht verfügbar gemeldet'))
  && !saetze.some(t => t.includes('nicht verfügbar') && t.includes('erfasst.')));
// „Ersatzscan" ist Hausjargon. Im Portal heisst es „Fotobeleg" -- derselbe
// Wortschatz wie im aufgeklappten Detail (D_SCAN). Zwei Wörter für dieselbe
// Sache wären zwei Sprachen.
check('KRITISCH: das Portal sagt "Fotobeleg", nicht "Ersatzscan"',
  saetze.some(t => t.includes('per Fotobeleg belegt'))
  && !(await page.textContent('#wb-liste')).includes('Ersatzscan'));
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
check('KRITISCH: eine erledigte und eine abgebrochene Runde haben verschiedene Sätze',
  saetze.some(t => t === 'Rundgang Schliessrunde erledigt.')
  && saetze.some(t => t === 'Rundgang Schliessrunde abgebrochen.'));
check('Eine nicht mögliche Aufgabe sagt das, statt als erledigt dazustehen',
  saetze.some(t => t.includes('Aufgabe Licht löschen als nicht möglich gemeldet')));
check('Ein Ereignis nennt seine Art', saetze.some(t => t.includes('Ereignis gemeldet: Feststellung')));

const inhalt = await page.textContent('#wb-liste');
check('Der Grund eines Abbruchs steht in der Zeile, nicht erst im Detail',
  inhalt.includes('Grund: Notfall an einem anderen Objekt'));
// Der Grund kommt als Klartext aus dem Server (ENT-324/ENT-481) -- portal.html
// trägt keinen eigenen Katalog. Ein Codewort hier wäre der Beleg dafür, dass
// doch einer entstanden ist.
check('KRITISCH: der Abbruchgrund steht als Klartext da, nicht als Codewort',
  !/\bnotfall\b/.test(inhalt));
check('Eine erledigte Runde sagt, wie viele Punkte erfasst wurden -- mit Einheit',
  inhalt.includes('3 Kontrollpunkte erfasst'));
check('Der Vorfallzeitpunkt eines Ereignisses ergänzt den Erfassungszeitpunkt',
  inhalt.includes('Vorfall ' + dmy(T1) + ', 22:50'));

// ══════════════ GEMESSEN, NICHT NACHGELESEN (390 px)
check('KRITISCH: kein waagrechter Scroll auf 390 px',
  await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
check('KRITISCH: die Überschrift (Objekt und Runde) steht ÜBER dem Satz',
  await page.evaluate(() => {
    const z = document.querySelector('#wb-liste .wb-z');
    const p = z.querySelector('.wb-p').getBoundingClientRect();
    const s = z.querySelector('.wb-s').getBoundingClientRect();
    return p.top < s.top && p.bottom <= s.top + 1;
  }));
check('Die Zeit steht rechts oben, nicht unter dem Satz',
  await page.evaluate(() => {
    const z = document.querySelector('#wb-liste .wb-z');
    const p = z.querySelector('.wb-p').getBoundingClientRect();
    const t = z.querySelector('.wb-t').getBoundingClientRect();
    return t.left >= p.right - 1 && Math.abs(t.top - p.top) < 12;
  }));
// Die Filterreihe steht am Handy und wird mit dem Finger bedient.
check('KRITISCH: die Filterkacheln sind auf dem Handy mindestens 44 px hoch',
  await page.evaluate(() => [...document.querySelectorAll('.wb-a')]
    .every(b => b.getBoundingClientRect().height >= 44)));
check('KRITISCH: die vier Arten sind an der gerenderten Farbe zu unterscheiden',
  await page.evaluate(() => {
    const f = id => {
      const z = [...document.querySelectorAll('.wb-z')].find(x => x.dataset.rg && x.querySelector('.wb-i'));
      return z ? null : null;
    };
    const farbe = i => getComputedStyle(document.querySelectorAll('#wb-liste .wb-z .wb-i')[i]).color;
    // Reihenfolge der Zeilen: rundgang(ab), ereignis, rundgang, aufgabe,
    // scan, scan, scan
    const s = [farbe(4), farbe(2), farbe(3), farbe(1)];
    return s.every(Boolean) && new Set(s).size === 4;
  }));
check('KRITISCH: eine abgebrochene Runde trägt nicht die Farbe einer erledigten',
  await page.evaluate(() => {
    const farbe = i => getComputedStyle(document.querySelectorAll('#wb-liste .wb-z .wb-i')[i]).color;
    return farbe(0) !== farbe(2);
  }));

// ══════════════ DER KLICK FÜHRT ZUR RUNDE DARÜBER
// Das Portal bekommt keine zweite Detailansicht: Alles zu einer Runde steht
// bereits in ihrem Aufklapper, mit Kontrollpunkten, Karte und Rapport.
check('Nur eine Zeile mit Runde sieht anklickbar aus',
  await page.evaluate(() => [...document.querySelectorAll('#wb-liste .wb-z')]
    .every(z => z.classList.contains('fuehrt') === (Number(z.dataset.rg) > 0))));
calls = [];
await page.evaluate(() => {
  [...document.querySelectorAll('#wb-liste .wb-z')].find(z => z.dataset.rg === '201').click();
});
await page.waitForTimeout(400);
check('KRITISCH: der Klick wechselt in den Rundgang-Reiter und klappt die Runde auf',
  await page.evaluate(() => {
    const z = document.querySelector('#liste .zeile[data-id="201"]');
    return !!z && z.classList.contains('offen') && z.getAttribute('aria-expanded') === 'true'
      // Seit ENT-486 steht die Runde in einem anderen Reiter. Ohne den
      // Wechsel klappte hier eine Zeile auf, die niemand sieht.
      && !document.getElementById('bereich-rundgaenge').hidden
      && z.getClientRects().length > 0;
  })
  && calls.some(c => c.path.includes('portal_rundgang_detail')));
// Eine Runde, die in der Liste gar nicht steht (Runde über Mitternacht,
// andere Filtergrundlage), darf nicht wortlos nichts tun. Vorher zurück in
// den Wachbuch-Reiter -- der Sprung eben hat auf die Rundgänge gewechselt.
await zumWachbuch();
await page.evaluate(() => {
  [...document.querySelectorAll('#wb-liste .wb-z')].find(z => z.dataset.rg === '202').click();
});
await page.waitForTimeout(250);
// Gemessen, nicht an einem Attribut abgelesen: Ein Hinweis in einer
// geschlossenen Karte ist kein Hinweis.
check('KRITISCH: eine Runde ausserhalb der Liste sagt das SICHTBAR, statt nichts zu tun',
  await page.evaluate(() => {
    const h = document.getElementById('wb-hinweis');
    return h.getClientRects().length > 0
      && /ausserhalb des gewählten Zeitraums/.test(h.textContent);
  }));
check('Und der Reiter bleibt dabei stehen -- es gibt ja nichts zu springen',
  await page.evaluate(() => !document.getElementById('bereich-wachbuch').hidden));

// ══════════════ DER ART-FILTER LÄUFT IM SERVER
calls = [];
await klick('.wb-a[data-art="ereignis"]');
await page.waitForTimeout(300);
check('KRITISCH: der Art-Filter geht an den Server -- ein Filter über eine '
  + 'gekappte Liste zeigte gefilterte Zahlen wie Gesamtzahlen',
  (calls.find(c => c.path.includes('portal_wachbuch')) || { query: {} }).query.arten === 'ereignis');
check('Der gewählte Filter ist an der Schaltfläche zu sehen',
  await page.evaluate(() =>
    document.querySelector('.wb-a[data-art="ereignis"]').getAttribute('aria-pressed') === 'true'));
check('KRITISCH: jede Art nennt ihre WIRKLICHE Zahl im Zeitraum, auch die ausgeblendete',
  await page.evaluate(() => {
    const n = a => document.querySelector(`.wb-a[data-art="${a}"] .n`).textContent.trim();
    return n('scan') === '3' && n('rundgang') === '2' && n('aufgabe') === '1' && n('ereignis') === '1';
  }));
await klick('.wb-a[data-art="ereignis"]');
await page.waitForTimeout(250);

// ══════════════ FÜNF LEERE ZUSTÄNDE, FÜNF VERSCHIEDENE TEXTE
async function neuLaden(a) {
  wbAntwort = a;
  await page.evaluate(() => wbLaden());
  await page.waitForTimeout(250);
  return page.textContent('#wb-liste');
}
const nichts = { ...WACHBUCH, eintraege: [], gezeigt: 0, gesamt: 0 };
const t1 = await neuLaden({ ...nichts, leer_grund: 'kein_revierdienst' });
const t2 = await neuLaden({ ...nichts, leer_grund: 'noch_nichts_erfasst' });
const t3 = await neuLaden({ ...nichts, leer_grund: 'kein_treffer_im_zeitraum' });
const t4 = await neuLaden({ ...nichts, leer_grund: 'kein_treffer_der_art' });
wbAntwort = { status: 'fehler' };
await page.evaluate(() => wbLaden());
await page.waitForTimeout(250);
const t5 = await page.textContent('#wb-liste');
check('KRITISCH: kein Revierdienst eingerichtet sagt genau das',
  t1.includes('Kein Revierdienst eingerichtet'));
check('KRITISCH: "noch nichts erfasst" ist etwas anderes als "nicht eingerichtet"',
  t2.includes('Noch nichts erfasst') && !t2.includes('Kein Revierdienst'));
check('KRITISCH: "nichts im Zeitraum" ist etwas anderes als "noch nichts erfasst"',
  t3.includes('Nichts im gewählten Zeitraum') && !t3.includes('Noch nichts erfasst'));
check('KRITISCH: "kein Treffer der Art" ist etwas anderes als "nichts im Zeitraum"',
  t4.includes('Kein Treffer') && !t4.includes('Nichts im gewählten Zeitraum'));
check('KRITISCH: eine nicht ladbare Antwort sagt das -- und dass die Rundgänge davon nicht betroffen sind',
  t5.includes('Wachbuch nicht verfügbar') && t5.includes('Rundgänge darüber'));
// Und die Rundgangliste darüber bleibt dabei wirklich stehen.
check('KRITISCH: eine ausgefallene Chronik reisst die Rundgangliste nicht mit',
  await page.evaluate(() => document.querySelectorAll('#liste .zeile').length > 0));

// Eine Quelle fehlt, die übrigen liefern: Die Liste sieht vollständig aus.
const luecke = await neuLaden({ ...WACHBUCH,
  quellen: { scans: 'ok', runden: 'ok', aufgaben: 'ok', ereignisse: 'fehler' } });
check('KRITISCH: eine ausgefallene Quelle wird gemeldet, obwohl die Liste gefüllt ist',
  await page.evaluate(() => {
    const h = document.getElementById('wb-hinweis');
    return !h.hidden && h.textContent.includes('Unvollständig')
      && h.textContent.includes('Ereignisse');
  }));
check('Die ausgefallene Art zeigt statt einer Null ein Fragezeichen',
  await page.evaluate(() =>
    document.querySelector('.wb-a[data-art="ereignis"] .n').textContent.trim() === '?'));

// Gekappt: die gezeigte Zahl darf nie wie die Gesamtzahl aussehen.
await neuLaden({ ...WACHBUCH, gezeigt: EINTRAEGE.length, gesamt: 1238, gekuerzt: true });
check('KRITISCH: eine gekappte Liste nennt beide Zahlen und sagt, was zu tun ist',
  await page.evaluate(() => {
    const t = document.getElementById('wb-zahl').textContent || '';
    return t.includes('von 1238') && t.includes('Zeitraum eingrenzen');
  }));
await neuLaden(WACHBUCH);

// ══════════════ DAS WACHBUCH GEHOERT IN DEN REVIERDIENST-REITER (ENT-482)
// Ein Kunde, der nur Verkehrsdienst bezieht, hat keine Kontrollpunkte, keine
// Runden und keine Aufgaben. Ein leeres Wachbuch saehe bei ihm aus, als sei
// nichts geschehen -- dieselbe Hausregel, die die Reiterleiste ueberhaupt
// erst hervorgebracht hat.
// GEÄNDERT MIT ENT-486: Das Wachbuch lag bis dahin IM Rundgang-Bereich und
// erbte dessen Sichtbarkeit. Jetzt ist es ein eigener Reiter -- die Zusage
// dahinter gilt unverändert und wird nur anders eingelöst: kein Wachbuch
// für einen Kunden ohne Revierdienst.
check('KRITISCH: Wachbuch und Rundgänge sind eigene, getrennte Bereiche',
  await page.evaluate(() => {
    const w = document.getElementById('bereich-wachbuch');
    const r = document.getElementById('bereich-rundgaenge');
    return !!w && !!r && w !== r && !w.contains(r) && !r.contains(w)
      && w.contains(document.getElementById('wb-liste'))
      && r.contains(document.getElementById('liste'));
  }));
check('KRITISCH: nie beide zugleich offen -- sonst wäre es keine Reiterleiste',
  await page.evaluate(() => ['rundgaenge', 'wachbuch', 'einsaetze']
    .filter(b => !document.getElementById('bereich-' + b).hidden).length === 1));
{
  einsatzAntwort = { status: 'ok', je_vorhanden: true, einsaetze: [],
    zeitraum: { von: vorTagen(30), bis: T0 }, leer_grund: 'kein_treffer_im_zeitraum' };
  await page.evaluate(() => laden());
  await page.waitForTimeout(500);
  check('Bei beiden Inhaltsarten stehen alle drei Kacheln da',
    await page.evaluate(() => !document.getElementById('reiter').hidden
      && ['rundgaenge', 'wachbuch', 'einsaetze']
        .every(b => !document.getElementById('reiter-' + b).hidden)));
  check('KRITISCH: der Wechsel auf "Einsätze" schliesst das Wachbuch',
    await page.evaluate(() => {
      document.getElementById('reiter-einsaetze').click();
      return document.getElementById('bereich-wachbuch').hidden
        && document.getElementById('bereich-rundgaenge').hidden;
    }));
  await page.evaluate(() => document.getElementById('reiter-wachbuch').click());
  await page.waitForTimeout(150);
  check('Und der Wechsel zurueck bringt es wieder',
    await page.evaluate(() => !document.getElementById('bereich-wachbuch').hidden
      && document.getElementById('wb-liste').getClientRects().length > 0));

  // Nur Verkehrsdienst: kein Wachbuch, und auch keine Abfrage dafuer.
  wbAntwort = WACHBUCH;
  calls = [];
  einsatzAntwort = { ...einsatzAntwort, je_vorhanden: true };
  const nurVerkehr = { ...RUNDGAENGE, je_vorhanden: false, rundgaenge: [],
    leer_grund: 'kein_revierdienst' };
  await page.route('**/api/portal_rundgaenge*', route => route.fulfill({ status: 200,
    contentType: 'application/json', body: JSON.stringify(nurVerkehr) }));
  await page.evaluate(() => laden());
  await page.waitForTimeout(500);
  check('KRITISCH: ohne Revierdienst sind Wachbuch-Bereich UND -Kachel weg',
    await page.evaluate(() => document.getElementById('bereich-wachbuch').hidden
      && document.getElementById('reiter-wachbuch').hidden
      && document.getElementById('bereich-rundgaenge').hidden));
  check('KRITISCH: und es wird auch nicht abgefragt -- eine Abfrage fuer eine '
    + 'verborgene Karte ist eine Abfrage zu viel',
    !calls.some(c => c.path.includes('portal_wachbuch')));
  await page.unroute('**/api/portal_rundgaenge*');
  einsatzAntwort = { status: 'ok', je_vorhanden: false, einsaetze: [],
    zeitraum: { von: vorTagen(30), bis: T0 }, leer_grund: 'kein_verkehrsdienst' };
  await page.evaluate(() => laden());
  await page.waitForTimeout(400);
}

// ══ Und dasselbe am Desktop (CLAUDE.md verlangt beides) ═════════════════
const gross = await browser.newPage({ viewport: { width: 1280, height: 900 } });
gross.on('pageerror', e => bad.push('JS-Fehler (Desktop): ' + e.message));
await setup(gross);
await anmelden(gross);
check('Die Chronik erscheint auch am Desktop',
  (await gross.$$('#wb-liste .wb-z')).length === EINTRAEGE.length);
check('KRITISCH: auch am Desktop steht die Überschrift über dem Satz',
  await gross.evaluate(() => {
    const z = document.querySelector('#wb-liste .wb-z');
    const p = z.querySelector('.wb-p').getBoundingClientRect();
    const s = z.querySelector('.wb-s').getBoundingClientRect();
    return p.top < s.top && p.bottom <= s.top + 1;
  }));
check('KRITISCH: kein waagrechter Scroll am Desktop',
  await gross.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
