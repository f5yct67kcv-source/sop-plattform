// "Neue Masterschicht" als eigene Seite statt Dialog (16.10.2026) -- dasselbe
// Muster wie "Neues Objekt" (test_objektseite.mjs).
//
// Gemessen am gerenderten Zustand:
// 1. ES IST EINE SEITE, der Kopf nennt sie und das Objekt, "Zurueck" fuehrt
//    auf den Reiter "Masterschichten" des Objekts, von dem man kam -- auch
//    nach dem Speichern.
// 2. DIE SPALTEN STEHEN: 168-px-Beschriftung, Felder an einer Kante, 46 px
//    Zeilenabstand -- auch das Haekchen "Nur auf Abruf" (in der Feldspalte,
//    nicht in der Beschriftungsspalte) und die Intervallzeile.
// 3. DER BEDARF JE TAG steht in EINER Zeile, Mo bis Feiertag, mit dem
//    Paarabstand aller anderen Felder (44 px).
// 4. DIE ERKLAERUNG zum Rhythmus folgt dem gewaehlten Rhythmus: Hinter dem
//    (i) steht beim Intervall nicht der Satz zum Feiertagswert.
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const ok = [], bad = [];
const check = (n, c, x) => (c ? ok : bad).push(n + (c || x === undefined ? '' : ' -- ' + x));
const browser = await chromium.launch({ executablePath: browserPfad() });
const OBJ = { id: 3, name: 'Werkhof Nord', kunde_name: 'Beispiel AG', kunde_id: 1, strasse: 'Industriestrasse 5', plz: '4600', ort: 'Olten',
  kanton: 'SO', sparte: 'sicherheit', einsatzart: 'Revierdienst', aktiv: 1 };
const MS = { id: 10, objekt_id: 3, name: 'Schliessrunde', kuerzel: 'SR', art: 'arbeit', sparte: 'sicherheit', von: '22:00:00', bis: '23:30:00',
  pause_min: 0, arbeitszeit_h: 1.5, auf_abruf: 0, rhythmus: 'woche', bedarf_mo: 1, bedarf_di: 1, bedarf_mi: 1, bedarf_do: 1, bedarf_fr: 1,
  bedarf_sa: 0, bedarf_so: 0, bedarf_feiertag: 2, intervall_tage: 2, intervall_start: null, bedarf_intervall: 1, gueltig_ab: '2026-01-01', gueltig_bis: null };

const page = await browser.newPage({ viewport: { width: 1728, height: 1009 } });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
let gespeichert = 0;
await page.route('**/api/**', r => {
  const u = r.request().url();
  const s = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) });
  if (u.includes('login')) return s({ status: 'ok', token: 't', name: 'a', ist_admin: true, sparten: ['sicherheit', 'reinigung'] });
  if (u.includes('masterschicht_save')) { gespeichert++; return s({ status: 'ok', art: 'neu' }); }
  if (u.includes('masterschicht')) return s({ status: 'ok', masterschichten: [MS] });
  if (u.includes('objekt_list')) return s({ status: 'ok', objekte: [OBJ] });
  return s({ status: 'ok', einsaetze: [], rapporte: [], objekte: [OBJ], feiertage: [], kunden: [{ id: 1, name: 'Beispiel AG' }],
    mitarbeiter: [], gepflegt: {}, sperren: [], kpi: {}, masterschichten: [MS] });
});
await page.goto(`file://${WURZEL}/dashboard.html`);
await page.evaluate(() => localStorage.setItem('rv3_huelle', 'aus'));
await page.reload();
await page.fill('#gName', 'a'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#shell.on'); await page.waitForTimeout(300);
await page.evaluate(() => loadObjekte()); await page.waitForTimeout(300);
await page.evaluate(() => { openObjekt(3); obGoTab('masterschichten'); }); await page.waitForTimeout(400);

// ── 1. Seite, Kopf, Zurueck
await page.click('#ob-masterschichten button:has-text("Masterschicht hinzufügen")'); await page.waitForTimeout(300);
check('Neue Masterschicht öffnet eine Seite', await page.isVisible('#view-msform.on') && !(await page.isVisible('#view-objekt')));
check('Der Kopf sagt „Neue Masterschicht“', (await page.textContent('#pgTitle')).trim() === 'Neue Masterschicht');
check('Die Unterzeile nennt das Objekt', (await page.textContent('#pgCrumb')).trim() === 'Werkhof Nord');
check('Der Knopf heisst „Masterschicht anlegen“', (await page.textContent('#msBtn')).trim() === 'Masterschicht anlegen');
await page.click('#msZurueck'); await page.waitForTimeout(200);
check('„Zurück“ führt auf die Masterschichten des Objekts',
  await page.isVisible('#view-objekt.on') && await page.isVisible('#ob-masterschichten.on'));
check('… mit dem Kunden in der Unterzeile', (await page.textContent('#pgCrumb')).trim() === 'Beispiel AG');

await page.click('#msListe .ms-zeile:first-child button:has-text("Ändern ab")'); await page.waitForTimeout(300);
check('Ändern: Kopf „Ändern ab einem Stichtag“, Knopf „Speichern“',
  (await page.textContent('#pgTitle')).trim() === 'Ändern ab einem Stichtag' && (await page.textContent('#msBtn')).trim() === 'Speichern');

// ── 2./3. Zeilenfluss
const mass = () => page.evaluate(() => {
  const r = el => el.getBoundingClientRect();
  const id = x => document.getElementById(x);
  // Das Feld eines Paares: das Element nach der Beschriftung (bei Von/Bis
  // die Zeitwahl, die das versteckte Zeitfeld ersetzt).
  const feld = x => r(id(x).closest('.f').children[1]);
  const lab = x => r(id(x).closest('.f').querySelector(':scope > label'));
  const sichtbar = x => !!id(x).offsetParent;
  const erste = ['msName', 'msVon', 'msRhythmus', 'msGueltigAb'].concat(sichtbar('msIntervallTage') ? ['msIntervallTage'] : []);
  const haken = id('msAufAbruf').closest('label');
  const tage = ['mo', 'di', 'mi', 'do', 'fr', 'sa', 'so', 'feiertag'].map(t => id('msBedarf_' + t));
  return {
    links: erste.map(x => feld(x).left),
    erstLabel: erste.map(x => lab(x).width),
    hakenLinks: r(id('msAufAbruf')).left,
    hakenMitte: [r(id('msAufAbruf')).top + r(id('msAufAbruf')).height / 2, r(haken).top + r(haken).height / 2],
    zeilen: [feld('msName').top, feld('msVon').top, r(haken).top],
    bedarfZeilen: sichtbar('msBedarf_mo') ? [r(id('msRhythmus')).top, r(tage[0]).top] : null,
    tageOben: tage.map(e => e.offsetParent ? r(e).top : null),
    tagePaare: tage.slice(1).map((e, i) => e.offsetParent ? r(e.closest('.f')).left - r(tage[i]).right : null),
    tagErsteBeschriftung: sichtbar('msBedarf_mo') ? r(tage[0].closest('.f')).left : null,
    gruppenLabel: sichtbar('msBedarf_mo') ? r(tage[0].closest('.f.wide').querySelector(':scope > label')).width : null,
    notizen: ['msWocheNote', 'msIntervallNote'].map(x => sichtbar(x)),
  };
});
let m = await mass();
check('Felder setzen links auf dieselbe Kante', Math.max(...m.links) - Math.min(...m.links) < 0.5, m.links.join(','));
check('Erste Beschriftung jeder Zeile 168 px', m.erstLabel.every(b => Math.abs(b - 168) < 0.5), m.erstLabel.join(','));
check('Zeilenabstand 46 px', Math.abs(m.zeilen[1] - m.zeilen[0] - 46) < 0.5, m.zeilen.join(','));
check('„Nur auf Abruf“ steht in der Feldspalte', Math.abs(m.hakenLinks - m.links[0]) < 0.5, `${m.hakenLinks} / ${m.links[0]}`);
check('„Nur auf Abruf“ eine Zeile unter „Von“ (46 px)', Math.abs(m.zeilen[2] - m.zeilen[1] - 46) < 0.5, m.zeilen.join(','));
check('Kästchen und Text mittig auf Feldhöhe', Math.abs(m.hakenMitte[0] - m.hakenMitte[1]) < 1, m.hakenMitte.join(' / '));
check('Bedarf eine Zeile unter dem Rhythmus (46 px)', m.bedarfZeilen && Math.abs(m.bedarfZeilen[1] - m.bedarfZeilen[0] - 46) < 0.5,
  m.bedarfZeilen && m.bedarfZeilen.join(','));
check('Mo bis Feiertag in einer Zeile', m.tageOben.every(t => t !== null && Math.abs(t - m.tageOben[0]) < 0.5), m.tageOben.join(','));
check('Zwischen den Tagespaaren 44 px', m.tagePaare.every(g => g !== null && Math.abs(g - 44) < 0.5), m.tagePaare.join(','));
check('„Mo“ beginnt an der Feldspalte', Math.abs(m.tagErsteBeschriftung - m.links[0]) < 0.5, `${m.tagErsteBeschriftung} / ${m.links[0]}`);
check('Die Gruppenbeschriftung steht in der 168-px-Spalte', Math.abs(m.gruppenLabel - 168) < 0.5, m.gruppenLabel);
check('Kompakt: Erklärung zum Rhythmus hinter dem (i)', !m.notizen[0] && !m.notizen[1]);

// ── 4. Intervall
await page.selectOption('#msRhythmus', 'intervall'); await page.waitForTimeout(150);
m = await mass();
check('Intervall: Felder an derselben Kante', Math.max(...m.links) - Math.min(...m.links) < 0.5, m.links.join(','));
check('Intervall: erste Beschriftung 168 px', m.erstLabel.every(b => Math.abs(b - 168) < 0.5), m.erstLabel.join(','));
const iv = await page.evaluate(() => document.getElementById('msIntervallTage').getBoundingClientRect().top
  - document.getElementById('msRhythmus').getBoundingClientRect().top);
check('Intervallzeile 46 px unter dem Rhythmus', Math.abs(iv - 46) < 0.5, iv);
await page.click('#view-msform .abschnitt:has(#msRhythmus) .abs-info'); await page.waitForTimeout(100);
m = await mass();
check('(i) beim Intervall zeigt nur den Intervall-Satz', !m.notizen[0] && m.notizen[1], m.notizen.join(','));

// ── Speichern fuehrt zurueck
await page.click('#msBtn'); await page.waitForTimeout(500);
check('Speichern ruft den Server', gespeichert === 1, gespeichert);
check('Nach dem Speichern zurück auf den Masterschichten des Objekts',
  await page.isVisible('#view-objekt.on') && await page.isVisible('#ob-masterschichten.on'));

await browser.close();
console.log(`${ok.length} bestanden, ${bad.length} nicht bestanden`);
for (const b of bad) console.log('  FEHLT: ' + b);
if (bad.length) { process.exit(1); }
console.log('\nAlle Pruefungen bestanden.');
