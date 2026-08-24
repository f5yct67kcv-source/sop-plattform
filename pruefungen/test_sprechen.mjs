// Globaler Sprechen-Knopf im Topbar (ENT-038): derselbe Diktat-Router wie im
// Begrüssungs-Container (ENT-032), aber von jeder Haupt- und Unterseite aus
// erreichbar -- ausser der Übersicht, wo es ihn schon eingebettet gibt.
import { WURZEL, HIER, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const rufe = [];
const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
await page.route('**/api/**', route => {
  const req = route.request(), p = req.url().split('/api/')[1].split('?')[0];
  let body = null;
  try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch {}
  rufe.push({ p, body });
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'a', ist_admin: true });
  if (p.includes('ki_router_parse')) {
    const t = (body && body.text || '').toLowerCase();
    if (t.includes('ändere')) return send({ status: 'ok', bereich: 'mitarbeiter', aktion: 'aendern',
      mitarbeiter_login_name: 'hans.meier', aenderungen: { ort: '3000 Bern' } });
    if (t.includes('kunde')) return send({ status: 'ok', bereich: 'kunde', aktion: 'neu',
      felder: { name: 'Neue Firma AG', ort: '4600 Olten' }, mitarbeiter_login_namen: [] });
    if (t.includes('einsatz')) return send({ status: 'ok', bereich: 'einsatz', aktion: 'neu',
      felder: { kunde_name: 'Borner AG', ort: 'Olten', datum: '2026-09-01', von: '07:00', bis: '16:00' },
      mitarbeiter_login_namen: [] });
    return send({ status: 'ok', bereich: 'mitarbeiter', aktion: 'neu',
      felder: { vorname: 'Neu', nachname: 'Person' }, mitarbeiter_login_namen: [] });
  }
  // Seit ENT-072 kommt das volle Dossier einzeln; die Liste traegt nur noch
  // die Listenfelder.
  if (p.includes('mitarbeiter_dossier')) return send({ status: 'ok', eingerichtet: true,
    mitarbeiter: { name: 'hans.meier', ist_admin: 0, vorname: 'Hans', nachname: 'Meier',
      plz: '4600', ort: 'Olten' } });
  if (p.includes('anstellungsorte')) return send({ status: 'ok', orte: [] });
  if (p.includes('mitarbeiter_list')) return send({ status: 'ok', eingerichtet: true,
    listen: { funktion: [], abteilung: [] }, mitarbeiter: [
    { name: 'hans.meier', ist_admin: 0, vorname: 'Hans', nachname: 'Meier', ort: 'Olten' },
  ]});
  return send({ status: 'ok', einsaetze: [], kunden: [], rapporte: [], objekte: [], mitarbeiter: [],
    feiertage: [], gepflegt: {}, sperren: [], kpi: {}, verlauf: [], angemeldet: [],
    pro_mitarbeiter: [], letzte_rapporte: [] });
});
await page.goto(`file://${WURZEL}/dashboard.html`);
await page.fill('#gName', 'a'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#shell.on');

// ══════════════════════════════════════════ SICHTBARKEIT JE SEITE
check('Auf der Übersicht ist der globale Knopf versteckt -- der Router sitzt dort schon im Container',
  !(await page.isVisible('#btnSprechen')));
check('Der Begrüssungs-Container hat seinen eigenen Router weiterhin', await page.isVisible('#rtText'));

for (const [name, hin] of [
  ['Kunden/Rapporte', () => page.evaluate(() => { go('kunden'); kuGoTab('rapporte'); })],
  ['Mitarbeitende', () => page.evaluate(() => go('mitarbeiter'))],
  ['Kunden', () => page.evaluate(() => go('kunden'))],
]) {
  await hin();
  await page.waitForTimeout(200);
  check(`Auf ${name} ist der Knopf sichtbar`, await page.isVisible('#btnSprechen'));
}

await page.evaluate(() => go('planung'));
await page.waitForTimeout(200);
for (const [name, tab] of [
  ['Planung/Übersicht', 'uebersicht'],
  ['Planung/Objektplanung', 'objektplan'], ['Planung/Tagesplan', 'tag'],
]) {
  await page.evaluate(t => goTab(t), tab);
  await page.waitForTimeout(200);
  check(`Auf ${name} ist der Knopf sichtbar (keine Sonderrolle wie bei der Dashboard-Übersicht)`,
    await page.isVisible('#btnSprechen'));
}
// Seit ENT-107 hat Planung/Einsätze denselben Router eingebettet wie die
// Übersicht -- dieselbe Regel wie dort (ENT-038): ein zweiter Weg daneben
// wäre doppelt gemoppelt, also verschwindet der globale Knopf hier auch.
await page.evaluate(() => goTab('einsaetze'));
await page.waitForTimeout(200);
check('KRITISCH: auf Planung/Einsätze ist der globale Knopf jetzt versteckt -- der Router sitzt hier eingebettet',
  !(await page.isVisible('#btnSprechen')));
check('Und die eingebettete Zeile ist wirklich da', await page.isVisible('#peText'));
// Wechsel zurueck auf einen Reiter ohne eigenen Router muss den Knopf wieder
// zeigen -- sonst bliebe er nach dem ersten Besuch von Einsätze fuer immer
// versteckt.
await page.evaluate(() => goTab('objektplan'));
await page.waitForTimeout(200);
check('KRITISCH: beim Wechsel weg von Einsätze taucht der Knopf wieder auf',
  await page.isVisible('#btnSprechen'));
await page.evaluate(() => goTab('einsaetze'));
await page.waitForTimeout(200);
await page.screenshot({ path: OUT + '/95-sprechen-planung.png' });

// Objekte sind seit ENT-039 ein Unterpunkt von Kunden, nicht mehr der Planung.
await page.evaluate(() => { go('kunden'); kuGoTab('objekte'); });
await page.waitForTimeout(200);
check('Auf Kunden/Objekte ist der Knopf ebenfalls sichtbar', await page.isVisible('#btnSprechen'));

await page.evaluate(() => go('uebersicht'));
await page.waitForTimeout(200);
check('Zurück auf der Übersicht wieder versteckt', !(await page.isVisible('#btnSprechen')));

// ══════════════════════════════════════════ PLATZIERUNG UND OPTIK
await page.evaluate(() => go('mitarbeiter'));
await page.waitForTimeout(200);
const lage = await page.evaluate(() => {
  const s = document.getElementById('btnSprechen').getBoundingClientRect();
  const t = document.getElementById('btnThema').getBoundingClientRect();
  return { sprechenRechts: s.right, themaLinks: t.left };
});
check('Der Knopf steht links vom Hell/Dunkel-Schalter', lage.sprechenRechts <= lage.themaLinks + 1);
check('Kein Standard-Knopf: eigene Klasse statt .btn-plain/.btn-quiet',
  await page.evaluate(() => {
    const c = document.getElementById('btnSprechen').className;
    return c.includes('btn-sprechen') && !c.includes('btn-plain') && !c.includes('btn-quiet');
  }));
const farbe = await page.$eval('#btnSprechen', el => getComputedStyle(el).backgroundImage);
check('Der Knopf hat eine eigene, auffällige Füllung (nicht transparent)', farbe.includes('gradient'));

// ══════════════════════════════════════════ DIALOG UND VERSAND
await page.click('#btnSprechen');
await page.waitForTimeout(300);
check('Der Dialog öffnet sich', await page.evaluate(() => document.getElementById('dlgSprechen').classList.contains('on')));
check('Textfeld ist leer beim Öffnen', (await page.inputValue('#gsText')) === '');
check('Mikrofon-Knopf ist da (derselbe Baustein wie überall, ENT-027)', await page.isVisible('#gsMik'));
await page.click('#gsBtn');
await page.waitForTimeout(200);
check('Leeres Diktat wird abgewiesen', await page.isVisible('#gsErr'));
check('Ohne Text kein Aufruf des Routers', !rufe.some(r => r.p.includes('ki_router_parse')));

await page.click('#dlgSprechen button:has-text("Abbrechen")');
await page.waitForTimeout(200);
check('Abbrechen schliesst den Dialog ohne Aufruf', !(await page.evaluate(() =>
  document.getElementById('dlgSprechen').classList.contains('on'))) && !rufe.some(r => r.p.includes('ki_router_parse')));

// ══════════════════════════════════════════ DISPATCH IN ALLE DREI BEREICHE
rufe.length = 0;
await page.click('#btnSprechen');
await page.fill('#gsText', 'Neuer Mitarbeiter Neu Person');
await page.click('#gsBtn');
await page.waitForTimeout(400);
check('Router-Aufruf mit dem eingegebenen Text', rufe.some(r => r.p.includes('ki_router_parse') && r.body.text.includes('Neuer Mitarbeiter')));
check('Dialog schliesst nach dem Versand', !(await page.evaluate(() => document.getElementById('dlgSprechen').classList.contains('on'))));
check('„mitarbeiter“ öffnet die Anlegen-Flaeche (seit ENT-072 kein eigener Dialog mehr)',
  await page.evaluate(() => document.getElementById('mv-bearbeiten').classList.contains('on')));
check('KRITISCH: nichts wird automatisch gespeichert (ENT-015)', !rufe.some(r => /save|create/.test(r.p)));
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

await page.click('#btnSprechen');
await page.fill('#gsText', 'Neuer Kunde für die Firma');
await page.click('#gsBtn');
await page.waitForTimeout(400);
check('„kunde“ öffnet den Kunden-Neu-Dialog', await page.evaluate(() => document.getElementById('dlgKunde').classList.contains('on')));
check('Kundenname vorbefüllt', (await page.inputValue('#ku_name')) === 'Neue Firma AG');
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

// Von der Kunden-Seite aus einen Einsatz diktieren -- die Seite, auf der man
// gerade steht, spielt für den Router keine Rolle (ENT-038, "immer derselbe").
await page.click('#btnSprechen');
await page.fill('#gsText', 'Neuer Einsatz für morgen');
await page.click('#gsBtn');
await page.waitForTimeout(400);
check('„einsatz“ öffnet den Einsatz-Neu-Dialog, auch von einer fachfremden Seite aus',
  await page.evaluate(() => document.getElementById('dlgEnNeu').classList.contains('on')));
check('Einsatzfelder vorbefüllt', (await page.inputValue('#enNKunde_name')) === 'Borner AG');
await page.screenshot({ path: OUT + '/96-sprechen-dispatch.png' });
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

// ══════════════════════════════════════════ AENDERN STATT NEUANLAGE (ENT-042)
// Der Router deckt bei Mitarbeitenden seit ENT-042 auch eine Aenderung an
// einer bestehenden Person ab -- dafuer oeffnet sich seit ENT-072 die volle
// Bearbeitungsflaeche statt eines "Neu"-Dialogs. Fuer Kunde/Einsatz gibt es
// das weiterhin nicht.
rufe.length = 0;
await page.click('#btnSprechen');
await page.fill('#gsText', 'Ändere den Wohnort von Hans Meier');
await page.click('#gsBtn');
await page.waitForTimeout(700);
check('„aendern“ öffnet die Bearbeitungsflaeche statt eines Neu-Dialogs',
  await page.evaluate(() => document.getElementById('mv-bearbeiten').classList.contains('on')));
check('Kein Neu-Modus, sondern eine bestehende Person',
  await page.evaluate(() => mbNeuModus === false));
check('Geänderter Ort eingesetzt', (await page.inputValue('#mb_ort')) === 'Bern');
check('KRITISCH: PLZ und Ort werden getrennt, nicht zusammen ins Ortsfeld gelegt',
  (await page.inputValue('#mb_plz')) === '3000');
check('KRITISCH: nichts wird automatisch gespeichert (ENT-015)', !rufe.some(r => /save|create|update/.test(r.p)));

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
