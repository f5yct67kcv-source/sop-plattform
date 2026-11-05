// "Neuer Kunde" als eigene Seite statt Dialog (Entscheid 16.10.2026,
// Variante 2 -- wie "Neuer Einsatz").
//
// Gemessen am gerenderten Zustand, nicht im Quelltext nachgelesen:
//
// 1. ES IST EINE SEITE. Kein Fenster ueber der Liste; der Kopf nennt, was
//    offen ist, und "Zurueck" fuehrt dorthin, woher man kam -- auch zurueck in
//    eine Offerte ("Neue Adresse").
// 2. DIE SPALTEN STEHEN. Jede Zeile beginnt mit derselben 168-px-Beschriftung,
//    alle Felder setzen links auf dieselbe Kante, 46 px Zeilenabstand, 32 px
//    Feldhoehe -- auch dort, wo zwei Raster untereinander stehen (Firma, UID).
// 3. WAS UNTEREINANDER GEHOERT, STEHT UNTEREINANDER: Nr., PLZ und Ort der
//    Rechnungsadresse unter denen der Adresse, die Notiz buendig mit "Ort".
// 4. NICHTS IST ABGESCHNITTEN: die Kundennummer ("wird beim Speichern
//    vergeben") passt ins Feld.
// 5. KONTAKTZEILEN folgen der Spalte statt ueber die ganze Seite zu laufen.
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const ok = [], bad = [];
const check = (n, c, x) => (c ? ok : bad).push(n + (c || x === undefined ? '' : ' -- ' + x));
const browser = await chromium.launch({ executablePath: browserPfad() });
const KUNDE = { id: 7, kundennummer: 'K-1007', name: 'Beispiel Immobilien AG', art: 'unternehmen', strasse: 'Musterweg', hausnummer: '12', plz: '4600', ort: 'Olten', aktiv: 1,
  kontaktwege: [{ art: 'telefon', wert: '+41 62 000 00 00' }, { art: 'email', wert: 'info@beispiel.ch' }],
  personen: [{ anrede: 'Frau', vorname: 'Anna', nachname: 'Muster', kontaktwege: [{ art: 'mobil', wert: '+41 79 000 00 00' }] }] };

async function seite(breite, huelle = 'aus') {
  const page = await browser.newPage({ viewport: { width: breite, height: 1009 } });
  page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
  await page.route('**/api/**', r => {
    const u = r.request().url();
    const s = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) });
    if (u.includes('login')) return s({ status: 'ok', token: 't', name: 'a', ist_admin: true });
    if (u.includes('kunden_list')) return s({ status: 'ok', kunden: [KUNDE], naechste_nummer: '' });
    return s({ status: 'ok', einsaetze: [], rapporte: [], objekte: [], feiertage: [], kunden: [KUNDE], mitarbeiter: [],
      gepflegt: {}, sperren: [], kpi: {}, offerten: [], produkte: [] });
  });
  await page.goto(`file://${WURZEL}/dashboard.html`);
  await page.evaluate(h => localStorage.setItem('rv3_huelle', h), huelle);
  await page.reload();
  await page.fill('#gName', 'a'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
  await page.waitForSelector('#shell.on'); await page.waitForTimeout(300);
  await page.evaluate(() => { go('kunden'); kuGoTab('uebersicht'); }); await page.waitForTimeout(300);
  return page;
}

const mass = page => page.evaluate(() => {
  const r = id => document.getElementById(id).getBoundingClientRect();
  const lab = id => document.querySelector(`label[for="${id}"]`).getBoundingClientRect();
  const felder = ['ku_kundennummer', 'ku_name', 'ku_uid', 'ku_strasse', 'ku_zusatzfeld', 'ku_re_name', 'ku_re_strasse', 'ku_notiz'];
  const kn = document.getElementById('ku_kundennummer'), cs = getComputedStyle(kn);
  const c = document.createElement('canvas').getContext('2d');
  c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const text = kn.value || kn.placeholder;
  const zeilen = ['ku_kundennummer', 'ku_name', 'ku_uid'].map(id => r(id).top);
  const wege = [...document.querySelectorAll('#kuWegeListe .kw-reihe')].map(z => ({
    art: z.querySelector('select').getBoundingClientRect(), wert: z.querySelector('input').getBoundingClientRect() }));
  return {
    links: felder.map(id => r(id).left),
    erstLabel: ['ku_kundennummer', 'ku_name', 'ku_uid', 'ku_strasse', 'ku_re_name'].map(id => lab(id).width),
    hoehen: ['ku_name', 'ku_strasse', 'ku_plz', 'ku_re_ort'].map(id => r(id).height),
    abstand: [zeilen[1] - zeilen[0], zeilen[2] - zeilen[1], r('ku_zusatzfeld').top - r('ku_strasse').top],
    nr: [r('ku_hausnummer').left, r('ku_re_hausnummer').left],
    plz: [r('ku_plz').left, r('ku_re_plz').left], ort: [r('ku_ort').left, r('ku_re_ort').left],
    zusatz: [r('ku_adresszusatz').left, r('ku_re_zusatz').left],
    ortRechts: r('ku_ort').right, notizRechts: r('ku_notiz').right,
    knPasst: c.measureText(text).width <= kn.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
    wege, feldLinks: r('ku_strasse').left, labelLinks: lab('ku_strasse').left,
    wahl: getComputedStyle(document.querySelector('#kuArtUnternehmen').closest('label')).textTransform,
  };
});

// ── Seite, Titel, Zurueck
{
  const page = await seite(1728);
  await page.click('#view-kunden button:has-text("Neuer Kunde")'); await page.waitForTimeout(300);
  check('Neuer Kunde öffnet eine Seite', await page.isVisible('#view-kundeform.on'));
  check('… und die Kundenliste ist nicht mehr zu sehen', !(await page.isVisible('#view-kunden')));
  check('Der Kopf sagt „Neuer Kunde“', (await page.textContent('#pgTitle')).trim() === 'Neuer Kunde');
  check('„Zurück“ nennt die Kunden', (await page.textContent('#kuZurueck')).trim() === 'Zurück zu den Kunden');
  const m = await mass(page);
  check('Alle Felder setzen links auf dieselbe Kante', Math.max(...m.links) - Math.min(...m.links) < 0.5, m.links.join(','));
  check('Erste Beschriftung jeder Zeile 168 px', m.erstLabel.every(b => Math.abs(b - 168) < 0.5), m.erstLabel.join(','));
  check('Felder 32 px hoch', m.hoehen.every(h => Math.abs(h - 32) < 0.5), m.hoehen.join(','));
  check('Zeilenabstand 46 px, auch zwischen zwei Rastern (Firma, UID)', m.abstand.every(a => Math.abs(a - 46) < 0.5), m.abstand.join(','));
  check('Nr. der Rechnungsadresse unter der Nr. der Adresse', Math.abs(m.nr[0] - m.nr[1]) < 0.5, m.nr.join(','));
  check('PLZ der Rechnungsadresse unter der PLZ der Adresse', Math.abs(m.plz[0] - m.plz[1]) < 0.5, m.plz.join(','));
  check('Ort der Rechnungsadresse unter dem Ort der Adresse', Math.abs(m.ort[0] - m.ort[1]) < 0.5, m.ort.join(','));
  check('Zusatz unter Adresszusatz', Math.abs(m.zusatz[0] - m.zusatz[1]) < 0.5, m.zusatz.join(','));
  check('Notiz bündig mit dem rechten Rand von „Ort“', Math.abs(m.ortRechts - m.notizRechts) < 0.5, `${m.ortRechts} / ${m.notizRechts}`);
  check('„wird beim Speichern vergeben“ passt ins Feld', m.knPasst);
  check('Kontaktzeile: die Art steht in der Beschriftungsspalte', m.wege.every(w => Math.abs(w.art.left - m.labelLinks) < 0.5 && Math.abs(w.art.width - 168) < 0.5));
  check('Kontaktzeile: der Wert beginnt an der Feldkante und ist 345 px breit',
    m.wege.every(w => Math.abs(w.wert.left - m.feldLinks) < 0.5 && Math.abs(w.wert.width - 345) < 0.5), JSON.stringify(m.wege.map(w => [w.wert.left, w.wert.width])));
  check('Die Wahl „Unternehmen/Privatperson“ steht nicht in Versalien', m.wahl === 'none', m.wahl);
  await page.click('#kuZurueck'); await page.waitForTimeout(200);
  check('„Zurück“ führt in die Kundenliste', await page.isVisible('#view-kunden.on') && !(await page.isVisible('#view-kundeform.on')));
  // Bearbeiten
  await page.evaluate(() => openKundeBearbeiten(7)); await page.waitForTimeout(300);
  check('Bearbeiten: Kopf „Kunde bearbeiten“, Felder gefüllt',
    (await page.textContent('#pgTitle')).trim() === 'Kunde bearbeiten' && (await page.inputValue('#ku_name')) === 'Beispiel Immobilien AG');
  check('Bearbeiten: Knopf heisst „Speichern“', (await page.textContent('#kuBtn')).trim() === 'Speichern');
  await page.close();
}

// ── Aus einer Offerte: Zurueck fuehrt in die Offerte
{
  const page = await seite(1728);
  await page.evaluate(() => { go('offerte'); }); await page.waitForTimeout(200);
  await page.evaluate(() => ofNeueAdresse()); await page.waitForTimeout(300);
  check('Aus der Offerte: „Zurück zur Offerte“', (await page.textContent('#kuZurueck')).trim() === 'Zurück zur Offerte');
  await page.click('#kuZurueck'); await page.waitForTimeout(200);
  check('… und Zurück führt wieder in die Offerte', await page.isVisible('#view-offerte.on'));
  check('… ohne einen Rückruf zu hinterlassen (ENT-187)', await page.evaluate(() => kuNeuRueckkehr === null));
  await page.close();
}

await browser.close();
console.log(`${ok.length} bestanden, ${bad.length} nicht bestanden`);
for (const b of bad) console.log('  FEHLT: ' + b);
if (bad.length) { process.exit(1); }
console.log('\nAlle Pruefungen bestanden.');
