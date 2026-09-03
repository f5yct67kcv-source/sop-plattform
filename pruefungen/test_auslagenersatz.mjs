// Auslagenersatz je Schicht: Verkehrsmittel, Schnappschuss beim Abgleich,
// chronologisches Protokoll (ENT-125).
//
// Ausgangslage: Der Projektinhaber wollte den Auslagenersatz "fix
// eingepflegt", nicht als Zusatzaufwand fuer den Planer -- als Vorstufe zu
// einer spaeter zu bauenden Lohnabrechnung. Diese Suite haelt drei Dinge
// scharf, die beim Bau am kritischsten waren:
//
// 1. Die GELDRECHNUNG selbst laeuft NUR in PHP (backend/auslagen.php), NIE
//    im Browser -- eine im Browser berechnete Zahl waere fuer einen
//    Datensatz, der spaeter in eine Spesenabrechnung einfliesst, nicht
//    vertrauenswuerdig genug. Teil 1 fuehrt diesen Rechenkern wirklich aus
//    (nicht nur den Quelltext lesen).
//
// 2. Die Sperrwirkung von GAV-AUS-010 gilt weiterhin: Rohdaten (Zone, km)
//    bleiben stehen, aber kein Betrag entsteht, solange mehr als ein
//    Einsatz desselben Tages betroffen ist.
//
// 3. Ein zurueckgenommener Abgleich darf keinen Auslagenersatz-Schnappschuss
//    stehen lassen -- sonst zeigt das Protokoll Geld fuer eine Schicht, die
//    laut Ist-Status gar nicht stattfand.
import { WURZEL, HIER, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);
// Kein festes Datum in den Testdaten -- relativ zu heute berechnet
// (test_datumsfest.mjs), wie in test_ausagz010.mjs.
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const tag = n => iso(new Date(Date.now() + n * 864e5));

// ══════════════════════════════════════════════════════════════════════════
// TEIL 1 — Der Rechenkern wird wirklich ausgefuehrt, nicht nur gelesen
// ══════════════════════════════════════════════════════════════════════════
let phpAusgabe = '', phpCode = 0;
try {
  phpAusgabe = execFileSync('php', [`${HIER}/pruef_auslagen.php`], { encoding: 'utf8' });
} catch (e) {
  phpAusgabe = String(e.stdout || '') + String(e.stderr || '');
  phpCode = e.status || 1;
}
const phpAnzahl = Number((phpAusgabe.match(/^(\d+) Pruefungen ausgefuehrt/m) || [0, 0])[1]);
const phpFehler = phpAusgabe.split('\n').filter(z => z.startsWith('X '));
check('KRITISCH: der Rechenkern laeuft ueberhaupt durch', phpAnzahl > 0);
check('KRITISCH: alle Rappen-Pruefungen des Rechenkerns bestehen',
  phpCode === 0 && phpFehler.length === 0);
phpFehler.forEach(f => bad.push('PHP: ' + f));

// ══════════════════════════════════════════════════════════════════════════
// TEIL 2 — Verdrahtung im Abgleich (Quelltext, da ohne Datenbank nicht
// ausfuehrbar -- derselbe Ansatz wie test_dokumente.mjs Teil 1)
// ══════════════════════════════════════════════════════════════════════════
const ABGLEICH = readFileSync(`${WURZEL}/backend/api/einsatz_abgleich.php`, 'utf8');
const EINRICHTEN = readFileSync(`${WURZEL}/backend/api/planung_einrichten.php`, 'utf8');
const VERKEHR = readFileSync(`${WURZEL}/backend/api/einsatz_verkehrsmittel.php`, 'utf8');

check('KRITISCH: die neue Tabelle einsatz_auslagen wird bei der Einrichtung angelegt',
  /CREATE TABLE einsatz_auslagen/.test(EINRICHTEN));
check('KRITISCH: die Migrationen fuer Verkehrsmittel (Person und Ausnahme) bestehen',
  EINRICHTEN.includes("ALTER TABLE mitarbeiter ADD COLUMN verkehrsmittel VARCHAR(20) NULL")
  && EINRICHTEN.includes("ALTER TABLE einsatz_zuteilung ADD COLUMN verkehrsmittel VARCHAR(20) NULL")
  && EINRICHTEN.includes("ALTER TABLE einsatz_zuteilung ADD COLUMN oev_rappen INT NULL"));

check('KRITISCH: der Abgleich bindet backend/auslagen.php ein',
  /require_once __DIR__ \. '\/\.\.\/auslagen\.php'/.test(ABGLEICH));
check('KRITISCH: nur der Status "anwesend" erzeugt einen Schnappschuss',
  /if \(\$status === 'anwesend'\) {\s*\$auslagenSpeichern\(\$einsatzId, \$maId\);/.test(ABGLEICH));
check('KRITISCH: jeder andere Status loescht einen vorhandenen Schnappschuss',
  /} else {\s*\$auslagenLoeschen->execute\(\[\$einsatzId, \$maId\]\);/.test(ABGLEICH));
check('KRITISCH: die Ausnahme an der Zuteilung schlaegt die Vorgabe der Person',
  /\$ausn && \$ausn\['verkehrsmittel'\] !== null[\s\S]{0,80}\? \$ausn\['verkehrsmittel'\]\s*:\s*\(\$vorgabeWert/.test(ABGLEICH));
// GEAENDERT durch ENT-347. Diese Pruefung hielt die alte Regel fest: JEDER
// andere, nicht abgesagte Einsatz desselben Tages zaehlte. Seither zaehlt
// eine ENTFALLENE Zuteilung nicht mehr mit -- wer aus einer Schicht
// entfallen ist, war dort nicht und hatte darum keinen Hin- und Rueckweg
// dorthin. Das ist keine GAV-Auslegung, sondern eine Tatsachenfeststellung
// davor (Vermerk bei GAV-AUS-010 im Auslegungsregister).
//
// Geprueft wird darum jetzt BEIDES: dass die Einschraenkung da ist -- und
// dass sie GENAU 'entfallen' betrifft und nichts weiter. Eine Sperre, die
// aus Versehen auch 'abgelehnt' oder 'offen' ausnaehme, wuerde still zu
// wenig sperren, und das faellt an einer Auszahlung auf, nicht hier.
check('KRITISCH: der Tageskonflikt zaehlt jeden anderen, nicht abgesagten Einsatz desselben Tages -- ausser entfallenen (ENT-347)',
  /e\.status != 'abgesagt'\s*\n\s*AND z\.zusage != 'entfallen' AND e\.id != \?/.test(ABGLEICH));
check('KRITISCH: und die Ausnahme betrifft NUR "entfallen", nicht auch abgelehnte oder offene Zuteilungen',
  (ABGLEICH.match(/z\.zusage (?:!=|<>) '[a-z]+'/g) || []).join('|') === "z.zusage != 'entfallen'");
check('Schreiben und Loeschen laufen in derselben Transaktion wie die Ist-Zeiten',
  ABGLEICH.indexOf('$pdo->beginTransaction()') < ABGLEICH.indexOf('$auslagenSpeichern(')
  && ABGLEICH.indexOf('$auslagenSpeichern(') < ABGLEICH.indexOf('$pdo->commit()'));

check('KRITISCH: die Verkehrsmittel-Ausnahme respektiert die Sperre einer abgeglichenen Schicht (ENT-045)',
  /einsatz_sperre_pruefen\(db\(\), \$einsatzId\)/.test(VERKEHR));
check('Ein Billettpreis wird nur bei Oeffentlicher Verkehr uebernommen, sonst verworfen',
  /\$verkehrsmittel === 'Oeffentlicher Verkehr'/.test(VERKEHR));
check('KRITISCH: der Endpunkt weist ein unbekanntes Verkehrsmittel zurueck, statt es zu speichern',
  /!in_array\(\$verkehrsmittel, MA_VERKEHRSMITTEL, true\)/.test(VERKEHR));

// ══════════════════════════════════════════════════════════════════════════
// TEIL 3 — Oberflaeche
// ══════════════════════════════════════════════════════════════════════════
const MA = [{ id: 1, name: 'dario', vorname: 'Dario', nachname: 'Beispiel', aktiv: 1, ist_admin: 0,
  verkehrsmittel: 'Privatfahrzeug' }];
const EINSAETZE = [{ id: 81, kunde_id: 1, kunde_name: 'Nordbau', titel: null, strasse: 'Kantonsstrasse 3',
  ort: '6000 Luzern', kanton: 'LU', einsatzart: 'Verkehrsdienst', sparte: 'sicherheit',
  datum: tag(16), von: '07:30:00', bis: '16:30:00', bedarf: 1, status: 'geplant',
  weg_km: 15, weg_adresse: 'Kantonsstrasse 3, 6000 Luzern, LU',
  bemerkung: null, objekt_id: null, mitarbeiter: [] },
  // Im Anstellungsgebiet -- hier darf der Verkehrsmittel-Block gar nicht erscheinen.
  { id: 82, kunde_id: 1, kunde_name: 'Nah AG', titel: null, strasse: 'Kurzweg 1',
  ort: '4600 Olten', kanton: 'SO', einsatzart: 'Revierdienst', sparte: 'sicherheit',
  datum: tag(17), von: '07:30:00', bis: '16:30:00', bedarf: 1, status: 'geplant',
  weg_km: 3, weg_adresse: 'Kurzweg 1, 4600 Olten, SO',
  bemerkung: null, objekt_id: null, mitarbeiter: [] }];
const AO = [{ id: 1, bezeichnung: 'HAO', rolle: 'hao', strasse: 'Bahnhofstrasse 1', plz: '4600',
  ort: 'Olten', km_zum_anderen: null, aktiv: 1 }];
const POS = { 81: [{ id: 700, nr: 1, funktion: 'Verkehrsdienst', ist_fahrzeit: 0, position: null,
    von: '07:30:00', bis: '16:30:00', std_verrechnung: null, pauschal: null, qualifikation: null,
    gesperrt: 0, bemerkung: null, mitarbeiter_id: 1, mitarbeiter: 'dario', vorname: 'Dario',
    nachname: 'Beispiel', zusage: 'zugesagt', gesehen_am: null, verkehrsmittel: null, oev_rappen: null }],
  82: [{ id: 701, nr: 1, funktion: 'Revierdienst', ist_fahrzeit: 0, position: null,
    von: '07:30:00', bis: '16:30:00', std_verrechnung: null, pauschal: null, qualifikation: null,
    gesperrt: 0, bemerkung: null, mitarbeiter_id: 1, mitarbeiter: 'dario', vorname: 'Dario',
    nachname: 'Beispiel', zusage: 'zugesagt', gesehen_am: null, verkehrsmittel: null, oev_rappen: null }] };
const AUSLAGEN_ZEILEN = [
  { einsatz_id: 1, mitarbeiter_id: 1, mitarbeiter: 'Dario Beispiel', datum: tag(-20),
    kunde_name: 'Nordbau', ort: '6000 Luzern', titel: null,
    zone_schluessel: 'pauschalzone1', zone_name: 'Pauschalzone 1', zone_quelle: 'Art. 18 Ziff. 3.1.2',
    weg_km: 15, verkehrsmittel: 'Privatfahrzeug', fahrzeitersatz_rappen: 560, fahrkostenersatz_rappen: 700,
    gesperrt_grund: null, regelwerk: 'GAV 2026', erzeugt_am: tag(-19) + ' 08:00:00' },
  { einsatz_id: 2, mitarbeiter_id: 1, mitarbeiter: 'Dario Beispiel', datum: tag(-19),
    kunde_name: 'Nordbau', ort: '6000 Luzern', titel: null,
    zone_schluessel: 'pauschalzone1', zone_name: 'Pauschalzone 1', zone_quelle: 'Art. 18 Ziff. 3.1.2',
    weg_km: 15, verkehrsmittel: null, fahrzeitersatz_rappen: 560, fahrkostenersatz_rappen: null,
    gesperrt_grund: 'verkehrsmittel_unbekannt', regelwerk: 'GAV 2026', erzeugt_am: tag(-18) + ' 08:00:00' },
];

const rufe = [];
const b = await chromium.launch({ executablePath: EXE });
const page = await b.newPage({ viewport: { width: 1500, height: 1000 } });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));

await page.route('**/api/**', route => {
  const req = route.request(), url = req.url(), p = url.split('/api/')[1].split('?')[0];
  let body = null;
  try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch (e) {}
  rufe.push({ p, body, url });
  const send = x => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) });
  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'adrian', ist_admin: true });
  if (p.includes('mitarbeiter_list')) return send({ status: 'ok', mitarbeiter: MA });
  if (p.includes('kunden_list')) return send({ status: 'ok', kunden: [] });
  if (p.includes('einsatz_list')) return send({ status: 'ok', einsaetze: EINSAETZE });
  if (p.includes('anstellungsorte')) return send({ status: 'ok', orte: AO });
  if (p.includes('einsatz_verkehrsmittel')) return send({ status: 'ok' });
  if (p.includes('einsatz_position')) {
    if (!body) {
      const eid = Number(url.split('einsatz_id=')[1]);
      return send({ status: 'ok', positionen: POS[eid] || [] });
    }
    return send({ status: 'ok' });
  }
  if (p.includes('einsatz_dokument')) return body ? send({ status: 'ok', id: 1 }) : send({ status: 'ok', dokumente: [] });
  if (p.includes('auslagen_list')) return send({ status: 'ok', von: tag(-24), bis: tag(7), zeilen: AUSLAGEN_ZEILEN });
  if (p.includes('dashboard_stats')) return send({ status: 'ok', kpi: { rapporte_monat: 0,
    rapporte_vormonat: 0, stunden_monat: 0, stunden_vormonat: 0, mitarbeiter: 1, kunden: 1,
    rapporte_total: 0 }, verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [],
    sperr_ereignisse: [] });
  return send({ status: 'ok', einsaetze: [], objekte: [], feiertage: [], gepflegt: {},
    sperren: [], adressen: [], wege: [], fahrzeuge: [] });
});

await page.goto(`file://${WURZEL}/dashboard.html`);
await page.fill('#gName', 'adrian'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#shell.on'); await page.waitForTimeout(500);

// ── Personalakte: Verkehrsmittel als Vorgabe der Person
await page.evaluate(() => { go('mitarbeiter'); });
await page.waitForTimeout(300);
// Direkt ueber den Zeichenaufruf, unabhaengig vom genauen Weg der
// Detailseite -- die Suite prueft das Formularfeld, nicht die Navigation
// dorthin (die ist Sache der bestehenden Mitarbeiter-Suiten).
await page.evaluate(m => { maAkte = m; mbNeuModus = false; maGoTab('bearbeiten'); mbZeichnen(); }, MA[0]);
await page.waitForTimeout(200);
check('KRITISCH: die Personalakte bietet ein Verkehrsmittel-Auswahlfeld',
  await page.evaluate(() => !!document.getElementById('mb_verkehrsmittel')));
// Jede weitere Pruefung ohne das Feld waere leer erfuellbar oder liesse die
// Suite abstuerzen statt rot zu werden -- beides ist bei der ersten Fassung
// dieser Suite tatsaechlich passiert.
const vmFeld = await page.evaluate(() => {
  const el = document.getElementById('mb_verkehrsmittel');
  if (!el) { return null; }
  return { tag: el.tagName, optionen: [...el.options].map(o => o.value).filter(Boolean),
    hinweis: (el.closest('.f') || {}).textContent || '' };
});
check('Es ist als Auswahl aufgebaut, nicht als Freitext', !!vmFeld && vmFeld.tag === 'SELECT');
check('KRITISCH: alle vier GAV-Faelle stehen zur Auswahl (Ziff. 4 und 5)',
  !!vmFeld && ['Privatfahrzeug', 'Oeffentlicher Verkehr', 'Mitfahrer', 'Geschaeftsfahrzeug'].every(v => vmFeld.optionen.includes(v)));
check('Der erklaerende Hinweis steht dabei -- ohne Angabe wird schweigend nichts berechnet',
  !!vmFeld && /Art\. 18 GAV/.test(vmFeld.hinweis));

// ── Einsatzplan: Verkehrsmittel-Ausnahme, nur bei entschaedigungspflichtiger Zone
await page.evaluate(() => Promise.all([ladeAnstellungsorte(), loadEinsaetze()]));
await page.waitForTimeout(200);
await page.evaluate(() => epAuf(81));
await page.waitForTimeout(600);
check('KRITISCH: in einer entschädigungspflichtigen Zone erscheint die Verkehrsmittel-Ausnahme',
  await page.evaluate(() => !!document.querySelector('[data-vm-ma]')));
check('KRITISCH: die Vorgabe der Person steht als erste, nicht gewählte Option da',
  await page.evaluate(() => document.querySelector('[data-vm-ma] option').textContent.includes('Privatfahrzeug')));
check('Das Billettpreis-Feld ist zu Beginn versteckt (kein OEV gewählt)',
  await page.evaluate(() => getComputedStyle(document.querySelector('[data-vm-oev]')).display === 'none'));

await page.selectOption('[data-vm-ma]', 'Oeffentlicher Verkehr');
await page.waitForTimeout(250);
check('KRITISCH: bei „Öffentlicher Verkehr" erscheint sofort das Billettpreis-Feld',
  await page.evaluate(() => getComputedStyle(document.querySelector('[data-vm-oev]')).display !== 'none'));
const gesendet = rufe.filter(r => r.p.includes('einsatz_verkehrsmittel'));
check('KRITISCH: die Auswahl wird sofort gespeichert, ohne extra Knopf',
  gesendet.length >= 1 && gesendet.at(-1).body.verkehrsmittel === 'Oeffentlicher Verkehr'
  && gesendet.at(-1).body.mitarbeiter_id === 1 && gesendet.at(-1).body.einsatz_id === 81);

// fill() allein loest bei einem Zahlenfeld kein "change" aus (nur "input") --
// dasselbe Verhalten wie in einem echten Browser: "change" feuert erst beim
// Verlassen des Feldes. Das Feld speichert bewusst per onchange, nicht
// oninput -- sonst speicherte jeder Tastendruck einzeln.
await page.fill('[data-vm-oev]', '4.60');
await page.locator('[data-vm-oev]').blur();
await page.waitForTimeout(250);
const oevRuf = rufe.filter(r => r.p.includes('einsatz_verkehrsmittel')).at(-1);
check('KRITISCH: der Billettpreis geht in Rappen an den Server (4.60 CHF = 460)',
  oevRuf && Number(oevRuf.body.oev_rappen) === 460);

// ── Anstellungsgebiet: keine Ausnahme anbieten, wo nichts geschuldet ist
await page.evaluate(() => epAuf(82));
await page.waitForTimeout(600);
check('KRITISCH: im Anstellungsgebiet erscheint KEINE Verkehrsmittel-Ausnahme — es ist ohnehin nichts geschuldet',
  await page.evaluate(() => !document.querySelector('[data-vm-ma]')));

// ══════════════════════════════════════════════════════════════════════════
// TEIL 4 — Chronologisches Protokoll (Art. 18 Ziff. 10)
// ══════════════════════════════════════════════════════════════════════════
await page.evaluate(() => go('auslagen'));
await page.waitForTimeout(500);
check('KRITISCH: die Ansicht ist ueber die Navigation erreichbar', await page.isVisible('#view-auslagen'));
check('KRITISCH: die Zeilen erscheinen gruppiert je Mitarbeitendem',
  await page.evaluate(() => document.querySelectorAll('#auListe .card-hd h2').length === 1
    && document.querySelector('#auListe .card-hd h2').textContent.includes('Dario Beispiel')));
check('KRITISCH: eine Zeile ohne bestimmbaren Betrag ist als solche erkennbar, nicht als „0"',
  await page.evaluate(() => {
    const zeile = [...document.querySelectorAll('#auListe tbody tr')].find(t => t.classList.contains('au-gesperrt'));
    return !!zeile && /offen/.test(zeile.textContent) && !/CHF 0\.00/.test(zeile.textContent);
  }));
check('Der Grund steht als Titel am „offen"-Chip, nicht nur im Code',
  await page.evaluate(() => {
    const chip = document.querySelector('#auListe tr.au-gesperrt .chip');
    return !!chip && /Verkehrsmittel/.test(chip.getAttribute('title') || '');
  }));
check('KRITISCH: die Summe zaehlt nur die bestimmten Betraege, nicht die offene Zeile als 0',
  /CHF 11\.20/.test(await page.textContent('#auListe .card-hd .note'))); // 2 x Fahrzeit 5.60 = 11.20

// CSV-Export loest tatsaechlich einen Download aus
const [dl] = await Promise.all([
  page.waitForEvent('download'),
  page.click('button[onclick="auslagenCsv()"]'),
]);
check('KRITISCH: der CSV-Export erzeugt eine Datei', /\.csv$/.test(dl.suggestedFilename()));

await b.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(x => console.log('  ✗ ' + x)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
