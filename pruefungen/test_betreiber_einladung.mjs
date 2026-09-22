// Einladungsweg der Betreiber-Ebene (ENT-667).
//
// WARUM DIESE SUITE
//
// Bis ENT-667 tippte derjenige, der ein Betreiber-Konto anlegte, dessen
// Passwort selbst. Drei Folgen, alle mit derselben Wurzel -- das Konto
// entstand fertig, mit einem Geheimnis, das jemand anderes gewaehlt hatte:
// der Anlegende kannte es, die Adresse wurde nie nachgewiesen, und
// zwischen Anlegen und erster Anmeldung schuetzte nur dieses Passwort.
//
// Was hier geprueft wird, ist NICHT der Wortlaut der neuen Dateien, sondern
// die Zusagen, die sie einloesen muessen -- und zwar so, dass die Pruefung
// rot wird, wenn jemand sie spaeter beilaeufig zuruecknimmt. Die reinen
// Funktionen laufen in pruef_betreiber_einladung.php wirklich, mitsamt
// Gegenproben; hier steht, was sich nicht ausfuehren laesst.
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

const API = 'backend/api/';
const einladen  = nurCode(lies(API + 'betreiber_einladen.php'));
const pruefen   = nurCode(lies(API + 'betreiber_einladung_pruefen.php'));
const einloesen = nurCode(lies(API + 'betreiber_einladung_einloesen.php'));
const anmelden  = nurCode(lies(API + 'betreiber_anmelden.php'));
const anlegen   = nurCode(lies(API + 'betreiber_konto_anlegen.php'));
const status    = nurCode(lies(API + 'betreiber_konto_status.php'));
const liste     = nurCode(lies(API + 'betreiber_konto_list.php'));
const modul     = nurCode(lies('backend/betreiber.php'));
const seite     = lies('betreiber.html');

// ── 1. Die reinen Funktionen wirklich ausfuehren ──────────────────────
let phpAus = '', phpCode = 0;
try {
  phpAus = execFileSync('php', [`${HIER}/pruef_betreiber_einladung.php`], { encoding: 'utf8' });
} catch (e) {
  phpAus = String(e.stdout || '') + String(e.stderr || '');
  phpCode = e.status || 1;
}
const phpAnzahl = Number((phpAus.match(/^(\d+) bestanden/m) || [0, 0])[1]);
// phpAnzahl > 0 gehoert MIT in die Bedingung: Stuerzt die PHP-Datei ab,
// bevor sie ihre Zusammenfassung druckt, ist phpCode 0 und die Suite waere
// gruen, ohne dass eine einzige Pruefung gelaufen ist.
check('KRITISCH: die ausgefuehrten Einladungspruefungen laufen durch',
  phpCode === 0 && phpAnzahl > 0);
if (phpCode !== 0) { bad.push('PHP-Ausgabe: ' + phpAus.trim().split('\n').slice(-4).join(' | ')); }

// ── 2. Das Einloesen meldet NICHT an ──────────────────────────────────
//
// Die wichtigste Zusage des ganzen Wegs. Stellte dieser Endpunkt eine
// Sitzung aus, waere der Link aus einem Postfach ein zweiter Eingang in die
// Ebene -- einer, der die Zwei-Faktor-Pflicht (ENT-521) umginge. Geprueft
// an dem, was ein Anmelden zwingend braeuchte: ein Schreiben in
// betreiber_sessions und ein Token in der Antwort. Beides fehlt, oder die
// Zusage ist zurueckgenommen.
check('KRITISCH: das Einloesen schreibt keine Sitzung',
  !/betreiber_sessions/.test(einloesen));
check('KRITISCH: das Einloesen gibt kein Sitzungstoken zurueck',
  !/'token'\s*=>/.test(einloesen) && !/sitzung_abdruck/.test(einloesen));
// Die Kehrseite, und sie ist der Beleg dafuer, dass die Pruefung oben etwas
// bedeutet: Der gewoehnliche Anmeldeweg TUT beides. Waere das nicht so,
// bestuenden die beiden Pruefungen auch an einer Datei, die gar nichts tut.
check('… waehrend der gewoehnliche Anmeldeweg beides sehr wohl tut',
  /betreiber_sessions/.test(anmelden) && /sitzung_abdruck/.test(anmelden));

// ── 3. Ab dem zweiten Konto kein vergebenes Passwort mehr ─────────────
//
// Der Bootstrap-Zweig darf bleiben (kein Betreiber, keine erprobte
// Versandstrecke). Der Zweig DANEBEN -- es gibt bereits Konten -- darf kein
// Konto mehr anlegen. Geprueft daran, dass dort kein INSERT mehr passiert.
// Der else-Zweig wird ueber Klammerzaehlung abgegrenzt, nicht ueber den
// naechsten Textfund: Der gemeinsame Code mit dem INSERT steht NACH diesem
// Block, und ein blosses split() zoege ihn mit hinein -- die Pruefung waere
// dann immer rot, egal was im Zweig steht.
function zweigNachElse(quelle) {
  const start = quelle.indexOf('} else {');
  if (start < 0) { return ''; }
  let i = start + '} else {'.length, tiefe = 1;
  const von = i;
  while (i < quelle.length && tiefe > 0) {
    if (quelle[i] === '{') { tiefe++; }
    else if (quelle[i] === '}') { tiefe--; }
    i++;
  }
  return tiefe === 0 ? quelle.slice(von, i - 1) : '';
}
const nachBootstrap = zweigNachElse(anlegen);
check('der else-Zweig laesst sich ueberhaupt abgrenzen', nachBootstrap.length > 0);
check('KRITISCH: wer schon Konten hat, legt ueber den alten Weg keines mehr an',
  nachBootstrap.length > 0 && !/INSERT INTO betreiber\b/.test(nachBootstrap));
// json_response() ruft exit -- der Zweig endet also wirklich hier und
// faellt nicht in den gemeinsamen Code darunter durch.
check('KRITISCH: und der Zweig endet dort, statt in den Anlegeteil durchzufallen',
  /json_response\(/.test(nachBootstrap) && /409/.test(nachBootstrap));
check('… und der Bootstrap fuer das allererste Konto bleibt erhalten',
  /INSERT INTO betreiber\b/.test(anlegen) && /require_verwaltung/.test(anlegen));
check('die Oberflaeche fragt beim neuen Konto nach keinem Passwort mehr',
  !/betreiber_konto_anlegen\.php/.test(seite) && /betreiber_einladen\.php/.test(seite));

// ── 4. Ein Konto ohne Passwort kommt nicht hinein ─────────────────────
//
// Zwei unabhaengige Riegel, und beide werden gebraucht: `aktiv = 1` in der
// Abfrage faengt den Regelfall, die ausdrueckliche Pruefung auf den leeren
// Hash faengt den Fall, dass jemand `aktiv` von Hand umlegt.
check('KRITISCH: die Anmeldung verlangt ein aktives Konto',
  /aktiv\s*=\s*1/.test(anmelden));
check('KRITISCH: und weist einen leeren Passwort-Hash ausdruecklich ab',
  /passwort_hash'\]\s*===\s*''/.test(anmelden));
check('KRITISCH: ein eingeladenes Konto laesst sich nicht von Hand freischalten',
  /be_einladung_offen/.test(status));

// ── 5. Erst pruefen, ob sich verschicken laesst -- dann anlegen ───────
//
// Sonst bleibt bei kaputtem Versand ein Konto zurueck, das niemand nutzen
// kann und das die Adresse belegt. Geprueft an der REIHENFOLGE im Code.
const posSmtp   = einladen.indexOf('smtp_konfiguriert');
const posBasis  = einladen.indexOf('basis_url');
const posInsert = einladen.indexOf('INSERT INTO betreiber');
check('KRITISCH: Versand und eigene Adresse werden VOR dem Anlegen geprueft',
  posSmtp > 0 && posBasis > 0 && posInsert > 0
  && posSmtp < posInsert && posBasis < posInsert);
check('KRITISCH: scheitert der Versand, bleibt kein Konto zurueck',
  /beginTransaction/.test(einladen) && /rollBack/.test(einladen));

// ── 6. Die eigene Adresse kommt aus dem Deploy (ENT-501) ──────────────
//
// Der Link in der Nachricht ist genau die Sorte Link, um die es in ENT-501
// ging: Der Server verschickt ihn, und er fuehrt an eine Stelle, an der ein
// Passwort gesetzt wird.
check('KRITISCH: der Link wird aus basis_url() gebaut, nie aus dem Host-Kopf',
  /basis_url\(\)/.test(einladen) && !/HTTP_HOST/.test(einladen));

// ── 6b. Der Pfad zur Seite wird gemessen, nicht geraten ──────────────
//
// FALLSTRICK, an dem dieser Link beinahe gescheitert waere: Der Deploy legt
// betreiber.html im Betreiber-Buendel als index.html ab -- auf
// betreiber.guardops.ch gibt es also KEIN /betreiber.html. Ein fest
// geschriebener Pfad waere ausgerechnet dort falsch gewesen, und es waere
// erst aufgefallen, wenn die erste eingeladene Person auf den Link klickt.
//
// Geprueft wird beides: dass der Endpunkt nachsieht statt zu raten, UND
// dass die Annahme dahinter noch stimmt. Aendert jemand den Deploy so, dass
// die Datei dort unter ihrem eigenen Namen landet, wird diese Pruefung rot
// und nicht der Link.
const werk = lies('.github/workflows/deploy-hostpoint.yml');
check('KRITISCH: der Pfad zur Einladungsseite wird am Buendel gemessen, nicht fest geschrieben',
  /is_file\(__DIR__/.test(einladen)
  && !/'\/betreiber\.html\?einladung/.test(einladen));
check('KRITISCH: und die Annahme stimmt — das Betreiber-Buendel legt die Seite als index.html ab',
  /cp betreiber\.html\s+dist-betreiber\/index\.html/.test(werk));
check('… waehrend das Cockpit-Buendel sie unter ihrem eigenen Namen fuehrt',
  /cp betreiber\.html\s+dist\/betreiber\.html/.test(werk));

// Die neuen Endpunkte muessen im Betreiber-Buendel ankommen. Sie heissen
// alle betreiber_* und werden davon mitgezogen -- geprueft, weil ein
// Endpunkt, der nicht ausgeliefert wird, lokal gruen ist und live 404.
check('KRITISCH: die Endpunkte werden ins Betreiber-Buendel kopiert',
  /cp backend\/api\/betreiber_\*\.php\s+dist-betreiber\/api\//.test(werk));
// Und der Versand braucht den Mailer dort. Fehlte er, brauchte der
// Endpunkt ihn per require und die Seite bekaeme einen 500 statt einer
// Einladung.
check('KRITISCH: der Mailer liegt im Betreiber-Buendel',
  /cp backend\/mailer\.php\s+dist-betreiber\/mailer\.php/.test(werk));

// ── 7. Abgelaufen, eingeloest und erfunden geben DIESELBE Antwort ─────
//
// Verglichen werden die beiden Endpunkte miteinander: Sagte einer von
// beiden mehr als der andere, liesse sich durch Vergleich der Antworten
// herausfinden, ob es einen Link einmal gab.
const textPruefen   = (pruefen.match(/'message' => '([^']*gilt nicht mehr[^']*)'/) || [])[1];
const textEinloesen = (einloesen.match(/'message' => '([^']*gilt nicht mehr[^']*)'/) || [])[1];
check('KRITISCH: beide Endpunkte antworten auf einen untauglichen Link gleichlautend',
  !!textPruefen && textPruefen === textEinloesen);
check('… und nennen dabei nicht, WARUM er untauglich ist',
  !!textPruefen && !/abgelaufen|eingelöst|eingeloest|unbekannt/i.test(textPruefen));

// ── 8. Bremse an beiden oeffentlichen Endpunkten ──────────────────────
//
// Ein 256-Bit-Token laesst sich nicht erraten -- die Bremse ist hier keine
// Abwehr, sondern eine Begrenzung. Eigener Namensraum, damit Fehlversuche
// hier nicht den gewoehnlichen Anmeldeweg sperren (ENT-373/ENT-524).
for (const [name, quelle] of [['pruefen', pruefen], ['einloesen', einloesen]]) {
  check(`der oeffentliche Endpunkt "${name}" hat eine Bremse`,
    /anmeld_zaehlen/.test(quelle) && /anmeld_sperre/.test(quelle));
  // Eigener Namensraum fuer den NAMENSZAEHLER. Der Adresszaehler bleibt
  // geteilt, und das ist so gewollt -- siehe Kopf der Endpunkte.
  check(`… unter eigenem Namensraum, nicht dem des Anmeldewegs`,
    /be-einladung:/.test(quelle) && !/'betreiber:'/.test(quelle));
}
// Ein zu schwaches Passwort ist KEIN Fehlversuch: Der Link war richtig.
// Wer daran gezaehlt wuerde, sperrte sich beim Ausprobieren selbst aus.
const nachPasswortpruefung = einloesen.split('passwort_pruefen')[1] || '';
const bisTransaktion = nachPasswortpruefung.split('beginTransaction')[0] || '';
check('KRITISCH: ein zu schwaches Passwort zaehlt nicht als Fehlversuch',
  bisTransaktion.length > 0 && !/anmeld_fehlversuch/.test(bisTransaktion));

// ── 9. "Eingeladen" ist in der Oberflaeche ein eigener Zustand ────────
//
// Die Hausregel, dass Unbekanntes nie wie Keines aussehen darf -- hier in
// der Richtung, die leicht uebersehen wird: Ein eingeladenes Konto hatte
// nie Zugang, ein stillgelegtes hatte einmal welchen. Wuerden beide gleich
// dargestellt, boete die Oberflaeche ausserdem ein "aktivieren" an, das der
// Server zu Recht zurueckweist.
check('KRITISCH: der Server meldet den Zustand "eingeladen" mit',
  /'eingeladen'\]\s*=\s*be_einladung_offen/.test(liste));
check('KRITISCH: die Liste zeigt drei Zustaende, nicht zwei',
  /k\.eingeladen/.test(seite) && /stillgelegt/.test(seite) && />aktiv</.test(seite));

// ── 10. Der Token verschwindet aus der Adresszeile ────────────────────
//
// Er kommt aus einer E-Mail und steht darum zwangslaeufig einmal in der
// URL. Bleibt er dort, wandert er in den Browserverlauf und beim naechsten
// Klick als Referrer mit.
check('KRITISCH: der Token wird aus der Adresszeile entfernt',
  /replaceState/.test(seite) && /searchParams\.delete\('einladung'\)/.test(seite));

// ── 11. Die Frist steht an EINER Stelle ───────────────────────────────
//
// Nicht die Zahl wird geprueft -- die darf sich aendern --, sondern dass es
// keine zweite gibt. Eine Frist, die im Server, in der Nachricht und in der
// Oberflaeche je einmal ausgeschrieben steht, ist beim naechsten Bemessen
// an zwei Stellen falsch.
check('die Frist ist eine benannte Groesse im Modul',
  /const BE_EINLADUNG_STUNDEN\s*=\s*\d+;/.test(modul));
check('KRITISCH: die Oberflaeche schreibt die Frist nicht selbst aus, sondern nimmt sie vom Server',
  /gueltig_stunden/.test(seite));

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
