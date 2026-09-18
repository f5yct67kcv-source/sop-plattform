// Logbuch der Betreiber-Ebene (ENT-614).
//
// WAS HIER GEPRUEFT WIRD -- und was nicht: Ob die Eintraege in der richtigen
// Tabelle landen, laeuft wirklich, in pruef_logbuch.php (zweiter
// Tabellensatz, beide in EINER Datenbank). Hier steht die andere Haelfte:
// dass ueberhaupt jeder Schreibweg mitschreibt.
//
// DENN DAS IST DIE STELLE, AN DER ES SCHEITERN WIRD. Ein neuer Endpunkt im
// Betreiber-Bereich erbt die Regel nicht -- er schreibt einfach nichts ins
// Logbuch, und niemand merkt es, bis jemand im Verlauf nach einer Aenderung
// sucht, die nie eingetragen wurde. Genau diese Sorte Regel ist in diesem
// Projekt schon mehrfach an etwas Neuem gescheitert (CLAUDE.md).
//
// Darum: Jeder Endpunkt, der schreibt, ruft be_log() -- oder steht hier
// namentlich mit Grund. Dieselbe Bauart wie die Liste OHNE_ANMELDUNG in
// test_php.mjs.
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { WURZEL } from './pfade.mjs';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);
const lies = p => readFileSync(join(WURZEL, p), 'utf8');
// Kommentare zaehlen nicht als Code -- sonst genuegt das Wort "be_log" in
// einer Erklaerung, um diese Pruefung gruen zu faerben.
const nurCode = t => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const API = join(WURZEL, 'backend/api');
const endpunkte = readdirSync(API).filter(f => f.startsWith('betreiber_') && f.endsWith('.php'));

// ── Wer schreibt, schreibt mit ───────────────────────────────────────
//
// OHNE LOGBUCH -- jeder Eintrag mit Grund:
const OHNE_LOGBUCH = {
  'betreiber_anmelden.php':
    'Eine Anmeldung ist keine Aenderung. Jede einzelne mitzuschreiben waere ein '
    + 'Bewegungsprofil ueber die eigenen Leute; der Zeitpunkt der letzten steht '
    + 'ohnehin am Konto.',
  'betreiber_abmelden.php':
    'Loescht die eigene Sitzung. Dasselbe Argument wie bei der Anmeldung.',
  'betreiber_zf_einrichten.php':
    'Legt das Geheimnis an, bevor es bestaetigt ist. Der Eintrag entsteht bei der '
    + 'Bestaetigung (betreiber_zf_bestaetigen.php) -- ein abgebrochener Versuch ist '
    + 'kein Vorgang.',
  'betreiber_beleg_entscheidung.php':
    'Hier entscheidet der EMPFAENGER ueber den oeffentlichen Link, nicht die '
    + 'Betreiberin. Es gibt keinen angemeldeten Akteur, und die Entscheidung steht '
    + 'mit Zeitpunkt und Adresse am Beleg selbst.',
  'betreiber_beleg_oeffentlich.php':
    'Der oeffentliche Abruf eines Belegs. Schreibt nur den Abrufzeitpunkt.',
  'betreiber_demo_beenden.php':
    'Demo-Instanzen sind Wegwerfumgebungen (ENT-523), kein Bestand dieser Ebene.',
  'betreiber_demo_ablauf.php':
    'Dasselbe: raeumt abgelaufene Demo-Plaetze auf.',
};

const schreibt = /INSERT INTO|UPDATE\s+[a-z_]+\s+SET|DELETE FROM/i;
const ohne = endpunkte.filter(f => {
  const code = nurCode(lies(`backend/api/${f}`));
  if (!schreibt.test(code)) { return false; }
  if (/be_log\(|be_log_vergleich\(/.test(code)) { return false; }
  return !Object.prototype.hasOwnProperty.call(OHNE_LOGBUCH, f);
});
check('KRITISCH: jeder schreibende Betreiber-Endpunkt schreibt ins Logbuch — oder steht mit Grund in der Ausnahmeliste',
  ohne.length === 0);
if (ohne.length) { bad.push('ohne Logbuch und ohne Grund: ' + ohne.join(', ')); }

// Die Gegenrichtung: Eine Ausnahme fuer einen Endpunkt, den es nicht mehr
// gibt, macht die Liste unglaubwuerdig -- und verdeckt beim naechsten
// Umbenennen einen echten Fall.
const verwaist = Object.keys(OHNE_LOGBUCH).filter(f => !endpunkte.includes(f));
check('die Ausnahmeliste enthaelt keine Endpunkte, die es nicht mehr gibt', verwaist.length === 0);
if (verwaist.length) { bad.push('verwaiste Ausnahme: ' + verwaist.join(', ')); }

const unnoetig = Object.keys(OHNE_LOGBUCH).filter(f => {
  const code = nurCode(lies(`backend/api/${f}`));
  return /be_log\(|be_log_vergleich\(/.test(code);
});
check('kein Endpunkt steht in der Ausnahmeliste, obwohl er mitschreibt', unnoetig.length === 0);

// ── Das Praefix steht an genau einer Stelle ──────────────────────────
//
// Vergisst ein Endpunkt es, schreibt er nicht etwa nichts, sondern in die
// Tabelle der MANDANTIN. Darum ruft kein Endpunkt logbuch_schreiben()
// unmittelbar -- er nimmt be_log(), und dort steht 'be_' ein einziges Mal.
const direkt = endpunkte.filter(f =>
  /logbuch_schreiben\(|logbuch_vergleichen\(/.test(nurCode(lies(`backend/api/${f}`))));
check('KRITISCH: kein Betreiber-Endpunkt ruft das Logbuch am Praefix-Helfer vorbei',
  direkt.length === 0);
if (direkt.length) { bad.push('ruft direkt: ' + direkt.join(', ')); }

const modul = nurCode(lies('backend/betreiber.php'));
check('KRITISCH: es gibt genau einen Helfer je Schreibart, und nur dort steht das Praefix',
  /function be_log\(/.test(modul) && /function be_log_vergleich\(/.test(modul)
  && (modul.match(/'be_'\s*\)/g) || []).length >= 2);

// ── Die geschlossenen Mengen ─────────────────────────────────────────
const logbuch = nurCode(lies('backend/logbuch.php'));
check('KRITISCH: der Tabellensatz kommt aus einer geschlossenen Menge, nie aus der Anfrage',
  /const LOGBUCH_TABELLENSAETZE/.test(logbuch)
  && /in_array\(\$praefix, LOGBUCH_TABELLENSAETZE, true\)/.test(logbuch));
check('KRITISCH: ein unbekannter Tabellensatz wirft, statt einen Namen zu bauen',
  /throw new InvalidArgumentException/.test(logbuch));
check('KRITISCH: die Bereichsnamen gelten je Tabellensatz, nicht gemeinsam',
  /function logbuch_bereiche\(/.test(logbuch)
  && /in_array\(\$bereich, logbuch_bereiche\(\$tabPraefix\), true\)/.test(logbuch));

// ── Kein Weg, der Eintraege entfernt ─────────────────────────────────
//
// Ein Verlauf, den der Beobachtete aufraeumen kann, beantwortet die Frage
// nicht mehr, fuer die er da ist.
const loescht = [...endpunkte, 'logbuch.php'].filter(f => {
  const pfad = f === 'logbuch.php' ? 'backend/logbuch.php' : `backend/api/${f}`;
  return /DELETE FROM\s+be_aenderungslog|TRUNCATE\s+be_aenderungslog|UPDATE\s+be_aenderungslog/i
    .test(nurCode(lies(pfad)));
});
check('KRITISCH: es gibt keinen Weg, der Logbucheintraege loescht oder aendert', loescht.length === 0);
if (loescht.length) { bad.push('fasst das Logbuch an: ' + loescht.join(', ')); }

// ── Geheimnisse ohne Werte ───────────────────────────────────────────
//
// Dass ein Passwort gewechselt wurde, gehoert in den Verlauf. Womit, nie.
const pass = nurCode(lies('backend/api/betreiber_konto_passwort.php'));
check('KRITISCH: der Passwortwechsel steht ohne Werte im Logbuch',
  /be_log\([^;]*'passwort'[^;]*null,\s*null,\s*true\)/s.test(pass));
const zfZurueck = nurCode(lies('backend/api/betreiber_zf_zuruecksetzen.php'));
check('KRITISCH: das Zuruecksetzen des zweiten Faktors ebenfalls',
  /be_log\([^;]*null,\s*null,\s*true\)/s.test(zfZurueck));

// ── Der Leseweg ──────────────────────────────────────────────────────
const list = nurCode(lies('backend/api/betreiber_logbuch_list.php'));
check('KRITISCH: das Logbuch liest nur, wer auf dieser Ebene voll angemeldet ist',
  /require_betreiber_voll\(\)/.test(list));
check('das Logbuch kommt aus dem Betreiber-Tabellensatz',
  /logbuch_lesen\([^;]*'be_'/s.test(list));
check('nicht eingerichtet und nichts passiert sind zwei Aussagen',
  /tabelle_da/.test(list));
check('die Liste sagt ihre Grenze mit, damit eine abgeschnittene nicht wie die ganze aussieht',
  /'grenze'/.test(list));

// ── Die Oberflaeche ──────────────────────────────────────────────────
const seite = lies('betreiber.html');
check('KRITISCH: die Oberflaeche unterscheidet "Tabelle fehlt" von "keine Eintraege"',
  /Logbuch noch nicht eingerichtet/.test(seite) && /Noch keine Einträge/.test(seite));
check('und "kein Treffer" von "nichts vorhanden"',
  /Keine Treffer[\s\S]{0,400}Für diese Auswahl/.test(seite));
check('ein verborgener Wert erscheint als "geändert", nicht als leer',
  /werte_verborgen[\s\S]{0,200}geändert/.test(seite));
check('das Logbuch ist ein Unterreiter des Konten-Bereichs',
  /id="ktab-logbuch"/.test(seite) && /class="tabs haupt" id="kontenTabs"/.test(seite));
check('es laesst sich nach Bereich und nach Person filtern',
  /id="kLogBereich"/.test(seite) && /id="kLogAkteur"/.test(seite));

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden`);
if (bad.length) {
  console.log('\n' + bad.map(b => '  ✗ ' + b).join('\n'));
  process.exit(1);
}
console.log('\nAlle Pruefungen bestanden.');
