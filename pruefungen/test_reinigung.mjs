// Geltungsbereich des GAV: nur Sicherheit (ENT-061).
//
// Die gefaehrliche Richtung ist NICHT "Reinigung bekommt versehentlich einen
// Bonus" -- das kostet den Betrieb. Gefaehrlich ist die Gegenrichtung: eine
// echte Sicherheitsschicht, der still der Zeitbonus fehlt. Das kostet den
// Mitarbeitenden Geld, und es faellt niemandem auf. Darum prueft diese Reihe
// vor allem, dass NICHTS abgeschaltet wird, was nicht ausdruecklich Reinigung ist.
import { WURZEL, HIER, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(5000);
await page.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json',
  // Dieser Mandant ist CUPI 24 -- nur dort gibt es die Sparte Reinigung
  // (ENT-650). Ohne diese Angabe baut das Cockpit die Spartenauswahl aus, und
  // diese ganze Reihe pruefte einen Zustand, den es so nicht mehr gibt.
  body: JSON.stringify({ status: 'ok', token: 't', name: 'a', ist_admin: true,
    sparten: ['sicherheit', 'reinigung'], kpi: {}, verlauf: [],
    angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [], mitarbeiter: [], kunden: [], einsaetze: [],
    objekte: [], rapporte: [], orte: [], feiertage: [], gepflegt: {} }) }));
await page.goto(`file://${WURZEL}/dashboard.html`);
await page.fill('#gName','a'); await page.fill('#gPass','x'); await page.click('#gBtn');
await page.waitForSelector('#shell.on'); await page.waitForTimeout(600);

const g = async v => page.evaluate(x => gavGilt(x), v);

// ── Die Regel selbst
check('Reinigung: der GAV gilt nicht', (await g('reinigung')) === false);
check('Gross-/Kleinschreibung spielt keine Rolle', (await g('Reinigung')) === false);
check('Sicherheit: der GAV gilt', (await g('sicherheit')) === true);
check('KRITISCH: fehlende Sparte gilt als Sicherheit — nie still abschalten', (await g(null)) === true);
check('KRITISCH: leere Sparte gilt als Sicherheit', (await g('')) === true);
check('KRITISCH: unbekannter Wert gilt als Sicherheit', (await g('bewachung')) === true);
check('KRITISCH: Teilwort schaltet nicht ab', (await g('reinigungsdienst')) === true);

// ── Zeitbonus: nur die Bewertung entfaellt, nicht die Zeit
const bonus = await page.evaluate(() => gavBonusMin('2026-03-02', '23:00', '06:00'));
check('Eine Nachtschicht ergibt Zeitbonus', bonus > 0);
check('KRITISCH: die geleistete Zeit bleibt unangetastet',
  await page.evaluate(() => gavNetto('23:00', '06:00', 0, 0) === '07:00'));

// ── Auslagenersatz nach Art. 18 schweigt bei Reinigung
const z = await page.evaluate(() => {
  const objS = { sparte: 'sicherheit', distanzen: { 1: { km: 14 } } };
  const objR = { sparte: 'reinigung',  distanzen: { 1: { km: 14 } } };
  anstellungsorte = [{ id: 1, bezeichnung: 'HAO', rolle: 'hao', aktiv: 1, km_zum_anderen: null }];
  return { s: objektZone(objS), r: objektZone(objR), chipR: zoneChip(objR), chipS: zoneChip(objS) };
});
check('Sicherheitsobjekt jenseits 10 km bleibt in Pauschalzone 1', z.s && z.s.schluessel === 'pauschalzone1');
check('KRITISCH: Reinigungsobjekt loest keinen Auslagenersatz aus', z.r && z.r.entschaedigung === false);
check('Die Marke sagt "Reinigung" und nicht "keine"', /Reinigung/.test(z.chipR) && !/keine/.test(z.chipR));
check('Beim Sicherheitsobjekt aendert sich nichts', /Pauschalzone 1/.test(z.chipS));

// ── Der Pausenhinweis bleibt, nennt aber die richtige Quelle
const t = await page.evaluate(() => {
  const soll = { min: 30, weil: 'mehr als 7 Stunden' };
  return { s: agPauseTitel(soll, false, 'sicherheit'), r: agPauseTitel(soll, false, 'reinigung') };
});
check('KRITISCH: der Pausenhinweis bleibt auch bei Reinigung', /30 Minuten/.test(t.r));
check('Bei Reinigung nennt er das Arbeitsgesetz', /Art\. 15 ArG/.test(t.r) && !/GAV/.test(t.r));
check('Bei Sicherheit nennt er den GAV', /Art\. 13 Ziff\. 1 GAV/.test(t.s));

// ── Einsatzart und Sparte sagen nicht mehr dasselbe
const arten = await page.evaluate(() => EINSATZARTEN.slice());
check('"Reinigung" steht in der Einsatzart-Liste (ENT-062)', arten.includes('Reinigung'));
check('Die drei Sicherheitsarten sind da',
  ['Verkehrsdienst','Revierdienst','Sicherheitsdienst'].every(a => arten.includes(a)));

// ── Die Klammer: Einsatzart zieht die Sparte mit (ENT-062)
await page.evaluate(() => openEinsatzNeu());
await page.waitForTimeout(400);
const kopp = await page.evaluate(() => {
  const art = document.getElementById('enNEinsatzart');
  const sp = document.getElementById('enNSparte');
  art.value = 'Reinigung'; art.dispatchEvent(new Event('change'));
  const nachR = sp.value;
  art.value = 'Revierdienst'; art.dispatchEvent(new Event('change'));
  const nachS = sp.value;
  return { nachR, nachS };
});
check('KRITISCH: Einsatzart Reinigung setzt die Sparte auf Reinigung', kopp.nachR === 'reinigung');
check('KRITISCH: zurueck auf Revierdienst setzt die Sparte zurueck — kein haengender Zustand',
  kopp.nachS === 'sicherheit');

// ── Der Widerspruch wird sichtbar, statt still zu bleiben
const konflikt = await page.evaluate(() => {
  const art = document.getElementById('enNEinsatzart');
  const sp = document.getElementById('enNSparte');
  art.value = 'Reinigung'; art.dispatchEvent(new Event('change'));
  sp.value = 'sicherheit'; sp.dispatchEvent(new Event('change'));
  const hb = document.getElementById('enNSparteHint');
  const beiWiderspruch = hb.querySelector('.ki-hint')?.getClientRects().length ? hb.textContent.trim() : '';
  sp.value = 'reinigung'; sp.dispatchEvent(new Event('change'));
  const beiEinigkeit = document.getElementById('enNSparteHint').textContent.trim();
  return { beiWiderspruch, beiEinigkeit };
});
check('KRITISCH: ein Widerspruch zwischen Einsatzart und Sparte wird gemeldet',
  /widersprechen sich/.test(konflikt.beiWiderspruch));
check('Der Hinweis sagt, welches Feld massgeblich ist',
  /Massgeblich/.test(konflikt.beiWiderspruch) && /Sparte/.test(konflikt.beiWiderspruch));
check('Er nennt die Folge fuer den Zeitbonus', /Zeitbonus/.test(konflikt.beiWiderspruch));
check('Sind sie einig, schweigt der Hinweis', konflikt.beiEinigkeit === '');
check('KRITISCH: ein bestehender abweichender Wert bleibt erhalten',
  await page.evaluate(() => einsatzartOptionen('Reinigung').includes('Reinigung')));
check('Und er ist ausgewaehlt, wird also nicht still ueberschrieben',
  await page.evaluate(() => /<option selected>Reinigung<\/option>/.test(einsatzartOptionen('Reinigung'))));

// ── Vertragspruefungen gegen die Quellen
const gavQ = readFileSync(`${WURZEL}/gav.js`, 'utf8');
check('Die Regel steht in gav.js', /function gavGilt/.test(gavQ));
check('gav.js benennt, was bewusst BLEIBT (Arbeitsgesetz)', /Art\. 15 ArG/.test(gavQ));
const mschQ = readFileSync(`${WURZEL}/backend/api/meine_schichten.php`, 'utf8');
check('KRITISCH: die App bekommt die Sparte mitgeliefert', /e\.sparte/.test(mschQ));
const appQ = readFileSync(`${WURZEL}/app.html`, 'utf8');
check('Die App bindet den Zeitbonus an die Sparte', /gavGilt\(e\.sparte\)/.test(appQ));
check('Die App erklaert es der betroffenen Person', /reinigungHinweis/.test(appQ));
const dashQ = readFileSync(`${WURZEL}/dashboard.html`, 'utf8');
check('Das Cockpit bindet den Zeitbonus an die Sparte', /gavGilt\(sparteVon\(e\)\)/.test(dashQ));

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
