// Verfuegbarkeit (ENT-028): Mitarbeitende sperren eigene Tage, die Planung
// warnt sichtbar, blockiert aber nicht. Dazu: Albanisch ist ueberall weg und
// die Erfassung traegt das Design der App.
import { WURZEL, HIER, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const EXE = browserPfad();
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const tag = n => iso(new Date(Date.now() + n * 864e5));
const HEUTE = tag(0), M = HEUTE.slice(0, 7);
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

// ══════════════════════════════════════════ TEIL 1: DIE APP
let SPERREN = [{ datum: tag(3), art: 'gesperrt', bemerkung: 'Arzttermin' }];
const rufe = [];
let browser = await chromium.launch({ executablePath: EXE });
let page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', e => bad.push('JS-Fehler App: ' + e.message));
await page.route('**/api/**', route => {
  const req = route.request(), u = req.url(), p = u.split('/api/')[1].split('?')[0];
  let body = null;
  try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch (e) {}
  rufe.push({ p, body });
  const send = (b, s) => route.fulfill({ status: s || 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'daniele.ciardo', ist_admin: false });
  if (p.includes('meine_verfuegbarkeit')) {
    if (req.method() === 'POST') {
      SPERREN = SPERREN.filter(x => x.datum !== body.datum);
      if (body.gesperrt) SPERREN.push({ datum: body.datum, art: 'gesperrt', bemerkung: body.bemerkung || null });
      return send({ status: 'ok', datum: body.datum, gesperrt: !!body.gesperrt, bemerkung: body.bemerkung || null });
    }
    return send({ status: 'ok', tage: SPERREN });
  }
  if (p.includes('meine_schichten')) return send({ status: 'ok', schichten: [
    { id: 41, kunde_name: 'Borner AG', titel: 'Schliessrunde', strasse: null, ort: '4601 Olten',
      einsatzart: 'Revierdienst', datum: tag(5), von: '22:00:00', bis: '22:30:00', status: 'geplant',
      bemerkung: null, zusage: 'offen', objekt_name: 'Gerolag Center', im_team: 1,
      // ENT-234: ohne Kontrollpunkte kein Wächter-Reiter -- diese Suite prüft
      // ausdrücklich den Fall ohne Revierdienst-Bezug.
      hat_kontrollpunkte: false }] });
  if (p.includes('mein_profil')) return send({ status: 'ok', monat: { anzahl: 0, stunden: 0 },
    profil: { name: 'daniele.ciardo', ist_admin: false, vorname: 'Daniele', nachname: 'Ciardo' } });
  return send({ status: 'ok', rapporte: [] });
});

await page.goto(`file://${WURZEL}/app.html`);
await page.fill('#gName', 'daniele.ciardo'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#app.on'); await page.waitForTimeout(500);

// ── Albanisch ist weg
check('Kein Sprachumschalter mehr auf der Anmeldung',
  await page.evaluate(() => !document.getElementById('spSq')));
check('Vier sichtbare Reiter unten (kein Revierdienst-Bezug, ENT-234)',
  await page.evaluate(() => [...document.querySelectorAll('.tabs button')]
    .filter(b => getComputedStyle(b).display !== 'none').length === 4));
check('Der Wächter-Reiter bleibt ohne Kontrollpunkte verborgen', !(await page.isVisible('#t-waechter')));
await page.click('#t-menu'); await page.waitForTimeout(250);
const menu = await page.textContent('#v-menu');
check('Kein Sprachbereich mehr im Menü', !menu.includes('Shqip') && !menu.includes('Sprache'));
check('Kein albanischer Text mehr in der App',
  await page.evaluate(() => !/Shqip|Punonjës|Raport[ei]|Klienti|Turni/.test(document.body.innerHTML)));

// ── Sperrtage: seit ENT-234 Unterreiter von "Plan", kein eigener Hauptreiter mehr
await page.click('#t-plan'); await page.waitForTimeout(300);
check('Der Sperren-Unterreiter ist da', await page.isVisible('#pu-sperren'));
await page.click('#pu-sperren'); await page.waitForTimeout(400);
check('Der Sperren-Bereich erklärt sich', (await page.textContent('#plan-inhalt-sperren')).includes('Tage sperren'));
check('Es wird gesagt, dass es keine Zusage ist',
  (await page.textContent('#plan-inhalt-sperren')).includes('Zusage ist es nicht'));
check('Sperrtage werden geladen', rufe.some(r => r.p.includes('meine_verfuegbarkeit')));
const zeilen = await page.evaluate(() => document.querySelectorAll('.sperr-zeile').length);
check(`Neun Wochen im Voraus (${zeilen} Tage)`, zeilen === 63);
check('Der bestehende Sperrtag ist markiert',
  await page.evaluate(() => document.querySelectorAll('.sperr-karte.aus').length === 1));
check('Die Bemerkung wird gezeigt', (await page.textContent('#plan-inhalt-sperren')).includes('Arzttermin'));
check('Die Zahl der Sperrtage steht oben', (await page.textContent('#plan-inhalt-sperren')).includes('1 Tag gesperrt'));
check('Wochen sind überschrieben', (await page.textContent('#plan-inhalt-sperren')).includes('Woche'));
check('Ein Tag mit Einteilung wird als solcher benannt',
  (await page.textContent('#plan-inhalt-sperren')).includes('bereits eingeteilt'));
await page.screenshot({ path: OUT + '/62-sperren.png' });

// ── Einen Tag sperren
const vorher = rufe.filter(r => r.p.includes('meine_verfuegbarkeit') && r.body).length;
await page.evaluate(() => document.querySelectorAll('.sperr-zeile')[1].click());
await page.waitForTimeout(500);
const gesendet = rufe.filter(r => r.p.includes('meine_verfuegbarkeit') && r.body);
check('Das Sperren wird gesendet', gesendet.length === vorher + 1);
check('Es wird der richtige Tag gesendet', gesendet.at(-1).body.datum === tag(1));
check('Es wird als gesperrt gesendet', gesendet.at(-1).body.gesperrt === true);
check('Jetzt sind zwei Tage gesperrt',
  await page.evaluate(() => document.querySelectorAll('.sperr-karte.aus').length === 2));
check('Der Schalter steht auf an',
  await page.evaluate(() => document.querySelectorAll('.sperr-karte.aus .schalter.an').length === 2));

// ── Wieder freigeben
await page.evaluate(() => document.querySelectorAll('.sperr-zeile')[1].click());
await page.waitForTimeout(500);
check('Das Freigeben wird gesendet',
  rufe.filter(r => r.p.includes('meine_verfuegbarkeit') && r.body).at(-1).body.gesperrt === false);
check('Wieder nur ein Sperrtag',
  await page.evaluate(() => document.querySelectorAll('.sperr-karte.aus').length === 1));

// ── Notiz
await page.click('.sperr-notiz');
await page.waitForTimeout(400);
check('Das Notizblatt geht auf',
  await page.evaluate(() => document.getElementById('blatt').classList.contains('on')));
check('Die bestehende Notiz steht drin', (await page.inputValue('#spNotiz')) === 'Arzttermin');
check('Es wird gesagt, dass es freiwillig ist',
  (await page.textContent('#blBody')).includes('freiwillig'));
await page.fill('#spNotiz', 'erst ab 18 Uhr');
await page.click('#blFuss .btn-primary');
await page.waitForTimeout(500);
check('Die Notiz wird gesendet',
  rufe.filter(r => r.p.includes('meine_verfuegbarkeit') && r.body).at(-1).body.bemerkung === 'erst ab 18 Uhr');
check('Das Blatt schliesst',
  await page.evaluate(() => !document.getElementById('blatt').classList.contains('on')));
check('Die neue Notiz steht in der Liste', (await page.textContent('#plan-inhalt-sperren')).includes('erst ab 18 Uhr'));

// ── Mobil
for (const breite of [320, 360, 390]) {
  await page.setViewportSize({ width: breite, height: 844 });
  await page.waitForTimeout(200);
  const m = await page.evaluate(() => {
    const d = document.documentElement, ueber = [];
    document.querySelectorAll('#v-plan *, .tabs *').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width && r.height && r.right > window.innerWidth + 1) ueber.push(el.className);
    });
    return { scroll: d.scrollWidth - d.clientWidth, ueber: ueber.slice(0, 3),
      klein: [...document.querySelectorAll('.sperr-zeile')].filter(b => b.getBoundingClientRect().height < 44).length };
  });
  check(`Kein Seiten-Scroll im Sperren-Bereich @${breite}`, m.scroll <= 1);
  check(`Nichts ragt heraus @${breite}`, m.ueber.length === 0);
  check(`Zeilen mit dem Daumen bedienbar @${breite}`, m.klein === 0);
}
await browser.close();

// ══════════════════════════════════════════ TEIL 2: DIE ERFASSUNG
browser = await chromium.launch({ executablePath: EXE });
page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', e => bad.push('JS-Fehler Erfassung: ' + e.message));
await page.route('**/api/**', route => {
  const u = route.request().url();
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (u.includes('login')) return send({ status: 'ok', token: 't', name: 'daniele.ciardo', ist_admin: false });
  return send({ status: 'ok', rapporte: [], mitarbeiter: [], kunden: [], objekte: [] });
});
await page.goto(`file://${WURZEL}/index.html`);
await page.waitForTimeout(600);

check('Kein Sprachumschalter mehr in der Erfassung',
  await page.evaluate(() => document.querySelectorAll('.lang-btn').length === 0));
check('Kein albanischer Text mehr in der Erfassung',
  await page.evaluate(() => !/Shqip|Punonjës|Raporti|Fjalëkalimi|Ruaj/.test(document.body.innerHTML)));
check('Der Zurück-Knopf ist da', await page.isVisible('#btn-zurueck'));
check('Er führt in die App', (await page.getAttribute('#btn-zurueck', 'href')) === 'app.html');
check('Das Logo ist geblieben',
  await page.evaluate(() => !!document.querySelector('header img')));
check('Der Titel ist geblieben', (await page.textContent('#h-title')) === 'Stundenrapport');
check('Abmelden ist geblieben', await page.isVisible('#btn-header-logout'));
const kopfKinder = await page.evaluate(() => document.querySelector('header').children.length);
check(`Die Kopfzeile hat nur noch drei Bereiche (${kopfKinder})`, kopfKinder === 3);

// Farben wie in der App
const farben = await page.evaluate(() => {
  const w = getComputedStyle(document.documentElement);
  return {
    kopf: getComputedStyle(document.querySelector('header')).backgroundColor,
    akzent: w.getPropertyValue('--accent').trim(),
    grund: w.getPropertyValue('--bg').trim(),
  };
});
check('Die Kopfzeile ist graphitfarben wie in der App', farben.kopf === 'rgb(22, 24, 29)');
check('Der Akzent stimmt mit der App überein', farben.akzent.toUpperCase() === '#2F5BD7');
check('Der Hintergrund stimmt mit der App überein', farben.grund.toUpperCase() === '#F4F6F8');

// Das Formular selbst funktioniert weiterhin
check('Das Erfassungsformular ist da', await page.isVisible('#tab-erfassen'));
check('Die Beschriftungen stehen auf Deutsch', (await page.textContent('#lbl-sec-zeiten')) === 'Arbeitszeit');
check('Die Pausenauswahl ist gefüllt',
  await page.evaluate(() => document.getElementById('pause').options.length === 7));
check('Die Pausenauswahl ist deutsch',
  await page.evaluate(() => document.getElementById('pause').options[1].text.includes('Minuten')));
const mob = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check('Kein Seiten-Scroll in der Erfassung @390', mob <= 1);
await page.screenshot({ path: OUT + '/63-erfassung-neu.png' });
await browser.close();

// ══════════════════════════════════════════ TEIL 3: DIE PLANUNG SIEHT ES
const M2 = HEUTE.slice(0, 7);
const LETZTER = new Date(Number(M2.slice(0, 4)), Number(M2.slice(5, 7)), 0).getDate();
const T2 = n => `${M2}-${String(n).padStart(2, '0')}`;
const OBJ = { id: 1, kunde_id: 1, kunde_name: 'Borner AG', name: 'Gerolag Center',
  strasse: 'Industriestrasse 78', ort: '4601 Olten', kanton: 'SO', einsatzart: 'Revierdienst', aktiv: 1 };
const VOR = [{ id: 3, name: 'Schliessrunde', kuerzel: 'SR', art: 'arbeit', von: '22:00', bis: '22:30',
  arbeitszeit_h: 0.5, auf_abruf: 0, farbe: null, gueltig_ab: '2026-01-01', gueltig_bis: null }];
const rufe2 = [];
browser = await chromium.launch({ executablePath: EXE });
page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on('pageerror', e => bad.push('JS-Fehler Planung: ' + e.message));
await page.route('**/api/**', route => {
  const req = route.request(), u = req.url(), p = u.split('/api/')[1].split('?')[0];
  let body = null;
  try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch (e) {}
  rufe2.push({ p, body });
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'a', ist_admin: true });
  if (p.includes('verfuegbarkeit_list')) return send({ status: 'ok', sperren: [
    { mitarbeiter_id: 2, datum: T2(4), art: 'gesperrt', bemerkung: 'Arzttermin' },
    { mitarbeiter_id: 3, datum: T2(4), art: 'gesperrt', bemerkung: null }] });
  if (p.includes('objektplan')) return send({ status: 'ok', objekt: OBJ, vorlagen: VOR,
    bedarf: [{ datum: T2(4), masterschicht_id: 3, name: 'Schliessrunde', kuerzel: 'SR', von: '22:00',
      bis: '22:30', bedarf: 2, status: 'geplant', feiertag: null, art: 'arbeit', arbeitszeit_h: 0.5 }],
    einsaetze: [], feiertage: {} });
  if (p.includes('zuteilung_masse')) return send({ status: 'ok', nur_pruefen: !!body.nur_pruefen,
    tage: 4, gesetzt: 4, schon_da: 0, neue_schichten: 4, konflikte: [], konflikte_gesamt: 0,
    gesperrt: [{ datum: T2(4), name: 'Daniele Ciardo', bemerkung: 'Arzttermin' }], gesperrt_gesamt: 1,
    schicht: 'SR · Schliessrunde', personen: ['Daniele Ciardo'], von: body.von, bis: body.bis });
  if (p.includes('objekt_list')) return send({ status: 'ok', objekte: [OBJ] });
  if (p.includes('mitarbeiter_list')) return send({ status: 'ok', mitarbeiter: [
    { id: 1, name: 'adrian', vorname: 'Adrian', nachname: 'von Arb', aktiv: 1, ist_admin: 1 },
    { id: 2, name: 'daniele.ciardo', vorname: 'Daniele', nachname: 'Ciardo', aktiv: 1, ist_admin: 0 },
    { id: 3, name: 'valbon', vorname: 'Valbon', nachname: 'Redjepi', aktiv: 1, ist_admin: 0 }] });
  return send({ status: 'ok', einsaetze: [], kunden: [], rapporte: [], feiertage: [], gepflegt: {},
    kpi: {}, verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [] });
});
await page.goto(`file://${WURZEL}/dashboard.html`);
await page.fill('#gName', 'a'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#shell.on'); await page.waitForTimeout(350);
await page.evaluate(() => go('planung')); await page.waitForTimeout(400);
await page.evaluate(() => goTab('objektplan')); await page.waitForTimeout(700);
check('Die Sperren werden in der Planung geladen', rufe2.some(r => r.p.includes('verfuegbarkeit_list')));

await page.evaluate(d => oplZelleAuf(3, d), T2(4));
await page.waitForTimeout(400);
const pick = await page.textContent('#zuMa');
check('Die Sperre steht bei der Person', pick.includes('Hat sich diesen Tag gesperrt'));
check('Die Bemerkung wird mitgezeigt', pick.includes('Arzttermin'));
check('Beide gesperrten Personen werden benannt',
  await page.evaluate(() => document.querySelectorAll('#zuMa .sperrtag').length === 2));
check('Gesperrte Personen bleiben trotzdem wählbar',
  await page.evaluate(() => !document.querySelector('#zuMa input[value="2"]').disabled));
check('Wer sich nicht gesperrt hat, ist unauffällig',
  await page.evaluate(() => !document.querySelector('#zuMa label:has(input[value="1"]) .sperrtag')));
await page.check('#zuMa input[value="2"]');
await page.waitForTimeout(200);
check('Die Fussnote zählt die Sperre mit',
  (await page.textContent('#zuFuss')).includes('gegen eine Sperre'));
await page.screenshot({ path: OUT + '/64-planung-sperre.png' });
await page.evaluate(() => closeDlg('dlgZuteilen'));

// Ein Tag ohne Sperre bleibt ruhig
await page.evaluate(d => oplZelleAuf(3, d), T2(5));
await page.waitForTimeout(350);
check('Ein Tag ohne Sperre zeigt keine Warnung',
  await page.evaluate(() => document.querySelectorAll('#zuMa .sperrtag').length === 0));
await page.evaluate(() => closeDlg('dlgZuteilen'));

// Massen-Zuteilung weist Sperren aus
await page.evaluate(() => mzAuf());
await page.waitForTimeout(400);
await page.check('#mzMa input[value="2"]');
await page.waitForTimeout(800);
const vorschau = await page.textContent('#mzVorschau');
check('Die Massen-Vorschau nennt die Sperren', vorschau.includes('gegen eine Sperre'));
check('Die Massen-Vorschau erklärt, dass trotzdem eingeteilt wird',
  vorschau.includes('kein Verbot'));
check('Die Massen-Vorschau listet den Tag einzeln', vorschau.includes('hat sich gesperrt'));
check('Einteilen bleibt möglich', await page.evaluate(() => !$('mzBtn').disabled));
await page.screenshot({ path: OUT + '/65-masse-sperre.png' });
await browser.close();

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
