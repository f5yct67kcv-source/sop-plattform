// Betreiber-Ebene (ENT-518): Trennung, Sitzungen, Mandantenstamm.
//
// WARUM DIESE SUITE
//
// Die Betreiber-Ebene ist der dritte Anmeldeweg des Hauses, und sie ist der
// maechtigste: Wer dort hineinkommt, kommt an jeden Mandanten. Genau diese
// Sorte Regel ist hier schon mehrfach an etwas NEUEM gescheitert, das sie
// nicht geerbt hat (CLAUDE.md, "Regeln, die ueber Dateien hinweg gelten").
// Die wichtigste Pruefung unten ist darum nicht die, die den heutigen Stand
// bestaetigt, sondern die, die jeden KUENFTIGEN betreiber_*-Endpunkt
// zwingt, die Wache zu rufen.
import { WURZEL, HIER } from './pfade.mjs';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const lies = p => readFileSync(join(WURZEL, p), 'utf8');
// Kommentare weg, bevor ueber CODE geurteilt wird. Ohne das faende jede
// Suche auch die Stelle, an der eine Datei erklaert, was sie bewusst NICHT
// tut -- und ausgerechnet die sorgfaeltig kommentierte Datei fiele durch.
const nurCode = q => q.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const modul = lies('backend/betreiber.php');
const API   = join(WURZEL, 'backend/api');
const endpunkte = readdirSync(API).filter(f => f.startsWith('betreiber_') && f.endsWith('.php'));

// ── 1. Die reinen Funktionen wirklich ausfuehren ──────────────────────
let phpAus = '', phpCode = 0;
try {
  phpAus = execFileSync('php', [`${HIER}/pruef_betreiber.php`], { encoding: 'utf8' });
} catch (e) {
  phpAus = String(e.stdout || '') + String(e.stderr || '');
  phpCode = e.status || 1;
}
const phpAnzahl = Number((phpAus.match(/^(\d+) bestanden/m) || [0, 0])[1]);
check('die PHP-Pruefungen der Betreiber-Funktionen laufen durch', phpAnzahl > 0);
check('KRITISCH: alle PHP-Faelle bestehen (Fristen, GAV-Lage, Status)',
  phpCode === 0 && !phpAus.includes('\nx '));
phpAus.split('\n').filter(z => z.startsWith('x ')).forEach(z => bad.push('PHP: ' + z.slice(2)));

// ── 2. Jeder Betreiber-Endpunkt ruft die Wache ────────────────────────
//
// Das ist die eigentliche Wache dieser Suite. Sie prueft nicht den heutigen
// Stand, sondern jeden kuenftigen Endpunkt: Wer eine neue Datei
// betreiber_*.php anlegt, ohne require_betreiber() zu rufen, faellt hier
// durch -- ausser er traegt sie hier mit Grund ein.
//
// Die beiden Ausnahmen sind Einstiegspunkte und koennen die Wache nicht
// rufen, die sie erst ermoeglichen:
const EINSTIEG = {
  // Der Eingang selbst -- er erzeugt die Sitzung, die er nicht verlangen
  // kann. Abgesichert ueber Bremse, Blindpruefung und gleichlautende
  // Antwort; steht zusaetzlich in OHNE_ANMELDUNG in test_php.mjs.
  'betreiber_anmelden.php': 'Eingang, erzeugt die Sitzung selbst',
  // Die Einrichtung laeuft, BEVOR es eine Betreiber-Ebene gibt, und haengt
  // darum an der Verwaltung dieses Betriebs.
  'betreiber_einrichten.php': 'Einrichtung, abgesichert ueber require_verwaltung',
};
const ohneWache = endpunkte.filter(f =>
  !EINSTIEG[f] && !lies(`backend/api/${f}`).includes('require_betreiber('));
check('KRITISCH: jeder betreiber_*-Endpunkt ruft require_betreiber() oder steht namentlich da',
  ohneWache.length === 0);
if (ohneWache.length) { bad.push('ohne Wache: ' + ohneWache.join(', ')); }

// Kehrseite, und sie ist der wichtigere Teil: Bekommt ein Einstiegspunkt
// spaeter doch eine Wache, gehoert er aus der Liste heraus -- sonst waechst
// eine Ausnahmeliste, die niemand mehr aufraeumt.
const unnoetigBefreit = Object.keys(EINSTIEG).filter(f =>
  endpunkte.includes(f) && lies(`backend/api/${f}`).includes('require_betreiber('));
check('kein Einstiegspunkt steht unnoetig in der Ausnahmeliste',
  unnoetigBefreit.length === 0);

// Die Einrichtung darf nicht ohne JEDE Anmeldung laufen -- ein Endpunkt,
// der sich selbst freischaltet, solange eine Tabelle leer ist, ist offen,
// bis ihn jemand findet.
const einr = lies('backend/api/betreiber_einrichten.php');
check('KRITISCH: die Einrichtung haengt an der Verwaltung, nicht an einer leeren Tabelle',
  einr.includes('require_verwaltung(') && einr.includes('require_session('));

// ── 3. In der Sitzungstabelle steht nie der Rohwert (ENT-501) ─────────
//
// Geprueft wird die Aussage, nicht der Wortlaut: In JEDER Abfrage auf
// betreiber_sessions muss der Wert, der mit token verglichen oder dort
// eingetragen wird, durch sitzung_abdruck() gegangen sein.
const alleQuellen = [modul, ...endpunkte.map(f => lies(`backend/api/${f}`))].join('\n');
// Eine Abfrage ist etwas anderes als ein CREATE TABLE: Die Einrichtung
// LEGT die Tabelle an und liest sie nie -- sie braucht keinen Abdruck.
const ABFRAGE = /(?:SELECT|INSERT INTO|UPDATE|DELETE FROM)[\s\S]{0,200}betreiber_sessions/;
const beruehrt = [modul, ...endpunkte.map(f => lies(`backend/api/${f}`))]
  .map(nurCode).filter(q => ABFRAGE.test(q));
check('es gibt ueberhaupt Abfragen auf betreiber_sessions', beruehrt.length > 0);
check('KRITISCH: wer betreiber_sessions abfragt, benutzt sitzung_abdruck()',
  beruehrt.every(q => q.includes('sitzung_abdruck(')));
// Gegenprobe in Form einer zweiten, unabhaengigen Aussage: Der erzeugte
// Rohtoken darf die Anmeldung nur als Antwort verlassen, nie in ein INSERT.
const anm = lies('backend/api/betreiber_anmelden.php');
check('KRITISCH: der Rohtoken wird nicht in betreiber_sessions eingetragen',
  /INSERT INTO betreiber_sessions[^;]*sitzung_abdruck\(/s.test(anm)
  || (anm.includes('INSERT INTO betreiber_sessions') && anm.includes('sitzung_abdruck($token)')));

// ── 4. Der Mandantenstamm traegt kein Passwort ────────────────────────
//
// Host, Name und Benutzer stehen dort, das Passwort kommt aus dem Deploy.
// Wer Lesezugriff auf die Betreiber-Datenbank bekaeme, haette sonst in
// derselben Sekunde die Zugaenge zu JEDEM Mandanten.
const mandantSql = (einr.match(/CREATE TABLE IF NOT EXISTS mandant \(([\s\S]*?)\) ENGINE/) || [, ''])[1];
check('die Mandantentabelle wird ueberhaupt angelegt', mandantSql.length > 0);
check('KRITISCH: der Mandantenstamm hat kein Passwortfeld',
  mandantSql.length > 0 && !/pass|passwort|secret_wert|kennwort/i.test(
    mandantSql.replace(/secret_name/g, '')));
check('der Mandantenstamm haelt Host, Name und Benutzer',
  ['db_host', 'db_name', 'db_user'].every(f => mandantSql.includes(f)));

// ── 5. Die Ebenen bleiben getrennt ────────────────────────────────────
//
// Ein Betreiber-Konto ist keine Zeile in mitarbeiter. Ausser beim
// Bootstrap (Einrichtung, Erstkonto) darf kein Betreiber-Endpunkt die
// Verwaltungstabellen anfassen.
const fremdzugriff = endpunkte.filter(f => {
  if (f === 'betreiber_einrichten.php' || f === 'betreiber_konto_anlegen.php') { return false; }
  const q = lies(`backend/api/${f}`);
  return /\bFROM mitarbeiter\b|\bFROM sessions\b|\bFROM kunden_sessions\b/.test(q);
});
check('KRITISCH: kein Betreiber-Endpunkt liest die Verwaltungs- oder Portaltabellen',
  fremdzugriff.length === 0);
if (fremdzugriff.length) { bad.push('greift fremd zu: ' + fremdzugriff.join(', ')); }

const modulCode = nurCode(modul);
check('das Modul beruehrt darf() / die Rollenrechte nicht',
  !modulCode.includes('darf(') && !modulCode.includes('rechte_aus_rollen('));

// ── 6. Die Anmeldung erbt die Sicherungen des Hauses ──────────────────
check('KRITISCH: die Anmeldung nutzt die Bremse', anm.includes('anmeld_zaehlen(') && anm.includes('anmeld_fehlversuch('));
check('KRITISCH: eigener Bremsnamensraum, damit Wege sich nicht gegenseitig sperren',
  /['"]betreiber:['"]\s*\./.test(anm) || anm.includes("'betreiber:' ."));
check('KRITISCH: Blindpruefung gegen Zeitmessung bei unbekannter Adresse',
  anm.includes('passwort_blindpruefung('));
// Dieselbe Antwort fuer "gibt es nicht" und "Passwort falsch" -- sonst
// verraet die Meldung, welche Adressen es gibt.
const meldungen = [...anm.matchAll(/'message' => '([^']*)'\]\s*,\s*401\)/g)].map(m => m[1]);
check('KRITISCH: unbekannte Adresse und falsches Passwort antworten gleichlautend',
  meldungen.length >= 2 && new Set(meldungen).size === 1);
// Das maechtigste Konto der Anlage traegt mindestens die Verwaltungsschwelle.
const konto = lies('backend/api/betreiber_konto_anlegen.php');
check('KRITISCH: das Betreiber-Passwort wird auf Verwaltungsniveau geprueft',
  /passwort_pruefen\([^)]*,\s*true\s*\)/.test(konto));

// ── 7. Deploy und Sperrliste ──────────────────────────────────────────
//
// Der Deploy kopiert nur namentlich gelistete Dateien -- ein vergessenes
// betreiber.php hiesse, dass die Endpunkte auf dem Server ins Leere
// laufen. Und weil das Modul nur eingebunden und nie direkt aufgerufen
// wird, gehoert es in die Sperrliste der .htaccess.
check('KRITISCH: backend/betreiber.php wird deployt',
  lies('.github/workflows/deploy-hostpoint.yml').includes('cp backend/betreiber.php'));
check('KRITISCH: betreiber.php ist in der .htaccess gesperrt',
  /FilesMatch[^\n]*\|betreiber\|/.test(lies('htaccess-hostpoint')));

// ── 8. Vertraulichkeit ────────────────────────────────────────────────
//
// Im Code steht kein echter Firmenname (Hausregel). Der Name des
// Bestandsbetriebs wird aus der Tabelle betrieb gelesen.
// Die Aussage ist NICHT "das Wort kommt nirgends vor" -- der Betrieb heisst
// im README und in CLAUDE.md beim Namen, und ein erklaerender Kommentar darf
// das auch. Geprueft wird, dass der Mandantenname zur LAUFZEIT aus der
// Tabelle betrieb kommt und nicht als Zeichenkette im INSERT steht.
const insMandant = (nurCode(einr).match(/INSERT INTO mandant[\s\S]{0,400}?;/) || [''])[0];
check('KRITISCH: der Name des Bestandsbetriebs wird gelesen, nicht einprogrammiert',
  einr.includes('SELECT firma FROM betrieb')
  && insMandant.length > 0
  && !/VALUES\s*\([^)]*['"][A-Za-zÄÖÜäöü][^)]*GmbH/i.test(insMandant));
check('der Platzhalter greift nur, wenn kein Briefkopf hinterlegt ist',
  /trim\(\$name\)\s*===\s*''/.test(einr));

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
