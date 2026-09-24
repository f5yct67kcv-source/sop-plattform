// Der Verlauf am Beleg (ENT-697).
//
// WARUM DIESE SUITE
//
//   1. DER KERN (beleg_verlauf) wird in pruef_beleg_verlauf.php wirklich
//      ausgefuehrt; hier nur gestartet.
//   2. DAS COCKPIT SCHREIBT JETZT MIT: jeder Schreibweg am Beleg hinterlaesst
//      eine Logbuchzeile -- NACH der Aenderung, nicht davor.
//   3. DAS PERSONAL-LOGBUCH BLEIBT, WAS ES WAR: der neue Bereich 'beleg'
//      taucht in logbuch_list.php nicht auf.
//   4. BEIDE OBERFLAECHEN zeichnen mit demselben Code, gemessen im Browser:
//      volle Breite, Tabelle, Empfaenger-Etikett, nur Endpunkte gefaerbt,
//      aufklappbar auch im gesperrten Beleg, vier Texte fuer vier Lagen, am
//      Handy gestapelt ohne waagrechtes Scrollen -- nur im Cockpit (ENT-701).
import { WURZEL, HIER, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { readFileSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);
const lies = p => readFileSync(join(WURZEL, p), 'utf8');
const nurCode = q => q.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ── 1. Der Kern ──────────────────────────────────────────────────────
let phpAus = '', phpCode = 0;
try {
  phpAus = execFileSync('php', [`${HIER}/pruef_beleg_verlauf.php`], { encoding: 'utf8' });
} catch (e) { phpAus = String(e.stdout || '') + String(e.stderr || ''); phpCode = e.status || 1; }
const phpAnzahl = Number((phpAus.match(/^(\d+) bestanden/m) || [0, 0])[1]);
check(`KRITISCH: pruef_beleg_verlauf.php laeuft durch (${phpAnzahl} Pruefungen)`, phpCode === 0 && phpAnzahl > 0);
if (phpCode !== 0) { console.log(phpAus); }
const DATEN = JSON.parse(execFileSync('php', [`${HIER}/pruef_beleg_verlauf.php`, 'json'], { encoding: 'utf8' }));

// ── 2. Das Cockpit schreibt mit ──────────────────────────────────────
// Je Endpunkt: welche Aenderung, welches Logbuchfeld.
const SCHREIBWEGE = [
  ['beleg_speichern.php',   /UPDATE belege SET \$satz/, /logbuch_vergleichen\(\$pdo, \$user, 'beleg'/],
  ['beleg_speichern.php',   /INSERT INTO belege \(/,     /logbuch_schreiben\(\$pdo, \$user, 'beleg', \$id, 'angelegt'/],
  ['beleg_speichern.php',   /beleg_positionen_schreiben\(/, /beleg_positionen_loggen\(\$pdo, \$user, \$id, \$abdruckVorher/],
  ['beleg_status.php',      /UPDATE belege SET status/,  /logbuch_schreiben\(\$pdo, \$user, 'beleg', \$id, 'status'/],
  ['beleg_bezahlt.php',     /UPDATE belege SET bezahlt/, /logbuch_schreiben\(\$pdo, \$user, 'beleg', \$id, 'bezahlt'/],
  ['beleg_archivieren.php', /UPDATE belege SET aktiv/,   /logbuch_schreiben\(\$pdo, \$user, 'beleg', \$id, 'zustand'/],
  ['beleg_duplizieren.php', /INSERT INTO belege \(/,     /logbuch_schreiben\(\$pdo, \$user, 'beleg', \$neuId, 'angelegt'/],
  ['beleg_versenden.php',   /smtp_senden\(/,             /logbuch_schreiben\(\$pdo, \$user, 'beleg', \$id, 'versendet', null, \$anEmail\)/],
  ['beleg_versenden.php',   /beleg_fassung_anlegen\(/,   /logbuch_schreiben\(\$pdo, \$user, 'beleg', \$id, 'fassung'/],
];
for (const [datei, aenderung, log] of SCHREIBWEGE) {
  const q = nurCode(lies('backend/api/' + datei));
  const iA = q.search(aenderung), iL = q.search(log);
  check(`KRITISCH: Cockpit ${datei} schreibt den Verlauf NACH der Aenderung (${log.source.slice(0, 50)}…)`,
    iA >= 0 && iL > iA && /require_once __DIR__ \. '\/\.\.\/logbuch\.php'/.test(q));
}
// Positionen: der Abdruck VOR dem Schreiben, der Vergleich nach dem Commit.
for (const [datei, pf] of [['beleg_speichern.php', ''], ['betreiber_beleg_speichern.php', ", 'be_'"]]) {
  const q = nurCode(lies('backend/api/' + datei));
  const vor = q.indexOf('$abdruckVorher = beleg_positionen_abdruck(');
  check(`KRITISCH: ${datei} nimmt den Abdruck der Positionen VOR dem Ueberschreiben`,
    vor > 0 && vor < q.indexOf('beleg_positionen_schreiben(') && q.indexOf('beleg_positionen_loggen(') > q.indexOf('->commit()'));
}

// ── 3. Das Personal-Logbuch bleibt ───────────────────────────────────
check('das Cockpit-Logbuch kennt den Bereich beleg', /const LOGBUCH_BEREICHE = \[[^\]]*'beleg'/.test(lies('backend/logbuch.php')));
check('KRITISCH: logbuch_list.php liest weiter nur das Personal, keine Belege',
  /logbuch_lesen\(\$pdo, 'mitarbeiter', /.test(nurCode(lies('backend/api/logbuch_list.php'))));

// ── 4. Lese-Endpunkte ────────────────────────────────────────────────
for (const [datei, pf] of [['beleg_lesen.php', "''"], ['betreiber_beleg_lesen.php', "'be_'"]]) {
  const q = nurCode(lies('backend/api/' + datei));
  check(`${datei} liefert den Verlauf aus dem eigenen Tabellensatz`,
    new RegExp(`beleg_verlauf\\(\\$pdo, \\$beleg, ${pf}`).test(q) && /'verlauf' => \$verlauf/.test(q));
  check(`${datei}: scheitert der Verlauf, fehlt er (null) -- statt der ganzen Offerte`,
    /catch \(Throwable \$e\) \{\s*\$verlauf = null;/.test(q));
}

// ── 5. Beide Oberflaechen: derselbe Code ─────────────────────────────
const block = q => (q.match(/\/\* ── Verlauf am Beleg \(ENT-697\) ─+\s*\n\s*Zeichnet, was beleg_verlauf\(\)[\s\S]*?\nfunction ofVerlaufZeichnen\([\s\S]*?\n\}/) || [''])[0];
// Die Regeln ohne Kommentar und ohne Handy-Teil: Die Handy-Regeln gibt es
// nur im Cockpit (ENT-701), alles andere ist gleich.
const cssBlock = q => {
  const m = q.match(/\/\* ── Verlauf am Beleg \(ENT-697\) ─+[\s\S]*?\*\/\n([\s\S]*?\.vl-leer \{[^}]*\}\n)/);
  return m ? m[1] : '';
};
const handyRegeln = q => /@media \(max-width: 700px\) \{\s*\.of-vl thead \{ display: none; \}/.test(q);
const BS = lies('betreiber.html'), CS = lies('dashboard.html');
check('KRITISCH: der Verlauf ist in beiden Oberflaechen derselbe Code', block(BS) !== '' && block(BS) === block(CS));
check('KRITISCH: und dieselben Regeln', cssBlock(BS).length > 500 && cssBlock(BS) === cssBlock(CS));
check('KRITISCH: das Stapeln am Handy gibt es nur im Cockpit (ENT-701)', handyRegeln(CS) && !handyRegeln(BS));
check('GEGENPROBE: der Vergleich faengt eine Abweichung', block(BS) !== block(CS.replace('Noch nichts erfasst.', 'Nichts.')));
check('GEGENPROBE: kein innerHTML im Verlauf -- Namen und Wortlaut kommen vom Empfaenger',
  block(BS).length > 500 && !/innerHTML/.test(block(BS)));

// ── Gemessen im Browser ──────────────────────────────────────────────
const ADRESSE = { id: 1, name: 'Musterbetrieb AG', kundennummer: 'K0001', plz: '3000',
                  ort: 'Musterstadt', aktiv: 1, personen: [], kontaktwege: [] };
const PRODUKT = { id: 1, nummer: 'P0001', name: 'Nutzung', beschreibung: '',
                  einzelpreis_rappen: 12000, einheit: 'Monat', mwst_satz_bp: 810, sortierung: 10, aktiv: 1 };
const browser = await chromium.launch({ executablePath: browserPfad() });

async function cockpit(seite) {
  await seite.route('**/api/**', route => {
    const url = route.request().url();
    const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (url.includes('login.php')) { return send({ status: 'ok', token: 't', name: 'pruef', ist_admin: true }); }
    if (url.includes('me.php')) {
      return send({ status: 'ok', name: 'pruef', ist_admin: true, rollen: [],
        rechte: ['kunden_lesen', 'kunden_schreiben', 'offerten_lesen', 'offerten_schreiben',
                 'leistungen_lesen', 'leistungen_schreiben', 'betrieb_lesen'] });
    }
    if (url.includes('produkt_list')) { return send({ status: 'ok', produkte: [PRODUKT] }); }
    if (url.includes('beleg_list')) { return send({ status: 'ok', naechste_nummer: 'OF-0001', belege: [] }); }
    if (url.includes('kunden_list')) { return send({ status: 'ok', kunden: [ADRESSE] }); }
    if (url.includes('dashboard_stats')) {
      return send({ status: 'ok', kpi: { rapporte_monat: 0, rapporte_vormonat: 0, stunden_monat: 0,
        stunden_vormonat: 0, mitarbeiter: 0, kunden: 0, rapporte_total: 0 },
        verlauf: [], angemeldet: [], letzte_rapporte: [], ereignisse: [],
        ereignisse_unvollstaendig: [], pro_mitarbeiter: [] });
    }
    return send({ status: 'ok' });
  });
  await seite.goto(`file://${WURZEL}/dashboard.html`);
  await seite.fill('#gName', 'pruef'); await seite.fill('#gPass', 'x'); await seite.click('#gBtn');
  await seite.waitForSelector('#shell.on');
  await seite.waitForTimeout(350);
}

async function betreiber(seite) {
  await seite.route('**/api/**', route => {
    const url = route.request().url();
    const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (url.includes('betreiber_beleg_list.php')) { return send({ status: 'ok', eingerichtet: true, naechste_nummer: 'OF-0001', belege: [] }); }
    if (url.includes('betreiber_kunden_list.php')) { return send({ status: 'ok', eingerichtet: true, naechste_nummer: 'K0002', kunden: [ADRESSE] }); }
    if (url.includes('betreiber_produkt_list.php')) { return send({ status: 'ok', eingerichtet: true, produkte: [PRODUKT] }); }
    return send({ status: 'ok' });
  });
  await seite.goto(`file://${WURZEL}/betreiber.html`);
  await seite.evaluate(([adr, prod]) => {
    document.getElementById('tor').classList.add('versteckt');
    document.getElementById('haus').classList.remove('versteckt');
    offertenBereit = true; ofNaechsteNummer = 'OF-0001';
    produkte = [prod]; adressen = [Object.assign({ mandant_id: null }, adr)]; belege = [];
  }, [ADRESSE, PRODUKT]);
}

const MESSEN = () => {
  const karte = document.getElementById('ofVerlaufKarte');
  const sicht = el => !!el && el.offsetParent !== null && getComputedStyle(el).display !== 'none';
  const zeilen = [...karte.querySelectorAll('tbody tr')];
  const kopf = karte.querySelector('thead');
  const knopf = karte.querySelector('.vl-auf');
  const pos = karte.querySelector('.vl-pos'), neg = karte.querySelector('.vl-neg');
  const form = document.getElementById('ofVerlaufKarte').parentElement;
  const kr = karte.getBoundingClientRect(), fr = form.getBoundingClientRect();
  const erste = zeilen[0];
  return {
    sicht: sicht(karte),
    breiteAnteil: fr.width ? kr.width / fr.width : 0,
    unterAbschluss: (() => {
      const ab = form.querySelector('.of-abschluss');
      return !!ab && ab.getBoundingClientRect().bottom <= kr.top + 1;
    })(),
    zeilen: zeilen.length,
    texte: zeilen.map(z => z.querySelector('.vl-was').textContent),
    kopfSicht: sicht(kopf),
    hinweis: (karte.querySelector('.vl-hinweis') || {}).textContent || '',
    leer: (karte.querySelector('.vl-leer') || {}).textContent || '',
    etiketten: karte.querySelectorAll('.vl-etikett').length,
    empfaengerZeilen: zeilen.filter(z => z.dataset.art === 'empfaenger').length,
    etikettText: (karte.querySelector('.vl-etikett') || {}).textContent || '',
    posFarbe: pos ? getComputedStyle(pos).color : '', negFarbe: neg ? getComputedStyle(neg).color : '',
    posVar: getComputedStyle(document.documentElement).getPropertyValue('--pos').trim(),
    gefaerbt: karte.querySelectorAll('.vl-pos, .vl-neg').length,
    knopfFrei: !!knopf && !knopf.disabled,
    knopfHoehe: knopf ? knopf.getBoundingClientRect().height : 0,
    detailsVersteckt: knopf ? document.getElementById(knopf.getAttribute('aria-controls')).hidden : null,
    tdAnzeige: erste ? getComputedStyle(erste.querySelector('td')).display : '',
    zeitOben: erste ? erste.querySelector('.vl-zeit').getBoundingClientRect().top
                      < erste.querySelector('.vl-was').getBoundingClientRect().top - 2 : false,
    waagrecht: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
      || karte.scrollWidth > karte.clientWidth + 1,
  };
};

async function durchgang(name, oeffnen, breite) {
  const seite = await browser.newPage({ viewport: { width: breite, height: 900 } });
  const fehler = [];
  seite.on('pageerror', e => fehler.push(e.message));
  await oeffnen(seite);
  await seite.evaluate(() => { ofNeu('offerte'); });
  await seite.waitForTimeout(120);
  const neu = await seite.evaluate(MESSEN);
  // Ein gespeicherter, angenommener (gesperrter) Beleg mit dem echten Verlauf.
  await seite.evaluate(v => {
    ofFormId = 5; ofFormEntschiedenAm = '2031-05-04 10:05:00'; ofFormToken = 't';
    ofFassungZeichnen({ fassungen: [{ nummer: 2, versendet_am: '2031-05-03 15:00:01' }],
                        fassung_geaendert: false, gesperrt: true });
    ofVerlaufZeichnen(v, true);
    // Die Sperre greift erneut, NACHDEM der Verlauf steht (wie beim
    // Nachladen): Aufklappen ist kein Aendern und muss bedienbar bleiben.
    ofFassungZeichnen({ fassungen: [{ nummer: 2, versendet_am: '2031-05-03 15:00:01' }],
                        fassung_geaendert: false, gesperrt: true });
  }, DATEN.voll);
  await seite.waitForTimeout(80);
  const voll = await seite.evaluate(MESSEN);
  await seite.evaluate(() => document.querySelector('#ofVerlaufKarte .vl-auf').click());
  const auf = await seite.evaluate(() => {
    const k = document.querySelector('#ofVerlaufKarte .vl-auf');
    const ul = document.getElementById(k.getAttribute('aria-controls'));
    return { hidden: ul.hidden, expanded: k.getAttribute('aria-expanded'), text: ul.textContent };
  });
  // Eine Ablehnung (rot), aus der echten Ausgabe abgeleitet.
  await seite.evaluate(v => {
    const ab = JSON.parse(JSON.stringify(v));
    ab.eintraege[0] = Object.assign({}, ab.eintraege[0], { was: 'Abgelehnt (Fassung 2)', ton: 'neg' });
    ofFassungZeichnen(null);
    ofVerlaufZeichnen(ab, true);
  }, DATEN.voll);
  const rot = await seite.evaluate(MESSEN);
  const lagen = {};
  for (const [lage, v] of [['alt', DATEN.alt], ['ohneLog', Object.assign({}, DATEN.alt, { log_da: false, vor_log: false, log_seit: null })],
                           ['nichts', { eintraege: [], log_da: true, vor_log: false, log_seit: '2031-01-01 00:00:00' }],
                           ['fehler', null]]) {
    await seite.evaluate(x => ofVerlaufZeichnen(x, true), v);
    lagen[lage] = await seite.evaluate(MESSEN);
  }
  await seite.close();
  return { name, breite, neu, voll, auf, rot, lagen, fehler };
}

const laeufe = [];
for (const [name, f] of [['Betreiber', betreiber], ['Cockpit', cockpit]]) {
  // Der Betreiber-Bereich hat keine mobile Fassung (ENT-701): nur am Desktop.
  for (const breite of name === 'Betreiber' ? [1280] : [1280, 390]) { laeufe.push(await durchgang(name, f, breite)); }
}
await browser.close();

const soll = DATEN.voll.eintraege.length;
for (const e of laeufe) {
  const n = `${e.name} ${e.breite}px`;
  check(`${n} — keine Skriptfehler (${e.fehler.join(' / ')})`, e.fehler.length === 0);
  check(`KRITISCH: ${n} — ein neuer, ungespeicherter Beleg zeigt keinen Verlauf`, !e.neu.sicht);
  check(`KRITISCH: ${n} — gespeichert: die Karte steht da, mit allen ${soll} Eintraegen, neueste zuoberst`,
    e.voll.sicht && e.voll.zeilen === soll && e.voll.texte[0].includes('Angenommen (Fassung 2)')
    && e.voll.texte[soll - 1] === 'Angelegt');
  check(`KRITISCH: ${n} — volle Breite, unter dem Formularabschluss`,
    e.voll.breiteAnteil > 0.97 && e.voll.unterAbschluss);
  check(`KRITISCH: ${n} — jede Handlung des Empfaengers traegt das Etikett "Empfänger"`,
    e.voll.etiketten === e.voll.empfaengerZeilen
    && e.voll.etiketten === DATEN.voll.eintraege.filter(x => x.wer_art === 'empfaenger').length
    && e.voll.etiketten > 0 && e.voll.etikettText === 'Empfänger');
  check(`KRITISCH: ${n} — nur die Annahme ist gefaerbt, gruen wie --pos`,
    e.voll.gefaerbt === 1 && e.voll.posFarbe !== '' && e.voll.posFarbe !== 'rgb(0, 0, 0)');
  check(`KRITISCH: ${n} — eine Ablehnung ist rot`, e.rot.gefaerbt === 1 && e.rot.negFarbe !== '' && e.rot.negFarbe !== e.voll.posFarbe);
  check(`KRITISCH: ${n} — Gruppen sind zu, lassen sich aber auch im gesperrten Beleg aufklappen`,
    e.voll.knopfFrei && e.voll.detailsVersteckt === true && e.auf.hidden === false && e.auf.expanded === 'true'
    && /Positionen: geändert/.test(e.auf.text) && /Total: CHF 650\.00 → CHF 700\.00/.test(e.auf.text));
  check(`KRITISCH: ${n} — aelter als die Erfassung: das wird gesagt, mit Datum`,
    e.lagen.alt.hinweis.includes('älter als die Erfassung') && e.lagen.alt.hinweis.includes('01.07.2031') && e.lagen.alt.zeilen === 2);
  check(`KRITISCH: ${n} — ohne Logbuch: "nicht eingerichtet", die uebrigen Eintraege stehen trotzdem da`,
    e.lagen.ohneLog.hinweis.includes('nicht eingerichtet') && e.lagen.ohneLog.zeilen === 2);
  check(`KRITISCH: ${n} — noch nichts: "Noch nichts erfasst", ohne Hinweis`,
    e.lagen.nichts.leer === 'Noch nichts erfasst.' && e.lagen.nichts.hinweis === '');
  check(`KRITISCH: ${n} — Lesefehler: "Nicht abrufbar", nicht "nichts"`,
    e.lagen.fehler.sicht && e.lagen.fehler.leer.startsWith('Nicht abrufbar') && e.lagen.fehler.zeilen === 0);
  const texte = new Set([e.lagen.alt.hinweis, e.lagen.ohneLog.hinweis, e.lagen.nichts.leer, e.lagen.fehler.leer]);
  check(`${n} — vier Lagen, vier verschiedene Texte`, texte.size === 4);
  check(`KRITISCH: ${n} — keine waagrechte Scrollleiste`, !e.voll.waagrecht);
  if (e.breite === 1280) {
    check(`${n} — Desktop: Tabelle mit Kopfzeile Zeit | Wer | Was`, e.voll.kopfSicht && e.voll.tdAnzeige === 'table-cell');
    check(`${n} — Desktop: das Aufklappen steht auf der Textzeile, nicht als 44-px-Knopf (gemessen: ${e.voll.knopfHoehe}px)`,
      e.voll.knopfHoehe > 0 && e.voll.knopfHoehe < 26);
  } else {
    check(`KRITISCH: ${n} — Handy: gestapelt, Zeit und Wer oben, Was darunter`,
      !e.voll.kopfSicht && e.voll.tdAnzeige !== 'table-cell' && e.voll.zeitOben);
    check(`KRITISCH: ${n} — Handy: das Aufklappen ist mindestens 44 px hoch`, e.voll.knopfHoehe >= 44);
  }
}
const [bD, cD] = laeufe;
check('KRITISCH: beide Seiten zeigen dieselben Zeilen', JSON.stringify(bD.voll.texte) === JSON.stringify(cD.voll.texte));

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
