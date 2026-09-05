// Schlanke Mobilansicht (ENT-057).
//
// Der Kern dieser Reihe ist eine MESSUNG, keine Behauptung: In den drei
// mobilen Ansichten darf kein Element breiter sein als das Fenster. Vorher
// war die Abgleich-Tabelle 1062 px breit bei 390 px Fensterbreite -- man sah
// ein Drittel einer Zeile und schob den Rest von Hand nach.
import { WURZEL, HIER, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { readFileSync } from 'fs';


const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const H = iso(new Date());
const A = { id: 1, name: 'a', vorname: 'Anna', nachname: 'Muster', zusage: 'ja' };

const mock = page => page.route('**/api/**', r => {
  const u = r.request().url();
  const send = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) });
  if (u.includes('login')) return send({ status: 'ok', token: 't', name: 'adrian', ist_admin: true });
  if (u.includes('mitarbeiter_list')) return send({ status: 'ok', mitarbeiter: [
    { id: 1, name: 'a', ist_admin: 1, vorname: 'Anna', nachname: 'Muster', personalnummer: '1' }]});
  if (u.includes('objekt_list')) return send({ status: 'ok', objekte: [
    { id: 1, kunde_id: 1, kunde_name: 'Beispiel AG', name: 'Objekt Eins', strasse: 'Weg 1', plz: '4600',
      ort: 'Ort', kanton: 'SO', einsatzart: 'Revierdienst', aktiv: 1, masterschichten: 1,
      stunden_je_einsatz: 0.5, distanzen: {} }]});
  if (u.includes('einsatz_list')) return send({ status: 'ok', einsaetze: [
    { id: 1, kunde_name: 'Beispiel AG', objekt_id: 1, titel: 'Schliessrunde', strasse: 'Weg 1', ort: 'Ort',
      einsatzart: 'Revierdienst', datum: H, von: '22:00:00', bis: '22:30:00', bedarf: 2, status: 'geplant',
      mitarbeiter: [A] },
    { id: 2, kunde_name: 'Muster GmbH', objekt_id: null, titel: 'Baustelle mit sehr langem Namen zum Testen',
      strasse: 'Sehr lange Gassenbezeichnung 99', ort: 'Anderswo', einsatzart: 'Verkehrsdienst', datum: H,
      von: '07:00:00', bis: '16:00:00', bedarf: 1, status: 'bestaetigt', mitarbeiter: [A], ist_status: 'offen' }]});
  return send({ status: 'ok', kpi: { rapporte_monat: 3, stunden_monat: 12, mitarbeiter: 1, kunden: 1 },
    verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [], rapporte: [], kunden: [],
    feiertage: [], gepflegt: {}, orte: [] });
});

const anmelden = async page => {
  await page.goto(`file://${WURZEL}/dashboard.html`);
  await page.fill('#gName', 'a'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
  await page.waitForSelector('#shell.on'); await page.waitForTimeout(800);
};

const browser = await chromium.launch({ executablePath: EXE });

// ══════════════ HANDY: 390 px
const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
m.setDefaultTimeout(5000);
await mock(m); await anmelden(m);

const menue = await m.evaluate(() => [...document.querySelectorAll('.side-nav .nav-item')]
  .filter(e => e.getClientRects().length)
  .map(e => (e.querySelector('.lbl') || e).textContent.trim()));
// Seit ENT-399 kommt "Kunden" als dritter Hauptpunkt dazu (Anruf-Szenario:
// Rapport/Offerte werden unterwegs gebraucht) -- gleiches Muster wie
// "Planung", siehe die Pruefungen weiter unten zu dessen Aufklapp-Kindern.
check('Mobil bleiben genau drei Menuepunkte', menue.length === 3);
check('Uebersicht bleibt', menue.includes('Übersicht'));
check('Planung bleibt', menue.includes('Planung'));
check('KRITISCH: Abgleich ist mobil aus dem Menü ausgeblendet (ENT-235) -- die Seite selbst und ihre gezielten Einstiege (z.B. "Zum Abgleich" beim Aufheben einer Sperre) bleiben erreichbar', !menue.includes('Abgleich'));
check('KRITISCH: Kunden ist seit ENT-399 mobil im Menü da (Adressen/Objekte/Rapporte/Offerten -- Rechnungen bleibt aussen vor)', menue.includes('Kunden'));
check('KRITISCH: die Administration ist mobil ausgeblendet', !menue.includes('Administration'));
check('Die Einrichtung ist mobil ausgeblendet',
  await m.evaluate(() => !document.getElementById('nav-einrichtung').getClientRects().length));

// Der erklaerende Kasten aus ENT-057 ist mit ENT-067 entfernt -- der
// Projektinhaber wollte den Platz fuer die Navigation.
//
// Damit faellt bewusst weg, was ENT-057 leisten sollte: dass niemand die
// ausgeblendeten Bereiche fuer kaputt haelt. Der Einwand ist im
// Entscheidungsprotokoll als Risiko festgehalten, nicht stillschweigend
// verschwunden. Was bleibt, ist die Zusicherung, dass die Bereiche am
// Desktop tatsaechlich alle da sind -- weiter unten in dieser Datei geprueft.
check('KRITISCH: der Desktop-Hinweis ist entfernt',
  await m.evaluate(() => !document.querySelector('.mobil-hinweis')
    && !/am Desktop gepflegt/.test(document.getElementById('side').textContent)));

// Die eigentliche Messung.
const zuBreit = async () => m.evaluate(() => {
  const schuld = [];
  document.querySelectorAll('.view.on *').forEach(e => {
    const b = e.getBoundingClientRect();
    if (b.width > innerWidth + 1) {
      schuld.push((e.tagName + (e.id ? '#' + e.id : '')) + '=' + Math.round(b.width));
    }
  });
  const doc = document.documentElement;
  return { schuld: [...new Set(schuld)].slice(0, 4), seite: doc.scrollWidth - doc.clientWidth };
});

for (const [v, name] of [['uebersicht', 'Übersicht'], ['planung', 'Planung'], ['abgleich', 'Abgleich']]) {
  await m.evaluate(x => go(x), v);
  await m.waitForTimeout(700);
  const r = await zuBreit();
  check(`KRITISCH: ${name} hat bei 390 px kein Element breiter als das Fenster` +
    (r.schuld.length ? ' — ' + r.schuld.join(', ') : ''), r.schuld.length === 0);
  check(`${name} scrollt die Seite nicht seitwaerts`, r.seite <= 1);
}

// Planung oeffnet mobil den Tagesplan statt der Monatsmatrix.
await m.evaluate(() => go('planung'));
await m.waitForTimeout(700);
check('Der Matrix-Reiter ist mobil gar nicht erst da (ENT-233: existiert nur noch als Kopfzeilen-Eintrag auf dem Desktop)',
  await m.evaluate(() => !document.getElementById('ptab-uebersicht')));
// Seit ENT-058 traegt die Einsatzliste die Kartenoptik und den
// Herkunftsfilter -- sie ist die mobile Startseite, nicht mehr der Tagesplan.
check('KRITISCH: ein direkter Aufruf der Matrix landet mobil in der Einsatzliste',
  await m.evaluate(() => { goTab('uebersicht'); return document.getElementById('pv-einsaetze').classList.contains('on'); }));
// Der Tagesplan bleibt ueber seinen Reiter erreichbar und dort mobiltauglich.
await m.evaluate(() => goTab('tag'));
await m.waitForTimeout(600);
check('Der schnelle Weg zum Einsatz ist im Tagesplan da',
  await m.evaluate(() => [...document.querySelectorAll('#pv-tag button')]
    .some(b => /Neuer Einsatz/.test(b.textContent) && b.getClientRects().length)));
check('Der Tagesplan zeigt Karten statt einer Tabelle',
  await m.evaluate(() => !!document.querySelector('#tgBody .nur-schmal .ag-karte')));
check('Die Karte fuehrt an dieselbe Stelle wie die Tabellenzeile',
  await m.evaluate(() => /openEinsatz/.test(document.querySelector('#tgBody .ag-karte').getAttribute('onclick'))));

// ══════════════ EINSATZLISTE ALS MOBILE STARTSEITE (ENT-058)
// Frisches Betreten nachstellen: von woanders kommen, mit der Monatsmatrix
// als gemerktem Reiter -- so wie es beim ersten Aufruf tatsaechlich ist.
await m.evaluate(() => { go('uebersicht'); pTab = 'uebersicht'; go('planung'); });
await m.waitForTimeout(800);
check('KRITISCH: mobil oeffnet die Planung neu die Einsatzliste',
  await m.evaluate(() => document.getElementById('pv-einsaetze').classList.contains('on')));
check('Die Einsatzliste zeigt mobil Karten', await m.evaluate(() => !!document.querySelector('#plTable .nur-schmal .ag-karte')));
check('Die Tabelle ist mobil ausgeblendet',
  await m.evaluate(() => !document.querySelector('#plTable table')?.getClientRects().length));
check('Die Tagesueberschrift bleibt erhalten', await m.evaluate(() => !!document.querySelector('#plTable .pk-tag')));
check('Die Karte fuehrt in den Einsatz',
  await m.evaluate(() => /openEinsatz/.test(document.querySelector('#plTable .ag-karte').getAttribute('onclick'))));
check('Der Herkunftsfilter ist auch mobil da', await m.isVisible('#pHerkunft'));

// Von den vier Kacheln bleibt mobil genau eine.
const kpis = await m.evaluate(() => [...document.querySelectorAll('#plKpi .kpi')]
  .filter(e => e.getClientRects().length).map(e => e.textContent.replace(/\s+/g, ' ').trim()));
check('KRITISCH: mobil bleibt genau eine Kachel', kpis.length === 1);
check('Und zwar die offenen Schichten', /Offene Schichten/i.test(kpis[0] || ''));
check('KRITISCH: die alte Benennung "Offene Stellen" ist weg',
  !/Offene Stellen/i.test(await m.content()));
check('Auch die Kopfzeile spricht von Schichten',
  !/offene Stelle/i.test(await m.textContent('#pgCrumb')));

// Abgleich: Karten, und ausdruecklich LESEND.
await m.evaluate(() => go('abgleich'));
await m.waitForTimeout(900);
check('Der Abgleich zeigt Karten', await m.evaluate(() => !!document.querySelector('#agTable .nur-schmal .ag-karte')));
check('KRITISCH: die Abgleich-Karten haben keine Eingabefelder',
  await m.evaluate(() => document.querySelectorAll('#agTable .nur-schmal input, #agTable .nur-schmal select').length === 0));
check('Sie sagen, wo abgeglichen wird',
  (await m.textContent('#agTable')).includes('Abgleichen am Desktop'));
check('Sie nennen Planzeit und Beteiligte',
  /Geplant/.test(await m.textContent('#agTable')) && /Anna Muster/.test(await m.textContent('#agTable')));
await m.screenshot({ path: `${OUT}/ms-mobil.png` });
// ══════════════ MENUE STATT SEITENSCHUBLADE (ENT-059)
await m.evaluate(() => go('uebersicht'));
await m.waitForTimeout(400);
const bpos = await m.evaluate(() => {
  const b = document.getElementById('btnBurger').getBoundingClientRect();
  return { links: b.left, rechtsAbstand: innerWidth - b.right, breite: innerWidth };
});
check('KRITISCH: der Burger sitzt rechts aussen',
  bpos.rechtsAbstand < 24 && bpos.links > bpos.breite / 2);
check('Der Burger meldet zunaechst "zu"',
  (await m.getAttribute('#btnBurger', 'aria-expanded')) === 'false');

await m.click('#btnBurger');
await m.waitForTimeout(400);
const menu = await m.evaluate(() => {
  const s = document.getElementById('side').getBoundingClientRect();
  const top = document.querySelector('.topbar').getBoundingClientRect();
  return { links: Math.round(s.left), breite: Math.round(s.width), oben: Math.round(s.top),
           unterKopf: s.top >= top.bottom - 1, fensterBreite: innerWidth };
});
check('KRITISCH: das Menue klappt unter der Kopfzeile auf, statt seitlich hereinzufahren',
  menu.links === 0 && menu.unterKopf);
check('Es nimmt die volle Breite', Math.abs(menu.breite - menu.fensterBreite) <= 1);
check('Der Burger meldet jetzt "offen"',
  (await m.getAttribute('#btnBurger', 'aria-expanded')) === 'true');
check('Der Markenkopf ist im Menue ausgeblendet',
  await m.evaluate(() => !document.querySelector('.side-brand').getClientRects().length));

// Hell/Dunkel liegt im Menue, nicht in der Kopfzeile.
check('KRITISCH: der Hell-Dunkel-Schalter ist mobil nicht mehr in der Kopfzeile',
  await m.evaluate(() => !document.getElementById('btnThema').getClientRects().length));
// Seit ENT-067 als Schiebeschalter oben rechts im Menuekopf (vorher eine
// Zeile in der Liste).
check('Er steht stattdessen im Menue', await m.isVisible('#btnThemaMob'));
const vorher = await m.evaluate(() => document.documentElement.getAttribute('data-thema'));
await m.click('#btnThemaMob');
await m.waitForTimeout(350);
check('Der Klick wechselt die Darstellung',
  (await m.evaluate(() => document.documentElement.getAttribute('data-thema'))) !== vorher);
check('Der Schalterzustand zieht mit',
  (await m.getAttribute('#btnThemaMob', 'aria-checked'))
  === ((await m.evaluate(() => document.documentElement.getAttribute('data-thema'))) === 'dunkel' ? 'true' : 'false'));
check('Das Menue bleibt dabei offen', await m.evaluate(() => document.getElementById('side').classList.contains('on')));
await m.click('#btnThemaMob');
await m.waitForTimeout(300);

// Danebentippen schliesst. Seit dem Vollbild (ENT-067) ist die Kopfzeile die
// einzige Flaeche ausserhalb des Menues -- weiter unten traefe der Klick
// einen Menuepunkt, im Fussbereich sogar "Abmelden".
const kopfPunkt = await m.evaluate(() => {
  const t = document.querySelector('.topbar').getBoundingClientRect();
  return { x: Math.round(t.left + t.width * 0.42), y: Math.round(t.top + t.height / 2) };
});
await m.mouse.click(kopfPunkt.x, kopfPunkt.y);
await m.waitForTimeout(400);
check('KRITISCH: ein Tipp daneben schliesst das Menue',
  await m.evaluate(() => !document.getElementById('side').classList.contains('on')));

// ══════════════ KEIN ZOOM (ENT-059)
for (const [datei, name] of [['dashboard.html', 'Cockpit'], ['app.html', 'App']]) {
  const q = readFileSync(`${WURZEL}/` + datei, 'utf8');
  const vp = (q.match(/<meta name="viewport"[^>]*>/) || [''])[0];
  check(`${name}: der Viewport verbietet das Zoomen`,
    /user-scalable=no/.test(vp) && /maximum-scale=1/.test(vp));
  check(`${name}: Doppeltippen zoomt nicht`, /touch-action:\s*manipulation/.test(q));
  check(`${name}: Eingabefelder sind auf dem Handy mindestens 16 px gross`,
    /font-size:\s*16px/.test(q));
}
check('Die App behaelt ihre Notch-Anpassung',
  /viewport-fit=cover/.test(readFileSync(`${WURZEL}/app.html`, 'utf8')));

// ══════════════ BENENNUNG BIS ZU ENDE (ENT-058)
check('KRITISCH: "Stelle/Stellen" kommt als Benennung nirgends mehr vor',
  !/Stelle offen|Stellen offen|Offene Stellen/.test(
    readFileSync(`${WURZEL}/dashboard.html`, 'utf8')));


await m.close();
// ══════════════ DESKTOP: nichts davon darf dort greifen
const d = await browser.newPage({ viewport: { width: 1440, height: 900 } });
d.setDefaultTimeout(5000);
await mock(d); await anmelden(d);
const menueD = await d.evaluate(() => [...document.querySelectorAll('.side-nav .nav-item')]
  .filter(e => e.getClientRects().length)
  .map(e => (e.querySelector('.lbl') || e).textContent.trim()));
check('KRITISCH: am Desktop bleibt alles erreichbar', menueD.length >= 5);
check('Kunden sind am Desktop da', menueD.includes('Kunden'));
check('Die Administration ist am Desktop da', menueD.includes('Administration'));
check('Den Desktop-Hinweis gibt es seit ENT-067 nirgends mehr',
  await d.evaluate(() => !document.querySelector('.mobil-hinweis')));
check('KRITISCH: am Desktop bleibt der Hell-Dunkel-Schalter in der Kopfzeile',
  await d.isVisible('#btnThema'));
check('Und liegt dort nicht doppelt im Menue',
  await d.evaluate(() => {
    const b = document.getElementById('btnThemaMob');
    return !b || !b.getClientRects().length;
  }));
check('Der Menuekopf des Handys bleibt am Desktop verborgen',
  await d.evaluate(() => {
    const k = document.querySelector('#side .side-kopf');
    return !k || getComputedStyle(k).display === 'none';
  }));
check('Der Burger ist am Desktop ausgeblendet',
  await d.evaluate(() => !document.getElementById('btnBurger').getClientRects().length));
check('Die Seitenleiste steht am Desktop fest links',
  await d.evaluate(() => {
    const s = document.getElementById('side').getBoundingClientRect();
    return s.left === 0 && s.top === 0 && s.width < innerWidth / 3;
  }));
check('Der Markenkopf ist am Desktop da', await d.isVisible('.side-brand'));
await d.evaluate(() => go('planung'));
await d.waitForTimeout(700);
check('Am Desktop bleibt die Monatsmatrix die Startseite der Planung',
  await d.evaluate(() => document.getElementById('pv-uebersicht').classList.contains('on')));
await d.evaluate(() => goTab('einsaetze'));
await d.waitForTimeout(600);
const kpisD = await d.evaluate(() => [...document.querySelectorAll('#plKpi .kpi')]
  .filter(e => e.getClientRects().length).length);
check('KRITISCH: am Desktop bleiben alle vier Kacheln', kpisD === 4);
check('Am Desktop zeigt die Einsatzliste die Tabelle',
  await d.evaluate(() => !!document.querySelector('#plTable table')?.getClientRects().length));
check('Die Karten sind am Desktop ausgeblendet',
  await d.evaluate(() => !document.querySelector('#plTable .nur-schmal')?.getClientRects().length));
await d.evaluate(() => go('abgleich'));
await d.waitForTimeout(900);
check('KRITISCH: am Desktop bleibt der Abgleich voll bedienbar',
  await d.evaluate(() => document.querySelectorAll('#agTable table input[data-ag]').length > 0));
check('Die Abgleich-Tabelle ist am Desktop sichtbar',
  await d.evaluate(() => !!document.querySelector('#agTable table.ag-tab')?.getClientRects().length));
check('Die Karten sind am Desktop ausgeblendet',
  await d.evaluate(() => !document.querySelector('#agTable .nur-schmal')?.getClientRects().length));
await d.close();

const q = readFileSync(`${WURZEL}/dashboard.html`, 'utf8');
check('Die Mobilgrenze steht an einer Stelle', (q.match(/window\.innerWidth <= 620/g) || []).length === 1);

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
