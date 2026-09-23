// Uebergabeweg eines Mandantenkontos (ENT-686).
//
// WARUM DIESE SUITE
//
// Bis ENT-686 entstand das erste Verwaltungskonto eines Mandanten ueber
// backend/setup.php: eine Datei, die von Hand per FTP hochgeladen, einmal mit
// Name und Passwort aufgerufen und wieder geloescht wurde. Drei Folgen, alle
// mit derselben Wurzel -- das Konto entstand fertig, mit einem Geheimnis, das
// jemand anderes gewaehlt hatte: Der Betreiber kannte das Passwort des
// Kunden, der Handgriff wurde nirgends protokolliert, und im System stand
// keine Stelle, an der die Uebergabe vermerkt war.
//
// Geprueft wird NICHT der Wortlaut der neuen Dateien, sondern die Zusagen,
// die sie einloesen muessen -- und zwar so, dass die Pruefung rot wird, wenn
// jemand sie spaeter beilaeufig zuruecknimmt. Die Funktionen laufen in
// pruef_mandant_einladung.php wirklich, mitsamt Gegenproben; hier steht, was
// sich nicht ausfuehren laesst.
import { WURZEL, HIER } from './pfade.mjs';
import { readFileSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const lies = p => readFileSync(join(WURZEL, p), 'utf8');
// Kommentare weg, bevor ueber CODE geurteilt wird. Ohne das faende jede
// Suche auch die Stelle, an der eine Datei erklaert, was sie bewusst NICHT
// tut -- und ausgerechnet die sorgfaeltig kommentierte Datei fiele durch.
const nurCode = q => q.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const API       = 'backend/api/';
const einladen  = nurCode(lies(API + 'betreiber_mandant_einladen.php'));
const pruefen   = nurCode(lies(API + 'mandant_einladung_pruefen.php'));
const einloesen = nurCode(lies(API + 'mandant_einladung_einloesen.php'));
const login     = nurCode(lies(API + 'login.php'));
const modul     = nurCode(lies('backend/betreiber.php'));

// ── 1. Die reinen Funktionen wirklich ausfuehren ──────────────────────
let phpAus = '', phpCode = 0;
try {
  phpAus = execFileSync('php', [`${HIER}/pruef_mandant_einladung.php`], { encoding: 'utf8' });
} catch (e) {
  phpAus = String(e.stdout || '') + String(e.stderr || '');
  phpCode = e.status || 1;
}
const phpAnzahl = Number((phpAus.match(/^(\d+) bestanden/m) || [0, 0])[1]);
// phpAnzahl > 0 gehoert MIT in die Bedingung: Stuerzt die PHP-Datei ab, bevor
// sie ihre Zusammenfassung druckt, ist phpCode 0 und die Suite waere gruen,
// ohne dass eine einzige Pruefung gelaufen ist.
check('KRITISCH: die ausgefuehrten Uebergabepruefungen laufen durch',
  phpCode === 0 && phpAnzahl > 0);
if (phpCode !== 0) { bad.push('PHP-Ausgabe: ' + phpAus.trim().split('\n').slice(-4).join(' | ')); }

// ── 2. Der Betreiber kennt das Passwort nie ───────────────────────────
//
// DIE ZENTRALE ZUSAGE DES GANZEN WEGS, und die, die in den
// Auftragsbearbeitungsvertrag soll. Der Ausstellweg darf ein Passwort weder
// entgegennehmen noch erzeugen noch verschicken -- sonst ist er nur ein
// bequemeres setup.php.
check('KRITISCH: der Ausstellweg nimmt kein Passwort entgegen',
  !/\$in\s*\[\s*'passwort'\s*\]|\$in\s*\[\s*'password'\s*\]/.test(einladen));
check('KRITISCH: der Ausstellweg erzeugt und speichert kein Passwort',
  !/password_hash\s*\(/.test(einladen) && !/passwort_erzeugen\s*\(/.test(einladen));
// Die Kehrseite, und sie ist der Beleg, dass die Pruefung etwas bedeutet:
// Der EINLOESEweg tut beides -- dort waehlt die Person ihr Passwort selbst.
check('KRITISCH: GEGENPROBE — der Einloeseweg nimmt ein Passwort und macht daraus einen Hash',
  /\$in\s*\[\s*'passwort'\s*\]/.test(einloesen) && /password_hash\s*\(/.test(einloesen));

// ── 3. Das Einloesen meldet NICHT an ──────────────────────────────────
//
// Stellte dieser Endpunkt eine Sitzung aus, waere der Link aus einem
// Postfach ein zweiter Eingang in die Anlage. Geprueft an dem, was ein
// Anmelden zwingend braeuchte: ein Schreiben in `sessions` und ein Token in
// der Antwort. Beides fehlt, oder die Zusage ist zurueckgenommen.
check('KRITISCH: das Einloesen schreibt keine Sitzung',
  !/INSERT INTO\s+`?sessions`?/i.test(einloesen));
check('KRITISCH: das Einloesen gibt kein Sitzungstoken zurueck',
  !/'token'\s*=>/.test(einloesen) && !/sitzung_abdruck/.test(einloesen));
// Gegenprobe: Der gewoehnliche Anmeldeweg TUT beides. Waere das nicht so,
// pruefte die Suche oben nichts.
check('KRITISCH: GEGENPROBE — der gewoehnliche Anmeldeweg tut beides',
  /INSERT INTO\s+`?sessions`?/i.test(login) && /sitzung_abdruck/.test(login));

// ── 4. Der Rohwert des Tokens wird nie gespeichert ────────────────────
//
// ENT-501. Wer die Tabelle lesen kann, haelt sonst einen gueltigen Link in
// der Hand -- und dieser legt den Verwaltungszugang einer ganzen Anlage an.
// Dass der Abdruck als Schluessel nicht funktioniert, wird in
// pruef_mandant_einladung.php ausgefuehrt; hier wird geprueft, dass der
// Ausstellweg gar nichts anderes einsetzt.
{
  // Geprueft wird DER SCHREIBBLOCK, nicht die ganze Datei: Der Rohwert kommt
  // darin vor -- er muss, denn er geht in die Nachricht --, aber er darf
  // nicht in die Tabelle gebunden werden. Ein Blick auf die ganze Datei
  // koennte das nicht unterscheiden.
  const block = (einladen.match(/REPLACE INTO mandant_einladung[\s\S]*?\)\s*;/) || [''])[0];
  check('der Schreibblock der Einladung ist ueberhaupt auffindbar', block.length > 0);
  check('KRITISCH: der Ausstellweg bindet den Abdruck in die Tabelle, nicht den Rohwert',
    /hash\s*\(\s*'sha256'\s*,\s*\$tokenRoh\s*\)/.test(block)
    && !/[[,]\s*\$tokenRoh\s*[,\]]/.test(block));
}
check('der Token entsteht aus random_bytes, nicht aus einer Uhrzeit oder einem Zaehler',
  /random_bytes\s*\(\s*32\s*\)/.test(einladen));

// ── 5. Der Link kommt aus dem Deploy, nie aus der Anfrage ─────────────
//
// ENT-501, die Regel, an der hier schon einmal etwas haengengeblieben ist:
// Der Kopf gehoert dem Aufrufer, nicht uns. Ein Angreifer koennte sonst
// einen Uebergabe-Link auf seine eigene Adresse ausstellen lassen.
check('KRITISCH: die eigene Adresse kommt aus basis_url()',
  /basis_url\s*\(\s*\)/.test(einladen));
check('KRITISCH: der Ausstellweg liest keinen Host aus der Anfrage',
  !/HTTP_HOST|SERVER_NAME/.test(einladen));

// ── 6. Wer ausstellen darf ────────────────────────────────────────────
//
// Ein Einladungslink ist ein Konto in spe und darf nicht billiger zu haben
// sein als das Konto selbst -- und dieses ist der Verwaltungszugang auf eine
// ganze Anlage. Darum die VOLLE Wache mit zweitem Faktor, nicht die blosse
// Sitzung.
check('KRITISCH: nur ein Betreiber mit bestaetigtem zweitem Faktor darf ausstellen',
  /\$ich\s*=\s*require_betreiber_voll\s*\(\s*\)\s*;/.test(einladen));
check('das Ausstellen und das Einloesen gehen nur per POST',
  /REQUEST_METHOD'\]\s*!==\s*'POST'/.test(einladen)
  && /REQUEST_METHOD'\]\s*!==\s*'POST'/.test(einloesen));

// ── 7. Die Vollpruefung des Bauplans, nicht das Zaehlen von Tabellen ──
//
// DIE LEHRE AUS demo6 UND demo8 (Befund 2026-09-19): Dort waren alle
// Kerntabellen da, die nachtraeglichen Spalten fehlten, und beide galten als
// "eingerichtet". Wer hier auf mandant_stand() zurueckfaellt -- fuenf
// Tabellen gezaehlt --, uebergibt eine halbe Anlage an einen zahlenden
// Kunden. Beide Wege muessen den ganzen Bauplan pruefen.
//
// GEPRUEFT WIRD DER AUFRUF MIT SEINEM ARGUMENT, nicht der Funktionsname:
// nurCode() entfernt ganze Kommentarzeilen, aber nicht die am Zeilenende --
// und die require-Zeilen nennen genau diese Namen. Die erste Fassung dieser
// Pruefung blieb darum in der Gegenprobe gruen (2026-09-23).
check('KRITISCH: der Ausstellweg prueft den ganzen Bauplan der Anlage',
  /kern_schema_fehlend\s*\(\s*\$anlage\s*\)/.test(einladen));
check('KRITISCH: der Einloeseweg prueft ihn ebenfalls, kurz vor dem Anlegen',
  /kern_schema_fehlend\s*\(\s*\$anlage\s*\)\s*!==\s*\[\]/.test(einloesen));
check('KRITISCH: keiner der beiden begnuegt sich mit dem Zaehlen der Kerntabellen',
  !/mandant_stand\s*\(/.test(einladen) && !/mandant_stand\s*\(/.test(einloesen));

// ── 8. Kein zweites Erstkonto ─────────────────────────────────────────
//
// Zwei unabhaengige Sperren, und die Reihenfolge entscheidet. Erstens sieht
// der Einloeseweg in der Anlage selbst nach, ob dort schon ein MENSCH steht
// (das Support-Konto zaehlt nicht mit, ENT-631) -- und zwar VOR dem INSERT.
// Danach waere die Pruefung wertlos.
check('KRITISCH: der Einloeseweg zaehlt nur Menschen, nicht das Support-Konto',
  /ma_nur_menschen\s*\(\s*\$anlage\s*\)/.test(einloesen));
check('KRITISCH: er zaehlt VOR dem Anlegen, nicht danach',
  einloesen.indexOf('ma_nur_menschen($anlage)') > 0
  && einloesen.indexOf('ma_nur_menschen($anlage)') < einloesen.indexOf('INSERT INTO mitarbeiter'));
// Zweitens das Beanspruchen der Einladung, das genau einer gewinnt -- und
// auch das muss vor dem Anlegen stehen. Stuende es danach, koennten zwei
// gleichzeitige Aufrufe zwei Konten anlegen.
check('KRITISCH: die Einladung wird beansprucht, bevor das Konto entsteht',
  einloesen.indexOf('mandant_einladung_beanspruchen(') > 0
  && einloesen.indexOf('mandant_einladung_beanspruchen(')
     < einloesen.indexOf('INSERT INTO mitarbeiter'));
// Und die Gegenbuchung dazu: Scheitert das Anlegen, wird die Einladung
// freigegeben. Ohne sie waere sie verbraucht und niemand kaeme hinein.
check('KRITISCH: scheitert das Anlegen, wird die Einladung wieder freigegeben',
  /mandant_einladung_freigeben\s*\(/.test(einloesen));

// ── 9. Das Erstkonto ist ein Verwaltungskonto mit Personalnummer ──────
//
// ist_admin = 1, weil dieses Konto die Anlage verwaltet -- das ist der Zweck
// der Uebergabe. Und die Personalnummer (ENT-684): JEDER Weg, der eine
// Person anlegt, vergibt ihr eine. setup.php tat das bis ENT-684 nicht, und
// bei jedem neuen Mandanten entstand darum genau eine Person ohne Nummer.
check('KRITISCH: das Erstkonto wird als Verwaltungskonto angelegt',
  /INSERT INTO mitarbeiter[^;]*ist_admin[^;]*VALUES[^;]*,\s*1\s*,/s.test(einloesen)
  || /VALUES\s*\(\?,\s*\?,\s*1,/.test(einloesen));
check('KRITISCH: es bekommt eine Personalnummer (ENT-684)',
  /ma_personalnummer_generieren\s*\(\s*\$anlage\s*\)/.test(einloesen));
// Die Passwortschwelle ist die der Verwaltung, nicht die kuerzere -- dieselbe
// Falle, in die setup.php einmal gelaufen ist (eigenes "strlen < 6").
check('KRITISCH: es gilt die Verwaltungsschwelle fuers Passwort',
  /passwort_pruefen\s*\(.*,\s*true\s*\)/.test(einloesen));
check('KRITISCH: der Einloeseweg schreibt keine eigene Passwortlaenge aus',
  !/strlen\s*\(\s*\$pass/.test(einloesen) && !/mb_strlen\s*\(\s*\$pass/.test(einloesen));

// ── 10. Vier Zustaende, vier Aussagen ─────────────────────────────────
//
// Die Hausregel, die hier am haeufigsten verletzt wurde: "unbekannt" darf
// nie wie "keine" aussehen. Eine fehlende Tabelle (noch nicht eingerichtet),
// ein gesperrter Mandant, eine nicht erreichbare Anlage und ein toter Link
// sind vier verschiedene Aussagen. Geprueft wird, dass es vier
// unterschiedliche Texte gibt -- nicht ihr Wortlaut.
{
  const texte = [...einloesen.matchAll(/'message'\s*=>\s*([^\]]*?)\]/gs)]
    .map(m => m[1].replace(/\s+/g, ' ').trim());
  const verschieden = new Set(texte);
  check('KRITISCH: der Einloeseweg unterscheidet mindestens vier Faelle in eigenen Texten',
    verschieden.size >= 4);
  // Und keiner davon verraet dem Kunden den Bauzustand der Anlage: Wieviele
  // Spalten fehlen, hilft ihm nicht und gehoert nicht nach draussen. Der
  // Betreiber sieht es beim Ausstellen -- dort ist die Zahl erwuenscht.
  check('KRITISCH: der Einloeseweg nennt dem Kunden keine Schema-Luecken',
    !/count\s*\(\s*\$luecken|implode[^;]*\$luecken/.test(einloesen));
  check('KRITISCH: GEGENPROBE — der Ausstellweg nennt sie dem Betreiber',
    /count\s*\(\s*\$luecken\s*\)/.test(einladen));
}

// ── 11. Die Frist steht an EINER Stelle ───────────────────────────────
//
// Nicht die Zahl wird geprueft -- die darf sich aendern --, sondern dass es
// keine zweite gibt. Eine Frist, die im Server und in der Nachricht je
// einmal ausgeschrieben steht, ist beim naechsten Bemessen an einer Stelle
// falsch.
check('die Frist ist eine benannte Groesse im Modul',
  /const MANDANT_EINLADUNG_TAGE\s*=\s*\d+;/.test(modul));
check('KRITISCH: der Ausstellweg schreibt keine eigene Frist aus',
  !/INTERVAL\s+\d+\s+DAY/.test(einladen)
  && /INTERVAL\s*'\s*\.\s*MANDANT_EINLADUNG_TAGE|MANDANT_EINLADUNG_TAGE\s*\.\s*'\s*DAY/.test(einladen));

// ── 12. Die Einladung liegt beim Betreiber, nicht in der Anlage ───────
//
// ENT-686, Klaerung 1. Laege sie in der Anlage des Mandanten, wuerde eine
// nicht erreichbare Anlage lautlos aus der Uebergabeliste fallen -- genau
// der Fehler, den ENT-538 beim Support vermieden hat. Geprueft an der
// Verbindung, gegen die die Einladung geschrieben und gelesen wird:
// betreiber_db(), nicht die Verbindung zur Anlage.
check('KRITISCH: die Einladung wird gegen die Betreiber-Datenbank geschrieben',
  /betreiber_db\s*\(\s*\)/.test(einladen)
  && /\$pdo->prepare\(\s*\n?\s*'REPLACE INTO mandant_einladung/.test(einladen));
check('KRITISCH: der Pruefweg liest sie ebenfalls dort und fasst die Anlage nicht an',
  /betreiber_db\s*\(\s*\)/.test(pruefen) && !/mandant_db\s*\(/.test(pruefen));

// ── 13. Der Pruefweg gibt nicht mehr her als noetig ───────────────────
//
// Er laeuft OHNE Anmeldung. Was er herausgibt, sieht jeder, der einen
// gueltigen Link hat -- und mehr als "wofuer setze ich hier ein Passwort"
// braucht niemand. Datenbankangaben waeren die Zugangsdaten der Anlage.
check('KRITISCH: der Pruefweg gibt keine Datenbankangaben heraus',
  !/'db_host'\s*=>|'db_name'\s*=>|'db_user'\s*=>|'secret_name'\s*=>/.test(pruefen));
check('KRITISCH: der Pruefweg gibt keinen Abdruck und keine Kennung heraus',
  !/'token'\s*=>/.test(pruefen) && !/'mandant_id'\s*=>/.test(pruefen));

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
