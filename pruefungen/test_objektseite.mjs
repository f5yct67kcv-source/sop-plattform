// "Neues Objekt" als eigene Seite statt Dialog (16.10.2026) -- dasselbe
// Muster wie "Neuer Kunde" (test_kundeseite.mjs).
//
// Gemessen am gerenderten Zustand:
// 1. ES IST EINE SEITE, der Kopf nennt sie, "Zurueck" fuehrt dorthin, woher
//    man kam (Objektliste oder Objekt).
// 2. DIE SPALTEN STEHEN: 168-px-Beschriftung, Felder an einer Kante, 46 px
//    Zeilenabstand; Kunde und Sparte setzen ihre Felder untereinander.
// 3. BEMERKUNG UND ZONE enden buendig mit "Kanton", die Zone beginnt an der
//    Feldspalte -- sie bleibt aber sichtbar und wird nicht ins (i) gesteckt:
//    Ob Auslagenersatz anfaellt, ist ein Zustand, keine Erklaerung.
// 4. DAS HAEKCHEN "in Betrieb" steht nicht in Versalien.
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const ok = [], bad = [];
const check = (n, c, x) => (c ? ok : bad).push(n + (c || x === undefined ? '' : ' -- ' + x));
const browser = await chromium.launch({ executablePath: browserPfad() });
const OBJ = { id: 3, name: 'Werkhof Nord', kunde_name: 'Beispiel AG', kunde_id: 1, strasse: 'Industriestrasse 5', plz: '4600', ort: 'Olten',
  kanton: 'SO', sparte: 'sicherheit', einsatzart: 'Revierdienst', aktiv: 1, distanzen: { 1: { km: 12 } } };

async function seite() {
  const page = await browser.newPage({ viewport: { width: 1728, height: 1009 } });
  page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
  await page.route('**/api/**', r => {
    const u = r.request().url();
    const s = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) });
    if (u.includes('login')) return s({ status: 'ok', token: 't', name: 'a', ist_admin: true, sparten: ['sicherheit', 'reinigung'] });
    if (u.includes('anstellungsorte')) return s({ status: 'ok', orte: [
      { id: 1, bezeichnung: 'Olten', rolle: 'hao', aktiv: 1, km_zum_anderen: null },
      { id: 2, bezeichnung: 'Aarau', rolle: 'nao', aktiv: 1, km_zum_anderen: 14 }] });
    if (u.includes('objekt_list')) return s({ status: 'ok', objekte: [OBJ] });
    return s({ status: 'ok', einsaetze: [], rapporte: [], objekte: [OBJ], feiertage: [], kunden: [{ id: 1, name: 'Beispiel AG' }],
      mitarbeiter: [], gepflegt: {}, sperren: [], kpi: {} });
  });
  await page.goto(`file://${WURZEL}/dashboard.html`);
  await page.evaluate(() => localStorage.setItem('rv3_huelle', 'aus'));
  await page.reload();
  await page.fill('#gName', 'a'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
  await page.waitForSelector('#shell.on'); await page.waitForTimeout(300);
  await page.evaluate(() => { document.documentElement.classList.add('hat-reinigung'); go('kunden'); kuGoTab('objekte'); });
  await page.waitForTimeout(400);
  return page;
}

const page = await seite();
await page.click('#kv-objekte button:has-text("Neues Objekt")'); await page.waitForTimeout(300);
check('Neues Objekt öffnet eine Seite', await page.isVisible('#view-objektform.on') && !(await page.isVisible('#view-kunden')));
check('Der Kopf sagt „Neues Objekt“', (await page.textContent('#pgTitle')).trim() === 'Neues Objekt');
check('Der Knopf heisst „Objekt anlegen“', (await page.textContent('#obNeuBtn')).trim() === 'Objekt anlegen');
check('„Zurück“ nennt die Objekte', (await page.textContent('#obZurueck')).trim() === 'Zurück zu den Objekten');
await page.click('#obZurueck'); await page.waitForTimeout(200);
check('„Zurück“ führt in die Objektliste', await page.isVisible('#kv-objekte.on'));

await page.evaluate(() => openObjektNeu(objekte[0])); await page.waitForTimeout(400);
check('Ändern: Kopf „Objekt ändern“, Knopf „Speichern“',
  (await page.textContent('#pgTitle')).trim() === 'Objekt ändern' && (await page.textContent('#obNeuBtn')).trim() === 'Speichern');
const m = await page.evaluate(() => {
  const r = id => document.getElementById(id).getBoundingClientRect();
  const lab = id => document.querySelector(`label[for="${id}"]`).getBoundingClientRect();
  const zone = document.querySelector('#obZoneHint > *');
  return {
    links: ['obName', 'obEinsatzart', 'obStrasse', 'obKm1', 'obBemerkung'].map(id => r(id).left),
    erstLabel: ['obName', 'obEinsatzart', 'obStrasse', 'obKm1', 'obBemerkung'].map(id => lab(id).width),
    abstand: r('obEinsatzart').top - r('obName').top,
    kundeSparte: [r('obKunde_name').left, r('obSparte').left],
    kantonRechts: r('obKanton').right, bemRechts: r('obBemerkung').right,
    zone: zone ? zone.getBoundingClientRect() : null,
    haken: getComputedStyle(document.getElementById('obAktiv').closest('label')).textTransform,
    hoehen: ['obName', 'obKanton', 'obKm1'].map(id => r(id).height),
  };
});
check('Alle Felder setzen links auf dieselbe Kante', Math.max(...m.links) - Math.min(...m.links) < 0.5, m.links.join(','));
check('Erste Beschriftung jeder Zeile 168 px', m.erstLabel.every(b => Math.abs(b - 168) < 0.5), m.erstLabel.join(','));
check('Zeilenabstand 46 px', Math.abs(m.abstand - 46) < 0.5, m.abstand);
check('Felder 32 px hoch', m.hoehen.every(h => Math.abs(h - 32) < 0.5), m.hoehen.join(','));
check('Sparte unter Kunde', Math.abs(m.kundeSparte[0] - m.kundeSparte[1]) < 0.5, m.kundeSparte.join(','));
check('Bemerkung bündig mit „Kanton“', Math.abs(m.kantonRechts - m.bemRechts) < 0.5, `${m.kantonRechts} / ${m.bemRechts}`);
check('Die Zone wird angezeigt (12 km ab HAO)', !!m.zone);
check('Die Zone beginnt an der Feldspalte und endet bündig mit „Kanton“',
  m.zone && Math.abs(m.zone.left - m.links[0]) < 0.5 && Math.abs(m.zone.right - m.kantonRechts) < 0.5, m.zone && `${m.zone.left}-${m.zone.right}`);
check('„Objekt ist in Betrieb“ nicht in Versalien', m.haken === 'none', m.haken);

// Aus der Objektdetailseite: Zurueck dorthin
await page.evaluate(() => { openObjekt(3); }); await page.waitForTimeout(300);
await page.evaluate(() => openObjektNeu(objekte[0])); await page.waitForTimeout(300);
check('Aus dem Objekt: „Zurück zum Objekt“', (await page.textContent('#obZurueck')).trim() === 'Zurück zum Objekt');
await page.click('#obZurueck'); await page.waitForTimeout(200);
check('… und Zurück führt wieder dorthin', await page.isVisible('#view-objekt.on'));

await browser.close();
console.log(`${ok.length} bestanden, ${bad.length} nicht bestanden`);
for (const b of bad) console.log('  FEHLT: ' + b);
if (bad.length) { process.exit(1); }
console.log('\nAlle Pruefungen bestanden.');
