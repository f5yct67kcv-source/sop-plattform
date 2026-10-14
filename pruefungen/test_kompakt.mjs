// Kompakte Darstellung (Versuch 2026-10-14) und die Formularabschnitte.
//
// Gemessen am gerenderten Zustand, nicht im Quelltext nachgelesen:
//
// 1. FORMULARABSCHNITTE SCHREIBEN NORMAL. Eine zweite .abschnitt-Regel
//    gleicher Eigenspezifitaet setzte im Einsatzformular jeden Erklaertext
//    in fette Versalien und, ueber font:inherit, jeden Feldwert fett. Wer
//    es wieder einbaut, sieht es hier, nicht erst am Bildschirm.
// 2. EIN BREITES FELD OHNE BESCHRIFTUNG LAEUFT UEBER DIE VOLLE BREITE. Die
//    Zonenanzeige unter "Weg und Auslagenersatz" sass in der 168-px-
//    Beschriftungsspalte und brach nach drei Woertern um.
// 3. KOMPAKT IST WIRKLICH KOMPAKTER -- Feld und Formular messbar niedriger,
//    die Erklaertexte zu, bis das (i) sie oeffnet. Zustandsmeldungen (Zone)
//    bleiben dabei sichtbar: Das ist keine Erklaerung.
// 4. AM HANDY AENDERT KOMPAKT NICHTS. Dort gelten 44 px und 16 px; der
//    mobile Zuschnitt ist eine eigene Entscheidung.
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const ok = [], bad = [];
const check = (n, c, x) => (c ? ok : bad).push(n + (c || x === undefined ? '' : ' -- ' + x));

const browser = await chromium.launch({ executablePath: browserPfad() });

async function seite(breite, hoehe, dichte) {
  const page = await browser.newPage({ viewport: { width: breite, height: hoehe } });
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
  // Die Wahl liegt vor dem Laden im Speicher -- so, wie sie nach einem
  // Neuladen ankommt. Prueft damit auch den Kopf-Block, nicht nur den Schalter.
  await page.evaluate(d => localStorage.setItem('rv3_dichte', d), dichte);
  await page.reload();
  await page.fill('#gName', 'adrian'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
  await page.waitForSelector('#shell.on'); await page.waitForTimeout(400);
  await page.evaluate(() => openEinsatzNeu()); await page.waitForTimeout(400);
  return page;
}

const mass = page => page.evaluate(() => {
  const r = el => el.getBoundingClientRect();
  const kunde = document.querySelector('#enNKunde_name');
  const art = getComputedStyle(document.querySelector('#enNEinsatzart'));
  const hinweis = document.querySelector('#enNSerieHinweis');
  const zone = document.querySelector('#enNZone');
  const zeile = zone.closest('.f');
  return {
    karte: r(kunde.closest('.card')).height,
    feld: r(kunde).height,
    feldGewicht: Number(art.fontWeight),
    feldSchrift: parseFloat(art.fontSize),
    hinweisVersal: getComputedStyle(hinweis).textTransform,
    hinweisZu: getComputedStyle(hinweis).display === 'none',
    zoneZu: getComputedStyle(zone).display === 'none' || r(zone).height === 0,
    zoneAnteil: r(zone).width / r(zeile).width,
    info: !!document.querySelector('#enNSerieHinweis').parentElement.querySelector(':scope > h3 .abs-info'),
    attr: document.documentElement.getAttribute('data-dichte'),
    schalter: (document.querySelector('#btnDichte') || {}).getAttribute
      ? document.querySelector('#btnDichte').getAttribute('aria-checked') : null,
  };
});

// ── Desktop, normal
const pn = await seite(1440, 900, 'normal');
const n = await mass(pn);
check('normal: Feldwert nicht fett', n.feldGewicht < 600, n.feldGewicht);
check('normal: Erklaertext nicht in Versalien', n.hinweisVersal === 'none', n.hinweisVersal);
check('normal: Erklaertext sichtbar', !n.hinweisZu);
check('Zonenanzeige ueber die volle Zeilenbreite', n.zoneAnteil > 0.95, n.zoneAnteil.toFixed(2));
check('normal: Schalter steht auf aus', n.schalter === 'false', n.schalter);

// Umschalten ueber den Knopf
await pn.click('#btnDichte'); await pn.waitForTimeout(150);
const k1 = await mass(pn);
check('Schalter setzt kompakt', k1.attr === 'kompakt' && k1.schalter === 'true', k1.attr + '/' + k1.schalter);
check('Wahl wird gespeichert', (await pn.evaluate(() => localStorage.getItem('rv3_dichte'))) === 'kompakt');
await pn.close();

// ── Desktop, kompakt (aus dem Speicher geladen)
const pk = await seite(1440, 900, 'kompakt');
const k = await mass(pk);
check('kompakt: aus dem Speicher geladen', k.attr === 'kompakt' && k.schalter === 'true');
check('kompakt: Feld niedriger (<= 34 px)', k.feld <= 34, k.feld);
check('kompakt: Feldschrift lesbar (>= 13 px)', k.feldSchrift >= 13, k.feldSchrift);
check('kompakt: Formular mind. 20 % niedriger', k.karte <= n.karte * 0.8, `${Math.round(k.karte)} zu ${Math.round(n.karte)}`);
check('kompakt: Erklaertext zu', k.hinweisZu);
check('kompakt: (i) an der Ueberschrift', k.info);
check('kompakt: Zonenanzeige bleibt sichtbar', !k.zoneZu);
await pk.click('#enNSerieHinweis >> xpath=.. >> .abs-info'); await pk.waitForTimeout(100);
check('kompakt: (i) oeffnet den Erklaertext', !(await mass(pk)).hinweisZu);
await pk.click('#enNSerieHinweis >> xpath=.. >> .abs-info'); await pk.waitForTimeout(100);
check('kompakt: (i) schliesst ihn wieder', (await mass(pk)).hinweisZu);
await pk.close();

// ── Handy: kompakt im Speicher aendert nichts
const hn = await seite(390, 844, 'normal');
const h1 = await mass(hn); await hn.close();
const hk = await seite(390, 844, 'kompakt');
const h2 = await mass(hk);
check('Handy: Feldhoehe unveraendert', Math.abs(h1.feld - h2.feld) < 0.5, `${h1.feld} / ${h2.feld}`);
check('Handy: Feldschrift >= 16 px', h2.feldSchrift >= 16, h2.feldSchrift);
check('Handy: Erklaertext sichtbar', !h2.hinweisZu);
check('Handy: kein Schalter sichtbar', await hk.evaluate(() => {
  const b = document.querySelector('#btnDichte'); return !b || b.getBoundingClientRect().width === 0; }));
await hk.close();

await browser.close();
console.log(`Kompakte Darstellung: ${ok.length} ok, ${bad.length} Fehler`);
bad.forEach(b => console.log('  FEHLER: ' + b));
process.exit(bad.length ? 1 : 0);
