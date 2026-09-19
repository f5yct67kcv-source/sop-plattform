// Demo-Zugaenge je Interessent (ENT-600, seit ENT-601 automatische
// Selbstbedienung statt Betreiber-Freigabe).
//
// Zwei Sorten Nachweis:
//   1. Die reinen Funktionen wirklich ausfuehren (pruef_demo_zugang.php).
//   2. Die Verdrahtung, die eine PHP-Datei allein nicht zeigen kann: dass
//      das Register angelegt wird, dass es in der richtigen Datenbank
//      liegt, und dass der Rechenkern in jedem Buendel mitgeht, das
//      betreiber.php ausliefert. Fehlt er dort, stirbt der ganze
//      Betreiber-Bereich beim ersten Aufruf -- nicht erst die
//      Demo-Freigabe.
import { readFileSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const HIER = new URL('.', import.meta.url).pathname;
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);
const lies = p => readFileSync(join(WURZEL, p), 'utf8');
const nurCode = q => q.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ── 1. Die reinen Funktionen wirklich ausfuehren ──────────────────────
let phpAus = '', phpCode = 0;
try {
  phpAus = execFileSync('php', [`${HIER}/pruef_demo_zugang.php`], { encoding: 'utf8' });
} catch (e) {
  phpAus = String(e.stdout || '') + String(e.stderr || '');
  phpCode = e.status || 1;
}
const phpAnzahl = Number((phpAus.match(/^(\d+) bestanden/m) || [0, 0])[1]);
// phpAnzahl > 0 gehoert MIT in die kritische Bedingung: Stuerzt die
// PHP-Datei ab, bevor sie ihre Zusammenfassung druckt, ist phpCode 0 und
// kein "x " im Auswurf -- die Pruefung waere gruen, obwohl nichts gelaufen
// ist (derselbe Fall wie in test_betreiber.mjs).
check('die PHP-Pruefungen der Demo-Zugaenge laufen durch', phpAnzahl > 0);
check('KRITISCH: alle PHP-Faelle bestehen (Platzwahl, Ablauf, Texte, Anmeldename)',
  phpCode === 0 && phpAnzahl > 0 && !phpAus.includes('\nx '));
phpAus.split('\n').filter(z => z.startsWith('x ')).forEach(z => bad.push('PHP: ' + z.slice(2)));

// ── 2. Das Register wird auch angelegt ────────────────────────────────
// Eine Tabellendefinition, die in keiner Einrichtung vorkommt, ist ein
// Entwurf. be_tabellen() ist die EINE Liste, die beide Einrichtungswege
// benutzen (api/betreiber_einrichten.php und der Einrichtungsknopf des
// Cockpits) -- steht sie dort, wird sie angelegt.
const betreiber = lies('backend/betreiber.php');
check('KRITISCH: das Register steht in be_tabellen() und wird damit angelegt',
  /'demo_zugang'\s*=>\s*demo_zugang_tabelle\(\)/.test(nurCode(betreiber)));
check('KRITISCH: betreiber.php bindet den Rechenkern ein, statt die Definition zu kopieren',
  /require_once\s+__DIR__\s*\.\s*'\/demo_zugang\.php'/.test(nurCode(betreiber)));

// ── 3. Kein Passwort im Register ──────────────────────────────────────
// Der Hash gehoert ins Konto der Demo-Instanz. Hier wird am erzeugten
// SQL geprueft und nicht am Quelltext der Datei: Ein Kommentar, der es
// verspricht, ist keine Zusicherung.
let sql = '';
try {
  sql = execFileSync('php', ['-r',
    `require '${join(WURZEL, 'backend/demo_zugang.php')}'; echo demo_zugang_tabelle();`],
    { encoding: 'utf8' }).toLowerCase();
} catch (e) { sql = ''; }
check('die Tabellendefinition laesst sich erzeugen', sql.includes('create table'));
check('KRITISCH: im Register steht kein Passwort und kein Hash',
  sql.includes('create table') && !sql.includes('passwort') && !sql.includes('hash'));

// ── 3b. Telefon ist Pflicht, die Adresse wird geprueft (ENT-601/ENT-613) ─
// Strukturell geprueft, weil ein echter Aufruf eine Datenbank braucht --
// die reine Logik dahinter laeuft in pruef_demo_zugang.php.
const anfordern = nurCode(lies('backend/api/demo_anfordern.php'));
check('KRITISCH: demo_anfordern.php prueft die Telefonnummer, bevor ein Platz verbraucht wird',
  /!\s*demo_zugang_telefon_gueltig\(\$telefon\)/.test(anfordern)
  && anfordern.indexOf('demo_zugang_telefon_gueltig') < anfordern.indexOf('demo_platz_waehlen'));
check('KRITISCH: demo_anfordern.php prueft die Zustellbarkeit, bevor ein Platz verbraucht wird',
  /demo_zugang_adresse_zustellbar\(\$email\)\s*===\s*false/.test(anfordern)
  && anfordern.indexOf('demo_zugang_adresse_zustellbar') < anfordern.indexOf('demo_platz_waehlen'));
// Seit ENT-624 laeuft das Einrichten nicht mehr im Endpunkt, sondern in
// demo_zugang_einrichten() -- zwei Endpunkte brauchen es, und zwei Kopien
// waeren auseinandergelaufen. Die Aussagen darunter gelten unveraendert,
// sie werden nur an ihrem neuen Ort geprueft.
const einrichten = nurCode(lies('backend/demo_instanz.php'));
// Die Nummer muss BEIDE Stationen ueberstehen: die offene Anfrage und das
// Register. Faellt sie auf einer der beiden weg, steht im Register eine
// leere Zelle, und der Vertrieb hat nichts zum Anrufen.
check('das Telefon wird in der offenen Anfrage gespeichert, nicht verworfen',
  /INSERT INTO demo_bestaetigung[\s\S]{0,200}telefon/.test(anfordern)
  && /\$telefon\b/.test(anfordern));
check('das Telefon wird im Register gespeichert, nicht verworfen',
  /INSERT INTO demo_zugang[\s\S]{0,120}telefon/.test(einrichten)
  && /\$telefon\b/.test(einrichten));

// KRITISCH (gefunden live am 2026-09-18, ENT-612-Nachtrag): Bis hierher
// rief demo_anfordern.php demo_daten_erzeugen_ausfuehren() -- die Fassung,
// die json_response() SELBST aufruft und den Prozess damit beendet. Diese
// Anfrage macht danach aber noch weiter: das angeforderte Konto anlegen,
// den Registereintrag schreiben, die Mail verschicken. Der erste
// erfolgreiche Demo-Zugang ueberhaupt (erst moeglich, seit ENT-612 die
// Einrichtung selbst reparierte) haette diesen Rest stillschweigend
// abgeschnitten -- keine Zugangsdaten, keine Mail, obwohl der Musterbetrieb
// erfolgreich entstand.
check('KRITISCH: das Einrichten ruft die reine demo_daten_erzeugen() auf, nicht die selbst-antwortende Fassung',
  /\bdemo_daten_erzeugen\(\$instanz\)/.test(einrichten)
  && !/\bdemo_daten_erzeugen_ausfuehren\(/.test(einrichten));
// Und die Falle ist seit ENT-624 dieselbe geblieben, nur eine Ebene
// tiefer: demo_zugang_einrichten() antwortet ebenfalls nicht selbst --
// beide Aufrufer machen danach noch weiter (Meldung an den Betreiber,
// Vermerk am Bestaetigungssatz). Ein json_response() darin schnitte
// ihnen das stillschweigend ab.
const rumpf = einrichten.slice(einrichten.indexOf('function demo_zugang_einrichten'));
check('die Funktion wurde im Quelltext gefunden', rumpf.length > 400);
check('KRITISCH: demo_zugang_einrichten() antwortet nicht selbst, sondern gibt zurueck',
  rumpf.length > 400 && !rumpf.includes('json_response('));
// Kehrseite: Nach diesem Aufruf muss die Anfrage tatsaechlich weitergehen
// -- sonst waere die Aufteilung selbst zwecklos gewesen.
check('KRITISCH: nach der Musterbetrieb-Erzeugung entsteht noch das angeforderte Konto',
  einrichten.indexOf('demo_daten_erzeugen($instanz)') <
  einrichten.indexOf("INSERT INTO mitarbeiter"));

// ── 4. Der Rechenkern geht in JEDES Buendel mit, das betreiber.php hat ─
// Das ist der Fall, der beim ersten Bau tatsaechlich danebengegangen
// waere: betreiber.php in drei Buendeln, der neue require nur in einem.
// Gepruefte Aussage ist nicht "die Zeile steht da", sondern "zu jedem
// Ziel, das betreiber.php bekommt, gibt es ein Ziel fuer demo_zugang.php".
const workflow = lies('.github/workflows/deploy-hostpoint.yml');
const ziele = quelle => [...workflow.matchAll(
  new RegExp(`cp\\s+backend/${quelle}\\.php\\s+(\\S+)`, 'g'))]
  .map(m => m[1].replace(/\/[^/]+\.php$/, ''));
const zieleBetreiber = ziele('betreiber');
const zieleKern = ziele('demo_zugang');
check('betreiber.php geht in mehr als ein Buendel -- sonst prueft der naechste Punkt nichts',
  zieleBetreiber.length > 1);
const fehlend = zieleBetreiber.filter(z => !zieleKern.includes(z));
check('KRITISCH: jedes Buendel mit betreiber.php bekommt auch demo_zugang.php'
    + (fehlend.length ? ` -- fehlt in: ${fehlend.join(', ')}` : ''),
  zieleBetreiber.length > 0 && fehlend.length === 0);

// ── 5. Die Ansicht am gerenderten Zustand ─────────────────────────────
// Nicht im Quelltext nachgelesen, sondern gemessen (CLAUDE.md). Der Grund
// steht im Kommentar bei DEMO_STATUS_TEXT in betreiber.html: Beim ersten
// Bau war die Reihenfolge [Wort, Klasse] statt [Klasse, Wort] vertauscht.
// Die Tabelle zeigte daraufhin "m-ok" statt "läuft" -- im Quelltext sah
// nichts falsch aus, der Kasten hatte die richtige Grösse, die Farbe war
// da. Gesehen hat es erst ein Bildschirmfoto.
// Die Zeitpunkte werden vom heutigen Tag aus gerechnet und nicht
// festgenagelt: Ein festes Datum nahe beim heutigen Tag kippt beim
// Datumswechsel, und die Suite wäre über Nacht rot (CLAUDE.md,
// test_datumsfest.mjs achtet darauf).
const tagVersatz = n => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10) + ' 09:14:00';
};

const ANTWORTEN = {
  'betreiber_zf_status.php': { status: 'ok', eingerichtet: true },
  'betreiber_mandant_list.php': { status: 'ok', mandanten: [], anzahl: 0 },
  'betreiber_demo_list.php': {
    status: 'ok', laufzeit_tage: 14, plaetze_frei: 1, plaetze_total: 3, aktive: 2,
    plaetze: [
      { platz: 'demo1', adresse: 'https://demo1.guardops.ch', frei: false,
        firma: 'Muster Sicherheit GmbH', laeuft_ab_am: tagVersatz(11) },
      { platz: 'demo2', adresse: 'https://demo2.guardops.ch', frei: false,
        firma: 'Beispiel Wachdienst AG', laeuft_ab_am: tagVersatz(2) },
      { platz: 'demo3', adresse: 'https://demo3.guardops.ch', frei: true,
        firma: null, laeuft_ab_am: null },
    ],
    // Der Nachfass-Stand (ENT-622). Zwei offene, einer erledigt -- damit
    // beide Darstellungen und beide Knoepfe in derselben Liste vorkommen.
    kennt_nachfassen: true, nachfassen_offen: 2,
    zugaenge: [
      { id: 3, platz: 'demo1', firma: 'Muster Sicherheit GmbH', person: 'R. Muster',
        email: 'r.muster@beispiel.ch', login: 'mustersicherh', status: 'aktiv',
        laeuft_ab_am: tagVersatz(11), abgelaufen: false, resttage: 11, beendet_am: null,
        nachgefasst_am: null, nachgefasst_von: '' },
      { id: 2, platz: 'demo2', firma: 'Beispiel Wachdienst AG', person: 'S. Beispiel',
        email: 's.beispiel@beispiel.ch', login: 'beispielwachd', status: 'aktiv',
        laeuft_ab_am: tagVersatz(0), abgelaufen: true, resttage: 0, beendet_am: null,
        nachgefasst_am: null, nachgefasst_von: '' },
      { id: 1, platz: 'demo3', firma: 'Probe Security GmbH', person: 'T. Probe',
        email: 't.probe@beispiel.ch', login: 'probesecurity', status: 'abgelaufen',
        laeuft_ab_am: tagVersatz(-7), abgelaufen: false, resttage: null,
        beendet_am: tagVersatz(-7),
        nachgefasst_am: tagVersatz(-6), nachgefasst_von: 'A. Betreiber' },
    ],
  },
};

const browser = await chromium.launch({ executablePath: browserPfad() });
const seite = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
seite.on('pageerror', e => bad.push('JS-Fehler in der Ansicht: ' + e.message));
// Muster mit ** statt *: Seit ENT-605 rufen manche Endpunkte mit einem
// Fragezeichen dahinter (betreiber_beleg_list.php?art=offerte). "*.php"
// trifft die nicht -- der Aufruf ginge dann als echte Datei-Anfrage ins
// Leere und die Seite bekaeme einen Netzfehler, der mit dieser Pruefung
// nichts zu tun hat.
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
await seite.click('#kopf-nav .nav-item[data-bereich="mandanten"]');
await seite.waitForTimeout(350);

/* Getrennte Reiter seit ENT-626: Der Mandantenstamm und die Demo-Plaetze
   stehen nicht mehr untereinander auf einer Seite. Gemessen statt
   nachgelesen -- die Hoehe sagt, ob die Karte wirklich da ist. */
const getrennt = await seite.evaluate(() => ({
  demoVersteckt: document.getElementById('mv-demo').offsetHeight === 0,
  stammDa:       document.getElementById('mv-mandanten').offsetHeight > 0,
  unterzeile:    document.getElementById('leiste-unter').textContent.trim(),
}));
check('KRITISCH: unter "Mandanten" stehen die Demo-Plätze nicht mehr daneben (ENT-626)',
  getrennt.demoVersteckt && getrennt.stammDa);
check('die Unterzeile im Kopf sagt, welcher Reiter offen ist',
  /Betriebe/.test(getrennt.unterzeile));

/* Ab hier die Demo-Ansicht. Geklickt wird der Reiter, den ein Mensch
   hier sieht: Ueber 1210 px hebt unterreiterZeichnen() die Leiste in die
   Werkzeugleiste (dieselbe Mechanik wie im Cockpit), darunter bleibt sie
   im Inhalt. Beide Wege muessen zum selben Ergebnis fuehren. */
const obenSichtbar = await seite.evaluate(() => {
  const leiste = document.getElementById('topSub');
  return !!leiste && leiste.offsetHeight > 0
    && [...leiste.querySelectorAll('button')].map(b => b.textContent.trim()).join('|') === 'Mandanten|Demo';
});
check('KRITISCH: am breiten Bildschirm stehen die Reiter in der Werkzeugleiste, wie im Cockpit',
  obenSichtbar);
await seite.click(obenSichtbar ? '#topSub button:nth-child(2)' : '#mtab-demo');
await seite.waitForTimeout(250);

const demoReiter = await seite.evaluate(() => ({
  demoDa:        document.getElementById('mv-demo').offsetHeight > 0,
  stammVersteckt: document.getElementById('mv-mandanten').offsetHeight === 0,
  unterzeile:    document.getElementById('leiste-unter').textContent.trim(),
  titel:         document.getElementById('leiste-titel').textContent.trim(),
}));
check('KRITISCH: der Reiter "Demo" zeigt die Demo-Ansicht und blendet den Stamm aus',
  demoReiter.demoDa && demoReiter.stammVersteckt);
// Wie im Cockpit: die Ueberschrift bleibt, die Unterzeile wechselt mit dem
// Reiter. Sonst stuende ueber der Demo-Ansicht, sie zeige Betriebe.
check('KRITISCH: die Unterzeile wechselt mit dem Reiter, die Überschrift nicht',
  demoReiter.titel === 'Mandanten' && /Demo/.test(demoReiter.unterzeile));

const sicht = await seite.evaluate(() => {
  const zellen = sel => [...document.querySelectorAll(sel)].map(e => e.textContent.trim());
  /* Nur der erste Merker der Zelle: Seit ENT-622 steht darunter noch der
     Nachfass-Stand. Die ganze Zelle zu lesen hiesse, zwei Aussagen zu
     einer zu verruehren -- genau das, wogegen diese Pruefung da ist. */
  const merkerWorte = [...document.querySelectorAll('#demo-inhalt tbody tr td:nth-child(4)')]
    .map(e => (e.querySelector('.merker') || e).textContent.trim());
  return {
    titel: document.getElementById('leiste-titel').textContent.trim(),
    plaetze: document.querySelectorAll('#demo-plaetze tbody tr').length,
    zugaenge: document.querySelectorAll('#demo-inhalt tbody tr').length,
    merkerWorte,
    text: document.body.innerText,
    // Seit ENT-601 gibt es keinen Freigabe-Knopf mehr -- die Zuteilung
    // laeuft automatisch. Das Fehlen dieses Elements ist die Aussage, nicht
    // eine seiner Masse.
    freigebenKnopfWeg: document.getElementById('knopf-demo-neu') === null,
    // ── Nachfassen (ENT-622) ──
    abzeichen: (() => {
      const el = document.getElementById('nav-demo-abz');
      if (!el) { return null; }
      const knopf = el.closest('.nav-item');
      return { versteckt: el.hidden, wort: el.textContent.trim(),
        angesagt: knopf ? knopf.getAttribute('aria-label') : '',
        bereich: knopf ? knopf.dataset.bereich : '' };
    })(),
    nachfassKnoepfe: document.querySelectorAll('[data-demo-nachgefasst]').length,
    zurueckKnoepfe:  document.querySelectorAll('[data-demo-offen]').length,
    // Die Zeile des erledigten Zugangs -- sie darf keinen offenen Merker
    // tragen und muss sagen, wer wann nachgefasst hat.
    erledigteZeile: [...document.querySelectorAll('#demo-inhalt tbody tr')]
      .map(r => r.textContent).find(t => t.includes('probesecurity')) || '',
  };
});

check('die Ansicht heisst weiterhin "Mandanten" -- Demo ist ein Unterreiter darin, kein eigener oberster Reiter (ENT-600/ENT-626)',
  sicht.titel === 'Mandanten');
check('der Vorrat zeigt alle gemeldeten Plätze', sicht.plaetze === 3);
check('die Liste zeigt alle Zugänge', sicht.zugaenge === 3);
check('KRITISCH: es gibt keinen Freigabe-Knopf mehr -- die Zuteilung läuft automatisch (ENT-601)',
  sicht.freigebenKnopfWeg);
// DER Punkt: Wörter, keine Klassennamen.
check('KRITISCH: die Statusspalte zeigt Wörter, keinen CSS-Klassennamen',
  sicht.merkerWorte.length === 3
  && sicht.merkerWorte.every(w => w.length > 0 && !/^m-/.test(w)));
check('und zwar die richtigen',
  sicht.merkerWorte.join('|') === 'läuft|läuft|abgelaufen');
// "Frist um" ist etwas anderes als "0 Tage": Der Zugang ist abgelaufen,
// aber noch nicht geschlossen -- der Fall, der eine Handlung braucht.
check('KRITISCH: ein abgelaufener, noch offener Zugang sagt das auch',
  sicht.text.includes('Frist um') && sicht.text.includes('noch nicht geschlossen'));
// Eine gefilterte Zahl ohne Bezug sieht aus wie die Gesamtzahl (Hausregel).
check('KRITISCH: die freien Plätze stehen mit Bezug da, nicht als nackte Zahl',
  /\d+ von \d+ Plätzen frei/.test(sicht.text));
// Einheiten nicht vermischen: Plätze zählen Instanzen, Zugänge zählen
// Interessenten -- beide Zahlen stehen mit ihrem eigenen Wort da.
check('Plätze und Zugänge stehen als zwei verschiedene Zahlen da',
  /Plätzen frei/.test(sicht.text) && /laufende Zugänge/.test(sicht.text));

// ── Nachfassen (ENT-622) ──────────────────────────────────────────────
//
// Der Melder ist das Abzeichen am Reiter -- es steht in JEDEM Bereich im
// Blick, nicht nur in dieser Ansicht. Geprueft wird die Aussage: Es traegt
// die Zahl der offenen, sitzt an dem Reiter, unter dem die Demo-Zugaenge
// liegen, und sagt vorgelesen, WAS es zaehlt.
check('KRITISCH: das Abzeichen trägt die Zahl der Zugänge ohne Nachfassen',
  sicht.abzeichen !== null && sicht.abzeichen.versteckt === false
  && sicht.abzeichen.wort === '2');
check('es sitzt am Reiter, unter dem die Demo-Zugänge liegen (ENT-600)',
  sicht.abzeichen !== null && sicht.abzeichen.bereich === 'mandanten');
// Eine rote Scheibe mit einer 2 daran sagt einem Reiter namens "Mandanten"
// nichts. Wer die Seite hoert statt sieht, braucht das Wort dazu.
check('KRITISCH: vorgelesen sagt das Abzeichen, was es zählt -- nicht nur die Zahl',
  sicht.abzeichen !== null && /Demo/.test(sicht.abzeichen.angesagt)
  && /Nachfassen/.test(sicht.abzeichen.angesagt));

// Zwei offene, einer erledigt -- also zwei Knoepfe "Nachgefasst" und einer
// zum Zuruecknehmen. Ein Fehlklick darf eine Verkaufschance nicht dauerhaft
// aus dem Blick nehmen.
check('KRITISCH: jeder offene Zugang hat seinen Knopf, der erledigte den Weg zurück',
  sicht.nachfassKnoepfe === 2 && sicht.zurueckKnoepfe === 1);
// Der offene Fall ist farbig markiert, der erledigte sagt wer und wann --
// zwei verschiedene Aussagen, zwei verschiedene Darstellungen.
check('KRITISCH: der offene Fall ist als solcher markiert',
  sicht.text.includes('nachfassen'));
check('der erledigte nennt Datum und Konto, statt bloss zu verschwinden',
  /nachgefasst \d{4}-\d{2}-\d{2}/.test(sicht.erledigteZeile)
  && sicht.erledigteZeile.includes('A. Betreiber'));

await browser.close();

// ── Ergebnis ──────────────────────────────────────────────────────────
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden`);
if (bad.length) { bad.forEach(n => console.log('  ✗ ' + n)); process.exit(1); }
console.log('\nAlle Pruefungen bestanden.');
