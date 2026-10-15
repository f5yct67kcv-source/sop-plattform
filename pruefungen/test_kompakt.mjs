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

async function seite(breite, hoehe, dichte, reinigung) {
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
  // Mit Reinigung im Angebot steht das Feld Sparte da -- so, wie es beim
  // Projektinhaber aussieht.
  if (reinigung) { await page.evaluate(() => document.documentElement.classList.add('hat-reinigung')); }
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

// ── Breiter Schirm, kompakt: Zeilenfluss nach der Skizze des
// Projektinhabers (2026-10-15). Feldbreiten exakt, erste Spalte buendig,
// jede Beschriftung mittig zu ihrem Feld, Zeilen 46 px auseinander.
const pb = await seite(1920, 1000, 'kompakt', true);
const fl = await pb.evaluate(() => {
  const r = id => document.getElementById(id).getBoundingClientRect();
  const SOLL = { enNKunde_name: 345, enNEinsatzart: 179, enNSparte: 171, enNVeranstaltung: 218,
    enNStatus: 168, enNDatum: 117, enNDatumBis: 117, enNStrasse: 374, enNOrt: 218, enNKanton: 104,
    enNBedarf: 52, enNKontakt_vorname: 204, enNKontakt_nachname: 197, enNKontakt_telefon: 171 };
  const breiten = Object.entries(SOLL).filter(([id, w]) => Math.abs(r(id).width - w) > 0.5)
    .map(([id, w]) => `${id} ${r(id).width} statt ${w}`);
  const zeit = [...document.querySelectorAll('.zeilenfluss .zeitwahl select')].map(e => e.getBoundingClientRect().width);
  const links = ['enNKunde_name', 'enNVeranstaltung', 'enNDatum', 'enNStrasse', 'enNBedarf', 'enNWeg_km', 'enNKontakt_vorname'].map(id => r(id).x);
  const mitte = [];
  document.querySelectorAll('.zeilenfluss > .f').forEach(f => {
    const l = f.querySelector(':scope > label'), i = f.querySelector('.inp:not([type=hidden])');
    if (!l || !i) return;
    // Der TEXT der Beschriftung, nicht ihr Kasten: Ein Polster verschiebt
    // den Text, ohne dass die Mitte des Kastens sich bewegt.
    const rg = document.createRange(); rg.selectNodeContents(l);
    const a = rg.getBoundingClientRect(), c = i.getBoundingClientRect();
    if (a.height && c.height) mitte.push(Math.abs((a.top + a.height / 2) - (c.top + c.height / 2)));
  });
  const zeile = (a, b) => Math.abs(r(a).top - r(b).top) < 1;
  return {
    breiten, zeit, links, mitte: Math.max(...mitte),
    takt: [r('enNVeranstaltung').top - r('enNKunde_name').top, r('enNStrasse').top - r('enNDatum').top,
           r('enNBedarf').top - r('enNStrasse').top],
    reihe1: zeile('enNKunde_name', 'enNEinsatzart') && zeile('enNKunde_name', 'enNSparte'),
    reihe2: zeile('enNVeranstaltung', 'enNStatus') && !zeile('enNKunde_name', 'enNVeranstaltung'),
    strasse: zeile('enNStrasse', 'enNOrt') && zeile('enNStrasse', 'enNKanton') && !zeile('enNStrasse', 'enNBedarf'),
    kontakt: zeile('enNKontakt_vorname', 'enNKontakt_nachname') && zeile('enNKontakt_vorname', 'enNKontakt_telefon'),
    zoneNeben: zeile('enNWeg_km', 'enNWeg_km') && document.getElementById('enNZone').getBoundingClientRect().left > r('enNWeg_minuten').right,
    weg: r('enNWeg_km').width,
  };
});
check('Zeilenfluss: Feldbreiten wie skizziert', !fl.breiten.length, fl.breiten.join('; '));
check('Zeilenfluss: vier Zeitfelder je 76 px', fl.zeit.length === 4 && fl.zeit.every(w => Math.abs(w - 76) < 0.5), fl.zeit.join('/'));
check('Zeilenfluss: erste Spalte buendig', Math.max(...fl.links) - Math.min(...fl.links) < 0.5, fl.links.join('/'));
check('Zeilenfluss: Beschriftung mittig zum Feld', fl.mitte < 1.5, fl.mitte);
check('Zeilenfluss: Zeilen 46 px auseinander', fl.takt.every(t => Math.abs(t - 46) < 0.5), fl.takt.join('/'));
check('Zeilenfluss: Kunde, Einsatzart, Sparte in einer Zeile', fl.reihe1);
check('Zeilenfluss: Veranstaltung und Status darunter', fl.reihe2);
check('Zeilenfluss: Strasse, PLZ/Ort, Kanton in einer Zeile, Bedarf darunter', fl.strasse);
check('Zeilenfluss: Kontaktperson in einer Zeile', fl.kontakt);
check('Zeilenfluss: Zonenhinweis neben der Wegzeile', fl.zoneNeben);
check('Zeilenfluss: Wegfelder 104 px (Einheit nicht verdeckt)', Math.abs(fl.weg - 104) < 0.5, fl.weg);
check('Zeilenfluss: Unterzeile Kontaktperson ausgeblendet', await pb.evaluate(() =>
  getComputedStyle(document.querySelector('#enNKontakt_vorname').closest('.abschnitt').querySelector('h3 .note')).display === 'none'));
await pb.close();

// ── Zu schmal fuer die laengste Zeile: kein Feld haengt allein am linken
// Rand, sondern das kompakte Raster gilt.
const ps = await seite(1440, 1000, 'kompakt', true);
const sm = await ps.evaluate(() => {
  const r = id => document.getElementById(id).getBoundingClientRect();
  return { kantonLinks: r('enNKanton').left, feldLinks: r('enNStrasse').left,
    raster: getComputedStyle(document.querySelector('.zeilenfluss')).display };
});
check('schmal: kompaktes Raster statt Zeilenfluss', sm.raster === 'grid', sm.raster);
check('schmal: Kanton nicht vor der Feldspalte', sm.kantonLinks >= sm.feldLinks - 0.5, `${sm.kantonLinks} < ${sm.feldLinks}`);
await ps.close();

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
