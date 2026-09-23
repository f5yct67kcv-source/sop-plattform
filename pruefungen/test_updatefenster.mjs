// Das Update-Fenster (ENT-698).
//
// Scharf gehalten wird, was der Projektinhaber entschieden hat:
//  - Es oeffnet sich beim Anmelden von selbst, wenn ein Update aussteht
//    oder es ungelesene Neuerungen gibt -- nicht nur als Punkt am Konto.
//  - Wer einspielen darf, bekommt "Jetzt einspielen", alle anderen den
//    Hinweis, dass die Verwaltung es einspielt.
//  - Der Balken zeigt echten Fortschritt: je Etappe eine Anfrage, und er
//    waechst erst, wenn eine Etappe fertig ist.
//  - Danach steht nur, was schiefging -- nicht, was eingerichtet wurde oder
//    schon da war.
//  - "Spaeter" markiert nichts als gelesen, "Verstanden" schon.
//  - Am Handy ein Blatt von unten, gemessen, nicht nachgelesen.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const NEU = [
  { nr: 3, datum: '2028-06-10', art: 'fehlerbehebung', art_titel: 'Fehlerbehebung',
    titel: 'Eine Korrektur', text: 'Etwas geht jetzt wieder.' },
  { nr: 2, datum: '2028-06-10', art: 'neu', art_titel: 'Neu',
    titel: 'Eine Neuerung', text: 'Etwas ist dazugekommen.' },
];
const ETAPPEN = { tabellen: 'Tabellen anlegen', spalten: 'Spalten und Daten nachtragen',
  verweise: 'Verweise prüfen', betreiber: 'Betreiber-Ebene' };

// Umschaltbarer Stand des nachgebauten Servers.
let STAND;
const standZurueck = () => { STAND = {
  neuerungen: NEU, ausstehend: 3, darf: true,
  fehlerBei: null,            // Etappe, die einen Fehler meldet
  bremse: 0,                  // Verzoegerung je Etappe (ms)
}; };
standZurueck();
const rufe = [];

async function seite(viewport) {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
  await page.route('**/api/**', async route => {
    const req = route.request(), u = req.url(), p = u.split('/api/')[1].split('?')[0];
    let body = null;
    try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch (e) {}
    rufe.push({ p, methode: req.method(), body, zeit: Date.now() });
    const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'a', ist_admin: true });
    if (p === 'neuerungen_stand.php') {
      if (req.method() === 'POST') return send({ status: 'ok', gesehen_bis: body.bis });
      return send({ status: 'ok', ziel: 'cockpit', neueste: 3, gesehen_bis: 1,
        neuerungen: STAND.neuerungen, einrichtung_ausstehend: STAND.ausstehend,
        darf_einspielen: STAND.darf });
    }
    if (p.includes('planung_einrichten')) {
      if (req.method() === 'GET') {
        return send({ status: 'ok', message: '', getan: [], unveraendert: [], fehler: [],
          ausstehend: STAND.ausstehend, etappen: ETAPPEN });
      }
      if (STAND.bremse) { await new Promise(r => setTimeout(r, STAND.bremse)); }
      const e = body && body.etappe;
      const fehler = e && e === STAND.fehlerBei ? ['Spalte x.y: Zugriff verweigert'] : [];
      return send({ status: fehler.length ? 'error' : 'ok',
        message: fehler.length ? '1 Schritt(e) sind fehlgeschlagen — die uebrigen sind gelaufen.' : 'Einrichtung abgeschlossen.',
        getan: ['Tabelle verfuegbarkeiten angelegt'],
        unveraendert: ['Tabelle objekte war bereits vorhanden'],
        fehler, ausstehend: 0, etappen: ETAPPEN });
    }
    return send({ status: 'ok', einsaetze: [], kunden: [], rapporte: [], objekte: [], mitarbeiter: [],
      feiertage: [], gepflegt: {}, sperren: [], kpi: {}, verlauf: [], angemeldet: [],
      pro_mitarbeiter: [], letzte_rapporte: [] });
  });
  await page.goto(`file://${WURZEL}/dashboard.html`);
  await page.fill('#gName', 'a'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
  await page.waitForSelector('#shell.on');
  await page.waitForTimeout(700);
  return page;
}
const offen = page => page.evaluate(() => document.getElementById('dlgEinrichtung').classList.contains('on'));
const text = (page, sel) => page.textContent(sel);

const browser = await chromium.launch({ executablePath: EXE });

// ══ 1. Desktop, Update steht aus, darf einspielen ══════════════════════
let page = await seite({ width: 1400, height: 900 });
check('KRITISCH: steht ein Update aus, oeffnet sich das Fenster beim Anmelden von selbst',
  await offen(page));
check('Es heisst „Update erforderlich“', (await text(page, '#updTitel')).includes('Update erforderlich'));
const neuText = await text(page, '#updNeu');
check('Die Neuerungen stehen im Fenster, nach Art gruppiert',
  neuText.includes('Eine Neuerung') && neuText.includes('Eine Korrektur')
  && neuText.indexOf('Neu') < neuText.indexOf('Fehlerbehebungen'));
check('Der Knopf heisst „Jetzt einspielen“', (await text(page, '#eiBtn')).trim() === 'Jetzt einspielen');
check('Daneben steht „Später“', (await text(page, '#updZu')).trim() === 'Später');
await page.screenshot({ path: `${OUT}/updatefenster-desktop.png` });

// Gemessen: das Fenster steht in der Mitte des Bildschirms.
const lage = await page.evaluate(() => {
  const r = document.querySelector('#dlgEinrichtung .dlg').getBoundingClientRect();
  return { mitteX: r.left + r.width / 2, mitteY: r.top + r.height / 2, breite: r.width };
});
check('Das Fenster steht waagrecht in der Mitte', Math.abs(lage.mitteX - 700) < 3);
check('und senkrecht in der Mitte', Math.abs(lage.mitteY - 450) < 3);
check('Es ist breit genug fuer die Texte, aber kein Vollbild', lage.breite > 440 && lage.breite <= 520);

// „Später“ schliesst und markiert NICHTS als gelesen.
let vorher = rufe.length;
await page.click('#updZu');
await page.waitForTimeout(250);
check('„Später“ schliesst das Fenster', !(await offen(page)));
check('KRITISCH: „Später“ markiert nichts als gelesen',
  !rufe.slice(vorher).some(r => r.p === 'neuerungen_stand.php' && r.methode === 'POST'));
check('Der Punkt am Kontomenü bleibt gefärbt',
  await page.evaluate(() => $('nav-einrichtung').classList.contains('hat-update')));

// ── Von Hand wieder oeffnen und einspielen, gebremst: Fortschritt ablesen
STAND.bremse = 350;
await page.evaluate(() => eiOeffnen());
await page.waitForTimeout(400);
vorher = rufe.length;
await page.click('#eiBtn');
const breiten = [];
for (let i = 0; i < 9; i++) {
  await page.waitForTimeout(170);
  breiten.push(await page.evaluate(() => ({
    wert: Number($('updBalken').getAttribute('aria-valuenow')),
    etappe: $('updEtappe').textContent, schritt: $('updSchritt').textContent,
    knopfZu: $('eiBtn').disabled })));
}
await page.waitForTimeout(900);
const post = rufe.slice(vorher).filter(r => r.p.includes('planung_einrichten') && r.methode === 'POST');
check('KRITISCH: jede Etappe ist eine eigene Anfrage, in der richtigen Reihenfolge',
  JSON.stringify(post.map(r => r.body && r.body.etappe)) === JSON.stringify(Object.keys(ETAPPEN)));
check('KRITISCH: der Balken waechst nur in ganzen Etappen -- kein geschaetzter Zwischenwert',
  breiten.every(b => [0, 25, 50, 75, 100].includes(b.wert)));
check('Er waechst waehrend des Laufs tatsaechlich', new Set(breiten.map(b => b.wert)).size >= 3);
check('Unter dem Balken steht die laufende Etappe mit „x von 4“',
  breiten.some(b => b.etappe === 'Spalten und Daten nachtragen' && b.schritt === 'Etappe 2 von 4'));
check('Waehrend des Laufs ist der Knopf gesperrt', breiten.some(b => b.knopfZu));
await page.screenshot({ path: `${OUT}/updatefenster-fertig.png` });
check('Am Ende steht „Update eingespielt“', (await text(page, '#updTitel')).includes('Update eingespielt'));
check('Der Balken ist voll', await page.evaluate(() => $('updBalken').getAttribute('aria-valuenow') === '100'
  && $('updBalken').classList.contains('fertig')));
const nachher = await text(page, '#dlgEinrichtung .dlg-bd');
check('KRITISCH: was eingerichtet wurde, steht nicht mehr im Fenster', !nachher.includes('verfuegbarkeiten'));
check('KRITISCH: was schon da war, steht nicht mehr im Fenster', !nachher.includes('bereits vorhanden'));
check('Die Neuerungen bleiben stehen', nachher.includes('Eine Neuerung'));
check('Nach dem Einspielen gilt als gelesen, was angezeigt wurde',
  rufe.slice(vorher).some(r => r.p === 'neuerungen_stand.php' && r.methode === 'POST' && r.body.bis === 3));
await page.click('#eiBtn');   // Schliessen
await page.waitForTimeout(250);
check('„Schliessen“ schliesst', !(await offen(page)));

// ── Eine Etappe scheitert: der Grund steht da, der Balken wird rot
STAND.bremse = 0; STAND.fehlerBei = 'spalten'; STAND.ausstehend = 3;
await page.evaluate(() => eiOeffnen());
await page.waitForTimeout(400);
await page.click('#eiBtn');
await page.waitForTimeout(900);
const fehlText = await text(page, '#eiInhalt');
check('KRITISCH: ein fehlgeschlagener Schritt wird namentlich genannt', fehlText.includes('Zugriff verweigert'));
check('Der Balken ist rot, nicht gruen -- ein Teilerfolg ist kein Erfolg',
  await page.evaluate(() => $('updBalken').classList.contains('fehler')));
check('KRITISCH: die uebrigen Etappen laufen trotzdem',
  rufe.filter(r => r.p.includes('planung_einrichten') && r.methode === 'POST' && r.body && r.body.etappe === 'betreiber').length >= 2);
check('Man kann es erneut versuchen', (await text(page, '#eiBtn')).includes('Erneut versuchen')
  && !(await page.evaluate(() => $('eiBtn').disabled)));
await page.close();

// ══ 2. Desktop, Update steht aus, darf NICHT einspielen ═════════════════
standZurueck(); STAND.darf = false;
page = await seite({ width: 1400, height: 900 });
check('Auch wer nicht einspielen darf, sieht das Fenster', await offen(page));
check('Es sagt, dass die Verwaltung das Update einspielt',
  (await text(page, '#updUnter')).includes('Verwaltung'));
check('KRITISCH: ohne Recht kein Knopf zum Einspielen',
  (await text(page, '#eiBtn')).trim() === 'Verstanden'
  && await page.evaluate(() => $('updZu').style.display === 'none'));
vorher = rufe.length;
await page.click('#eiBtn');
await page.waitForTimeout(250);
check('KRITISCH: „Verstanden“ spielt nichts ein',
  !rufe.slice(vorher).some(r => r.p.includes('planung_einrichten') && r.methode === 'POST'));
check('„Verstanden“ markiert die Neuerungen als gelesen',
  rufe.slice(vorher).some(r => r.p === 'neuerungen_stand.php' && r.methode === 'POST' && r.body.bis === 3));
await page.close();

// ══ 3. Nichts offen, nichts Neues: das Fenster bleibt zu ═══════════════
standZurueck(); STAND.neuerungen = []; STAND.ausstehend = 0;
page = await seite({ width: 1400, height: 900 });
check('Ohne Update und ohne Neuerungen oeffnet sich nichts', !(await offen(page)));
await page.evaluate(() => eiOeffnen());
await page.waitForTimeout(400);
check('Von Hand geoeffnet sagt es „Alles auf dem neusten Stand“',
  (await text(page, '#updTitel')).includes('neusten Stand'));
check('und bietet an, erneut zu pruefen', (await text(page, '#eiBtn')).includes('Erneut prüfen'));
await page.close();

// ══ 4. Handy: Blatt von unten, nur Neuerungen ═════════════════════════
standZurueck();
page = await seite({ width: 390, height: 844 });
check('Am Handy erscheinen die Neuerungen ebenfalls von selbst', await offen(page));
check('KRITISCH: am Handy wird nicht eingespielt -- es verweist auf den Desktop',
  (await text(page, '#updUnter')).includes('Desktop') && (await text(page, '#eiBtn')).trim() === 'Verstanden');
await page.waitForTimeout(400);   // Einfahren abwarten
await page.screenshot({ path: `${OUT}/updatefenster-handy.png` });
const blatt = await page.evaluate(() => {
  const r = document.querySelector('#dlgEinrichtung .dlg').getBoundingClientRect();
  const k = $('eiBtn').getBoundingClientRect();
  const g = document.querySelector('#dlgEinrichtung .upd-griff').getBoundingClientRect();
  return { oben: r.top, unten: r.bottom, breite: r.width, knopf: k.height, knopfBreite: k.width, griff: g.width,
           radius: getComputedStyle(document.querySelector('#dlgEinrichtung .dlg')).borderTopLeftRadius };
});
check('KRITISCH: das Blatt sitzt unten am Bildschirm', Math.abs(blatt.unten - 844) < 2);
check('KRITISCH: es ist kein Vollbild', blatt.oben > 100);
check('Es geht ueber die ganze Breite', Math.abs(blatt.breite - 390) < 2);
check('Oben abgerundet', blatt.radius === '18px');
check('Mit Griff', blatt.griff > 30);
check('Der Knopf ist mindestens 44 px hoch', blatt.knopf >= 44);
check('Der Knopf ist nicht ueber die volle Breite gestreckt', blatt.knopfBreite < 300);
// Das Umgebungsschild (TESTUMGEBUNG / DEMO) liegt ueber allem -- es darf
// den Knopf nicht verdecken. In der Demo sehen Interessenten genau das.
const deckung = await page.evaluate(() => {
  const schild = [...document.querySelectorAll('body > div[role=status]')]
    .find(e => /TESTUMGEBUNG|DEMO/.test(e.textContent));
  if (!schild) { return null; }
  const a = schild.getBoundingClientRect(), b = $('eiBtn').getBoundingClientRect();
  return !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
});
check('Das Umgebungsschild ist in der Pruefung wirklich da', deckung !== null);
check('KRITISCH: das Umgebungsschild verdeckt den Knopf nicht', deckung === false);
await page.close();

// Handy ohne Neuerungen, nur offenes Update: kein Fenster (Sackgasse).
standZurueck(); STAND.neuerungen = [];
page = await seite({ width: 390, height: 844 });
check('Am Handy oeffnet ein offenes Update allein kein Fenster', !(await offen(page)));
await page.close();

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
