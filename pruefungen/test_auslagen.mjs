// Auslagenersatz nach Art. 18 GAV (ENT-054): Zonen, Hinweise, Anstellungsorte.
//
// Der teuerste Fehler waere hier nicht eine falsche Zone, sondern eine
// UNBEKANNTE Distanz, die wie "keine Entschaedigung" aussieht. Dann faellt
// ein Objekt jenseits der 10 km still durch und Mitarbeitende bekommen ihr
// Geld nicht. Mehrere Pruefungen zielen genau darauf.
import { WURZEL, HIER, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { readFileSync } from 'fs';


const URL = `file://${WURZEL}/dashboard.html`;
const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const ORTE = { status: 'ok', orte: [
  { id: 1, bezeichnung: 'Sitz', rolle: 'hao', strasse: 'Musterweg 1', plz: '4600', ort: 'Musterstadt', km_zum_anderen: 12.5, aktiv: 1, bemerkung: null },
  { id: 2, bezeichnung: 'Filiale', rolle: 'nao', strasse: 'Nebenweg 2', plz: '4700', ort: 'Nebenort', km_zum_anderen: 12.5, aktiv: 1, bemerkung: null },
]};

const OBJEKTE = { status: 'ok', objekte: [
  // innerhalb 10 km -> keine Entschaedigung
  { id: 1, kunde_id: 1, kunde_name: 'Kunde A', name: 'Objekt nah', strasse: 'Weg 1', plz: '4600', ort: 'Musterstadt',
    kanton: 'SO', einsatzart: 'Revierdienst', aktiv: 1, bemerkung: null, masterschichten: 1, stunden_je_einsatz: 0.5,
    distanzen: { 1: { km: 4.2, quelle: 'manuell', ermittelt_am: '2026-08-20' } } },
  // jenseits 10 km -> Pauschalzone 1
  { id: 2, kunde_id: 1, kunde_name: 'Kunde A', name: 'Baustelle fern', strasse: 'Weg 2', plz: '4800', ort: 'Fernort',
    kanton: 'SO', einsatzart: 'Verkehrsdienst', aktiv: 1, bemerkung: null, masterschichten: 0, stunden_je_einsatz: 0,
    distanzen: { 1: { km: 14.0, quelle: 'manuell', ermittelt_am: '2026-08-20' } } },
  // KEINE Distanz hinterlegt -- der gefaehrliche Fall
  { id: 3, kunde_id: 1, kunde_name: 'Kunde A', name: 'Objekt ohne Distanz', strasse: 'Weg 3', plz: null, ort: 'Irgendwo',
    kanton: 'SO', einsatzart: 'Revierdienst', aktiv: 1, bemerkung: null, masterschichten: 0, stunden_je_einsatz: 0,
    distanzen: {} },
]};

let calls = [];
const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(5000);

await page.route('**/api/**', route => {
  const req = route.request();
  const path = req.url().split('/api/')[1].split('?')[0];
  let body = null;
  try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch {}
  calls.push({ path, body });
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (path.includes('login')) return send({ status: 'ok', token: 't', name: 'adrian', ist_admin: true });
  if (path.includes('anstellungsorte')) return send(ORTE);
  if (path.includes('objekt_distanz_save')) return send({ status: 'ok', km: body && body.km });
  if (path.includes('objekt_save')) return send({ status: 'ok', id: 9 });
  if (path.includes('objekt_list')) return send(OBJEKTE);
  if (path.includes('mitarbeiter_list')) return send({ status: 'ok', mitarbeiter: [] });
  if (path.includes('kunden_list')) return send({ status: 'ok', kunden: [] });
  if (path.includes('einsatz_list')) return send({ status: 'ok', einsaetze: [] });
  if (path.includes('feiertag')) return send({ status: 'ok', kanton: 'SO', feiertage: [], gepflegt: {} });
  return send({ status: 'ok', kpi: {}, verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [],
    rapporte: [], objekte: [], masterschichten: [] });
});

await page.goto(URL);
await page.fill('#gName', 'adrian'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#shell.on'); await page.waitForTimeout(700);

// ══════════════ DIE REGEL SELBST (gav.js)
const z = async (h, n, d) => page.evaluate(([a, b, c]) => {
  const r = gavZone(a, b, c);
  return r ? { s: r.schluessel, e: r.entschaedigung, q: r.quelle } : null;
}, [h, n, d]);

check('Gemessen wird ab HAO: 0 km liegt im Anstellungsgebiet', (await z(0, null, null)).s === 'anstellungsgebiet');
check('KRITISCH: 10.00 km ist noch Anstellungsgebiet, keine Entschaedigung',
  (await z(10, null, null)).s === 'anstellungsgebiet' && (await z(10, null, null)).e === false);
check('KRITISCH: 10.01 km loest die Entschaedigung aus',
  (await z(10.01, null, null)).s === 'pauschalzone1' && (await z(10.01, null, null)).e === true);
check('20.00 km ist noch Pauschalzone 1', (await z(20, null, null)).s === 'pauschalzone1');
check('20.01 km ist Pauschalzone 2', (await z(20.01, null, null)).s === 'pauschalzone2');
check('30.00 km ist noch Pauschalzone 2', (await z(30, null, null)).s === 'pauschalzone2');
check('30.01 km ist Regiezone', (await z(30.01, null, null)).s === 'regiezone');
check('Die Quelle wird mitgegeben', (await z(14, null, null)).q.includes('Art. 18'));

check('KRITISCH: unbekannte Distanz gibt null, nicht "keine Entschaedigung"', (await z(null, null, null)) === null);
check('Leerer Text gilt ebenfalls als unbekannt', (await z('', null, null)) === null);

// Nebenanstellungsgebiet geht allen anderen Zonen vor (Ziff. 3.2.5/3.3.5)
check('Nebenanstellungsgebiet geht der Regiezone vor',
  (await z(35, 6, 12)).s === 'nebenanstellungsgebiet');
check('KRITISCH: unter 40 km zwischen den Orten ist im Nebengebiet nichts geschuldet',
  (await z(35, 6, 12)).e === false && (await z(35, 6, 12)).q.includes('3.2.5'));
check('KRITISCH: ab 40 km zwischen den Orten ist im Nebengebiet eine Pauschale geschuldet',
  (await z(35, 6, 45)).e === true && (await z(35, 6, 45)).q.includes('3.3.5'));
check('KRITISCH: fehlt der Abstand der beiden Orte, wird nicht geraten',
  (await z(35, 6, null)) === null);
check('Ausserhalb des Nebengebiets zaehlt wieder die HAO-Strecke',
  (await z(35, 14, 12)).s === 'regiezone');

// ══════════════ DIE REGEL LIEGT IN gav.js, NICHT IM DASHBOARD
const gavQ = readFileSync(`${WURZEL}/gav.js`, 'utf8');
const dashQ = readFileSync(`${WURZEL}/dashboard.html`, 'utf8');
check('Die Zonenregel steht in gav.js', /function gavZone/.test(gavQ));
check('KRITISCH: das Dashboard haelt keine eigene Kopie der Zonenregel',
  !/function gavZone/.test(dashQ));
check('Die Zonengrenzen stehen genau einmal', (gavQ.match(/bis: 20/g) || []).length === 1);

// ══════════════ OBJEKTLISTE: DIE ZONE AUF EINEN BLICK
await page.click('#nav-kunden'); await page.waitForTimeout(300);
await page.click('#nav-kunden-objekte'); await page.waitForTimeout(600);
const zeilen = await page.$$eval('#oTable tbody tr', rs => rs.map(r => r.textContent));
check('Objektliste zeigt eine Spalte fuer die Auslagen',
  (await page.textContent('#oTable thead')).includes('Auslagen'));
check('Objekt innerhalb 10 km ist als "keine" gekennzeichnet', /keine/.test(zeilen[0]));
check('Objekt jenseits 10 km nennt die Zone', /Pauschalzone 1/.test(zeilen[1]));
check('KRITISCH: Objekt ohne hinterlegte Distanz erscheint als offen, nicht als "keine"',
  /offen/.test(zeilen[2]) && !/keine/.test(zeilen[2]));

// ══════════════ OBJEKTDIALOG: DER HINWEIS WAEHREND DER EINGABE
await page.click('#oTable tbody tr:first-child'); await page.waitForTimeout(500);
await page.click('#kv-detail .ku-zurueck').catch(() => {});
await page.waitForTimeout(300);
await page.evaluate(() => openObjektNeu(objekte.find(o => o.id === 2)));
await page.waitForTimeout(500);
check('Der Dialog hat ein Feld je Anstellungsort', (await page.$$('#obDistanzFelder input')).length === 2);
check('Die hinterlegte Distanz steht drin', (await page.inputValue('#obKm1')) === '14');
check('Das Feld nennt die Rolle des Ortes', (await page.textContent('#obDistanzFelder')).includes('HAO'));

// Der Messhinweis (OP-44). Google Maps sortiert nach Fahrzeit -- wer die
// oberste Zeile abschreibt, nimmt die schnellste statt der kuerzesten Route
// und kann damit eine Zonengrenze reissen. Der Hinweis muss SICHTBAR sein,
// nicht bloss im Quelltext stehen, und er muss VOR der Eingabe dastehen.
const sichtbarText = sel => page.evaluate(s => {
  const e = document.querySelector(s);
  if (!e) { return null; }
  if (getComputedStyle(e).display === 'none' || !e.getClientRects().length) { return null; }
  return e.textContent.trim();
}, sel);

const obMess = await sichtbarText('#obMessHinweis');
check('KRITISCH: der Messhinweis im Objektdialog ist sichtbar', obMess !== null && obMess.length > 0);
check('KRITISCH: er verlangt die kuerzeste Strecke', /kürzeste/i.test(obMess || ''));
check('KRITISCH: er schliesst die schnellste Route ausdruecklich aus',
  /nicht die schnellste/i.test(obMess || ''));
check('Er nennt Google Maps als Quelle', /Google Maps/.test(obMess || ''));
check('Er nennt die Fundstelle im GAV', /Art\. 18 Ziff\. 2/.test(obMess || ''));
check('Er erklaert, warum die oberste Zeile falsch sein kann',
  /nach Fahrzeit/i.test(obMess || ''));

// Textinhalt genuegt NICHT: .ki-hint ist ohne die Klasse "on" per CSS
// unsichtbar. Ein Hinweis, den niemand sieht, ist kein Hinweis.
const hintSichtbar = () => page.evaluate(() => {
  const e = document.querySelector('#obZoneHint > div');
  if (!e) { return false; }
  const st = getComputedStyle(e);
  return st.display !== 'none' && st.visibility !== 'hidden' && e.getClientRects().length > 0;
});
check('KRITISCH: der Hinweis ist tatsaechlich sichtbar, nicht nur im Text vorhanden',
  await hintSichtbar());
let hint = await page.textContent('#obZoneHint');
check('Der Planer wird auf den Auslagenersatz hingewiesen',
  /Pauschalzone 1/.test(hint) && /Auslagenersatz faellt an|Auslagenersatz fällt an/.test(hint));
check('Der Hinweis nennt die Rechtsgrundlage', /Art\. 18/.test(hint));
check('KRITISCH: es wird kein Frankenbetrag genannt, solange Art. 18 Ziff. 8 offen ist',
  !/CHF|Fr\./.test(hint));

await page.fill('#obKm1', '4');
await page.waitForTimeout(250);
hint = await page.textContent('#obZoneHint');
check('Unter 10 km schlaegt der Hinweis um', /kein Auslagenersatz/.test(hint));
check('KRITISCH: auch dieser Hinweis ist sichtbar', await hintSichtbar());

await page.fill('#obKm1', '');
await page.waitForTimeout(250);
hint = await page.textContent('#obZoneHint');
check('KRITISCH: leeres Feld warnt, statt "keine Entschaedigung" zu behaupten',
  /Wegstrecke fehlt/.test(hint) && !/kein Auslagenersatz/.test(hint));
check('Der Hinweis sagt, woher die Zahl kommt', /Google Maps/.test(hint));
check('KRITISCH: auch die Warnung ist sichtbar', await hintSichtbar());

// ══════════════ SPEICHERN
calls = [];
await page.fill('#obKm1', '18.4');
await page.evaluate(() => saveObjekt());
await page.waitForTimeout(700);
const dist = calls.filter(c => c.path.includes('objekt_distanz_save'));
check('Die Wegstrecke wird gespeichert', dist.length >= 1);
check('Sie geht mit Objekt und Anstellungsort raus',
  dist.some(c => c.body && Number(c.body.anstellungsort_id) === 1 && String(c.body.km) === '18.4'));
check('Ein leeres Feld schickt null, nicht 0',
  dist.every(c => c.body.km === null || c.body.km !== 0));

// ══════════════ ANSTELLUNGSORTE: NEUE RUBRIK ADMINISTRATION (ENT-056)
await page.evaluate(() => go('betrieb'));
await page.waitForTimeout(600);
check('Es gibt eine Rubrik Administration in der Seitenleiste',
  await page.evaluate(() => !!document.getElementById('navg-admin')));
check('Die Mitarbeitenden liegen darin', await page.isVisible('#nav-admin-mitarbeiter'));
check('Der Betrieb liegt darin', await page.isVisible('#nav-admin-betrieb'));
check('KRITISCH: die Mitarbeitenden stehen nicht mehr doppelt unter Stammdaten',
  await page.evaluate(() => !document.getElementById('nav-mitarbeiter')));
check('Die Betriebsansicht ist offen', await page.isVisible('#view-betrieb.on'));
check('Die Gruppe klappt dabei auf',
  await page.evaluate(() => document.getElementById('navg-admin').classList.contains('offen')));
check('Der Unterpunkt Betrieb ist markiert',
  await page.evaluate(() => document.getElementById('nav-admin-betrieb').classList.contains('on')));
check('Die Kopfzeile nennt die Einstellungen (bis ENT-229 "Betrieb")',
  (await page.textContent('#pgTitle')) === 'Einstellungen');
await page.evaluate(() => go('mitarbeiter'));
await page.waitForTimeout(400);
check('Auch die Mitarbeitenden markieren die Gruppe',
  await page.evaluate(() => document.getElementById('nav-admin-mitarbeiter').classList.contains('on')
    && document.getElementById('navg-admin').classList.contains('offen')));
check('Die Mitarbeiterliste funktioniert unveraendert', await page.isVisible('#view-mitarbeiter.on'));
await page.evaluate(() => { go('betrieb'); bkAbschnittZeigen('an'); });
await page.waitForTimeout(500);
const anTxt = await page.textContent('#view-betrieb');
check('Er sagt, dass es hoechstens zwei Orte gibt', /höchstens.{0,10}zwei/i.test(anTxt));
check('KRITISCH: er sagt ausdruecklich, dass es keine zwei Hauptanstellungsorte gibt',
  /zwei Hauptanstellungsorte gibt es nicht/i.test(anTxt));
check('Er nennt die Adresspflicht aus dem Kommentar', /Strasse und Nummer/i.test(anTxt));
check('Beide Orte stehen in der Liste', (await page.$$('#anListe tbody tr')).length === 2);
check('Die Rollen sind erkennbar', /HAO/.test(anTxt) && /NAO/.test(anTxt));
check('Der Abstand zwischen den Orten wird gezeigt', /12[.,]50 km/.test(anTxt));
check('Bei bestehendem HAO ist die Vorgabe NAO', (await page.inputValue('#anRolle')) === 'nao');
check('Der Bereich sagt, was noch fehlt', /noch nicht erfasst/.test(anTxt));
const anMess = await sichtbarText('#anMessHinweis');
check('KRITISCH: der Messhinweis steht auch bei den Anstellungsorten sichtbar da',
  anMess !== null && /kürzeste/i.test(anMess) && /nicht die schnellste/i.test(anMess));
check('KRITISCH: der Messhinweis ist an beiden Stellen derselbe Satz', anMess === obMess);
check('KRITISCH: der Satz steht in gav.js, nicht doppelt im Dashboard',
  /GAV_WEGSTRECKE_HINWEIS/.test(gavQ)
  && (dashQ.match(/nicht die schnellste/g) || []).length === 0);

check('KRITISCH: der GAV-Hinweis bei den Anstellungsorten ist sichtbar',
  await page.evaluate(() => {
    const e = document.querySelector('#anKarte .ki-hint');
    return !!e && getComputedStyle(e).display !== 'none' && e.getClientRects().length > 0;
  }));

// ══════════════ SERVERSEITIGE ZUSICHERUNGEN
check('KRITISCH: der alte Dialog ist verschwunden, nicht bloss versteckt',
  !dashQ.includes('dlgAnst'));
check('Die Objekt-Werkzeugleiste hat keinen zweiten Weg mehr dorthin',
  !dashQ.includes('openAnstellungsorte'));

const anPhp = readFileSync(`${WURZEL}/backend/api/anstellungsorte.php`, 'utf8');
check('SERVER: ein zweiter Hauptanstellungsort wird abgewiesen',
  /nur einen Hauptanstellungsort/.test(anPhp));
check('SERVER: mehr als zwei Anstellungsorte werden abgewiesen',
  /hoechstens zwei Anstellungsorte/.test(anPhp));
check('SERVER: die Strasse ist Pflicht (PAKO-Kommentar)',
  /Strasse und Nummer sind erforderlich/.test(anPhp));
// Seit ENT-077 nicht mehr "Admin ja/nein": Lesen darf, wer die
// Personalakte sieht -- der Anstellungsort steht dort. Aendern ist eine
// Betriebseinstellung.
check('SERVER: Lesen braucht das Recht auf die Personalakte',
  /require_recht\(\$user, 'personal_lesen'\)/.test(anPhp));
check('SERVER: Aendern braucht das Betriebsrecht',
  /require_recht\(\$user, 'betrieb'\)/.test(anPhp));

const dPhp = readFileSync(`${WURZEL}/backend/api/objekt_distanz_save.php`, 'utf8');
check('SERVER: leere Distanz loescht den Eintrag, statt 0 zu speichern',
  /DELETE FROM objekt_distanz/.test(dPhp));
check('SERVER: die Herkunft der Zahl wird mitgeschrieben',
  /quelle/.test(dPhp) && /bestaetigt_von/.test(dPhp));
check('SERVER: unplausible Werte werden abgewiesen', /unplausibel/.test(dPhp));

const einPhp = readFileSync(`${WURZEL}/backend/api/planung_einrichten.php`, 'utf8');
check('EINRICHTUNG: die Tabelle anstellungsorte wird angelegt',
  /CREATE TABLE IF NOT EXISTS anstellungsorte/.test(einPhp));
check('EINRICHTUNG: die Tabelle objekt_distanz wird angelegt',
  /CREATE TABLE IF NOT EXISTS objekt_distanz/.test(einPhp));
check('EINRICHTUNG: die PLZ am Objekt wird nachgetragen',
  /objekte.*plz|ADD COLUMN plz/.test(einPhp));

// ── Die beiden Anstellungsorte werden einmalig hinterlegt (ENT-055)
check('EINRICHTUNG: Trimbach wird als HAO angelegt',
  /Trimbach/.test(einPhp) && /'hao'/.test(einPhp));
check('EINRICHTUNG: Gelterkinden wird als NAO angelegt',
  /Gelterkinden/.test(einPhp) && /'nao'/.test(einPhp));
check('EINRICHTUNG: die gemessenen 18.0 km zwischen den Orten sind hinterlegt',
  /18\.0/.test(einPhp));
check('KRITISCH: die geschaetzten 19 km sind nirgends mehr hinterlegt',
  !/19\.0/.test(einPhp));
check('EINRICHTUNG: die Herkunft der Zahl steht dabei',
  /Google Maps/.test(einPhp) && /kuerzeste|kürzeste/.test(einPhp));
check('KRITISCH: der Nachtrag laeuft nur bei leerer Tabelle und ueberschreibt nichts',
  /SELECT COUNT\(\*\) FROM anstellungsorte/.test(einPhp) && /\$anzahl === 0/.test(einPhp));
check('EINRICHTUNG: der Nachtrag meldet sich auch im Trockenlauf',
  /nurPruefen[\s\S]{0,400}Anstellungsorte Trimbach/.test(einPhp));
// 18.0 km liegen unter 40 -- damit gilt Ziff. 3.2.5 und im Nebengebiet ist
// nichts geschuldet. Das ist die Rechtsfolge dieser einen Zahl. Sie haette
// auch bei der laengsten von Google angebotenen Route (20.4 km) so gelautet;
// fuer die ZONE eines Einsatzortes waere der Unterschied dagegen erheblich.
check('KRITISCH: bei 18.0 km zwischen den Orten ist im Nebengebiet nichts geschuldet',
  (await z(25, 6, 18)).e === false && (await z(25, 6, 18)).q.includes('3.2.5'));
check('Zur Erinnerung, warum die Route zaehlt: 18.0 km ist Pauschalzone 1, 20.4 km waere Zone 2',
  (await z(18, null, null)).s === 'pauschalzone1' && (await z(20.4, null, null)).s === 'pauschalzone2');

await page.screenshot({ path: `${OUT}/au-01-anstellungsorte.png` });
await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
