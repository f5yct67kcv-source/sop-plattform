// Die Unterschrift eines Rapports kommt nicht mehr mit der Liste, sondern
// einzeln beim Oeffnen (rapport_list.php?id=). Geprueft wird, was man im
// Cockpit davon sieht:
//
//   - Die Liste sagt "erfasst", obwohl kein Bild mitkam (hat_unterschrift).
//   - Die Schublade zeigt das Bild, sobald es geholt ist.
//   - Scheitert der Abruf, steht dort "liess sich nicht laden" -- NIE
//     "Keine Unterschrift erfasst". Unbekannt darf nie wie keine aussehen.
//   - Der Druck setzt das Bild ein und bricht ab, wenn es fehlt, statt die
//     leere Linie eines unsignierten Rapports zu drucken.
//   - Beim Start wird kein einzelner Rapport nachgeholt.
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const TAG = iso(new Date(Date.now() - 5 * 864e5));

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const BILD = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const zeile = (id, hat) => ({ id, datum: TAG, mitarbeiter_id: 2, einsatz_id: null, mitarbeiter: 'd.beispiel',
  kunde: 'Muster AG', strasse: 'Dorfstrasse 1', ort: '5013 Musterdorf', auftrag_nr: null,
  einsatzart: 'Verkehrsdienst', von: '07:00:00', bis: '16:00:00', pause_min: 30, netto_h: '8.50',
  unterzeichner: 'R. Muster', hat_unterschrift: hat, bemerkung: null, erfasst_am: TAG + ' 16:12:00' });
const LISTE = { status: 'ok', rapporte: [zeile(1, 1), zeile(2, 0), zeile(3, 1)] };

let einzelAbrufe = [];
let einzelKaputt = false;

const browser = await chromium.launch({ executablePath: browserPfad() });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
await page.route('**/api/**', route => {
  const url = route.request().url();
  const p = url.split('/api/')[1].split('?')[0];
  const send = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'chefin', ist_admin: true });
  if (p.includes('dashboard_stats')) return send({ status: 'ok',
    kpi: { rapporte_monat: 3, rapporte_vormonat: 0, stunden_monat: 25.5, stunden_vormonat: 0, mitarbeiter: 1, kunden: 1, rapporte_total: 3 },
    verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [] });
  if (p.includes('rapport_list')) {
    const id = new URL(url).searchParams.get('id');
    if (!id) return send(LISTE);
    einzelAbrufe.push(Number(id));
    if (einzelKaputt) return send({ status: 'error', message: 'Serverfehler' }, 500);
    return send({ status: 'ok', rapport: { ...zeile(Number(id), 1), unterschrift: BILD } });
  }
  return send({ status: 'ok' });
});

await page.goto(`file://${WURZEL}/dashboard.html`);
await page.fill('#gName', 'chefin'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#shell.on');
await page.waitForFunction(() => typeof rapporte !== 'undefined' && rapporte.length === 3);
await page.waitForTimeout(300);

check('Beim Start wird kein einzelner Rapport nachgeholt', einzelAbrufe.length === 0);

// Die Liste: "erfasst" aus hat_unterschrift, ohne dass ein Bild da ist
// rKarte zeigt die Zeilen nur aufgeklappt -- darum aufgeklappt vergleichen
const auf = await page.evaluate(() => { rOffen.add(1); rOffen.add(2);
  const r = { mit: rKarte(rapporte[0], 1), ohne: rKarte(rapporte[1], 1) }; rOffen.clear(); return r; });
check('KRITISCH: "erfasst" steht beim unterschriebenen Rapport, obwohl die Liste kein Bild traegt',
  /<dt>Unterschrift<\/dt><dd>erfasst<\/dd>/.test(auf.mit));
check('Beim Rapport ohne Unterschrift steht "keine erfasst"', /keine erfasst/.test(auf.ohne));

// Schublade, Abruf gelingt
await page.evaluate(() => openDrawer(1));
await page.waitForFunction(() => document.querySelector('#drSig img'));
const bild = await page.$eval('#drSig img', i => i.getAttribute('src'));
check('KRITISCH: die Schublade zeigt das nachgeholte Bild', bild === BILD);
check('Genau ein Abruf, fuer genau diesen Rapport', einzelAbrufe.join() === '1');
await page.evaluate(() => { closeDrawer(); openDrawer(1); });
await page.waitForTimeout(150);
check('Beim zweiten Oeffnen wird nicht erneut geholt', einzelAbrufe.join() === '1');
await page.evaluate(() => closeDrawer());

// Schublade ohne Unterschrift: kein Abruf, klare Aussage
await page.evaluate(() => openDrawer(2));
await page.waitForTimeout(150);
check('Ohne Unterschrift: "Keine Unterschrift erfasst." und kein Abruf',
  /Keine Unterschrift erfasst/.test(await page.textContent('#drSig')) && einzelAbrufe.join() === '1');
await page.evaluate(() => closeDrawer());

// Schublade, Abruf scheitert
einzelKaputt = true;
await page.evaluate(() => openDrawer(3));
// Nicht endlos warten: bleibt der Text aus, soll die Pruefung unten rot
// werden, nicht an einer Zeitueberschreitung abbrechen.
await page.waitForFunction(() => /nicht laden|erfasst/.test(document.getElementById('drSig').textContent),
  null, { timeout: 3000 }).catch(() => {});
const text = await page.textContent('#drSig');
check('KRITISCH: ein gescheiterter Abruf sagt "liess sich nicht laden", nicht "keine erfasst"',
  /liess sich nicht laden/.test(text) && !/Keine Unterschrift erfasst/.test(text));

// Druck bei gescheitertem Abruf: kein Blatt
await page.evaluate(() => { window.__gedruckt = 0; window.print = () => { window.__gedruckt++; };
  $('printArea').innerHTML = ''; printReport(); });
await page.waitForTimeout(200);
check('KRITISCH: ohne geladene Unterschrift wird nicht gedruckt',
  await page.evaluate(() => window.__gedruckt === 0 && $('printArea').innerHTML === ''));
await page.evaluate(() => closeDrawer());

// Druck, wenn der Abruf wieder geht: das Bild steht auf dem Blatt
einzelKaputt = false;
await page.evaluate(() => { openDrawer(3); printReport(); });
await page.waitForFunction(() => window.__gedruckt === 1);
check('KRITISCH: das gedruckte Blatt traegt das nachgeholte Bild',
  await page.evaluate(b => $('printArea').innerHTML.includes(b), BILD));

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
