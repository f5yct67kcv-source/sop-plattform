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

// ── 3a. Der Weg zurueck nach dem Ablauf (ENT-634) ─────────────────────
//
// Strukturell geprueft, weil ein echter Aufruf eine Datenbank und einen
// Mailserver braucht. Die reine Logik (Mailtexte, Klassen, Abdruck) laeuft
// in pruef_demo_zugang.php und ist dort echt ausgefuehrt.
{
  const ablauf = nurCode(lies('backend/api/betreiber_demo_ablauf.php'));
  const weiter = nurCode(lies('backend/api/demo_weiter.php'));
  const beenden = nurCode(lies('backend/api/betreiber_demo_beenden.php'));

  // Die Mail sagt, dass die Daten geloescht sind. Ginge sie raus, BEVOR
  // die Instanz geleert ist, und das Leeren scheiterte, waere sie eine
  // Falschaussage -- und der Platz traegt dann noch die Daten.
  //
  // Gemessen wird die Stelle des AUFRUFS, nicht die der Definition: Die
  // Funktion steht weiter oben in der Datei, und ihr Name allein sagt
  // nichts ueber die Reihenfolge im Lauf.
  const aufruf = ablauf.indexOf('demo_ende_mail_senden($pdo');
  check('KRITISCH: die Abschiedsmail geht erst raus, nachdem der Zugang wirklich geschlossen ist',
    aufruf > 0
    && ablauf.indexOf('demo_instanz_leeren') < aufruf
    && ablauf.indexOf("status = 'abgelaufen'") < aufruf);
  // Ein Zugang, der geschlossen ist, bleibt geschlossen -- auch wenn der
  // Mailserver schweigt.
  check('KRITISCH: ein Fehlschlag beim Versand laesst den Ablauf nicht scheitern',
    /function demo_ende_mail_senden[\s\S]*?catch \(Throwable/.test(ablauf));
  // Der Not-Aus ist der Knopf fuer den Fall, dass etwas nicht stimmt.
  // Eine freundliche Mail mit Verkaufsknopf waere dann das Falsche
  // (Entscheidung des Projektinhabers, 2026-09-19).
  check('KRITISCH: beim Beenden von Hand geht KEINE Abschiedsmail raus',
    !/demo_ende_mail/.test(beenden));

  // Nur POST -- derselbe Scanner-Schutz wie bei demo_bestaetigen.php.
  check('KRITISCH: der Endpunkt antwortet nur auf POST, damit ein Mailscanner nichts ausloest',
    /REQUEST_METHOD'\]\s*!==\s*'POST'/.test(weiter) && /405/.test(weiter));
  // In der Tabelle steht der Abdruck, nicht der Wert (ENT-501). Gesucht
  // wird entsprechend ueber den Abdruck.
  check('KRITISCH: gesucht wird ueber den Abdruck, nie ueber den rohen Wert',
    /ende_abdruck = \?/.test(weiter) && /demo_ende_abdruck\(\$wert\)/.test(weiter)
    && !/ende_abdruck = '\s*\.\s*\$wert/.test(weiter));
  // Eine unbekannte Klasse darf nicht stillschweigend zu "keine Angabe"
  // werden -- dann stuende im Register eine Antwort, die niemand gab.
  check('KRITISCH: eine unbekannte Groessenangabe wird abgewiesen, nicht umgedeutet',
    /!\s*demo_groesse_gueltig\(\$groesse\)/.test(weiter) && /400/.test(weiter));
  // Der Zeitpunkt der ERSTEN Anfrage sagt, wie schnell jemand reagiert
  // hat. Ein zweiter Klick darf ihn nicht ueberschreiben.
  check('KRITISCH: ein zweiter Klick ueberschreibt den Zeitpunkt der ersten Anfrage nicht',
    /COALESCE\(weiter_am, NOW\(\)\)/.test(weiter));
  // Eine Meldung an den Betreiber darf den Interessenten nie etwas kosten.
  check('ein Fehlschlag beim Melden kostet den Interessenten nichts',
    /smtp_senden[\s\S]{0,400}catch \(Throwable/.test(weiter));

  // Beide Dateien muessen im Deploy-Buendel liegen. Genau daran ist der
  // Bestaetigungsweg schon einmal gescheitert: Der POST lief auf eine
  // 404-Seite ohne CORS-Kopfzeile, sichtbar nur als abgebrochene
  // Verbindung.
  const deploy = lies('.github/workflows/deploy-hostpoint.yml');
  check('KRITISCH: die Landeseite liegt im guardops-Buendel',
    /cp demo-weiter\.html\s+dist-guardops\/demo-weiter\.html/.test(deploy));
  check('KRITISCH: der Endpunkt liegt im Betreiber-Buendel',
    /cp backend\/api\/demo_weiter\.php\s+dist-betreiber\/api\/demo_weiter\.php/.test(deploy));
  // Ohne CORS-Freigabe bricht der POST von guardops.ch im Browser ab.
  check('KRITISCH: die Herkunft guardops.ch ist fuer diesen Endpunkt freigegeben',
    /OEFFENTLICHE_DEMO_SKRIPTE[\s\S]{0,200}demo_weiter\.php/.test(nurCode(lies('backend/db.php'))));
}

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
  /* Ein echter Mandant und zwei Demo-Plaetze im selben Stamm (ENT-627).
     demo3 fehlt ABSICHTLICH: Ein Platz ohne Mandanten-Zeile kommt an
     keine Datenbank, und das muss in der Platztabelle als eigene Aussage
     dastehen statt als fehlender Knopf. */
  'betreiber_mandant_list.php': { status: 'ok', anzahl: 3, mandanten: [
    { id: 1, name: 'Beispiel Betrieb AG', subdomain: 'beispiel', status: 'aktiv',
      kanton: 'SO', gav_lage: 'bestaetigt', verbindung_lage: 'vollstaendig',
      db_host: '', db_name: '', db_user: '', secret_name: '', ist_demo: false },
    { id: 2, name: 'Demo-Platz 1', subdomain: 'demo1', status: 'aktiv',
      kanton: null, gav_lage: 'unbestaetigt', verbindung_lage: 'vollstaendig',
      db_host: 'h', db_name: 'd1', db_user: 'u', secret_name: 'S1', ist_demo: true },
    { id: 3, name: 'Demo-Platz 2', subdomain: 'demo2', status: 'aktiv',
      kanton: null, gav_lage: 'unbestaetigt', verbindung_lage: 'vollstaendig',
      db_host: 'h', db_name: 'd2', db_user: 'u', secret_name: 'S2', ist_demo: true },
  ] },
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
    // Der Weg zurueck (ENT-634): Einer der drei hat nach dem Ablauf
    // geklickt und seine Betriebsgroesse angegeben.
    kennt_weiter: true, weiter_offen: 1,
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
        nachgefasst_am: tagVersatz(-6), nachgefasst_von: 'A. Betreiber',
        weiter_am: tagVersatz(-6), weiter_groesse: 'elfbis30',
        weiter_groesse_text: '11 bis 30 Mitarbeitende' },
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

/* ── Die Demo-Plaetze sind keine Mandanten (ENT-627) ──────────────────
   Sie STEHEN im Mandantenstamm -- ihre Datenbankverbindung haengt an
   dieser Zeile -- aber sie sind kein Betrieb, der die Plattform nutzt.
   Geprueft wird, was in der Liste landet, nicht wie gefiltert wird. */
const stamm = await seite.evaluate(() => {
  const zeilen = [...document.querySelectorAll('#m-inhalt tbody tr')]
    .map(r => r.querySelector('td strong')?.textContent.trim() || '');
  return {
    zeilen,
    hinweis: document.querySelector('#m-inhalt + .hinweis, #m-inhalt .hinweis')?.textContent.trim()
      || (document.getElementById('m-inhalt').parentElement.querySelector('.hinweis')?.textContent.trim() || ''),
    text: document.getElementById('mv-mandanten').innerText,
    /* textContent und nicht innerText: Die Kennzahlen stehen im Bereich
       "Uebersicht", der gerade verborgen ist -- innerText liefert dort
       nichts, und die Pruefung waere gruen, weil sie nichts gelesen hat. */
    mandantenZahl: (() => {
      const b = [...document.querySelectorAll('#u-zahlen .zahl')]
        .find(z => z.querySelector('.lab')?.textContent.trim() === 'Mandanten');
      return b ? b.querySelector('.wert').textContent.trim() : null;
    })(),
  };
});
check('KRITISCH: die Mandantenliste zeigt nur echte Betriebe, keine Demo-Plätze',
  stamm.zeilen.length === 1 && stamm.zeilen[0] === 'Beispiel Betrieb AG');
// Eine gefilterte Zahl ohne Bezug sieht aus wie die Gesamtzahl (Hausregel).
// "1 Mandant" allein saehe aus, als laufe hier genau eine Instanz.
check('KRITISCH: die ausgeblendeten Demo-Plätze stehen mit Zahl und Ort da',
  /2 Demo-Plätze stehen im Reiter Demo/.test(stamm.text));
// Die Kopfzahlen zaehlen dasselbe wie die Liste -- sonst stehen oben vier
// Mandanten und unten einer.
check('KRITISCH: der Kopfzähler zählt echte Mandanten, nicht die Demo-Plätze',
  stamm.mandantenZahl === '1');

/* Ab hier die Demo-Ansicht. Geklickt wird der Reiter, den ein Mensch
   hier sieht: Ueber 1210 px hebt unterreiterZeichnen() die Leiste in die
   Werkzeugleiste (dieselbe Mechanik wie im Cockpit), darunter bleibt sie
   im Inhalt. Beide Wege muessen zum selben Ergebnis fuehren. */
/* Geprueft wird, dass die Kopie oben DIESELBEN Reiter traegt wie die Leiste
   im Inhalt -- nicht eine feste Namensliste. Mit ENT-637 ist ein dritter
   Reiter dazugekommen, und eine abgeschriebene Aufzaehlung waere daran
   zerbrochen, ohne dass an der Sache etwas falsch gewesen waere. */
const obenSichtbar = await seite.evaluate(() => {
  const leiste = document.getElementById('topSub');
  const innen = document.getElementById('mandTabs');
  if (!leiste || !innen || leiste.offsetHeight === 0) { return false; }
  const namen = el => [...el.querySelectorAll('button')].map(b => b.textContent.trim()).join('|');
  return namen(leiste) === namen(innen) && namen(leiste).split('|').length >= 2;
});
check('KRITISCH: am breiten Bildschirm stehen die Reiter in der Werkzeugleiste, wie im Cockpit',
  obenSichtbar);
/* Ueber die Beschriftung angesprochen und nicht ueber die Position: Ein
   neuer Reiter davor verschoebe sonst stillschweigend, was hier geklickt
   wird -- und die Pruefung liefe gruen an etwas anderem. */
await seite.click(obenSichtbar
  ? '#topSub button:text-is("Demo")'
  : '#mtab-demo');
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

/* ── Der Zustand eines Platzes steht als Wort da (ENT-627) ────────────
   Vorher trug nur der freie Platz einen Merker, und der stand in der
   Spalte "Belegt durch" -- "frei" ist aber keine Antwort darauf, WER
   darauf sitzt. Geprueft werden die Woerter je Zeile, nicht die Klassen. */
const platzTabelle = await seite.evaluate(() => {
  const kopf = [...document.querySelectorAll('#demo-plaetze thead th')]
    .map(t => t.textContent.trim());
  const zeilen = [...document.querySelectorAll('#demo-plaetze tbody tr')].map(r => {
    const td = [...r.querySelectorAll('td')];
    return {
      platz:  td[0]?.querySelector('strong')?.textContent.trim() || '',
      status: td[1]?.querySelector('.merker')?.textContent.trim() || '',
      wer:    td[2]?.textContent.trim() || '',
      knoepfe: [...(td[4]?.querySelectorAll('button') || [])].map(b => b.textContent.trim()),
      statusFarbe: td[1]?.querySelector('.merker')?.className || '',
      ohneZeile: (td[4]?.textContent || '').trim(),
    };
  });
  return { kopf, zeilen };
});
check('die Platztabelle hat eine eigene Spalte für den Zustand',
  platzTabelle.kopf[1] === 'Status' && platzTabelle.kopf[2] === 'Belegt durch');
check('KRITISCH: ein belegter Platz sagt "besetzt", ein freier "frei"',
  platzTabelle.zeilen.map(z => z.status).join('|') === 'besetzt|besetzt|frei');
// Die Farbe hebt hervor, was noch zu haben ist -- besetzt bleibt ruhig.
check('nur der freie Platz ist farbig hervorgehoben',
  /m-pos/.test(platzTabelle.zeilen[2].statusFarbe)
  && !/m-pos/.test(platzTabelle.zeilen[0].statusFarbe));
// "Belegt durch" traegt nur noch den Namen -- oder einen Strich.
check('KRITISCH: in "Belegt durch" steht der Name, nicht der Zustand',
  !/frei|besetzt/.test(platzTabelle.zeilen.map(z => z.wer).join(' '))
  && platzTabelle.zeilen[0].wer.length > 0);
// Seit die Plaetze aus der Mandantenliste heraus sind, ist das hier der
// einzige Weg zu ihrer Datenbankverbindung.
check('KRITISCH: jeder Platz mit Mandanten-Zeile trägt seine Knöpfe',
  platzTabelle.zeilen[0].knoepfe.join('|') === 'Ändern|Support'
  && platzTabelle.zeilen[1].knoepfe.join('|') === 'Ändern|Support');
// "Kein Knopf" und "gibt es nicht" sind verschiedene Aussagen (Hausregel).
check('KRITISCH: ein Platz ohne Mandanten-Zeile sagt das, statt still ohne Knöpfe dazustehen',
  platzTabelle.zeilen[2].knoepfe.length === 0
  && /nicht im Mandantenstamm/.test(platzTabelle.zeilen[2].ohneZeile));

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

/* ── Der Weg zurueck steht im Betreiber-Bereich (ENT-634) ─────────────
   Eine Anfrage, die nur im Postfach liegt, geht unter. Sie muss dort
   stehen, wo der Vertrieb ohnehin hinsieht -- und zwar beim NAMEN, nicht
   in der Statusspalte zwischen Ablauf und Nachfass-Stand. */
const weiterSicht = await seite.evaluate(() => {
  const zeilen = [...document.querySelectorAll('#demo-inhalt tbody tr')];
  const mit = zeilen.find(r => r.textContent.includes('probesecurity'));
  return {
    merker: mit ? [...mit.querySelectorAll('td:first-child .merker')]
      .map(m => m.textContent.trim()) : [],
    zelle:  mit ? mit.querySelector('td:first-child').textContent : '',
    ohne:   zeilen.filter(r => !r.textContent.includes('probesecurity'))
      .every(r => !/will weitermachen/.test(r.textContent)),
    fuss:   document.querySelector('#demo-plaetze + .hinweis, #demo-plaetze ~ .hinweis')
      ?.textContent.trim() || document.getElementById('mv-demo').innerText,
  };
});
check('KRITISCH: wer weitermachen will, steht mit Merker beim Namen',
  weiterSicht.merker.includes('will weitermachen'));
check('die angegebene Betriebsgrösse steht daneben, nicht nur der Schlüssel',
  /11 bis 30 Mitarbeitende/.test(weiterSicht.zelle)
  && !/elfbis30/.test(weiterSicht.zelle));
check('KRITISCH: wer nicht geklickt hat, trägt den Merker nicht', weiterSicht.ohne);
// Einheiten nicht vermischen: "Zugänge" zählt Interessenten mit offenem
// Zugang, "will weitermachen" zählt die, die nach dem Ablauf geklickt
// haben -- auch längst geschlossene.
check('die Zahl derer, die weitermachen wollen, steht mit eigenem Wort da',
  /1 will weitermachen/.test(weiterSicht.fuss));

/* ══ Die Landeseite nach der Abschiedsmail (ENT-634) ═════════════════

   DIE WICHTIGSTE PRUEFUNG HIER IST DIE ERSTE: Beim Laden darf NICHTS an
   den Server gehen. Outlook Safe Links und Virenscanner rufen jede Adresse
   aus einer Mail auf; loeste der Aufruf die Anfrage aus, bekaeme der
   Betreiber Anfragen von Betrieben, die nie geklickt haben. Gemessen wird
   der Netzverkehr, nicht der Quelltext. */
const WERT = 'a'.repeat(64);
const wSeite = await browser.newPage({ viewport: { width: 420, height: 900 } });
wSeite.on('pageerror', e => bad.push('JS-Fehler auf demo-weiter.html: ' + e.message));

let rufe = [];
await wSeite.route('**/api/demo_weiter.php', r => {
  rufe.push(JSON.parse(r.request().postData() || '{}'));
  r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ status: 'ok', erneut: false }) });
});

await wSeite.goto(`file://${WURZEL}/demo-weiter.html?w=${WERT}`);
await wSeite.waitForTimeout(400);
check('KRITISCH: beim blossen Aufruf geht nichts an den Server (Mailscanner)',
  rufe.length === 0);

const flaechen = await wSeite.evaluate(() => {
  const el = [...document.querySelectorAll('[data-groesse]')];
  return {
    klassen: el.map(e => e.getAttribute('data-groesse')),
    worte:   el.map(e => e.textContent.trim()),
    hoehen:  el.map(e => Math.round(e.getBoundingClientRect().height)),
    sichtbar: document.querySelector('.zustand.an')?.id || '',
  };
});
// Vier Antworten, nicht drei: "lieber nicht sagen" IST eine Antwort und
// darf nicht wie Nichtstun aussehen (Hausregel).
check('KRITISCH: es gibt drei Grössenklassen und eine ausdrückliche Verweigerung',
  flaechen.klassen.join('|') === 'bis10|elfbis30|ueber30|keine');
check('der Ausgangszustand ist die Frage, nicht eine Meldung',
  flaechen.sichtbar === 'z-bereit');
// Gemessen, nicht nachgelesen: Bedienelemente am Handy mindestens 44 px.
check('KRITISCH: die drei Knöpfe sind am Handy mindestens 44 px hoch',
  flaechen.hoehen.slice(0, 3).every(h => h >= 44));

// Ein Klick sendet Anfrage UND Grösse zusammen -- kein Formular, kein
// zweiter Schritt.
await wSeite.click('[data-groesse="elfbis30"]');
await wSeite.waitForTimeout(300);
const nachKlick = await wSeite.evaluate(() =>
  document.querySelector('.zustand.an')?.id || '');
check('KRITISCH: ein Klick auf eine Grösse schickt Anfrage und Angabe zusammen',
  rufe.length === 1 && rufe[0].w === WERT && rufe[0].groesse === 'elfbis30');
check('danach steht da, dass die Anfrage raus ist', nachKlick === 'z-fertig');
// Der Knopf hiess "weiter nutzen" -- die Seite muss sagen, dass der Zugang
// NICHT wieder aufgeht, sonst wartet jemand vergeblich auf eine Anmeldung.
const fertigText = await wSeite.evaluate(() =>
  document.getElementById('z-fertig').innerText);
check('KRITISCH: sie verspricht keine Wiederaufnahme, sondern eine Meldung',
  /melden uns/.test(fertigText) && /geschlossen/.test(fertigText));

// Ohne Wert in der Adresse gibt es nichts zu melden -- und auch dann geht
// nichts an den Server.
rufe = [];
await wSeite.goto(`file://${WURZEL}/demo-weiter.html`);
await wSeite.waitForTimeout(300);
const ohneWert = await wSeite.evaluate(() => ({
  sichtbar: document.querySelector('.zustand.an')?.id || '',
  flaechen: document.querySelectorAll('[data-groesse]').length,
}));
check('KRITISCH: ohne Wert aus der Mail sagt die Seite das, statt zu senden',
  ohneWert.sichtbar === 'z-unbekannt' && rufe.length === 0);

await wSeite.close();

await browser.close();

// ══════════ ZUGANGSDATEN ERNEUT SENDEN -- ZWEI WEGE (ENT-649) ═════════
//
// ANLASS: api/demo_erneut_senden.php war seit ENT-601 gebaut, ausgeliefert
// und tot -- keine einzige Seite rief ihn auf. Das faellt von selbst
// niemandem auf, weil ein Endpunkt, den niemand aufruft, auch nie
// fehlschlaegt. Diese Pruefungen halten beide Wege daran fest, dass sie
// erreichbar sind UND ihre jeweilige Eigenart behalten.
{
  const homepage  = lies('homepage.html');
  // OHNE KOMMENTARE gelesen. Beide Dateien erklaeren im Kopf ausfuehrlich,
  // was sie tun -- eine Suche im rohen Text faende die Aussage dort statt
  // im Code und bliebe gruen, wenn der Code verschwindet.
  const ohneKommentar = t => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const oeff      = ohneKommentar(lies('backend/api/demo_erneut_senden.php'));
  const betr      = ohneKommentar(lies('backend/api/betreiber_demo_erneut.php'));
  const betrSeite = lies('betreiber.html');

  // ── Der oeffentliche Weg ist erreichbar ─────────────────────────────
  check('KRITISCH: die Homepage bietet den oeffentlichen Weg an -- der Endpunkt ist nicht mehr tot',
    /action="https:\/\/betreiber\.guardops\.ch\/api\/demo_erneut_senden\.php"/.test(homepage));
  // Der Honigtopf gehoert mitgeschickt: Der Endpunkt prueft ihn, und ein
  // Formular ohne das Feld liefert ihn nie -- die Falle waere wirkungslos.
  check('das Fallenfeld wird mitgeschickt, sonst prueft der Endpunkt ins Leere',
    /nochmal\.website\.value/.test(homepage));

  // ── Und er behaelt seine Eigenart: eine Antwort fuer jeden Fall ──────
  // Geprueft an der AUSSAGE, nicht am Wortlaut: Der Endpunkt darf nach
  // der Pruefung der Adresse keine unterschiedlichen Texte kennen. Es
  // gibt genau eine Konstante dafuer, und es darf bei einer bleiben.
  // AB DEM MOMENT, IN DEM DIE ADRESSE GELESEN WIRD. Davor steht die
  // Methodenpruefung ("nur POST"), und die darf einen eigenen Text haben:
  // Sie sieht keine Adresse und verraet darum auch keine. Erst danach
  // muss jede Antwort gleich lauten -- ob die Adresse einen Zugang hat,
  // ob der Versand klappt, ob die Bremse greift.
  const abAdresse = oeff.slice(oeff.search(/\$email\s*=/));
  // Jeden Fund einzeln ansehen statt mit einem negativen Blick nach vorn:
  // Der laesst sich durch Zurueckspringen aushebeln (\s* darf leer
  // treffen), und die Pruefung war dadurch beim ersten Anlauf rot,
  // obwohl der Code stimmte.
  const antworten = [...abAdresse.matchAll(/'message'\s*=>\s*([A-Za-z_'][^,\]]*)/g)]
    .map(m => m[1].trim());
  check('KRITISCH: der oeffentliche Weg kennt nur EINE Antwort -- sonst verraet er, welche Adresse einen Zugang hat',
    abAdresse.length > 200
    && antworten.length >= 3 && antworten.every(a => a === 'DEMO_ERNEUT_DANKE'));
  check('und er hat eine eigene Bremse', /demo_bremse_pruefen\(/.test(oeff));
  // Die Oberflaeche darf die Antwort nicht auswerten -- taete sie es,
  // gaebe sie preis, was der Endpunkt verbirgt.
  check('KRITISCH: die Homepage wertet die Antwort NICHT aus',
    !/nochmal[\s\S]{0,1600}json\.status\s*===/.test(homepage));

  // ── Der Betreiber-Weg: das genaue Gegenteil, und das mit Absicht ─────
  check('KRITISCH: der Betreiber-Weg verlangt eine Anmeldung', /require_betreiber_voll\(/.test(betr));
  check('er nimmt nur POST', /REQUEST_METHOD'\]\s*!==\s*'POST'/.test(betr));
  check('KRITISCH: er sendet nur bei laufenden Zugaengen -- sonst gibt es kein Konto',
    /\$zugang\['status'\]\s*!==\s*'aktiv'/.test(betr));
  check('KRITISCH: er setzt das Passwort ueber dieselbe Funktion wie der oeffentliche Weg',
    /demo_zugang_neues_passwort\(/.test(betr) && /demo_zugang_neues_passwort\(/.test(oeff));
  // Der Fall, der wirklich wehtut: Passwort neu, Mail weg. Wer das
  // verschweigt, laesst einen Interessenten ausgesperrt zurueck, ohne
  // dass jemand den Grund kennt.
  check('KRITISCH: scheitert der Versand, sagt er, dass das Passwort trotzdem schon neu ist',
    /catch[\s\S]{0,600}Passwort wurde neu gesetzt/.test(betr));
  // Die einzige Spur: Es gibt bewusst keine Spalte dafuer.
  check('KRITISCH: der Vorgang steht im Logbuch -- es ist die einzige Spur',
    /be_log\(/.test(betr));

  // ── Und der Knopf dazu ──────────────────────────────────────────────
  check('KRITISCH: die Demo-Zeile hat den Knopf', /data-demo-erneut/.test(betrSeite));
  check('KRITISCH: er fragt vorher nach -- dabei entsteht ein neues Passwort',
    /async function demoErneut\([\s\S]{0,900}confirm\(/.test(betrSeite));
  check('und die Rueckfrage sagt, was geschieht, nicht nur "sind Sie sicher"',
    /async function demoErneut\([\s\S]{0,900}NEUES Passwort/.test(betrSeite));
}

// ── Ergebnis ──────────────────────────────────────────────────────────
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden`);
if (bad.length) { bad.forEach(n => console.log('  ✗ ' + n)); process.exit(1); }
console.log('\nAlle Pruefungen bestanden.');
