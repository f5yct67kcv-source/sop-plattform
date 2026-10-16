// Finanzen im Betreiber-Bereich (ENT-725) -- im Browser gemessen.
//
// Was diese Suite scharf hält (die Rechenregeln des Servers prüft
// pruef_betreiber_finanzen.php gegen SQLite, hier läuft sie mit):
//
// 1. FINANZEN ERSETZT RECHNUNGEN. Kein Hauptreiter "Rechnungen" mehr; ein
//    alter Einstieg (bereichZeigen('rechnungen'), Zurück aus einer
//    Rechnung) landet unter Finanzen → Rechnungen.
// 2. EIN ENTWURF IST NICHT VERRECHNET -- weder in der Übersicht noch auf
//    der Startseite (ENT-725, Punkt 2: gleich gerechnet wie dort).
// 3. "UNBEKANNT" IST NIE "KEINE". Ein Monat ohne erfasste Ausgabe zeigt
//    keine CHF 0.00, ein fehlender CHF-Betrag heisst "CHF-Betrag fehlt",
//    nicht eingerichtete Ausgaben heissen "nicht eingerichtet".
// 4. GESCHÄTZT IST SICHTBAR GESCHÄTZT: schraffiert in der Grafik, "≈" in
//    der Liste, "davon geschätzt" in der Kennzahl.
// 5. FARBE FOLGT DER KATEGORIE: höchstens vier eigene Farben, ab der
//    fünften "Weitere" -- nie eine erfundene Farbe.
// 6. DIE SPERREN STEHEN IM SERVER, der Dialog schickt aber das Richtige:
//    Fremdwährung ohne CHF-Betrag geht als null, nicht als 0.
// 7. GESTALTUNG GEMESSEN: Beschriftung über dem Wert, fünf Kennzahlen auf
//    einer Linie, keine waagrechte Bildlaufleiste.
//
// Gegenproben (beim Bau ausgeführt, jede machte ihre Prüfung rot):
//  - finIstVerrechnet ohne Entwurf-Ausschluss -> Kennzahl und Startseite rot
//  - Monat ohne Ausgabe als 0 statt null -> "nichts erfasst" rot
//  - finKatKlasse ohne Obergrenze 4 -> "Weitere" rot
//  - ausEingabeRappen leer -> 0 -> "null statt 0" rot
import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { WURZEL, OUT, browserPfad } from './pfade.mjs';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

// Kein festes Datum (test_datumsfest.mjs): alles relativ zum laufenden Monat.
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const jetzt = new Date();
const tagIm = (v, t) => iso(new Date(jetzt.getFullYear(), jetzt.getMonth() + v, t));
const monatVon = v => tagIm(v, 1).slice(0, 7);
const mJ = monatVon(0), mV = monatVon(-1), mVV = monatVon(-2), mAlt = monatVon(-5);

const re = (id, datum, netto, extra) => ({
  id, art: 'rechnung', nummer: 'RE-000' + id, kunde_id: 1, kunde_name: 'Beispiel AG', titel: 'Nutzung',
  datum, faellig_bis: null, status: 'versendet', bezahlt: 0, bezahlt_am: null,
  zwischensumme_rappen: netto, rabatt_rappen: 0, mwst_rappen: Math.round(netto * 0.081),
  rundung_rappen: 0, total_rappen: Math.round(netto * 1.081), aktiv: 1, ...extra });
const RECHNUNGEN = { status: 'ok', eingerichtet: true, naechste_nummer: 'RE-0099', aenderung: 0, aenderung_gesamt: 0, belege: [
  re(1, tagIm(-1, 3), 100000, { bezahlt: 1, bezahlt_am: tagIm(-1, 20) }),
  re(2, tagIm(-2, 3), 50000, { faellig_bis: tagIm(-2, 20) }),          // überfällig
  re(3, tagIm(0, 1), 20000),                                            // offen, ohne Fälligkeit
  // Entwurf mit grossem Betrag: jedes Mitzählen fiele sofort auf.
  re(4, tagIm(-1, 5), 9000000, { status: 'entwurf', faellig_bis: tagIm(-1, 6) }),
] };
const offenErwartet = Math.round(50000 * 1.081) + Math.round(20000 * 1.081);

const KATEGORIEN = [1, 2, 3, 4, 5].map(i => ({ id: i, name: ['Hosting & Server', 'Software & Abos', 'Marketing & Vertrieb', 'Beratung', 'Büro'][i - 1], sortierung: i, aktiv: 1 }));
const UEBERSICHT = (ausgaben) => ({ status: 'ok', heute: tagIm(0, 1), ausgaben, mrr: {
  eingerichtet: true, rappen: 27000, vertraege: 2, ruhend: 1, ohne_mandant: 0,
  zeilen: [
    { mandant_id: 1, mandant: 'Betrieb A', beleg_id: 9, nummer: 'VE-0001', monat_rappen: 18000, jahr_rappen: 0, beitrag_rappen: 18000, lage: 'laeuft', ende: null },
    { mandant_id: 2, mandant: 'Betrieb B', beleg_id: 10, nummer: 'VE-0002', monat_rappen: 8000, jahr_rappen: 12000, beitrag_rappen: 9000, lage: 'gekuendigt', ende: tagIm(1, 28) },
  ],
  auslaufend: [{ mandant_id: 2 }],
} });
const AUSGABEN_DA = { eingerichtet: true, kategorien: KATEGORIEN, erste_periode: mVV, monate: {
  [mVV]: { netto_rappen: 10000, geschaetzt_rappen: 0, fehlt: 0, buchungen: 1, kategorien: { 1: 10000 } },
  // Vormonat: kein Eintrag -> "nichts erfasst", nicht CHF 0.
  [mJ]: { netto_rappen: 46000, geschaetzt_rappen: 1800, fehlt: 1, buchungen: 6,
          kategorien: { 1: 20000, 2: 1800, 3: 9000, 4: 5000, 5: 10200 } },
} };
const zeile = (id, extra) => ({ id, datum: tagIm(0, 1), periode: mJ, kategorie_id: 1, text: 'Server', lieferant: 'Hoster',
  waehrung: 'CHF', betrag_rappen: 21620, betrag_fremd_rappen: null, mwst_satz_bp: 810, vorlage_id: null, von_hand: 1,
  aktiv: 1, kategorie_name: 'Hosting & Server', hat_datei: 0, datei_name: null, schaetzung_rappen: null, ...extra });
const AUSGABE_LIST = { status: 'ok', eingerichtet: true, heute: tagIm(0, 1), kategorien: KATEGORIEN,
  mwst_saetze: [{ bp: 810, ab: '2024-01-01', titel: '8.1 %' }, { bp: 260, ab: '2024-01-01', titel: '2.6 %' },
                { bp: 380, ab: '2024-01-01', titel: '3.8 %' }, { bp: 0, ab: '1900-01-01', titel: '0 %' }],
  vorlagen: [{ id: 1, kategorie_id: 2, text: 'KI-Abo', lieferant: 'Anbieter', intervall: 'monatlich', waehrung: 'USD',
               betrag_rappen: 1800, betrag_fremd_rappen: 2000, mwst_satz_bp: 0, gueltig_ab: tagIm(-3, 1), gueltig_bis: null,
               aktiv: 1, kategorie_name: 'Software & Abos' }],
  ausgaben: [
    zeile(1),
    zeile(2, { text: 'KI-Abo', kategorie_id: 2, kategorie_name: 'Software & Abos', waehrung: 'USD', betrag_rappen: null,
               betrag_fremd_rappen: 2000, mwst_satz_bp: 0, vorlage_id: 1, von_hand: 0, schaetzung_rappen: 1800 }),
    zeile(3, { text: 'Werkzeug', kategorie_id: 2, kategorie_name: 'Software & Abos', waehrung: 'USD', betrag_rappen: null,
               betrag_fremd_rappen: 1000, mwst_satz_bp: 0, schaetzung_rappen: null }),
    zeile(4, { text: 'Inserat', kategorie_id: 3, kategorie_name: 'Marketing & Vertrieb', betrag_rappen: 9729, hat_datei: 1, datei_name: 'beleg.pdf' }),
    zeile(5, { text: 'Alt', aktiv: 0 }),
  ] };

const TYPEN = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png',
                '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.webp': 'image/webp' };
const BASIS = 'http://betreiber.test.invalid/';

async function seiteMit({ ausgaben = AUSGABEN_DA, ausgabeList = AUSGABE_LIST, breite = 1440 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: breite, height: 1000 } });
  const seite = await ctx.newPage();
  const fehler = [];
  seite.on('pageerror', e => fehler.push(String(e)));
  const gesendet = [];
  await seite.route('**/*', async route => {
    const url = new URL(route.request().url());
    const pfad = url.pathname.replace(/^\//, '');
    if (pfad.startsWith('api/')) {
      const name = pfad.slice(4) + url.search;
      const koerper = route.request().postData();
      if (koerper) { gesendet.push({ name, daten: JSON.parse(koerper) }); }
      let antwort = { status: 'ok', eingerichtet: false };
      if (name.startsWith('betreiber_zf_status.php')) { antwort = { status: 'ok', eingerichtet: true, ich: { id: 1, name: 'Test', email: 't@example.invalid' } }; }
      if (name.startsWith('betreiber_beleg_list.php?art=rechnung')) { antwort = RECHNUNGEN; }
      if (name.startsWith('betreiber_finanzen_uebersicht.php')) { antwort = UEBERSICHT(ausgaben); }
      if (name.startsWith('betreiber_ausgabe_list.php')) { antwort = ausgabeList; }
      if (name.startsWith('betreiber_ausgabe_speichern.php')) { antwort = { status: 'ok', id: 77 }; }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(antwort) });
    }
    const datei = join(WURZEL, pfad || 'betreiber.html');
    if (!existsSync(datei)) { return route.fulfill({ status: 404, body: '' }); }
    return route.fulfill({ status: 200, contentType: TYPEN[extname(datei)] || 'application/octet-stream', body: readFileSync(datei) });
  });
  await seite.addInitScript(() => { sessionStorage.setItem('betreiber-token', 'test'); });
  await seite.goto(BASIS + 'betreiber.html');
  await seite.waitForFunction(() => !document.getElementById('haus').classList.contains('versteckt'), null, { timeout: 15000 });
  return { ctx, seite, fehler, gesendet };
}
const warte = s => s.waitForTimeout(400);

const browser = await chromium.launch({ executablePath: browserPfad() });
try {
  // ── 1. Navigation ──────────────────────────────────────────────────
  const { ctx, seite, fehler, gesendet } = await seiteMit();
  await warte(seite);
  const nav = await seite.$$eval('#kopf-nav .nav-item', l => l.map(b => b.dataset.bereich));
  check('KRITISCH: es gibt den Hauptreiter Finanzen', nav.includes('finanzen'));
  check('KRITISCH: es gibt keinen eigenen Hauptreiter Rechnungen mehr', !nav.includes('rechnungen'));
  check('Finanzen steht an der Stelle der Rechnungen (nach Offerten, vor Support)',
    nav.indexOf('finanzen') === nav.indexOf('offerten') + 1 && nav.indexOf('support') === nav.indexOf('finanzen') + 1);

  // Startseite: Entwurf zählt nicht, Klick führt zu Finanzen.
  const start = await seite.$eval('#u-zahlen', el => el.textContent);
  const chfStart = r => (r / 100).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  check('KRITISCH: die Startseite zählt den Rechnungsentwurf nicht als offen',
    start.includes(chfStart(offenErwartet) + ' CHF'));
  await seite.click('#u-zahlen .zahl.springt');
  await warte(seite);
  check('Ein Klick auf die offenen Rechnungen der Startseite führt zu Finanzen',
    await seite.evaluate(() => !document.getElementById('b-finanzen').classList.contains('versteckt') && finTab === 'uebersicht'));

  // ── 2. Kennzahlen ──────────────────────────────────────────────────
  const kpi = await seite.$$eval('#finKpi .kpi', l => l.map(k => ({
    l: k.querySelector('.kpi-top span').textContent, v: k.querySelector('.kpi-val').textContent.replace(/\s+/g, ' ').trim(),
    f: k.querySelector('.kpi-foot').textContent.replace(/\s+/g, ' ').trim() })));
  const k = l => kpi.find(x => x.l.startsWith(l)) || { v: '', f: '' };
  const chfText = r => (r / 100).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  check('Fünf Kennzahlen', kpi.length === 5);
  check('KRITISCH: offener Betrag ohne Entwurf, inkl. MWST', k('Offener Betrag').v.includes(chfText(offenErwartet)));
  check('Der Entwurf wird genannt, nicht gezählt', k('Offener Betrag').f.includes('1 Entwurf nicht mitgezählt'));
  check('Überfällig nennt die überfällige Rechnung', k('Davon überfällig').v.includes(chfText(Math.round(50000 * 1.081))));
  check('Ausgaben im Monat netto aus dem Server', k('Ausgaben im Monat').v.includes(chfText(46000)));
  check('KRITISCH: der Vormonat ohne Ausgabe heisst "nichts erfasst", nicht CHF 0',
    k('Ausgaben im Monat').f.includes('Vormonat: nichts erfasst'));
  check('Geschätztes ist in der Kennzahl ausgewiesen', k('Ausgaben im Monat').f.includes('davon geschätzt CHF 18.00'));
  check('Ausgaben ohne CHF-Betrag werden genannt', k('Ausgaben im Monat').f.includes('1 Ausgabe ohne CHF-Betrag'));
  check('Wiederkehrender Umsatz mit Bezug', k('Wiederkehrend').v.includes('270.00') && k('Wiederkehrend').f.includes('aus 2 Verträgen'));
  check('Auslaufende Verträge werden genannt', k('Wiederkehrend').f.includes('1 endet in 90 Tagen'));

  // ── 3. Grafik ──────────────────────────────────────────────────────
  const grafik = await seite.evaluate(() => ({
    segmente: [...document.querySelectorAll('#finChart path.fin-seg')].map(p => p.getAttribute('class')),
    schraffur: document.querySelectorAll('#finChart .fin-geschaetzt').length,
    legende: document.getElementById('finLegende').textContent,
    kurven: document.querySelectorAll('#finChart path.fin-l-verrechnet').length,
  }));
  check('Ausgabenbalken nach Kategorie gezeichnet', grafik.segmente.length >= 5);
  check('KRITISCH: höchstens vier Kategoriefarben, die fünfte ist "Weitere"',
    grafik.segmente.some(c => c.includes('kw')) && grafik.legende.includes('Weitere')
    && !grafik.segmente.some(c => /\bk[5-9]\b/.test(c)));
  check('Geschätztes ist schraffiert und in der Legende', grafik.schraffur === 1 && grafik.legende.includes('geschätzt'));
  check('Die Einnahmenkurven stehen daneben', grafik.kurven >= 1 && grafik.legende.includes('verrechnet'));
  // Tipp über einem Monat vor der ersten Ausgabe und über dem Vormonat.
  const tipVor = await seite.evaluate(() => { finTipZeigen(0); return document.getElementById('finTip').textContent; });
  check('KRITISCH: ein Monat vor der ersten Ausgabe heisst "noch nicht erfasst"', tipVor.includes('noch nicht erfasst'));
  const tipVM = await seite.evaluate(() => { finTipZeigen(finChartDaten.length - 2); return document.getElementById('finTip').textContent; });
  check('KRITISCH: ein Monat ohne Ausgabe nach Beginn heisst "nichts erfasst"', tipVM.includes('nichts erfasst') && !tipVM.includes('AusgabenCHF 0.00'));
  const tipJ = await seite.evaluate(() => { finTipZeigen(finChartDaten.length - 1); return document.getElementById('finTip').textContent; });
  check('Der Tipp nennt jede Kategorie mit Betrag', tipJ.includes('Hosting & Server') && tipJ.includes('Weitere'));
  check('Der Tipp nennt Geschätztes und Fehlendes', tipJ.includes('davon geschätzt') && tipJ.includes('ohne CHF-Betrag'));
  // Die Kurve darf nicht unter die Nulllinie schwingen.
  const schwingt = await seite.evaluate(() => {
    const svg = document.querySelector('#finChart svg');
    const null_ = [...svg.querySelectorAll('.fin-gitter.null')][0].y1.baseVal.value;
    const p = svg.querySelector('path.fin-l-bezahlt:not(.gestrichelt)');
    const len = p.getTotalLength();
    let tiefst = 0;
    for (let t = 0; t <= len; t += 2) { tiefst = Math.max(tiefst, p.getPointAtLength(t).y); }
    return tiefst > null_ + 0.5;
  });
  check('Die Kurve schwingt nicht unter die Nulllinie', !schwingt);

  // Karten darunter.
  const karten = await seite.evaluate(() => ({
    kat: document.getElementById('finKat').textContent, mrr: document.getElementById('finMrr').textContent,
    letzte: document.getElementById('finLetzte').textContent, alter: document.getElementById('finAlterUnter').textContent }));
  check('Ausgaben nach Kategorie mit Total', karten.kat.includes('Total CHF') && karten.kat.includes('Marketing & Vertrieb'));
  check('Wiederkehrender Umsatz je Mandant, gekündigt mit Datum', karten.mrr.includes('Betrieb A') && karten.mrr.includes('gekündigt per'));
  check('Ein nicht zählender Vertrag wird genannt', karten.mrr.includes('1 Vertrag zählt nicht'));
  check('Letzte Ausgaben zeigen "CHF-Betrag fehlt" statt 0', karten.letzte.includes('CHF-Betrag fehlt') && karten.letzte.includes('≈ CHF 18.00'));
  check('Archivierte Ausgaben stehen nicht unter "Letzte Ausgaben"', !karten.letzte.includes('Alt'));

  // ── 4. Gestaltung, gemessen ────────────────────────────────────────
  const mass = await seite.evaluate(() => {
    const R = el => el.getBoundingClientRect();
    const k = [...document.querySelectorAll('#finKpi .kpi')];
    return {
      labOben: k.every(x => R(x.querySelector('.kpi-top')).bottom <= R(x.querySelector('.kpi-val')).top + 1),
      eineLinie: new Set(k.map(x => Math.round(R(x).top))).size === 1,
      gleichBreit: Math.max(...k.map(x => R(x).width)) - Math.min(...k.map(x => R(x).width)) < 2,
      querScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      chartHoehe: Math.round(R(document.getElementById('finChart')).height),
    };
  });
  check('Beschriftung über dem Wert, in jeder Kennzahl', mass.labOben);
  check('Fünf Kennzahlen auf einer Linie, gleich breit', mass.eineLinie && mass.gleichBreit);
  check('Keine waagrechte Bildlaufleiste am Desktop', mass.querScroll <= 0);
  check('Die Grafik hat ihre Höhe (290 px)', mass.chartHoehe === 290);

  // Die Balken in "Ausgaben nach Kategorie" beginnen auf einer Linie.
  const balkenLinks = await seite.$$eval('#finKat .fin-balken', l => l.map(b => Math.round(b.getBoundingClientRect().left)));
  check('Die Kategorienbalken beginnen alle an derselben Stelle', new Set(balkenLinks).size === 1);

  // Bildschirmfotos zum Ansehen (nicht versioniert), hell und dunkel.
  await seite.evaluate(() => finTipWeg());
  await seite.screenshot({ path: join(OUT, 'betreiber_finanzen_hell.png'), fullPage: true });
  await seite.evaluate(() => themaSetzen('dunkel'));
  await seite.evaluate(() => finZeichnen());
  await seite.screenshot({ path: join(OUT, 'betreiber_finanzen_dunkel.png'), fullPage: true });
  await seite.evaluate(() => { themaSetzen('hell'); finZeichnen(); });

  // ── 5. Alter Einstieg Rechnungen ───────────────────────────────────
  await seite.evaluate(() => bereichZeigen('rechnungen'));
  await warte(seite);
  const reLage = await seite.evaluate(() => ({
    bereich: !document.getElementById('b-finanzen').classList.contains('versteckt'),
    reiter: !document.getElementById('finv-rechnungen').classList.contains('versteckt'),
    tabelle: document.getElementById('reTable').textContent,
    titel: document.getElementById('leiste-titel').textContent }));
  check('KRITISCH: bereichZeigen("rechnungen") landet unter Finanzen → Rechnungen', reLage.bereich && reLage.reiter && reLage.titel === 'Finanzen');
  check('Die Rechnungsliste steht dort wie vorher', reLage.tabelle.includes('RE-0001'));

  // ── 6. Ausgabenliste ───────────────────────────────────────────────
  await seite.evaluate(() => finGo('ausgaben'));
  await warte(seite);
  const liste = await seite.evaluate(() => ({
    text: document.getElementById('ausTable').textContent, hinweis: document.getElementById('ausHinweis').textContent,
    fuss: document.querySelector('#ausTable tfoot').textContent }));
  check('KRITISCH: ein fehlender CHF-Betrag heisst "CHF-Betrag fehlt"', liste.text.includes('CHF-Betrag fehlt'));
  check('Eine Schätzung steht als "≈ … geschätzt" daneben', liste.text.includes('≈ CHF 18.00 geschätzt'));
  check('Ohne Schätzung ist der Nettobetrag "unbekannt"', liste.text.includes('unbekannt'));
  check('Fehlende Beträge sind oben als Arbeit genannt', liste.hinweis.includes('2 Ausgaben warten'));
  check('Archivierte stehen nicht unter "Alle"', !liste.text.includes('Alt'));
  check('Der Fuss nennt die Anzahl und was nicht mitzählt', liste.fuss.includes('4 Ausgaben') && liste.fuss.includes('1 ohne Betrag'));
  check('Herkunft aus der Vorlage ist sichtbar', liste.text.includes('aus Vorlage'));
  await seite.selectOption('#ausKat', '3');
  const gefiltert = await seite.$eval('#ausTable tfoot', el => el.textContent);
  check('KRITISCH: eine gefilterte Zahl trägt ihren Bezug ("1 von 4")', gefiltert.includes('1 von 4 Ausgaben'));
  await seite.selectOption('#ausKat', '');
  await seite.screenshot({ path: join(OUT, 'betreiber_ausgaben.png'), fullPage: true });
  await seite.evaluate(() => ausTabGo('vorlagen'));
  const vl = await seite.$eval('#ausTable', el => el.textContent);
  check('Wiederkehrend zeigt die Vorlage mit Originalbetrag und Schätzung', vl.includes('KI-Abo') && vl.includes('USD 20.00') && vl.includes('Schätzung CHF 18.00'));
  await seite.evaluate(() => ausTabGo('kategorien'));
  const kt = await seite.$eval('#ausTable', el => el.textContent);
  check('Kategorien zeigen ihre Ausgabenzahl und den Farbhinweis', kt.includes('Hosting & Server') && kt.includes('Weitere'));

  // ── 7. Dialog: Fremdwährung ohne CHF-Betrag ────────────────────────
  await seite.evaluate(() => { ausTabGo('alle'); ausDlgOeffnen(null); });
  await seite.selectOption('#aus_kategorie', '2');
  await seite.fill('#aus_text', 'Neues Abo');
  await seite.fill('#aus_waehrung', 'usd');
  await seite.dispatchEvent('#aus_waehrung', 'input');
  check('Bei Fremdwährung erscheint das Feld für den Originalbetrag', await seite.isVisible('#aus_fremd'));
  await seite.screenshot({ path: join(OUT, 'betreiber_ausgabe_dialog.png') });
  check('Der CHF-Betrag ist bei Fremdwährung als "laut Abrechnung" beschriftet',
    (await seite.textContent('#aus_chf_lbl')).includes('laut Abrechnung'));
  await seite.fill('#aus_fremd', '25.50');
  await seite.selectOption('#aus_mwst', '0');
  await seite.click('#ausSaveBtn');
  // Warten, bis gespeichert ist (Dialog zu) -- sonst oeffnet der naechste
  // Schritt den Dialog, waehrend dieser noch schreibt.
  await seite.waitForFunction(() => !document.getElementById('dlgAusgabe').classList.contains('on'), null, { timeout: 5000 }).catch(() => {});
  await warte(seite);
  const post = gesendet.filter(g => g.name.startsWith('betreiber_ausgabe_speichern.php')).pop();
  check('KRITISCH: ohne CHF-Betrag geht null, nicht 0', post && post.daten.betrag_rappen === null);
  check('Der Originalbetrag geht in Hundertsteln, die Währung gross', post && post.daten.betrag_fremd_rappen === 2550 && post.daten.waehrung === 'USD');
  // Kurs nur angezeigt.
  const kurs = await seite.evaluate(() => {
    ausDlgOeffnen(null);
    $('aus_waehrung').value = 'USD'; ausDlgBetragFelder();
    $('aus_fremd').value = '20.00'; $('aus_chf').value = '18.00'; ausDlgRechnen();
    const t = $('aus_rechnung').textContent;
    dlgZu('dlgAusgabe');
    return t;
  });
  check('Der Kurs wird aus beiden Beträgen angezeigt', kurs.includes('Kurs 0.9000'));

  check('Keine Skriptfehler auf der Seite', fehler.length === 0);
  if (fehler.length) { console.log(fehler.join('\n')); }
  await ctx.close();

  // ── 8. Nicht eingerichtet ──────────────────────────────────────────
  const b = await seiteMit({ ausgaben: { eingerichtet: false, monate: {}, kategorien: [], erste_periode: null },
                             ausgabeList: { status: 'ok', eingerichtet: false, ausgaben: [], kategorien: [], vorlagen: [] } });
  await b.seite.evaluate(() => bereichZeigen('finanzen'));
  await warte(b.seite);
  const ne = await b.seite.evaluate(() => ({
    kpi: document.getElementById('finKpi').textContent, kat: document.getElementById('finKat').textContent,
    leg: document.getElementById('finLegende').textContent }));
  check('KRITISCH: nicht eingerichtete Ausgaben heissen so in der Kennzahl', ne.kpi.includes('Ausgaben noch nicht eingerichtet'));
  check('… und in der Kategorienkarte und Legende', ne.kat.includes('nicht eingerichtet') && ne.leg.includes('Ausgaben: nicht eingerichtet'));
  await b.seite.evaluate(() => finGo('ausgaben'));
  await warte(b.seite);
  check('Die Ausgabenliste sagt "nicht eingerichtet", nicht "keine Ausgaben"',
    !(await b.seite.textContent('#ausTable')).includes('Noch keine Ausgabe'));
  check('Keine Skriptfehler ohne eingerichtete Ausgaben', b.fehler.length === 0);
  await b.ctx.close();
} finally {
  await browser.close();
}

console.log(`${ok.length} bestanden, ${bad.length} nicht bestanden`);
bad.forEach(n => console.log('  ✗ ' + n));
process.exit(bad.length ? 1 : 0);
