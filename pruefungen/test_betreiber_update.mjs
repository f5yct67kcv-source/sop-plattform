// Das Update-Fenster im Betreiberbereich (ENT-698).
//
// Wie im Cockpit: oeffnet sich von selbst, zeigt die Neuerungen, spielt
// auf Knopfdruck ein und zeigt danach nur, was schiefging oder offen ist.
// Hier besteht der Fortschritt aus Teilen: erst die Betreiber-Datenbank,
// dann jeder Mandant einzeln -- je eine Anfrage.
import { chromium } from 'playwright';
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { pathToFileURL } from 'url';
import { join } from 'path';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);
const browser = await chromium.launch({ executablePath: browserPfad() });
const ADRESSE = pathToFileURL(join(WURZEL, 'betreiber.html')).href;

async function seite(stand) {
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
  await page.goto(ADRESSE);
  await page.evaluate(stand => {
    document.getElementById('tor').classList.add('versteckt');
    document.getElementById('haus').classList.remove('versteckt');
    window.__rufe = [];
    // Nachgebauter Server: ersetzt ruf(), damit die Seite ohne Anmeldung
    // und ohne Netz gegen feste Antworten laeuft.
    ruf = async (pfad, daten, methode) => {
      const m = methode || (daten ? 'POST' : 'GET');
      window.__rufe.push({ pfad, daten, m });
      if (stand.bremse) { await new Promise(r => setTimeout(r, stand.bremse)); }
      if (pfad === 'betreiber_neuerungen.php') {
        if (m === 'POST') { return { status: 'ok', gesehen_bis: daten.bis }; }
        return { status: 'ok', ziel: 'betreiber', neueste: 4, gesehen_bis: 0, neuerungen: stand.neu };
      }
      if (pfad === 'betreiber_schema_pruefen.php') {
        const mandanten = [{ id: 1, name: 'Betrieb A' }, { id: 7, name: 'Betrieb B' }];
        if (m === 'GET') {
          return { status: 'ok', getan: [], offen: stand.offen, fehler: [], mandanten };
        }
        const fehlt = daten && daten.mandant_id === stand.fehlerBei;
        return { status: fehlt ? 'error' : 'ok',
          getan: ['Mandant: Tabelle x angelegt'], offen: [],
          fehler: fehlt ? ['Mandant „Betrieb B“: Zugriff verweigert'] : [], mandanten };
      }
      return { status: 'ok' };
    };
  }, stand);
  await page.evaluate(() => pruefeEinrichtungUpdate());
  await page.waitForTimeout(stand.bremse ? 300 : 150);
  return page;
}
const offen = p => p.evaluate(() => $('dlgEinrichtung').classList.contains('on'));
const NEU = [{ nr: 4, datum: '2028-06-10', art: 'verbesserung', titel: 'Etwas Besseres', text: 'Beschreibung.' }];

// ── Update steht aus: Fenster von selbst, Einspielen in Teilen
let page = await seite({ neu: NEU, offen: ['Mandant „Betrieb A“: Spalte x fehlt noch'], fehlerBei: null, bremse: 0 });
check('KRITISCH: steht ein Update aus, oeffnet sich das Fenster von selbst', await offen(page));
check('Es heisst „Update erforderlich“', (await page.textContent('#be-upd-titel')).includes('Update erforderlich'));
check('Die Neuerungen stehen darin', (await page.textContent('#be-upd-neu')).includes('Etwas Besseres'));
check('Knoepfe „Später“ und „Jetzt einspielen“',
  (await page.textContent('#knopf-einrichtung-zu')).trim() === 'Später'
  && (await page.textContent('#knopf-einrichtung-lauf')).trim() === 'Jetzt einspielen');
check('KRITISCH: Oeffnen allein spielt nichts ein',
  !(await page.evaluate(() => __rufe.some(r => r.pfad === 'betreiber_schema_pruefen.php' && r.m === 'POST'))));
await page.screenshot({ path: `${OUT}/betreiber-update.png` });
check('Gemessen: die Unterzeile sitzt dicht unter dem Titel (3 px), nicht mit dem Dialogabstand',
  await page.evaluate(() => getComputedStyle($('be-upd-unter')).marginTop === '3px'));

await page.click('#knopf-einrichtung-lauf');
await page.waitForTimeout(500);
const posts = await page.evaluate(() => __rufe.filter(r => r.pfad === 'betreiber_schema_pruefen.php' && r.m === 'POST')
  .map(r => JSON.stringify(r.daten)));
check('KRITISCH: erst die Betreiber-Datenbank, dann jeder Mandant einzeln',
  JSON.stringify(posts) === JSON.stringify(['{"teil":"betreiber"}', '{"mandant_id":1}', '{"mandant_id":7}']));
check('Am Ende „Update eingespielt“, Balken voll und gruen',
  (await page.textContent('#be-upd-titel')).includes('Update eingespielt')
  && await page.evaluate(() => $('be-upd-balken').getAttribute('aria-valuenow') === '100'
    && $('be-upd-balken').classList.contains('fertig')));
check('KRITISCH: was ergaenzt wurde, steht nicht im Fenster',
  !(await page.textContent('#dlgEinrichtung')).includes('Tabelle x angelegt'));
check('Die Neuerungen gelten danach als gelesen',
  await page.evaluate(() => __rufe.some(r => r.pfad === 'betreiber_neuerungen.php' && r.m === 'POST' && r.daten.bis === 4)));
await page.close();

// ── Ein Mandant scheitert: Grund steht da, Balken rot
page = await seite({ neu: [], offen: ['x'], fehlerBei: 7, bremse: 0 });
await page.click('#knopf-einrichtung-lauf');
await page.waitForTimeout(500);
check('KRITISCH: der gescheiterte Mandant steht namentlich da',
  (await page.textContent('#einrichtung-inhalt')).includes('Betrieb B'));
check('Der Balken ist rot', await page.evaluate(() => $('be-upd-balken').classList.contains('fehler')));
check('Man kann es erneut versuchen',
  (await page.textContent('#knopf-einrichtung-lauf')).includes('Erneut versuchen'));
await page.close();

// ── Gebremst: der Balken waechst nur in ganzen Teilen
page = await seite({ neu: [], offen: ['x'], fehlerBei: null, bremse: 250 });
const werte = [];
page.click('#knopf-einrichtung-lauf');
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(90);
  werte.push(await page.evaluate(() => Number($('be-upd-balken').getAttribute('aria-valuenow'))));
}
await page.waitForTimeout(700);
check('KRITISCH: der Balken zeigt nur ganze Teile (0, 1/3, 2/3, 3/3)',
  werte.every(w => [0, 33, 67, 100].includes(w)) && new Set(werte).size >= 3);
await page.close();

// ── Nichts offen, keine Neuerungen: kein Fenster
page = await seite({ neu: [], offen: [], fehlerBei: null, bremse: 0 });
check('Ohne Update und Neuerungen oeffnet sich nichts', !(await offen(page)));
// Nur Neuerungen: "Neu in GuardOpS" mit "Verstanden"
await page.close();
page = await seite({ neu: NEU, offen: [], fehlerBei: null, bremse: 0 });
check('Nur Neuerungen: das Fenster heisst „Neu in GuardOpS“',
  (await page.textContent('#be-upd-titel')).includes('Neu in GuardOpS'));
await page.click('#knopf-einrichtung-lauf');
await page.waitForTimeout(200);
check('„Verstanden“ schliesst und spielt nichts ein',
  !(await offen(page))
  && !(await page.evaluate(() => __rufe.some(r => r.pfad === 'betreiber_schema_pruefen.php' && r.m === 'POST'))));
await page.close();

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
