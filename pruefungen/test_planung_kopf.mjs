// Kopf der Monatsuebersicht in der Planung (Skizze 15.10.2026).
//
// Gemessen am gerenderten Zustand, nicht im Quelltext nachgelesen:
//
// 1. KEINE VERSCHENKTE LUFT. Die Reiterleiste, die am Desktop nur noch
//    "Feiertage" trug, ist weg; die Felder stehen 32 px unter der Kopfzeile,
//    die Tabelle 47 px unter den Feldern -- mit Seitenleiste und ohne.
// 2. ALLE FELDER 40 PX HOCH UND AUF EINER LINIE.
// 3. DER MONAT PASST INS FELD. Vorher stand "Oktobe" da.
// 4. FEIERTAGE BLEIBT ERREICHBAR -- als Icon vor der Suche, in allen vier
//    Reitern, und oeffnet den Dialog.
// 5. FILTERN LAESST DIE TABELLE NICHT SPRINGEN. Der Hinweis steht nur da,
//    wenn er mehr sagt als die Felder, und braucht dann keinen Platz extra.
// 6. AM HANDY BLEIBT ALLES WIE ES WAR (eigene Entscheidung).
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const ok = [], bad = [];
const check = (n, c, x) => (c ? ok : bad).push(n + (c || x === undefined ? '' : ' -- ' + x));
const browser = await chromium.launch({ executablePath: browserPfad() });

async function seite(breite, hoehe, huelle) {
  const page = await browser.newPage({ viewport: { width: breite, height: hoehe } });
  page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
  await page.route('**/api/**', r => {
    const p = r.request().url().split('/api/')[1].split('?')[0];
    const s = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) });
    if (p.includes('login')) return s({ status: 'ok', token: 't', name: 'a', ist_admin: true, sparten: ['sicherheit', 'reinigung'] });
    return s({ status: 'ok', einsaetze: [], rapporte: [], objekte: [], feiertage: [], kunden: [], mitarbeiter: [],
      gepflegt: {}, sperren: [], kpi: {}, verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [] });
  });
  await page.goto(`file://${WURZEL}/dashboard.html`);
  await page.evaluate(h => localStorage.setItem('rv3_huelle', h), huelle);
  await page.reload();
  await page.fill('#gName', 'a'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
  await page.waitForSelector('#shell.on'); await page.waitForTimeout(300);
  await page.evaluate(() => { go('planung'); goTab('uebersicht'); }); await page.waitForTimeout(400);
  return page;
}

const mass = page => page.evaluate(() => {
  const r = e => e.getBoundingClientRect();
  const kopf = [...document.querySelectorAll('.topbar')].find(e => e.offsetParent);
  const felder = [...document.querySelectorAll('#pv-uebersicht .bar-tools .inp')].filter(e => e.offsetParent);
  const filter = felder.filter(e => e.closest('.bar-filter'));
  const ft = document.querySelector('#pv-uebersicht [aria-label="Feiertage verwalten"]');
  const mon = document.getElementById('mxMon');
  const cs = getComputedStyle(mon);
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const laengster = Math.max(...[...mon.options].map(o => ctx.measureText(o.textContent).width));
  return {
    kopfUnten: r(kopf).bottom,
    oben: felder.map(e => r(e).top), hoehen: felder.map(e => r(e).height),
    filterOben: filter.map(e => r(e).top),
    feldUnten: Math.max(...felder.map(e => r(e).bottom)),
    karte: r(document.querySelector('#pv-uebersicht > .card')).top,
    // Platz fuer den Text: Breite minus Innenabstaende (rechts sitzt der Pfeil) und Rand
    monPlatz: r(mon).width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
      - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth), laengster,
    ft: ft && ft.offsetParent ? r(ft) : null,
    suche: r(document.querySelector('#pv-uebersicht .search-rechts')),
    tabs: document.querySelector('#view-planung > .tabs').offsetParent !== null,
  };
});

for (const [huelle, name] of [['aus', 'ohne Seitenleiste'], ['voll', 'mit Seitenleiste']]) {
  const page = await seite(1728, 1009, huelle);
  const m = await mass(page);
  check(`${name}: die leere Reiterleiste ist weg`, !m.tabs);
  check(`${name}: alle Felder 40 px hoch`, m.hoehen.every(h => Math.abs(h - 40) < 0.5), m.hoehen.join(','));
  check(`${name}: alle Filter auf einer Linie`, Math.max(...m.filterOben) - Math.min(...m.filterOben) < 0.5, m.filterOben.join(','));
  // Ohne Seitenleiste (so arbeitet der Projektinhaber) passt alles in eine
  // Zeile. Mit Seitenleiste bleiben in Chromium 1444 px -- da weichen Icon
  // und Suche gemeinsam in die naechste Zeile aus.
  if (huelle === 'aus') {
    check(`${name}: auch die Suche auf derselben Linie`, Math.max(...m.oben) - Math.min(...m.oben) < 0.5, m.oben.join(','));
  }
  check(`${name}: Felder 32 px unter der Kopfzeile`, Math.abs(m.oben[0] - m.kopfUnten - 32) < 1, m.oben[0] - m.kopfUnten);
  check(`${name}: Icon und Suche auf derselben Linie`, m.ft && Math.abs(m.ft.top - m.suche.top) < 0.5);
  check(`${name}: Tabelle 47 px unter den Feldern`, Math.abs(m.karte - m.feldUnten - 47) < 1, m.karte - m.feldUnten);
  check(`${name}: der längste Monatsname passt ins Feld`, m.laengster <= m.monPlatz, `${m.laengster} > ${m.monPlatz}`);
  check(`${name}: Feiertage-Icon 40 × 40`, m.ft && Math.abs(m.ft.width - 40) < 0.5 && Math.abs(m.ft.height - 40) < 0.5);
  check(`${name}: Feiertage-Icon direkt vor der Suche`, m.ft && Math.abs(m.suche.left - m.ft.right - 9) < 1, m.ft && m.suche.left - m.ft.right);

  if (huelle === 'aus') {
    // Filtern: der Hinweis erscheint, die Tabelle bleibt stehen.
    check('Ungefiltert steht kein Hinweis da', (await page.textContent('#mxInfo')).trim() === '');
    await page.selectOption('#mxSparte', 'reinigung'); await page.waitForTimeout(300);
    const g = await mass(page);
    check('Gefiltert sagt der Hinweis, was gilt', (await page.textContent('#mxInfo')).includes('Reinigung'));
    const info = await page.evaluate(() => {
      const i = document.getElementById('mxInfo').getBoundingClientRect();
      const t = document.getElementById('mxInfo').firstChild;
      const rg = document.createRange(); rg.selectNodeContents(document.getElementById('mxInfo'));
      const b = rg.getBoundingClientRect();
      return { oben: b.top - i.top, unten: i.bottom - b.bottom };
    });
    check('… ohne dass die Tabelle springt', Math.abs(g.karte - m.karte) < 0.5, g.karte - m.karte);
    check('… und steht mittig zwischen Feldern und Tabelle', Math.abs(info.oben - info.unten) < 1.5, JSON.stringify(info));
    await page.selectOption('#mxSparte', '');

    for (const tab of ['einsaetze', 'objektplan', 'tag']) {
      await page.evaluate(t => goTab(t), tab); await page.waitForTimeout(200);
      check(`Feiertage-Icon auch im Reiter ${tab}`,
        await page.isVisible(`#pv-${tab} [aria-label="Feiertage verwalten"]`));
    }
    await page.evaluate(() => goTab('uebersicht')); await page.waitForTimeout(200);
    await page.click('#pv-uebersicht [aria-label="Feiertage verwalten"]');
    check('Das Icon öffnet den Feiertagsdialog', await page.waitForSelector('#dlgFeiertage.on', { timeout: 2000 }).then(() => true, () => false));
  }
  await page.close();
}

// Am Handy: Reiterleiste bleibt, das Icon gibt es dort nicht (wie bisher).
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(
    r.request().url().includes('login') ? { status: 'ok', token: 't', name: 'a', ist_admin: true } :
    { status: 'ok', einsaetze: [], rapporte: [], objekte: [], feiertage: [], kunden: [], mitarbeiter: [], gepflegt: {}, sperren: [], kpi: {} }) }));
  await page.goto(`file://${WURZEL}/dashboard.html`);
  await page.fill('#gName', 'a'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
  await page.waitForSelector('#shell.on'); await page.waitForTimeout(300);
  await page.evaluate(() => { go('planung'); goTab('einsaetze'); }); await page.waitForTimeout(300);
  check('Handy: die Reiterleiste der Planung bleibt', await page.isVisible('#view-planung > .tabs'));
  check('Handy: kein Feiertage-Icon', !(await page.isVisible('#pv-einsaetze [aria-label="Feiertage verwalten"]')));
  await page.close();
}

await browser.close();
console.log(`${ok.length} bestanden, ${bad.length} nicht bestanden`);
for (const b of bad) console.log('  FEHLT: ' + b);
if (bad.length) { process.exit(1); }
console.log('\nAlle Pruefungen bestanden.');
