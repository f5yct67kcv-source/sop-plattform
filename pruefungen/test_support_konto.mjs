// Das Support-Konto zaehlt nicht zur Belegschaft (ENT-631).
//
// WARUM ES DIESE SUITE GIBT: Seit ENT-631 traegt jeder Betrieb ein Konto
// "GuardOpS Support". Es liegt in derselben Tabelle wie die Belegschaft
// und ist fuer jede Abfrage, die nicht ausdruecklich etwas anderes sagt,
// ein Mitarbeitender wie jeder andere. In einer Demo mit fuenf erfundenen
// Leuten stuende sonst "Mitarbeitende: 6".
//
// Das ist die Sorte Regel, die hier schon mehrfach an etwas NEUEM
// gescheitert ist, das sie nicht geerbt hat (CLAUDE.md). Darum steht sie
// im Netz: Jede Abfrage, die die Mitarbeitertabelle AUFZAEHLT, muss
// ma_nur_menschen() benutzen -- oder namentlich hier stehen, mit Grund.
//
// NICHT BETROFFEN sind Abfragen mit Einzelbezug (WHERE id = ?, WHERE
// name = ?). Wer eine bestimmte Zeile holt, zaehlt nicht auf; und wer das
// Support-Konto gezielt sucht, will es auch finden.
import { readFileSync, readdirSync } from 'fs';
import { WURZEL } from './pfade.mjs';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

// ── Die Dateien, die zu pruefen sind ──────────────────────────────────
function phpDateien(verzeichnis) {
  const raus = [];
  for (const e of readdirSync(verzeichnis, { withFileTypes: true })) {
    const voll = `${verzeichnis}/${e.name}`;
    if (e.isDirectory()) { raus.push(...phpDateien(voll)); }
    else if (e.name.endsWith('.php')) { raus.push(voll); }
  }
  return raus;
}

// Das Statement um eine Fundstelle herum: vom vorangehenden Semikolon
// oder Blockanfang bis zum naechsten. Zeilenweise zu suchen taugt nicht --
// die Abfragen hier gehen ueber vier, fuenf Zeilen, und der Ausschluss
// steht dann in einer anderen Zeile als das FROM.
function statementUm(text, stelle) {
  let von = stelle;
  while (von > 0 && !';{}'.includes(text[von - 1])) { von--; }
  let bis = stelle;
  while (bis < text.length && text[bis] !== ';') { bis++; }
  return text.slice(von, bis + 1);
}

// Ein Einzelbezug zaehlt nicht auf -- er holt eine bestimmte Zeile.
const EINZELBEZUG = /WHERE\s+(m\.|p\.)?(id|name|personalnummer)\s*(=\s*\?|IN\s*\()|support_konto\s*=\s*1/i;

// Namentliche Ausnahmen. Jede mit Grund -- eine Ausnahmeliste ohne
// Gruende ist eine Liste von Dingen, die niemand mehr nachpruefen kann.
const AUSNAHMEN = {
  'api/dashboard_stats.php': 'Die Liste der OFFENEN SITZUNGEN zeigt einen laufenden '
    + 'Supportzugriff bewusst mit -- der Betrieb soll ihn in seinen eigenen Daten sehen.',
  'demo_daten.php': 'Waehlt nach anstellungskategorie; das Support-Konto hat keine und '
    + 'faellt schon dadurch heraus.',
  'demo_instanz.php': 'Sammelt vergebene Namen, um keine Dublette zu erzeugen -- '
    + 'der Name des Support-Kontos SOLL dabei sein.',
  'planung_einrichten_kern.php': 'Datenpflege der Einrichtung (Nulldaten, Rollen aus '
    + 'ist_admin). Sie soll jede Zeile erreichen, auch das Support-Konto.',
  'support.php': 'Sucht das Support-Konto selbst.',
  'mitarbeiter.php': 'Spaltenabfragen (SHOW COLUMNS) und Dublettenpruefungen mit '
    + 'Einzelbezug.',
  'api/fahrzeug_logbuch.php': 'Loest bereits vorliegende Ids zu Namen auf, zaehlt nicht auf.',
  'api/mitarbeiter_update.php': 'Dublettenpruefungen auf Name und Personalnummer, je mit '
    + 'Einzelbezug.',
  'push.php': 'Push erreicht GERAETE, und das Support-Konto hat keines -- es steht in '
    + 'keiner Geraeteliste, die Abfrage laeuft fuer es ins Leere.',
  'planung.php': 'Arbeitet auf einer bereits uebergebenen Id-Liste, zaehlt nicht auf. '
    + 'Ein Rueckbezug waere ausserdem zirkulaer: mitarbeiter.php laedt planung.php, '
    + 'nicht umgekehrt.',
};

const offen = [];
let geprueft = 0;

for (const datei of phpDateien(`${WURZEL}/backend`)) {
  const kurz = datei.slice(`${WURZEL}/backend/`.length);
  const text = readFileSync(datei, 'utf8');
  for (const t of text.matchAll(/FROM\s+mitarbeiter\b/gi)) {
    const s = statementUm(text, t.index);
    if (/SHOW\s+COLUMNS/i.test(s)) { continue; }
    geprueft++;
    if (s.includes('ma_nur_menschen')) { continue; }
    if (EINZELBEZUG.test(s)) { continue; }
    if (AUSNAHMEN[kurz]) { continue; }
    offen.push(kurz + ': ' + s.replace(/\s+/g, ' ').trim().slice(0, 90));
  }
}

check(`jede aufzaehlende Abfrage schliesst das Support-Konto aus (${geprueft} geprueft)`,
  offen.length === 0);
if (offen.length) { offen.forEach(o => bad.push('  ohne Ausschluss -- ' + o)); }

// ── Die Funktion selbst ───────────────────────────────────────────────
const fachlogik = readFileSync(`${WURZEL}/backend/mitarbeiter.php`, 'utf8');
function rumpf(text, name) {
  const von = text.indexOf(`function ${name}(`);
  if (von === -1) { return ''; }
  const nach = text.indexOf('\nfunction ', von + 1);
  return text.slice(von, nach === -1 ? text.length : nach);
}
const fn = rumpf(fachlogik, 'ma_nur_menschen');

// Ohne die Spalte darf die Bedingung die Abfrage nicht zerreissen. Sie
// muss dann etwas liefern, das in jedem WHERE gilt -- sonst faellt bei
// einer Datenbank vor dem Spaltennachtrag alles auf einmal aus.
// Ohne die Spalte darf die Bedingung die Abfrage nicht zerreissen. Sie
// muss dann etwas liefern, das in jedem WHERE gilt -- sonst faellt bei
// einer Datenbank vor dem Spaltennachtrag alles auf einmal aus. Geprueft
// wird die AUSSAGE: Es gibt einen Weg, auf dem die Spalte fehlen darf,
// und dann kommt '1=1' heraus.
check('ohne die Spalte schliesst die Bedingung nichts aus',
  /catch/.test(fn) && /'1=1'/.test(fn) && /SELECT support_konto FROM mitarbeiter LIMIT 0/.test(fn));

// Der Merker gilt JE VERBINDUNG. Ein gemeinsamer gaebe das Ergebnis des
// ersten Mandanten fuer alle uebrigen aus -- genau der Fehler, der hier
// mit hat_tabelle() schon einmal passiert ist.
check('der Merker unterscheidet die Verbindungen',
  /spl_object_id\(\$pdo\)/.test(fn));

// Mit Alias, damit sie auch in einem JOIN steht, wo "support_konto"
// allein mehrdeutig waere.
check('die Bedingung kann einen Tabellen-Alias tragen',
  /\$alias === '' \? '' : \$alias \. '\.'/.test(fn));

// ── Die Wege, die dem Konto ein Passwort verschaffen koennten ─────────
//
// Wer dem Support-Konto ein Passwort geben kann, kann unter seinem Namen
// arbeiten -- und das Protokoll aus ENT-631 schriebe die Aenderungen dann
// dem Betreiber zu. Das ist die einzige Stelle, an der aus "zaehlt nicht
// mit" eine Sicherheitsaussage wird.
for (const [datei, was] of [
  ['api/mitarbeiter_reset_password.php', 'Ruecksetzung durch die Verwaltung'],
  ['api/passwort_vergessen.php',         'Ruecksetzung per Mail'],
  ['api/login.php',                      'Anmeldung mit Passwort'],
]) {
  const t = readFileSync(`${WURZEL}/backend/${datei}`, 'utf8');
  const stelle = t.search(/FROM\s+mitarbeiter\b/i);
  check(`${was} erreicht das Support-Konto nicht`,
    stelle !== -1 && statementUm(t, stelle).includes('ma_nur_menschen'));
}

// ── Die beiden Stellen, an denen das Konto sonst verschwaende ─────────
const setup = readFileSync(`${WURZEL}/backend/setup.php`, 'utf8');
check('das Bootstrap zaehlt das Support-Konto nicht als "schon eingerichtet"',
  statementUm(setup, setup.search(/FROM\s+mitarbeiter\b/i)).includes('ma_nur_menschen'));

const daten = readFileSync(`${WURZEL}/backend/demo_daten.php`, 'utf8');
check('das Neubefuellen der Demo loescht das Support-Konto nicht mit',
  /DELETE FROM mitarbeiter WHERE ' \. ma_nur_menschen/.test(daten));

// ── Gegenprobe ────────────────────────────────────────────────────────
const GEGENPROBEN = [
  ['ohne die Spalte schliesst die Bedingung nichts aus',
   () => !(/hat_spalte/.test(fn.replace(/hat_spalte/g, 'immer_da')) && /'1=1'/.test(fn))],
  ['Anmeldung erreicht das Support-Konto nicht',
   () => {
     const t = readFileSync(`${WURZEL}/backend/api/login.php`, 'utf8')
       .replace(" AND ' . ma_nur_menschen(db())", "'");
     return !statementUm(t, t.search(/FROM\s+mitarbeiter\b/i)).includes('ma_nur_menschen');
   }],
  ['das Neubefuellen loescht das Support-Konto nicht mit',
   () => !/DELETE FROM mitarbeiter WHERE ' \. ma_nur_menschen/.test(
     daten.replace("DELETE FROM mitarbeiter WHERE ' . ma_nur_menschen($pdo)", "DELETE FROM mitarbeiter'"))],
  ['eine neue aufzaehlende Abfrage ohne Ausschluss faellt auf',
   () => {
     const erfunden = "$x = db()->query('SELECT COUNT(*) FROM mitarbeiter WHERE aktiv = 1');";
     const s = statementUm(erfunden, erfunden.search(/FROM\s+mitarbeiter\b/i));
     return !s.includes('ma_nur_menschen') && !EINZELBEZUG.test(s);
   }],
];

for (const [name, schlaegtAn] of GEGENPROBEN) {
  check(`Gegenprobe: "${name}" schlaegt an, wenn man es kaputt macht`, schlaegtAn());
}

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
