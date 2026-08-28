// Rechnungen-Reiter: Grundgeruest (ENT-181).
//
// Bewusst schlank: es gibt noch keine Erfassungsmaske, nur die Liste --
// derselbe Aufbau wie bei den Offerten (Alle/Archiviert, Suche, Statusfilter,
// sortierbare Tabelle), aber mit eigenem Bestand. Das Wichtigste, was diese
// Suite absichern muss: die Rechnungen-Liste ruft wirklich art=rechnung ab
// und zeigt NICHT versehentlich die Offerten-Daten, weil beide durch dieselbe
// belege-Tabelle bedient werden und ein falscher oder fehlender Art-Filter
// im Server sich hier zuerst zeigen wuerde.
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const URL = `file://${WURZEL}/dashboard.html`;
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const tag = n => iso(new Date(Date.now() + n * 864e5));

const OFFERTEN = { status: 'ok', naechste_nummer: 'OF-0002', belege: [
  { id: 1, art: 'offerte', nummer: 'OF-0001', kunde_id: 1, kunde_name: 'Muster AG', kundennummer: 'A0001',
    titel: 'Sollte hier NIE erscheinen', referenz: null, datum: tag(-5), gueltig_bis: tag(25),
    status: 'versendet', total_rappen: 100000, aktiv: 1, ist_vorlage: 0 },
]};
const RECHNUNGEN = { status: 'ok', naechste_nummer: 'RE-0951', belege: [
  { id: 101, art: 'rechnung', nummer: 'RE0950', kunde_id: 2, kunde_name: 'Klinik Arlesheim', kundennummer: 'A0071',
    titel: 'Baustelle Klinik Arlesheim', referenz: null, datum: tag(-1), status: 'versendet',
    total_rappen: 333645, aktiv: 1, ist_vorlage: 0 },
  { id: 102, art: 'rechnung', nummer: 'RE0948', kunde_id: 3, kunde_name: 'pzu consulting gmbh', kundennummer: 'A0228',
    titel: 'test', referenz: 'REF-9', datum: tag(-1), status: 'entwurf',
    total_rappen: 45400, aktiv: 1, ist_vorlage: 0 },
  { id: 103, art: 'rechnung', nummer: 'RE0900', kunde_id: 2, kunde_name: 'Klinik Arlesheim', kundennummer: 'A0071',
    titel: 'Archiviertes', referenz: null, datum: '2026-06-01', status: 'bestaetigt',
    total_rappen: 12000, aktiv: 0, ist_vorlage: 0 },
]};
const KU = { status: 'ok', kunden: [
  { id: 1, name: 'Muster AG', kundennummer: 'A0001', aktiv: 1, personen: [], kontaktwege: [] },
  { id: 2, name: 'Klinik Arlesheim', kundennummer: 'A0071', aktiv: 1, personen: [], kontaktwege: [] },
  { id: 3, name: 'pzu consulting gmbh', kundennummer: 'A0228', aktiv: 1, personen: [], kontaktwege: [] },
]};
const STATS = { status: 'ok',
  kpi: { rapporte_monat: 0, rapporte_vormonat: 0, stunden_monat: 0, stunden_vormonat: 0,
         mitarbeiter: 0, kunden: 0, rapporte_total: 0 },
  verlauf: [], angemeldet: [], letzte_rapporte: [], ereignisse: [], ereignisse_unvollstaendig: [],
  pro_mitarbeiter: [] };

let belegListArten = [];

const browser = await chromium.launch({ executablePath: browserPfad() });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
await page.route('**/api/**', async route => {
  const url = route.request().url();
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (url.includes('login.php')) return send({ status: 'ok', token: 't', name: 'adrian', ist_admin: true });
  if (url.includes('me.php')) return send({ status: 'ok', name: 'adrian', ist_admin: true, rollen: [],
    rechte: ['kunden', 'abgleich', 'personal_lesen', 'betrieb', 'plan', 'offerten', 'rechte'] });
  if (url.includes('beleg_list')) {
    const art = new URLSearchParams(url.split('?')[1] || '').get('art') || 'offerte';
    belegListArten.push(art);
    return send(art === 'rechnung' ? RECHNUNGEN : OFFERTEN);
  }
  if (url.includes('kunden_list')) return send(KU);
  if (url.includes('dashboard_stats')) return send(STATS);
  return send({ status: 'ok' });
});

await page.goto(URL);
await page.fill('#gName', 'adrian'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#shell.on');
await page.waitForTimeout(400);

await page.click('#nav-kunden');
await page.waitForTimeout(150);

try {
  check('Der Reiter "Rechnungen" steht neben "Offerten" in der Kunden-Gruppe',
    await page.isVisible('#nav-kunden-rechnungen'));

  await page.click('#nav-kunden-rechnungen');
  await page.waitForTimeout(300);
  check('KRITISCH: der Klick oeffnet die Rechnungen-Ansicht',
    (await page.getAttribute('#kv-rechnungen', 'class') || '').includes('on'));
  check('Der Reiter ist als aktiv markiert', (await page.getAttribute('#nav-kunden-rechnungen', 'class') || '').includes('on'));
  check('Die Kopfzeile nennt "Rechnungen"', (await page.textContent('#pgCrumb')) === 'Rechnungen an Kunden');

  check('KRITISCH: die Liste ruft wirklich art=rechnung ab, nicht art=offerte',
    belegListArten.includes('rechnung'));

  const zeilen = await page.$$eval('#reTable tbody tr', tr => tr.map(r => r.textContent.replace(/\s+/g, ' ').trim()));
  check('KRITISCH: es stehen nur die aktiven Rechnungen da, nicht die Offerten',
    zeilen.length === 2 && zeilen.every(z => !/Sollte hier NIE erscheinen/.test(z)));
  check('Nummer und Empfaenger stehen wie geliefert da',
    zeilen.some(z => /RE0950/.test(z) && /Klinik Arlesheim/.test(z)));
  check('Der Betrag steht als CHF mit Tausendertrennzeichen da',
    zeilen.some(z => /CHF 3['’]336\.45/.test(z)));

  // Archiviert
  await page.click('#reatab-archiv'); await page.waitForTimeout(150);
  const archivZeilen = await page.$$eval('#reTable tbody tr', tr => tr.map(r => r.textContent.replace(/\s+/g, ' ').trim()));
  check('KRITISCH: "Archiviert" zeigt die inaktive Rechnung, nicht die aktiven',
    archivZeilen.length === 1 && /RE0900/.test(archivZeilen[0]));
  await page.click('#reatab-alle'); await page.waitForTimeout(150);

  // Suche
  await page.fill('#reQ', 'test'); await page.waitForTimeout(150);
  const suchZeilen = await page.$$eval('#reTable tbody tr', tr => tr.map(r => r.textContent.replace(/\s+/g, ' ').trim()));
  check('KRITISCH: die Suche filtert auf Titel/Nummer/Empfaenger',
    suchZeilen.length === 1 && /RE0948/.test(suchZeilen[0]));
  await page.fill('#reQ', ''); await page.waitForTimeout(150);

  // Statusfilter nur mit tatsaechlich vorhandenen Werten befuellt
  const statusOptionen = await page.$$eval('#reStatus option', o => o.map(x => x.value));
  check('Der Statusfilter zeigt nur vorkommende Status, keinen erfundenen',
    statusOptionen.includes('versendet') && statusOptionen.includes('entwurf') && !statusOptionen.includes('abgelehnt'));

  // Sortierung
  await page.click('#reTable th:has-text("Betrag")'); await page.waitForTimeout(150);
  const nachBetrag = await page.$$eval('#reTable tbody tr', tr => tr.map(r => r.textContent));
  check('Ein Klick auf "Betrag" sortiert die Liste um',
    /RE0948/.test(nachBetrag[0]) || /RE0950/.test(nachBetrag[0]));

  check('KEIN "Rechnung erstellen"-Knopf ohne Erfassungsmaske dahinter -- Grundgeruest, kein Vorgriff',
    (await page.$$('#kv-rechnungen button:has-text("Rechnung erstellen")')).length === 0);

  // Die beiden Listen (Offerten/Rechnungen) duerfen sich nicht gegenseitig
  // ueberschreiben -- Grund fuer eigene Variablen (rechnungen vs. belege).
  await page.click('#nav-kunden-offerten'); await page.waitForTimeout(200);
  const ofZeilen = await page.$$eval('#ofTable tbody tr', tr => tr.map(r => r.textContent.replace(/\s+/g, ' ').trim()));
  check('KRITISCH: die Offerten-Liste bleibt unveraendert, nachdem Rechnungen geladen wurden',
    ofZeilen.length === 1 && /Sollte hier NIE erscheinen/.test(ofZeilen[0]));
  await page.click('#nav-kunden-rechnungen'); await page.waitForTimeout(200);
  const zurueck = await page.$$eval('#reTable tbody tr', tr => tr.map(r => r.textContent.replace(/\s+/g, ' ').trim()));
  check('Und umgekehrt bleibt die Rechnungen-Liste unveraendert',
    zurueck.length === 2);
} catch (e) { bad.push('Rechnungen-Grundgeruest: ' + String(e).split('\n')[0].slice(0, 160)); }

// Leerzustand: eine echte, aber leere Liste sagt "Noch keine Rechnungen",
// nicht "Keine Treffer" -- dieselbe Unterscheidung wie bei den Offerten.
try {
  const p2 = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  await p2.route('**/api/**', async route => {
    const url = route.request().url();
    const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (url.includes('login.php')) return send({ status: 'ok', token: 't', name: 'adrian', ist_admin: true });
    if (url.includes('me.php')) return send({ status: 'ok', name: 'adrian', ist_admin: true, rollen: [],
      rechte: ['kunden', 'abgleich', 'personal_lesen', 'betrieb', 'plan', 'offerten', 'rechte'] });
    if (url.includes('beleg_list')) return send({ status: 'ok', naechste_nummer: 'RE-0001', belege: [] });
    if (url.includes('kunden_list')) return send(KU);
    if (url.includes('dashboard_stats')) return send(STATS);
    return send({ status: 'ok' });
  });
  await p2.goto(URL);
  await p2.fill('#gName', 'adrian'); await p2.fill('#gPass', 'x'); await p2.click('#gBtn');
  await p2.waitForSelector('#shell.on'); await p2.waitForTimeout(400);
  await p2.click('#nav-kunden'); await p2.waitForTimeout(150);
  await p2.click('#nav-kunden-rechnungen'); await p2.waitForTimeout(300);
  check('KRITISCH: eine leere Rechnungsliste sagt "Noch keine Rechnungen", nicht "Keine Treffer"',
    /Noch keine Rechnungen/.test(await p2.textContent('#reTable')));
  await p2.close();
} catch (e) { bad.push('Leerzustand: ' + String(e).split('\n')[0].slice(0, 160)); }

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
