// Diktat-Router auf Planung/Einsätze (ENT-107). Derselbe Router wie in der
// Begrüssung (ENT-032), diesmal mit Prefix "pe" statt "rt" -- geprüft wird
// hier vor allem, dass die Verallgemeinerung nichts vermischt: eine
// Bilddatei, die am einen Ort hängt, darf am anderen nicht auftauchen.
import { WURZEL, HIER, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const EXE = browserPfad();
const BILD = OUT + '/testbild.png';
{
  const { writeFileSync, existsSync } = await import('fs');
  if (!existsSync(BILD)) {
    writeFileSync(BILD, Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk'
      + 'YPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
  }
}
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const tag = n => iso(new Date(Date.now() + n * 864e5));
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const MA = [{ id: 1, name: 'hansmuster', vorname: 'Adrian', nachname: 'Muster', aktiv: 1, ist_admin: 1 }];
const KU = [{ id: 1, name: 'Beispiel AG', strasse: 'Bahnhofstrasse 1', ort: '4600 Olten', telefon: null, email: null }];
const EINSAETZE = [{ id: 21, kunde_id: 1, kunde_name: 'Beispiel AG', titel: 'Baustelle Kreisel', strasse: 'Weg 1',
  ort: '4600 Olten', einsatzart: 'Verkehrsdienst', datum: tag(0), von: '07:00:00', bis: '16:00:00',
  bedarf: 1, status: 'geplant', bemerkung: null, mitarbeiter: [], objekt_id: null }];

const rufe = [];
let routerAntwort = null, bildAntwort = null;

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
await page.route('**/api/**', route => {
  const req = route.request(), u = req.url(), p = u.split('/api/')[1].split('?')[0];
  let body = null;
  try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch (e) {}
  rufe.push({ p, body });
  const send = (b, s) => route.fulfill({ status: s || 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'hansmuster', ist_admin: true });
  if (p.includes('ki_router_parse')) return routerAntwort ? send(routerAntwort[0], routerAntwort[1])
    : send({ status: 'error', message: 'kein Mock' }, 502);
  if (p.includes('ki_einsatz_bild')) return bildAntwort ? send(bildAntwort[0], bildAntwort[1])
    : send({ status: 'error', message: 'kein Mock' }, 502);
  if (p.includes('mitarbeiter_list')) return send({ status: 'ok', mitarbeiter: MA });
  if (p.includes('kunden_list')) return send({ status: 'ok', kunden: KU });
  if (p.includes('einsatz_list')) return send({ status: 'ok', einsaetze: EINSAETZE });
  if (p.includes('objekt_list')) return send({ status: 'ok', objekte: [] });
  if (p.includes('masterschicht_list')) return send({ status: 'ok', masterschichten: [] });
  if (p.includes('feiertage_list')) return send({ status: 'ok', feiertage: [], gepflegt: {} });
  if (p.includes('naechstes')) return send({ status: 'ok', naechster_einsatz: null, offene_zusagen: 0, neue_sperrtage: 0 });
  if (p.includes('dashboard_stats')) return send({ status: 'ok', kpi: { rapporte_monat: 0, rapporte_vormonat: 0,
    stunden_monat: 0, stunden_vormonat: 0, mitarbeiter: 1, kunden: 1, rapporte_total: 0 },
    verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [], sperr_ereignisse: [] });
  return send({ status: 'ok', einsaetze: [], rapporte: [], objekte: [], feiertage: [], gepflegt: {}, sperren: [] });
});
await page.goto(`file://${WURZEL}/dashboard.html`);
await page.fill('#gName', 'hansmuster'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#shell.on'); await page.waitForTimeout(500);

await page.evaluate(() => { go('planung'); goTab('einsaetze'); });
await page.waitForTimeout(400);

// ══════════ POSITION: UNTERHALB DER FILTERLEISTE, OBERHALB DER TABELLE
check('Die Zeile ist auf Einsätze zu sehen', await page.isVisible('#peText'));
const reihenfolge = await page.evaluate(() => {
  const karten = [...document.querySelectorAll('#pv-einsaetze > .card')];
  return karten.map(k => k.querySelector('.diktat-router') ? 'router' : (k.querySelector('#plTable') ? 'tabelle' : '?'));
});
check('KRITISCH: der Router steht als Karte vor der Ergebnistabelle', JSON.stringify(reihenfolge) === JSON.stringify(['router', 'tabelle']));
const filterUnten = await page.evaluate(() => {
  const leiste = document.querySelector('#pv-einsaetze .bar-tools').getBoundingClientRect();
  const router = document.getElementById('peText').getBoundingClientRect();
  return router.top > leiste.bottom;
});
check('KRITISCH: gemessen -- die Zeile liegt unterhalb der Filterleiste', filterUnten);

// ══════════ DER GLOBALE SPRECHEN-KNOPF IST HIER AUSGEBLENDET (ENT-107)
check('Der globale Sprechen-Knopf ist auf Einsätze ausgeblendet', !(await page.isVisible('#btnSprechen')));

// ══════════ TEXT-ROUTER: FÜHRT ZUM SELBEN EINSATZ-DIALOG WIE AUF DER ÜBERSICHT
routerAntwort = [{ status: 'ok', bereich: 'einsatz',
  felder: { kunde_name: 'Beispiel AG', datum: tag(1), von: '07:00', bis: '16:00', bedarf: 1 },
  mitarbeiter_login_namen: ['hansmuster'] }, 200];
await page.fill('#peText', 'Neuer Einsatz für die Beispiel AG morgen 7 bis 16 Uhr');
await page.click('#peBtn');
await page.waitForTimeout(500);
check('Die Anlegen-Ansicht geht auf', await page.isVisible('#view-einsatzneu.on'));
check('Kunde ist vorbefüllt', (await page.inputValue('#enNKunde_name')) === 'Beispiel AG');
await page.evaluate(() => enNeuAbbrechen());
routerAntwort = null;
await page.fill('#peText', '');

// ══════════ LEERE EINGABE WIRD ABGEFANGEN
const parseRufeVorher = rufe.filter(r => r.p.includes('ki_router_parse')).length;
await page.click('#peBtn');
await page.waitForTimeout(200);
check('Leere Eingabe wird abgefangen', await page.isVisible('#peErr'));
check('Leere Eingabe geht nicht ans Modell', rufe.filter(r => r.p.includes('ki_router_parse')).length === parseRufeVorher);

// ══════════ BILD: AUSWAHL ÜBER DEN DATEIDIALOG
await page.setInputFiles('#peDatei', BILD);
await page.waitForTimeout(400);
check('Die Vorschau erscheint', await page.isVisible('#peBildVorschau'));
bildAntwort = [{ status: 'ok', felder: { kunde_name: 'Beispiel AG', titel: 'Baustelle Kreisel',
  datum: tag(2), von: '08:00', bis: '17:00', bedarf: 1 }, mitarbeiter_login_namen: [], unsicher: false }, 200];
await page.click('#peBtn');
await page.waitForTimeout(500);
const bildRuf = rufe.filter(r => r.p.includes('ki_einsatz_bild'));
check('Bild wird gesendet', bildRuf.length === 1);
check('Die Anlegen-Ansicht geht nach Bild-Erkennung auf', await page.isVisible('#view-einsatzneu.on'));
check('Titel aus dem Bild ist vorbefüllt', (await page.inputValue('#enNTitel')) === 'Baustelle Kreisel');
check('Die Bildvorschau ist danach wieder leer', !(await page.isVisible('#peBildVorschau')));
await page.evaluate(() => enNeuAbbrechen());
bildAntwort = null;

// ══════════ ZIEHEN UND FALLENLASSEN
await page.evaluate(async (b64) => {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const file = new File([arr], 'gezogen.png', { type: 'image/png' });
  const dt = new DataTransfer(); dt.items.add(file);
  const zone = document.getElementById('peDropzone');
  zone.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
  zone.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
}, (await (await import('fs')).promises.readFile(BILD)).toString('base64'));
await page.waitForTimeout(400);
check('Ein gezogenes Bild erzeugt ebenfalls eine Vorschau', await page.isVisible('#peBildVorschau'));

// ══════════ ZUSTAND JE PREFIX GETRENNT (der eigentliche Risikopunkt am Refactoring)
// Ein Bild haengt jetzt an "pe". Es darf weder in "rt" auftauchen, noch darf
// "rt" beim Entfernen von "rt" das Bild von "pe" mit wegraeumen.
await page.evaluate(() => go('uebersicht'));
await page.waitForTimeout(300);
check('KRITISCH: die Begrüssung zeigt kein Bild, das an Einsätze hängt', !(await page.isVisible('#rtBildVorschau')));
// Der eigentliche Beweis der Trennung ist nicht die Vorschau (die aktualisiert
// nur, wer sie gesetzt hat), sondern das Verhalten von "Erkennen": Bei einer
// gemeinsamen Variable wuerde ein Klick hier faelschlich das Bild von "pe"
// erkennen lassen, obwohl bei "rt" weder Text noch Bild anliegt.
const bildRufeVorRt = rufe.filter(r => r.p.includes('ki_einsatz_bild')).length;
await page.click('#rtBtn');
await page.waitForTimeout(300);
check('KRITISCH: "Erkennen" bei "rt" nutzt nicht das Bild von "pe"',
  rufe.filter(r => r.p.includes('ki_einsatz_bild')).length === bildRufeVorRt);
check('Stattdessen die normale Fehlermeldung für leere Eingabe bei "rt"', await page.isVisible('#rtErr'));
await page.evaluate(() => rtBildEntfernen('rt'));
await page.evaluate(() => { go('planung'); goTab('einsaetze'); });
await page.waitForTimeout(300);
check('KRITISCH: das Bild an Einsätze bleibt unberührt vom Entfernen bei "rt"', await page.isVisible('#peBildVorschau'));
await page.evaluate(() => rtBildEntfernen('pe'));
await page.waitForTimeout(150);
check('Entfernen bei "pe" blendet dessen eigene Vorschau aus', !(await page.isVisible('#peBildVorschau')));

// ══════════ DIE DREI KNOEPFE TRAGEN DIESELBE GESTALTUNG (ENT-100)
try {
  await page.setViewportSize({ width: 1728, height: 971 });
  await page.waitForTimeout(300);
  const m = await page.evaluate(() => {
    const g = s => { const e = document.querySelector(s), r = e.getBoundingClientRect(), c = getComputedStyle(e);
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), radius: c.borderRadius }; };
    return { sprechen: g('#peMik'), erkennen: g('#peBtn'), bild: g('#peSprach button[title="Bild auswählen"]') };
  });
  check('KRITISCH: alle drei Knöpfe sind 140 x 40 px', [m.sprechen, m.erkennen, m.bild].every(k => k.w === 140 && k.h === 40));
  check('KRITISCH: die Reihenfolge ist Sprechen, Erkennen, Bild', m.sprechen.x < m.erkennen.x && m.erkennen.x < m.bild.x);
  check('Sie stehen auf einer Höhe', m.sprechen.y === m.erkennen.y && m.erkennen.y === m.bild.y);
  await page.setViewportSize({ width: 1500, height: 1100 });
} catch (e) { bad.push('Knöpfe: ' + String(e).split('\n')[0].slice(0, 120)); }

await page.screenshot({ path: OUT + '/83-einsaetze-router.png' });

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
await browser.close();
