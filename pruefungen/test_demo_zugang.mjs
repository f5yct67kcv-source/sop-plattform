// Demo-Zugaenge je Interessent (ENT-600).
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
import { WURZEL } from './pfade.mjs';

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

// ── Ergebnis ──────────────────────────────────────────────────────────
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden`);
if (bad.length) { bad.forEach(n => console.log('  ✗ ' + n)); process.exit(1); }
console.log('\nAlle Pruefungen bestanden.');
