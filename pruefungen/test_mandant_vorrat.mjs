// Mandanten-Vorrat und taegliche Meldung (ENT-686).
//
// WARUM DIESE SUITE
//
// Ein Vorrat vorbereiteter Anlagen hat zwei Arten, still zu versagen. Er
// kann schrumpfen, ohne dass es jemand merkt -- dann faellt es erst auf,
// wenn ein Kunde unterschrieben hat und keine Anlage bereitsteht. Und eine
// Vorratsanlage kann dort auftauchen, wo nur Kunden hingehoeren: in der
// Abrechnung, in der Vertragsliste, als "nie freigegeben" beim Support.
// Umgekehrt darf ein laufender Kunde nie in den Vorrat geraten, denn dann
// saehe seine Anlage aus wie eine freie.
//
// Geprueft werden die Zusagen, nicht der Wortlaut. Die Funktionen laufen in
// pruef_mandant_vorrat.php wirklich; hier steht, was sich nicht ausfuehren
// laesst.
import { WURZEL, HIER } from './pfade.mjs';
import { readFileSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const lies = p => readFileSync(join(WURZEL, p), 'utf8');
// Kommentare weg -- GANZE Zeilen UND Zeilenenden. Die zweite Form fehlt dem
// nurCode() der Nachbarsuiten; dort musste die Uebergabepruefung darum auf
// Aufrufe mit Argument ausweichen (test_mandant_einladung.mjs). Hier werden
// "//"-Kommentare am Zeilenende mitentfernt, sofern sie nicht in einer
// Zeichenkette stehen (grob: nur wenn vor ihnen kein "://" steht).
const nurCode = q => q
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/([;{}),])\s*\/\/(?!\/).*$/gm, '$1');

const API     = 'backend/api/';
// Die reinen Teile des Vorrats stehen seit dem Zusammenfuehren mit main in
// betreiber.php (siehe Kommentar dort); geprueft wird genau dieser
// Abschnitt, nicht die ganze Datei.
const betrQ   = nurCode(lies('backend/betreiber.php'));
const modul   = betrQ.slice(betrQ.indexOf('function mandant_vorrat_zeilen('),
                            betrQ.indexOf('function mandant_vorrat_status_da('));
const pruefen = nurCode(lies(API + 'betreiber_vorrat_pruefen.php'));
const status  = nurCode(lies(API + 'betreiber_mandant_status.php'));
const save    = nurCode(lies(API + 'betreiber_mandant_save.php'));
const einladen = nurCode(lies(API + 'betreiber_mandant_einladen.php'));
const zaehl   = nurCode(lies(API + 'betreiber_zaehlstand.php'));
const vertrag = nurCode(lies(API + 'betreiber_vertrag_list.php'));
const suplage = nurCode(lies(API + 'betreiber_support_lage.php'));
const schema  = nurCode(lies(API + 'betreiber_schema_pruefen.php'));
const betr    = lies('backend/betreiber.php');
const deploy  = lies('.github/workflows/deploy-hostpoint.yml');

// ── 1. Die Funktionen wirklich ausfuehren ─────────────────────────────
let phpAus = '', phpCode = 0;
try {
  phpAus = execFileSync('php', [`${HIER}/pruef_mandant_vorrat.php`], { encoding: 'utf8' });
} catch (e) {
  phpAus = String(e.stdout || '') + String(e.stderr || '');
  phpCode = e.status || 1;
}
const phpAnzahl = Number((phpAus.match(/^(\d+) bestanden/m) || [0, 0])[1]);
check('KRITISCH: die ausgefuehrten Vorratspruefungen laufen durch',
  phpCode === 0 && phpAnzahl > 0);
if (phpCode !== 0) { bad.push('PHP-Ausgabe: ' + phpAus.trim().split('\n').slice(-4).join(' | ')); }

// ── 2. Jeder ENUM-Nachtrag stimmt mit seiner Tabellendefinition ueberein ─
//
// Der Kommentar bei be_auswahlwerte() behauptete, test_php.mjs wache
// darueber. Das tat es nicht (2026-09-23 nachgesehen) -- es gab nur eine
// Einzelpruefung fuer die Belegart. Hier ALLGEMEIN, fuer jeden Eintrag: MySQL
// kennt kein "einen Wert hinzufuegen", das MODIFY nennt den ganzen Typ. Nennt
// es weniger Werte als das CREATE TABLE, verliert eine bestehende Anlage beim
// Nachtrag einen Status -- und jede Zeile, die ihn traegt, wird leer.
{
  const modifies = [...betr.matchAll(
    /ALTER TABLE (\w+) MODIFY COLUMN (\w+) "\s*\.\s*"(ENUM\([^)]*\))/g)];
  check('es gibt ueberhaupt ENUM-Nachtraege zu pruefen (mindestens der des Vorrats)',
    modifies.some(m => m[1] === 'mandant' && m[2] === 'status'));
  const abweichend = modifies.filter(([, tabelle, spalte, enumNachtrag]) => {
    const create = (betr.match(new RegExp(
      `CREATE TABLE IF NOT EXISTS ${tabelle} \\(([\\s\\S]*?)\\) ENGINE`)) || [, ''])[1];
    const zeile = (create.match(new RegExp(`^\\s*${spalte} (ENUM\\([^)]*\\))`, 'm')) || [, ''])[1];
    return zeile.replace(/\s/g, '') !== enumNachtrag.replace(/\s/g, '');
  });
  check('KRITISCH: jeder ENUM-Nachtrag nennt genau die Werte seiner Tabellendefinition',
    abweichend.length === 0);
  abweichend.forEach(m => bad.push(`ENUM-Nachtrag weicht ab: ${m[1]}.${m[2]}`));
}

// ── 3. Von Hand kommt niemand in den Vorrat -- und nur zugeteilt heraus ──
//
// Dass "vorrat" nicht in BE_STATUS steht, wird in der PHP-Datei ausgefuehrt.
// Hier: Der Statuswechsel laesst eine Vorratsanlage nur auf "aktiv" -- und
// prueft das, BEVOR er schreibt.
check('KRITISCH: eine Vorratsanlage wird nur auf "aktiv" gestellt (Zuteilung)',
  /MANDANT_STATUS_VORRAT\s*&&\s*\$status\s*!==\s*'aktiv'/.test(status));
check('KRITISCH: diese Sperre steht VOR dem Schreiben',
  status.indexOf('MANDANT_STATUS_VORRAT') > 0
  && status.indexOf('MANDANT_STATUS_VORRAT') < status.indexOf('UPDATE mandant SET status'));
// Anlegen als Vorrat nur beim INSERT: Die Zeile, die den Status setzt, steht
// nach dem Aendern-Zweig, der mit json_response endet.
check('KRITISCH: als Vorrat wird nur beim Anlegen erfasst, nie beim Aendern',
  save.indexOf("$werte['status'] = MANDANT_STATUS_VORRAT") > save.indexOf("'angelegt' => false")
  && save.indexOf("$werte['status'] = MANDANT_STATUS_VORRAT")
     < save.indexOf('INSERT INTO mandant'));
check('KRITISCH: das Aendern-Formular kennt den Status gar nicht',
  !/BE_MANDANT_FELDER\s*=\s*\[[^\]]*'status'/.test(betr));
check('der Status kommt aus einem Ja/Nein, nicht aus der Eingabe',
  !/\$werte\['status'\]\s*=\s*\(?string\)?\s*\$daten/.test(save));

// ── 4. Der Vorrat taucht nirgends auf, wo nur Kunden hingehoeren ──────
//
// Drei Listen wuerden sonst eine falsche Aussage machen: ein
// Abrechnungsvermerk ohne Kunden, ein "fehlender Vertrag", ein "nie
// freigegeben". Jede muss den Vorrat ausnehmen -- ueber EINE Funktion.
check('KRITISCH: der Zaehlstand haelt fuer den Vorrat nichts fest',
  /mandant_ist_vorrat\s*\(\s*\$m\s*\)\s*\)\s*\{\s*continue;\s*\}\s*\$r\s*=\s*zaehlstand_festhalten/.test(zaehl));
check('KRITISCH: die Vertragsliste nimmt den Vorrat aus',
  /mandant_ist_vorrat\s*\(\s*\$m\s*\)\s*\)\s*\{\s*continue;/.test(vertrag));
check('KRITISCH: die Support-Lage nimmt den Vorrat aus, bevor sie verbindet',
  /mandant_ist_vorrat\s*\(/.test(suplage)
  && suplage.indexOf('mandant_ist_vorrat(') < suplage.indexOf('be_freigabe_lagen('));
// Kehrseite: Die EINRICHTUNG muss den Vorrat mitnehmen -- darueber bleibt
// sein Schema aktuell. Wer ihn dort auch ausnaehme, liesse den Vorrat bei
// jedem Update veralten, und die taegliche Pruefung meldete ihn als halb.
check('KRITISCH: GEGENPROBE — die Einrichtung nimmt den Vorrat mit',
  !/mandant_ist_vorrat|status\s*(?:=|<>|!=)\s*'vorrat'|MANDANT_STATUS_VORRAT/.test(schema));

// ── 5. Die Pruefung liest nur den Bauplan ─────────────────────────────
//
// Von der Betreiber-Ebene aus keine Verwaltungstabelle (Trennung der
// Ebenen). Ob eine Vorratsanlage leer ist, prueft der Einloeseweg in der
// Anlage selbst.
check('KRITISCH: die Vorratspruefung liest keine Verwaltungstabelle',
  !/\bFROM\s+`?(mitarbeiter|sessions|kunden_sessions)\b/i.test(modul + pruefen));
check('der Vorratsabschnitt in betreiber.php ist auffindbar', modul.length > 500);
// Seit ENT-705 pruefen Meldung und Zuteilen EINE Anlage mit derselben
// Funktion (mandant_vorrat_platz_pruefen); verbunden wird im Endpunkt, und
// der Bauplan, den er uebergibt, ist der ganze (kern_schema_fehlend).
const zuteilen = nurCode(lies(API + 'betreiber_vorrat_zuteilen.php'));
const entfernen = nurCode(lies(API + 'betreiber_vorrat_entfernen.php'));
const GANZER_BAUPLAN = /\$bauplan\s*=\s*static fn\(array \$\w+\): array => kern_schema_fehlend\(mandant_db\(\$\w+\)\)/;
check('KRITISCH: sie prueft den GANZEN Bauplan jeder verbundenen Anlage, nicht die fuenf Kerntabellen',
  [pruefen, zuteilen].every(q => GANZER_BAUPLAN.test(q) && /mandant_vorrat_platz_pruefen\(\$\w+, \$bauplan\)/.test(q))
  && !/mandant_stand\s*\(/.test(pruefen + zuteilen + modul));
// Die Schleife verbindet IM ENDPUNKT -- sonst saehe die Wache ueber die
// mandant_db()-Aufrufer (test_betreiber.mjs) ihn nicht. Die reinen Teile in
// betreiber.php verbinden nicht.
check('KRITISCH: die reinen Vorratsteile in betreiber.php verbinden zu keiner Anlage',
  !/mandant_db\s*\(/.test(modul));

// ── 6. Kein gespeicherter Vermerk "schon gemeldet" ────────────────────
//
// Festlegung vom 2026-09-23: jeden Tag melden, solange es so bleibt. Ein
// Vermerk koennte verloren gehen oder vom Stand abweichen -- und wer ihn
// spaeter einfuehrt, nimmt die Entscheidung zurueck.
check('KRITISCH: Pruefung und Endpunkt schreiben nichts in die Datenbank',
  !/\b(INSERT|UPDATE|REPLACE|DELETE)\b/i.test(modul + pruefen));

// ── 7. Gemeldet wird nur per POST ─────────────────────────────────────
//
// Eine Mail per GET waere von jedem Vorschau-Dienst ausloesbar.
check('KRITISCH: die Meldung geht nur bei POST hinaus',
  pruefen.indexOf("!== 'POST'") > 0
  && pruefen.indexOf("!== 'POST'") < pruefen.indexOf('smtp_senden('));
check('KRITISCH: ein falscher Schluessel wird abgewiesen, statt in die Sitzungspruefung zu rutschen',
  /'falscher_schluessel'\)\s*\{\s*json_response\([^;]*403\)/.test(pruefen));
check('ohne gueltigen Schluessel verlangt der Endpunkt die volle Betreiber-Wache',
  /require_betreiber_voll\s*\(\s*\)/.test(pruefen));

// ── 8. Der Schluessel kommt aus dem Deploy ────────────────────────────
//
// Der Platzhalter steht ZERLEGT in der Quelle -- die Datei geht per
// "cp backend/api/*.php" auch in Buendel, in denen der Zeitgeber nicht
// eingerichtet sein soll --, und das sed im Betreiber-Buendel sucht GENAU
// diese zerlegte Form. Die erste Fassung suchte die ganze, die es nirgends
// gab: Der Schluessel kam nie auf den Server, jeder Cron-Aufruf lief als
// "kein Token" ins Leere. Geprueft wird, dass der Suchtext des Deploys in
// der Quelle steht; die allgemeine Wache ueber alle Ersetzungen steht in
// test_deploy.mjs.
{
  const m = deploy.match(/sed -i "s\|([^|"]+)\|'\$EFF_\w+'\|g" dist-betreiber\/api\/betreiber_vorrat_pruefen\.php/);
  const such = m ? m[1].replace(/\\+\./g, '.') : null;
  check('KRITISCH: der Deploy setzt den Schluessel im Betreiber-Buendel ein, und sein Suchtext steht in der Quelle',
    such !== null && lies(API + 'betreiber_vorrat_pruefen.php').includes(`$erwartet = ${such};`));
  check('KRITISCH: der Platzhalter steht nicht am Stueck in der Quelle (sonst bricht dist-cupi24)',
    !lies(API + 'betreiber_vorrat_pruefen.php').includes('__VORRAT_ZEITGEBER_TOKEN__'));
}
// Schluessel mitgegeben, aber keiner eingerichtet: eigene Antwort, bevor die
// Sitzungspruefung "kein Token" sagt -- das sah nach falschem Aufruf aus.
{
  const i = pruefen.search(/'nicht_eingerichtet'\s*&&\s*\$schluessel\s*!==\s*''\s*\)\s*\{\s*json_response\([^;]*503\)/);
  check('KRITISCH: ein Schluessel ohne eingerichteten Gegenwert bekommt eine eigene Antwort (503), nicht "kein Token"',
    i > 0 && i < pruefen.search(/require_betreiber_voll\s*\(\s*\)/));
}

// ── 9. Einladen einer Vorratsanlage: eigener Text ─────────────────────
//
// "Liegt im Vorrat" ist etwas anderes als "gesperrt". Die erste Fassung des
// Einladewegs haette einer Vorratsanlage "gesperrt" gesagt.
check('KRITISCH: das Einladen sagt einer Vorratsanlage etwas anderes als "gesperrt"',
  /MANDANT_STATUS_VORRAT\s*=>/.test(einladen));

// ── 10. Der Reiter Vorrat (ENT-705) ────────────────────────────────────
//
// Die Sperren stehen im Server. Geprueft wird, dass sie dort stehen, und
// zwar VOR dem Schreiben -- eine Pruefung nach dem UPDATE sperrte nichts.
{
  const update = zuteilen.search(/UPDATE mandant SET/);
  check('Zuteilen: der Endpunkt ist auffindbar und schreibt', update > 0);
  check('KRITISCH: Zuteilen verlangt die volle Betreiber-Wache und nur POST',
    /require_betreiber_voll\s*\(\s*\)/.test(zuteilen) && /!== 'POST'[\s\S]{0,120}405/.test(zuteilen));
  check('KRITISCH: nur ein Platz im Vorrat laesst sich zuteilen -- vorher geprueft UND in der Anweisung selbst',
    /!== MANDANT_STATUS_VORRAT\)\s*\{\s*json_response\([^;]*409\)/.test(zuteilen)
    && /WHERE id = \? AND status = \?/.test(zuteilen)
    && /\$id, MANDANT_STATUS_VORRAT\]/.test(zuteilen)
    && /rowCount\(\)\s*===\s*0\)\s*\{\s*json_response\([^;]*409\)/.test(zuteilen));
  const sperre = zuteilen.search(/if \(!\$befund\['bereit'\]\)\s*\{\s*json_response\([^;]*409\)/);
  check('KRITISCH: ein nicht uebergabefaehiger Platz wird VOR dem Schreiben abgewiesen, mit Grund',
    sperre > 0 && sperre < update && /\$befund\['text'\]/.test(zuteilen));
  for (const [feld, muster] of [['Name', /\$name === ''\)\s*\{\s*json_response\([^;]*400\)/],
                                ['Subdomain', /\$subdomain === ''\)\s*\{\s*json_response\([^;]*400\)/],
                                ['Kanton', /\$kanton === null\)\s*\{\s*json_response\([^;]*400\)/]]) {
    const i = zuteilen.search(muster);
    check(`KRITISCH: ohne ${feld} wird nicht zugeteilt (vor dem Schreiben)`, i > 0 && i < update);
  }
  check('KRITISCH: die Subdomain wird auf Gueltigkeit und Eindeutigkeit geprueft, vor dem Schreiben',
    zuteilen.search(/!mandant_subdomain_gueltig\(\$subdomain\)/) > 0
    && zuteilen.search(/subdomain = \? AND id <> \?/) > 0
    && zuteilen.search(/subdomain = \? AND id <> \?/) < update);
  check('die Zuteilung steht als eigener Eintrag im Logbuch',
    /be_log\([^;]*'aus dem Vorrat zugeteilt'/.test(zuteilen));

  check('KRITISCH: Entfernen verlangt die volle Betreiber-Wache und nur POST',
    /require_betreiber_voll\s*\(\s*\)/.test(entfernen) && /!== 'POST'[\s\S]{0,120}405/.test(entfernen));
  const loeschen = [...entfernen.matchAll(/DELETE FROM (\w+)([^'"]*)/g)];
  check('KRITISCH: Entfernen loescht genau eine Mandantenzeile im Vorrat -- nie einen Kunden, nichts sonst',
    loeschen.length === 1 && loeschen[0][1] === 'mandant'
    && /WHERE id = \? AND status = \?/.test(loeschen[0][2])
    && /\$id, MANDANT_STATUS_VORRAT\]/.test(entfernen)
    && /rowCount\(\)\s*===\s*0\)\s*\{\s*json_response\([^;]*409\)/.test(entfernen));
  check('das Entfernen steht im Logbuch', /be_log\([^;]*'aus dem Vorrat entfernt'/.test(entfernen));

  check('KRITISCH: den Namen eines neuen Platzes vergibt der Server, und nur beim Anlegen als Vorrat',
    /\$name === '' && \$id === 0 && !empty\(\$daten\['vorrat'\]\)[\s\S]{0,160}mandant_vorrat_naechster_name\(/.test(save));
}
// Die Oberflaeche: Vorratsplaetze stehen nicht unter den Kunden, der Stand
// kommt aus der Pruefung, und ein nicht bereiter Platz hat keinen
// anklickbaren Zuteilen-Knopf.
{
  const seite = lies('betreiber.html');
  check('KRITISCH: die Mandantentabelle laesst Vorratsplaetze aus',
    /alle\.filter\(m => !m\.ist_demo && m\.status !== 'vorrat'\)/.test(seite));
  check('der Reiter Vorrat liest den Stand aus der taeglichen Pruefung',
    /ruf\('betreiber_vorrat_pruefen\.php'\)/.test(seite));
  check('KRITISCH: ein nicht bereiter Platz bekommt einen ausgegrauten Knopf mit Grund, keinen anklickbaren',
    /p\.bereit\s*\?\s*'<button class="klein" data-vorrat-zuteilen=[\s\S]{0,80}:\s*'<button class="klein" disabled title="/.test(seite));
  check('KRITISCH: fuenf Lagen, fuenf Texte',
    ['bereit', 'nicht_eingetragen', 'secret_fehlt', 'nicht_erreichbar', 'schema_unvollstaendig']
      .every(k => new RegExp('\\n\\s*' + k + ':\\s*\\[').test(seite.slice(seite.indexOf('const VORRAT_TEXT'), seite.indexOf('let vorratPlaetze')))));
}

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
