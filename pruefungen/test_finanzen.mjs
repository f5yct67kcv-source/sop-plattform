// Finanzen (ENT-712) -- Hauptreiter mit Übersicht, Rechnungen und Lohn.
//
// Was diese Suite scharf hält:
//
// 1. JEDER BLOCK AN SEINEM RECHT. Ohne 'lohn_lesen' keine Lohnzahl, ohne
//    'offerten_lesen' keine Rechnungszahl -- und an ihrer Stelle "Kein
//    Zugriff", nie eine 0. Ohne Belegrecht wird die Liste gar nicht erst
//    angefragt.
//
// 2. "NOCH OFFEN" IST NICHT VERRECHNET MINUS BEZAHLT (Nachtrag, Punkt 3).
//    Der Testmonat hat mehr Zahlungseingang als Verrechnung -- die blosse
//    Differenz wäre negativ. Gezeigt werden muss, was von den Rechnungen
//    DIESES Monats heute noch unbezahlt ist.
//
// 3. DIE GRAFIK RECHNET OHNE MWST, offene Beträge MIT (Punkt 9).
//
// 4. EIN MONAT OHNE LOHNLAUF HAT KEINEN PUNKT und heisst "noch kein
//    Lohnlauf", nicht CHF 0.
//
// 5. DIE KURVE SCHWINGT NICHT ÜBER (Punkt 1). Gemessen am gezeichneten
//    Pfad: Zwischen einem Nullmonat und einem hohen Monat darf sie nicht
//    unter die Nulllinie tauchen und nicht über den höchsten Wert hinaus.
//
// 6. EIN ENTWURF IST NICHT VERRECHNET (Entscheid 24.09.2026). Er zählt in
//    keiner Zahl der Übersicht mit, wird aber genannt.
//
// 7. RECHNUNGEN SIND UMGEZOGEN. Kein Punkt mehr unter Kunden, ein alter
//    Einstieg (kuGoTab('rechnungen')) landet unter Finanzen, und "Zurück"
//    aus einer Rechnung auch.
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const URL = `file://${WURZEL}/dashboard.html`;
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

// Kein festes Datum (test_datumsfest.mjs): alles relativ zum laufenden Monat.
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const jetzt = new Date();
const tagIm = (v, t) => iso(new Date(jetzt.getFullYear(), jetzt.getMonth() + v, t));
const monatVon = v => tagIm(v, 1).slice(0, 7);

const re = (id, datum, netto, extra) => ({
  id, art: 'rechnung', nummer: 'RE-0' + id, kunde_id: 1, kunde_name: 'Beispiel AG', titel: 'Bewachung',
  datum, faellig_bis: null, status: 'versendet', bezahlt: 0, bezahlt_am: null,
  zwischensumme_rappen: netto, rabatt_rappen: 0, mwst_rappen: Math.round(netto * 0.081),
  rundung_rappen: 0, total_rappen: Math.round(netto * 1.081), aktiv: 1, ...extra });

const RECHNUNGEN = { status: 'ok', naechste_nummer: 'RE-0999', belege: [
  // Vorvormonat: A (im Vormonat bezahlt), B (offen, überfällig).
  re(1, tagIm(-2, 5), 100000, { bezahlt: 1, bezahlt_am: tagIm(-1, 3) }),
  re(2, tagIm(-2, 5), 50000,  { faellig_bis: tagIm(-1, 5) }),
  // Vormonat: C (im selben Monat bezahlt), D (offen, OHNE Fälligkeit).
  re(3, tagIm(-1, 8), 200000, { bezahlt: 1, bezahlt_am: tagIm(-1, 20), kunde_name: 'Muster Logistik AG' }),
  re(4, tagIm(-1, 9), 30000),
  // Archiviert -- darf nirgends mitzählen.
  re(5, tagIm(-1, 9), 999999, { aktiv: 0 }),
  // Entwurf (Entscheid 24.09.2026): nicht verrechnet, nicht offen, nicht
  // überfällig -- obwohl die Frist vorbei ist. Der Betrag ist gross genug,
  // dass jedes Mitzählen sofort auffiele.
  re(6, tagIm(-1, 10), 700000, { status: 'entwurf', faellig_bis: tagIm(-1, 12), kunde_name: 'Entwurf Kunde AG' }),
]};

const KOSTEN = { status: 'ok',
  lohn: { zugriff: true, eingerichtet: true,
    // Vorvormonat mit Lauf, Vormonat OHNE.
    monate: { [monatVon(-2)]: { brutto_rappen: 500000, laeufe: 1 } },
    letzte: [{ id: 7, periode_von: tagIm(-2, 1), periode_bis: tagIm(-1, 0), status: 'freigegeben',
               brutto_rappen: 500000, personen: 3 }] },
  auslagen: { zugriff: true, eingerichtet: true,
    monate: { [monatVon(-2)]: { rappen: 12000, zeilen: 4, gesperrt: 1 } },
    offene_schichten: { [monatVon(-1)]: 5 } } };

const ALLE = ['kunden_lesen', 'offerten_lesen', 'offerten_schreiben', 'lohn_lesen', 'auslagen_lesen',
  'einsaetze_lesen', 'abgleich_lesen', 'personal_lesen'];

async function seite(browser, { rechte = ALLE, kosten, viewport = { width: 1500, height: 1100 } } = {}) {
  const page = await browser.newPage({ viewport });
  const anfragen = [];
  page.on('pageerror', e => { if (!/rapporte_monat/.test(e.message)) { bad.push('JS-Fehler: ' + e.message); } });
  await page.route('**/api/**', async route => {
    const url = route.request().url();
    anfragen.push(url);
    const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (url.includes('login.php')) return send({ status: 'ok', token: 't', name: 'adrian', ist_admin: false, rollen: [], rechte });
    if (url.includes('me.php')) return send({ status: 'ok', name: 'adrian', ist_admin: false, rollen: [], rechte });
    if (url.includes('beleg_list')) {
      const art = new URLSearchParams(url.split('?')[1] || '').get('art') || 'offerte';
      return send(art === 'rechnung' ? RECHNUNGEN : { status: 'ok', naechste_nummer: 'OF-1', belege: [] });
    }
    if (url.includes('finanzen_kosten')) {
      // Der Server entscheidet je Block (fin_kosten()); hier nachgebildet.
      const k = kosten || KOSTEN;
      return send({ ...k,
        lohn: rechte.includes('lohn_lesen') ? k.lohn : { zugriff: false },
        auslagen: rechte.includes('auslagen_lesen') ? k.auslagen : { zugriff: false } });
    }
    return send({ status: 'ok' });
  });
  await page.goto(URL);
  await page.fill('#gName', 'adrian'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
  await page.waitForSelector('#shell.on');
  await page.waitForTimeout(300);
  page.anfragen = anfragen;
  return page;
}

const kpis = page => page.evaluate(() => [...document.querySelectorAll('#finKpi .kpi')].map(k => ({
  l: k.querySelector('.kpi-top span').textContent.trim(),
  v: k.querySelector('.kpi-val').textContent.trim(),
  f: k.querySelector('.kpi-foot').textContent.trim(),
})));
async function tip(page, index) {
  await page.hover(`#finChart .fin-treffer >> nth=${index}`);
  await page.waitForTimeout(80);
  return page.evaluate(() => $('finTip').hidden ? '' : $('finTip').innerText);
}

const browser = await chromium.launch({ executablePath: browserPfad() });

// ══════════════════════════════════════════ 1. NAVIGATION
const page = await seite(browser);
try {
  check('KRITISCH: die Rubrik "Lohn" gibt es nicht mehr', !(await page.$('#navg-lohn')));
  check('Die Rubrik "Finanzen" steht', await page.isVisible('#nav-finanzen'));
  check('KRITISCH: Finanzen steht an der Stelle von Lohn -- nach Auswertung, vor Administration',
    await page.evaluate(() => {
      const g = [...document.querySelectorAll('.side-nav .nav-gruppe')].map(x => x.id);
      const i = g.indexOf('navg-finanzen');
      return i > g.indexOf('navg-kontrolle') && i < g.indexOf('navg-admin');
    }));
  check('KRITISCH: drei Unterreiter in der Reihenfolge Übersicht · Rechnungen · Lohn',
    await page.evaluate(() => [...document.querySelectorAll('#navg-finanzen .nav-kind')]
      .map(b => b.textContent.trim()).join('|') === 'Übersicht|Rechnungen|Lohn'));
  check('KRITISCH: unter Kunden steht kein Punkt "Rechnungen" mehr',
    await page.evaluate(() => ![...document.querySelectorAll('#navg-kunden .nav-kind')]
      .some(b => /Rechnungen/.test(b.textContent))));
  check('Der Reiter heisst "Finanzen", nicht "Buchhaltung"',
    (await page.textContent('#nav-finanzen .lbl')).trim() === 'Finanzen'
    && !/Buchhaltung/.test(await page.textContent('.side-nav')));

  await page.click('#nav-finanzen');
  await page.waitForTimeout(500);
  check('KRITISCH: ein Klick auf "Finanzen" landet auf der Übersicht',
    await page.evaluate(() => $('view-finanzen').classList.contains('on')));
  check('Die Übersicht ist im Menü markiert',
    await page.evaluate(() => $('nav-finanzen-uebersicht').classList.contains('on')));
} catch (e) { bad.push('Navigation: ' + String(e).split('\n')[0].slice(0, 160)); }

// ══════════════════════════════════════════ 2. KENNZAHLEN
try {
  const k = await kpis(page);
  check('Vier Kennzahlen', k.length === 4);
  // B 54'050 + D 32'430 = 86'480 Rappen, inkl. MWST, archivierte nicht.
  check('KRITISCH: offener Betrag CHF 864.80 inkl. MWST (archivierte zählt nicht)',
    /864\.80/.test(k[0].v) && /inkl\. MWST/.test(k[0].f));
  check('KRITISCH: überfällig nur B (CHF 540.50) -- D ohne Fälligkeit zählt NICHT',
    /540\.50/.test(k[1].v));
  check('GEGENPROBE: überfällig ist nicht B+D', !/864\.80/.test(k[1].v));
  check('KRITISCH: der Entwurf zählt nicht im offenen Betrag und wird genannt',
    !/8['’]4\d\d\.\d\d/.test(k[0].v) && /1 Entwurf nicht mitgezählt/.test(k[0].f));
  check('KRITISCH: Lohnkosten zeigen den letzten Monat MIT Lauf (Vorvormonat), CHF 5\'000.00',
    /5['’]000\.00/.test(k[3].v));
  check('KRITISCH: Lohnkosten sagen "ohne Arbeitgeberbeiträge"', /ohne Arbeitgeberbeiträge/.test(k[3].f));
  check('KRITISCH: Vormonat ohne Lauf heisst "noch kein Lohnlauf", nicht 0',
    /Vormonat: noch kein Lohnlauf/.test(k[3].f));

  // Gemessen: Beschriftung über dem Wert, gleiche Wertgrösse in allen Kacheln.
  const mass = await page.evaluate(() => [...document.querySelectorAll('#finKpi .kpi')].map(k => ({
    l: k.querySelector('.kpi-top').getBoundingClientRect().top,
    v: k.querySelector('.kpi-val').getBoundingClientRect().top,
    fs: getComputedStyle(k.querySelector('.kpi-val')).fontSize,
    dh: k.querySelector('.kpi-foot .delta') ? k.querySelector('.kpi-foot .delta').getBoundingClientRect().height : 0,
  })));
  check('Beschriftung steht über dem Wert (gemessen)', mass.every(m => m.l < m.v));
  check('Alle vier Werte in derselben Schriftgrösse (gemessen)', new Set(mass.map(m => m.fs)).size === 1);
  check('Vergleichspille bricht nicht um (gemessen: eine Zeile)', mass.every(m => m.dh === 0 || m.dh < 24));
} catch (e) { bad.push('Kennzahlen: ' + String(e).split('\n')[0].slice(0, 160)); }

// ══════════════════════════════════════════ 3. GRAFIK UND TOOLTIP
try {
  check('12 Monate im Standard', await page.$$eval('#finChart .fin-treffer', r => r.length) === 12);
  check('Der Umschalter steht auf 12 M',
    await page.evaluate(() => document.querySelector('#finZeitraum button.on').dataset.zr === '12'));
  check('Die Grafik sagt "exkl. MWST"', /exkl\. MWST/.test(await page.textContent('#finChartUnter')));
  check('KRITISCH: die Grafik nennt den nicht mitgezählten Entwurf',
    /1 Entwurf nicht mitgezählt/.test(await page.textContent('#finChartUnter')));

  const vm = await tip(page, 10); // Vormonat
  // verrechnet C+D netto = 2'300.00; bezahlt A+C = 3'000.00; offen D = 300.00
  check('KRITISCH: verrechnet im Vormonat CHF 2\'300.00 -- netto, ohne MWST',
    /verrechnet\s*CHF 2['’]300\.00/.test(vm));
  check('GEGENPROBE: nicht das Total mit MWST (2\'486.30)', !/2['’]486\.30/.test(vm));
  check('KRITISCH: der Entwurf zählt nicht als verrechnet (sonst 9\'300.00)', !/9['’]300\.00/.test(vm));
  check('KRITISCH: bezahlt nach Zahldatum CHF 3\'000.00 (A aus dem Vorvormonat zählt hier)',
    /bezahlt\s*CHF 3['’]000\.00/.test(vm));
  check('KRITISCH: "davon heute noch offen" CHF 300.00 -- die Rechnungen DIESES Monats',
    /davon heute noch offen\s*CHF 300\.00/.test(vm));
  check('GEGENPROBE: nicht verrechnet minus bezahlt (−700.00)', !/-\s*700|−\s*700/.test(vm));
  check('KRITISCH: Monat ohne Lauf -> "noch kein Lohnlauf" im Tooltip', /noch kein Lohnlauf/.test(vm));
  check('Nicht abgeglichene Schichten werden genannt', /5 Schichten noch nicht abgeglichen/.test(vm));

  const vvm = await tip(page, 9); // Vorvormonat
  check('Lohnkosten im Vorvormonat = Bruttolohn + Auslagenersatz (CHF 5\'120.00)',
    /Lohnkosten\s*CHF 5['’]120\.00/.test(vvm) && /Bruttolohn\s*CHF 5['’]000\.00/.test(vvm)
    && /Auslagenersatz\s*CHF 120\.00/.test(vvm));
  check('Gesperrte Auslagen werden genannt, nicht verschwiegen', /1 Auslagen ohne Betrag/.test(vvm));

  const punkte = await page.$$eval('#finChart .fin-l-lohn-pkt', p => p.length);
  check('KRITISCH: nur EIN Lohnpunkt -- Monate ohne Lauf haben keinen', punkte === 1);

  // Monotonie gemessen am gezeichneten Pfad: nicht unter null, nicht über max.
  const kurve = await page.evaluate(() => {
    const pfad = document.querySelector('#finChart path.fin-l-verrechnet:not(.gestrichelt)');
    const nullY = Math.max(...[...document.querySelectorAll('#finChart .fin-gitter.null')].map(l => Number(l.getAttribute('y1'))));
    const pkte = [...document.querySelectorAll('#finChart .fin-l-verrechnet-pkt')].map(c => Number(c.getAttribute('cy')));
    const L = pfad.getTotalLength();
    let maxY = -1e9, minY = 1e9;
    for (let i = 0; i <= 400; i++) { const p = pfad.getPointAtLength(L * i / 400); maxY = Math.max(maxY, p.y); minY = Math.min(minY, p.y); }
    return { nullY, maxY, minY, oben: Math.min(...pkte) };
  });
  check('KRITISCH: die Kurve taucht nicht unter die Nulllinie (monoton, gemessen)', kurve.maxY <= kurve.nullY + 0.5);
  check('KRITISCH: die Kurve schiesst nicht über den höchsten Monatswert (gemessen)', kurve.minY >= kurve.oben - 0.5);

  check('Der laufende Monat ist markiert', await page.$eval('#finChart .fin-laufend-lbl', e => e.textContent) === 'laufend');
  check('Das Stück zum laufenden Monat ist gestrichelt (gemessen)',
    await page.$eval('#finChart path.fin-l-verrechnet.gestrichelt', e => getComputedStyle(e).strokeDasharray !== 'none'));

  // Farben greifen wirklich: Lohnlinie anders als "verrechnet".
  const farben = await page.evaluate(() => ({
    v: getComputedStyle(document.querySelector('#finChart .fin-l-verrechnet')).stroke,
    l: getComputedStyle(document.querySelector('#finChart .fin-l-lohn-pkt')).stroke,
  }));
  check('Lohnlinie trägt gemessen eine andere Farbe als "verrechnet"', farben.v && farben.l && farben.v !== farben.l);

  await page.click('.fin-leg-knopf');
  await page.waitForTimeout(100);
  check('Die Lohnlinie lässt sich über die Legende ausblenden',
    await page.$$eval('#finChart .fin-l-lohn-pkt', p => p.length) === 0);
  await page.click('.fin-leg-knopf');

  await page.click('#finZeitraum button[data-zr="6"]');
  await page.waitForTimeout(400);
  check('6 M zeigt sechs Monate', await page.$$eval('#finChart .fin-treffer', r => r.length) === 6);
  await page.click('#finZeitraum button[data-zr="jahr"]');
  await page.waitForTimeout(400);
  check('Jahr zeigt Januar bis zum laufenden Monat',
    await page.$$eval('#finChart .fin-treffer', r => r.length) === jetzt.getMonth() + 1);
  check('Der Zeitraum steht in der Unterzeile der Kundenkarte',
    /Jahr \d{4}/.test(await page.textContent('#finKundenUnter')));
  await page.click('#finZeitraum button[data-zr="12"]');
  await page.waitForTimeout(400);
} catch (e) { bad.push('Grafik: ' + String(e).split('\n')[0].slice(0, 160)); }

// ══════════════════════════════════════════ 4. BLÖCKE
try {
  const status = await page.$$eval('#finStatus .fin-zeile .fin-name', z => z.map(x => x.textContent.trim()));
  check('KRITISCH: kein "Teilweise bezahlt" -- Teilzahlungen gibt es nicht', !status.some(s => /Teilweise/i.test(s)));
  check('KRITISCH: eine offene Rechnung ohne Fälligkeit bekommt ihre eigene Zeile',
    status.includes('Offen, ohne Fälligkeit'));
  const kunden = await page.$$eval('#finKunden .fin-zeile .fin-name', z => z.map(x => x.textContent.trim()));
  check('Einnahmen nach Kunden: grösster zuerst', kunden[0] === 'Muster Logistik AG');
  check('KRITISCH: der Entwurf fehlt bei den Kunden', !kunden.includes('Entwurf Kunde AG'));
  const anzahl = await page.$$eval('#finStatus .fin-zeile b', z => z.map(x => Number(x.textContent)));
  check('KRITISCH: Rechnungsstatus zählt vier Rechnungen -- ohne Entwurf und Archiv',
    anzahl.reduce((a, b) => a + b, 0) === 4);
  check('KRITISCH: der Entwurf steht nicht in der Mahnliste, obwohl seine Frist vorbei ist',
    !/RE-06/.test(await page.textContent('#finMahn')));
  check('Altersbänder stehen unter Finanzen', await page.$$eval('#finAlter .bar', b => b.length) === 5);
  check('Die Mahnliste führt B', /RE-02/.test(await page.textContent('#finMahn')));
  check('Letzte Lohnläufe: ein Lauf mit Status', /Freigegeben/.test(await page.textContent('#finLaeufe')));
} catch (e) { bad.push('Blöcke: ' + String(e).split('\n')[0].slice(0, 160)); }

// ══════════════════════════════════════════ 5. RECHNUNGEN UMGEZOGEN, LOHN-KACHELN
try {
  await page.evaluate(() => { go('kunden'); kuGoTab('rechnungen'); });
  await page.waitForTimeout(400);
  check('KRITISCH: der alte Einstieg kuGoTab("rechnungen") landet unter Finanzen',
    await page.evaluate(() => $('view-rechnungen').classList.contains('on') && !$('view-kunden').classList.contains('on')));
  check('Die Rechnungsliste ist gefüllt', /RE-01/.test(await page.textContent('#reTable')));
  check('Rechnungen ist im Menü markiert', await page.evaluate(() => $('nav-finanzen-rechnungen').classList.contains('on')));
  await page.evaluate(() => { ofArt = 'rechnung'; ofZurueck(); });
  await page.waitForTimeout(200);
  check('KRITISCH: "Zurück" aus einer Rechnung führt unter Finanzen', await page.evaluate(() => $('view-rechnungen').classList.contains('on')));

  await page.click('#nav-finanzen-lohn');
  await page.waitForTimeout(300);
  check('"Lohn" öffnet die Lohnläufe', await page.evaluate(() => $('view-lohnlaeufe').classList.contains('on')));
  const kacheln = await page.$$eval('#view-lohnlaeufe .fin-lohn-reiter .rdkr-tab', k => k.map(x => x.textContent.trim()));
  check('KRITISCH: vier Kacheln Lohnläufe · Lohnarten · Sätze und Regelwerk · Auslagenersatz',
    kacheln.join('|') === 'Lohnläufe|Lohnarten|Sätze und Regelwerk|Auslagenersatz');
  await page.click('#view-lohnlaeufe .fin-lohn-reiter .rdkr-tab[data-reiter="lohnarten"]');
  await page.waitForTimeout(200);
  check('Die Kachel wechselt die Seite und ist markiert',
    await page.evaluate(() => $('view-lohnarten').classList.contains('on')
      && document.querySelector('#view-lohnarten .rdkr-tab.aktiv').dataset.reiter === 'lohnarten'
      && $('nav-finanzen-lohn').classList.contains('on')));
  check('Die Kacheln tragen die Support-Gestaltung (gemessen: Rahmen der aktiven in Akzentfarbe)',
    await page.evaluate(() => {
      const a = document.querySelector('#view-lohnarten .rdkr-tab.aktiv');
      const n = document.querySelector('#view-lohnarten .rdkr-tab:not(.aktiv)');
      return getComputedStyle(a).borderColor !== getComputedStyle(n).borderColor;
    }));
} catch (e) { bad.push('Umzug: ' + String(e).split('\n')[0].slice(0, 160)); }
await page.close();

// ══════════════════════════════════════════ 5b. NUR ENTWÜRFE
try {
  const pE = await seite(browser);
  await pE.evaluate(() => { go('finanzen'); });
  await pE.waitForTimeout(500);
  await pE.evaluate(() => { rechnungen = rechnungen.filter(b => b.status === 'entwurf'); finZeichnen(); });
  check('KRITISCH: nur Entwürfe heisst "Noch keine verrechnete Rechnung", nicht "Noch keine Rechnungen"',
    /Noch keine verrechnete Rechnung/.test(await pE.textContent('#finAlter'))
    && !/Noch keine Rechnungen/.test(await pE.textContent('#finAlter')));
  await pE.close();
} catch (e) { bad.push('Nur Entwürfe: ' + String(e).split('\n')[0].slice(0, 160)); }

// ══════════════════════════════════════════ 6. RECHTE
try {
  // Nur Rechnungen: keine Lohnzahl, kein Lohn-Punkt, aber die Übersicht.
  const p1 = await seite(browser, { rechte: ['kunden_lesen', 'offerten_lesen'] });
  await p1.click('#nav-finanzen');
  await p1.waitForTimeout(500);
  const k1 = await kpis(p1);
  check('Nur offerten_lesen: Finanzen steht, "Lohn" fehlt',
    await p1.isVisible('#nav-finanzen') && !(await p1.isVisible('#nav-finanzen-lohn')));
  check('KRITISCH: ohne lohn_lesen sagt die Lohnkachel "Kein Zugriff" statt eines Betrags',
    /Kein Zugriff auf den Lohn/.test(k1[3].f) && !/\d/.test(k1[3].v));
  check('KRITISCH: die Legende sagt "Lohnkosten: kein Zugriff"', /Lohnkosten: kein Zugriff/.test(await p1.textContent('#finLegende')));
  check('Ohne lohn_lesen: Letzte Lohnläufe sagt "Kein Zugriff"', /Kein Zugriff/.test(await p1.textContent('#finLaeufe')));
  await p1.close();

  // Nur Lohn: keine Rechnungszahl, keine Anfrage an die Belegliste.
  const p2 = await seite(browser, { rechte: ['lohn_lesen'] });
  await p2.click('#nav-finanzen');
  await p2.waitForTimeout(500);
  const k2 = await kpis(p2);
  check('Nur lohn_lesen: "Rechnungen" fehlt im Menü', !(await p2.isVisible('#nav-finanzen-rechnungen')));
  check('KRITISCH: ohne offerten_lesen stehen die Rechnungskacheln auf "Kein Zugriff", nicht auf 0.00',
    k2.slice(0, 3).every(k => /Kein Zugriff/.test(k.f) && !/0\.00/.test(k.v)));
  check('KRITISCH: ohne offerten_lesen wird die Belegliste gar nicht angefragt',
    !p2.anfragen.some(u => u.includes('beleg_list')));
  check('Die Lohnlinie steht trotzdem', await p2.$$eval('#finChart .fin-l-lohn-pkt', p => p.length) === 1);
  check('Nur lohn_lesen: drei Lohnkacheln, kein Auslagenersatz', await (async () => {
    await p2.click('#nav-finanzen-lohn'); await p2.waitForTimeout(200);
    return (await p2.$$eval('#view-lohnlaeufe .rdkr-tab', k => k.length)) === 3;
  })());
  await p2.close();

  // Nur Auslagen: "Lohn" führt direkt auf den Auslagenersatz.
  const p3 = await seite(browser, { rechte: ['auslagen_lesen'] });
  await p3.evaluate(() => finLohnKlick());
  await p3.waitForTimeout(300);
  check('Nur auslagen_lesen: "Lohn" öffnet den Auslagenersatz',
    await p3.evaluate(() => $('view-lohnauslagen').classList.contains('on')));
  await p3.close();

  // Ohne jedes Finanzrecht: die Rubrik fehlt ganz.
  const p4 = await seite(browser, { rechte: ['kunden_lesen', 'einsaetze_lesen'] });
  check('Ohne Finanzrecht fehlt die Rubrik ganz', !(await p4.isVisible('#nav-finanzen')));
  await p4.close();
} catch (e) { bad.push('Rechte: ' + String(e).split('\n')[0].slice(0, 160)); }

await browser.close();
console.log(`test_finanzen: ${ok.length} bestanden, ${bad.length} rot`);
bad.forEach(b => console.log('  ROT: ' + b));
process.exit(bad.length ? 1 : 0);
