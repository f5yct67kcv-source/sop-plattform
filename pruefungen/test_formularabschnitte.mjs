// Formularabschnitte im Einsatzformular (2026-10-14).
//
// Gemessen am gerenderten Zustand, nicht im Quelltext nachgelesen:
//
// 1. FORMULARABSCHNITTE SCHREIBEN NORMAL. Eine zweite .abschnitt-Regel
//    gleicher Eigenspezifitaet setzte jeden Erklaertext in fette Versalien
//    und, ueber font:inherit, jeden Feldwert fett. Geprueft wird die
//    Wirkung, nicht die Regel -- eine neue Regel anderen Namens mit
//    derselben Folge faellt hier genauso auf.
// 2. EIN BREITES FELD OHNE BESCHRIFTUNG LAEUFT UEBER DIE VOLLE BREITE. Die
//    Zonenanzeige unter "Weg und Auslagenersatz" sass in der 168-px-
//    Beschriftungsspalte und brach nach drei Woertern um.
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const ok = [], bad = [];
const check = (n, c, x) => (c ? ok : bad).push(n + (c || x === undefined ? '' : ' -- ' + x));

const browser = await chromium.launch({ executablePath: browserPfad() });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
await page.route('**/api/**', r => {
  const p = r.request().url().split('/api/')[1].split('?')[0];
  const s = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) });
  if (p.includes('login')) return s({ status: 'ok', token: 't', name: 'adrian', ist_admin: true });
  if (p.includes('mitarbeiter_list')) return s({ status: 'ok', mitarbeiter: [{ id: 1, name: 'a', vorname: 'Anna', nachname: 'Muster', aktiv: 1 }] });
  return s({ status: 'ok', einsaetze: [], rapporte: [], objekte: [], feiertage: [], kunden: [],
    gepflegt: {}, sperren: [], adressen: [], wege: [], fahrzeuge: [], dokumente: [], positionen: [],
    kpi: {}, verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [], sperr_ereignisse: [] });
});
await page.goto(`file://${WURZEL}/dashboard.html`);
await page.fill('#gName', 'adrian'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#shell.on'); await page.waitForTimeout(400);
await page.evaluate(() => openEinsatzNeu()); await page.waitForTimeout(400);

const m = await page.evaluate(() => {
  const r = el => el.getBoundingClientRect();
  const gewicht = id => Number(getComputedStyle(document.getElementById(id)).fontWeight);
  const hinweis = getComputedStyle(document.getElementById('enNSerieHinweis'));
  const zone = document.getElementById('enNZone');
  return {
    felder: ['enNKunde_name', 'enNEinsatzart', 'enNStrasse', 'enNOrt', 'enNKontakt_vorname']
      .map(id => [id, gewicht(id)]),
    hinweisVersal: hinweis.textTransform,
    hinweisGewicht: Number(hinweis.fontWeight),
    zoneText: zone.textContent.trim().length > 0,
    zoneAnteil: r(zone).width / r(zone.closest('.f')).width,
  };
});
for (const [id, g] of m.felder) { check(`Feldwert nicht fett (#${id})`, g < 600, g); }
check('Erklaertext nicht in Versalien', m.hinweisVersal === 'none', m.hinweisVersal);
check('Erklaertext nicht fett', m.hinweisGewicht < 600, m.hinweisGewicht);
check('Zonenanzeige traegt Text (sonst misst die naechste Pruefung nichts)', m.zoneText);
check('Zonenanzeige ueber die volle Zeilenbreite', m.zoneAnteil > 0.95, m.zoneAnteil.toFixed(2));

await browser.close();
console.log(`Formularabschnitte: ${ok.length} ok, ${bad.length} Fehler`);
bad.forEach(b => console.log('  FEHLER: ' + b));
process.exit(bad.length ? 1 : 0);
