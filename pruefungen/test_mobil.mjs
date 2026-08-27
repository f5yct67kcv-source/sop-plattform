import { WURZEL, HIER, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const EXE = browserPfad();
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const HEUTE = iso(new Date()), MONAT = HEUTE.slice(0, 7);
const T = n => `${MONAT}-${String(n).padStart(2, '0')}`;

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const MA = { status: 'ok', mitarbeiter: [
  { id: 1, name: 'adrian', ist_admin: 1, vorname: 'Adrian', nachname: 'Von Arb' },
  { id: 2, name: 'daniele.ciardo', ist_admin: 0, vorname: 'Daniele', nachname: 'Ciardo' }]};
const KU = { status: 'ok', kunden: [{ id: 1, name: 'Einwohnergemeinde Niedergösgen', strasse: 'Dorfstrasse 4', ort: '5013 Niedergösgen', telefon: '062 849 00 00', email: null }]};
const OB = { status: 'ok', objekte: [{ id: 1, kunde_id: 1, kunde_name: 'Einwohnergemeinde Niedergösgen',
  name: 'Einkaufszentrum Nord West', strasse: 'Sehr Lange Hauptstrasse 44', ort: '4632 Trimbach',
  kanton: 'SO', einsatzart: 'Revierdienst', aktiv: 1, bemerkung: null, masterschichten: 1, stunden_je_einsatz: 0.5 }]};
const MS = { status: 'ok', masterschichten: [{ id: 10, objekt_id: 1, name: 'Revierdienst Schliessrunde',
  kuerzel: 'SR', art: 'arbeit', von: '22:00:00', bis: '22:30:00', pause_von: null, pause_bis: null,
  pause_min: 0, arbeitszeit_h: 0.5, farbe: null, auf_abruf: 0, rhythmus: 'woche', bedarf_mo: 1, bedarf_di: 1,
  bedarf_mi: 1, bedarf_do: 1, bedarf_fr: 1, bedarf_sa: 0, bedarf_so: 0, bedarf_feiertag: 2,
  intervall_tage: null, intervall_start: null, bedarf_intervall: 1, gueltig_ab: '2026-01-01',
  gueltig_bis: null, ersetzt_id: null, laeuft: true }]};
const A = { id: 1, name: 'adrian', vorname: 'Adrian', nachname: 'Von Arb', zusage: 'offen' };
const EIN = { status: 'ok', einsaetze: [
  { id: 21, kunde_id: 1, kunde_name: 'Einwohnergemeinde Niedergösgen', objekt_id: 1, masterschicht_id: 10,
    titel: 'Revierdienst Schliessrunde', strasse: 'Sehr Lange Hauptstrasse 44', ort: '4632 Trimbach',
    einsatzart: 'Revierdienst', datum: T(3), von: '22:00:00', bis: '22:30:00', bedarf: 2,
    status: 'geplant', bemerkung: null, mitarbeiter: [A] },
  { id: 22, kunde_id: 1, kunde_name: 'Einwohnergemeinde Niedergösgen', objekt_id: null, masterschicht_id: null,
    titel: 'Baustelle Kreiselumfahrung', strasse: 'Dorfstrasse 1', ort: '5013 Niedergösgen',
    einsatzart: 'Verkehrsdienst', datum: T(4), von: '07:30:00', bis: '16:30:00', bedarf: 1,
    status: 'bestaetigt', bemerkung: null, mitarbeiter: [A] }]};
const RAP = { status: 'ok', rapporte: [{ id: 1, datum: T(3), mitarbeiter: 'daniele.ciardo',
  kunde: 'Einwohnergemeinde Niedergösgen', strasse: 'Dorfstrasse 1', ort: '5013 Niedergösgen',
  auftrag_nr: 'A-118', einsatzart: 'Verkehrsdienst', von: '07:00:00', bis: '16:00:00', pause_min: 30,
  netto_h: '8.50', unterzeichner: 'R. Muster', unterschrift: null, bemerkung: null, erfasst_am: T(3) + ' 16:12:00' }]};

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
await page.route('**/api/**', route => {
  const p = route.request().url().split('/api/')[1].split('?')[0];
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'adrianvonarb', ist_admin: true });
  if (p.includes('dashboard_stats')) return send({ status: 'ok',
    kpi: { rapporte_monat: 1, rapporte_vormonat: 0, stunden_monat: 8.5, stunden_vormonat: 0, mitarbeiter: 2, kunden: 1, rapporte_total: 1 },
    verlauf: Array.from({ length: 8 }, (_, i) => ({ kw: 26 + i, stunden: 20, anzahl: 2 })),
    angemeldet: [{ name: 'adrianvonarb', vorname: 'Adrian', nachname: 'Von Arb', letzte_anmeldung: T(3) + ' 08:00:00' }],
    pro_mitarbeiter: [{ name: 'adrian', vorname: 'Adrian', nachname: 'Von Arb', stunden: '8.50', anzahl: 1 }],
    letzte_rapporte: RAP.rapporte.map(r => ({ ...r, mitarbeiter: r.mitarbeiter })) });
  if (p.includes('rapport_list')) return send(RAP);
  if (p.includes('mitarbeiter_list')) return send(MA);
  if (p.includes('kunden_list')) return send(KU);
  if (p.includes('einsatz_list')) return send(EIN);
  if (p.includes('objekt_list')) return send(OB);
  if (p.includes('objektplan')) return send({ status: 'ok', objekt: OB.objekte[0],
    vorlagen: MS.masterschichten.map(x => ({ id: x.id, name: x.name, kuerzel: x.kuerzel, art: x.art,
      von: String(x.von).slice(0, 5), bis: String(x.bis).slice(0, 5), arbeitszeit_h: Number(x.arbeitszeit_h),
      auf_abruf: x.auf_abruf, farbe: x.farbe, gueltig_ab: x.gueltig_ab, gueltig_bis: x.gueltig_bis })),
    bedarf: EIN.einsaetze.filter(e => e.masterschicht_id).map(e => ({ datum: e.datum,
      masterschicht_id: e.masterschicht_id, name: e.titel, kuerzel: 'SR', von: '22:00', bis: '22:30',
      bedarf: e.bedarf, status: 'geplant', feiertag: null, art: 'arbeit', arbeitszeit_h: 0.5 })),
    einsaetze: EIN.einsaetze.filter(e => Number(e.objekt_id) === 1), feiertage: {} });
  if (p.includes('masterschicht_list')) return send(MS);
  if (p.includes('feiertage_list')) return send({ status: 'ok', kanton: 'SO', feiertage: [
    { id: 1, datum: T(3), kanton: 'SO', name: 'Bundesfeier', halbtags: 0, ab_zeit: null, quelle: 'Arbeitsinspektorat' }], gepflegt: {} });
  return send({ status: 'ok' });
});

await page.goto(`file://${WURZEL}/dashboard.html`);
await page.fill('#gName', 'adrianvonarb'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#shell.on');
await page.waitForTimeout(400);

// Misst: schiebt die Seite waagrecht? Und ragt ein Element ueber den Rand,
// obwohl es NICHT in einem eigenen Scrollbereich sitzt?
const messen = () => page.evaluate(() => {
  const d = document.documentElement;
  const ueber = [];
  const scrollbar = el => {
    for (let p = el.parentElement; p && p !== d; p = p.parentElement) {
      const o = getComputedStyle(p).overflowX;
      if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') return true;
    }
    return false;
  };
  document.querySelectorAll('.shell *').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    if (r.right > window.innerWidth + 1 && !scrollbar(el)) {
      ueber.push((el.id ? '#' + el.id : el.className || el.tagName) + ' bis ' + Math.round(r.right));
    }
  });
  return { scroll: d.scrollWidth - d.clientWidth, ueber: ueber.slice(0, 4) };
});

async function pruefe(wo) {
  const m = await messen();
  check(`Kein Seiten-Scroll – ${wo}`, m.scroll <= 1);
  check(`Nichts ragt heraus – ${wo}`, m.ueber.length === 0);
  if (m.ueber.length) bad.push(`   ↳ ${wo}: ${m.ueber.join(' | ')}`);
}

// OP-111: Bedienelemente auf dem Handy mindestens 44px hoch -- .btn und
// .check, ueberall, nicht nur an den Stellen, die schon vorher eine eigene
// Regel hatten. Gemessen am gerenderten Zustand: eine Hoehen-Angabe in einem
// spaeteren Selektor gleicher Eigenspezifitaet koennte die Basisregel sonst
// unbemerkt aushebeln.
async function pruefeTrefferflaeche(wo) {
  const klein = await page.evaluate(() =>
    [...document.querySelectorAll('.btn, .check')]
      .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 44; })
      .map(el => (el.id ? '#' + el.id : el.className) + ' ' + Math.round(el.getBoundingClientRect().height) + 'px'));
  check(`Trefferflaeche mindestens 44px – ${wo}`, klein.length === 0);
  if (klein.length) bad.push(`   ↳ ${wo}: ${klein.slice(0, 6).join(' | ')}`);
}

const ansichten = [
  ['Übersicht', async () => { await page.evaluate(() => go('uebersicht')); }],
  ['Mitarbeitende', async () => { await page.evaluate(() => go('mitarbeiter')); }],
  ['Kunden', async () => { await page.evaluate(() => go('kunden')); }],
  ['Kunden/Objekte', async () => { await page.evaluate(() => { go('kunden'); kuGoTab('objekte'); } ); }],
  ['Kunden/Rapporte', async () => { await page.evaluate(() => { go('kunden'); kuGoTab('rapporte'); } ); }],
  ['Planung/Übersicht', async () => { await page.evaluate(() => go('planung')); await page.evaluate(() => goTab('uebersicht')); }],
  ['Planung/Einsätze', async () => { await page.evaluate(() => goTab('einsaetze')); }],
  ['Planung/Objektplanung', async () => { await page.evaluate(() => goTab('objektplan')); }],
  ['Planung/Tagesplan', async () => { await page.evaluate(() => goTab('tag')); }],
];

for (const breite of [320, 360, 390, 414]) {
  await page.setViewportSize({ width: breite, height: 844 });
  for (const [name, hin] of ansichten) {
    await hin();
    await page.waitForTimeout(160);
    await pruefe(`${name} @${breite}`);
    await pruefeTrefferflaeche(`${name} @${breite}`);
  }
}

// Stresstest: iOS gibt Auswahl- und Datumsfeldern deutlich mehr Eigenbreite.
// Das wird hier nachgestellt -- der Aufbau muss es trotzdem aushalten.
await page.setViewportSize({ width: 390, height: 844 });
await page.addStyleTag({ content: `
  select.inp { min-width: 230px !important; }
  input[type=month].inp, input[type=date].inp { min-width: 210px !important; }` });
for (const [name, hin] of ansichten) {
  await hin();
  await page.waitForTimeout(160);
  await pruefe(`${name} @390 mit breiten Feldern`);
}

// Werkzeugleisten: kein Bedienelement darf ueber seine Leiste hinausragen
await page.evaluate(() => { go('planung'); goTab('einsaetze'); });
await page.waitForTimeout(300);
const leiste = await page.evaluate(() => {
  const bar = document.querySelector('#pv-einsaetze .bar-tools');
  const br = bar.getBoundingClientRect();
  return [...bar.children].filter(c => c.getBoundingClientRect().width > 0)
    .map(c => Math.round(c.getBoundingClientRect().right - br.right))
    .filter(d => d > 1);
});
check('Werkzeugleiste haelt ihre Elemente', leiste.length === 0);
await page.screenshot({ path: `${OUT}/37-mobil-einsaetze.png`, fullPage: true });
await page.evaluate(() => goTab('objektplan'));
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/38-mobil-objektplan.png`, fullPage: true });

// Seit ENT-057 tritt auf dem Handy der Tagesplan an die Stelle der
// Monatsmatrix. Frueher wurde hier geprueft, dass die Matrix in ihrer Karte
// scrollt -- das war die Behelfsloesung. Jetzt gilt: sie erscheint dort gar
// nicht erst, weil ein Monatsraster auf 390 px nicht lesbar ist.
await page.evaluate(() => goTab('uebersicht'));
await page.waitForTimeout(400);
// Seit ENT-058 ist die Einsatzliste die mobile Startseite der Planung.
check('KRITISCH: mobil fuehrt die Monatsuebersicht in die Einsatzliste',
  await page.evaluate(() => document.getElementById('pv-einsaetze').classList.contains('on')));
check('Der Matrix-Reiter ist mobil ausgeblendet',
  await page.evaluate(() => !document.getElementById('ptab-uebersicht').getClientRects().length));
check('Die Einsatzliste zeigt mobil Karten statt einer Tabelle',
  await page.evaluate(() => {
    const t = document.querySelector('#plTable table');
    return !t || !t.getClientRects().length;
  }));
// Am Desktop bleibt das Raster, was es war.
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(300);
await page.evaluate(() => goTab('uebersicht'));
await page.waitForTimeout(400);
const mx = await page.evaluate(() => {
  const el = document.querySelector('#mxTable');
  return { ueberflow: getComputedStyle(el).overflowX, da: el.getClientRects().length > 0 };
});
check('Am Desktop ist das Monatsraster da', mx.da);
check('Monatsraster scrollt am Desktop in seiner Karte', mx.ueberflow === 'auto');
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);

// ── Sicherheitsnetz: selbst ein absichtlich zu breites Element darf die
// Seite nicht waagrecht schieben. Das ist der Schutz gegen Faelle, die sich
// hier nicht nachstellen lassen (iOS rendert Bedienelemente anders).
await page.evaluate(() => go('planung'));
await page.evaluate(() => goTab('einsaetze'));
await page.waitForTimeout(250);
await page.evaluate(() => {
  const d = document.createElement('div');
  d.id = 'testUeberbreit';
  d.style.cssText = 'width:1200px;height:20px;background:red';
  document.querySelector('#pv-einsaetze').prepend(d);
});
await page.waitForTimeout(200);
const netz = await page.evaluate(() => ({
  scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  clip: getComputedStyle(document.querySelector('.main')).overflowX,
}));
check('Sicherheitsnetz ist aktiv', netz.clip === 'clip');
check('KRITISCH: zu breites Element schiebt die Seite nicht', netz.scroll <= 1);

// Und die klebende Kopfzeile darf davon nicht kaputtgehen
await page.evaluate(() => { document.getElementById('testUeberbreit').remove(); window.scrollTo(0, 600); });
await page.waitForTimeout(300);
const kopf = await page.evaluate(() => document.querySelector('.topbar').getBoundingClientRect().top);
check('Kopfzeile klebt weiterhin oben', Math.abs(kopf) <= 1);
await page.evaluate(() => window.scrollTo(0, 0));

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
