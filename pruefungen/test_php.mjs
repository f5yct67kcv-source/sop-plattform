// Statische Pruefung der PHP-Endpunkte (ENT-072).
//
// Die uebrigen Suiten fahren die Oberflaeche und bilden die Schnittstelle
// nach -- PHP laeuft dabei nie. Zwei produktive Fehler sind deshalb an
// vierunddreissig gruenen Suiten vorbeigekommen: ein Aufruf einer Funktion,
// die im erreichbaren Code gar nicht existierte, und eine Variable, die in
// ihrer Datei nie gesetzt wird. Beide waeren beim ersten echten Aufruf
// hochgegangen. Diese Suite schliesst genau diese Luecke.
//
// Ein dritter kam am 2026-09-11 dazu (ENT-540) und war monatelang produktiv:
// eine Konstante, die nur in einem anderen ENDPUNKT stand. Endpunkte binden
// einander nie ein. Die betroffene Zeile lief nur, wenn ein Foto dabei war --
// darum kam jede Ereignismeldung ohne Foto an und jede mit Foto nie.
import { WURZEL, HIER, OUT, browserPfad } from './pfade.mjs';
import { execFileSync } from 'child_process';
import { readFileSync, readdirSync } from 'fs';
import { dirname, resolve } from 'path';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

let ausgabe = '', code = 0;
try {
  ausgabe = execFileSync('php', [`${HIER}/pruef_php.php`],
    { encoding: 'utf8' });
} catch (e) {
  ausgabe = String(e.stdout || '') + String(e.stderr || '');
  code = e.status || 1;
}

const zeilen = ausgabe.split('\n');
const anzahl = Number((ausgabe.match(/^(\d+) Endpunkte geprueft/m) || [0, 0])[1]);
const beanstandet = zeilen.filter(z => z.trim().startsWith('X '));

check('Die Pruefung laeuft ueberhaupt durch', anzahl > 0);
check('Sie erfasst alle Endpunkte (mindestens 50)', anzahl >= 50);
check('KRITISCH: kein Aufruf einer unbekannten Funktion',
  !beanstandet.some(z => /unbekannten Funktion/.test(z)));
check('KRITISCH: keine Variable, die gelesen aber nie gesetzt wird',
  !beanstandet.some(z => /nie gesetzt/.test(z)));
// Dritte Fehlerklasse, dazugekommen mit ENT-540: eine Konstante des Hauses,
// die in einem ANDEREN Endpunkt definiert ist. Endpunkte binden einander nie
// ein; PHP 8 wirft dafuer einen Error, und im Browser steht "Unerwarteter
// Serverfehler". Gefunden, weil jede Ereignismeldung MIT Foto daran
// scheiterte und jede ohne ankam -- die Zeile lief nur im Foto-Zweig.
check('KRITISCH: keine Hauskonstante, die vom Endpunkt aus nicht erreichbar ist',
  !beanstandet.some(z => /nicht erreichbar/.test(z)));
check('KRITISCH: gar keine Beanstandung', code === 0 && beanstandet.length === 0);

// ── Die Layout-Pruefung wird WIRKLICH ausgefuehrt (ENT-073).
// Sie ist die Stelle, an der fremde Daten in die Datenbank wollen. Eine
// Suite, die die Serverantwort vortaeuscht, kaeme dort nie vorbei.
let layoutAus = '', layoutCode = 0;
try {
  layoutAus = execFileSync('php', [`${HIER}/pruef_layout.php`],
    { encoding: 'utf8' });
} catch (e) {
  layoutAus = String(e.stdout || '') + String(e.stderr || '');
  layoutCode = e.status || 1;
}
const layoutBeanstandet = layoutAus.split('\n').filter(z => z.trim().startsWith('X '));
check('KRITISCH: die Layout-Pruefung laesst nur gueltige Anordnungen durch',
  layoutCode === 0 && layoutBeanstandet.length === 0);
check('Sie prueft mindestens 15 Faelle',
  Number((layoutAus.match(/^(\d+) Pruefungen bestanden/m) || [0, 0])[1]) >= 15);
if (layoutBeanstandet.length) { layoutBeanstandet.forEach(z => bad.push('PHP-Layout: ' + z.trim())); }

// ── Die Sitzungs-Ablaufregel wird WIRKLICH ausgefuehrt (ENT-075).
// Bis dahin lief eine Sitzung nie ab. Eine Regel, die niemand ausfuehrt,
// ist eine Behauptung.
let sitzAus = '', sitzCode = 0;
try {
  sitzAus = execFileSync('php', [`${HIER}/pruef_sitzung.php`],
    { encoding: 'utf8' });
} catch (e) {
  sitzAus = String(e.stdout || '') + String(e.stderr || '');
  sitzCode = e.status || 1;
}
const sitzBeanstandet = sitzAus.split('\n').filter(z => z.trim().startsWith('X '));
check('KRITISCH: Sitzungen laufen ab -- absolut und bei Untaetigkeit',
  sitzCode === 0 && sitzBeanstandet.length === 0);
check('Die Ablaufregel wird in mindestens 12 Faellen geprueft',
  Number((sitzAus.match(/^(\d+) Pruefungen bestanden/m) || [0, 0])[1]) >= 12);
if (sitzBeanstandet.length) { sitzBeanstandet.forEach(z => bad.push('PHP-Sitzung: ' + z.trim())); }

// KRITISCH: Der Token darf nur noch aus dem Kopfbereich kommen. In der URL
// landet er in Server-Protokollen und im Browserverlauf.
const dbQuelle = execFileSync('cat', [`${WURZEL}/backend/db.php`], { encoding: 'utf8' });
check('KRITISCH: der Sitzungs-Token wird nicht aus der URL angenommen',
  !/\$_GET\[.token.\]/.test(dbQuelle) && !/\$_POST\[.token.\]/.test(dbQuelle));

// ── Die Anmeldebremse wird WIRKLICH ausgefuehrt (ENT-075).
let anmAus = '', anmCode = 0;
try {
  anmAus = execFileSync('php', [`${HIER}/pruef_anmeldung.php`],
    { encoding: 'utf8' });
} catch (e) {
  anmAus = String(e.stdout || '') + String(e.stderr || '');
  anmCode = e.status || 1;
}
const anmBeanstandet = anmAus.split('\n').filter(z => z.trim().startsWith('X '));
check('KRITISCH: Passwort-Raten wird gebremst -- und die Bremse ist zeitlich begrenzt',
  anmCode === 0 && anmBeanstandet.length === 0);
if (anmBeanstandet.length) { anmBeanstandet.forEach(z => bad.push('PHP-Anmeldung: ' + z.trim())); }

// Der Login muss die Bremse auch AUFRUFEN -- eine Regel, die niemand
// aufruft, ist eine Behauptung.
const loginQuelle = execFileSync('cat', [`${WURZEL}/backend/api/login.php`], { encoding: 'utf8' });
check('KRITISCH: login.php fragt die Bremse VOR der Passwortpruefung',
  loginQuelle.indexOf('anmeld_sperre') > 0
  && loginQuelle.indexOf('anmeld_sperre') < loginQuelle.indexOf('password_verify'));
check('KRITISCH: ein Fehlversuch wird auch gezaehlt', /anmeld_fehlversuch/.test(loginQuelle));
check('Nach erfolgreicher Anmeldung wird zurueckgesetzt', /anmeld_zuruecksetzen/.test(loginQuelle));
check('KRITISCH: die weitergegebene Adresskopfzeile wird NICHT vertraut -- die kann ein Angreifer setzen',
  !/X_FORWARDED_FOR/i.test(execFileSync('cat', [`${WURZEL}/backend/anmeldung.php`], { encoding: 'utf8' })));

// ── Die Passwortregeln werden WIRKLICH ausgefuehrt (ENT-075).
let pwAus = '', pwCode = 0;
try {
  pwAus = execFileSync('php', [`${HIER}/pruef_passwort.php`],
    { encoding: 'utf8' });
} catch (e) {
  pwAus = String(e.stdout || '') + String(e.stderr || '');
  pwCode = e.status || 1;
}
const pwBeanstandet = pwAus.split('\n').filter(z => z.trim().startsWith('X '));
check('KRITISCH: schwache Passwoerter werden abgewiesen', pwCode === 0 && pwBeanstandet.length === 0);
if (pwBeanstandet.length) { pwBeanstandet.forEach(z => bad.push('PHP-Passwort: ' + z.trim())); }

// ── Der Login-Name wird WIRKLICH gebildet (ENT-376). Namensgleichheit muss
// zu verschiedenen, eindeutigen Login-Namen fuehren (laufende Nummer),
// nicht zu einem abgelehnten Anlegen.
let lnAus = '', lnCode = 0;
try {
  lnAus = execFileSync('php', [`${HIER}/pruef_mitarbeiter_login.php`],
    { encoding: 'utf8' });
} catch (e) {
  lnAus = String(e.stdout || '') + String(e.stderr || '');
  lnCode = e.status || 1;
}
const lnBeanstandet = lnAus.split('\n').filter(z => z.trim().startsWith('X '));
check('KRITISCH: der Login-Name wird korrekt aus Vor- und Nachname gebildet, auch bei Namensgleichheit',
  lnCode === 0 && lnBeanstandet.length === 0);
if (lnBeanstandet.length) { lnBeanstandet.forEach(z => bad.push('PHP-Login-Name: ' + z.trim())); }

// Der Login-Name darf nicht (wieder) aus dem Formular kommen -- sonst waere
// die Bildung im Server nur Dekoration, und ein Aufruf am Formular vorbei
// koennte sich weiterhin einen beliebigen Namen aussuchen.
const createOhneKommentar = execFileSync('cat', [`${WURZEL}/backend/api/mitarbeiter_create.php`],
  { encoding: 'utf8' }).replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
check('KRITISCH: mitarbeiter_create.php bildet den Login-Namen selbst, statt ihn aus der Eingabe zu uebernehmen',
  /ma_login_generieren\s*\(/.test(createOhneKommentar) && !/\$input\['name'\]/.test(createOhneKommentar));

// ── Die Umstellung bestehender Login-Namen wird WIRKLICH ausgefuehrt
// (ENT-381) -- Namensgleichheit, uebersprungene Konten ohne Vor-/Nachname,
// gezielte Sitzungsloeschung und das Logbuch muessen alle stimmen, nicht
// nur die Umbenennung selbst.
let lmAus = '', lmCode = 0;
try {
  lmAus = execFileSync('php', [`${HIER}/pruef_mitarbeiter_login_migration.php`],
    { encoding: 'utf8' });
} catch (e) {
  lmAus = String(e.stdout || '') + String(e.stderr || '');
  lmCode = e.status || 1;
}
const lmBeanstandet = lmAus.split('\n').filter(z => z.trim().startsWith('X '));
check('KRITISCH: die Umstellung bestehender Login-Namen (Plan und Ausführung) läuft korrekt durch',
  lmCode === 0 && lmBeanstandet.length === 0);
if (lmBeanstandet.length) { lmBeanstandet.forEach(z => bad.push('PHP-Login-Migration: ' + z.trim())); }

// ── Die automatische Personalnummer wird WIRKLICH gezogen und vergeben
// (ENT-387) -- Kollisionsvermeidung, gezielte Zuweisung nur an fehlende
// Nummern und das Logbuch muessen stimmen, nicht nur die Ziehung selbst.
let pnAus = '', pnCode = 0;
try {
  pnAus = execFileSync('php', [`${HIER}/pruef_mitarbeiter_personalnummer.php`],
    { encoding: 'utf8' });
} catch (e) {
  pnAus = String(e.stdout || '') + String(e.stderr || '');
  pnCode = e.status || 1;
}
const pnBeanstandet = pnAus.split('\n').filter(z => z.trim().startsWith('X '));
check('KRITISCH: die automatische Personalnummer (Ziehung und Bestandsnachtrag) läuft korrekt durch',
  pnCode === 0 && pnBeanstandet.length === 0);
if (pnBeanstandet.length) { pnBeanstandet.forEach(z => bad.push('PHP-Personalnummer: ' + z.trim())); }

// Die Personalnummer darf nicht aus der Eingabe uebernommen werden, weder
// beim Anlegen noch beim Bearbeiten -- sonst waere die Sperre nur
// Dekoration im Formular.
const mitarbeiterPhpOhneKommentar = execFileSync('cat', [`${WURZEL}/backend/mitarbeiter.php`],
  { encoding: 'utf8' }).replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
check('KRITISCH: mitarbeiter_create.php bildet die Personalnummer selbst, statt sie aus der Eingabe zu uebernehmen',
  /ma_personalnummer_generieren\s*\(/.test(createOhneKommentar));
check("KRITISCH: ma_eingabe_lesen() sperrt die Personalnummer zentral gegen jeden Schreibweg -- Anlegen UND Bearbeiten laufen dort durch",
  /if \(\$feld === 'personalnummer'\)/.test(mitarbeiterPhpOhneKommentar));

// ── Von Hand aendern fuer die Verwaltung (ENT-393): Personalnummer und
// Login-Name sind fuer alle anderen weiter gesperrt (siehe die Pruefung
// oben), aber mitarbeiter_update.php darf sie mit dem Recht "rechte" UND
// derselben Formpruefung, die auch die automatische Bildung benutzt,
// gezielt oeffnen -- sonst waere die Sperre fuer alle wieder eine
// Umgehung fuer wen auch immer als Erstes danach fragt.
const updateOhneKommentar = execFileSync('cat', [`${WURZEL}/backend/api/mitarbeiter_update.php`],
  { encoding: 'utf8' }).replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
check('KRITISCH: eine manuelle Personalnummer-Aenderung laeuft durch dieselbe Formpruefung wie die automatische Ziehung',
  /ma_personalnummer_gueltig\s*\(/.test(updateOhneKommentar));
check('KRITISCH: eine manuelle Login-Namen-Aenderung laeuft durch dieselbe Formpruefung wie die automatische Bildung',
  /ma_login_name_gueltig\s*\(/.test(updateOhneKommentar));
// Geprueft wird die AUSSAGE, nicht der Wortlaut (ENT-440 hat die Rechte
// umbenannt): Personalnummer, Login-Name und Profile haengen alle drei am
// SELBEN Recht, und zwar an der Schreibstufe des Bereichs "Rollen &
// Berechtigungen". Ein Test auf den festen Namen 'rechte' waere beim
// naechsten Umbau gruen geblieben, waehrend die Sperre verschwindet.
const updateRechte = [...updateOhneKommentar.matchAll(/darf\(\$user,\s*'([a-z_]+)'\)/g)].map(m => m[1]);
const rollenRecht = updateRechte.filter(r => /^rechte_/.test(r));
check('KRITISCH: alle drei manuellen Aenderungen haengen am selben Recht wie die Profilvergabe',
  rollenRecht.length >= 3 && new Set(rollenRecht).size === 1);
check('KRITISCH: und das ist eine SCHREIB-Stufe, nicht blosses Lesen',
  /_schreiben$/.test(rollenRecht[0] || ''));
check('KRITISCH: nach einer manuellen Login-Namen-Aenderung werden die Sitzungen dieser Person beendet -- wie bei "Login-Namen umstellen"',
  /DELETE FROM sessions WHERE mitarbeiter_id/.test(updateOhneKommentar));

// ── Passwort-Ruecksetzung per E-Mail-Link, ENT-373 (Quelltext -- die
// Endpunkte benutzen MySQL-eigene Syntax und lassen sich nicht gegen den
// SQLite-Stub ausfuehren, siehe pruef_passwort_reset.php).
let prAus = '', prCode = 0;
try {
  prAus = execFileSync('php', [`${HIER}/pruef_passwort_reset.php`],
    { encoding: 'utf8' });
} catch (e) {
  prAus = String(e.stdout || '') + String(e.stderr || '');
  prCode = e.status || 1;
}
const prBeanstandet = prAus.split('\n').filter(z => z.trim().startsWith('✗ '));
check('KRITISCH: die Passwort-Ruecksetzung erfuellt alle eigenen Regeln (Admin-Ausnahme, Gleichlaut, Token-Hashing)',
  prCode === 0 && prBeanstandet.length === 0);
if (prBeanstandet.length) { prBeanstandet.forEach(z => bad.push('PHP-Reset: ' + z.trim())); }

// ── Demo-Anfrage von der Homepage, ENT-469: der Rechenkern wird echt
// ausgefuehrt (keine Datenbank noetig), der Endpunkt am Quelltext geprueft
// -- derselbe Schnitt wie bei der Passwort-Ruecksetzung oben.
let daAus = '', daCode = 0;
try {
  daAus = execFileSync('php', [`${HIER}/pruef_demo_anfrage.php`], { encoding: 'utf8' });
} catch (e) {
  daAus = String(e.stdout || '') + String(e.stderr || '');
  daCode = e.status || 1;
}
const daBeanstandet = daAus.split('\n').filter(z => z.trim().startsWith('✗ '));
check('KRITISCH: die Demo-Anfrage erfuellt alle eigenen Regeln (Bremse, Falle, Empfaenger aus Stammdaten, keine Kopfzeilen-Injektion)',
  daCode === 0 && daBeanstandet.length === 0);
if (daBeanstandet.length) { daBeanstandet.forEach(z => bad.push('PHP-Demo: ' + z.trim())); }

// Alle DREI Stellen, an denen ein Passwort gesetzt wird, muessen die Regel
// aufrufen -- eine vergessene Stelle waere ein offenes Hintertuerchen.
// Seit ENT-444 auch das Kundenportal: Ein Kundenpasswort ist kein
// Passwort zweiter Klasse -- eine eigene, mildere Regel dafuer waere genau
// die zweite Wahrheit, die dieses Haus an anderer Stelle verbietet.
const pwStellen = ['mitarbeiter_create.php', 'mitarbeiter_reset_password.php', 'mein_passwort.php',
  'passwort_zuruecksetzen.php', 'portal_neues_passwort.php'];
// Kommentare vorher weg: Ein Hinweis "// passwort_pruefen (ENT-075)" neben
// dem require ist kein Aufruf. Die erste Fassung dieser Pruefung ist genau
// darauf hereingefallen -- sie blieb gruen, als der Aufruf entfernt wurde.
const ohneKommentar = f => execFileSync('cat', [`${WURZEL}/backend/api/` + f],
  { encoding: 'utf8' }).replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const ohneRegel = pwStellen.filter(f => !/passwort_pruefen\s*\(/.test(ohneKommentar(f)));
check('KRITISCH: jede Stelle zum Passwortsetzen prueft die Regel',
  ohneRegel.length === 0);
if (ohneRegel.length) { bad.push('ohne Passwortregel: ' + ohneRegel.join(', ')); }

// Die Regel darf NICHT beim Anmelden greifen -- sonst sperrt der Deploy
// schlagartig jedes bestehende Konto aus.
check('KRITISCH: beim Anmelden wird die Laenge NICHT geprueft',
  !/passwort_pruefen\s*\(/.test(ohneKommentar('login.php')));

// ── Versand-Mail: einheitliche Schrift je Element, CTA im Firmenblau
// (ENT-206) -- Outlook Desktop vererbt font-family in HTML-Mails nicht
// zuverlaessig an verschachtelte Elemente, darum muss JEDES <p>/<a> sein
// eigenes font-family tragen, nicht nur der aeusserste Rahmen.
// Quelltext-Pruefung, kein gerendertes HTML: das style-Attribut entsteht aus
// PHP-Verkettung (u. a. der gemeinsamen $schrift-Variable), darum wird pro
// p/a-Tag auf den Bezug zu dieser Variable geprueft, nicht auf einen fertig
// zusammengesetzten style-Text.
const versendenQuelle = ohneKommentar('beleg_versenden.php');
const mailTags = [...versendenQuelle.matchAll(/<(p|a)\s[^>]*>/g)].map(m => m[0]);
check('KRITISCH: die Versand-Mail hat ueberhaupt gestaltete p/a-Elemente', mailTags.length >= 4);
check('KRITISCH: JEDES p/a-Element im Mailtext traegt sein eigenes font-family',
  mailTags.every(t => /\$schrift|font-family/.test(t)));
check('KRITISCH: der CTA-Knopf ist im Firmenblau, nicht schwarz',
  /background:#2F5BD7/.test(versendenQuelle) && !/background:#14161A/.test(versendenQuelle));

// ── Schutzeinstellungen des Web-Verzeichnisses (ENT-075) ────────────────
// Eine .htaccess laesst sich hier nicht ausfuehren -- geprueft wird darum,
// dass sie das Richtige abdeckt und dass sie ueberhaupt ausgeliefert wird.
const ht = execFileSync('cat', [`${WURZEL}/htaccess-hostpoint`], { encoding: 'utf8' });
const deploy = execFileSync('cat', [`${WURZEL}/.github/workflows/deploy-hostpoint.yml`], { encoding: 'utf8' });

check('KRITISCH: die Schutzeinstellungen werden ueberhaupt ausgeliefert',
  /cp htaccess-hostpoint dist\/\.htaccess/.test(deploy));

// Jede Hilfsdatei, die der Deploy ins Web-Verzeichnis legt, muss gesperrt
// sein. Kommt eine neue dazu und wird hier vergessen, liegt ihr Quelltext
// bei einem PHP-Ausfall offen -- bei db.php waere das das Datenbankpasswort.
const imWurzel = [...deploy.matchAll(/cp backend\/(\w+)\.php dist\//g)].map(m => m[1]);
const ungesperrt = imWurzel.filter(n => !new RegExp('[(|]' + n + '[)|]').test(ht));
check('KRITISCH: alle Hilfsdateien im Web-Verzeichnis sind gegen direkten Abruf gesperrt',
  imWurzel.length > 0 && ungesperrt.length === 0);
if (ungesperrt.length) { bad.push('nicht gesperrt: ' + ungesperrt.join(', ')); }

// DIE KEHRSEITE, und sie hat 2026-09-09 im Livesystem zugeschlagen:
// <FilesMatch> greift auf den DATEINAMEN, nicht auf den Pfad. Der Deploy
// legt Hilfsdateien nach dist/ und Endpunkte nach dist/api/ -- traegt ein
// ENDPUNKT denselben Namen wie eine gesperrte Hilfsdatei, sperrt die Regel
// ihn mit. So war api/lohnlauf.php im Betrieb nicht erreichbar: Der
// Webserver antwortete 403, BEVOR PHP startete. Im PHP war nichts zu
// finden -- Rechte und Sitzung stimmten, der Bereich blieb leer.
//
// Geprueft wird die Kollision selbst, nicht ein Dateiname: Die Namensliste
// kommt aus der echten FilesMatch-Zeile, die Endpunkte aus dem echten
// Verzeichnis.
const gesperrteNamen = ((ht.match(/<FilesMatch "\^\(([^)]*)\)\\\.php\$">/) || [])[1] || '').split('|');
const endpunkte = readdirSync(`${WURZEL}/backend/api`)
  .filter(f => f.endsWith('.php')).map(f => f.slice(0, -4));
// Am 2026-09-10 auf Weisung des Projektinhabers geleert: demo_anfrage.php
// war die letzte bekannte Kollision und ist umbenannt (api/demo_senden.php).
// Die Liste bleibt stehen, damit ein kuenftiger Fall aus einem fremden
// Bereich gemeldet werden kann, ohne die Suite dauerhaft rot zu faerben.
const KOLLISION_BEKANNT = [];
const kollisionen = endpunkte.filter(n => gesperrteNamen.includes(n));
check('KRITISCH: kein Endpunkt traegt den Namen einer gesperrten Hilfsdatei',
  gesperrteNamen.length > 3
  && kollisionen.filter(n => !KOLLISION_BEKANNT.includes(n)).length === 0);
kollisionen.filter(n => KOLLISION_BEKANNT.includes(n)).forEach(n => {
  console.log(`  ! api/${n}.php traegt einen gesperrten Namen — im Betrieb 403, fremder Bereich, gemeldet`);
});

// Dieselbe Kollision, derselbe Mechanismus -- diesmal fuer handbuch/, das
// eigene, von backend/api/ unabhaengige .php-Dateien in einem eigenen
// Unterordner ausliefert (siehe deploy-hostpoint.yml). Traf hier bereits
// zu: handbuch/planung.php, kunden.php, lohn.php und kundenportal.php
// kollidierten mit den gleichnamigen Hilfsdateien und wurden am
// 2026-09-14 auf das Praefix "hb-" umbenannt (siehe suchindex-bauen.mjs).
const handbuchSeiten = readdirSync(`${WURZEL}/handbuch`)
  .filter(f => f.endsWith('.php')).map(f => f.slice(0, -4));
const handbuchKollisionen = handbuchSeiten.filter(n => gesperrteNamen.includes(n));
check('KRITISCH: keine Handbuch-Seite traegt den Namen einer gesperrten Hilfsdatei',
  gesperrteNamen.length > 3 && handbuchKollisionen.length === 0);
if (handbuchKollisionen.length) {
  bad.push('handbuch/ kollidiert mit der Sperrliste: ' + handbuchKollisionen.join(', '));
}

// DER ZWEITE FEHLER AM DEMO-FORMULAR, und er wog schwerer als die
// Namenskollision: homepage.html rief "backend/api/demo_anfrage.php" auf --
// den Pfad im REPOSITORY. Der Deploy legt die Endpunkte aber nach dist/api/
// und erzeugt gar kein dist/backend/ (mkdir -p dist/api ...). Im Betrieb
// lief die Anfrage damit in ein 404, noch bevor die Sperrliste ueberhaupt
// zum Zug kam. Der Browsertest fiel darauf nicht herein: Er faengt die
// Anfrage per Route ab und traf denselben falschen Pfad.
//
// Geprueft wird deshalb die ausgelieferte Datei selbst: Kein Aufruf darf
// den Repo-Pfad tragen. Kommentare duerfen backend/... nennen -- gesucht
// wird nur, wo der Pfad als WERT steht (nach Anfuehrungszeichen oder =).
const seiten = [...deploy.matchAll(/cp (\w+\.html) dist\//g)].map(m => m[1]);
const mitRepoPfad = seiten.filter(f => {
  try { return /["'=]backend\/api\//.test(readFileSync(`${WURZEL}/${f}`, 'utf8')); }
  catch { return false; }
});
check('KRITISCH: keine ausgelieferte Seite ruft einen Endpunkt ueber den Repo-Pfad auf',
  seiten.length > 0 && mitRepoPfad.length === 0);
if (mitRepoPfad.length) { bad.push('ruft backend/api/ auf: ' + mitRepoPfad.join(', ')); }

check('Kein Einbetten in fremde Seiten (Clickjacking)',
  /X-Frame-Options *"DENY"/.test(ht) && /frame-ancestors 'none'/.test(ht));
check('Der Browser raet den Inhaltstyp nicht', /X-Content-Type-Options *"nosniff"/.test(ht));
check('Kein Auflisten von Verzeichnisinhalten', /Options -Indexes/.test(ht));
check('KRITISCH: gegen alte Apache-Fassungen abgesichert -- ein Fehler hier legt die ganze Seite lahm',
  /IfModule mod_authz_core\.c/.test(ht) && /IfModule !mod_authz_core\.c/.test(ht));
check('Kopfzeilen nur, wenn das Modul da ist', /IfModule mod_headers\.c/.test(ht));
check('Das Mikrofon bleibt erlaubt -- das Diktat braucht es',
  /microphone=\(self\)/.test(ht));

// ── Permissions-Policy gegen das, was die Oberflaechen wirklich benutzen
//    (ENT-501) ───────────────────────────────────────────────────────────
//
// ANLASS: Die Kopfzeile stand seit ENT-075 auf "geolocation=()" -- eine
// LEERE Erlaubnisliste, die den Standort auch fuer die eigene Seite sperrt.
// Sie stammt aus der Zeit VOR dem Revierdienst und ist nie nachgezogen
// worden. app.html braucht navigator.geolocation inzwischen an neun
// Stellen; am Standort haengt damit auch der Alleinarbeiterschutz.
//
// Warum das niemandem auffiel: Die Browser-Suiten bilden die Serverantwort
// nach und sehen die .htaccess nie. Eine Schutzeinstellung, die eine
// Funktion des Betriebs abschaltet, sieht im Quelltext richtig aus.
//
// Geprueft wird die AUSSAGE: Keine Funktion, die eine der Oberflaechen
// tatsaechlich aufruft, darf in der Kopfzeile auf einer leeren Liste
// stehen. Die Zuordnung Funktion -> Aufrufmuster steht hier, damit eine
// kuenftig ergaenzte Sperre denselben Abgleich bekommt.
const BROWSERFUNKTION = {
  geolocation: /navigator\.geolocation\b/,
  camera:      /getUserMedia\s*\(/,
  microphone:  /getUserMedia\s*\(|webkitSpeechRecognition|\bSpeechRecognition\b/,
};
const oberflaechen = ['app.html', 'dashboard.html', 'portal.html', 'index.html']
  .map(n => readFileSync(`${WURZEL}/${n}`, 'utf8')).join('\n');
const policy = (ht.match(/Permissions-Policy\s+"([^"]*)"/) || [null, ''])[1];
check('Es gibt ueberhaupt eine Permissions-Policy zu pruefen', policy.trim() !== '');
const gesperrtObwohlBenutzt = Object.entries(BROWSERFUNKTION)
  .filter(([funktion, muster]) => {
    const leer = new RegExp(funktion + '\\s*=\\s*\\(\\s*\\)').test(policy);
    return leer && muster.test(oberflaechen);
  })
  .map(([funktion]) => funktion);
check('KRITISCH: keine Browserfunktion ist gesperrt, die eine Oberflaeche tatsaechlich benutzt',
  gesperrtObwohlBenutzt.length === 0);
if (gesperrtObwohlBenutzt.length) {
  bad.push('per Kopfzeile gesperrt, aber benutzt: ' + gesperrtObwohlBenutzt.join(', '));
}
// Gegenrichtung: Die Zuordnung oben darf nicht ins Leere laufen. Trifft
// KEIN Muster mehr, prueft der Abgleich nichts mehr und ist gruen, ohne
// etwas zu wissen -- dieselbe Falle wie eine Ausnahmeliste ohne Datei.
check('Die Zuordnung Browserfunktion -> Aufrufmuster trifft ueberhaupt etwas',
  Object.values(BROWSERFUNKTION).some(m => m.test(oberflaechen)));
check('Die HTTPS-Umleitung ist NICHT scharf geschaltet -- sie kann die Seite unerreichbar machen',
  /# *RewriteRule \^ https/.test(ht));
check('Es steht drin, wie man die Datei wieder loswird, wenn sie Aerger macht',
  /SERVERFEHLER/.test(ht) && /\.htaccess loeschen/.test(ht));

// ── Der Zwei-Faktor-Rechenkern wird WIRKLICH ausgefuehrt (ENT-076).
// Wichtig daran: Er wird gegen die Testvektoren AUS DEM STANDARD geprueft,
// nicht gegen sich selbst. Eine selbstgebaute Berechnung, die nur mit sich
// selbst uebereinstimmt, ist immer gruen -- und trotzdem versteht sie kein
// Authenticator der Welt.
let zfAus = '', zfCode = 0;
try {
  zfAus = execFileSync('php', [`${HIER}/pruef_zweifaktor.php`],
    { encoding: 'utf8' });
} catch (e) {
  zfAus = String(e.stdout || '') + String(e.stderr || '');
  zfCode = e.status || 1;
}
const zfBeanstandet = zfAus.split('\n').filter(z => z.trim().startsWith('X '));
check('KRITISCH: die Codeberechnung stimmt mit dem Standard RFC 6238 ueberein',
  zfCode === 0 && zfBeanstandet.length === 0);
if (zfBeanstandet.length) { zfBeanstandet.forEach(z => bad.push('PHP-Zweifaktor: ' + z.trim())); }

// Der Skizzenmodus steht ZWEIMAL im Repository: skizze.js ist die lesbare
// Quelle, dieselbe Datei liegt aber inline in dashboard.html, weil der
// Deploy-Workflow nur namentlich gelistete Dateien kopiert. Zusammengehalten
// werden beide von skizze-einbetten.py -- also von der Erinnerung, es
// auszufuehren. Laufen sie auseinander, arbeitet man an der einen Fassung
// und ausgeliefert wird die andere; auffallen wuerde das erst im Betrieb.
{
  const js = readFileSync(`${WURZEL}/skizze.js`, 'utf8').replace(/\n+$/, '');
  const html = readFileSync(`${WURZEL}/dashboard.html`, 'utf8');
  const S = '<!-- skizze:start -->', E = '<!-- skizze:ende -->';
  const hatMarker = html.includes(S) && html.includes(E);
  check('Der eingebettete Skizzenmodus ist als solcher markiert', hatMarker);
  if (hatMarker) {
    const block = html.slice(html.indexOf(S), html.indexOf(E));
    const drin = block.slice(block.indexOf('<script>') + '<script>\n'.length,
                             block.lastIndexOf('</script>')).replace(/\n+$/, '');
    check('KRITISCH: skizze.js und die eingebettete Fassung sind gleich '
        + '(sonst "python3 skizze-einbetten.py" ausfuehren)', drin === js);
    if (drin !== js) {
      bad.push(`skizze.js ${js.length} Zeichen gegen eingebettet ${drin.length} Zeichen`);
    }
  }
}

// Rollen und Logbuch (ENT-077). Beide laufen gegen eine echte Datenbank
// (SQLite im Arbeitsspeicher), nicht gegen einen nachgebauten Ablauf -- die
// Browser-Suiten taeuschen die Serverantwort vor und kaemen an einer
// Rechteregel nie vorbei.
for (const [datei, titel] of [
  ['pruef_rechte.php',  'KRITISCH: die Rollen geben genau die entschiedenen Rechte'],
  ['pruef_lohn.php', 'KRITISCH: Lohnform, Mindestlohn, Ferienentschaedigung und PaKo-Beitrag stimmen mit dem GAV ueberein (ENT-451)'],
  ['pruef_lohnlauf.php', 'KRITISCH: der Lohnlauf zaehlt nur abgeglichene Schichten, sperrt Reinigung und rechnet nichts auf fehlender Grundlage (ENT-451)'],
  ['pruef_logbuch.php', 'KRITISCH: das Logbuch haelt fest, wer was geaendert hat'],
  ['pruef_einsatz_abgeschlossen.php', 'KRITISCH: "abgeschlossen" verlangt ALLE zugesagten Rapporte (ENT-128)'],
  ['pruef_rundgang.php', 'KRITISCH: Geofence-Pruefung und Restliste der Kontrollpunkte stimmen (ENT-132/ENT-145/ENT-180)'],
  ['pruef_ereignisse.php', 'KRITISCH: die Ereignis-Arten und ihre Abhakbarkeit stimmen (ENT-090/ENT-197)'],
  ['pruef_revierdienst_berechtigung.php', 'KRITISCH: die Weichen von ohneRevierdienstBerechtigung() stimmen (ENT-284)'],
  ['pruef_aufgaben.php', 'KRITISCH: eine fremde oder entfernte Aufgabe laesst sich nicht an einen Kontrollpunkt haengen (ENT-302)'],
  ['pruef_mitteilungen.php', 'KRITISCH: Sichtbarkeit und Lesestand der Mitteilungen stimmen -- SQL und PHP sagen dasselbe (ENT-421)'],
  ['pruef_push.php', 'KRITISCH: die VAPID-Signatur haelt der Gegenpruefung stand und ein toter Endpunkt wird abgemeldet (ENT-424)'],
  ['pruef_mitteilung_loeschen.php', 'KRITISCH: eine laufende Mitteilung laesst sich auch am Browser vorbei nicht loeschen (ENT-433)'],
  ['pruef_mitteilung_antwort.php', 'KRITISCH: auf einen fremden oder nicht sichtbaren Termin laesst sich nicht zusagen (ENT-436)'],
  ['pruef_mitteilung_liste.php', 'KRITISCH: die Antwortliste eines Termins nennt ALLE Empfaenger, auch die ohne Antwort (ENT-436)'],
  ['pruef_kundenportal.php', 'KRITISCH: Sitzungsablauf, Einmal-Code und E-Mail-Abgleich des Kundenportals stimmen (ENT-441)'],
  ['pruef_wachbuch.php', 'KRITISCH: das Wachbuch fuehrt vier Quellen richtig zusammen, sortiert und kappt sie (ENT-480)'],
  ['pruef_ereignis_foto_frist.php', 'KRITISCH: die Aufbewahrungsfrist fuer Ereignisfotos greift wirklich -- Bild weg, Meldung bleibt, Vermerk steht (ENT-545)'],
  ['pruef_zustellnachweis.php', 'KRITISCH: der Zustellnachweis fuehrt EINE Zeile je Rapport, kein Bewegungsprofil (ENT-491)'],
  ['pruef_portal_verlauf.php', 'KRITISCH: die Verlaufskurve buendelt nach Tagen/Wochen und laesst keine Luecke weg (ENT-500)'],
  ['pruef_sicherheit.php', 'KRITISCH: die Sicherheitsregeln aus ENT-501 werden WIRKLICH ausgefuehrt -- Basisadresse, Link-Schema, Push-Dienst, Sitzungs-Abdruck, Blindpruefung, Bildtyp'],
  ['pruef_ki.php', 'KRITISCH: die KI-Erkennung sagt, WARUM sie nicht ging -- kein Schluessel, abgelehnt, Guthaben und Stoerung sind verschiedene Aussagen (ENT-530)'],
]) {
  let aus = '', code = 0;
  try {
    aus = execFileSync('php', [`${HIER}/` + datei],
      { encoding: 'utf8' });
  } catch (e) {
    aus = String(e.stdout || '') + String(e.stderr || '');
    code = e.status || 1;
  }
  const beanstandet = aus.split('\n').filter(z => z.trim().startsWith('- '));
  check(titel, code === 0 && beanstandet.length === 0);
  beanstandet.forEach(z => bad.push(datei + ': ' + z.trim()));
}

// Die Rechtepruefung darf es nur an EINER Stelle geben. Ein Endpunkt, der
// selbst entscheidet, ist eine zweite Wahrheit -- und Rechte mit zwei
// Wahrheiten sind keine Rechte.
const rechteQuelle = ohneKommentar('../rechte.php');
check('KRITISCH: darf() ist die einzige Stelle, die ein Recht gewaehrt',
  (rechteQuelle.match(/function darf\s*\(/g) || []).length === 1);
check('KRITISCH: require_recht antwortet 403 und nicht 401',
  /json_response\([^)]*\][\s\S]{0,20}403\)/.test(rechteQuelle) || /403\);/.test(rechteQuelle));

// Jeder Endpunkt, der eine Rechtefunktion benutzt, muss rechte.php auch
// einbinden. Ohne das laeuft es zufaellig trotzdem -- weil db.php die Datei
// beim Pruefen der Sitzung mitlaedt. Verschiebt jemand diese Zeile, faellt
// der Endpunkt mit einem Serverfehler aus. Genau diese Luecke gab es in
// zwei Dateien, gefunden nicht von der Pruefung, sondern beim Durchsehen.
const apiDateien = execFileSync('sh', ['-c',
  `ls ${WURZEL}/backend/api/*.php`], { encoding: 'utf8' })
  .trim().split('\n').map(p => p.split('/').pop());
const ohneEinbindung = apiDateien.filter(f => {
  const q = ohneKommentar(f);
  return /\b(darf|require_recht|darf_verwaltung|require_verwaltung|rechte_rollen|rechte_setzen)\w*\s*\(/.test(q)
      && !/rechte\.php/.test(q);
});
check('KRITISCH: jeder Endpunkt mit Rechtepruefung bindet rechte.php ein',
  ohneEinbindung.length === 0);
if (ohneEinbindung.length) { bad.push('ohne rechte.php: ' + ohneEinbindung.join(', ')); }

// Jeder KI-Endpunkt muss den GRUND weitergeben, nicht einen Satz fuer alles
// (ENT-530). Vier Endpunkte antworteten bis dahin auf jeden Fehlschlag mit
// "Erkennung nicht verfuegbar" -- kein Schluessel, abgelehnter Schluessel,
// leeres Guthaben und Stoerung sahen identisch aus, und damit liess sich
// nicht einmal feststellen, ob ueberhaupt ein Schluessel hinterlegt ist.
//
// Geprueft wird nicht, wie ein Satz lautet (das steht in pruef_ki.php),
// sondern dass die Weiche ueberhaupt benutzt wird: Auf JEDEN "=== null"-Zweig
// eines KI-Endpunkts folgt ki_fehler_melden(). Ein neuer fuenfter Endpunkt,
// der den Grund verschluckt, faellt hier auf.
{
  const kiDateien = apiDateien.filter(f => f.startsWith('ki_'));
  check('Es gibt ueberhaupt KI-Endpunkte zu pruefen', kiDateien.length > 0);
  for (const f of kiDateien) {
    const q = ohneKommentar(f);
    const zweige = (q.match(/===\s*null\s*\)\s*\{/g) || []).length;
    const gemeldet = (q.match(/===\s*null\s*\)\s*\{\s*ki_fehler_melden\s*\(/g) || []).length;
    check(`KRITISCH: ${f} nennt bei jedem Fehlschlag den Grund (ki_fehler_melden)`,
      zweige > 0 && zweige === gemeldet);
  }
}

// Eine abgeglichene Schicht ist festgeschrieben (ENT-045). Wer den Plan
// danach aendert, verschiebt rueckwirkend die Grundlage einer Feststellung,
// die jemand geprueft und bestaetigt hat. Die Sperre liegt im Server, nicht
// in der Oberflaeche -- eine Sperre, die man am Browser vorbei umgehen kann,
// ist keine.
//
// Diese Pruefung gibt es, weil genau diese Luecke aufgetreten ist: Der neue
// Endpunkt einsatz_position.php liess Positionen einer festgeschriebenen
// Schicht umbauen, weil er die Pruefung nicht mitgebracht hat. Ein neuer
// Schreibweg an denselben Tabellen faellt sonst niemandem auf -- er
// funktioniert ja.
{
  const SCHREIBT = /(UPDATE|DELETE FROM|INSERT INTO)\s+(einsaetze|einsatz_zuteilung|einsatz_position)\b/;
  // Namentliche Ausnahmen mit Grund -- kein Suchmuster, das zufaellig passt.
  const OHNE_SPERRE = {
    'einsatz_abgleich.php':   'setzt die Sperre selbst -- muss schreiben duerfen',
    'schichten_erzeugen.php': 'legt nur neue Schichten an; eine neue kann nicht abgeglichen sein',
    // KEINE Ausnahme mehr (Security-Audit 2026-09-15): Die alte Begruendung
    // ("legt nur einen neuen Einsatz samt eigener Zuteilung an") deckte den
    // Seitenffekt aus ENT-347 nicht ab -- die Datei aendert zusaetzlich eine
    // BESTEHENDE, fremde einsatz_zuteilung-Zeile (Kollisions-Absage) und
    // braucht darum dieselbe Sperrpruefung wie jeder andere Schreibweg.
    'meine_zusage.php':       'aendert nur die eigene Zu-/Absage, nicht den Plan',
    // Setzt nur einen Zeitstempel "gesehen" auf der Zuteilung. Der Plan, die
    // Zeiten und der Abgleich bleiben unberuehrt -- eine gelesene Meldung
    // aendert nichts an dem, was festgeschrieben wurde.
    'ereignis_erledigt.php': 'markiert nur als gesehen; aendert weder Plan noch Ist-Zeiten',
    // Setzt nur einen Lesevermerk der eingeteilten Person (ENT-113). Eine
    // festgeschriebene Schicht darf angesehen werden -- der Vermerk beruehrt
    // weder den Plan noch die Ist-Zeiten, auf denen die Feststellung beruht.
    'meine_gesehen.php': 'haelt nur fest, dass die eigene Schicht angesehen wurde',
  };
  const luecken = apiDateien.filter(f => {
    const q = ohneKommentar(f);
    if (!SCHREIBT.test(q)) { return false; }
    if (OHNE_SPERRE[f]) { return false; }
    return !/einsatz_sperre_pruefen|einsatz_abgeglichen/.test(q);
  });
  check('KRITISCH: jeder Schreibweg an einer Schicht achtet auf die Festschreibung (ENT-045)',
    luecken.length === 0);
  if (luecken.length) { bad.push('ohne Sperrpruefung: ' + luecken.join(', ')); }

  const toteAusnahmen = Object.keys(OHNE_SPERRE).filter(f => !apiDateien.includes(f));
  check('Die Ausnahmeliste der Sperre nennt nur Endpunkte, die es gibt', toteAusnahmen.length === 0);
  if (toteAusnahmen.length) { bad.push('Ausnahme ohne Datei: ' + toteAusnahmen.join(', ')); }
}

// System-Lohnarten sind die Bemessungsgrundlage der GAV-Berechnung
// (lohnlauf_grundlagen() prueft ihre *_pflichtig-Kennzeichen live bei jedem
// Lohnlauf). lohnarten.php schuetzt sie beim Loeschen explizit -- diese
// Pruefung gibt es, weil derselbe Schutz beim AENDERN fehlte (Security-Audit
// 2026-09-14): jeder mit lohn_schreiben konnte z.B. ahv_pflichtig einer
// Systemlohnart auf 0 setzen. Geprueft wird die Unterscheidung selbst, nicht
// ihr Wortlaut: der Aenderungs-Zweig muss 'system' abfragen UND zwei
// getrennte UPDATE-Anweisungen enthalten (eingeschraenkt fuer System-,
// vollstaendig fuer Nicht-System-Lohnarten) -- eine Ruecknahme auf eine
// einzige, unbedingte UPDATE-Anweisung macht die Pruefung rot.
{
  const quelle = ohneKommentar('lohnarten.php');
  const start = quelle.indexOf('if ($id > 0)');
  // Grenze ist der INSERT-Zweig (Neuanlage), nicht das naechste "} else {" --
  // der Aenderungs-Zweig darf selbst verschachtelte if/else enthalten
  // (System- vs. Nicht-System-Lohnart), ohne die Pruefung zu verkuerzen.
  const ende = quelle.indexOf('INSERT INTO lohnart', start);
  const aenderungsZweig = start === -1 ? '' : quelle.slice(start, ende === -1 ? undefined : ende);
  const prueftSystem = /system/i.test(aenderungsZweig);
  const getrennteUpdates = (aenderungsZweig.match(/UPDATE lohnart SET/g) || []).length >= 2;
  check('KRITISCH: das Aendern einer System-Lohnart schuetzt die Berechnungs-Kennzeichen wie das Loeschen',
    prueftSystem && getrennteUpdates);
  if (!(prueftSystem && getrennteUpdates)) { bad.push('lohnarten.php: Systemschutz beim Aendern fehlt oder unvollstaendig'); }
}

// ── Nachtrag Security-Audit 2026-09-14 -- sechs weitere Funde ──────────────

// einsatz_abgleich.php: die Zeit-Validierung muss den Wertebereich pruefen,
// nicht nur die Ziffernanzahl -- "25:99" floss frueher unbemerkt in die
// GAV-Zeitrechnung ein. Das tatsaechliche Muster wird aus der Datei
// extrahiert und in JS gegen echte Gut-/Schlechtwerte geprueft, statt nur
// nachzusehen, ob irgendein Muster da ist.
{
  const quelle = readFileSync(`${WURZEL}/backend/api/einsatz_abgleich.php`, 'utf8');
  const treffer = quelle.match(/return preg_match\('\/(\^.*?\$)\/'/);
  const muster = treffer ? new RegExp(treffer[1]) : null;
  const gueltig = !!muster && muster.test('23:59') && muster.test('00:00');
  const ungueltig = !!muster && !muster.test('25:99') && !muster.test('24:00') && !muster.test('12:60');
  check('KRITISCH: die Zeit-Validierung im Abgleich akzeptiert nur gueltige Uhrzeiten (00-23:00-59)',
    gueltig && ungueltig);
  if (!(gueltig && ungueltig)) { bad.push('einsatz_abgleich.php: Zeit-Regex akzeptiert ungueltige Uhrzeiten'); }
}

// abwesenheit_saldo.php: altersjahr ist aus dem vertraulichen Feld
// geburtsdatum abgeleitet und darf nicht an blosses personal_lesen
// durchgereicht werden (nur eigene Person oder personal_vertraulich_lesen).
{
  const quelle = ohneKommentar('abwesenheit_saldo.php');
  const geschuetzt = /personal_vertraulich_lesen/.test(quelle) && /altersjahr/.test(quelle);
  check('KRITISCH: abwesenheit_saldo.php schuetzt das abgeleitete Lebensalter wie ein vertrauliches Feld',
    geschuetzt);
  if (!geschuetzt) { bad.push('abwesenheit_saldo.php: altersjahr ohne personal_vertraulich-Schutz'); }
}

// KI-Endpunkte: Namen gehen an einen externen Anbieter -- dieselbe
// Rechtestufe wie der direkte Weg (mitarbeiter_list.php verlangt
// personal_lesen). Namentliche Liste, kein Muster: ein vierter KI-Endpunkt
// soll auffallen, nicht stillschweigend durchrutschen.
{
  const KI_MIT_NAMENSLISTE = ['ki_router_parse.php', 'ki_einsatz_bild.php', 'ki_planung_parse.php'];
  const ohnePersonalLesen = KI_MIT_NAMENSLISTE.filter(f =>
    !/darf\(\$user,\s*'personal_lesen'\)/.test(ohneKommentar(f)));
  check('KRITISCH: jeder KI-Endpunkt mit Mitarbeiter-Namensliste prueft personal_lesen',
    ohnePersonalLesen.length === 0);
  if (ohnePersonalLesen.length) { bad.push('KI-Endpunkt ohne personal_lesen: ' + ohnePersonalLesen.join(', ')); }
}

// lohnarten.php: die Spalte 'bemessung' entscheidet, OB eine Lohnart
// ueberhaupt einen Betrag traegt -- ohne sie in INSERT und UPDATE waere jede
// neu angelegte Lohnart wirkungslos, ohne dass das sichtbar waere.
{
  const quelle = ohneKommentar('lohnarten.php');
  const insertZweig = quelle.slice(quelle.indexOf('INSERT INTO lohnart'));
  const start = quelle.indexOf('if ($id > 0)');
  const updateZweig = quelle.slice(start, quelle.indexOf('INSERT INTO lohnart', start));
  // Das SQL-Zuweisungsmuster, nicht das blosse Wort -- sonst haette schon
  // die PHP-Variable $bemessung im array_merge() die Pruefung gruen gehalten,
  // ohne dass die Spalte tatsaechlich in der SQL-Anweisung steht.
  const inInsert = /,\s*bemessung\s*,/.test(insertZweig.replace(/\s+/g, ' '));
  const inUpdate = /bemessung\s*=\s*\?/.test(updateZweig);
  check('KRITISCH: lohnarten.php setzt die Spalte bemessung beim Anlegen und Aendern',
    inInsert && inUpdate);
  if (!(inInsert && inUpdate)) { bad.push('lohnarten.php: bemessung fehlt in INSERT und/oder UPDATE'); }
}

// betreiber.php: be_tabellen_anlegen() darf den rohen PDO-Fehlertext nicht
// an den Client durchreichen (kann Host/Benutzer der DB-Verbindung
// enthalten) -- wie an den beiden anderen Fehlerstellen derselben Datei.
{
  const quelle = readFileSync(`${WURZEL}/backend/betreiber.php`, 'utf8');
  const start = quelle.indexOf('function be_tabellen_anlegen');
  const ende = quelle.indexOf('\nfunction ', start + 1);
  const funktion = quelle.slice(start, ende === -1 ? undefined : ende);
  const ohneLeck = !/\$e->getMessage\(\)/.test(funktion);
  check('KRITISCH: be_tabellen_anlegen() gibt den rohen Treiberfehler nicht an den Client zurueck',
    ohneLeck);
  if (!ohneLeck) { bad.push('betreiber.php: be_tabellen_anlegen() reicht $e->getMessage() durch'); }
}

// Gleicher Fund, gleiche Datei-uebergreifende Regel: planung_einrichten.php
// hat denselben Tabellen-Anlegen-Mechanismus wie be_tabellen_anlegen() oben
// und hatte denselben Treiberfehler-Leak (Security-Audit 2026-09-14).
{
  const quelle = readFileSync(`${WURZEL}/backend/api/planung_einrichten.php`, 'utf8');
  const start = quelle.indexOf('foreach ($tabellen as $name => $sql)');
  const ende = quelle.indexOf('\n}', start);
  const block = quelle.slice(start, ende === -1 ? undefined : ende);
  const ohneLeck = !/\$e->getMessage\(\)/.test(block);
  check('KRITISCH: planung_einrichten.php gibt den rohen Treiberfehler beim Tabellenanlegen nicht an den Client zurueck',
    ohneLeck);
  if (!ohneLeck) { bad.push('planung_einrichten.php: Tabellen-Schleife reicht $e->getMessage() durch'); }
}

// portal.html: bk.logo (data:-URI aus dem Backend) muss wie jede andere
// Interpolation ueber esc() laufen, unabhaengig davon, dass die serverseitige
// MIME-Pruefung aktuell schon schuetzt (Verteidigung in der Tiefe).
{
  const quelle = readFileSync(`${WURZEL}/portal.html`, 'utf8');
  const ungeschuetzt = quelle.includes("+ bk.logo +");
  check('KRITISCH: portal.html escaped bk.logo vor der Interpolation',
    !ungeschuetzt);
  if (ungeschuetzt) { bad.push('portal.html: bk.logo ohne esc()'); }
}

// Oeffentliche Beleg-Endpunkte (ENT-192): auch ohne Anmeldung eine Bremse
// gegen wiederholte Anfragen, wie jeder andere anmeldungsfreie Endpunkt im
// Haus (Login, Passwort-Reset, Portal-Link). Geprueft werden die
// tatsaechlichen Bausteine der Bremse (Zaehlung UND Sperr-Entscheidung),
// nicht nur ob irgendein Wort dazu im Code steht.
{
  const BELEG_OEFFENTLICH = ['beleg_oeffentlich.php', 'beleg_entscheidung.php'];
  const ohneBremse = BELEG_OEFFENTLICH.filter(f => {
    const q = ohneKommentar(f);
    return !(/anmeld_zaehlen\s*\(/.test(q) && /anmeld_sperre\s*\(/.test(q));
  });
  check('KRITISCH: die oeffentlichen Beleg-Endpunkte haben eine Bremse gegen wiederholte Anfragen',
    ohneBremse.length === 0);
  if (ohneBremse.length) { bad.push('Beleg-Endpunkt ohne Bremse: ' + ohneBremse.join(', ')); }
}

// KI-Endpunkte: Kostenbremse gegen unbegrenzte Anfragen an einen externen,
// kostenpflichtigen Anbieter. Namentliche Liste wie beim personal_lesen-Fund
// oben -- ein fuenfter KI-Endpunkt soll auffallen.
{
  const KI_ENDPUNKTE = ['ki_router_parse.php', 'ki_einsatz_bild.php',
    'ki_planung_parse.php', 'ki_kunden_recherche.php'];
  const ohneBremse = KI_ENDPUNKTE.filter(f => !/ki_aufruf_pruefen\s*\(/.test(ohneKommentar(f)));
  check('KRITISCH: jeder KI-Endpunkt hat eine Kostenbremse (ki_aufruf_pruefen)',
    ohneBremse.length === 0);
  if (ohneBremse.length) { bad.push('KI-Endpunkt ohne Kostenbremse: ' + ohneBremse.join(', ')); }
}

// Laengenbegrenzung auf KI-Freitext-Eingaben (verstaerkt sonst die
// Kostenbremse oben: eine einzelne Anfrage koennte sonst beliebig teuer
// gemacht werden).
{
  const KI_MIT_FREITEXT = ['ki_router_parse.php', 'ki_kunden_recherche.php', 'ki_planung_parse.php'];
  const ohneLimit = KI_MIT_FREITEXT.filter(f => !/mb_strlen\s*\(\s*\$text\s*\)/.test(ohneKommentar(f)));
  check('KRITISCH: jeder KI-Endpunkt mit Freitext begrenzt dessen Laenge',
    ohneLimit.length === 0);
  if (ohneLimit.length) { bad.push('KI-Endpunkt ohne Laengenbegrenzung: ' + ohneLimit.join(', ')); }
}

// lohn_abzuege.php/lohn_person.php: DELETE und (bei lohn_abzuege.php) UPDATE
// muessen den Aenderungsschutz aufrufen (echtes Verhalten gegen SQLite in
// pruef_lohnlauf.php geprueft, hier nur die Verdrahtung). Ohne diese Prueung
// koennte ein kuenftiger Umbau den Aufruf entfernen, ohne dass es auffaellt.
{
  const abzuege = ohneKommentar('lohn_abzuege.php');
  const abzuegeVerdrahtet = /lohn_abzug_gesperrt\s*\(/.test(abzuege)
    && (abzuege.match(/lohn_abzug_gesperrt\s*\(/g) || []).length >= 2;
  check('KRITISCH: lohn_abzuege.php prueft den Aenderungsschutz bei Loeschen UND Aendern',
    abzuegeVerdrahtet);
  if (!abzuegeVerdrahtet) { bad.push('lohn_abzuege.php: lohn_abzug_gesperrt() fehlt oder nur einmal verdrahtet'); }

  const person = ohneKommentar('lohn_person.php');
  const personVerdrahtet = /lohn_person_regel_gesperrt\s*\(/.test(person);
  check('KRITISCH: lohn_person.php prueft den Aenderungsschutz beim Loeschen',
    personVerdrahtet);
  if (!personVerdrahtet) { bad.push('lohn_person.php: lohn_person_regel_gesperrt() fehlt'); }
}

// betrieb.php: jeder der vier Schreibzweige (Logo setzen, Logo entfernen,
// Hauptdomizil, Textfelder/QR-Daten) muss das Logbuch aufrufen -- vorher war
// keine einzige Aenderung an Betriebsstammdaten (u.a. die QR-Rechnungs-IBAN)
// nachvollziehbar (Security-Audit 2026-09-15). Das eigentliche Verhalten von
// logbuch_schreiben()/logbuch_vergleichen() laeuft echt gegen SQLite in
// pruef_logbuch.php -- hier nur, dass betrieb.php sie tatsaechlich an allen
// vier Stellen aufruft.
{
  const q = ohneKommentar('betrieb.php');
  const treffer = (q.match(/logbuch_(schreiben|vergleichen)\s*\(/g) || []).length;
  check('KRITISCH: betrieb.php protokolliert an allen vier Schreibzweigen (Logo x2, Domizil, Textfelder/QR)',
    treffer >= 4);
  if (treffer < 4) { bad.push(`betrieb.php: nur ${treffer} von 4 erwarteten Logbuch-Aufrufen gefunden`); }
}

// lohn_person.php: jeder Schreibzweig (Anlegen/Aendern von Ansatz, Abzug,
// Zahlungsweg inkl. IBAN, sowie Loeschen) muss ebenfalls das Logbuch
// aufrufen -- derselbe Befund wie bei betrieb.php, hier mit direktem Bezug
// zu echten Loehnen (Security-Audit 2026-09-15).
{
  const q = ohneKommentar('lohn_person.php');
  const treffer = (q.match(/logbuch_(schreiben|vergleichen)\s*\(/g) || []).length;
  check('KRITISCH: lohn_person.php protokolliert Aenderungen an Ansatz/Abzug/Zahlungsweg',
    treffer >= 1);
  if (treffer < 1) { bad.push('lohn_person.php: kein Logbuch-Aufruf gefunden'); }
}

// mein_profil_speichern.php: eine Aenderung von email_privat (die Adresse
// fuer die Passwort-Wiederherstellung) muss andere Sitzungen beenden, wie
// bei mein_passwort.php (Security-Audit 2026-09-15) -- vorher blieben
// fremde Sitzungen nach einer solchen Aenderung unangetastet stehen.
{
  const q = ohneKommentar('mein_profil_speichern.php');
  check('KRITISCH: mein_profil_speichern.php beendet andere Sitzungen nach email_privat-Aenderung',
    /if \(\$mailNeu\) \{\s*\n\s*\$token = \$_SERVER\['HTTP_X_AUTH_TOKEN'\] \?\? '';\s*\n\s*db\(\)->prepare\('DELETE FROM sessions WHERE mitarbeiter_id = \? AND token <> \?'\)/.test(q));
}

// Abmelden in app.html/dashboard.html/index.html: der Server-Aufruf muss
// AWAITED werden, bevor die Seite neu laedt (Security-Audit 2026-09-15) --
// sonst kann der Browser den fetch beim Reload abbrechen, bevor logout.php
// die Server-Sitzung wirklich loescht (dasselbe Muster wie bereits korrekt
// in portal.html/betreiber.html).
{
  const dateien = [
    ['app.html', 'abmelden', 'api'],
    ['dashboard.html', 'doLogout', 'api'],
    ['index.html', 'doLogout', 'apiCall'],
  ];
  for (const [datei, fn, aufruf] of dateien) {
    const inhalt = readFileSync(`${WURZEL}/${datei}`, 'utf8');
    const m = inhalt.match(new RegExp(`async function ${fn}\\(\\) \\{([\\s\\S]*?)\\n\\}`));
    check(`KRITISCH: ${datei}::${fn}() ist async`, m !== null);
    if (m) {
      check(`KRITISCH: ${datei}::${fn}() awaitet den Logout-Aufruf, bevor localStorage geleert wird`,
        new RegExp(`await ${aufruf}\\('logout\\.php'`).test(m[1]));
    } else {
      bad.push(`${datei}: ${fn}() nicht als async function gefunden (Umbau?)`);
    }
  }
}

// Drei Endpunkte lieferten Personen-/Kundendaten aus einer FREMDEN Domaene
// heraus, ohne das dafuer eigentlich zustaendige Recht zu pruefen
// (Security-Audit 2026-09-15) -- dasselbe Muster dreimal: dashboard_stats.php
// (Stunden je Person + Sitzungsliste ohne personal_lesen), rollen_list.php
// (Waffentrage-/Diensthundefuehrer-Merkmale ohne personal_lesen),
// rundgang_detail.php (Kunden-E-Mail ohne kunden_lesen).
{
  const dash = ohneKommentar('dashboard_stats.php');
  check('KRITISCH: dashboard_stats.php prueft personal_lesen, bevor es Stunden-/Sitzungsdaten je Person ausliefert',
    /\$darfPersonal = darf\(\$user, .personal_lesen.\);[\s\S]{0,800}'angemeldet'\s*=>\s*\$darfPersonal \? \$angemeldet : null/.test(dash));

  const rollen = ohneKommentar('rollen_list.php');
  check('KRITISCH: rollen_list.php prueft personal_lesen, bevor es Waffentrage-/Diensthundefuehrer-Merkmale ausliefert',
    /\$darfPersonal = darf\(\$user, .personal_lesen.\);/.test(rollen)
    && /if \(!\$darfPersonal\) \{\s*\n\s*unset\(\$p\['diensthundefuehrer'\]/.test(rollen));

  const detail = ohneKommentar('rundgang_detail.php');
  check('KRITISCH: rundgang_detail.php prueft kunden_lesen, bevor es die Kunden-E-Mail ausliefert',
    /if \(!darf\(\$user, .kunden_lesen.\)\) \{\s*\n\s*unset\(\$rundgang\['kunde_email'\]\);/.test(detail));
}

// objekte_revierdienst.php gibt der Waechter-Rolle (nur 'kontrollpunkte_lesen')
// einen Objekt-Waehler -- der braucht laut dashboard.html (rdObjektFuellen())
// ausschliesslich id und name. Bis zur Behebung lieferte derselbe Endpunkt
// zusaetzlich Kundenname, Objektadresse, Kanton, Bemerkung, Auslastung und
// Anfahrtsdistanzen fuer JEDES Objekt der Firma, nicht nur die eigenen
// (Security-Audit Lauf 2, ENT-577/ENT-578). Geprueft wird die SELECT-Liste,
// nicht nur ein spaeteres unset(): Was nie abgefragt wird, kann nicht
// versehentlich wieder mitgegeben werden.
{
  const revierdienst = ohneKommentar('objekte_revierdienst.php');
  check('KRITISCH: objekte_revierdienst.php fragt keine Kunden- oder Adressfelder mehr ab',
    !/kunde_name|kunde_id|\bstrasse\b|\bplz\b|\bort\b|\bkanton\b|bemerkung|masterschichten|objekt_distanz/.test(revierdienst));
  check('objekte_revierdienst.php liefert weiterhin id, name, einsatzart und aktiv',
    /SELECT\s+id,\s*name,\s*einsatzart,\s*aktiv\s+FROM\s+objekte/.test(revierdienst));
}

// dashboard.html: die Frontend-Seite der beiden Personal-Felder oben muss
// "kein Zugriff" (null) von "keine Daten" ([]) unterscheiden -- sonst waere
// der Backend-Fix wirkungslos, weil `stats.angemeldet || []` beides gleich
// behandelt (CLAUDE.md: "unbekannt darf nie wie keine aussehen").
{
  const dh = readFileSync(`${WURZEL}/dashboard.html`, 'utf8');
  check('KRITISCH: renderAngemeldet() unterscheidet "kein Zugriff" von "niemand angemeldet"',
    /function renderAngemeldet\(\) \{\s*\n[\s\S]{0,200}if \(stats\.angemeldet === null\)/.test(dh));
  check('KRITISCH: renderProMa() unterscheidet "kein Zugriff" von "keine Mitarbeitenden"',
    /function renderProMa\(\) \{\s*\n[\s\S]{0,200}if \(stats\.pro_mitarbeiter === null\)/.test(dh));
}

// ki_einsatz_bild.php: das hochgeladene Bild muss am tatsaechlichen Inhalt
// geprueft werden, nicht nur an der Client-Angabe des mimeType -- sonst
// liesse sich jede Byte-Folge unter falschem Typ-Label an die externe
// Anthropic-API senden (Security-Audit 2026-09-15).
{
  const q = ohneKommentar('ki_einsatz_bild.php');
  check('KRITISCH: ki_einsatz_bild.php prueft die echten Magic Bytes des Bildinhalts',
    /function ki_bild_mime_am_inhalt\s*\(/.test(q));
  check('KRITISCH: bei Abweichung von der Client-Angabe wird abgelehnt, nicht stillschweigend weitergereicht',
    /\$bildEcht = ki_bild_mime_am_inhalt\s*\(\s*\$bildRoh\s*\);\s*\n\s*if\s*\(\s*\$bildEcht === null \|\| \$bildEcht !== \$mimeType\s*\)/.test(q));
}

// rapport_create.php: die Kunden-Unterschrift muss am tatsaechlichen Inhalt
// (PNG-Magic-Bytes) geprueft werden, nicht nur am Text-Praefix der
// Data-URI (Security-Audit 2026-09-15) -- dasselbe Prinzip wie bei jedem
// anderen Bild-Upload im Haus.
{
  const q = ohneKommentar('rapport_create.php');
  const m = q.match(/if\s*\(\$sig !== null\)\s*\{([\s\S]*?)\n\}/);
  check('KRITISCH: der Unterschrift-Validierungsblock existiert wie erwartet', m !== null);
  if (m) {
    const block = m[1];
    check('KRITISCH: die Unterschrift wird base64-dekodiert (nicht nur als Text geprueft)',
      /\$sigRoh = base64_decode\s*\(/.test(block));
    check('KRITISCH: die dekodierten Bytes werden gegen die echten PNG-Magic-Bytes geprueft',
      /str_starts_with\s*\(\s*\$sigRoh\s*,\s*"\\x89PNG/.test(block));
  } else {
    bad.push('rapport_create.php: Unterschrift-Validierungsblock nicht gefunden (Umbau?)');
  }
}

// rapport_delete.php: DELETE FROM rapporte muss selbst gegen eine bereits
// abgeglichene Schicht gesperrt sein (ENT-045-Geist, Security-Audit
// 2026-09-15) -- die vorhandene Sperrpruefung schuetzte bisher nur die
// nachgelagerte Statusruecknahme auf einsaetze, nicht das Loeschen des
// Belegs selbst. Geprueft wird die REIHENFOLGE: die Pruefung muss VOR dem
// DELETE stehen, sonst waere sie wirkungslos (genau dieser Fehler wurde
// gefunden).
{
  const q = ohneKommentar('rapport_delete.php');
  const posPruefung = q.search(/if\s*\(\$einsatzId > 0 && einsatz_abgeglichen\(/);
  const posDelete = q.indexOf("DELETE FROM rapporte WHERE id = ?");
  check('KRITISCH: rapport_delete.php prueft die Festschreibung VOR dem Loeschen des Belegs',
    posPruefung !== -1 && posDelete !== -1 && posPruefung < posDelete);
  if (posPruefung === -1 || posDelete === -1 || posPruefung >= posDelete) {
    bad.push('rapport_delete.php: Sperrpruefung fehlt oder steht nach dem DELETE');
  }
}

// mein_rundgang_scan.php: die Aufgaben-Antwort-Abfrage MUSS an das Objekt
// des eigenen, aktiven Rundgangs gebunden sein -- sonst liesse sich ueber
// eine fremde kontrollpunkt_id/aufgabe_id-Kombination der Klartextname eines
// fremden Objekts in den eigenen Ereignis-Feed einschleusen (IDOR,
// Security-Audit 2026-09-15). Der Scan-Zweig hatte diese Bindung bereits;
// hier wird geprueft, dass der Aufgaben-Zweig sie ebenfalls hat -- nicht nur
// irgendwo im Wort "objekt_id" im Datei, sondern in genau dieser Abfrage.
{
  const q = ohneKommentar('mein_rundgang_scan.php');
  const m = q.match(/\$kat = \$pdo->prepare\(([\s\S]*?)\);\s*\n\s*\$kat->execute\(\[([\s\S]*?)\]\);/);
  check('KRITISCH: die Aufgaben-Antwort-Abfrage (kontrollpunkt_aufgabe) existiert wie erwartet',
    m !== null);
  if (m) {
    const [, sql, params] = m;
    check('KRITISCH: die Aufgaben-Antwort-Abfrage bindet den Kontrollpunkt an das eigene Rundgang-Objekt (k.objekt_id = ?)',
      /k\.objekt_id\s*=\s*\?/.test(sql));
    check('KRITISCH: dieser Objektwert wird auch tatsaechlich an die Abfrage uebergeben',
      /\$rundgang\[.objekt_id.\]/.test(params));
  } else {
    bad.push('mein_rundgang_scan.php: Aufgaben-Antwort-Abfrage nicht gefunden (Umbau?)');
  }
  // Kleinerer Fund derselben Pruefung: der Kontrollpunkt-Lookup beim Scan
  // selbst filtert nicht aktiv=1, obwohl die Anzeige-Liste
  // (rundgang_kontrollpunkte_uebrig()) das bereits tut.
  check('Der Kontrollpunkt-Lookup beim Scan filtert aktiv=1 wie die Anzeige-Liste',
    /SELECT \* FROM kontrollpunkt WHERE id = \? AND objekt_id = \? AND aktiv = 1/.test(q));
}

// "Abgeschlossen" (ENT-128): der eigentliche Rechenkern
// (einsatz_vollstaendig_rapportiert) laeuft echt gegen SQLite in
// pruef_einsatz_abgeschlossen.php -- hier nur, dass rapport_create.php und
// rapport_delete.php ihn ueberhaupt aufrufen. Ohne diese Quelltext-Pruefung
// wuerde kein Test bemerken, wenn die Verdrahtung verschwindet: Die
// Playwright-Suiten taeuschen die Serverantwort vor und fuehren die
// eigentliche PHP-Datei nie aus.
{
  const create = ohneKommentar('rapport_create.php');
  const del = ohneKommentar('rapport_delete.php');
  check('KRITISCH: rapport_create.php prueft auf Vollstaendigkeit, bevor es den Status setzt',
    /einsatz_vollstaendig_rapportiert\(db\(\), \$einsatzId\)/.test(create)
    && /UPDATE einsaetze SET status = 'abgeschlossen'/.test(create));
  check('KRITISCH: die Festschreibung (ENT-045) schuetzt auch diesen neuen Schreibweg',
    /!einsatz_abgeglichen\(db\(\), \$einsatzId\)/.test(create)
    && /!einsatz_abgeglichen\(db\(\), \$einsatzId\)/.test(del));
  check('Ein abgesagter Einsatz wird nie auf abgeschlossen ueberschrieben',
    /status != 'abgesagt'/.test(create));
  check('KRITISCH: rapport_delete.php macht "abgeschlossen" rueckgaengig, wenn es wieder unvollstaendig wird',
    /!einsatz_vollstaendig_rapportiert\(db\(\), \$einsatzId\)/.test(del)
    && /UPDATE einsaetze SET status = 'bestaetigt' WHERE id = \? AND status = 'abgeschlossen'/.test(del));
}

// einsatz_save.php muss 'abgeschlossen' beim Speichern anderer Felder
// akzeptieren (Bemerkung, Zeitverschiebung schicken status: e.status mit) --
// sonst waere ein Speichern an einem abgeschlossenen Einsatz ein Fehler.
check('KRITISCH: einsatz_save.php lehnt einen bereits abgeschlossenen Einsatz beim Speichern nicht ab',
  /in_array\(\$status, \[[^\]]*'abgeschlossen'[^\]]*\], true\)/.test(ohneKommentar('einsatz_save.php')));

// Monatsansicht in der App (ENT-134): ohne von/bis-Parameter fehlten bereits
// vergangene Schichten des laufenden Monats, sobald sie mehr als einen Tag
// zurueckliegen -- der Standardzeitraum muss beim Monatsanfang beginnen, mit
// dem Vortag als zusaetzlicher unterer Schranke (Nachtschicht ueber den
// Monatswechsel).
check('KRITISCH: meine_schichten.php laedt ohne Parameter ab Monatsanfang, nicht erst ab gestern',
  /\$von = min\(\$monatsanfang, \$vortag\)/.test(ohneKommentar('meine_schichten.php'))
  && /\$monatsanfang = date\('Y-m-01'\)/.test(ohneKommentar('meine_schichten.php')));

// Backfill fuer laengst vollstaendig rapportierte Einsaetze (ENT-128): der
// Uebergang wird sonst nur im Moment eines NEUEN Rapports ausgeloest -- ohne
// diesen Nachtrag bliebe jeder Einsatz, dessen Rapport(e) schon vor diesem
// Deploy bestanden, fuer immer auf dem alten Status stehen.
{
  const einrichten = execFileSync('cat', [`${WURZEL}/backend/api/planung_einrichten.php`], { encoding: 'utf8' });
  check('KRITISCH: die Einrichtung traegt "abgeschlossen" nach fuer Einsaetze, die es laengst waeren',
    /einsatz_vollstaendig_rapportiert\(\$pdo, \(int\)\$eid\)/.test(einrichten)
    && /!einsatz_abgeglichen\(\$pdo, \(int\)\$eid\)/.test(einrichten)
    && /UPDATE einsaetze SET status = 'abgeschlossen' WHERE id = \?/.test(einrichten));
  check('Ausgenommen sind abgesagte und bereits abgeschlossene Einsaetze -- keine unnoetige Arbeit',
    /status NOT IN \('abgesagt', 'abgeschlossen'\)/.test(einrichten));
}


// Keine Bibliothek darf zweimal geladen werden.
//
// Vorgefallen am 22.08.2026: planung_einrichten.php band mitarbeiter.php ein
// (das seinerseits kunden.php laedt) und danach kunden.php noch einmal mit
// require statt require_once. PHP bricht dann beim zweiten Anlegen derselben
// Funktion HART ab -- am Ausnahmehandler vorbei, ohne lesbare Antwort. Der
// Endpunkt war vollstaendig tot, und die Oberflaeche konnte nur "fehlgeschlagen"
// sagen. Der Einrichtungsweg lag damit lahm, ohne dass es jemandem auffiel.
//
// Geprueft wird der tatsaechliche Ladeweg, nicht die Schreibweise: require ist
// an sich in Ordnung, solange dieselbe Datei nicht auf zwei Wegen ankommt.
{
  const pfad = (von, ziel) => resolve(dirname(von), ziel.replace(/^\/+/, ''));
  const liest = f => { try { return readFileSync(f, 'utf8'); } catch { return ''; } };
  // Deklariert die Datei Funktionen ungeschuetzt? Nur dann ist ein zweites
  // Laden toedlich -- db.php etwa kapselt seine Funktionen in function_exists.
  const gefaehrlich = f => {
    const q = liest(f);
    return !/function_exists/.test(q) && /^\s*function\s+\w+\s*\(/m.test(q);
  };
  const bindungen = f => [...liest(f).matchAll(
    /^\s*(require|include)(_once)?\s*\(?\s*__DIR__\s*\.\s*['"]([^'"]+)['"]/gm)]
    .map(m => ({ ziel: pfad(f, m[3]), once: !!m[2] }));

  const doppelt = [];
  for (const datei of apiDateien) {
    const start = `${WURZEL}/backend/api/${datei}`;
    const zaehler = new Map();
    const geh = f => {
      for (const { ziel, once } of bindungen(f)) {
        const z = zaehler.get(ziel) || { plain: 0, once: 0 };
        z[once ? 'once' : 'plain']++;
        zaehler.set(ziel, z);
        if (z.plain + z.once === 1) { geh(ziel); }
      }
    };
    geh(start);
    for (const [ziel, z] of zaehler) {
      if (z.plain >= 1 && z.plain + z.once > 1 && gefaehrlich(ziel)) {
        doppelt.push(`${datei} laedt ${ziel.split('/').pop()} zweimal`);
      }
    }
  }
  check('KRITISCH: kein Endpunkt laedt dieselbe Bibliothek zweimal (harter Abbruch)',
    doppelt.length === 0);
  doppelt.forEach(d => bad.push(d));
}

// Und umgekehrt: kein Endpunkt darf noch selbst auf ist_admin pruefen.
// Eine zweite Pruefstelle waere eine zweite Wahrheit.
const eigeneTuer = apiDateien.filter(f =>
  /if\s*\(\s*!?\s*\$user\['ist_admin'\]\s*\)/.test(ohneKommentar(f)));
check('KRITISCH: kein Endpunkt entscheidet mehr selbst ueber ist_admin',
  eigeneTuer.length === 0);
if (eigeneTuer.length) { bad.push('eigene Tuer: ' + eigeneTuer.join(', ')); }

// Jeder Endpunkt braucht ueberhaupt eine Pruefung. Ein neuer Endpunkt ohne
// eine faellt sonst niemandem auf -- er funktioniert ja.
//
// Die Ausnahmen stehen NAMENTLICH hier, nicht als Suchmuster. Ein Muster
// wie "kommt $user['id'] vor" wuerde bei jedem neuen Endpunkt zufaellig
// passen oder nicht; eine Liste zwingt dazu, die Ausnahme bewusst
// einzutragen. Alle unten genannten arbeiten ausschliesslich mit den Daten
// der anfragenden Person selbst.
const NUR_EIGENE_DATEN = [
  'me.php',                    // wer bin ich, was darf ich
  'mein_passwort.php',         // eigenes Passwort aendern
  'mein_profil.php',           // eigene Stammdaten ansehen
  'mein_profil_speichern.php',  // eigene Kontaktangaben selbst pflegen (ENT-460)
  'meine_schichten.php',       // eigene Einsaetze
  'meine_verfuegbarkeit.php',  // eigene Sperrtage
  'meine_zusage.php',          // eigene Zu-/Absage
  'meine_gesehen.php',         // eigene Schicht als angesehen vermerken
  'rapport_create.php',        // eigenen Rapport erfassen
  'rapport_list.php',          // eigene Rapporte -- mehr nur mit Recht "abgleich"
  'kunden_list.php',           // Kundenliste fuer die App; Zusatzangaben nur mit Recht
  'layout_get.php',            // eigene Fensteranordnung
  'layout_save.php',
  'zweifaktor_status.php',     // eigene Zwei-Faktor-Anmeldung
  'zweifaktor_aus.php',
  'zweifaktor_geraet_weg.php',
  'mein_rundgang_starten.php', // eigenen Rundgang fuer eigenen Einsatz starten (ENT-180)
  'mein_rundgang_scan.php',    // Kontrollpunkt-Scans am eigenen, laufenden Rundgang (ENT-180)
  // Positionen zur EIGENEN, laufenden Runde (ENT-318). Der Endpunkt
  // schreibt ausschliesslich zu einem Rundgang, dessen mitarbeiter_id
  // aus der Sitzung stammt, und weist alles ab, was nicht laeuft --
  // strenger als ein Recht es waere. LESEN darf die Spur dagegen nur,
  // wer 'rundgang_einsehen' hat: rundgang_spur.php prueft das und steht
  // darum bewusst NICHT in dieser Liste.
  'mein_rundgang_position.php',
  'mein_rundgang_offen.php',   // eigenen offenen Rundgang zu einem Einsatz abfragen (Wiedereinstieg)
  'mein_rundgang_pausieren.php',  // eigenen Rundgang pausieren (ENT-146)
  'mein_rundgang_fortsetzen.php', // eigenen pausierten Rundgang fortsetzen (ENT-146)
  'mein_rundgang_abbrechen.php',  // eigenen Rundgang endgueltig abbrechen (ENT-146)
  'mein_rundgang_vorlagen.php',   // aktive Kontrollrunden des eigenen Einsatz-Objekts (ENT-204)
  'mein_rundgang_vorlagen_alle.php', // objektuebergreifende Liste, aber serverseitig auf eigene Zuteilungshistorie gegatet (ENT-279-Fortsetzung)
  'mein_rundgang_spontan_starten.php', // legt Einsatz+Zuteilung nur fuer die eigene Person an (ENT-279-Fortsetzung)
  'mein_rundgang_uebersicht.php', // rein lesende Vorschau einer Kontrollrunde vor dem Start; dasselbe Gate wie mein_rundgang_vorlagen_alle.php -- nur wer ueberhaupt Revierdienst macht (ENT-294)
  'mein_ereignis_melden.php',    // meldet Vorfaelle als die eigene Person, mit demselben Revierdienst-Gate (ENT-295)
  'ereignisart_liste.php',       // reiner Stammdaten-Katalog fuer die Auswahl beim Melden, keine personenbezogenen Daten (ENT-295)
  // Fahrzeugübernahme (ENT-340). Beide Endpunkte arbeiten ausschliesslich
  // mit der eigenen Person: Die mitarbeiter_id stammt aus der Sitzung, nie
  // aus der Anfrage. Ein Recht waere hier falsch -- JEDE eingeteilte Person
  // nimmt Fahrzeuge, nicht nur die Verwaltung. Herausgegeben wird nur, was
  // fuer die Uebernahme noetig ist; die qr_kennung verlaesst den Server nie.
  // Der Verlauf LESEN darf dagegen nur, wer 'betrieb' hat --
  // fahrzeug_logbuch.php prueft das und steht darum bewusst NICHT hier.
  'meine_fahrzeuge.php',
  'meine_fahrzeug_uebernahme.php',
  'meine_abwesenheit.php',        // eigene Abwesenheitsantraege (ENT-255)
  'abwesenheit_saldo.php',        // eigener Ferien-Saldo -- mehr nur mit Recht "personal_lesen" (ENT-255)
  // Mitteilungen aus Sicht der empfangenden Person (ENT-421). Kein Recht,
  // sondern strikt eigene Daten: JEDE angemeldete Person bekommt
  // Mitteilungen -- das ist der Sinn der Sache. Die mitarbeiter_id stammt
  // ausnahmslos aus der Sitzung, und was jemand sehen darf, entscheidet
  // mitteilung_sql_sichtbar() serverseitig; auch das Setzen von "gelesen"
  // prueft vorher, ob die Mitteilung fuer diese Person ueberhaupt sichtbar
  // ist. Das VERWALTEN (anlegen, alle sehen, zurueckziehen) haengt dagegen
  // am Recht 'mitteilungen' -- mitteilung_list/save/archivieren.php stehen
  // darum bewusst NICHT hier.
  'meine_mitteilungen.php',
  // Auf einen Termin zu- oder absagen (ENT-436). Ebenfalls kein Recht: Wer
  // einen Termin sieht, darf antworten. Vor dem Vermerken wird geprueft,
  // ob der Termin fuer DIESE Person sichtbar ist und ob es ueberhaupt ein
  // Termin ist; die Person selbst kommt aus der Sitzung. Wer die Antworten
  // ANDERER sehen will, braucht das Recht 'mitteilungen'
  // (mitteilung_list.php) -- der Endpunkt hier gibt keine fremde Antwort
  // heraus.
  'mitteilung_antwort.php',
  // Benachrichtigungen ein- und ausschalten (ENT-424). Kein Recht: JEDE
  // angemeldete Person darf ihre eigenen Geraete anmelden. Die
  // mitarbeiter_id stammt ausnahmslos aus der Sitzung, und auch das
  // Abmelden sucht das Abo nur innerhalb der eigenen Person -- mit einem
  // fremden Endpunkt laesst sich niemandem die Benachrichtigung
  // abstellen. Der VERSAND (push_versand.php) haengt dagegen am Recht
  // 'mitteilungen' oder am Zeitgeber-Schluessel und steht darum bewusst
  // NICHT hier.
  'push_einrichtung.php',
];
const ohnePruefung = apiDateien.filter(f => {
  const q = ohneKommentar(f);
  if (!/require_session\s*\(/.test(q)) { return false; }   // login.php u.ae.
  if (NUR_EIGENE_DATEN.includes(f)) { return false; }
  // require_recht_nach_methode() (ENT-440) prueft je HTTP-Methode die
  // Lese- oder die Schreibstufe -- es ist dieselbe Pruefstelle, nur mit
  // der Stufe aus der Methode. Ohne den Namenszusatz hier haetten die
  // vier Endpunkte, die lesen UND schreiben, als ungeprueft gegolten.
  return !/(require_recht\w*|require_verwaltung)\s*\(/.test(q);
});
check('KRITISCH: jeder Endpunkt prueft Rechte oder steht als Ausnahme benannt da',
  ohnePruefung.length === 0);
if (ohnePruefung.length) { bad.push('ohne Rechtepruefung: ' + ohnePruefung.join(', ')); }

// Die Ausnahmeliste selbst darf nicht veralten: Ein dort genannter
// Endpunkt, den es nicht mehr gibt, verdeckt sonst still einen neuen
// gleichen Namens.
const totEintraege = NUR_EIGENE_DATEN.filter(f => !apiDateien.includes(f));
check('Die Ausnahmeliste nennt nur Endpunkte, die es gibt', totEintraege.length === 0);
if (totEintraege.length) { bad.push('Ausnahme ohne Datei: ' + totEintraege.join(', ')); }

// ── Endpunkte ganz OHNE Anmeldung (ENT-501) ───────────────────────────
//
// DIE LUECKE, die diese Liste schliesst: Die Rechtepruefung oben steigt in
// ihrer ersten Zeile aus, sobald eine Datei kein require_session() enthaelt
// ("login.php u.ae."). Das ist fuer den Anmelde-Endpunkt richtig -- es hiess
// aber auch, dass ein NEUER Endpunkt, der require_session() schlicht
// VERGISST, nirgends auffaellt: Er wird uebersprungen, nicht gemeldet, und
// steht in keiner Ausnahmeliste. Genau die Sorte Fehler, vor der CLAUDE.md
// warnt -- etwas Neues, das die Regel nicht erbt.
//
// Darum eine zweite Liste, und sie ist absichtlich vollstaendig: JEDER
// Endpunkt, der weder eine Verwaltungs- noch eine Kundensitzung verlangt,
// steht hier namentlich mit dem Grund. Kommt ein elfter dazu, wird die
// Pruefung rot.
const OHNE_ANMELDUNG = [
  // Der Eingang selbst -- er kann keine Sitzung verlangen, die er erst
  // erzeugt. Eigene Pruefungen: Bremse, zweiter Faktor, Notfallcodes.
  'login.php',
  // Loeschen der eigenen Sitzung. Wirkt nur mit dem Token, den man ohnehin
  // schon hat, und kann nichts ausser dem eigenen Eintrag treffen.
  'logout.php',
  // Ruecksetzung per Mail (ENT-373). Verwaltungskonten sind ausdruecklich
  // ausgenommen, die Antwort ist immer gleichlautend, eigene Bremse unter
  // dem Namensraum "reset:". Eigene Pruefung: pruef_passwort_reset.php.
  'passwort_vergessen.php',
  'passwort_zuruecksetzen.php',
  // Formular der oeffentlichen Homepage (ENT-469). Empfaenger fest aus den
  // Betriebsstammdaten, Honigtopf-Feld, eigene Bremse. Eigene Pruefung:
  // pruef_demo_anfrage.php.
  'demo_senden.php',
  // Der Eingang der Betreiber-Ebene (ENT-524). Kann keine Sitzung
  // verlangen, die er erst erzeugt -- dieselbe Begruendung wie login.php.
  // Erbt Bremse (eigener Namensraum "betreiber:"), Blindpruefung gegen
  // Zeitmessung und die gleichlautende Antwort fuer "gibt es nicht" und
  // "Passwort falsch". Eigene Pruefung: test_betreiber.mjs.
  'betreiber_anmelden.php',
  // Die drei Eingaenge des Kundenportals -- stehen zusaetzlich in
  // PORTAL_EINGAENGE weiter unten, weil dort die Portal-Regel greift.
  'portal_anmelden.php',
  'portal_link_anfordern.php',
  'portal_neues_passwort.php',
  // Beleg-Ansicht und Kundenentscheid am oeffentlichen Link (ENT-192/205).
  // Der Ausweis ist ein versand_token mit 256 Bit -- ein Kunde hat kein
  // Konto. Bis ENT-501 standen diese beiden nirgends benannt.
  'beleg_oeffentlich.php',
  'beleg_entscheidung.php',
  // Naechtlicher Demo-Reset (ENT-523 Punkt 3), ausgeloest ueber einen
  // GitHub-Actions-Zeitgeber ohne jede Sitzung -- gleiches Prinzip wie
  // push_versand.php (dort STEHT require_session() aber im Quelltext, als
  // Rueckfall fuer den angemeldeten Weg, und faellt darum selbst nicht
  // unter diese Liste). Eigene Bremse: demo_reset_zeitgeber_lage()
  // vergleicht zeitsicher (hash_equals) gegen ein beim Deploy gesetztes
  // Geheimnis, zusaetzlich abgeriegelt durch require_demo_umgebung() --
  // ausserhalb der Demo existiert der Endpunkt aus Sicht eines Aufrufers
  // nicht (404).
  'demo_reset_ausfuehren.php',
];
// Drei Anmeldewege, drei Pruefstellen: die Verwaltung (require_session),
// das Kundenportal (require_kundensession, ENT-441) und die Betreiber-Ebene
// (require_betreiber, ENT-519). Wer einen davon ruft, ist angemeldet -- wer
// keinen ruft, steht unten namentlich mit Grund.
const ohneAnmeldung = apiDateien.filter(f =>
  !/require_session\s*\(|require_kundensession\s*\(|require_betreiber(?:_voll)?\s*\(/.test(ohneKommentar(f)));
const unbenannt = ohneAnmeldung.filter(f => !OHNE_ANMELDUNG.includes(f));
check('KRITISCH: jeder Endpunkt ganz ohne Anmeldung steht namentlich da',
  unbenannt.length === 0);
if (unbenannt.length) { bad.push('ohne Anmeldung und unbenannt: ' + unbenannt.join(', ')); }

// Die Kehrseite, und sie ist der wichtigere Teil: Bekommt einer dieser
// Endpunkte spaeter eine Sitzungspruefung, muss er hier VERSCHWINDEN. Sonst
// deckt ein veralteter Eintrag den naechsten Endpunkt gleichen Namens zu --
// dieselbe Ueberlegung wie bei totEintraege oben.
const toteOhneAnmeldung = OHNE_ANMELDUNG.filter(f => !ohneAnmeldung.includes(f));
check('Die Liste "ohne Anmeldung" nennt nur Endpunkte, die es auch wirklich sind',
  toteOhneAnmeldung.length === 0);
if (toteOhneAnmeldung.length) {
  bad.push('steht als "ohne Anmeldung", prueft aber doch: ' + toteOhneAnmeldung.join(', '));
}

// Zwei weitere Regeln aus ENT-501 -- "die eigene Adresse kommt nie aus der
// Anfrage" und "eine Sitzung wird nur ueber ihren Abdruck angesprochen" --
// stehen BEWUSST NICHT hier, sondern in pruef_sicherheit.php.
//
// Grund, und er ist beim Schreiben dieser Pruefung aufgefallen: Der
// Kommentarfilter oben (ohneKommentar) ist ein Muster, kein Zerteiler. Er
// haelt die beiden Schraegstriche in der Zeichenkette 'https://' fuer einen
// Kommentarbeginn und loescht den Rest der Zeile -- ausgerechnet die Zeile,
// in der ein wieder eingebautes HTTP_HOST staende. Die Gegenprobe blieb
// dadurch gruen. Fuer diese beiden Regeln zerteilt darum PHP selbst
// (token_get_all), genau wie es pruef_sql.php aus demselben Grund tut.

// ── Kundenportal (ENT-441) ────────────────────────────────────────────
// Die Endpunkte des Portals gehen einen ANDEREN Weg als alle uebrigen: Sie
// pruefen kein Recht aus rechte.php, weil ein Kundenzugang keine Rechte hat
// -- er hat genau eine Eigenschaft, die kunde_id. Damit fallen sie aus der
// Pruefung oben heraus (die greift nur bei require_session), und ohne die
// folgenden Regeln waeren sie der eine Ort im Haus, an dem gar nichts
// geprueft wird. Genau der Fall, vor dem CLAUDE.md warnt: etwas Neues, das
// die Regel nicht geerbt hat.
const portalDateien = apiDateien.filter(f => f.startsWith('portal_'));
check('Es gibt ueberhaupt Portal-Endpunkte zu pruefen', portalDateien.length > 0);

// Die beiden Eingaenge. Wer dort ankommt, ist noch niemand -- sie koennen
// keine Sitzung verlangen, die erst bei ihnen entsteht. Namentlich benannt
// und nicht ueber ein Muster erkannt: Ein dritter Eingang soll auffallen.
const PORTAL_EINGAENGE = ['portal_link_anfordern.php', 'portal_anmelden.php',
  // Seit ENT-448: Der Link IST der Ausweis. Wer ihn hat, hat Zugriff auf das
  // hinterlegte Postfach -- mehr verlangt auch der Mitarbeiterweg nicht
  // (ENT-373). Eine Kundensitzung kann dieser Endpunkt nicht verlangen, er
  // eroeffnet sie ja erst.
  'portal_neues_passwort.php'];

const ohneKundensitzung = portalDateien.filter(f =>
  !PORTAL_EINGAENGE.includes(f) && !/require_kundensession\s*\(/.test(ohneKommentar(f)));
check('KRITISCH: jeder Portal-Endpunkt ausser den benannten Eingaengen verlangt eine Kundensitzung',
  ohneKundensitzung.length === 0);
if (ohneKundensitzung.length) { bad.push('ohne Kundensitzung: ' + ohneKundensitzung.join(', ')); }

const toteEingaenge = PORTAL_EINGAENGE.filter(f => !apiDateien.includes(f));
check('Die Eingangsliste des Portals nennt nur Endpunkte, die es gibt', toteEingaenge.length === 0);
if (toteEingaenge.length) { bad.push('Portal-Eingang ohne Datei: ' + toteEingaenge.join(', ')); }

// Ein Portal-Endpunkt, der require_session() aufruft, haette den falschen
// Zugang: Das ist die Verwaltungssitzung. Beides in derselben Datei waere
// eine Verwechslung, die niemandem auffiele -- sie funktioniert ja.
const portalMitAdminSitzung = portalDateien.filter(f =>
  /(?<!kunden)require_session\s*\(/.test(ohneKommentar(f)));
check('KRITISCH: kein Portal-Endpunkt benutzt die Verwaltungssitzung',
  portalMitAdminSitzung.length === 0);
if (portalMitAdminSitzung.length) {
  bad.push('Portal mit Verwaltungssitzung: ' + portalMitAdminSitzung.join(', '));
}

// Namen von Mitarbeitenden gehen seit ENT-481 ueber das Portal hinaus -- der
// Projektinhaber hat entschieden, den Rapport „1:1" zu zeigen, weil der Kunde
// ohnehin schon eine physische Kopie davon bekommt. Die fruehere Pruefung
// („kein Portal-Endpunkt liest Namen") ist damit gegenstandslos und wurde
// ENTFERNT statt aufgeweicht -- eine Pruefung, deren Grundlage weggefallen
// ist, taeuscht Schutz vor.
//
// Was an ihre Stelle tritt, gilt weiter und ist die eigentliche Grenze: Die
// VERTRAULICHEN Personalfelder (ma_vertrauliche_felder(), CLAUDE.md) haben in
// keinem Portal-Endpunkt etwas zu suchen. Ein Name auf einem Rapport ist
// etwas anderes als eine AHV-Nummer.
const VERTRAULICH = ['ahv_nr', 'nationalitaet', 'heimatort', 'geburtsort', 'zivilstand',
  'heiratsdatum', 'geburtsdatum', 'geschlecht', 'aufenthaltsbewilligung',
  'aufenthalt_gueltig_bis', 'arbeitsbewilligung', 'arbeit_gueltig_bis', 'zemis_nr',
  'strafregister_datum', 'betreibung_datum', 'dienstausweis_nr', 'dienstausweis_gueltig_bis'];
// Die Liste wird gegen die Quelle geprueft, statt sie zu behaupten: Kommt in
// mitarbeiter.php ein Feld dazu, faellt es hier auf, statt still unbewacht
// zu bleiben.
{
  const quelle = readFileSync(`${WURZEL}/backend/mitarbeiter.php`, 'utf8');
  const block = quelle.slice(quelle.indexOf('function ma_vertrauliche_felder'));
  const echt = [...block.slice(0, block.indexOf('}')).matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
  check('KRITISCH: die Liste der vertraulichen Felder stimmt mit mitarbeiter.php ueberein',
    echt.length > 0 && JSON.stringify([...echt].sort()) === JSON.stringify([...VERTRAULICH].sort()));
}
const portalMitVertraulichem = portalDateien.filter(f => {
  const text = ohneKommentar(f);
  return VERTRAULICH.some(feld => new RegExp('\\b' + feld + '\\b').test(text));
});
check('KRITISCH: kein Portal-Endpunkt liest vertrauliche Personalfelder',
  portalMitVertraulichem.length === 0);
if (portalMitVertraulichem.length) {
  bad.push('Portal mit vertraulichen Feldern: ' + portalMitVertraulichem.join(', '));
}

// Wer aus ma_eingabe_lesen() die volle Mitarbeiter-Feldliste uebernimmt
// (Anlegen UND Aendern), muss vertrauliche Felder herausfiltern, wenn das
// Recht personal_vertraulich_schreiben fehlt -- sonst koennte ein Profil mit
// blossem personal_schreiben sie setzen. Genau diese Sperre fehlte in
// mitarbeiter_create.php (Security-Audit 2026-09-14), waehrend
// mitarbeiter_update.php sie hatte -- ein neuer Schreibweg, der die Regel
// nicht geerbt hatte. Geprueft werden die beiden Bausteine der Sperre
// (Rechtename plus Feldliste), nicht ihr genauer Wortlaut: Eine Umformulierung
// des Kommentars laesst die Pruefung gruen, das Verschwinden von darf(...)
// oder ma_vertrauliche_felder() macht sie rot.
{
  const nutztVolleEingabe = apiDateien.filter(f => /ma_eingabe_lesen\s*\(/.test(ohneKommentar(f)));
  const ohneVertraulichFilter = nutztVolleEingabe.filter(f => {
    const q = ohneKommentar(f);
    return !(/personal_vertraulich_schreiben/.test(q) && /ma_vertrauliche_felder\s*\(/.test(q));
  });
  check('KRITISCH: jeder Endpunkt mit voller Mitarbeiter-Eingabe filtert vertrauliche Felder ohne personal_vertraulich_schreiben',
    ohneVertraulichFilter.length === 0);
  if (ohneVertraulichFilter.length) {
    bad.push('ma_eingabe_lesen ohne Vertraulich-Filter: ' + ohneVertraulichFilter.join(', '));
  }
}

// Wer im Portal ein Passwort SETZT, muss sich ausgewiesen haben (ENT-488).
// Zwei Wege sind erlaubt und nur zwei: das bisherige Passwort vorzeigen, oder
// den zugeschickten Link -- der IST der Ausweis (ENT-448). Ein dritter
// Endpunkt, der password_hash schreibt, ohne eines von beidem zu verlangen,
// waere die Uebernahme eines fremden Zugangs per Anfrage.
//
// Namentlich benannt und nicht ueber ein Muster erkannt: Ein dritter Weg
// soll auffallen, nicht durchrutschen -- dieselbe Bauart wie bei
// ── Zustellnachweis: was das Portal ueber den Kunden festhaelt (ENT-491) ──
//
// Der Datenschutzhinweis im Portal sagt dem Kunden zu: keine IP-Adresse,
// kein Geraet, kein Browser. Eine Zusage, die nur im Text steht, ist eine
// Behauptung -- hier wird sie pruefbar. Geprueft wird die AUSSAGE (es wird
// nicht danach gegriffen), nicht der Wortlaut des Hinweises.
{
  const GREIFT_NACH = /\$_SERVER\s*\[\s*['"](?:REMOTE_ADDR|HTTP_USER_AGENT|HTTP_X_FORWARDED_FOR|HTTP_REFERER)['"]\s*\]/;
  const neugierig = portalDateien.filter(f => GREIFT_NACH.test(ohneKommentar(f)));
  check('KRITISCH: kein Portal-Endpunkt greift nach IP-Adresse, Geraet oder Browser',
    neugierig.length === 0);
  if (neugierig.length) { bad.push('greift nach Geraetedaten: ' + neugierig.join(', ')); }

  // Der Vermerk gehoert HINTER die Zuschnittspruefung. Davor hielte er
  // fest, dass jemand nach einer FREMDEN Nummer gefragt hat -- das ist
  // keine Zustellung, sondern eine Beobachtung, und sie stuende in einer
  // Tabelle, die es dafuer nicht gibt.
  const vermerker = portalDateien.filter(f => /kp_abruf_vermerken\s*\(/.test(ohneKommentar(f)));
  check('Es gibt ueberhaupt Endpunkte, die einen Zustellnachweis schreiben',
    vermerker.length >= 2);
  const zuFrueh = vermerker.filter(f => {
    const t = ohneKommentar(f);
    const vermerk = t.search(/kp_abruf_vermerken\s*\(/);
    // Die letzte Stelle, an der der Endpunkt den Zuschnitt durchsetzt:
    // entweder eine Sichtbarkeitsfrage oder der gemeinsame Abbruch.
    const wachen = [...t.matchAll(/kp_\w*sichtbar\s*\(|nichtAbrufbar\s*\(\s*\)/g)]
      .map(m => m.index);
    return !wachen.length || vermerk < Math.max(...wachen);
  });
  check('KRITISCH: der Zustellnachweis wird erst NACH der Zuschnittspruefung geschrieben',
    zuFrueh.length === 0);
  if (zuFrueh.length) { bad.push('vermerkt zu frueh: ' + zuFrueh.join(', ')); }
}

// PORTAL_EINGAENGE.
{
  const PW_OHNE_ALTES = ['portal_neues_passwort.php'];   // der Link ist der Ausweis
  const setzen = portalDateien.filter(f => /password_hash\s*=\s*\?/.test(ohneKommentar(f)));
  const ohneNachweis = setzen.filter(f => !PW_OHNE_ALTES.includes(f)
    && !/password_verify\s*\(/.test(ohneKommentar(f)));
  check('Es gibt ueberhaupt Portal-Endpunkte zu pruefen, die ein Passwort setzen',
    setzen.length >= 2);
  check('KRITISCH: jeder Portal-Endpunkt, der ein Passwort setzt, verlangt einen Ausweis',
    ohneNachweis.length === 0);
  if (ohneNachweis.length) { bad.push('Passwort ohne Ausweis: ' + ohneNachweis.join(', ')); }
  const totePw = PW_OHNE_ALTES.filter(f => !apiDateien.includes(f));
  check('Die Ausnahmeliste fuer den Linkweg nennt nur Endpunkte, die es gibt', totePw.length === 0);
}

// Der Abbruchgrund verlaesst den Server als KLARTEXT, nicht als Codewort
// (ENT-324, jetzt auch fuers Portal). Zwei Seiten derselben Regel:
//   - Der Endpunkt schlaegt im Katalog nach.
//   - portal.html traegt KEINE eigene Kopie des Katalogs. Eine zweite Kopie
//     liefe beim naechsten Grund auseinander, und der Kunde bekaeme dann ein
//     Codewort zu lesen.
// Nicht nur das Detail: JEDER Portal-Endpunkt, der einen Abbruchgrund
// weitergibt, muss ihn aufloesen. Mit dem Wachbuch (ENT-484) gibt es einen
// zweiten -- und ein dritter soll nicht wieder einzeln nachgetragen werden
// muessen, sondern von selbst auffallen.
{
  const mitGrund = portalDateien.filter(f => /\babbruch_grund\b/.test(ohneKommentar(f)));
  const ohneKatalog = mitGrund.filter(f => !/RUNDGANG_ABBRUCH_GRUENDE\s*\[/.test(ohneKommentar(f)));
  check('Es gibt ueberhaupt Portal-Endpunkte mit Abbruchgrund zu pruefen', mitGrund.length >= 2);
  check('KRITISCH: jeder Portal-Endpunkt loest den Abbruchgrund ueber den Katalog auf',
    ohneKatalog.length === 0);
  if (ohneKatalog.length) { bad.push('Abbruchgrund ohne Katalog: ' + ohneKatalog.join(', ')); }
}
{
  const rd = readFileSync(`${WURZEL}/backend/rundgang.php`, 'utf8');
  const block = rd.slice(rd.indexOf('const RUNDGANG_ABBRUCH_GRUENDE'));
  const codes = [...block.slice(0, block.indexOf('];')).matchAll(/'([a-z_]+)'\s*=>/g)].map(m => m[1]);
  const portalText = readFileSync(`${WURZEL}/portal.html`, 'utf8');
  check('Der Katalog der Abbruchgruende ist ueberhaupt gefunden', codes.length >= 3);
  check('KRITISCH: portal.html traegt keine eigene Kopie des Abbruchgrund-Katalogs',
    !codes.some(c => portalText.includes(c)));
}

// Die Bewegungsspur geht seit ENT-474 zum Kunden -- aber ueber GENAU EINEN
// Endpunkt, der sie erst auf einen Knopfdruck hin liefert.
//
// Bis dahin war sie ausgeschlossen (ENT-441 Punkt 3, ENT-322: sie gibt dem
// Kunden Aufenthaltsdaten des Mitarbeitenden). Der Projektinhaber hat das
// ausdruecklich revidiert. Die Pruefung ist darum nicht entfallen, sondern
// enger geworden: Der eine erlaubte Weg steht NAMENTLICH da, damit ein
// zweiter auffaellt -- dieselbe Bauart wie bei PORTAL_EINGAENGE. Wer die
// Spur an einer weiteren Stelle liest, umgeht damit den Knopf.
const PORTAL_SPUR_ERLAUBT = ['portal_rundgang_weg.php'];
const portalMitSpur = portalDateien.filter(f =>
  !PORTAL_SPUR_ERLAUBT.includes(f) && /\brundgang_position\b/i.test(ohneKommentar(f)));
check('KRITISCH: nur der eine benannte Endpunkt liest die Bewegungsspur (ENT-474)',
  portalMitSpur.length === 0);
if (portalMitSpur.length) { bad.push('Portal mit Bewegungsspur: ' + portalMitSpur.join(', ')); }

const toteSpur = PORTAL_SPUR_ERLAUBT.filter(f => !apiDateien.includes(f));
check('Die Ausnahmeliste fuer die Spur nennt nur Endpunkte, die es gibt', toteSpur.length === 0);
if (toteSpur.length) { bad.push('Spur-Ausnahme ohne Datei: ' + toteSpur.join(', ')); }

/* Jeder Portal-Endpunkt, der den Inhalt EINER Runde nach ihrer Nummer
   herausgibt, fragt dieselbe Sichtbarkeitsregel. Ohne sie kaeme ein Kunde
   durch blosses Hochzaehlen einer Zahl an den Nachweis einer fremden Runde.

   Namentlich und nicht ueber ein Muster -- gleiche Begruendung wie bei
   PORTAL_EINGAENGE: Ein vierter Weg soll auffallen, statt stillschweigend
   durch eine Regel zu rutschen, die ihn zufaellig nicht erfasst. Die
   Listenansichten (portal_rundgaenge, portal_wachbuch) stehen bewusst NICHT
   hier: Sie schneiden ueber kp_objekt_ids() zu und geben nie eine einzelne
   fremde Nummer heraus.

   portal_ereignis_foto.php ist mit ENT-544 dazugekommen. */
const PORTAL_NACH_NUMMER = ['portal_rundgang_detail.php', 'portal_rundgang_foto.php',
  'portal_rundgang_weg.php', 'portal_ereignis_foto.php'];
const ohneSichtbarkeit = PORTAL_NACH_NUMMER.filter(f =>
  !/kp_runde_sichtbar\s*\(/.test(ohneKommentar(f)));
check('KRITISCH: jeder Weg zu EINER Runde fragt dieselbe Sichtbarkeitsregel',
  ohneSichtbarkeit.length === 0);
if (ohneSichtbarkeit.length) { bad.push('ohne kp_runde_sichtbar: ' + ohneSichtbarkeit.join(', ')); }
const toteNachNummer = PORTAL_NACH_NUMMER.filter(f => !apiDateien.includes(f));
check('Die Liste nennt nur Endpunkte, die es gibt', toteNachNummer.length === 0);
if (toteNachNummer.length) { bad.push('Sichtbarkeits-Liste ohne Datei: ' + toteNachNummer.join(', ')); }

// DIE KERNREGEL. Ein Portal-Endpunkt, der eine kunde_id oder zugang_id aus// DIE KERNREGEL. Ein Portal-Endpunkt, der eine kunde_id oder zugang_id aus
// der Anfrage naehme, liesse jeden angemeldeten Kunden die Daten jedes
// anderen lesen -- durch blosses Hochzaehlen einer Zahl. Beide Werte
// stammen ausnahmslos aus require_kundensession(). Dieselbe Regel wie bei
// den Zwei-Faktor-Endpunkten (die Person kommt aus der Sitzung, nie aus der
// Anfrage), hier fuer den Kunden.
const fremdSchluessel = /\$(?:_GET|_POST|_REQUEST|in|input|daten)\s*\[\s*['"](?:kunde_id|zugang_id|kundenzugang_id|mitarbeiter_id)['"]/;
const portalMitFremdId = portalDateien.filter(f => fremdSchluessel.test(ohneKommentar(f)));
check('KRITISCH: kein Portal-Endpunkt nimmt eine Kunden- oder Zugangsnummer aus der Anfrage',
  portalMitFremdId.length === 0);
if (portalMitFremdId.length) { bad.push('Portal liest fremde Kennung: ' + portalMitFremdId.join(', ')); }

// Die Verwaltungsseite der Kundenzugaenge haengt am Recht 'portal' -- nicht
// an 'kunden'. Wer Adressen pflegt, soll keinen Zugang fuer Betriebsfremde
// oeffnen koennen (ENT-441 Punkt 9, gleiche Trennung wie ENT-181).
const zugangDateien = apiDateien.filter(f => f.startsWith('kundenzugang_'));
check('Es gibt Verwaltungsendpunkte fuer Kundenzugaenge', zugangDateien.length > 0);
// Seit ENT-440 tragen Rechte Stufen: <bereich>_lesen und
// <bereich>_schreiben. Geprueft wird der BEREICH -- welche Stufe der
// einzelne Endpunkt verlangt, entscheidet er selbst (list liest, save
// schreibt), aber am Bereich 'portal' muessen beide haengen.
const zugangOhnePortalrecht = zugangDateien.filter(f =>
  !/require_recht\w*\s*\(\s*\$user\s*,\s*'portal(_|'\s*\.\s*STUFE_)/.test(ohneKommentar(f)));
check("KRITISCH: die Kundenzugang-Verwaltung verlangt ein Recht aus dem Bereich 'portal'",
  zugangOhnePortalrecht.length === 0);
// Und die Stufen sind wirklich getrennt: Wuerde die Liste die Schreibstufe
// verlangen, waere die Lesestufe wertlos -- und wuerde das Anlegen mit der
// Lesestufe auskommen, waere sie gefaehrlich.
check("KRITISCH: die Liste verlangt Lesen, das Anlegen und Sperren Schreiben",
  /'portal_'\s*\.\s*STUFE_LESEN/.test(ohneKommentar('kundenzugang_list.php'))
  && /'portal_'\s*\.\s*STUFE_SCHREIBEN/.test(ohneKommentar('kundenzugang_save.php')));
if (zugangOhnePortalrecht.length) {
  bad.push('Kundenzugang ohne Recht portal: ' + zugangOhnePortalrecht.join(', '));
}

// EINE NEUERUNG DARF DAS BESTEHENDE NICHT BRECHEN, BEVOR DIE EINRICHTUNG
// GELAUFEN IST. Zwischen einem Deploy und dem Ausfuehren der Einrichtung
// liegt immer eine Zeitspanne -- und genau in der ist das Portal einmal
// gestanden: Die Passwortspalte aus ENT-444 war im Code vorausgesetzt, aber
// noch nicht in der Datenbank, und jede Anmeldung endete an einem
// SQL-Fehler. Wer eine Spalte liest, die aus einem Nachtrag stammt, muss
// ihr Fehlen darum abfangen -- dasselbe Muster wie db.php seit ENT-075 fuer
// sessions.letzte_nutzung.
//
// Geprueft wird gegen die Nachtragsliste selbst und nicht gegen eine
// zweite, hier gepflegte Aufzaehlung: Eine solche waere beim naechsten
// Nachtrag sofort veraltet.
{
  const einrichtung = readFileSync(`${WURZEL}/backend/api/planung_einrichten.php`, 'utf8');
  const spaltenBlock = (einrichtung.match(/\$spalten = \[[\s\S]*?\n\];/) || [''])[0];
  const nachtraege = [...spaltenBlock.matchAll(/\['kundenzugang',\s*'(\w+)'/g)].map(m => m[1]);
  check('Die Nachtragsliste nennt Spalten der Kundenzugaenge', nachtraege.length > 0);
  const ungeschuetzt = [];
  for (const datei of portalDateien.concat(zugangDateien)) {
    const q = ohneKommentar(datei);
    for (const spalte of nachtraege) {
      // Genannt, aber nicht abgesichert -- weder ueber hat_spalte() noch
      // ueber eine Bedingung, die den Namen ueberhaupt erst einsetzt.
      // Nicht von einer Klammer gefolgt -- sonst trifft der Name auch die
      // gleichnamige PHP-Funktion password_hash(), und die hat mit der
      // Spalte nichts zu tun. Genau daran ist die erste Fassung dieser
      // Pruefung haengengeblieben.
      if (new RegExp('\\b' + spalte + '\\b(?!\\s*\\()').test(q)
          && !new RegExp("hat_spalte\\s*\\([^)]*'" + spalte + "'").test(q)) {
        ungeschuetzt.push(datei + ' → ' + spalte);
      }
    }
  }
  check('KRITISCH: kein Portal-Endpunkt setzt eine nachgetragene Spalte voraus, ohne ihr Fehlen abzufangen',
    ungeschuetzt.length === 0);
  if (ungeschuetzt.length) { bad.push('ungeschuetzte Spalte: ' + ungeschuetzt.join(', ')); }
}


// Das Recht muss im Katalog stehen und darf NUR der Verwaltung gehoeren.
// Stuende es bei 'Planung', koennte jede planende Person einem Dritten
// Zugang verschaffen -- genau das war der Grund, es zu trennen.
// Der Bereich muss im Katalog stehen, mit BEIDEN Stufen: Ein Bereich ohne
// Schreibstufe liesse sich nicht vergeben, einer ohne Lesestufe zwaenge
// jeden Leser zum Schreibrecht.
{
  const portalBlock = (rechteQuelle.match(/'portal' *=> \[[\s\S]*?\],/) || [''])[0];
  check("KRITISCH: der Bereich 'portal' steht im Bereichskatalog", portalBlock !== '');
  check("KRITISCH: und er kennt beide Stufen",
    /STUFE_LESEN/.test(portalBlock) && /STUFE_SCHREIBEN/.test(portalBlock));
}

// Die Anmeldung muss den zweiten Faktor auch VERLANGEN und Fehlversuche
// zaehlen -- sonst laesst sich der sechsstellige Code durchprobieren.
const loginOhneKommentar = ohneKommentar('login.php');
check('KRITISCH: die Anmeldung fragt den zweiten Faktor ab', /zf_ist_an\s*\(/.test(loginOhneKommentar));
check('KRITISCH: ein falscher Code zaehlt als Fehlversuch',
  (loginOhneKommentar.match(/anmeld_fehlversuch/g) || []).length >= 2);
check('KRITISCH: die Fehlversuche werden erst NACH dem zweiten Faktor zurueckgesetzt',
  loginOhneKommentar.indexOf('zf_ist_an') < loginOhneKommentar.indexOf('anmeld_zuruecksetzen'));
check('Ein Notfallcode wird ebenfalls angenommen',
  /zf_notfallcode_einloesen\s*\(/.test(loginOhneKommentar));
check('Ein gemerktes Geraet ersetzt den Code', /zf_geraet_gilt\s*\(/.test(loginOhneKommentar));
check('KRITISCH: ein Geraet wird nur gemerkt, wenn der zweite Faktor ueberhaupt an ist',
  /geraetMerken && zf_ist_an/.test(loginOhneKommentar));

// Alle Zwei-Faktor-Endpunkte muessen die Person aus der SITZUNG nehmen --
// nie aus der Anfrage. Sonst liesse sich ein fremder Zugang umstellen.
const zfEndpunkte = execFileSync('sh', ['-c',
  `ls ${WURZEL}/backend/api/zweifaktor_*.php`], { encoding: 'utf8' })
  .trim().split('\n').map(p => p.split('/').pop());
const ausAnfrage = zfEndpunkte.filter(f => {
  const q = ohneKommentar(f);
  return /mitarbeiter_id.*\$in\[|\$in\['name'\]|\$_GET\['name'\]/.test(q);
});
check('KRITISCH: kein Zwei-Faktor-Endpunkt nimmt die Person aus der Anfrage',
  zfEndpunkte.length >= 5 && ausAnfrage.length === 0);
if (ausAnfrage.length) { bad.push('Person aus der Anfrage: ' + ausAnfrage.join(', ')); }
check('KRITISCH: das Abschalten verlangt das Passwort, nicht nur eine offene Sitzung',
  /password_verify/.test(ohneKommentar('zweifaktor_aus.php')));

// Und die Syntax jeder einzelnen Datei -- billig, aber es faengt Tippfehler
// vor dem Deploy statt danach.
let syntaxFehler = [];
try {
  const dateien = execFileSync('sh', ['-c',
    `ls ${WURZEL}/backend/*.php ${WURZEL}/backend/api/*.php`],
    { encoding: 'utf8' }).trim().split('\n');
  check(`Alle ${dateien.length} PHP-Dateien gefunden`, dateien.length > 50);
  for (const d of dateien) {
    try { execFileSync('php', ['-l', d], { encoding: 'utf8' }); }
    catch (e) { syntaxFehler.push(d.split('/').pop()); }
  }
} catch { syntaxFehler.push('Dateiliste nicht lesbar'); }
check('KRITISCH: keine Syntaxfehler in den PHP-Dateien',
  syntaxFehler.length === 0);

// ── Wird ueberhaupt alles ausgeliefert?
//
// Der Deploy kopiert auf der obersten Backend-Ebene eine AUSDRUECKLICHE
// Liste, kein Wildcard -- nur backend/api/*.php faehrt automatisch mit. Eine
// neue Datei daneben fehlt auf dem Server, und jeder Endpunkt, der sie
// einbindet, antwortet mit einem Fatal Error. Genau das ist mit
// mitarbeiter.php beinahe passiert und mit anderen Dateien schon zweimal
// (ENT-040, ENT-049). Diese Pruefung macht daraus einen roten Test statt
// einer Ueberraschung nach dem Deploy.
let fehltImDeploy = [];
try {
  const yml = execFileSync('cat',
    [`${WURZEL}/.github/workflows/deploy-hostpoint.yml`], { encoding: 'utf8' });
  const oben = execFileSync('sh', ['-c',
    `ls ${WURZEL}/backend/*.php`], { encoding: 'utf8' })
    .trim().split('\n').map(d => d.split('/').pop());
  // setup.php ist die EINZIGE erlaubte Ausnahme und ausdruecklich benannt:
  // Die Ersteinrichtung war ein einmaliger Upload von Hand, die Datei gehoert
  // bewusst nicht auf den Server (README, OP-17). Wer eine weitere Ausnahme
  // braucht, traegt sie hier ein und begruendet sie -- stillschweigend darf
  // keine dazukommen.
  const bewusstDraussen = ['setup.php'];
  fehltImDeploy = oben.filter(d => !bewusstDraussen.includes(d) && !yml.includes(`cp backend/${d} `));
  check('Die Ausnahme setup.php ist weiterhin nicht im Deploy',
    !yml.includes('cp backend/setup.php '));
  check(`Alle ${oben.length} Backend-Dateien der obersten Ebene geprueft`, oben.length >= 4);
} catch { fehltImDeploy = ['Deploy-Datei nicht lesbar']; }
check('KRITISCH: jede Backend-Datei der obersten Ebene wird auch deployt',
  fehltImDeploy.length === 0);
if (fehltImDeploy.length) { console.log('   fehlt im Deploy: ' + fehltImDeploy.join(', ')); }

// ── Spaltennamen in SQL gegen das Schema (ENT-185).
// Wird WIRKLICH ausgefuehrt, wie die uebrigen pruef_*.php. Diese Luecke hat
// beim ersten Lauf sofort einen echten, produktiven Fehler gefunden:
// einsatz_position.php las `SELECT id FROM einsatz_zuteilung`, eine Tabelle
// mit zusammengesetztem Schluessel und ohne id-Spalte -- zur Laufzeit eine
// Ausnahme, die das Oeffnen des Einsatzplans abbrach.
let sqlAus = '', sqlCode = 0;
try {
  sqlAus = execFileSync('php', [`${HIER}/pruef_sql.php`], { encoding: 'utf8' });
} catch (e) {
  sqlAus = String(e.stdout || '') + String(e.stderr || '');
  sqlCode = e.status || 1;
}
const sqlBeanstandet = sqlAus.split('\n').filter(z => z.trim().startsWith('X '));
check('KRITISCH: jeder Spaltenname in SQL steht auch im Schema',
  sqlCode === 0 && sqlBeanstandet.length === 0);
check('Die SQL-Pruefung liest ueberhaupt ein Schema',
  Number((sqlAus.match(/^(\d+) Tabellen im Schema/m) || [0, 0])[1]) >= 15);
// Ist-Stand 312. Die Schwelle liegt bei 280, nicht bei einem bequemen
// Rundwert: Faellt schema.sql als Quelle weg, sinkt die Zahl auf 230
// (nachgemessen) -- das faengt sie. Die 32 Abfragen Spielraum sind Absicht,
// damit ein gewoehnlicher Umbau, der ein paar Abfragen zusammenlegt, nicht
// jedes Mal diese Schwelle nachziehen muss.
check('Sie prueft mindestens 280 Abfragen',
  Number((sqlAus.match(/(\d+) Abfragen geprueft/) || [0, 0])[1]) >= 280);
sqlBeanstandet.forEach(z => bad.push('SQL: ' + z.trim().slice(2)));

if (beanstandet.length) { beanstandet.forEach(z => console.log('   ' + z.trim())); }
if (syntaxFehler.length) { console.log('   Syntax: ' + syntaxFehler.join(', ')); }

// ── Zuteilen holt eine entfallene/abgelehnte Person zurueck (ENT-351) ──
// Der Projektinhaber, an einem konkreten Beispiel nachgefragt: Eine Person
// lehnt eine Schicht ab (oder ist entfallen, ENT-347) -- wie kommt der
// Planer sie im Cockpit zurueck? Gefunden beim Nachlesen: Der bestehende
// Weg (dieselbe Person erneut auf die Position klicken) war WIRKUNGSLOS --
// der INSERT ... ON DUPLICATE KEY UPDATE setzte nur position_id, zusage
// blieb 'entfallen'/'abgelehnt' stehen, und die Kachel zeigte die Person
// weiterhin durchgestrichen, obwohl der Planer sie gerade aktiv zugeteilt
// hatte. Der einzige WIRKENDE Weg war das rote Kreuz ("loesen") -- das aber
// die ganze Zuteilungszeile LOESCHT und damit den Nachweis vernichtet, den
// ENT-347 bewusst erhalten wollte.
{
  const EP = readFileSync(`${WURZEL}/backend/api/einsatz_position.php`, 'utf8');
  const zuteilenBlock = (EP.match(/if \(\$aktion === 'zuteilen'\) \{[\s\S]*?\n\}/) || [''])[0];
  check('KRITISCH: "zuteilen" setzt eine entfallene/abgelehnte Zuteilung auf "offen" zurück',
    /zusage = IF\(zusage IN \('entfallen', 'abgelehnt'\), 'offen', zusage\)/.test(zuteilenBlock));
  // Eine bereits offene oder zugesagte Person darf beim reinen
  // Positionswechsel NICHT zuruecksetzen -- sonst muesste sich jemand, der
  // schon zugesagt hat, neu bestaetigen, nur weil der Planer die Position
  // wechselt. Geprueft am IF-Ausdruck selbst: Nur "entfallen"/"abgelehnt"
  // duerfen als Bedingung stehen, kein drittes Wort daneben.
  const bedingung = (zuteilenBlock.match(/zusage IN \(([^)]*)\)/) || [null, ''])[1];
  check('KRITISCH: die Rücksetzung betrifft NUR diese zwei Zustände -- "offen"/"zugesagt" bleiben beim Positionswechsel unangetastet',
    bedingung.replace(/\s/g, '') === "'entfallen','abgelehnt'");
  // Der Primaerschluessel bleibt unveraendert (einsatz_id, mitarbeiter_id) --
  // sonst waere die ganze Ueberlegung hinfaellig, weil pro Position statt
  // pro Person gezaehlt wuerde.
  check('Der zusammengesetzte Primärschlüssel (einsatz_id, mitarbeiter_id) bleibt dabei unverändert',
    /INSERT INTO einsatz_zuteilung \(einsatz_id, mitarbeiter_id, position_id\)/.test(zuteilenBlock));
}

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
