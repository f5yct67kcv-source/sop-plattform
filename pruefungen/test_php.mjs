// Statische Pruefung der PHP-Endpunkte (ENT-072).
//
// Die uebrigen Suiten fahren die Oberflaeche und bilden die Schnittstelle
// nach -- PHP laeuft dabei nie. Zwei produktive Fehler sind deshalb an
// vierunddreissig gruenen Suiten vorbeigekommen: ein Aufruf einer Funktion,
// die im erreichbaren Code gar nicht existierte, und eine Variable, die in
// ihrer Datei nie gesetzt wird. Beide waeren beim ersten echten Aufruf
// hochgegangen. Diese Suite schliesst genau diese Luecke.
import { WURZEL, HIER, OUT, browserPfad } from './pfade.mjs';
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
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

// Alle DREI Stellen, an denen ein Passwort gesetzt wird, muessen die Regel
// aufrufen -- eine vergessene Stelle waere ein offenes Hintertuerchen.
const pwStellen = ['mitarbeiter_create.php', 'mitarbeiter_reset_password.php', 'mein_passwort.php'];
// Kommentare vorher weg: Ein Hinweis "// passwort_pruefen (ENT-075)" neben
// dem require ist kein Aufruf. Die erste Fassung dieser Pruefung ist genau
// darauf hereingefallen -- sie blieb gruen, als der Aufruf entfernt wurde.
const ohneKommentar = f => execFileSync('cat', [`${WURZEL}/backend/api/` + f],
  { encoding: 'utf8' }).replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const ohneRegel = pwStellen.filter(f => !/passwort_pruefen\s*\(/.test(ohneKommentar(f)));
check('KRITISCH: alle drei Stellen zum Passwortsetzen pruefen die Regel',
  ohneRegel.length === 0);
if (ohneRegel.length) { bad.push('ohne Passwortregel: ' + ohneRegel.join(', ')); }

// Die Regel darf NICHT beim Anmelden greifen -- sonst sperrt der Deploy
// schlagartig jedes bestehende Konto aus.
check('KRITISCH: beim Anmelden wird die Laenge NICHT geprueft',
  !/passwort_pruefen\s*\(/.test(ohneKommentar('login.php')));

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

check('Kein Einbetten in fremde Seiten (Clickjacking)',
  /X-Frame-Options *"DENY"/.test(ht) && /frame-ancestors 'none'/.test(ht));
check('Der Browser raet den Inhaltstyp nicht', /X-Content-Type-Options *"nosniff"/.test(ht));
check('Kein Auflisten von Verzeichnisinhalten', /Options -Indexes/.test(ht));
check('KRITISCH: gegen alte Apache-Fassungen abgesichert -- ein Fehler hier legt die ganze Seite lahm',
  /IfModule mod_authz_core\.c/.test(ht) && /IfModule !mod_authz_core\.c/.test(ht));
check('Kopfzeilen nur, wenn das Modul da ist', /IfModule mod_headers\.c/.test(ht));
check('Das Mikrofon bleibt erlaubt -- das Diktat braucht es',
  /microphone=\(self\)/.test(ht));
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
  ['pruef_logbuch.php', 'KRITISCH: das Logbuch haelt fest, wer was geaendert hat'],
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
];
const ohnePruefung = apiDateien.filter(f => {
  const q = ohneKommentar(f);
  if (!/require_session\s*\(/.test(q)) { return false; }   // login.php u.ae.
  if (NUR_EIGENE_DATEN.includes(f)) { return false; }
  return !/(require_recht|require_verwaltung)\s*\(/.test(q);
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

if (beanstandet.length) { beanstandet.forEach(z => console.log('   ' + z.trim())); }
if (syntaxFehler.length) { console.log('   Syntax: ' + syntaxFehler.join(', ')); }

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
