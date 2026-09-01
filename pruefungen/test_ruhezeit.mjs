// Ruhezeitpruefung (ENT-064) -- die erste Kontrollinstanz.
//
// Anders als Zeitbonus oder Auslagenersatz geht es hier nicht um Geld,
// sondern um Gesundheit: Art. 14 Ziff. 4 GAV behaelt die
// arbeitsgesetzlichen Vorschriften vor und laesst die PaKo bei groben
// Verstoessen das Arbeitsinspektorat einschalten.
//
// Die 11 Stunden stammen aus dem PAKO-Kommentar zu Art. 15 Ziff. 5 --
// eine Pruefung stellt sicher, dass die Quelle mitgefuehrt wird.
import { WURZEL, HIER, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const EXE = browserPfad();

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const T = n => iso(new Date(Date.now() + n * 864e5));
const A = { id: 1, name: 'anna', vorname: 'Anna', nachname: 'Muster', zusage: 'ja' };
const B = { id: 2, name: 'beat', vorname: 'Beat', nachname: 'Beispiel', zusage: 'ja' };

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
page.setDefaultTimeout(5000);
await page.route('**/api/**', r => {
  const u = r.request().url();
  const send = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) });
  if (u.includes('login')) return send({ status: 'ok', token: 't', name: 'adrian', ist_admin: true });
  if (u.includes('mitarbeiter_list')) return send({ status: 'ok', mitarbeiter: [
    { id: 1, name: 'anna', vorname: 'Anna', nachname: 'Muster', aktiv: 1, ist_admin: 0 },
    { id: 2, name: 'beat', vorname: 'Beat', nachname: 'Beispiel', aktiv: 1, ist_admin: 0 }]});
  if (u.includes('einsatz_list')) return send({ status: 'ok', einsaetze: [
    // Anna: Nachtdienst, endet am Folgetag um 06:00
    { id: 10, kunde_name: 'Beispiel AG', titel: 'Nachtdienst', ort: 'Olten', einsatzart: 'Revierdienst',
      sparte: 'sicherheit', datum: T(1), von: '22:00:00', bis: '06:00:00', bedarf: 1,
      status: 'geplant', mitarbeiter: [A] },
    // Beat: Tagdienst, endet um 16:00 -- danach ist reichlich Ruhezeit
    { id: 11, kunde_name: 'Muster GmbH', titel: 'Tagdienst', ort: 'Olten', einsatzart: 'Verkehrsdienst',
      sparte: 'sicherheit', datum: T(1), von: '08:00:00', bis: '16:00:00', bedarf: 1,
      status: 'geplant', mitarbeiter: [B] }]});
  return send({ status: 'ok', kpi: {}, verlauf: [], angemeldet: [], pro_mitarbeiter: [],
    letzte_rapporte: [], kunden: [], objekte: [], rapporte: [], orte: [], feiertage: [], gepflegt: {} });
});
await page.goto(`file://${WURZEL}/dashboard.html`);
await page.fill('#gName', 'a'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#shell.on'); await page.waitForTimeout(800);

// ══════════════ DIE REGEL SELBST
const l = (dA, vA, bA, dB, vB, bB) => page.evaluate(([a,b,c,d,e,f]) =>
  gavRuheLuecke(a,b,c,d,e,f), [dA,vA,bA,dB,vB,bB]);

check('Nachtschicht 22–06, danach 12:00 desselben Tages: 6 Stunden Lücke',
  (await l('2026-03-02','22:00','06:00','2026-03-03','12:00','16:00')) === 360);
check('Nachtschicht 22–06, danach 18:00: 12 Stunden Lücke',
  (await l('2026-03-02','22:00','06:00','2026-03-03','18:00','22:00')) === 720);
check('KRITISCH: die Lücke wird auch rueckwaerts gefunden',
  (await l('2026-03-03','12:00','16:00','2026-03-02','22:00','06:00')) === 360);
check('KRITISCH: ueberlappende Schichten sind keine Ruhezeitfrage, sondern Doppelbelegung',
  (await l('2026-03-02','08:00','16:00','2026-03-02','14:00','18:00')) === null);
check('Unvollstaendige Angaben ergeben null, nicht null Minuten',
  (await l('2026-03-02','08:00','', '2026-03-02','14:00','18:00')) === null);

const grenze = await page.evaluate(() => GAV_RUHEZEIT.stundenMin);
check('Die Schwelle liegt bei 11 Stunden', grenze === 11);
check('Der freie Tag ist mit 35 Stunden hinterlegt',
  (await page.evaluate(() => GAV_RUHEZEIT.freierTagMin)) === 35);
check('KRITISCH: die Quelle wird mitgefuehrt und nennt den PAKO-Kommentar',
  /PAKO-Kommentar zu Art\. 15/.test(await page.evaluate(() => GAV_RUHEZEIT.quelle)));
check('KRITISCH: die nicht umgesetzte Ausnahme ist benannt, nicht verschwiegen',
  /8 Stunden/.test(await page.evaluate(() => GAV_RUHEZEIT.ausnahmeOffen)));

// Genau an der Grenze: 11:00 ist keine Verletzung, 10:59 schon.
const v = (min) => page.evaluate(m => gavRuheVerletzungen('2026-03-03', m, '20:00',
  [{ datum: '2026-03-02', von: '22:00', bis: '06:00', titel: 'Nachtdienst' }]).length, min);
check('KRITISCH: genau 11 Stunden Ruhezeit ist keine Verletzung', (await v('17:00')) === 0);
check('KRITISCH: 10:59 Stunden ist eine Verletzung', (await v('16:59')) === 1);

// ══════════════ DIE ANZEIGE BEIM EINTEILEN
// Neue Schicht am Folgetag 12:00 -- Anna hatte Nachtdienst bis 06:00.
await page.evaluate(() => go('planung'));
await page.waitForTimeout(500);
await page.evaluate(t => openEinsatzNeu({ datum: t, von: '12:00', bis: '16:00', kunde_name: 'Test AG' }), T(2));
await page.waitForTimeout(700);

const felder = await page.evaluate(() => {
  const r = {};
  document.querySelectorAll('#enNMa label').forEach(l => {
    const n = l.querySelector('b').textContent.trim();
    const w = l.querySelector('.ruhe-warn');
    r[n] = { warn: w ? w.textContent.trim() : null, gesperrt: !!l.querySelector('input').disabled,
             frei: !!l.querySelector('.frei-marke') };
  });
  return r;
});
check('KRITISCH: die Unterschreitung wird gemeldet', !!felder['Anna Muster']?.warn);
check('Die Meldung nennt die tatsaechliche Ruhezeit', /6:00/.test(felder['Anna Muster']?.warn || ''));
check('Die Meldung nennt die verlangten 11 Stunden', /11/.test(felder['Anna Muster']?.warn || ''));
check('Die Meldung nennt die Schicht, gegen die geprueft wurde',
  /Nachtdienst/.test(felder['Anna Muster']?.warn || ''));
check('KRITISCH: das Einteilen bleibt moeglich — sie warnt, sie sperrt nicht',
  felder['Anna Muster']?.gesperrt === false);
check('KRITISCH: wer die Ruhezeit einhaelt, wird nicht gewarnt', !felder['Beat Beispiel']?.warn);
check('Und gilt weiterhin als verfuegbar', felder['Beat Beispiel']?.frei === true);
check('Wer gewarnt wird, gilt nicht gleichzeitig als "verfuegbar"',
  felder['Anna Muster']?.frei === false);

// ══════════════ DIE REGEL LIEGT IN gav.js
const gavQ = readFileSync(`${WURZEL}/gav.js`, 'utf8');
const dashQ = readFileSync(`${WURZEL}/dashboard.html`, 'utf8');
check('Die Ruhezeitregel steht in gav.js', /GAV_RUHEZEIT/.test(gavQ));
check('KRITISCH: das Dashboard haelt keine eigene Kopie der Schwelle',
  !/stundenMin: 11/.test(dashQ));
check('Der Wortlaut des Kommentars ist als Beleg im Code zitiert',
  /35 Stunden zwischen den Einsaetzen/.test(gavQ));

await page.screenshot({ path: `${OUT}/rz-01-warnung.png` });
await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
