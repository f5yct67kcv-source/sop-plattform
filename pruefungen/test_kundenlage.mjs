// Kunden-Uebersicht (ENT-555) -- das Geldbild und die Startseite des
// Kundenbereichs am Desktop.
//
// Vier Dinge haelt diese Suite scharf:
//
// 1. UNBEKANNT SIEHT NICHT WIE KEINE AUS. Eine unbezahlte Rechnung OHNE
//    Faelligkeitsdatum ist weder faellig noch nicht faellig. Sie darf weder
//    stillschweigend zu den nicht faelligen wandern noch als ueberfaellig
//    gezaehlt werden -- sie bekommt ein eigenes Band. Dieselbe Familie fuer
//    bezahlte Rechnungen ohne Zahldatum und Offerten ohne "Gueltig bis".
//
// 2. DER STARTREITER HAENGT AN DREI DINGEN, NICHT AN EINEM. Desktop mit
//    Belegrecht -> Uebersicht. Handy -> Adressen (ENT-399, Anruf-Szenario).
//    Ohne 'offerten_lesen' -> Adressen, und der Menuepunkt fehlt ganz; die
//    Seite besteht nur aus Betraegen.
//
// 3. DIE ZAHLEN SIND ABGELEITET, NICHT ROH. Offen, ueberfaellig, Altersband
//    und "bezahlt im Monat" entstehen aus denselben zwei Listen, die der
//    Bereich ohnehin laedt. Archivierte Belege zaehlen nirgends mit.
//
// 4. DIE GESTALTUNG WIRD GEMESSEN, NICHT NACHGELESEN. Beschriftung ueber
//    dem Wert, gleiche Schriftgroesse in allen vier Kacheln, und die
//    Balkenfarben greifen wirklich -- eine CSS-Regel gleicher Spezifitaet
//    weiter unten kann sie wirkungslos machen, ohne dass etwas kaputtgeht.
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const URL = `file://${WURZEL}/dashboard.html`;
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const tag = n => iso(new Date(Date.now() + n * 864e5));
// Kein festes Datum nahe beim heutigen Tag (test_datumsfest.mjs): Der
// Vormonat wird gerechnet, nicht geschrieben. Der 15. ist unempfindlich
// gegen unterschiedlich lange Monate.
const jetzt = new Date();
const MITTE_VORMONAT = iso(new Date(jetzt.getFullYear(), jetzt.getMonth() - 1, 15));

// ── Rechnungen ────────────────────────────────────────────────────────────
// Zusammengestellt, damit jedes Altersband genau einmal belegt ist -- und
// "31-60 Tage" ABSICHTLICH leer bleibt: Ein Band ohne Betrag muss als
// Stummel erscheinen und darf keine Alarmfarbe tragen.
const RECHNUNGEN = { status: 'ok', naechste_nummer: 'RE-0999', belege: [
  { id: 101, art: 'rechnung', nummer: 'RE-0101', kunde_id: 1, kunde_name: 'Muster AG',
    titel: 'Noch nicht faellig', datum: tag(-2), faellig_bis: tag(5),
    status: 'versendet', bezahlt: 0, bezahlt_am: null, total_rappen: 30000, aktiv: 1 },
  { id: 102, art: 'rechnung', nummer: 'RE-0102', kunde_id: 2, kunde_name: 'Klinik Musterberg',
    titel: 'Zehn Tage drueber', datum: tag(-40), faellig_bis: tag(-10),
    status: 'versendet', bezahlt: 0, bezahlt_am: null, total_rappen: 50000, aktiv: 1 },
  { id: 104, art: 'rechnung', nummer: 'RE-0104', kunde_id: 3, kunde_name: 'abc consulting gmbh',
    titel: 'Neunzig Tage drueber', datum: tag(-120), faellig_bis: tag(-90),
    status: 'versendet', bezahlt: 0, bezahlt_am: null, total_rappen: 90000, aktiv: 1 },
  // Der Kernfall: unbezahlt, ohne Faelligkeitsdatum. Weder faellig noch nicht.
  { id: 105, art: 'rechnung', nummer: 'RE-0105', kunde_id: 1, kunde_name: 'Muster AG',
    titel: 'Ohne Frist', datum: tag(-30), faellig_bis: null,
    status: 'versendet', bezahlt: 0, bezahlt_am: null, total_rappen: 110000, aktiv: 1 },
  // Fuenf kleine, damit die Liste ueber ihre sechs Zeilen hinauslaeuft.
  ...[1, 2, 3, 4, 5].map(n => ({
    id: 110 + n, art: 'rechnung', nummer: 'RE-01' + (10 + n), kunde_id: 2,
    kunde_name: 'Klinik Musterberg', titel: 'Kleinbetrag ' + n, datum: tag(-30),
    faellig_bis: tag(-n), status: 'versendet', bezahlt: 0, bezahlt_am: null,
    total_rappen: 1000, aktiv: 1 })),
  { id: 106, art: 'rechnung', nummer: 'RE-0106', kunde_id: 1, kunde_name: 'Muster AG',
    titel: 'Diesen Monat bezahlt', datum: tag(-20), faellig_bis: tag(-5),
    status: 'versendet', bezahlt: 1, bezahlt_am: tag(0), total_rappen: 20000, aktiv: 1 },
  { id: 107, art: 'rechnung', nummer: 'RE-0107', kunde_id: 1, kunde_name: 'Muster AG',
    titel: 'Vormonat bezahlt', datum: tag(-60), faellig_bis: tag(-45),
    status: 'versendet', bezahlt: 1, bezahlt_am: MITTE_VORMONAT, total_rappen: 10000, aktiv: 1 },
  // Bezahlt, aber ohne Zahldatum -- keinem Monat zuzuordnen.
  { id: 108, art: 'rechnung', nummer: 'RE-0108', kunde_id: 1, kunde_name: 'Muster AG',
    titel: 'Bezahlt ohne Datum', datum: tag(-70), faellig_bis: tag(-55),
    status: 'versendet', bezahlt: 1, bezahlt_am: null, total_rappen: 5000, aktiv: 1 },
  // Archiviert: darf in KEINER Summe auftauchen. Der Betrag ist absichtlich
  // gross genug, dass ein Mitzaehlen sofort auffiele.
  { id: 109, art: 'rechnung', nummer: 'RE-0109', kunde_id: 1, kunde_name: 'Muster AG',
    titel: 'Archiviert', datum: tag(-260), faellig_bis: tag(-200),
    status: 'versendet', bezahlt: 0, bezahlt_am: null, total_rappen: 999999, aktiv: 0 },
]};

// ── Offerten ──────────────────────────────────────────────────────────────
const OFFERTEN = { status: 'ok', naechste_nummer: 'OF-0999', belege: [
  { id: 201, art: 'offerte', nummer: 'OF-0201', kunde_id: 1, kunde_name: 'Muster AG',
    titel: 'Laeuft in zehn Tagen ab', datum: tag(-5), gueltig_bis: tag(10),
    status: 'versendet', total_rappen: 40000, aktiv: 1 },
  { id: 202, art: 'offerte', nummer: 'OF-0202', kunde_id: 2, kunde_name: 'Klinik Musterberg',
    titel: 'Seit drei Tagen abgelaufen', datum: tag(-40), gueltig_bis: tag(-3),
    status: 'angeschaut', total_rappen: 60000, aktiv: 1 },
  { id: 203, art: 'offerte', nummer: 'OF-0203', kunde_id: 3, kunde_name: 'abc consulting gmbh',
    titel: 'Laeuft erst in 200 Tagen ab', datum: tag(-5), gueltig_bis: tag(200),
    status: 'versendet', total_rappen: 80000, aktiv: 1 },
  { id: 204, art: 'offerte', nummer: 'OF-0204', kunde_id: 1, kunde_name: 'Muster AG',
    titel: 'Ohne Gueltigkeitsdatum', datum: tag(-5), gueltig_bis: null,
    status: 'versendet', total_rappen: 15000, aktiv: 1 },
  // Entwurf liegt nicht beim Kunden, bestaetigt ist entschieden, archiviert
  // ist aus dem Verkehr -- keine der drei zaehlt als offen.
  { id: 205, art: 'offerte', nummer: 'OF-0205', kunde_id: 1, kunde_name: 'Muster AG',
    titel: 'Entwurf', datum: tag(-5), gueltig_bis: tag(10),
    status: 'entwurf', total_rappen: 999900, aktiv: 1 },
  { id: 206, art: 'offerte', nummer: 'OF-0206', kunde_id: 1, kunde_name: 'Muster AG',
    titel: 'Bestaetigt', datum: tag(-5), gueltig_bis: tag(10),
    status: 'bestaetigt', total_rappen: 888800, aktiv: 1 },
  { id: 207, art: 'offerte', nummer: 'OF-0207', kunde_id: 1, kunde_name: 'Muster AG',
    titel: 'Archiviert', datum: tag(-5), gueltig_bis: tag(10),
    status: 'versendet', total_rappen: 777700, aktiv: 0 },
]};

const KU = { status: 'ok', kunden: [
  { id: 1, name: 'Muster AG', kundennummer: 'A0001', aktiv: 1, personen: [], kontaktwege: [] },
  { id: 2, name: 'Klinik Musterberg', kundennummer: 'A0071', aktiv: 1, personen: [], kontaktwege: [] },
  { id: 3, name: 'abc consulting gmbh', kundennummer: 'A0228', aktiv: 1, personen: [], kontaktwege: [] },
]};
const STATS = { status: 'ok',
  kpi: { rapporte_monat: 0, rapporte_vormonat: 0, stunden_monat: 0, stunden_vormonat: 0,
         mitarbeiter: 0, kunden: 0, rapporte_total: 0 },
  verlauf: [], angemeldet: [], letzte_rapporte: [], ereignisse: [], ereignisse_unvollstaendig: [],
  pro_mitarbeiter: [] };

const VOLLRECHTE = ['kunden_lesen', 'kunden_schreiben', 'abgleich_lesen', 'einsaetze_lesen',
  'objekte_lesen', 'masterschichten_lesen', 'offerten_lesen', 'offerten_schreiben',
  'leistungen_lesen', 'personal_lesen', 'betrieb_lesen'];
// Adressen ja, Belege nein -- der Fall, fuer den es kuStartReiter() gibt.
const OHNE_BELEGE = VOLLRECHTE.filter(r => !r.startsWith('offerten_'));

// Eine angemeldete Seite mit den gewuenschten Rechten und Belegen.
async function seite(browser, { rechte = VOLLRECHTE, viewport = { width: 1500, height: 1000 },
                                rechnungen = RECHNUNGEN, offerten = OFFERTEN } = {}) {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
  await page.route('**/api/**', async route => {
    const url = route.request().url();
    const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    // Die Rechte muessen SCHON in der Login-Antwort stehen: enter() entscheidet
    // daran, ob das Cockpit oder die Mitarbeiter-App geoeffnet wird. Nur in
    // me.php genuegt nicht -- die Sitzung landete sonst in der App.
    if (url.includes('login.php')) return send({ status: 'ok', token: 't', name: 'adrian', ist_admin: false, rollen: [], rechte });
    if (url.includes('me.php')) return send({ status: 'ok', name: 'adrian', ist_admin: false, rollen: [], rechte });
    if (url.includes('beleg_list')) {
      const art = new URLSearchParams(url.split('?')[1] || '').get('art') || 'offerte';
      return send(art === 'rechnung' ? rechnungen : offerten);
    }
    if (url.includes('kunden_list')) return send(KU);
    if (url.includes('dashboard_stats')) return send(STATS);
    return send({ status: 'ok' });
  });
  await page.goto(URL);
  await page.fill('#gName', 'adrian'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
  await page.waitForSelector('#shell.on');
  await page.waitForTimeout(400);
  return page;
}

const browser = await chromium.launch({ executablePath: browserPfad() });

// ══════════════════════════════════════════ 1. NAVIGATION UND STARTREITER
const page = await seite(browser);
try {
  await page.click('#nav-kunden');
  await page.waitForTimeout(400);

  check('Der Punkt "Übersicht" steht in der Kunden-Gruppe',
    await page.isVisible('#nav-kunden-lage'));
  check('KRITISCH: "Übersicht" steht VOR "Adressen"',
    await page.evaluate(() => {
      const k = [...document.querySelectorAll('#navg-kunden .nav-kind')];
      return k.length > 1 && k[0].id === 'nav-kunden-lage' && k[1].id === 'nav-kunden-uebersicht';
    }));
  check('Der Punkt heisst "Übersicht", nicht "Lage" oder "Cockpit"',
    (await page.textContent('#nav-kunden-lage') || '').trim() === 'Übersicht');
  check('KRITISCH: ein Klick auf "Kunden" landet auf der Übersicht, nicht auf Adressen',
    (await page.getAttribute('#kv-lage', 'class') || '').includes('on')
    && !(await page.getAttribute('#kv-uebersicht', 'class') || '').includes('on'));
  check('"Adressen" ist weiterhin erreichbar und heisst weiterhin so',
    (await page.textContent('#nav-kunden-uebersicht') || '').trim() === 'Adressen');

  // Der Reiter "uebersicht" bleibt die Adressliste -- wer ihn umbenannt
  // haette, braeche zwoelf andere Suiten, die kuGoTab('uebersicht') rufen.
  await page.click('#nav-kunden-uebersicht');
  await page.waitForTimeout(250);
  check('KRITISCH: kuGoTab("uebersicht") zeigt weiterhin die Adressliste',
    (await page.getAttribute('#kv-uebersicht', 'class') || '').includes('on')
    && await page.isVisible('#kuTable'));
} catch (e) { bad.push('Navigation: ' + String(e).split('\n')[0].slice(0, 160)); }

// ══════════════════════════════════════════ 2. DIE ZAHLEN
try {
  await page.click('#nav-kunden-lage');
  await page.waitForTimeout(500);

  const kpi = await page.evaluate(() => [...document.querySelectorAll('#kuLageKpi .kpi')].map(k => ({
    l: k.querySelector('.kpi-top span').textContent.trim(),
    v: k.querySelector('.kpi-val').textContent.trim(),
    f: k.querySelector('.kpi-foot').textContent.trim(),
  })));

  check('Vier Kennzahlen stehen oben', kpi.length === 4);
  // 30000 + 50000 + 90000 + 110000 + 5*1000 = 285000 Rappen.
  check('KRITISCH: der offene Betrag ist CHF 2’850.00 (archivierte zaehlen nicht mit)',
    /CHF/.test(kpi[0].v) && /2['’]850\.00/.test(kpi[0].v));
  check('Der offene Betrag nennt die Anzahl dahinter', /aus 9 Rechnungen/.test(kpi[0].f));
  // 50000 + 90000 + 5*1000 = 145000. OHNE die Rechnung ohne Faelligkeitsdatum.
  check('KRITISCH: ueberfaellig ist CHF 1’450.00 -- die Rechnung OHNE Frist zaehlt NICHT mit',
    /1['’]450\.00/.test(kpi[1].v));
  check('GEGENPROBE: ueberfaellig ist nicht die Summe inkl. der fristlosen Rechnung (2’550.00)',
    !/2['’]550\.00/.test(kpi[1].v));
  check('Die ueberfaellige Kachel nennt Anzahl und Alter der aeltesten',
    /7 Rechnungen/.test(kpi[1].f) && /aelteste seit 90 Tagen/.test(kpi[1].f.replace(/ä/g, 'ae')));
  check('KRITISCH: die Kachel heisst "Davon überfällig" -- eine Teilmenge braucht ihren Bezug',
    kpi[1].l === 'Davon überfällig');
  // 40000 + 60000 + 80000 + 15000 = 195000. Entwurf, bestaetigt, archiviert draussen.
  check('KRITISCH: offene Offerten sind CHF 1’950.00 (Entwurf/bestaetigt/archiviert draussen)',
    /1['’]950\.00/.test(kpi[2].v));
  check('Die Offertenkachel nennt Anzahl und wieviele bald ablaufen',
    /4 Offerten/.test(kpi[2].f) && /2 laufen bald ab/.test(kpi[2].f));
  check('KRITISCH: bezahlt im Monat ist CHF 200.00, der Vormonat CHF 100.00',
    /200\.00/.test(kpi[3].v) && /Vormonat CHF 100\.00/.test(kpi[3].f));
  check('KRITISCH: die bezahlte Rechnung OHNE Zahldatum wird genannt, nicht verschwiegen',
    /1 ohne Zahldatum/.test(kpi[3].f));
} catch (e) { bad.push('Kennzahlen: ' + String(e).split('\n')[0].slice(0, 160)); }

// ══════════════════════════════════════════ 3. DAS ALTERSBILD
try {
  const baender = await page.evaluate(() => [...document.querySelectorAll('#kuLageAlter .bar')].map(b => ({
    lbl: b.querySelector('.bar-lbl').textContent.trim(),
    val: b.querySelector('.bar-val').textContent.trim(),
    cls: b.querySelector('.bar-fill').className,
    bg:  getComputedStyle(b.querySelector('.bar-fill')).backgroundColor,
  })));

  check('Fuenf Altersbaender in der erwarteten Reihenfolge',
    baender.map(b => b.lbl).join('|') === 'Noch nicht fällig|1–30 Tage|31–60 Tage|über 60 Tage|Ohne Datum');
  check('KRITISCH: "Ohne Datum" traegt die CHF 1’100.00 der fristlosen Rechnung',
    /1['’]100\.00/.test(baender[4].val));
  check('KRITISCH: "Noch nicht faellig" traegt nur die CHF 300.00 -- die fristlose wandert NICHT hierher',
    /^300\.00$/.test(baender[0].val));
  check('Das Band "1-30 Tage" summiert die sechs jungen Rechnungen zu CHF 550.00',
    /^550\.00$/.test(baender[1].val));
  check('Das Band "ueber 60 Tage" traegt CHF 900.00', /^900\.00$/.test(baender[3].val));

  // Gemessen, nicht nachgelesen: Ein leeres Band ist ein Stummel OHNE
  // Alarmfarbe -- null Franken rot einzufaerben waere ein Alarm ohne Anlass.
  check('KRITISCH: das leere Band "31-60 Tage" ist ein Stummel und traegt keine Warnfarbe',
    baender[2].cls.includes('leer') && !baender[2].cls.includes('warn') && baender[2].val === '');
  check('KRITISCH: "Ohne Datum" ist NICHT als leer markiert -- unbekannt ist nicht null',
    !baender[4].cls.includes('unbekannt-leer') && !baender[4].cls.includes('leer')
    && baender[4].cls.includes('unbekannt'));

  // Die CSS-Regeln greifen wirklich: gemessene Farben, nicht gelesene Klassen.
  check('KRITISCH: die Farbe von "ueber 60 Tage" unterscheidet sich gemessen von "noch nicht faellig"',
    baender[3].bg !== baender[0].bg);
  check('KRITISCH: "Ohne Datum" ist gemessen unbunt und unterscheidet sich von beiden',
    baender[4].bg !== baender[0].bg && baender[4].bg !== baender[3].bg);

  // Gegenprobe zur Spezifitaetsfalle: ".bar:hover .bar-fill" hat dieselbe
  // Eigenspezifitaet wie ".bar-fill.neg" und koennte die Farbe beim
  // Ueberfahren stillschweigend ueberschreiben.
  const vorher = baender[3].bg;
  await page.hover('#kuLageAlter .bar:nth-child(4)');
  await page.waitForTimeout(120);
  const nachher = await page.evaluate(() =>
    getComputedStyle(document.querySelectorAll('#kuLageAlter .bar')[3].querySelector('.bar-fill')).backgroundColor);
  check('KRITISCH: die Balkenfarbe ueberlebt das Ueberfahren (Spezifitaet der Hover-Regel)',
    nachher === vorher);

  // Gegenprobe: Die Zuordnung wird wirklich gemessen und nicht gegen einen
  // festen Text geprueft -- bekommt dieselbe Rechnung eine Frist, wandert
  // ihr Betrag aus "Ohne Datum" nach "Noch nicht faellig".
  const gewandert = await page.evaluate(() => {
    const r = rechnungen.find(x => Number(x.id) === 105);
    const alt = r.faellig_bis;
    r.faellig_bis = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
    renderKundenLage();
    const b = [...document.querySelectorAll('#kuLageAlter .bar')];
    const erg = { ohne: b[4].querySelector('.bar-val').textContent.trim(),
                  offen: b[0].querySelector('.bar-val').textContent.trim() };
    r.faellig_bis = alt;
    renderKundenLage();
    return erg;
  });
  check('GEGENPROBE: mit Frist wandert der Betrag nach "noch nicht faellig" (1’400.00) und "Ohne Datum" wird leer',
    gewandert.ohne === '' && /1['’]400\.00/.test(gewandert.offen));
} catch (e) { bad.push('Altersbild: ' + String(e).split('\n')[0].slice(0, 160)); }

// ══════════════════════════════════════════ 4. DIE BEIDEN LISTEN
try {
  const mahn = await page.evaluate(() => ({
    note: document.getElementById('kuLageMahnNote').textContent.trim(),
    zeilen: [...document.querySelectorAll('#kuLageMahn tbody tr')].map(t => t.innerText.replace(/\s+/g, ' ').trim()),
  }));
  check('KRITISCH: die gekuerzte Mahnliste nennt ihren Bezug ("die aeltesten 6 von 7")',
    /die ältesten 6 von 7/.test(mahn.note));
  check('Die Mahnliste zeigt sechs Zeilen', mahn.zeilen.length === 6);
  check('KRITISCH: die aelteste steht oben', /RE-0104/.test(mahn.zeilen[0]) && /90 Tage/.test(mahn.zeilen[0]));
  check('KRITISCH: die Rechnung ohne Faelligkeitsdatum steht NICHT in der Mahnliste',
    !mahn.zeilen.some(z => /RE-0105/.test(z)));
  check('Die archivierte Rechnung steht nicht in der Mahnliste',
    !mahn.zeilen.some(z => /RE-0109/.test(z)));

  const off = await page.evaluate(() => ({
    note: document.getElementById('kuLageOfNote').textContent.trim(),
    zeilen: [...document.querySelectorAll('#kuLageOf tbody tr')].map(t => t.innerText.replace(/\s+/g, ' ').trim()),
  }));
  check('KRITISCH: die Offerte ohne "Gueltig bis" wird im Kartenkopf genannt, statt lautlos zu fehlen',
    /1 ohne Gültigkeitsdatum/.test(off.note));
  check('Zwei Offerten laufen bald ab oder sind es schon', off.zeilen.length === 2);
  check('KRITISCH: "abgelaufen" und "laeuft ab" sind zwei verschiedene Texte',
    /seit 3 Tagen abgelaufen/.test(off.zeilen[0]) && /noch 10 Tage/.test(off.zeilen[1]));
  check('Die Offerte mit 200 Tagen Restlaufzeit steht nicht in der Liste',
    !off.zeilen.some(z => /OF-0203/.test(z)));
  check('Entwurf und bestaetigte Offerte stehen nicht in der Liste',
    !off.zeilen.some(z => /OF-0205|OF-0206/.test(z)));
} catch (e) { bad.push('Listen: ' + String(e).split('\n')[0].slice(0, 160)); }

// ══════════════════════════════════════════ 5. GESTALTUNG, GEMESSEN
try {
  const mass = await page.evaluate(() => {
    const k = [...document.querySelectorAll('#kuLageKpi .kpi')];
    const g = k.map(x => ({
      lblTop: x.querySelector('.kpi-top').getBoundingClientRect().top,
      valTop: x.querySelector('.kpi-val').getBoundingClientRect().top,
      valSize: getComputedStyle(x.querySelector('.kpi-val')).fontSize,
    }));
    const karten = [...document.querySelectorAll('#kv-lage .g-1-1 > .card')];
    return { g, breiten: karten.map(c => Math.round(c.getBoundingClientRect().width)),
             waehrung: getComputedStyle(k[0].querySelector('.kpi-val .waehrung')).fontSize,
             wert: getComputedStyle(k[0].querySelector('.kpi-val')).fontSize };
  });
  check('KRITISCH: in jeder Kachel steht die Beschriftung ueber dem Wert',
    mass.g.every(x => x.lblTop < x.valTop));
  check('KRITISCH: alle vier Kacheln tragen dieselbe Schriftgroesse im Wert',
    new Set(mass.g.map(x => x.valSize)).size === 1);
  check('Die beiden Karten nebeneinander sind gleich breit',
    mass.breiten.length === 2 && Math.abs(mass.breiten[0] - mass.breiten[1]) <= 1);
  check('KRITISCH: "CHF" ist gemessen kleiner als die Zahl -- die Regel greift wirklich',
    parseFloat(mass.waehrung) < parseFloat(mass.wert));
  // Gemessen aufgefallen: Der laengere Fusstext dieser Kacheln liess die
  // Delta-Pille schrumpfen, bis sie in sich umbrach -- "100" ueber "%".
  const pille = await page.evaluate(() => {
    const d = document.querySelector('#kuLageKpi .kpi:nth-child(4) .delta');
    if (!d) { return null; }
    const r = d.getBoundingClientRect();
    return { h: r.height, zeile: parseFloat(getComputedStyle(d).fontSize) };
  });
  check('KRITISCH: die Delta-Pille bricht nicht in sich um (gemessen, eine Zeile)',
    pille !== null && pille.h < pille.zeile * 2.2);
} catch (e) { bad.push('Gestaltung: ' + String(e).split('\n')[0].slice(0, 160)); }

await page.close();

// ══════════════════════════════════════════ 6. OHNE BELEGRECHT
try {
  const p2 = await seite(browser, { rechte: OHNE_BELEGE });
  await p2.click('#nav-kunden');
  await p2.waitForTimeout(400);
  check('KRITISCH: ohne "offerten_lesen" fehlt der Menuepunkt "Übersicht"',
    !(await p2.isVisible('#nav-kunden-lage')));
  check('KRITISCH: ohne "offerten_lesen" startet der Bereich auf Adressen, nicht auf einer leeren Uebersicht',
    (await p2.getAttribute('#kv-uebersicht', 'class') || '').includes('on')
    && !(await p2.getAttribute('#kv-lage', 'class') || '').includes('on'));
  check('Der Kundenbereich selbst bleibt erreichbar', await p2.isVisible('#kuTable'));
  await p2.close();
} catch (e) { bad.push('Ohne Belegrecht: ' + String(e).split('\n')[0].slice(0, 160)); }

// ══════════════════════════════════════════ 7. AM HANDY
try {
  const p3 = await seite(browser, { viewport: { width: 390, height: 840 } });
  // Am Handy ist die Seitenleiste eine Schublade -- sie muss erst auf.
  await p3.click('.btn-burger');
  await p3.waitForTimeout(400);
  await p3.click('#nav-kunden');
  await p3.waitForTimeout(500);
  check('KRITISCH: am Handy fuehrt "Kunden" weiterhin auf Adressen (ENT-399, Anruf-Szenario)',
    (await p3.getAttribute('#kv-uebersicht', 'class') || '').includes('on')
    && !(await p3.getAttribute('#kv-lage', 'class') || '').includes('on'));
  check('KRITISCH: die Uebersicht steht nicht in der mobilen Reiterleiste',
    await p3.evaluate(() => ![...document.querySelectorAll('#kuMobilTabs .tab')]
      .some(b => b.textContent.trim() === 'Übersicht')));
  await p3.close();
} catch (e) { bad.push('Handy: ' + String(e).split('\n')[0].slice(0, 160)); }

// ══════════════════════════════════════════ 8. VIER LEERZUSTAENDE
// "Nichts erfasst", "alles bezahlt", "nichts ueberfaellig" und "kein Treffer"
// sind vier verschiedene Aussagen und brauchen vier verschiedene Texte.
try {
  const leer = { status: 'ok', naechste_nummer: 'X', belege: [] };
  const p4 = await seite(browser, { rechnungen: leer, offerten: leer });
  await p4.click('#nav-kunden');
  await p4.waitForTimeout(500);
  check('KRITISCH: ganz ohne Rechnungen steht "Noch keine Rechnungen", nicht "Alles bezahlt"',
    /Noch keine Rechnungen/.test(await p4.textContent('#kuLageAlter'))
    && /Noch keine Rechnungen/.test(await p4.textContent('#kuLageMahn')));
  check('KRITISCH: ganz ohne Offerten steht "Noch keine Offerten"',
    /Noch keine Offerten/.test(await p4.textContent('#kuLageOf')));
  await p4.close();

  const nurBezahlt = { status: 'ok', naechste_nummer: 'X', belege: [
    { id: 301, art: 'rechnung', nummer: 'RE-0301', kunde_id: 1, kunde_name: 'Muster AG',
      titel: 'Bezahlt', datum: tag(-20), faellig_bis: tag(-5),
      status: 'versendet', bezahlt: 1, bezahlt_am: tag(0), total_rappen: 5000, aktiv: 1 }]};
  const p5 = await seite(browser, { rechnungen: nurBezahlt, offerten: { status: 'ok', naechste_nummer: 'X', belege: [] } });
  await p5.click('#nav-kunden');
  await p5.waitForTimeout(500);
  check('KRITISCH: sind alle Rechnungen bezahlt, steht "Alles bezahlt" -- nicht "Noch keine Rechnungen"',
    /Alles bezahlt/.test(await p5.textContent('#kuLageMahn')));
  await p5.close();

  const keineUeber = { status: 'ok', naechste_nummer: 'X', belege: [
    { id: 401, art: 'rechnung', nummer: 'RE-0401', kunde_id: 1, kunde_name: 'Muster AG',
      titel: 'Noch Zeit', datum: tag(-2), faellig_bis: tag(20),
      status: 'versendet', bezahlt: 0, bezahlt_am: null, total_rappen: 7000, aktiv: 1 }]};
  const p6 = await seite(browser, { rechnungen: keineUeber, offerten: { status: 'ok', naechste_nummer: 'X', belege: [] } });
  await p6.click('#nav-kunden');
  await p6.waitForTimeout(500);
  check('KRITISCH: offen aber in der Frist heisst "Nichts ueberfaellig" -- nicht "Alles bezahlt"',
    /Nichts überfällig/.test(await p6.textContent('#kuLageMahn')));
  check('Das Altersbild zeigt dann trotzdem Balken, nicht einen Leerzustand',
    (await p6.evaluate(() => document.querySelectorAll('#kuLageAlter .bar').length)) === 5);
  await p6.close();
} catch (e) { bad.push('Leerzustaende: ' + String(e).split('\n')[0].slice(0, 160)); }

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
