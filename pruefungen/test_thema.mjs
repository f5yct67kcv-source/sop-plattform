// Hell und dunkel (ENT-029). Geprueft wird nicht nur der Schalter, sondern
// auch, ob in beiden Fassungen genug Kontrast bleibt -- eine dunkle Ansicht,
// die man nicht lesen kann, ist keine.
import { WURZEL, HIER, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const EXE = browserPfad();
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const M = iso(new Date()).slice(0, 7);
const T = n => `${M}-${String(n).padStart(2, '0')}`;
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const OBJ = { id: 1, kunde_id: 1, kunde_name: 'Borner AG', name: 'Gerolag Center',
  strasse: 'Industriestrasse 78', ort: '4601 Olten', kanton: 'SO', einsatzart: 'Revierdienst', aktiv: 1 };
const VOR = [{ id: 3, name: 'Schliessrunde', kuerzel: 'SR', art: 'arbeit', von: '22:00', bis: '22:30',
  arbeitszeit_h: 0.5, auf_abruf: 0, farbe: null, gueltig_ab: '2026-01-01', gueltig_bis: null }];
const BED = [1,2,3,4].map(d => ({ datum: T(d), masterschicht_id: 3, name: 'Schliessrunde', kuerzel: 'SR',
  von: '22:00', bis: '22:30', bedarf: 2, status: 'geplant', feiertag: null, art: 'arbeit', arbeitszeit_h: 0.5 }));
const EIN = [{ id: 101, kunde_id: 1, kunde_name: 'Borner AG', objekt_id: 1, masterschicht_id: 3,
  titel: 'SR · Schliessrunde', strasse: null, ort: '4601 Olten', einsatzart: 'Revierdienst',
  datum: T(2), von: '22:00:00', bis: '22:30:00', bedarf: 2, status: 'geplant', bemerkung: null,
  mitarbeiter: [{ id: 2, name: 'valbon', vorname: 'Valbon', nachname: 'Redjepi', zusage: 'offen' }] }];

async function starte(vorbelegt) {
  const browser = await chromium.launch({ executablePath: EXE });
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
  if (vorbelegt !== undefined) {
    await page.addInitScript(w => { try { localStorage.setItem('rv3_thema', w); } catch (e) {} }, vorbelegt);
  }
  await page.route('**/api/**', route => {
    const u = route.request().url();
    const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.includes('login')) return send({ status: 'ok', token: 't', name: 'a', ist_admin: true });
    if (u.includes('objektplan')) return send({ status: 'ok', objekt: OBJ, vorlagen: VOR,
      bedarf: BED, einsaetze: EIN, feiertage: { [T(1)]: { name: 'Bundesfeier' } } });
    if (u.includes('objekt_list')) return send({ status: 'ok', objekte: [OBJ] });
    if (u.includes('einsatz_list')) return send({ status: 'ok', einsaetze: EIN });
    if (u.includes('mitarbeiter_list')) return send({ status: 'ok', mitarbeiter: [
      { id: 1, name: 'adrian', vorname: 'Adrian', nachname: 'von Arb', aktiv: 1, ist_admin: 1 },
      { id: 2, name: 'valbon', vorname: 'Valbon', nachname: 'Redjepi', aktiv: 1, ist_admin: 0 }] });
    if (u.includes('dashboard_stats')) return send({ status: 'ok',
      kpi: { rapporte_monat: 3, rapporte_vormonat: 1, stunden_monat: 24, stunden_vormonat: 8, mitarbeiter: 2, kunden: 1, rapporte_total: 4 },
      verlauf: Array.from({ length: 8 }, (_, i) => ({ kw: 26 + i, stunden: 20, anzahl: 2 })),
      angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [] });
    return send({ status: 'ok', kunden: [], rapporte: [], feiertage: [], gepflegt: {}, sperren: [] });
  });
  await page.goto(`file://${WURZEL}/dashboard.html`);
  await page.fill('#gName', 'a'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
  await page.waitForSelector('#shell.on'); await page.waitForTimeout(400);
  return { browser, page };
}

// Kontrast nach WCAG -- der einzige belastbare Weg, "lesbar" zu pruefen.
const LUM = c => {
  const [r, g, b] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const rgb = s => (s.match(/\d+/g) || [0, 0, 0]).slice(0, 3).map(Number);
const kontrast = (a, b) => {
  const l1 = LUM(rgb(a)), l2 = LUM(rgb(b));
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

let { browser, page } = await starte();

// ══════════════ SCHALTER
check('Der Schalter ist in der Kopfzeile', await page.isVisible('#btnThema'));
check('Er ist als Schalter ausgezeichnet',
  await page.evaluate(() => $('btnThema').getAttribute('role') === 'switch'));
check('Ohne Wahl startet es hell',
  await page.evaluate(() => document.documentElement.getAttribute('data-thema') === 'hell'));
check('Der Schalter meldet „aus"',
  await page.evaluate(() => $('btnThema').getAttribute('aria-checked') === 'false'));
check('Er trägt eine sprechende Beschriftung',
  (await page.getAttribute('#btnThema', 'title')).includes('dunkle'));

await page.click('#btnThema');
await page.waitForTimeout(350);
check('Ein Klick schaltet auf dunkel',
  await page.evaluate(() => document.documentElement.getAttribute('data-thema') === 'dunkel'));
check('Der Schalter meldet „an"',
  await page.evaluate(() => $('btnThema').getAttribute('aria-checked') === 'true'));
check('Die Wahl wird gespeichert',
  await page.evaluate(() => localStorage.getItem('rv3_thema') === 'dunkel'));
check('Die Systemleiste zieht mit',
  await page.evaluate(() => document.querySelector('meta[name="theme-color"]').content === '#0B0D11'));

// ══════════════ ES IST WIRKLICH DUNKEL
// Die Flaeche, auf der ein Text wirklich liegt -- nicht der Seitengrund.
await page.addInitScript(() => {});
const echterGrund = sel => page.evaluate(s => {
  let el = document.querySelector(s);
  const txt = getComputedStyle(el).color;
  while (el) {
    const bg = getComputedStyle(el).backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return { text: txt, grund: bg };
    el = el.parentElement;
  }
  return { text: txt, grund: 'rgb(255,255,255)' };
}, sel);
const kopf = await echterGrund('.topbar h1');
const dunkel = await page.evaluate(() => ({
  grund: getComputedStyle(document.body).backgroundColor,
  flaeche: getComputedStyle(document.querySelector('.card') || document.body).backgroundColor,
  text: getComputedStyle(document.querySelector('.topbar h1')).color,
}));
check('Die Kopfzeile ist im Dunkeln dunkel', LUMTEST(kopf.grund.replace(/[\d.]+\)$/, '1)')));
check(`Titel auf der Kopfzeile lesbar (${kontrast(kopf.text, kopf.grund.replace(/[\d.]+\)$/, '1)')).toFixed(1)}:1)`,
  kontrast(kopf.text, kopf.grund.replace(/[\d.]+\)$/, '1)')) >= 7);
check('Der Grund ist dunkel', LUMTEST(dunkel.grund));
function LUMTEST(c) { const [r, g, b] = (c.match(/\d+/g) || []).slice(0, 3).map(Number); return (r + g + b) / 3 < 60; }
check('Der Text ist hell', !LUMTEST(dunkel.text));
check('Text auf Grund ist gut lesbar', kontrast(dunkel.text, dunkel.grund) >= 7);
await page.screenshot({ path: OUT + '/66-dunkel-uebersicht.png' });

// ══════════════ KONTRASTE IN DER PLANUNG
await page.evaluate(() => go('planung')); await page.waitForTimeout(300);
await page.evaluate(() => goTab('objektplan')); await page.waitForTimeout(800);
const zellen = await page.evaluate(() => {
  const raus = {};
  ['s-voll', 's-teil', 's-leer', 's-prov', 's-soll'].forEach(k => {
    const el = document.querySelector('.gr .' + k);
    if (el) { const c = getComputedStyle(el); raus[k] = [c.color, c.backgroundColor]; }
  });
  const kopf = document.querySelector('.gr thead th');
  raus.kopf = [getComputedStyle(kopf).color, getComputedStyle(kopf).backgroundColor];
  const lb = document.querySelector('.gr td.lb b');
  raus.lb = [getComputedStyle(lb).color, getComputedStyle(document.querySelector('.gr td.lb')).backgroundColor];
  return raus;
});
Object.entries(zellen).forEach(([k, [vg, hg]]) => {
  const grund = hg === 'rgba(0, 0, 0, 0)' ? 'rgb(23, 26, 32)' : hg;
  const v = kontrast(vg, grund);
  check(`Lesbar im Dunkeln: ${k} (${v.toFixed(1)}:1)`, v >= 4.5);
});
await page.screenshot({ path: OUT + '/67-dunkel-objektplan.png' });

// Dialoge und Eingabefelder
await page.evaluate(d => oplZelleAuf(3, d), T(2));
await page.waitForTimeout(400);
const dlg = await page.evaluate(() => {
  const d = document.querySelector('#dlgZuteilen .dlg');
  const t = document.querySelector('#zuMa .who b');
  return { flaeche: getComputedStyle(d).backgroundColor, text: getComputedStyle(t).color };
});
check('Dialoge sind ebenfalls dunkel', LUMTEST(dlg.flaeche));
check('Text im Dialog ist lesbar', kontrast(dlg.text, dlg.flaeche) >= 7);
await page.screenshot({ path: OUT + '/68-dunkel-dialog.png' });
await page.evaluate(() => closeDlg('dlgZuteilen'));

await page.evaluate(() => awAuf());
await page.waitForTimeout(800);
const feld = await page.evaluate(() => {
  const i = document.querySelector('#awTabelle input');
  const c = getComputedStyle(i);
  return { text: c.color, grund: c.backgroundColor, rand: c.borderTopColor };
});
check('Eingabefelder sind im Dunkeln lesbar', kontrast(feld.text, feld.grund) >= 7);
check('Eingabefelder heben sich vom Fenster ab', feld.grund !== 'rgba(0, 0, 0, 0)');
await page.evaluate(() => closeDlg('dlgAnwenden'));

// ══════════════ ZURÜCK AUF HELL
await page.click('#btnThema');
await page.waitForTimeout(350);
check('Zurück auf hell',
  await page.evaluate(() => document.documentElement.getAttribute('data-thema') === 'hell'));
const hell = await page.evaluate(() => ({
  grund: getComputedStyle(document.body).backgroundColor,
  text: getComputedStyle(document.querySelector('.topbar h1')).color,
}));
check('Der Grund ist wieder hell', !LUMTEST(hell.grund));
check('Text auf hellem Grund bleibt lesbar', kontrast(hell.text, hell.grund) >= 7);
const kopfHell = await echterGrund('.topbar h1');
check('Die Kopfzeile ist im Hellen hell', !LUMTEST(kopfHell.grund.replace(/[\d.]+\)$/, '1)')));
check('Titel auf heller Kopfzeile lesbar',
  kontrast(kopfHell.text, kopfHell.grund.replace(/[\d.]+\)$/, '1)')) >= 7);

// ══════════════ DIE AUFWERTUNG HAENGT NICHT AM THEMA (ENT-227)
//
// Der Projektinhaber hat ausdruecklich entschieden, BEIDE Themen anzuheben.
// Die Gefahr ist konkret und hat einen Namen: Die uebergebene Anleitung
// (ENT-223) legte ein zweites Farbsystem an, das nur im Dunkeln galt --
// waere das so eingebaut worden, saehe das helle Thema unveraendert alt aus,
// ohne dass irgendetwas kaputtgeht oder auffaellt.
//
// Darum wird hier nicht geprueft, WELCHE Werte gesetzt sind (das waere der
// Quelltext, abgeschrieben), sondern die Aussage: Form und Schrift sind in
// beiden Themen dieselben. Nur die Farben duerfen sich unterscheiden.
const formJeThema = async () => page.evaluate(() => {
  const k = getComputedStyle(document.querySelector('.kpi'));
  const c = getComputedStyle(document.querySelector('.card'));
  return { kpiRadius: k.borderRadius, kpiPolster: k.padding, cardRadius: c.borderRadius,
           schrift: getComputedStyle(document.body).fontFamily, kpiGrund: k.backgroundColor };
});
const formHell = await formJeThema();
await page.click('#btnThema'); await page.waitForTimeout(350);
const formDunkel = await formJeThema();

check('KRITISCH: die Radien gelten in beiden Themen gleich (ENT-227)',
  formHell.kpiRadius === formDunkel.kpiRadius && formHell.cardRadius === formDunkel.cardRadius);
check('KRITISCH: die Luft gilt in beiden Themen gleich',
  formHell.kpiPolster === formDunkel.kpiPolster);
check('KRITISCH: dieselbe Grundschrift in beiden Themen',
  formHell.schrift === formDunkel.schrift);
check('Die Farbe unterscheidet sich sehr wohl -- sonst haette der Umschalter keine Wirkung',
  formHell.kpiGrund !== formDunkel.kpiGrund);

// Im Dunkeln traegt der Rand, nicht der Schatten (ENT-029 als Absicht, seit
// ENT-227 auch tatsaechlich so). Das stand jahrelang nur als Kommentar da,
// waehrend --sh-1 weiter einen Schatten unter jede Karte warf -- niemandem
// aufgefallen, weil ein ueberfluessiger Schatten nichts kaputtmacht, er
// macht die Flaeche nur schmutzig. Genau darum eine Pruefung: Eine Absicht
// ohne Pruefung ist eine Behauptung.
const schatten = async () => page.evaluate(() => ({
  karte: getComputedStyle(document.querySelector('.card')).boxShadow,
  rand: getComputedStyle(document.querySelector('.card')).borderTopWidth,
}));
const schattenDunkel = await schatten();
await page.click('#btnThema'); await page.waitForTimeout(350);
const schattenHell = await schatten();

check('KRITISCH: im Dunkeln wirft keine Karte einen Schatten (ENT-227)',
  schattenDunkel.karte === 'none');
check('Im Dunkeln traegt stattdessen der Rand', schattenDunkel.rand !== '0px');
check('Im Hellen bleibt der Schatten -- dort gibt es keinen Randkontrast, der ihn ersetzt',
  schattenHell.karte !== 'none');

await browser.close();

// ══════════════ GESPEICHERTE WAHL GILT BEIM NÄCHSTEN MAL
({ browser, page } = await starte('dunkel'));
check('Die gespeicherte Wahl wird übernommen',
  await page.evaluate(() => document.documentElement.getAttribute('data-thema') === 'dunkel'));
check('Der Schalter steht passend',
  await page.evaluate(() => $('btnThema').getAttribute('aria-checked') === 'true'));
// Kein Aufblitzen: der Wert steht schon vor dem ersten Zeichnen am Dokument
const frueh = await page.evaluate(() => document.documentElement.dataset.thema);
check('Das Merkmal steht früh genug am Dokument', frueh === 'dunkel');
await browser.close();

({ browser, page } = await starte('hell'));
check('Auch „hell" bleibt gespeichert',
  await page.evaluate(() => document.documentElement.getAttribute('data-thema') === 'hell'));

// ══════════════ MOBIL
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(250);
const mob = await page.evaluate(() => ({
  sichtbar: !!$('btnThema').offsetParent,
  breite: Math.round($('btnThema').getBoundingClientRect().width),
  scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
}));
// Seit ENT-059 liegt der Schalter auf dem Handy im Aufklappmenue, nicht mehr
// in der Kopfzeile -- dort war er einer von vier Knoepfen.
check('KRITISCH: der Schalter ist auf dem Handy nicht mehr in der Kopfzeile', !mob.sichtbar);
check('Er schiebt die Kopfzeile nicht', mob.scroll <= 1);
await page.click('.btn-burger');
await page.waitForTimeout(400);
// Seit ENT-067 ist er im Menue kein Listeneintrag mehr, sondern derselbe
// Schiebeschalter wie am Desktop -- oben rechts im Menuekopf. Als Zeile sah
// er aus wie ein Menuepunkt und verhielt sich nicht wie einer.
check('Er steht stattdessen im Menue', await page.isVisible('#btnThemaMob'));
check('KRITISCH: die alte Menuezeile gibt es nicht mehr',
  (await page.$$('#nav-thema')).length === 0);
check('Er ist ein Schiebeschalter, kein Listeneintrag',
  (await page.getAttribute('#btnThemaMob', 'role')) === 'switch');
const vorher = await page.evaluate(() => document.documentElement.getAttribute('data-thema'));
await page.click('#btnThemaMob');
await page.waitForTimeout(350);
check('Und er wechselt dort die Darstellung',
  (await page.evaluate(() => document.documentElement.getAttribute('data-thema'))) !== vorher);
check('KRITISCH: beide Schalter fuehren denselben Zustand',
  (await page.getAttribute('#btnThemaMob', 'aria-checked'))
  === (await page.getAttribute('#btnThema', 'aria-checked')));
await browser.close();

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
