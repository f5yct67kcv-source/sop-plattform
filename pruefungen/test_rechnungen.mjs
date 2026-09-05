// Rechnungen-Reiter (ENT-181), Ausbaustufe nach dem Grundgeruest.
//
// Drei Dinge haelt diese Suite scharf:
//
// 1. DIE LISTE ZEIGT WIRKLICH RECHNUNGEN, NICHT OFFERTEN. Beide laufen durch
//    dieselbe belege-Tabelle -- ein falscher oder fehlender Art-Filter im
//    Server oder in der Liste selbst wuerde sich hier zuerst zeigen.
//
// 2. STATUS/FAELLIG/OFFENER BETRAG SIND ABGELEITET, NICHT ROH GESPEICHERT.
//    "Bezahlt" und "Ueberfaellig" ueberschreiben den rohen status-Wert in der
//    Anzeige; Offener Betrag ist entweder 0 oder der volle Betrag (einfache
//    bezahlt/nicht-bezahlt-Markierung, keine Teilzahlungen -- Entscheid des
//    Projektinhabers, 28.08.2026).
//
// 3. DAS GETEILTE FORMULAR VERWECHSELT DIE BEIDEN ARTEN NICHT. Offerten und
//    Rechnungen nutzen dieselbe Erfassungsmaske (Positionen, Rabatt, Summen,
//    Druck) -- eine neue Rechnung darf niemals als 'offerte' gespeichert
//    werden und umgekehrt, und die Beschriftungen (Rechnungsdatum/Faellig am
//    vs. Offertendatum/Gueltig bis) muessen zur gerade offenen Art passen.
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
  // Noch nicht faellig, unbezahlt.
  { id: 101, art: 'rechnung', nummer: 'RE0950', kunde_id: 2, kunde_name: 'Klinik Musterberg', kundennummer: 'A0071',
    titel: 'Baustelle Klinik Musterberg', referenz: null, datum: tag(-1), faellig_bis: tag(5),
    status: 'versendet', bezahlt: 0, bezahlt_am: null, total_rappen: 333645, aktiv: 1, ist_vorlage: 0 },
  // Ueberfaellig, unbezahlt.
  { id: 102, art: 'rechnung', nummer: 'RE0948', kunde_id: 3, kunde_name: 'abc consulting gmbh', kundennummer: 'A0228',
    titel: 'test', referenz: 'REF-9', datum: tag(-30), faellig_bis: tag(-3),
    status: 'versendet', bezahlt: 0, bezahlt_am: null, total_rappen: 45400, aktiv: 1, ist_vorlage: 0 },
  // Bezahlt -- "erledigt".
  { id: 103, art: 'rechnung', nummer: 'RE0940', kunde_id: 2, kunde_name: 'Klinik Musterberg', kundennummer: 'A0071',
    titel: 'Erledigte Rechnung', referenz: null, datum: tag(-20), faellig_bis: tag(-10),
    status: 'versendet', bezahlt: 1, bezahlt_am: tag(-2), total_rappen: 89000, aktiv: 1, ist_vorlage: 0 },
  // Archiviert.
  { id: 104, art: 'rechnung', nummer: 'RE0900', kunde_id: 2, kunde_name: 'Klinik Musterberg', kundennummer: 'A0071',
    titel: 'Archiviertes', referenz: null, datum: '2026-06-01', faellig_bis: '2026-06-15',
    status: 'entwurf', bezahlt: 0, bezahlt_am: null, total_rappen: 12000, aktiv: 0, ist_vorlage: 0 },
]};
const KU = { status: 'ok', kunden: [
  { id: 1, name: 'Muster AG', kundennummer: 'A0001', aktiv: 1, personen: [], kontaktwege: [] },
  { id: 2, name: 'Klinik Musterberg', kundennummer: 'A0071', aktiv: 1, personen: [], kontaktwege: [] },
  { id: 3, name: 'abc consulting gmbh', kundennummer: 'A0228', aktiv: 1, personen: [], kontaktwege: [] },
]};
const PRODUKTE = { status: 'ok', produkte: [
  { id: 1, name: 'Verkehrsdienst', beschreibung: '', einzelpreis_rappen: 4200, einheit: 'Std.', mwst_satz_bp: 810, sortierung: 10, aktiv: 1 },
]};
const STATS = { status: 'ok',
  kpi: { rapporte_monat: 0, rapporte_vormonat: 0, stunden_monat: 0, stunden_vormonat: 0,
         mitarbeiter: 0, kunden: 0, rapporte_total: 0 },
  verlauf: [], angemeldet: [], letzte_rapporte: [], ereignisse: [], ereignisse_unvollstaendig: [],
  pro_mitarbeiter: [] };

let belegListArten = [];
let gespeichert = null;
let bezahltRufe = [];
let versendenRufe = [];
let versendenAntwort = { status: 'ok' };

const browser = await chromium.launch({ executablePath: browserPfad() });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
await page.route('**/api/**', async route => {
  const url = route.request().url();
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (url.includes('login.php')) return send({ status: 'ok', token: 't', name: 'adrian', ist_admin: true });
  if (url.includes('me.php')) return send({ status: 'ok', name: 'adrian', ist_admin: true, rollen: [],
    rechte: ['kunden', 'abgleich', 'personal_lesen', 'betrieb', 'plan', 'offerten', 'rechte'] });
  if (url.includes('produkt_list')) return send(PRODUKTE);
  if (url.includes('beleg_list')) {
    const art = new URLSearchParams(url.split('?')[1] || '').get('art') || 'offerte';
    belegListArten.push(art);
    return send(art === 'rechnung' ? RECHNUNGEN : OFFERTEN);
  }
  if (url.includes('beleg_bezahlt')) {
    const body = JSON.parse(route.request().postData() || '{}');
    bezahltRufe.push(body);
    return send({ status: 'ok', bezahlt: body.bezahlt ? 1 : 0, bezahlt_am: body.bezahlt ? tag(0) : null });
  }
  if (url.includes('beleg_versenden')) {
    versendenRufe.push(JSON.parse(route.request().postData() || '{}'));
    return send(versendenAntwort);
  }
  if (url.includes('beleg_lesen')) {
    const id = Number(new URLSearchParams(url.split('?')[1] || '').get('id'));
    const quelle = [...OFFERTEN.belege, ...RECHNUNGEN.belege].find(b => Number(b.id) === id);
    if (!quelle) { return send({ status: 'error', message: 'nicht gefunden' }); }
    return send({ status: 'ok', beleg: { ...quelle, positionen: [] },
      kunde: KU.kunden.find(k => Number(k.id) === Number(quelle.kunde_id)) || null, person: null });
  }
  if (url.includes('beleg_speichern')) {
    gespeichert = JSON.parse(route.request().postData() || '{}');
    const istNeu = !gespeichert.id;
    return send({ status: 'ok', id: istNeu ? 999 : gespeichert.id, nummer: istNeu ? 'RE-0951' : undefined,
      summen: { zwischensumme_rappen: 4200, rabatt_bp: 0, rabatt_rappen: 0, netto_rappen: 4200,
        mwst: [{ satz_bp: 810, grundlage_rappen: 4200, betrag_rappen: 340 }],
        mwst_rappen: 340, rundung_rappen: 0, total_rappen: 4540, zeilen: [] } });
  }
  if (url.includes('kunden_list')) return send(KU);
  if (url.includes('dashboard_stats')) return send(STATS);
  return send({ status: 'ok' });
});

await page.goto(URL);
await page.fill('#gName', 'adrian'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#shell.on');
await page.waitForTimeout(400);
// Volle Leiste ausdruecklich erzwingen: Die folgende Pruefung gilt der
// ausgeklappten Leiste selbst (Sichtbarkeit des Reiters nach dem Oeffnen
// der Gruppe) -- das ist keine Aussage ueber die Huelle (ENT-407) als
// Ganzes, die bleibt test_huelle.mjs vorbehalten.
await page.evaluate(() => huelleSetzen('voll'));

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

  // ── "Alle" zeigt die drei aktiven, nicht die archivierte ──────────────────
  const zeilen = await page.$$eval('#reTable tbody tr', tr => tr.map(r => r.textContent.replace(/\s+/g, ' ').trim()));
  check('KRITISCH: "Alle" zeigt die drei aktiven Rechnungen, nicht die archivierte oder die Offerte',
    zeilen.length === 3 && zeilen.every(z => !/Sollte hier NIE erscheinen/.test(z) && !/RE0900/.test(z)));
  check('Nummer und Empfaenger stehen wie geliefert da',
    zeilen.some(z => /RE0950/.test(z) && /Klinik Musterberg/.test(z)));
  check('Der Betrag steht als CHF mit Tausendertrennzeichen da',
    zeilen.some(z => /CHF 3['’]336\.45/.test(z)));

  // ── Status/Faellig/Offener Betrag sind abgeleitet ─────────────────────────
  const werte = await page.evaluate(() => {
    const zeile = [...document.querySelectorAll('#reTable tbody tr')]
      .find(tr => tr.textContent.includes('RE0948'));
    return zeile ? zeile.textContent.replace(/\s+/g, ' ') : null;
  });
  check('KRITISCH: eine ueberfaellige, unbezahlte Rechnung zeigt "Überfällig", nicht "Versendet"',
    werte && /Überfällig/.test(werte));
  check('KRITISCH: und die Anzahl Tage darueber', werte && /3 Tage überfällig/.test(werte));
  const bezahlteZeile = await page.evaluate(() => {
    const zeile = [...document.querySelectorAll('#reTable tbody tr')]
      .find(tr => tr.textContent.includes('RE0940'));
    return zeile ? zeile.textContent.replace(/\s+/g, ' ') : null;
  });
  check('KRITISCH: eine bezahlte Rechnung zeigt "Bezahlt" statt des rohen Status',
    bezahlteZeile && /Bezahlt/.test(bezahlteZeile));
  check('KRITISCH: ihr Offener Betrag ist 0, nicht der volle Betrag',
    bezahlteZeile && /CHF 0\.00/.test(bezahlteZeile));
  const nichtFaelligeZeile = await page.evaluate(() => {
    const zeile = [...document.querySelectorAll('#reTable tbody tr')]
      .find(tr => tr.textContent.includes('RE0950'));
    return zeile ? zeile.textContent.replace(/\s+/g, ' ') : null;
  });
  check('KRITISCH: eine noch nicht faellige, unbezahlte Rechnung zeigt ihren offenen Betrag voll (Betrag und Offener Betrag gleich)',
    nichtFaelligeZeile && (nichtFaelligeZeile.match(/CHF 3['’]336\.45/g) || []).length === 2);
  check('Und "Fällig" zeigt die verbleibenden Tage bis zur Frist',
    nichtFaelligeZeile && /5 Tage/.test(nichtFaelligeZeile));

  // ── Reiter "Erledigt" ──────────────────────────────────────────────────────
  await page.click('#reatab-erledigt'); await page.waitForTimeout(150);
  const erledigtZeilen = await page.$$eval('#reTable tbody tr', tr => tr.map(r => r.textContent.replace(/\s+/g, ' ').trim()));
  check('KRITISCH: "Erledigt" zeigt nur die bezahlte, aktive Rechnung',
    erledigtZeilen.length === 1 && /RE0940/.test(erledigtZeilen[0]));

  // ── Reiter "Archiviert" ────────────────────────────────────────────────────
  await page.click('#reatab-archiv'); await page.waitForTimeout(150);
  const archivZeilen = await page.$$eval('#reTable tbody tr', tr => tr.map(r => r.textContent.replace(/\s+/g, ' ').trim()));
  check('KRITISCH: "Archiviert" zeigt die inaktive Rechnung, nicht die aktiven',
    archivZeilen.length === 1 && /RE0900/.test(archivZeilen[0]));
  await page.click('#reatab-alle'); await page.waitForTimeout(150);

  // ── Suche ──────────────────────────────────────────────────────────────────
  await page.fill('#reQ', 'test'); await page.waitForTimeout(150);
  const suchZeilen = await page.$$eval('#reTable tbody tr', tr => tr.map(r => r.textContent.replace(/\s+/g, ' ').trim()));
  check('KRITISCH: die Suche filtert auf Titel/Nummer/Empfaenger',
    suchZeilen.length === 1 && /RE0948/.test(suchZeilen[0]));
  await page.fill('#reQ', ''); await page.waitForTimeout(150);

  // ── Statusfilter zeigt die ANGEZEIGTEN Werte (inkl. Bezahlt/Ueberfaellig) ──
  const statusOptionen = await page.$$eval('#reStatus option', o => o.map(x => x.value));
  check('KRITISCH: der Statusfilter kennt "Bezahlt" und "Überfällig", nicht nur den rohen Status',
    statusOptionen.includes('Bezahlt') && statusOptionen.includes('Überfällig'));
  check('Und den normalen Status der dritten, unauffaelligen Rechnung',
    statusOptionen.includes('Versendet'));

  // ── Sortierung ───────────────────────────────────────────────────────────
  await page.click('#reTable th:has-text("Offener Betrag")'); await page.waitForTimeout(150);
  const nachOffen = await page.$$eval('#reTable tbody tr', tr => tr.map(r => r.textContent));
  check('Ein Klick auf "Offener Betrag" sortiert die Liste um (aufsteigend zuerst 0)',
    /RE0940/.test(nachOffen[0]));

  // ── "Rechnung erstellen" oeffnet die geteilte Erfassungsmaske ─────────────
  check('KRITISCH: der Knopf "Rechnung erstellen" ist da', await page.isVisible('#kv-rechnungen button:has-text("Rechnung erstellen")'));
  await page.click('#kv-rechnungen button:has-text("Rechnung erstellen")'); await page.waitForTimeout(300);
  check('KRITISCH: das Formular zeigt "Rechnungsdatum", nicht "Offertendatum"',
    (await page.textContent('#ofLblDatum')).includes('Rechnungsdatum'));
  check('KRITISCH: das zweite Datumsfeld heisst "Fällig am", nicht "Gültig bis"',
    (await page.textContent('#ofLblGueltig')) === 'Fällig am');
  check('Die Nummer-Beschriftung heisst "Rechnungsnummer"',
    (await page.textContent('#ofLblNummer')) === 'Rechnungsnummer');
  check('Der Zurueck-Knopf verweist auf die Rechnungsliste',
    (await page.getAttribute('#ofBtnZurueck', 'aria-label') || '').includes('Rechnungsliste'));

  await page.fill('#of_kunde', 'Klinik Musterberg'); await page.dispatchEvent('#of_kunde', 'input');
  await page.fill('#of_titel', 'Testrechnung');
  await page.click('#ofFormSaveBtn'); await page.waitForTimeout(300);
  check('KRITISCH: beim Speichern geht art:"rechnung" an den Server, nicht "offerte"',
    gespeichert && gespeichert.art === 'rechnung');
  check('KRITISCH: das zweite Datum landet in faellig_bis, nicht in gueltig_bis',
    gespeichert && 'faellig_bis' in gespeichert && !('gueltig_bis' in gespeichert));
  check('Toast/Titel bestaetigen eine Rechnung, nicht eine Offerte',
    (await page.textContent('#ofFormNummer')) === 'RE-0951');

  // Zurueck fuehrt wirklich in die Rechnungsliste, nicht in die Offertenliste.
  await page.click('#ofBtnZurueck'); await page.waitForTimeout(200);
  check('KRITISCH: "Zurück" fuehrt zur Rechnungsliste',
    (await page.getAttribute('#kv-rechnungen', 'class') || '').includes('on'));

  // ── Als bezahlt markieren ueber das Zeilenmenue ───────────────────────────
  // Gezielt die Zeile von RE0950 (unbezahlt) statt nth=0: die vorherige
  // Sortierung nach "Offener Betrag" haette sonst die bereits bezahlte
  // Rechnung (RE0940, 0 offen) an die erste Stelle sortiert.
  await page.click('#reTable tr:has-text("RE0950") .rowmenu-btn'); await page.waitForTimeout(150);
  check('KRITISCH: das Zeilenmenue bietet "Als bezahlt markieren" fuer eine unbezahlte Rechnung',
    (await page.textContent('#rowmenuPop')).includes('Als bezahlt markieren'));
  await page.click('#rowmenuPop >> text=Als bezahlt markieren'); await page.waitForTimeout(300);
  check('KRITISCH: das sendet id und bezahlt:1 an beleg_bezahlt.php',
    bezahltRufe.length === 1 && Number(bezahltRufe[0].bezahlt) === 1 && Number(bezahltRufe[0].id) === 101);

  // ── Dieselbe Architektur wie bei Offerten: Vorschau/Versand/Angeschaut ────
  // (ENT-192-Erweiterung auf Rechnungen, 28.08.2026)
  await page.evaluate(() => ofOeffnen(101));
  await page.waitForTimeout(300);
  check('Der Vorschau-Knopf ist auch bei einer Rechnung sichtbar',
    (await page.evaluate(() => document.getElementById('ofFormVorschauBtn').style.display)) !== 'none');

  await page.click('#ofFormMenuBtn'); await page.waitForTimeout(200);
  check('KRITISCH: das Dreipunkt-Menue bietet bei einer Rechnung BEIDE Knoepfe an, nicht nur einen',
    (await page.textContent('#rowmenuPop')).includes('Per E-Mail versenden')
    && (await page.textContent('#rowmenuPop')).includes('Als bezahlt markieren'));

  // Erst auf "Entwurf" zurueckstellen, damit der Versand-Test zeigt, dass er
  // den Status tatsaechlich aendert (gleiches Muster wie bei den Offerten).
  await page.click('#rowmenuPop button:has-text("Entwurf")'); await page.waitForTimeout(200);
  check('Status steht jetzt auf "Entwurf" -- Ausgangslage fuer die naechste Pruefung',
    (await page.textContent('#ofFormSub')).includes('Entwurf'));

  versendenRufe.length = 0;
  await page.click('#ofFormMenuBtn'); await page.waitForTimeout(200);
  await page.click('#rowmenuPop button:has-text("Per E-Mail versenden")'); await page.waitForTimeout(150);
  check('KRITISCH: der Versand fragt erst nach, statt sofort eine Mail zu verschicken',
    await page.evaluate(() => document.getElementById('dlgConfirm').classList.contains('on'))
    && versendenRufe.length === 0);
  check('KRITISCH: die Nachfrage spricht von "Rechnung", nicht von "Offerte"',
    (await page.textContent('#cfTitel')).includes('Rechnung per E-Mail versenden'));
  check('Und erwaehnt kein Annehmen/Ablehnen -- das gibt es bei Rechnungen nicht',
    !(await page.textContent('#cfText')).includes('annehmen'));
  // Nach dem Versand aktualisiert sich die RECHNUNGEN-Liste, nicht die
  // Offerten-Liste -- ofVersenden() muss den Refresh auf ofArt verzweigen,
  // nicht blind loadBelege() rufen. Direkt vor dem Bestaetigen zuruecksetzen,
  // damit nur dieser eine Refresh gezaehlt wird.
  belegListArten.length = 0;
  await page.click('#cfBtn'); await page.waitForTimeout(300);
  check('KRITISCH: die Bestaetigung ruft beleg_versenden.php mit der richtigen Id auf',
    versendenRufe.length === 1 && versendenRufe[0].id === 101);
  check('KRITISCH: nach erfolgreichem Versand steht der Status auf "Versendet"',
    (await page.textContent('#ofFormSub')).includes('Versendet'));
  check('KRITISCH: der Listen-Refresh nach dem Versand ruft art=rechnung ab, nicht art=offerte',
    belegListArten.length === 1 && belegListArten[0] === 'rechnung');

  // Zurueck in die Kunden-Ansicht, bevor der naechste Abschnitt Kunden-Reiter
  // anklickt -- die Nav-Knoepfe dort sind nur sichtbar, waehrend man auf der
  // Kunden-Seite steht, nicht mitten im offenen Beleg-Formular.
  await page.evaluate(() => { go('kunden'); kuGoTab('rechnungen'); });
  await page.waitForTimeout(200);

  // ── Offerten- und Rechnungen-Liste ueberschreiben sich nicht ──────────────
  await page.click('#nav-kunden-offerten'); await page.waitForTimeout(200);
  const ofZeilen = await page.$$eval('#ofTable tbody tr', tr => tr.map(r => r.textContent.replace(/\s+/g, ' ').trim()));
  check('KRITISCH: die Offerten-Liste bleibt unveraendert, nachdem Rechnungen geladen wurden',
    ofZeilen.length === 1 && /Sollte hier NIE erscheinen/.test(ofZeilen[0]));
  await page.click('#ofTable tbody tr >> nth=0'); await page.waitForTimeout(300);
  check('KRITISCH: das Oeffnen einer Offerte zeigt wieder "Offertendatum", die ofArt-Umschaltung leckt nicht',
    (await page.textContent('#ofLblDatum')).includes('Offertendatum'));
  check('Und "Gültig bis", nicht "Fällig am"',
    (await page.textContent('#ofLblGueltig')) === 'Gültig bis');
} catch (e) { bad.push('Rechnungen: ' + String(e).split('\n')[0].slice(0, 160)); }

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
  await p2.evaluate(() => huelleSetzen('voll'));
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
