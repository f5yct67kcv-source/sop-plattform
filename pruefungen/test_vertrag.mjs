// Vertraege im Betreiber-Bereich (ENT-637).
//
// Drei Sorten Nachweis:
//   1. Strukturell: dass die dritte Belegart ueberhaupt angelegt wird, dass
//      die Mandantenseite sie NICHT bekommt, und dass die Spalten ueber die
//      Einrichtung nachkommen. Eine Tabellendefinition, die in keiner
//      Einrichtung vorkommt, ist ein Entwurf.
//   2. Gerechnet: dass Browser und Server je Periode dieselben Zahlen
//      ergeben. Das ist dieselbe Absicherung wie in test_belege.mjs gegen
//      das Zwei-Sprachen-Risiko -- nur fuer die Perioden.
//   3. In der Ansicht: dass der Reiter trennt, dass die Laufzeit nur am
//      Vertrag erscheint und dass die vier Lagen der Liste verschiedene
//      Texte tragen.
import { readFileSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);
const lies = p => readFileSync(join(WURZEL, p), 'utf8');
const nurCode = q => q.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ── 1. Die Belegart entsteht wirklich ─────────────────────────────────
const betreiber = nurCode(lies('backend/betreiber.php'));
const belege    = nurCode(lies('backend/belege.php'));
const kern      = nurCode(lies('backend/planung_einrichten_kern.php'));

check('KRITISCH: die Tabelle be_belege kennt die Belegart Vertrag',
  /art ENUM\('offerte','rechnung','vertrag'\)/.test(betreiber));
check('KRITISCH: die Tabelle des Mandanten kennt sie NICHT -- ' +
  'ob ein Betrieb seinen Kunden Vertraege schreibt, ist nicht entschieden',
  /CREATE TABLE belege/.test(kern) && !/art ENUM\('offerte','rechnung','vertrag'\)/.test(kern));

// Auf einer BESTEHENDEN Anlage steht die Spalte schon, ihr fehlt nur der
// Wert -- das braucht ein MODIFY und kein ADD COLUMN. Ohne diesen Nachtrag
// liesse sich auf jeder Anlage vor ENT-637 kein Vertrag speichern.
check('KRITISCH: der fehlende Auswahlwert wird auf bestehenden Anlagen nachgetragen',
  /be_auswahlwerte\(\)/.test(betreiber)
  && /MODIFY COLUMN art/.test(betreiber));
check('KRITISCH: der Nachtrag laeuft aus der Einrichtung heraus, ' +
  'nicht als vergessener Einzelaufruf',
  /function be_spalten_anlegen[\s\S]{0,2000}be_auswahlwerte_nachtragen\(/.test(betreiber));

// Die Laufzeit- und Summenspalten kommen ueber be_spalten() nach.
['vertrag_beginn', 'mindestlaufzeit_monate', 'kuendigungsfrist_monate',
 'verlaengerung_monate', 'total_monat_rappen', 'total_jahr_rappen'].forEach(f => {
  check(`die Spalte ${f} wird an be_belege nachgetragen`,
    new RegExp(`\\['be_belege', '${f}'`).test(betreiber));
});
check('die Periodenspalte wird an be_beleg_positionen nachgetragen',
  /\['be_beleg_positionen', 'periode'/.test(betreiber));

// Die Laufzeitfelder heissen GENAUSO wie am Mandanten -- daran haengt,
// dass be_vertrag_lage() aus ENT-617 auf beiden Saetzen rechnet, ohne
// eine zweite Fassung zu brauchen.
['vertrag_beginn', 'mindestlaufzeit_monate', 'kuendigungsfrist_monate',
 'verlaengerung_monate'].forEach(f => {
  check(`KRITISCH: ${f} heisst am Vertrag wie am Mandanten`,
    new RegExp(`\\['mandant', '${f}'`).test(betreiber)
    && new RegExp(`\\['be_belege', '${f}'`).test(betreiber));
});

// Der Rechenkern darf nicht an db.php haengen: Er laeuft in den
// PHP-Pruefungen mit einer eigenen Verbindung, ohne db.php daneben.
check('KRITISCH: der Rechenkern prueft Spalten selbst und nicht ueber db.php',
  /function beleg_spalte_da/.test(belege) && !/hat_spalte\(\$pdo/.test(belege));

// ── 2. Browser und Server rechnen je Periode gleich ───────────────────
//
// Die Faelle stehen hier und nicht in belege_faelle.json: Jene Datei
// beschreibt Offerten, und eine Periode haette dort keinen Sinn.
const PERIODEN_FAELLE = [
  { name: 'Einrichtung einmalig, Grundgebuehr monatlich',
    rabatt_bp: 0,
    positionen: [
      { menge: 1, einzelpreis_rappen: 50000, mwst_satz_bp: 810, periode: 'einmalig' },
      { menge: 1, einzelpreis_rappen: 12000, mwst_satz_bp: 810, periode: 'monatlich' },
      { menge: 2, einzelpreis_rappen: 3000,  mwst_satz_bp: 810, periode: 'monatlich' },
    ] },
  { name: 'Nur monatlich, mit Gesamtrabatt und gemischten Saetzen',
    rabatt_bp: 750,
    positionen: [
      { menge: 3,  einzelpreis_rappen: 4200, mwst_satz_bp: 810, periode: 'monatlich' },
      { menge: 10, einzelpreis_rappen: 1680, mwst_satz_bp: 0,   periode: 'monatlich' },
    ] },
  { name: 'Alle drei Perioden zugleich',
    rabatt_bp: 500,
    positionen: [
      { menge: 1, einzelpreis_rappen: 99900, mwst_satz_bp: 810, periode: 'einmalig' },
      { menge: 1, einzelpreis_rappen: 45000, mwst_satz_bp: 810, periode: 'monatlich' },
      { menge: 1, einzelpreis_rappen: 12345, mwst_satz_bp: 260, periode: 'jaehrlich' },
    ] },
];

let ausPhp = null;
try {
  const skript = `require '${join(WURZEL, 'backend/belege.php')}';
    $f = json_decode(file_get_contents('php://stdin'), true);
    $aus = [];
    foreach ($f as $fall) {
      $aus[$fall['name']] = beleg_summen_perioden($fall['positionen'], (int)$fall['rabatt_bp']);
    }
    echo json_encode($aus);`;
  ausPhp = JSON.parse(execFileSync('php', ['-r', skript],
    { input: JSON.stringify(PERIODEN_FAELLE), encoding: 'utf8' }));
} catch (e) { bad.push('PHP konnte die Periodensummen nicht rechnen: ' + e.message); }

// ── 3. In der Ansicht ─────────────────────────────────────────────────
const ANTWORTEN = {
  'betreiber_zf_status.php': { status: 'ok', eingerichtet: true },
  'betreiber_mandant_list.php': { status: 'ok', mandanten: [
    { id: 1, name: 'Betrieb Eins', subdomain: 'eins', status: 'aktiv', kanton: 'BE',
      gav_unterstellt: true, gav_bestaetigt_am: null, gav_lage: 'bestaetigt',
      verbindung_lage: 'vollstaendig', ist_demo: false, vertrag_felder_da: true,
      db_host: '', db_name: '', db_user: '', secret_name: '',
      vertrag: { lage: 'laeuft', ende: '2030-01-01', spaetestens: '2029-10-01',
                 beendet: false, faellig_90: false } },
  ] },
  'betreiber_vertrag_list.php': { status: 'ok', eingerichtet: true,
    kennt_laufzeit: true, kennt_perioden: true, zeilen: [
      { firma: 'Betrieb Eins', kundennummer: 'K-0001', kunde_id: 5, mandant_id: 1,
        subdomain: 'eins', mandant_status: 'aktiv', lage: 'vollstaendig',
        laufzeit_quelle: 'mandant', faellig_90: false,
        laufzeit: { lage: 'laeuft', ende: '2030-01-01', spaetestens: '2029-10-01', beendet: false },
        dokument: { id: 7, nummer: 'VE-0001', titel: 'Nutzung', datum: '2029-01-05',
                    status: 'bestaetigt', aktiv: true, angenommen_am: '2029-01-06 09:00:00',
                    total_rappen: 50000, total_monat_rappen: 18000, total_jahr_rappen: 0 } },
      { firma: 'Betrieb Zwei', kundennummer: null, kunde_id: null, mandant_id: 2,
        subdomain: '', mandant_status: 'aktiv', lage: 'ohne_dokument',
        laufzeit_quelle: 'mandant', faellig_90: false,
        laufzeit: { lage: 'unbekannt', ende: null, spaetestens: null, beendet: false },
        dokument: null },
      { firma: 'Betrieb Drei', kundennummer: 'K-0003', kunde_id: 9, mandant_id: null,
        subdomain: '', mandant_status: null, lage: 'ohne_mandant',
        laufzeit_quelle: 'dokument', faellig_90: false,
        laufzeit: { lage: 'ohne_ende', ende: null, spaetestens: null, beendet: false },
        dokument: { id: 8, nummer: 'VE-0002', titel: 'Nutzung', datum: '2029-02-01',
                    status: 'versendet', aktiv: true, angenommen_am: null,
                    total_rappen: 0, total_monat_rappen: 45000, total_jahr_rappen: 0 } },
    ] },
  'betreiber_beleg_list.php': { status: 'ok', eingerichtet: true, belege: [],
    naechste_nummer: 'VE-0003' },
  'betreiber_produkt_list.php': { status: 'ok', produkte: [] },
  'betreiber_kunden_list.php': { status: 'ok', kunden: [
    { id: 9, name: 'Betrieb Drei', kundennummer: 'K-0003', aktiv: 1 },
  ] },
};

const browser = await chromium.launch({ executablePath: browserPfad() });
const seite = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
seite.on('pageerror', e => bad.push('JS-Fehler in der Ansicht: ' + e.message));
await seite.route('**/api/**', r => {
  const datei = r.request().url().split('/').pop().split('?')[0];
  r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify(ANTWORTEN[datei] || { status: 'ok' }) });
});
await seite.addInitScript(() => {
  sessionStorage.setItem('betreiber-token', 'pruefung');
  localStorage.setItem('rv3_thema', 'dunkel');
});
await seite.goto(`file://${WURZEL}/betreiber.html`);
await seite.waitForTimeout(600);

// Dieselben Zahlen im Browser wie im Server. Gerechnet wird mit der
// Funktion der Seite selbst, nicht mit einer nachgebauten.
if (ausPhp) {
  const ausJs = await seite.evaluate(faelle => {
    const raus = {};
    faelle.forEach(f => {
      raus[f.name] = {};
      belegSummenPerioden(f.positionen, f.rabatt_bp).forEach(b => {
        raus[f.name][b.periode.wert] = b.summen;
      });
    });
    return raus;
  }, PERIODEN_FAELLE);

  PERIODEN_FAELLE.forEach(f => {
    const p = ausPhp[f.name] || {}, j = ausJs[f.name] || {};
    check(`KRITISCH: "${f.name}" ergibt in beiden Sprachen dieselben Perioden`,
      Object.keys(p).sort().join(',') === Object.keys(j).sort().join(','));
    Object.keys(p).forEach(periode => {
      const a = p[periode] || {}, b = j[periode] || {};
      check(`KRITISCH: "${f.name}" / ${periode}: Total, MWST und Rabatt stimmen ueberein`,
        a.total_rappen === b.total_rappen
        && a.mwst_rappen === b.mwst_rappen
        && a.rabatt_rappen === b.rabatt_rappen
        && a.zwischensumme_rappen === b.zwischensumme_rappen);
    });
  });
}

await seite.click('#kopf-nav .nav-item[data-bereich="mandanten"]');
await seite.waitForTimeout(350);

// Der Reiter trennt wirklich. Gemessen statt nachgelesen.
const vorher = await seite.evaluate(() => ({
  vertraegeWeg: document.getElementById('mv-vertraege').offsetHeight === 0,
  stammDa:      document.getElementById('mv-mandanten').offsetHeight > 0,
}));
check('KRITISCH: der Vertragsreiter ist geschlossen, solange der Stamm offen ist',
  vorher.vertraegeWeg && vorher.stammDa);

await seite.evaluate(() => mandGo('vertraege'));
await seite.waitForTimeout(400);

const offen = await seite.evaluate(() => {
  const t = document.getElementById('vertrag-inhalt');
  const zeilen = [...t.querySelectorAll('tbody tr')].map(tr =>
    [...tr.querySelectorAll('td')].map(td => td.textContent.trim()));
  return {
    vertraegeDa:  document.getElementById('mv-vertraege').offsetHeight > 0,
    stammWeg:     document.getElementById('mv-mandanten').offsetHeight === 0,
    demoWeg:      document.getElementById('mv-demo').offsetHeight === 0,
    unterzeile:   document.getElementById('leiste-unter').textContent.trim(),
    zeilen,
    knopfHoehe:   document.getElementById('knopf-vertrag-neu').getBoundingClientRect().height,
  };
});
check('KRITISCH: der Vertragsreiter zeigt seine Liste und schliesst die anderen',
  offen.vertraegeDa && offen.stammWeg && offen.demoWeg);
check('die Unterzeile sagt, wo man ist', offen.unterzeile.length > 5);
check('KRITISCH: jedes Vertragsverhaeltnis bekommt genau eine Zeile',
  offen.zeilen.length === 3);

// Die vier Lagen duerfen NIE gleich aussehen (Hausregel: „unbekannt" darf
// nie wie „keine" aussehen). Geprueft wird, dass die Texte verschieden
// sind -- nicht, wie sie lauten.
if (offen.zeilen.length === 3) {
  const lagen = offen.zeilen.map(z => z[1]);
  check('KRITISCH: abgemacht, ohne Dokument und nicht aufgeschaltet ' +
    'stehen mit drei verschiedenen Texten da',
    new Set(lagen).size === 3 && lagen.every(l => l.length > 0));

  const dok = offen.zeilen.map(z => z[2]);
  check('KRITISCH: „kein Dokument hinterlegt" ist ein eigener Text und kein leeres Feld',
    dok[1].length > 3 && dok[1] !== dok[0]);
  check('die Zeile mit Dokument nennt dessen Nummer', dok[0].includes('VE-0001'));

  // Einmalig und monatlich stehen getrennt da -- eine Summe darueber waere
  // ein Betrag, den niemand bezahlt.
  const preis = offen.zeilen.map(z => z[3]);
  check('KRITISCH: einmalig und monatlich stehen in derselben Zelle getrennt',
    preis[0].includes('einmalig') && preis[0].includes('pro Monat'));
  check('KRITISCH: ein Vertrag ohne einmaligen Anteil zeigt trotzdem seinen Monatspreis ' +
    'und keine Null', preis[2].includes('pro Monat') && !preis[2].includes('einmalig'));
  check('ohne Dokument steht kein erfundener Preis da', preis[1] !== preis[0]);

  // Eine Laufzeit aus einem noch nicht angenommenen Vertrag ist etwas
  // anderes als eine geltende Abmachung.
  const laufzeit = offen.zeilen.map(z => z[4]);
  check('KRITISCH: eine Laufzeit nur laut Dokument wird als solche ausgewiesen',
    laufzeit[2].includes('Dokument'));
  check('KRITISCH: eine nicht erfasste Laufzeit sieht nicht aus wie eine unbefristete',
    laufzeit[1] !== laufzeit[2]);
}
check('der Knopf „Vertrag erstellen" ist gross genug fuers Handy',
  offen.knopfHoehe >= 30);

// ── Das Formular: Laufzeit und Periode nur beim Vertrag ───────────────
await seite.evaluate(() => { ofNeu('offerte'); });
await seite.waitForTimeout(200);
const alsOfferte = await seite.evaluate(() => ({
  laufzeit: document.getElementById('ofLaufzeitKarte').offsetHeight,
  periode:  !!document.getElementById('ofp_periode0'),
}));
check('KRITISCH: eine Offerte zeigt keine Laufzeit', alsOfferte.laufzeit === 0);
check('KRITISCH: eine Offerte kennt keine Periodenwahl', alsOfferte.periode === false);

await seite.evaluate(() => { ofNeu('vertrag'); });
await seite.waitForTimeout(200);
const alsVertrag = await seite.evaluate(() => {
  const w = document.getElementById('ofp_periode0');
  return {
    laufzeit: document.getElementById('ofLaufzeitKarte').offsetHeight,
    periode:  !!w,
    vorgabe:  w ? w.value : null,
    auswahl:  w ? [...w.options].map(o => o.value) : [],
    titel:    document.getElementById('ofFormNummer').textContent.trim(),
    leer:     ['of_vbeginn', 'of_vmindest', 'of_vfrist', 'of_vverlaengerung']
                .every(f => document.getElementById(f).value === ''),
  };
});
check('KRITISCH: ein Vertrag zeigt die Laufzeit', alsVertrag.laufzeit > 0);
check('KRITISCH: ein Vertrag kennt die Periodenwahl', alsVertrag.periode);
check('KRITISCH: eine neue Zeile behauptet nichts und steht auf einmalig',
  alsVertrag.vorgabe === 'einmalig');
check('alle drei Perioden stehen zur Wahl', alsVertrag.auswahl.length === 3);
check('KRITISCH: die Laufzeitfelder starten leer -- ein vorausgefuelltes ' +
  '„12" waere eine Abmachung, die niemand getroffen hat', alsVertrag.leer);
check('der Kopf zeigt die naechste Vertragsnummer und nicht die einer Offerte',
  alsVertrag.titel.startsWith('VE-') || alsVertrag.titel === 'Neuer Vertrag');

// Die Summenvorschau trennt die Perioden, sobald es etwas zu trennen gibt.
const vorschau = await seite.evaluate(() => {
  const setz = per => {
    ofPos = [
      { produkt_id: null, produkt_name: 'Einrichtung', beschreibung: '', menge: 1,
        einheit: 'Stk.', einzelpreis_rappen: 50000, rabatt_bp: 0, mwst_satz_bp: 810,
        periode: 'einmalig' },
      { produkt_id: null, produkt_name: 'Grundgebuehr', beschreibung: '', menge: 1,
        einheit: 'Mt.', einzelpreis_rappen: 12000, rabatt_bp: 0, mwst_satz_bp: 810,
        periode: per },
    ];
    ofZeilenZeichnen();
    return document.getElementById('ofSummen').textContent;
  };
  const gemischt = setz('monatlich');
  const gleich   = setz('einmalig');
  return { gemischt, gleich,
           koepfe: document.querySelectorAll('.of-summe-kopf').length };
});
check('KRITISCH: bei gemischten Perioden sagt die Vorschau, wofuer ein Total gilt',
  vorschau.gemischt.includes('pro Monat'));
check('KRITISCH: bei nur einer Periode steht kein „einmalig" am Total -- ' +
  'auf einer Offerte hiesse das nichts',
  !vorschau.gleich.includes('Total einmalig'));
check('KRITISCH: die Trennueberschriften verschwinden wieder, ' +
  'wenn alle Positionen gleich oft anfallen', vorschau.koepfe === 0);

await seite.close();
await browser.close();

ok.forEach(n => console.log('  ok ' + n));
bad.forEach(n => console.log('   X ' + n));
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden`);
if (!bad.length) { console.log('\nAlle Pruefungen bestanden.'); }
process.exit(bad.length ? 1 : 0);
