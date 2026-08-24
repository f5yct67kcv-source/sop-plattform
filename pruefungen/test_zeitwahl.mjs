// Zeitwahl: Uhrzeit wählen statt tippen (ENT-110).
//
// Geprüft wird vor allem, dass der Ersatz für den übrigen Code unsichtbar
// bleibt: Die Kennung, der Wert über `.value` und die input-Ereignisse
// müssen sich verhalten wie beim alten Zeitfeld -- sonst hätte der Umbau
// still Stellen zerlegt, die niemand mehr angefasst hat.
import { WURZEL, HIER, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const EXE = browserPfad();
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const MORGEN = iso(new Date(Date.now() + 864e5));
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const MA = [{ id: 1, name: 'adrian', vorname: 'Adrian', nachname: 'von Arb', aktiv: 1, ist_admin: 1 }];
const KU = [{ id: 1, name: 'Stranag', strasse: 'Kantonsstrasse', ort: '6000 Luzern' }];
const EINSAETZE = [{ id: 81, kunde_id: 1, kunde_name: 'Stranag', titel: null,
  strasse: 'Kantonsstrasse', ort: '6000 Luzern', einsatzart: 'Verkehrsdienst',
  datum: MORGEN, von: '07:30:00', bis: '16:30:00', bedarf: 1, status: 'geplant',
  bemerkung: null, objekt_id: null, mitarbeiter: [] }];

const POS = { 81: [{ id: 601, nr: 1, funktion: 'Verkehrsdienst', position: null,
  // Krumme Zeit mit Absicht: So etwas steht im Bestand, und allein das
  // Öffnen eines Dialogs darf es nicht verschieben.
  von: '07:37:00', bis: '16:30:00', std_verrechnung: null, pauschal: null,
  qualifikation: null, gesperrt: 0, bemerkung: null, mitarbeiter_id: null,
  mitarbeiter: null, vorname: null, nachname: null, zusage: null }] };

const rufe = [];
const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
await page.route('**/api/**', route => {
  const req = route.request(), p = req.url().split('/api/')[1].split('?')[0];
  let body = null;
  try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch (e) {}
  rufe.push({ p, body });
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'adrian', ist_admin: true });
  if (p.includes('mitarbeiter_list')) return send({ status: 'ok', mitarbeiter: MA });
  if (p.includes('kunden_list')) return send({ status: 'ok', kunden: KU });
  if (p.includes('einsatz_list')) return send({ status: 'ok', einsaetze: EINSAETZE });
  if (p.includes('einsatz_position')) return send({ status: 'ok', positionen: POS[81] });
  if (p.includes('dashboard_stats')) return send({ status: 'ok', kpi: { rapporte_monat: 0, rapporte_vormonat: 0,
    stunden_monat: 0, stunden_vormonat: 0, mitarbeiter: 1, kunden: 1, rapporte_total: 0 },
    verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [], sperr_ereignisse: [] });
  return send({ status: 'ok', einsaetze: [], rapporte: [], objekte: [], feiertage: [], gepflegt: {},
    sperren: [], masterschichten: [], zuteilungen: [] });
});
await page.goto(`file://${WURZEL}/dashboard.html`);
await page.fill('#gName', 'adrian'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#shell.on'); await page.waitForTimeout(600);

// Hilfen: Die Auswahlfelder stehen in der Hülle VOR dem ursprünglichen Feld.
const wahl = async (id, art) => page.evaluate(([i, a]) => {
  const el = document.getElementById(i);
  return el && el.__zw ? el.__zw[a].value : null;
}, [id, art]);
const optionen = (id, art) => page.evaluate(([i, a]) => {
  const el = document.getElementById(i);
  return el && el.__zw ? [...el.__zw[a].options].map(o => o.value).filter(Boolean) : null;
}, [id, art]);
const setzen = async (id, art, wert) => {
  await page.evaluate(([i, a, w]) => {
    const s = document.getElementById(i).__zw[a];
    s.value = w;
    s.dispatchEvent(new Event('change', { bubbles: true }));
  }, [id, art, wert]);
  await page.waitForTimeout(150);
};

// ══════════ KEIN FREIES ZEITFELD BLEIBT ÜBRIG
check('KRITISCH: nirgends steht mehr ein freies Zeitfeld',
  await page.evaluate(() => document.querySelectorAll('input[type="time"]').length === 0));
check('Stattdessen überall die Zeitwahl',
  await page.evaluate(() => document.querySelectorAll('.zeitwahl').length >= 8));
check('Das Aussehen bringt die Komponente selbst mit',
  await page.evaluate(() => !!document.getElementById('zeitwahl-stil')));

// ══════════ PLANUNG: NUR VIERTELSTUNDEN
await page.evaluate(() => openEinsatzNeu());
await page.waitForTimeout(400);
check('Die Anlegen-Ansicht steht offen', await page.isVisible('#view-einsatzneu.on'));
check('KRITISCH: in der Planung stehen nur Viertelstunden zur Wahl',
  JSON.stringify(await optionen('enNVon', 'min')) === JSON.stringify(['00', '15', '30', '45']));
check('Die Stunden gehen von 00 bis 23',
  (await optionen('enNVon', 'std')).length === 24);
await setzen('enNVon', 'std', '07');
await setzen('enNVon', 'min', '45');
check('KRITISCH: die Auswahl landet im ursprünglichen Feld',
  (await page.inputValue('#enNVon')) === '07:45');
check('Eine halbe Angabe ergibt noch keine Uhrzeit', await page.evaluate(() => {
  const el = document.getElementById('enNBis');
  el.__zw.std.value = '16';
  el.__zw.std.dispatchEvent(new Event('change', { bubbles: true }));
  return el.value === '';
}));
await page.evaluate(() => enNeuAbbrechen());
await page.waitForTimeout(250);

// ══════════ IST-ZEITEN BLEIBEN MINUTENGENAU
// Was jemand tatsächlich gearbeitet hat, ist keine Planungsgrösse.
await page.evaluate(() => go('abgleich'));
await page.waitForTimeout(600);
const agMin = await optionen('agMzVon', 'min');
check('KRITISCH: im Abgleich ist jede Minute wählbar', agMin && agMin.length === 60);
check('KRITISCH: dort gibt es kein Viertelstunden-Raster', agMin && agMin.includes('07'));

// ══════════ EIN KRUMMER BESTANDSWERT WIRD NICHT STILL VERSCHOBEN
await page.evaluate(() => { go('planung'); goTab('einsaetze'); });
await page.waitForTimeout(500);
await page.evaluate(() => epAuf(81));
await page.waitForTimeout(700);
await page.click('#epRaster table.ep-gitter tbody tr:first-child .ep-werk button[title="Schicht bearbeiten"]');
await page.waitForTimeout(400);
check('Der Schicht-Dialog steht offen', await page.isVisible('#dlgSchicht.on'));
check('KRITISCH: die krumme Bestandszeit steht unverändert da',
  (await page.inputValue('#eps_von')) === '07:37');
check('KRITISCH: und ist trotz Viertelstunden-Raster ausgewählt',
  (await wahl('eps_von', 'min')) === '37');
check('Das Raster bleibt daneben bestehen',
  (await optionen('eps_von', 'min')).join() === '00,15,30,37,45');
// Erst wer die Minute anfasst, ändert sie -- dann aber im Raster.
await setzen('eps_von', 'min', '45');
check('Nach dem Umstellen steht eine Viertelstunde da',
  (await page.inputValue('#eps_von')) === '07:45');
// Sie bleibt bewusst wählbar, solange der Dialog offen ist: Wer sich
// verklickt, kommt so zum Ausgangswert zurück, ohne abbrechen zu müssen.
// Eine NEUE krumme Zeit lässt sich damit nicht erzeugen -- die 37 stammt
// aus dem Bestand. Beim nächsten Öffnen ist sie weg.
check('Die krumme Zahl bleibt als Rückweg wählbar',
  (await optionen('eps_von', 'min')).includes('37'));
await page.screenshot({ path: OUT + '/86-zeitwahl.png' });

// ══════════ SCHREIBEN AUS DEM ÜBRIGEN CODE ZIEHT DIE AUSWAHL MIT
// Der Umbau darf nicht verlangen, dass jede Stelle im Programm von der
// Zeitwahl weiss -- sonst wäre er an jedem `.value = ...` vorbeigelaufen.
await page.evaluate(() => { document.getElementById('eps_bis').value = '12:15'; });
await page.waitForTimeout(150);
check('KRITISCH: ein Zuweisen aus dem Code stellt die Auswahlfelder nach',
  (await wahl('eps_bis', 'std')) === '12' && (await wahl('eps_bis', 'min')) === '15');
await page.evaluate(() => { document.getElementById('eps_bis').value = ''; });
await page.waitForTimeout(150);
check('Ein Leeren stellt beide Felder auf leer',
  (await wahl('eps_bis', 'std')) === '' && (await wahl('eps_bis', 'min')) === '');
await page.evaluate(() => closeDlg('dlgSchicht'));

// ══════════ GESTALTUNG: GEMESSEN
try {
  await page.evaluate(() => openEinsatzNeu());
  await page.waitForTimeout(400);
  const m = await page.evaluate(() => {
    const h = document.getElementById('enNVon').__zw;
    const a = h.std.getBoundingClientRect(), b = h.min.getBoundingClientRect();
    return { gleicheHoehe: Math.abs(a.top - b.top) <= 1, nebeneinander: a.right <= b.left + 1,
             breiteGleich: Math.abs(a.width - b.width) <= 2 };
  });
  check('KRITISCH: Stunde und Minute stehen nebeneinander', m.nebeneinander);
  check('Auf einer Höhe', m.gleicheHoehe);
  check('Und gleich breit', m.breiteGleich);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(350);
  const handy = await page.evaluate(() => {
    const h = document.getElementById('enNVon').__zw;
    const a = h.std.getBoundingClientRect();
    return { hoch: Math.round(a.height), schrift: parseFloat(getComputedStyle(h.std).fontSize),
             quer: document.documentElement.scrollWidth > window.innerWidth + 1 };
  });
  check('KRITISCH: auf dem Handy mindestens 44 px hoch', handy.hoch >= 44);
  check('KRITISCH: Schrift mindestens 16 px — sonst zoomt iOS hinein', handy.schrift >= 16);
  check('Kein Querscrollen auf dem Handy', handy.quer === false);
  await page.setViewportSize({ width: 1500, height: 1000 });
} catch (e) { bad.push('Gestaltung: ' + String(e).split('\n')[0].slice(0, 110)); }

// ══════════ DIE APP DER MITARBEITENDEN BEKOMMT DASSELBE BEDIENELEMENT
const app = await browser.newPage({ viewport: { width: 390, height: 844 } });
app.on('pageerror', e => bad.push('JS-Fehler (App): ' + e.message));
await app.goto(`file://${WURZEL}/app.html`);
await app.waitForTimeout(500);
check('KRITISCH: die App lädt dieselbe Zeitwahl',
  await app.evaluate(() => typeof window.zeitwahlAnwenden === 'function'));
check('Und bringt ihr Aussehen mit',
  await app.evaluate(() => !!document.getElementById('zeitwahl-stil')));
check('KRITISCH: die Ist-Zeiten der App sind als minutengenau gekennzeichnet',
  await app.evaluate(() => {
    const h = document.documentElement.innerHTML;
    return /id="srVon"[^>]*data-zeit="fein"/.test(h) && /id="srBis"[^>]*data-zeit="fein"/.test(h);
  }));

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
await browser.close();
