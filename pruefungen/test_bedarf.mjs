// Der Fall des Projektinhabers: fuenf Masterschichten, ueberall Bedarf 0.
// Der Monat ist leer, "Erzeugen" ist ausgegraut -- und die Oberflaeche muss
// sagen warum, statt etwas Falsches zu behaupten.
import { WURZEL, HIER, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { zeitSetzen } from './zeitfeld.mjs';

const EXE = browserPfad();
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const M = iso(new Date()).slice(0, 7);
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const OBJ = { id: 1, kunde_id: 1, kunde_name: 'Borner AG', name: 'Gerolag Center',
  strasse: 'Industriestrasse 78', ort: '4601 Olten', kanton: 'SO', einsatzart: 'Revierdienst',
  aktiv: 1, masterschichten: 5 };
// Genau wie beim Projektinhaber: alle Bedarfsfelder auf 0.
const mk = (id, name, kuerzel, von, bis, h, art) => ({ id, objekt_id: 1, name, kuerzel, art: art || 'arbeit',
  von: von + ':00', bis: bis + ':00', pause_von: null, pause_bis: null, pause_min: 0, arbeitszeit_h: h,
  farbe: null, auf_abruf: 0, rhythmus: 'woche', bedarf_mo: 0, bedarf_di: 0, bedarf_mi: 0, bedarf_do: 0,
  bedarf_fr: 0, bedarf_sa: 0, bedarf_so: 0, bedarf_feiertag: 0, intervall_tage: null,
  intervall_start: null, bedarf_intervall: 0, gueltig_ab: '2026-08-01', gueltig_bis: null,
  ersetzt_id: null, laeuft: true });
const MSL = [
  mk(1, 'Revierdienst Öffnungsrunde', 'ÖF', '05:15', '05:30', 0.25),
  mk(2, 'Revierdienst Öffnungsrunde', 'RÖ', '05:45', '06:00', 0.25),
  mk(3, 'Fahrtzeit', 'FZ', '06:00', '06:15', 0.25, 'fahrtzeit'),
  mk(4, 'Revierdienst Schliessrunde', null, '22:00', '22:30', 0.5),
  mk(5, 'Fahrtzeit nach Niedergösgen', null, '22:30', '22:45', 0.25, 'fahrtzeit'),
];
const vorlagenFuerPlan = () => MSL.map(x => ({ id: x.id, name: x.name, kuerzel: x.kuerzel, art: x.art,
  von: x.von.slice(0, 5), bis: x.bis.slice(0, 5), arbeitszeit_h: x.arbeitszeit_h, auf_abruf: x.auf_abruf,
  farbe: null, gueltig_ab: x.gueltig_ab, gueltig_bis: x.gueltig_bis }));

const rufe = [];
const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
await page.route('**/api/**', route => {
  const req = route.request(), u = req.url(), p = u.split('/api/')[1].split('?')[0];
  let body = null;
  try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch (e) {}
  rufe.push({ p, body, u });
  const send = (b, s) => route.fulfill({ status: s || 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'a', ist_admin: true });
  if (p.includes('objektplan')) return send({ status: 'ok', objekt: OBJ, von: M + '-01', bis: M + '-28',
    vorlagen: vorlagenFuerPlan(), bedarf: [], einsaetze: [], feiertage: {} });
  // Kein Bedarf, nichts vorhanden -- genau der Zustand beim Projektinhaber
  if (p.includes('schichten_vorschau')) return send({ status: 'ok', objekt: OBJ, anzahl: 0,
    gezeigt: 0, schichten: [], uebersprungen: 0, vorlagen: 5, feiertage: 1 });
  if (p.includes('masterschicht_save')) return send({ status: 'ok', id: 1, art: 'ersetzt' });
  if (p.includes('masterschicht_list')) return send({ status: 'ok', masterschichten: MSL });
  if (p.includes('objekt_list')) return send({ status: 'ok', objekte: [OBJ] });
  if (p.includes('mitarbeiter_list')) return send({ status: 'ok', mitarbeiter: [
    { id: 1, name: 'adrian', vorname: 'Adrian', nachname: 'von Arb', aktiv: 1, ist_admin: 1 }] });
  return send({ status: 'ok', einsaetze: [], kunden: [], rapporte: [], feiertage: [], gepflegt: {},
    kpi: {}, verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [] });
});

await page.goto(`file://${WURZEL}/dashboard.html`);
await page.fill('#gName', 'a'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#shell.on'); await page.waitForTimeout(400);
await page.evaluate(() => go('planung')); await page.waitForTimeout(250);
await page.evaluate(() => goTab('objektplan')); await page.waitForTimeout(700);

// ══════════ DER LEERE MONAT ERKLÄRT SICH SELBST
const txt = await page.textContent('#oplBody');
check('Der leere Monat wird erklärt', txt.includes('Kein Bedarf hinterlegt'));
check('Die Erklärung nennt die Zahl der Vorlagen', txt.includes('5 Masterschichten'));
check('Die Erklärung nennt den ausgegrauten Knopf', txt.includes('ausgegraut'));
check('Es gibt einen Weg zur Behebung',
  await page.evaluate(() => [...document.querySelectorAll('#oplBody button')]
    .some(b => b.textContent.includes('Bedarf jetzt eintragen'))));
await page.screenshot({ path: OUT + '/53-kein-bedarf.png' });

// ══════════ DIE VORSCHAU BEHAUPTET NICHTS FALSCHES MEHR
await page.evaluate(() => oplErzeugen());
await page.waitForTimeout(600);
const vs = await page.textContent('#vsInhalt');
check('Vorschau behauptet nicht „bereits alles angelegt"', !vs.includes('bereits alles angelegt'));
check('Vorschau nennt den wahren Grund', vs.includes('kein Bedarf') || vs.includes('Bedarf'));
check('Vorschau nennt die Bedarfszahlen auf 0', vs.includes('0'));
check('Vorschau zeigt den Weg', vs.includes('Masterschichten'));
check('Erzeugen bleibt ausgegraut', await page.evaluate(() => $('vsBtn').disabled));
await page.screenshot({ path: OUT + '/54-vorschau-ohne-bedarf.png' });
await page.evaluate(() => closeDlg('dlgVorschau'));

// ══════════ NEUE MASTERSCHICHT: VORGABE IST 1, NICHT 0
await page.evaluate(() => { obTarget = 1; openMs('neu'); });
await page.waitForTimeout(400);
const vorgaben = await page.evaluate(() =>
  ['mo','di','mi','do','fr','sa','so','feiertag'].map(t => $('msBedarf_' + t).value));
check('Neue Vorlage startet mit Bedarf 1 je Tag', vorgaben.every(v => v === '1'));
// Wer alles auf 0 setzt, bekommt eine Erklärung statt einer wirkungslosen Vorlage
await page.fill('#msName', 'Testrunde');
await zeitSetzen(page, '#msVon', '08:00'); await zeitSetzen(page, '#msBis', '09:00');
for (const t of ['mo','di','mi','do','fr','sa','so','feiertag']) await page.fill('#msBedarf_' + t, '0');
const vorSave = rufe.filter(r => r.p.includes('masterschicht_save')).length;
await page.click('#msBtn');
await page.waitForTimeout(400);
check('Vorlage ohne Bedarf wird abgefangen', await page.isVisible('#msErr'));
check('Die Meldung erklärt die Folge', (await page.textContent('#msErr')).includes('an keinem Tag eine Schicht erzeugen'));
check('Nichts wird gespeichert', rufe.filter(r => r.p.includes('masterschicht_save')).length === vorSave);
await page.fill('#msBedarf_mo', '1');
await page.click('#msBtn');
await page.waitForTimeout(500);
check('Mit Bedarf wird gespeichert', rufe.filter(r => r.p.includes('masterschicht_save')).length === vorSave + 1);

// ══════════ ÄNDERN: DER HINWEIS SAGT DIE WAHRHEIT
// Ueber den echten Weg: Objekt oeffnen laedt die Masterschichten
await page.evaluate(() => { closeDlg('dlgMs'); openObjekt(1); });
await page.waitForTimeout(600);
await page.evaluate(() => openMs('aenderung', 1));
await page.waitForTimeout(400);
check('Stichtaghinweis ist sichtbar', await page.isVisible('#msStichtagHint'));
const heuteHint = await page.textContent('#msStichtagText');
check('Vorgabe heute kündigt eine zweite Fassung an', heuteHint.includes('bleibt in der Liste stehen'));
// Stichtag auf den Beginn der bisherigen Fassung: dann wird ersetzt statt geteilt
await page.fill('#msGueltigAb', '2026-08-01');
await page.waitForTimeout(250);
const ersetztHint = await page.textContent('#msStichtagText');
check('Stichtag am Beginn kündigt Ersetzen an', ersetztHint.includes('vollständig ersetzt'));
check('Der Hinweis sagt, wann das richtig ist', ersetztHint.includes('nie eine Schicht erzeugt'));
await page.fill('#msGueltigAb', '2026-09-01');
await page.waitForTimeout(250);
check('Späterer Stichtag kündigt wieder zwei Fassungen an',
  (await page.textContent('#msStichtagText')).includes('bleibt in der Liste stehen'));
await page.screenshot({ path: OUT + '/55-stichtag-hinweis.png' });

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
