// Leistungsart (ENT-721, Schritt 3): Katalog unter Lohn -> Lohnarten und die
// Wahl je Person im Einsatzplan. Gemessen am gerenderten Zustand.
//
// Die Rechnung selbst prueft pruef_lohnlauf_leistung.php gegen eine echte
// Datenbank. Hier geht es um das, was nur der Browser zeigt:
// 1. Der Block im Einsatzplan erscheint nur, wenn es etwas zu waehlen gibt.
// 2. Eine Wahl geht sofort an den Server, und ein abgewiesener Wechsel
//    springt zurueck -- das Feld zeigt nie etwas, das es nicht gibt.
// 3. Eine deaktivierte Leistungsart ist nicht neu waehlbar.
// 4. Im Katalog erscheinen Nummer und Standardsatz nur bei der Leistungsart,
//    und eine neue bekommt die Haken aus GAV-AUS-019 vorgesetzt.
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const ok = [], bad = [];
const check = (n, c, x) => (c ? ok : bad).push(n + (c || x === undefined ? '' : ' -- ' + x));
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const tag = n => iso(new Date(Date.now() + n * 864e5));

const MA = [{ id: 1, name: 'eine.person', vorname: 'Eine', nachname: 'Person', aktiv: 1, ist_admin: 0 },
            { id: 2, name: 'zwei.person', vorname: 'Zweite', nachname: 'Person', aktiv: 1, ist_admin: 0 }];
const einsatz = (id, n) => ({ id, kunde_id: 1, kunde_name: 'Beispiel AG', titel: null, strasse: 'Weg 1',
  ort: '4600 Olten', kanton: 'SO', einsatzart: 'Sicherheitsdienst', sparte: 'sicherheit',
  datum: tag(20 + n), von: '08:00:00', bis: '16:00:00', bedarf: 2, status: 'geplant',
  weg_km: 3, bemerkung: null, objekt_id: null, mitarbeiter: [] });
const EINSAETZE = [einsatz(81, 0), einsatz(82, 1)];
const pos = (id, nr, ma, la) => ({ id, nr, funktion: 'Sicherheitsdienst', ist_fahrzeit: 0, position: null,
  von: '08:00:00', bis: '16:00:00', std_verrechnung: null, pauschal: null, qualifikation: null,
  gesperrt: 0, bemerkung: null, mitarbeiter_id: ma, mitarbeiter: ma ? MA[ma - 1].name : null,
  vorname: ma ? MA[ma - 1].vorname : null, nachname: ma ? MA[ma - 1].nachname : null,
  zusage: 'zugesagt', gesehen_am: null, verkehrsmittel: null, oev_rappen: null, leistungsart_id: la });
const POS = { 81: [pos(700, 1, 1, null), pos(701, 2, 2, 203)], 82: [pos(702, 1, 1, null)] };
const LA = [{ id: 201, nummer: '102', bezeichnung: 'Hundeführer', aktiv: 1 },
            { id: 202, nummer: '103', bezeichnung: 'Objektschutz', aktiv: 1 },
            { id: 203, nummer: '104', bezeichnung: 'Alte Leistung', aktiv: 0 }];

const rufe = [];
let laAntwort = { status: 'ok', leistungsart_id: 201 };
const b = await chromium.launch({ executablePath: browserPfad() });
const page = await b.newPage({ viewport: { width: 1500, height: 1000 } });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
await page.route('**/api/**', route => {
  const req = route.request(), url = req.url(), p = url.split('/api/')[1].split('?')[0];
  let body = null;
  try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch (e) {}
  rufe.push({ p, body });
  const send = x => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) });
  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'adrian', ist_admin: true });
  if (p.includes('mitarbeiter_list')) return send({ status: 'ok', mitarbeiter: MA });
  if (p.includes('einsatz_list')) return send({ status: 'ok', einsaetze: EINSAETZE });
  if (p.includes('einsatz_leistungsart')) return send(laAntwort);
  if (p.includes('einsatz_position')) {
    const eid = Number(url.split('einsatz_id=')[1]);
    // Einsatz 82: der Katalog hat keine Leistungsart -- nichts zu waehlen.
    return send({ status: 'ok', positionen: POS[eid] || [], leistungsarten: eid === 82 ? [] : LA });
  }
  if (p.includes('lohnarten')) return send({ status: 'ok', lohnarten: [] });
  return send({ status: 'ok', einsaetze: [], objekte: [], feiertage: [], gepflegt: {}, kunden: [],
    sperren: [], adressen: [], wege: [], fahrzeuge: [], orte: [], dokumente: [], kpi: {}, verlauf: [],
    angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [], sperr_ereignisse: [] });
});
await page.goto(`file://${WURZEL}/dashboard.html`);
await page.fill('#gName', 'adrian'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#shell.on'); await page.waitForTimeout(500);
await page.evaluate(() => loadEinsaetze());
await page.waitForTimeout(200);

// ── Einsatzplan ──────────────────────────────────────────────────────────
await page.evaluate(() => epAuf(81));
await page.waitForTimeout(600);
const felder = await page.$$eval('[data-la-ma]', s => s.map(e => ({
  ma: e.dataset.laMa, wert: e.value, optionen: [...e.options].map(o => o.textContent.trim()),
  breite: Math.round(e.getBoundingClientRect().width) })));
check('KRITISCH: im Einsatzplan steht je eingeteilte Person ein Auswahlfeld für die Leistungsart',
  felder.length === 2, JSON.stringify(felder));
check('Leer heisst „keine“, nicht ein leeres Feld', felder[0] && felder[0].optionen[0] === 'keine');
check('Die aktiven Leistungsarten stehen mit Nummer zur Auswahl',
  felder[0] && felder[0].optionen.includes('102 · Hundeführer') && felder[0].optionen.includes('103 · Objektschutz'));
check('KRITISCH: eine deaktivierte Leistungsart ist nicht neu wählbar',
  felder[0] && !felder[0].optionen.some(o => o.includes('Alte Leistung')));
check('Ist sie schon gewählt, bleibt sie stehen und ist als deaktiviert gekennzeichnet',
  felder[1] && felder[1].wert === '203' && felder[1].optionen.some(o => /Alte Leistung.*deaktiviert/.test(o)));
check('Das Feld ist schmal, nicht über die volle Breite gestreckt',
  felder[0] && felder[0].breite > 120 && felder[0].breite <= 270, felder[0] && felder[0].breite);

await page.selectOption('[data-la-ma="1"]', '201');
await page.waitForTimeout(250);
const gesendet = rufe.filter(r => r.p.includes('einsatz_leistungsart')).at(-1);
check('KRITISCH: die Wahl geht sofort an den Server, mit Einsatz, Person und Leistungsart',
  gesendet && gesendet.body.einsatz_id === 81 && gesendet.body.mitarbeiter_id === 1
  && String(gesendet.body.leistungsart_id) === '201', JSON.stringify(gesendet));

laAntwort = { status: 'error', message: 'Diese Schicht ist festgeschrieben.' };
await page.selectOption('[data-la-ma="1"]', '202');
await page.waitForTimeout(250);
check('KRITISCH: weist der Server ab, springt das Feld auf den gespeicherten Stand zurück',
  (await page.inputValue('[data-la-ma="1"]')) === '201');
laAntwort = { status: 'ok', leistungsart_id: 201 };

await page.evaluate(() => epAuf(82));
await page.waitForTimeout(600);
check('Ohne Leistungsart im Katalog erscheint der Block gar nicht',
  (await page.$$('[data-la-ma]')).length === 0);

// ── Katalog unter Lohn -> Lohnarten ──────────────────────────────────────
await page.evaluate(() => {
  laDaten = { lohnarten: [], arten: { stundensatz: 'Betrag je Stunde', leistung: 'Leistungsart' },
    kennzeichen: Object.fromEntries(Object.keys(LA_KURZ).map(k => [k, k])) };
  lohnartOeffnen(null);
});
await page.waitForTimeout(200);
check('Nummer und Standardsatz sind bei einer anderen Art verborgen',
  !(await page.isVisible('#laNummer')) && !(await page.isVisible('#laStandard')));
await page.selectOption('#laArt', 'leistung');
await page.waitForTimeout(100);
check('Bei der Leistungsart erscheinen Nummer und Standardsatz',
  (await page.isVisible('#laNummer')) && (await page.isVisible('#laStandard')));
check('KRITISCH: eine neue Leistungsart zählt vorläufig für Ferien und 13. Monatslohn (GAV-AUS-019)',
  await page.evaluate(() => $('la_ferien_pflichtig').checked && $('la_ml13_pflichtig').checked));
await page.fill('#laBezeichnung', 'Hundeführer');
await page.fill('#laNummer', '102');
await page.fill('#laStandard', '1.50');
await page.evaluate(() => lohnartSpeichern());
await page.waitForTimeout(250);
const la = rufe.filter(r => r.p.includes('lohnarten') && r.body).at(-1);
check('KRITISCH: Nummer und Standardsatz gehen mit der Lohnart an den Server',
  la && la.body.art === 'leistung' && la.body.nummer === '102' && la.body.standard === '1.50', JSON.stringify(la && la.body));

await b.close();
console.log(`${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
bad.forEach(x => console.log('  ✗ ' + x));
if (bad.length) { process.exit(1); }
console.log('Alle Pruefungen bestanden.');
