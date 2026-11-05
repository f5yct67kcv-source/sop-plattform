// Raster der Monatsuebersicht in der Planung (Skizze 15.10.2026).
//
// Gemessen am gerenderten Zustand, nicht im Quelltext nachgelesen:
//
// 1. DIE NAMENSSPALTE IST 400 PX BREIT. Vorher dehnte sie sich auf rund
//    450 px und nahm den Tagen Platz weg. Ist der Platz im Monat knapp
//    (Seitenleiste), gibt sie bis 240 px nach statt die Tage zu quetschen.
// 2. WOCHE UND TAG STEHEN LINKS. Die Tage beginnen direkt an der
//    Namensspalte und werden hoechstens 100 px breit; der Rest bleibt rechts
//    frei. Vorher sassen sie am rechten Rand, die Namensspalte dazwischen
//    war ein leeres Band. Der Monat fuellt die Breite weiter ganz aus.
// 3. WOCHENENDE UND FEIERTAG BLEIBEN SICHTBAR, AUCH UEBER GRUEN. Vorher
//    uebermalte die Belegungsfarbe das Wochenende -- in einer voll
//    besetzten Zeile sah Samstag aus wie Dienstag.
// Am Handy gibt es die Monatsuebersicht nicht (ENT-165); die neuen Regeln
// stehen darum nur ab 901 px.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const ok = [], bad = [];
const check = (n, c, x) => (c ? ok : bad).push(n + (c || x === undefined ? '' : ' -- ' + x));

const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const M = iso(new Date()).slice(0, 7);
const t = n => `${M}-${String(n).padStart(2, '0')}`;
const tage = new Date(Number(M.slice(0, 4)), Number(M.slice(5, 7)), 0).getDate();
const ma = [{ id: 1, name: 'p', vorname: 'P', nachname: 'Muster', zusage: 'ja' }];
const OBJEKTE = [1, 2, 3].map(i => ({ id: i, kunde_id: 1, kunde_name: 'Beispiel AG', name: 'Objekt ' + i, ort: '4600 Olten', kanton: 'SO', aktiv: 1 }));
// Jedes Objekt jeden Tag voll besetzt: so liegt Gruen auf jedem Wochenende
// und auf dem Feiertag.
const EINS = [];
for (const o of OBJEKTE) for (let d = 1; d <= tage; d++) {
  EINS.push({ id: o.id * 100 + d, objekt_id: o.id, kunde_name: 'Beispiel AG', titel: 'Wache', ort: 'Olten', datum: t(d),
    von: '08:00:00', bis: '16:00:00', bedarf: 1, status: 'geplant', mitarbeiter: ma });
}
// Feiertag an einem Werktag, damit er nicht mit dem Wochenende zusammenfaellt.
let ftTag = 1;
while ([0, 6].includes(new Date(t(ftTag) + 'T12:00:00').getDay())) ftTag++;
const FEIERTAG = t(ftTag);

const browser = await chromium.launch({ executablePath: browserPfad() });

async function seite(breite, hoehe, huelle = 'aus') {
  const page = await browser.newPage({ viewport: { width: breite, height: hoehe } });
  page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
  await page.route('**/api/**', r => {
    const p = r.request().url().split('/api/')[1].split('?')[0];
    const s = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) });
    if (p.includes('login')) return s({ status: 'ok', token: 't', name: 'a', ist_admin: true });
    if (p.includes('objekt_list')) return s({ status: 'ok', objekte: OBJEKTE });
    if (p.includes('einsatz_list')) return s({ status: 'ok', einsaetze: EINS });
    if (p.includes('feiertage')) return s({ status: 'ok', feiertage: [{ datum: FEIERTAG, name: 'Testfeiertag', halb: 0 }] });
    return s({ status: 'ok', einsaetze: [], rapporte: [], objekte: [], kunden: [], mitarbeiter: [], feiertage: [],
      gepflegt: {}, sperren: [], kpi: {}, verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [] });
  });
  await page.goto(`file://${WURZEL}/dashboard.html`);
  await page.evaluate(h => localStorage.setItem('rv3_huelle', h), huelle);
  await page.reload();
  await page.fill('#gName', 'a'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
  await page.waitForSelector('#shell.on'); await page.waitForTimeout(300);
  await page.evaluate(() => { go('planung'); goTab('uebersicht'); });
  await page.waitForSelector('#mxTable td.d', { state: 'attached' }); await page.waitForTimeout(300);
  return page;
}

const mass = page => page.evaluate(() => {
  const r = e => e.getBoundingClientRect();
  const kopf = [...document.querySelectorAll('#mxTable thead th')];
  const tage = kopf.slice(1);
  return {
    karte: r(document.querySelector('#mxTable')),
    obj: r(kopf[0]).width,
    tagBreiten: tage.map(th => r(th).width),
    ersterTag: r(tage[0]).left, objRechts: r(kopf[0]).right,
    letzterTag: r(tage[tage.length - 1]).right,
  };
});

// Gerenderte Farbe einer Zelle: Hintergrund plus innerer Schatten als
// Schleier, so wie der Browser sie uebereinanderlegt.
const farbe = (page, sel) => page.evaluate(sel => {
  const el = document.querySelector(sel);
  const z = el.querySelector('.zelle') || el;
  const c = document.createElement('canvas'); c.width = c.height = 1;
  const g = c.getContext('2d');
  const bg = getComputedStyle(z).backgroundColor !== 'rgba(0, 0, 0, 0)' ? getComputedStyle(z).backgroundColor : getComputedStyle(el).backgroundColor;
  g.fillStyle = getComputedStyle(document.querySelector('.card')).backgroundColor; g.fillRect(0, 0, 1, 1);
  g.fillStyle = bg; g.fillRect(0, 0, 1, 1);
  const sh = getComputedStyle(z).boxShadow.match(/rgba?\([^)]*\)/);
  if (sh && getComputedStyle(z).boxShadow.includes('inset')) { g.fillStyle = sh[0]; g.fillRect(0, 0, 1, 1); }
  return [...g.getImageData(0, 0, 1, 1).data].slice(0, 3);
}, sel);
const abstand = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const spalte = d => page => page.evaluate(d => {
  const kopf = [...document.querySelectorAll('#mxTable thead th')];
  return kopf.findIndex(th => th.title.startsWith(d)) + 1;
}, d);
const dmy = d => `${d.slice(8)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;

for (const [huelle, name] of [['aus', 'ohne Seitenleiste'], ['voll', 'mit Seitenleiste']]) {
  const page = await seite(1728, 1009, huelle);

  // ── Monat
  let m = await mass(page);
  // Mit Seitenleiste reicht die Breite nicht fuer 400 + 31 Tage: dort gibt
  // die Namensspalte bis 240 px nach, bevor die Tage schmaler werden.
  if (huelle === 'aus') check(`${name}, Monat: Namensspalte 400 px`, Math.abs(m.obj - 400) < 0.5, m.obj);
  else check(`${name}, Monat: Namensspalte gibt nach (240–400 px), die Tage bleiben über 36 px`,
    m.obj >= 239.5 && m.obj < 399.5 && Math.min(...m.tagBreiten) >= 36, `${m.obj} / ${Math.min(...m.tagBreiten)}`);
  check(`${name}, Monat: die Tage füllen die Karte bis zum rechten Rand`, Math.abs(m.letzterTag - m.karte.right) < 1.5, m.karte.right - m.letzterTag);
  check(`${name}, Monat: alle Tage gleich breit`, Math.max(...m.tagBreiten) - Math.min(...m.tagBreiten) < 1, m.tagBreiten.join(','));
  if (huelle === 'aus') await page.screenshot({ path: OUT + '/planung-monat.png' });

  // ── Woche
  await page.selectOption('#mxSchnell', 'woche'); await page.waitForTimeout(300);
  m = await mass(page);
  check(`${name}, Woche: Namensspalte bleibt 400 px`, Math.abs(m.obj - 400) < 0.5, m.obj);
  check(`${name}, Woche: der erste Tag steht direkt an den Namen`, Math.abs(m.ersterTag - m.objRechts) < 1, m.ersterTag - m.objRechts);
  check(`${name}, Woche: jeder Tag 100 px`, m.tagBreiten.every(b => Math.abs(b - 100) < 0.5), m.tagBreiten.join(','));
  check(`${name}, Woche: rechts bleibt Platz frei statt eines leeren Bands bei den Namen`, m.karte.right - m.letzterTag > 100);
  if (huelle === 'aus') await page.screenshot({ path: OUT + '/planung-woche.png' });

  // ── Tag
  await page.selectOption('#mxSchnell', 'heute'); await page.waitForTimeout(300);
  m = await mass(page);
  check(`${name}, Tag: der Tag steht direkt an den Namen, 100 px breit`,
    Math.abs(m.ersterTag - m.objRechts) < 1 && Math.abs(m.tagBreiten[0] - 100) < 0.5, `${m.ersterTag - m.objRechts} / ${m.tagBreiten[0]}`);
  await page.close();
}

// ── Wochenende und Feiertag ueber Gruen, hell und dunkel
for (const thema of ['hell', 'dunkel']) {
  const page = await seite(1728, 1009);
  await page.evaluate(th => { localStorage.setItem('rv3_thema', th); document.documentElement.setAttribute('data-theme', th === 'dunkel' ? 'dark' : 'light'); }, thema);
  await page.evaluate(() => renderMatrix()); await page.waitForTimeout(200);
  // Ein Samstag und ein normaler Werktag in derselben, voll besetzten Zeile.
  const idx = await page.evaluate(() => {
    const kopf = [...document.querySelectorAll('#mxTable thead th')];
    return { we: kopf.findIndex(th => th.classList.contains('we')) + 1,
      wt: kopf.findIndex((th, i) => i > 0 && !th.className.trim()) + 1,
      fei: kopf.findIndex(th => th.classList.contains('fei')) + 1 };
  });
  const zelle = i => `#mxTable tbody tr:first-child td:nth-child(${i})`;
  const wt = await farbe(page, zelle(idx.wt));
  const we = await farbe(page, zelle(idx.we));
  const fei = await farbe(page, zelle(idx.fei));
  check(`${thema}: die Zeile ist am Werktag, am Wochenende und am Feiertag belegt`,
    await page.evaluate(i => [i.wt, i.we, i.fei].every(n => document.querySelector(`#mxTable tbody tr:first-child td:nth-child(${n})`).classList.contains('z-voll')), idx));
  check(`${thema}: ein belegter Samstag hebt sich sichtbar vom belegten Werktag ab`, abstand(wt, we) > 10, `${wt} / ${we}`);
  check(`${thema}: ein belegter Feiertag hebt sich sichtbar vom belegten Werktag ab`, abstand(wt, fei) > 10, `${wt} / ${fei}`);
  check(`${thema}: Feiertag und Wochenende sehen verschieden aus`, abstand(we, fei) > 10, `${we} / ${fei}`);
  const kopf = await page.evaluate(i => {
    const k = [...document.querySelectorAll('#mxTable thead th')];
    return { wt: getComputedStyle(k[i.wt - 1]).backgroundColor, we: getComputedStyle(k[i.we - 1]).backgroundColor, fei: getComputedStyle(k[i.fei - 1]).boxShadow };
  }, idx);
  check(`${thema}: der Kopf von Samstag/Sonntag ist anders gefärbt als ein Werktag`, kopf.wt !== kopf.we);
  check(`${thema}: der Feiertag trägt oben eine Linie`, /inset/.test(kopf.fei));
  if (thema === 'dunkel') await page.screenshot({ path: OUT + '/planung-wochenende.png' });
  await page.close();
}

await browser.close();
console.log(`${ok.length} bestanden, ${bad.length} nicht bestanden`);
for (const b of bad) console.log('  FEHLT: ' + b);
if (bad.length) { process.exit(1); }
console.log('\nAlle Pruefungen bestanden.');
