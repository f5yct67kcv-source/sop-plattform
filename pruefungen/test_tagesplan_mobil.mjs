// Tagesplan und Kopfzeile auf dem Handy (ENT-068).
//
// Vier Beanstandungen des Projektinhabers an denselben Bildschirmen wie in
// ENT-067: der Tagesplan-Reiter soll ganz links stehen, die Kopfzeile wirkte
// zusammengequetscht, das Datumsfeld ist ueberfluessig (der Tageskopf zeigt
// das Datum ohnehin), und der CTA-Knopf war zugleich zu breit und zu duenn.
// Gemessen wird der gerenderte Zustand, nicht der Quelltext.
import { WURZEL, HIER, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { readFileSync } from 'fs';


const URL = `file://${WURZEL}/dashboard.html`;
const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const EINSATZ = { id: 1, kunde_id: 1, kunde_name: 'Muster AG', titel: '', ort: 'Musterstadt', strasse: 'Musterweg 1',
  datum: '2026-08-21', von: '05:15', bis: '05:30', bedarf: 1, mitarbeiter: [], status: 'geplant', sparte: 'sicherheit' };

const browser = await chromium.launch({ executablePath: EXE });

async function seite(w, h) {
  const p = await browser.newPage({ viewport: { width: w, height: h } });
  p.setDefaultTimeout(5000);
  await p.route('**/api/**', r => {
    const pf = r.request().url().split('/api/')[1].split('?')[0];
    const send = b => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (pf.includes('login')) return send({ status: 'ok', token: 't', name: 'adrian', ist_admin: true });
    if (pf.includes('einsatz_list')) return send({ status: 'ok', einsaetze: [EINSATZ] });
    if (pf.includes('kunden_list')) return send({ status: 'ok', kunden: [] });
    if (pf.includes('mitarbeiter_list')) return send({ status: 'ok', mitarbeiter: [] });
    if (pf.includes('objekt_list')) return send({ status: 'ok', objekte: [] });
    if (pf.includes('anstellungsorte')) return send({ status: 'ok', orte: [] });
    if (pf.includes('feiertag')) return send({ status: 'ok', kanton: 'SO', feiertage: [], gepflegt: {} });
    return send({ status: 'ok', kpi: {}, verlauf: [], angemeldet: [], pro_mitarbeiter: [],
      letzte_rapporte: [], rapporte: [], objekte: [], masterschichten: [], einsaetze: [EINSATZ] });
  });
  await p.goto(URL);
  await p.fill('#gName', 'adrian'); await p.fill('#gPass', 'x'); await p.click('#gBtn');
  await p.waitForSelector('#shell.on'); await p.waitForTimeout(600);
  return p;
}

// ══════════════════════════════════════════ HANDY
const m = await seite(390, 844);
const jsFehler = [];
m.on('pageerror', e => jsFehler.push(e.message));

await m.evaluate(() => go('planung'));
await m.waitForTimeout(500);
await m.evaluate(() => { $('tgD').value = '2026-08-21'; goTab('tag'); });
await m.waitForTimeout(500);

// ── 1) Tagesplan ganz links
const reiter = await m.evaluate(() => [...document.querySelectorAll('.tabs .tab')]
  .filter(b => b.getClientRects().length)
  .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)
  .map(b => b.textContent.trim()));
check('KRITISCH: Tagesplan steht mobil ganz links', reiter[0] === 'Tagesplan');
// Objektplanung ist mobil seit ENT-165 durch Rapporte ersetzt: eine
// 31-Spalten-Matrix ist dort ohnehin nur als Tagesliste nutzbar (ENT-024),
// unterwegs wird eher auf Rapporte zugegriffen. Andere Wege zur
// Objektplanung (Objektname anklicken, Kurzwahl, Diktat) bleiben bestehen --
// nur der Reiter selbst verschwindet auf schmalen Schirmen (siehe unten).
check('Einsätze und Rapporte folgen dahinter', reiter[1] === 'Einsätze' && reiter[2] === 'Rapporte');
check('KRITISCH: der Reiter fuehrt weiterhin zur richtigen Ansicht',
  await m.evaluate(() => document.getElementById('pv-tag').classList.contains('on')));
check('KRITISCH: "Objektplanung" ist auf dem Handy kein Reiter mehr, nicht nur umsortiert',
  !reiter.includes('Objektplanung'));

// ── 2) Kopfzeile dominanter, mehr Luft
const kopf = await m.evaluate(() => {
  const h1 = document.querySelector('.topbar h1'), cr = document.querySelector('.topbar .crumb');
  const tb = document.querySelector('.topbar').getBoundingClientRect();
  const h1r = h1.getBoundingClientRect(), crr = cr.getBoundingClientRect();
  return {
    h1Size: parseFloat(getComputedStyle(h1).fontSize),
    crSize: parseFloat(getComputedStyle(cr).fontSize),
    ueberlauf: h1r.top < tb.top - 0.5 || crr.bottom > tb.bottom + 0.5,
  };
});
check('KRITISCH: die Titelschrift ist deutlich groesser als vorher (16 px)', kopf.h1Size >= 18);
check('Die Unterzeile ist mitgewachsen', kopf.crSize > 12);
check('KRITISCH: der Text passt weiterhin in die Kopfzeile, ohne beschnitten zu werden', !kopf.ueberlauf);

const luft = await m.evaluate(() => ({
  tabs: parseFloat(getComputedStyle(document.querySelector('.tabs')).marginBottom),
  barTools: parseFloat(getComputedStyle(document.querySelector('#pv-tag .bar-tools')).marginBottom),
  content: parseFloat(getComputedStyle(document.querySelector('.content')).paddingTop),
}));
check('Mehr Abstand unter der Reiterleiste (vorher 18px)', luft.tabs > 18);
check('Mehr Abstand unter der Werkzeugleiste (vorher 16px)', luft.barTools > 16);
check('Mehr Abstand am Seitenkopf (vorher 18px)', luft.content > 18);

// ── 3) Datumsfeld weg, Tageskopf an seiner Stelle
const struktur = await m.evaluate(() => {
  const tgd = document.getElementById('tgD');
  const bar = document.querySelector('#pv-tag > .bar-tools').getBoundingClientRect();
  const kopf = document.getElementById('tgKopf').getBoundingClientRect();
  const body = document.getElementById('tgBody').getBoundingClientRect();
  return {
    tgdVersteckt: getComputedStyle(tgd).display === 'none',
    tgdFunktioniertTrotzdem: tgd.value === '2026-08-21',
    kopfVorBar: kopf.top < bar.top,
    barVorListe: bar.top < body.top,
  };
});
check('KRITISCH: das Datumsfeld ist auf dem Handy nicht mehr zu sehen', struktur.tgdVersteckt);
check('KRITISCH: es traegt trotzdem weiterhin den Zustand (Vor/Zurueck funktionieren)',
  struktur.tgdFunktioniertTrotzdem);
check('KRITISCH: der Tageskopf steht an der Stelle des frueheren Datumsfelds, vor der Werkzeugleiste',
  struktur.kopfVorBar);
check('KRITISCH: die Werkzeugleiste (Vor/Zurueck) bleibt vor der Einsatzliste -- '
  + 'nicht die ganze Liste nach oben gezogen, sonst waere "Folgetag" erst nach dem Scrollen erreichbar',
  struktur.barVorListe);

// Trotzdem weiterhin blaetterbar ueber die Knoepfe
await m.click('#pv-tag button:has-text("Folgetag")');
await m.waitForTimeout(300);
check('Folgetag funktioniert weiterhin ohne das Datumsfeld',
  (await m.inputValue('#tgD')) === '2026-08-22');
await m.click('#pv-tag button:has-text("Heute")');
await m.waitForTimeout(200);

// Der Tageskopf zeigt weiterhin das Datum -- er ersetzt das entfernte Feld
// inhaltlich, nicht nur optisch.
await m.evaluate(() => { $('tgD').value = '2026-08-21'; renderTagesplan(); });
await m.waitForTimeout(300);
check('KRITISCH: der Tageskopf zeigt das Datum, das vorher im Feld stand',
  (await m.textContent('#tgKopf')).includes('21.08.2026'));

// ── 4) CTA-Knopf: nicht mehr ueber die volle Breite, dafuer hoeher
const cta = await m.evaluate(() => {
  const btn = document.querySelector('#pv-tag .bar-tools .btn-primary');
  const bar = document.querySelector('#pv-tag .bar-tools').getBoundingClientRect();
  const r = btn.getBoundingClientRect();
  return { breite: r.width, barBreite: bar.width, hoehe: r.height,
    zentriert: Math.abs((r.left - bar.left) - (bar.right - r.right)) < 6 };
});
check('KRITISCH: der Knopf spannt sich nicht mehr ueber die volle Zeile', cta.breite < cta.barBreite * 0.8);
check('KRITISCH: er ist trotzdem breit genug, um nicht winzig zu wirken', cta.breite > 120);
check('KRITISCH: er ist hoeher als der Standardknopf (vorher rund 34px)', cta.hoehe >= 44);
check('Er steht mittig in seiner Zeile', cta.zentriert);

// ── Der Tageskopf selbst ist mobil groesser (er traegt jetzt die Ueberschrift)
const tgSchrift = await m.evaluate(() => ({
  datum: parseFloat(getComputedStyle(document.querySelector('#pv-tag .tg-datum')).fontSize),
  zahl: parseFloat(getComputedStyle(document.querySelector('#pv-tag .tg-zahl')).fontSize),
}));
check('Das Datum im Tageskopf ist groesser als am Desktop (20px)', tgSchrift.datum > 20);
check('Die Einsatzzahl ebenso', tgSchrift.zahl > 20);

// ── 5) Die Arbeitsteilung, die das entfernte Datumsfeld traegt
//
// Der Projektinhaber am 2026-08-21: "darum heisst es ja Tagesplan :) Bei
// mehrtaegigen Ansichten ist der Einsaetze Abschnitt der richtige."
//
// Das ist der Grund, warum das Datumsfeld im Tagesplan wegfallen DARF: nicht
// weil man es nicht braucht, sondern weil der freie Zeitraum woanders steht.
// Diese Pruefungen sind der Wachhund dazu. Wuerde jemand spaeter die
// Datumsfelder in "Einsaetze" mit derselben Begruendung mobil ausblenden
// ("ist ja vorbelegt"), waere der freie Sprung auf ein Datum auf dem Handy
// ploetzlich NIRGENDS mehr moeglich -- und niemandem faellt es auf, weil
// beide Aenderungen fuer sich genommen vernuenftig aussehen.
await m.evaluate(() => goTab('einsaetze'));
await m.waitForTimeout(500);

const zeitraum = await m.evaluate(() => {
  const sicht = el => {
    if (!el) { return false; }
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && el.getClientRects().length > 0;
  };
  const von = document.getElementById('pVon'), bis = document.getElementById('pBis');
  const schnell = document.getElementById('pSchnell');
  return {
    von: sicht(von), bis: sicht(bis), schnell: sicht(schnell),
    vonBreite: von ? von.getBoundingClientRect().width : 0,
    optionen: schnell ? [...schnell.options].map(o => o.textContent.trim()) : [],
  };
});
check('KRITISCH: der freie Zeitraum lebt mobil in "Einsätze" -- Von-Feld sichtbar', zeitraum.von);
check('KRITISCH: ... und das Bis-Feld ebenso', zeitraum.bis);
check('Die Felder sind breit genug zum Bedienen', zeitraum.vonBreite > 100);
check('Die Schnellwahl fuer Zeitraeume steht daneben', zeitraum.schnell);
check('Sie deckt mehrtaegige Zeitraeume ab',
  zeitraum.optionen.some(o => /Woche/.test(o)) && zeitraum.optionen.some(o => /Monat/.test(o)));

// Und der Sprung muss tatsaechlich funktionieren, nicht nur dastehen.
//
// Bewusst mit try/catch: Ist das Feld verborgen, laeuft fill() in einen
// Zeitfehler und riss bisher die ganze Suite ab. Ein abgestuerzter Test sagt
// weniger als ein fehlgeschlagener -- er nennt nicht, WAS kaputt ist, und
// verschluckt alle Pruefungen dahinter.
let sprungGelungen = false;
try {
  await m.fill('#pVon', '2026-12-01', { timeout: 2000 });
  await m.fill('#pBis', '2026-12-31', { timeout: 2000 });
  await m.waitForTimeout(300);
  sprungGelungen = (await m.inputValue('#pVon')) === '2026-12-01'
    && (await m.inputValue('#pBis')) === '2026-12-31';
} catch { sprungGelungen = false; }
check('KRITISCH: ein freier Sprung auf einen beliebigen Zeitraum ist mobil moeglich',
  sprungGelungen);

await m.evaluate(() => goTab('tag'));
await m.waitForTimeout(400);

await m.screenshot({ path: `${OUT}/tgm-01-handy.png` });

// ── Der neue "Rapporte"-Reiter fuehrt tatsaechlich zur bereits bestehenden,
// global gepflegten Rapporte-Ansicht (ENT-165). Zuletzt in diesem Abschnitt,
// weil der Klick aus der Planung heraus navigiert -- alles danach wuerde
// sonst faelschlich annehmen, weiterhin im Tagesplan zu sein.
await m.click('#ptab-rapporte');
await m.waitForTimeout(400);
check('KRITISCH: "Rapporte" springt in die bereits bestehende, global gepflegte Rapporte-Ansicht',
  await m.evaluate(() => document.getElementById('view-kunden').classList.contains('on')
    && document.getElementById('kv-rapporte').classList.contains('on')));

check('KRITISCH: keine JavaScript-Fehler', jsFehler.length === 0);
await m.close();

// ══════════════════════════════════════════ DESKTOP BLEIBT UNVERAENDERT
const d = await seite(1440, 900);
await d.evaluate(() => go('planung'));
await d.waitForTimeout(500);
await d.evaluate(() => { $('tgD').value = '2026-08-21'; goTab('tag'); });
await d.waitForTimeout(500);

// Die Reiter stehen seit ENT-233 auf dem Desktop in der Kopfzeile
// (navg-planung .nav-kind), nicht mehr im Seiteninhalt (.tabs .tab, das
// gibt es fuer Uebersicht/Objektplanung dort gar nicht mehr) -- die
// mobile Reihenfolge (#ptab-tag { order: -1 }) betrifft eine andere,
// eigene Elementgruppe und kann hier gar nicht mehr hineinwirken.
const reiterD = await d.evaluate(() => [...document.querySelectorAll('#navg-planung .nav-kind')]
  .filter(b => b.getClientRects().length)
  .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)
  .map(b => b.textContent.trim()));
check('Desktop: Reiterreihenfolge unveraendert (Übersicht zuerst)', reiterD[0] === 'Übersicht');
check('Desktop: Tagesplan bleibt der letzte Reiter', reiterD[reiterD.length - 1] === 'Tagesplan');

check('Desktop: die Titelschrift bleibt bei 16px',
  await d.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.topbar h1')).fontSize)) === 16);

check('KRITISCH: das Datumsfeld bleibt am Desktop sichtbar und bedienbar',
  await d.isVisible('#tgD'));
const struktD = await d.evaluate(() => {
  const bar = document.querySelector('#pv-tag > .bar-tools').getBoundingClientRect();
  const kopf = document.getElementById('tgKopf').getBoundingClientRect();
  const body = document.getElementById('tgBody').getBoundingClientRect();
  return { barVorKopf: bar.top < kopf.top, kopfVorListe: kopf.top < body.top };
});
check('Desktop: Reihenfolge bleibt Werkzeugleiste -> Tageskopf -> Liste, wie zuvor',
  struktD.barVorKopf && struktD.kopfVorListe);

const ctaD = await d.evaluate(() => {
  const btn = document.querySelector('#pv-tag .bar-tools .btn-primary');
  const bar = document.querySelector('#pv-tag .bar-tools').getBoundingClientRect();
  return btn.getBoundingClientRect().width < bar.width * 0.5;
});
check('Desktop: der CTA-Knopf bleibt kompakt, wie er es schon war', ctaD);

await d.screenshot({ path: `${OUT}/tgm-02-desktop.png` });
await d.close();

// ══════════════════════════════════════════ QUELLTEXT
const dash = readFileSync(`${WURZEL}/dashboard.html`, 'utf8');
check('Der Tageskopf ist ein eigenes Element, kein Teil von #tgBody',
  /id="tgKopf"/.test(dash));
check('KRITISCH: keine zweite Kopie der Zonenregel oder aehnlicher Fachlogik noetig -- '
  + 'reine Darstellungsaenderung', !/function\s+renderTagesplanMobil/.test(dash));

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
