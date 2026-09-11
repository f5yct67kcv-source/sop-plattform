// Betreiber-Ebene (ENT-524): Trennung, Sitzungen, Mandantenstamm.
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
// Beide Formen zaehlen: require_betreiber() weist aus, wer jemand ist,
// require_betreiber_voll() zusaetzlich, dass sein zweiter Faktor steht.
const WACHE = /require_betreiber(?:_voll)?\s*\(/;
const ohneWache = endpunkte.filter(f =>
  !EINSTIEG[f] && !WACHE.test(nurCode(lies(`backend/api/${f}`))));
check('KRITISCH: jeder betreiber_*-Endpunkt ruft require_betreiber() oder steht namentlich da',
  ohneWache.length === 0);
if (ohneWache.length) { bad.push('ohne Wache: ' + ohneWache.join(', ')); }

// Kehrseite, und sie ist der wichtigere Teil: Bekommt ein Einstiegspunkt
// spaeter doch eine Wache, gehoert er aus der Liste heraus -- sonst waechst
// eine Ausnahmeliste, die niemand mehr aufraeumt.
// Geprueft wird, ob die Wache BEDINGUNGSLOS gerufen wird -- am Zeilenanfang
// ohne Einrueckung. Ein Einstiegspunkt darf sie in einem if stehen haben
// (betreiber_einrichten.php tut das seit der Bootstrap-Grenze); wer sie
// dagegen ohne Bedingung ruft, ist kein Einstiegspunkt mehr und gehoert
// aus der Liste.
const WACHE_IMMER = /^require_betreiber(?:_voll)?\s*\(/m;
const unnoetigBefreit = Object.keys(EINSTIEG).filter(f =>
  endpunkte.includes(f) && WACHE_IMMER.test(nurCode(lies(`backend/api/${f}`))));
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
// Die Aussage betrifft die SPALTE token, nicht die Tabelle: Ein CREATE
// TABLE legt sie nur an, und ein Loeschen nach betreiber_id braucht keinen
// Abdruck. Geprueft wird, wer den Token als Ausweis benutzt.
const UEBER_TOKEN = /(?:SELECT|INSERT INTO|UPDATE|DELETE FROM)[\s\S]{0,240}betreiber_sessions[\s\S]{0,240}\btoken\b|\btoken\b[\s\S]{0,120}betreiber_sessions/;
const ueberToken = [['modul', modul], ...endpunkte.map(f => [f, lies(`backend/api/${f}`)])]
  .map(([n, q]) => [n, nurCode(q)])
  .filter(([, q]) => UEBER_TOKEN.test(q) && !/CREATE TABLE[\s\S]{0,400}betreiber_sessions/.test(q));
check('es gibt ueberhaupt Zugriffe ueber den Sitzungstoken', ueberToken.length > 0);
const ohneAbdruck = ueberToken.filter(([, q]) => !q.includes('sitzung_abdruck('));
check('KRITISCH: wer betreiber_sessions ueber den token anspricht, benutzt sitzung_abdruck()',
  ohneAbdruck.length === 0);
if (ohneAbdruck.length) { bad.push('ohne Abdruck: ' + ohneAbdruck.map(([n]) => n).join(', ')); }
// Zweite, unabhaengige Aussage: Der Rohwert darf nirgends direkt in eine
// Abfrage wandern. Genau das war der Fehler, den ENT-501 aufgeraeumt hat.
const rohDurchgereicht = [['modul', modul], ...endpunkte.map(f => [f, lies(`backend/api/${f}`)])]
  .filter(([, q]) => /execute\(\s*\[\s*\$token\b/.test(nurCode(q)));
check('KRITISCH: der Rohtoken wird nie direkt in eine Abfrage gegeben',
  rohDurchgereicht.length === 0);
if (rohDurchgereicht.length) { bad.push('Rohtoken in Abfrage: ' + rohDurchgereicht.map(([n]) => n).join(', ')); }
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
// Nur die Stufe VOR dem zweiten Faktor: Dort entscheidet sich, ob die
// Antwort verraet, welche Adressen es gibt. Was danach kommt ("Der Code
// stimmt nicht"), setzt ein richtiges Passwort bereits voraus und darf
// deshalb eine eigene Aussage sein.
const vorZweitemFaktor = anm.split('── Zweiter Faktor')[0];
const meldungen = [...vorZweitemFaktor.matchAll(/'message' => '([^']*)'\]\s*,\s*401\)/g)].map(m => m[1]);
check('beide Fehlerwege der Passwortstufe sind da', meldungen.length >= 2);
check('KRITISCH: unbekannte Adresse und falsches Passwort antworten gleichlautend',
  meldungen.length >= 2 && new Set(meldungen).size === 1);
// Und die gemeinsame Meldung darf nicht doch verraten, worum es ging.
check('KRITISCH: die Meldung nennt weder Adresse noch Konto',
  meldungen.every(m => !/adresse|konto|benutzer|unbekannt|existiert|passwort/i.test(m)));
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

// ── 9. Aussperrschutz und Datensparsamkeit der neuen Endpunkte ───────
const kontoStatus = nurCode(lies('backend/api/betreiber_konto_status.php'));
check('KRITISCH: das letzte aktive Betreiber-Konto laesst sich nicht stilllegen',
  kontoStatus.includes('be_konten_zahl('));
check('beim Stilllegen verfallen die Sitzungen des Kontos mit',
  /DELETE FROM betreiber_sessions[\s\S]{0,80}betreiber_id/.test(kontoStatus));

// Der Passworthash verlaesst den Server nie -- auch nicht gegenueber
// jemandem, der ohnehin alles darf.
const kontoListe = nurCode(lies('backend/api/betreiber_konto_list.php'));
check('KRITISCH: die Kontenliste liefert keinen Passworthash',
  !/SELECT[\s\S]{0,200}passwort_hash/.test(kontoListe));

// Der Mandantenstamm nimmt kein Passwort entgegen -- und verschluckt es
// nicht still, sondern sagt es.
const save = nurCode(lies('backend/api/betreiber_mandant_save.php'));
check('KRITISCH: ein mitgesendetes Datenbank-Passwort wird abgewiesen, nicht verschluckt',
  /db_pass|db_passwort/.test(save) && /400/.test(save));
check('der Sammel-Schreibweg fasst weder Status noch GAV an',
  !/SET[\s\S]{0,200}\bstatus\s*=/.test(save) && !/gav_unterstellt\s*=/.test(save));

// Die GAV-Angabe wird bestaetigt, nicht gesetzt: ohne ausdrueckliche
// Bestaetigung passiert nichts, und wer bestaetigt hat, kommt aus der
// Sitzung -- nie aus der Anfrage.
const gav = nurCode(lies('backend/api/betreiber_mandant_gav.php'));
check('KRITISCH: ohne ausdrueckliche Bestaetigung wird die GAV-Angabe nicht geschrieben',
  /bestaetigt/.test(gav) && /400/.test(gav));
check('KRITISCH: der Bestaetigende kommt aus der Sitzung, nicht aus der Anfrage',
  /\$ich\['name'\]/.test(gav) && !/\$daten\['bestaetigt_von'\]|\$daten\['wer'\]/.test(gav));
check('die Frage kennt kein Ja als Vorgabewert',
  /is_bool\(\$daten\['unterstellt'\]\)/.test(gav));
// Der Hinweistext steht an EINER Stelle -- eine zweite Fassung in der
// Oberflaeche waere eine zweite Wahrheit darueber, was bestaetigt wurde.
check('der Hinweistext wird vom Server geliefert', gav.includes('GAV_HINWEIS'));
check('KRITISCH: der Hinweistext legt den GAV nicht selbst aus',
  /nicht nach einer Einschätzung dieser Software|nicht hergeleitet/.test(lies('backend/api/betreiber_mandant_gav.php')));

// Kein Betreiber-Endpunkt liefert Betriebsdaten mit. Der Bereich sieht
// Vertrag und Zustand eines Betriebs, nicht seinen Inhalt.
const BETRIEBSTABELLEN = /\bFROM (?:mitarbeiter|einsaetze|rapporte|lohnlauf|lohn_person|objekte|kunden)\b/;
const zuViel = endpunkte.filter(f => BETRIEBSTABELLEN.test(nurCode(lies(`backend/api/${f}`))));
check('KRITISCH: kein Betreiber-Endpunkt liefert Betriebsdaten',
  zuViel.length === 0);
if (zuViel.length) { bad.push('liest Betriebsdaten: ' + zuViel.join(', ')); }

// ── 10. Der zweite Faktor ist Pflicht, und zwar im Server (OP-517) ───
//
// Die Pflicht steht und faellt damit, dass die Vollwache tatsaechlich vor
// jedem Endpunkt sitzt, der etwas kann. Nur vier duerfen mit der einfachen
// Wache auskommen -- und der Grund steht bei jedem: Wer den Faktor erst
// einrichten muss, muss das erfahren, tun und bestaetigen koennen, und
// abmelden muss immer gehen. Alles andere verlangt die Vollwache.
const NUR_EINFACHE_WACHE = {
  'betreiber_zf_status.php':      'muss sagen duerfen, dass eingerichtet werden muss',
  'betreiber_zf_einrichten.php':  'richtet den Faktor ein',
  'betreiber_zf_bestaetigen.php': 'bestaetigt ihn',
  'betreiber_abmelden.php':       'abmelden muss immer moeglich sein',
};
const VOLLWACHE = /require_betreiber_voll\s*\(/;
const brauchtVoll = endpunkte.filter(f => !EINSTIEG[f] && !NUR_EINFACHE_WACHE[f]);
const ohneVoll = brauchtVoll.filter(f => !VOLLWACHE.test(nurCode(lies(`backend/api/${f}`))));
check('KRITISCH: jeder Betreiber-Endpunkt verlangt den zweiten Faktor oder steht namentlich da',
  ohneVoll.length === 0);
if (ohneVoll.length) { bad.push('ohne Vollwache: ' + ohneVoll.join(', ')); }
check('es gibt ueberhaupt Endpunkte hinter der Vollwache', brauchtVoll.length > 0);
// Kehrseite: Bekommt einer der vier spaeter doch die Vollwache, gehoert er
// aus der Liste heraus -- sonst waechst eine Ausnahmeliste, die niemand
// mehr aufraeumt.
const unnoetigEinfach = Object.keys(NUR_EINFACHE_WACHE).filter(f =>
  endpunkte.includes(f) && VOLLWACHE.test(nurCode(lies(`backend/api/${f}`))));
check('kein Endpunkt steht unnoetig in der Vollwache-Ausnahmeliste',
  unnoetigEinfach.length === 0);

// Die Wache selbst muss die Pflicht auch durchsetzen und nicht nur melden.
check('KRITISCH: require_betreiber_voll bricht ohne bestaetigten Faktor ab',
  /function require_betreiber_voll[\s\S]{0,1200}be_zf_ist_an\([\s\S]{0,600}json_response\([\s\S]{0,400}403/.test(modulCode));
// "Noch nicht eingerichtet" ist etwas anderes als "keine Berechtigung" --
// die Oberflaeche muss die beiden auseinanderhalten koennen.
check('der Abbruch nennt einen eigenen Grund statt nur "verboten"',
  modulCode.includes('BE_ZF_EINRICHTUNG'));

// Ein eingerichtetes, nie bestaetigtes Geheimnis zaehlt NICHT.
check('KRITISCH: erst die Bestaetigung schaltet den Faktor scharf',
  /function be_zf_ist_an[\s\S]{0,500}bestaetigt_am[\s\S]{0,200}!== null/.test(modulCode));

// Wiederverwendungsschutz: Ohne ihn bliebe ein mitgelesener Code die vollen
// dreissig Sekunden plus Toleranz gueltig.
check('KRITISCH: ein einmal benutzter Code gilt nicht noch einmal',
  /letztes_fenster[\s\S]{0,200}>=\s*\$fenster[\s\S]{0,80}return false/.test(modulCode));

// Notfallcodes liegen als Hash, nie im Klartext.
const zfBest = nurCode(lies('backend/api/betreiber_zf_bestaetigen.php'));
check('KRITISCH: Notfallcodes werden gehasht gespeichert',
  /password_hash\(/.test(zfBest) && !/notfallcodes = \?[\s\S]{0,120}json_encode\(\$codes\)/.test(zfBest));
check('die Notfallcodes gehen genau einmal hinaus, beim Bestaetigen',
  endpunkte.filter(f => /'notfallcodes'\s*=>\s*\$codes/.test(lies(`backend/api/${f}`))).length === 1);

// Zuruecksetzen ist der Weg zurueck ueber ein ZWEITES Konto, keine
// Hintertuer am eigenen.
const zfReset = nurCode(lies('backend/api/betreiber_zf_zuruecksetzen.php'));
check('KRITISCH: zuruecksetzen verlangt selbst einen bestaetigten Faktor',
  VOLLWACHE.test(zfReset));
check('KRITISCH: der eigene Faktor laesst sich so nicht abraeumen',
  /\$ziel === \(int\)\$ich\['id'\]/.test(zfReset));
check('beim Zuruecksetzen enden die Sitzungen des Ziels',
  /DELETE FROM betreiber_sessions[\s\S]{0,60}betreiber_id/.test(zfReset));

// Kein gemerktes Geraet auf dieser Ebene -- bewusst anders als in der
// Verwaltung, weil hinter diesem Konto jeder Betrieb liegt.
check('KRITISCH: kein vertrauenswuerdiges Geraet umgeht den Faktor',
  !/zf_geraet_gilt\(|ZF_GERAET_TAGE/.test(nurCode(anm)));

// Und die Anmeldung darf die Fehlversuche erst zuruecksetzen, wenn auch der
// Code stimmt -- sonst liesse er sich unbegrenzt durchprobieren.
check('KRITISCH: der Code wird vor der Sitzung geprueft, nicht danach',
  anm.indexOf('be_zf_code_einloesen') < anm.indexOf('INSERT INTO betreiber_sessions'));

// ── 11. mandant_db() ist keine Hintertuer zum Support-Zugriff ────────
//
// DIE WICHTIGSTE WACHE DIESES ABSCHNITTS. Der Support-Zugriff auf
// Betriebsdaten ist als "nur auf Freigabe des Mandanten, befristet,
// protokolliert" vorgesehen und bewusst NOCH NICHT gebaut. Mit
// mandant_db() liesse er sich versehentlich nachbauen, ohne dass jemand
// die Entscheidung dazu trifft -- eine Abfrage auf eine Mandantentabelle,
// und der Zugriff existiert.
//
// Erlaubt ist darum genau eines: die Erreichbarkeit und den
// Einrichtungsstand pruefen. Wer mandant_db() fuer etwas anderes benutzt,
// faellt hier durch.
const MANDANT_VERBINDER = /mandant_db\s*\(|mandant_stand\s*\(/;
const nutztMandantDb = endpunkte.filter(f => MANDANT_VERBINDER.test(nurCode(lies(`backend/api/${f}`))));
check('es gibt ueberhaupt einen Endpunkt, der die Mandantenlage prueft',
  nutztMandantDb.length > 0);
// Erlaubt sind genau zwei Endpunkte, namentlich -- und der zweite muss
// zusaetzlich die drei Bedingungen des Supportzugriffs erfuellen, die
// weiter unten einzeln geprueft werden. Die Liste ist damit nicht
// laenger geworden, sondern strenger: Wer verbinden darf, muss Freigabe
// UND Protokoll nachweisen.
const DARF_VERBINDEN = {
  'betreiber_mandant_stand.php': 'zaehlt Tabellen, liest nichts',
  'betreiber_support.php':       'nur auf Freigabe, befristet, protokolliert (ENT-526)',
};
const heimlich = nutztMandantDb.filter(f => !DARF_VERBINDEN[f]);
check('KRITISCH: nur namentlich genannte Endpunkte verbinden zu einer Mandantendatenbank',
  heimlich.length === 0);
if (heimlich.length) { bad.push('verbindet zum Mandanten: ' + heimlich.join(', ')); }
// Kehrseite: Verschwindet einer, gehoert er aus der Liste -- sonst deckt
// ein veralteter Eintrag den naechsten Endpunkt gleichen Namens zu.
const toteErlaubnis = Object.keys(DARF_VERBINDEN).filter(f => !endpunkte.includes(f));
check('kein toter Eintrag in der Verbindungs-Erlaubnisliste', toteErlaubnis.length === 0);

// ── Die drei Bedingungen des Supportzugriffs (ENT-526) ───────────────
//
// Der Zugriff auf einen fremden Betrieb ist die heikelste Stelle der ganzen
// Anlage. Er haengt an drei Bedingungen, und keine davon darf still
// wegfallen -- darum steht jede hier einzeln.
const sup = nurCode(lies('backend/api/betreiber_support.php'));

// 1. Ohne gueltige Freigabe wird abgebrochen.
check('KRITISCH: ohne gueltige Freigabe bricht der Supportzugriff ab',
  /support_freigabe_gueltig\([\s\S]{0,200}=== null[\s\S]{0,400}403/.test(sup));
// Und die Freigabe wird in der Datenbank des MANDANTEN gelesen, nicht im
// Stamm des Betreibers -- laege sie dort, koennte er sie sich selbst
// ausstellen.
check('KRITISCH: die Freigabe wird beim Mandanten gelesen, nicht beim Betreiber',
  sup.indexOf('mandant_db(') < sup.indexOf('support_freigabe_gueltig('));

// 2. Protokolliert wird VOR der Auslieferung. Ein Abbruch mitten im
//    Ausliefern darf keine Luecke hinterlassen.
check('KRITISCH: der Zugriff wird protokolliert',
  sup.includes('support_zugriff_merken('));
check('KRITISCH: das Protokoll entsteht vor der Auslieferung',
  sup.indexOf('support_zugriff_merken(') < sup.lastIndexOf('json_response('));

// 3. Der Umfang bleibt ohne Personenbezug. Geprueft wird die Aussage:
//    keine Abfrage, die Zeilen aus einer Kerntabelle holt -- COUNT(*) ist
//    etwas anderes als SELECT name.
check('KRITISCH: es werden keine Zeilen aus Kerntabellen gelesen, nur gezaehlt',
  !/SELECT\s+(?!COUNT)[a-z_., *]*\s+FROM\s+`?(?:mitarbeiter|einsaetze|rapporte|lohn_person|lohnlauf|kunden|objekte)`?\b/i.test(sup));
check('KRITISCH: keine vertraulichen Personalfelder im Supportzugriff',
  !/ma_vertrauliche_felder|ahv|aufenthalt|lohn_ansatz/i.test(sup));
// Der Treiberfehler geht auch hier nicht nach aussen.
check('der Verbindungsfehler nennt die Lage statt den Treibertext',
  /catch \(Throwable \$e\)[\s\S]{0,400}mandant_verbindung_bereit/.test(sup));

// ── Die Seite des Betriebs: die Freigabe gehoert ihm ─────────────────
const frei = nurCode(lies('backend/api/support_freigabe.php'));
// Sie haengt am Recht "Rollen & Berechtigungen", nicht an
// "Betriebseinstellungen": Wer sie erteilt, bestimmt, dass ein
// Betriebsfremder an Daten kommt.
check("KRITISCH: die Freigabe haengt am Recht 'rechte', nicht an 'betrieb'",
  /require_recht_nach_methode\(\$user, 'rechte'\)/.test(frei));
// Wer freigibt, kommt aus der Sitzung -- nie aus der Anfrage.
check('KRITISCH: der Freigebende kommt aus der Sitzung',
  /\$user\['name'\]/.test(frei) && !/\$daten\['freigegeben_von'\]|\$daten\['wer'\]/.test(frei));
// Ein Zweck ist Pflicht -- eine Freigabe ohne Grund laesst sich spaeter
// nicht mehr einordnen.
check('KRITISCH: ohne Zweck keine Freigabe', /\$zweck === ''[\s\S]{0,200}400/.test(frei));
// Und sie ist befristet: Das Modul deckelt die Dauer, der Endpunkt kann
// sie nicht umgehen.
const supModul = nurCode(lies('backend/support.php'));
check('KRITISCH: die Dauer ist gedeckelt',
  /SUPPORT_STUNDEN_MAX[\s\S]{0,120}\$stunden = SUPPORT_STUNDEN_MAX/.test(supModul));
check('KRITISCH: eine widerrufene oder abgelaufene Freigabe gilt nicht',
  /widerrufen_am IS NULL AND gilt_bis > NOW\(\)/.test(supModul));
// Widerruf trifft ALLE offenen, nicht nur die juengste.
check('der Widerruf trifft jede offene Freigabe',
  /UPDATE support_freigabe SET widerrufen_am = NOW\(\)\s*\n?\s*WHERE widerrufen_am IS NULL/.test(supModul));
// Das Protokoll ist fuer den Betrieb einsehbar -- ein Protokoll, das nur
// der Einsehende fuehrt, ist keines.
check('KRITISCH: der Betrieb kann das Protokoll selbst einsehen',
  endpunkte.length >= 0 && /SELECT[\s\S]{0,200}FROM support_zugriff/.test(nurCode(lies('backend/api/support_protokoll.php'))));

// Und auch der Stand-Endpunkt liest keine Betriebsdaten -- er zaehlt
// Tabellen. Ein SELECT auf eine Kerntabelle waere der Support-Zugriff.
const standCode = nurCode(lies('backend/api/betreiber_mandant_stand.php'));
check('KRITISCH: der Stand-Endpunkt liest keine Betriebsdaten',
  !/SELECT[\s\S]{0,120}FROM (?:mitarbeiter|einsaetze|rapporte|lohnlauf|kunden|objekte)\b/.test(standCode));
check('der Stand-Endpunkt haengt hinter der Vollwache', VOLLWACHE.test(standCode));

// Das Passwort kommt aus dem Deploy, nicht aus der Tabelle -- auch hier.
check('KRITISCH: die Verbindung holt das Passwort aus dem Deploy-Secret',
  /mandant_secret\(/.test(modulCode) && !/SELECT[\s\S]{0,120}db_pass/.test(modulCode));
// Ein Treiberfehler kann Host und Benutzer enthalten und darf nicht nach
// aussen gehen.
check('KRITISCH: Treiberfehler werden nicht weitergereicht',
  /catch \(Throwable \$e\)[\s\S]{0,400}nicht_erreichbar/.test(modulCode)
  && !/getMessage\(\)[\s\S]{0,120}json_response/.test(modulCode));

// ── 12. Die Seite des Betriebs im Cockpit (ENT-526) ──────────────────
//
// Ohne diese Seite gibt es keine Freigabe -- und ohne Freigabe keinen
// Supportzugriff. Sie gehoert darum genauso geprueft wie die Endpunkte.
const cockpit = readFileSync(join(WURZEL, 'dashboard.html'), 'utf8');
check('das Cockpit hat einen Abschnitt fuer die Support-Freigabe',
  cockpit.includes('bkAb-sf') && cockpit.includes('bkKachelSf'));
// Die Kachel haengt am Recht -- das erspart den Umweg, die Sperre sitzt im
// Server.
check('KRITISCH: die Kachel erscheint nur mit dem Recht "Rollen & Berechtigungen"',
  /bkKachelSfSetzen[\s\S]{0,400}darf\('rechte_/.test(cockpit));
// Der Zweck ist auch in der Oberflaeche Pflicht, damit niemand erst nach
// dem Absenden erfaehrt, dass etwas fehlt.
check('die Oberflaeche verlangt den Zweck, bevor sie absendet',
  /function sfFreigeben[\s\S]{0,300}!zweck[\s\S]{0,120}return/.test(cockpit));
// Der Betrieb sieht sein eigenes Protokoll.
check('KRITISCH: das Cockpit ruft das Zugriffsprotokoll ab',
  cockpit.includes('support_protokoll.php'));
// Und die vier Aussagen bleiben vier: "nicht eingerichtet", "nie
// freigegeben", "freigegeben aber nie eingesehen" und die Zugriffe selbst.
check('KRITISCH: freigegeben-aber-nie-genutzt ist eine eigene Aussage',
  /nie eingesehen/.test(cockpit));
check('nicht eingerichtet ist eine eigene Aussage',
  /nicht_eingerichtet[\s\S]{0,300}Noch nicht eingerichtet/.test(cockpit));
// Die Freigabe wird von der Oberflaeche nicht umgangen: Sie ruft denselben
// Endpunkt, der die Rechte prueft.
check('die Oberflaeche geht ueber den geprueften Endpunkt',
  /api\('support_freigabe\.php'/.test(cockpit));

// Und im Betreiber-Bereich wird sichtbar, was NICHT geliefert wird --
// sonst entsteht der Eindruck, man saehe den ganzen Betrieb.
const betrSeite = readFileSync(join(WURZEL, 'betreiber.html'), 'utf8');
check('KRITISCH: der Betreiber-Bereich zeigt den Umfang des Zugriffs an',
  betrSeite.includes('sup-freigabe') && /a\.umfang/.test(betrSeite));
check('fehlt die Freigabe, nennt der Bereich die Lage statt nur "verboten"',
  /SUPPORT_LAGE_TEXT/.test(betrSeite));
check('KRITISCH: der Betreiber-Bereich setzt keine Freigabe',
  !/support_freigabe\.php/.test(betrSeite));

// ── 13. Der Bootstrap ist begrenzt ───────────────────────────────────
//
// Die Luecke, die beim Aufschreiben der Einrichtungsreihenfolge auffiel:
// Bei getrennten Datenbanken hat jeder Mandant eine eigene Verwaltung, aber
// alle teilen sich die Betreiber-Datenbank. Ohne Grenze koennte die
// Verwaltung eines FREMDEN Betriebs sich das erste Betreiber-Konto
// ausstellen.
const kontoNeu = nurCode(lies('backend/api/betreiber_konto_anlegen.php'));
check('KRITISCH: das erste Konto laesst sich nur beim einzigen Mandanten anlegen',
  /be_bootstrap_offen\([\s\S]{0,400}403/.test(kontoNeu));
const einrCode = nurCode(lies('backend/api/betreiber_einrichten.php'));
check('KRITISCH: auch die Einrichtung ist ab dem zweiten Mandanten geschlossen',
  /be_bootstrap_offen\([\s\S]{0,120}require_betreiber_voll\(/.test(einrCode));
// Und die Grenze steht an EINER Stelle, nicht zweimal nachgebaut.
check('die Grenze steht an einer Stelle', modulCode.includes('function be_bootstrap_offen'));

// Der Aufrufweg: Ohne ihn waere die Einrichtung ein Endpunkt, den niemand
// erreicht. Er blendet sich aus, sobald ein Konto steht.
check('KRITISCH: es gibt einen Aufrufweg fuer die Einrichtung im Cockpit',
  cockpit.includes('betreiber_einrichten.php') && cockpit.includes('betreiber_konto_anlegen.php'));
check('der Aufrufweg verschwindet, sobald ein Konto steht',
  /Number\(data\.konten\) > 0[\s\S]{0,60}return/.test(cockpit));

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
