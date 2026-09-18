// Jede gemeinsam genutzte Skriptdatei muss im Deploy stehen (ENT-110).
//
// Warum diese Suite: gav.js und zeitwahl.js liegen im Wurzelverzeichnis und
// werden von beiden Oberflächen geladen. Der Deploy kopiert nicht das ganze
// Verzeichnis, sondern jede Datei einzeln. Wer eine dritte gemeinsame Datei
// anlegt und die Zeile vergisst, merkt es nicht beim Prüfen -- lokal liegt
// die Datei ja da. Auffallen würde es erst produktiv, und der Push geht
// sofort live.
//
// Der Fallstrick ist bekannt und im Deploy zweimal auskommentiert (ENT-040,
// ENT-049). Ein Kommentar ist aber keine Prüfung.
import { WURZEL } from './pfade.mjs';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { createHash } from 'crypto';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const workflow = readFileSync(`${WURZEL}/.github/workflows/deploy-hostpoint.yml`, 'utf8');
// portal.html gehoert dazu, seit es ein Skript nachlaedt (html2pdf,
// ENT-478). Bis dahin fehlte es hier -- und damit galt fuer diese eine
// Oberflaeche die Regel nicht, dass jedes geladene Skript auch
// ausgeliefert wird. Genau die Luecke, die qrcode.js schon einmal aus dem
// Deploy fallen liess.
// homepage.html steht hier NICHT mehr (ENT-563/OP-565): Sie geht seit
// guardops.ch nicht mehr nach dist/, sondern nach dist-guardops/. Wer sie
// in dieser Liste liesse, verlangte eine cp-Zeile nach dist/, die es
// absichtlich nicht mehr gibt. Ihre Schriften, Icons und Skripte prüft
// stattdessen der guardops-Block ganz unten -- an derselben Frage.
const seiten = ['index.html', 'dashboard.html', 'app.html', 'portal.html'];

// Nicht nur die drei bekannten HTML-Huellen: eine oeffentliche PHP-Seite
// (z. B. beleg_oeffentlich.php, ENT-205) kann ein eigenes <script src>
// einbinden, ohne dass dashboard.html/app.html davon etwas wissen -- genau
// diese Luecke liess qrcode.js beim ersten Mal aus dem Deploy fallen, bis
// test_php.mjs es ueber die separate "jede Backend-Datei"-Pruefung fing.
// Hier wird derselbe Fallstrick fuer STATISCHE Dateien (root-Ebene, per
// <script src> geladen) direkt geschlossen, nicht nur fuer PHP-Dateien.
const phpDateien = readdirSync(`${WURZEL}/backend/api`)
  .filter(f => f.endsWith('.php')).map(f => `backend/api/${f}`);

for (const seite of [...seiten, ...phpDateien]) {
  const html = readFileSync(`${WURZEL}/${seite}`, 'utf8');
  // Nur eigene Dateien, keine fremden Adressen. Zwei Muster: ein literales
  // <script src="…"> UND ein per JS nachgeladenes Skript (s.src = "…js"),
  // wie beleg_oeffentlich.php es fuer html2pdf.bundle.min.js macht (ENT-206)
  // -- ein Skript, das erst bei Klick nachgeladen wird, steht nie als
  // literales <script>-Tag im HTML.
  const skripte = [
    ...[...html.matchAll(/<script\s+src="([^"]+)"/g)].map(m => m[1]),
    ...[...html.matchAll(/\.src\s*=\s*"([^"]+\.js)"/g)].map(m => m[1]),
  ]
    .map(q => q.replace(/^\//, ''))
    .filter((q, i, arr) => arr.indexOf(q) === i)
    .filter(q => !/^https?:\/\//.test(q));
  for (const q of skripte) {
    check(`${seite} lädt ${q} — die Datei gibt es`, existsSync(`${WURZEL}/${q}`));
    check(`KRITISCH: ${q} wird auch deployt (von ${seite} geladen)`,
      new RegExp(`cp\\s+${q.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\s+dist/`).test(workflow));
  }
}

/* Jeder Wert, der beim Deploy eingesetzt wird, muss den Schrittwechsel
   ueberleben (ENT-424).

   Der Fehler, gegen den das steht, ist echt passiert und hat eine
   Dreiviertelstunde gekostet: Die drei Push-Werte wurden im Schritt
   "Umgebung waehlen" gesetzt, aber nicht in $GITHUB_ENV geschrieben. Der
   Schritt "Platzhalter durch echte Werte ersetzen" laeuft in einer EIGENEN
   Shell -- dort war die Variable leer, und sed setzte einen leeren Wert
   ein. Kein Fehler, kein rotes Feld: Der Deploy meldete Erfolg, und auf
   dem Server stand `const VAPID_PRIVAT_B64 = '';`.

   Geprueft wird die Aussage, nicht der Wortlaut: Jede Variable, die in
   einer sed-Ersetzung VERWENDET wird, muss vorher weitergereicht worden
   sein. Wer eine vierte hinzufuegt und die Weitergabe vergisst, faellt
   hier auf -- unabhaengig davon, wie sie heisst. */
{
  // Alle in sed-Ersetzungen verwendeten Variablen einsammeln.
  const benutzt = [...workflow.matchAll(/sed -i "s\|__[A-Z0-9_]+__\|\$([A-Za-z_][A-Za-z0-9_]*)\|g"/g)]
    .map(m => m[1])
    .filter((v, i, a) => a.indexOf(v) === i);
  check('Der Deploy setzt ueberhaupt Werte ein', benutzt.length >= 5);

  // Wird der Wert an die folgenden Schritte weitergereicht? Gesucht wird
  // die Zeile, die ihn in $GITHUB_ENV schreibt. Bewusst ueber den ganzen
  // Workflow und nicht ueber einen herausgeschnittenen Block: Ein
  // Blockmuster haengt daran, wie die Klammern gerade stehen, und wuerde
  // beim naechsten Umbau still leer laufen -- dann waere die Pruefung
  // gruen, ohne etwas zu pruefen. (Genau das ist beim Schreiben dieser
  // Zeilen passiert.)
  const fehlend = benutzt.filter(v => !new RegExp(`echo "${v}=`).test(workflow));
  check('KRITISCH: jeder eingesetzte Wert wird an den naechsten Schritt weitergereicht '
      + '($GITHUB_ENV) -- sonst ersetzt sed still durch nichts',
    fehlend.length === 0);
  if (fehlend.length) { bad.push('nicht weitergereicht: ' + fehlend.join(', ')); }
}

/* Der Google-Maps-Schluessel: WELCHE Oberflaechen ihn tragen, wird nicht
   aufgezaehlt, sondern gefunden. Die Liste war zweimal die Fehlerquelle --
   eine neue Seite laedt die Karte, niemand denkt an die Ersetzungszeile, und
   Google Maps bekommt den woertlichen Platzhalter als Schluessel. Das ist
   kein Absturz: Die Karte bleibt einfach leer. Seit ENT-474 traegt auch
   portal.html den Schluessel. */
{
  const seitenMitKarte = ['dashboard.html', 'app.html', 'portal.html', 'index.html']
    .filter(f => existsSync(`${WURZEL}/${f}`))
    .filter(f => readFileSync(`${WURZEL}/${f}`, 'utf8').includes('__MAPS_JS_KEY__'));
  check('Mindestens eine Oberflaeche traegt den Maps-Platzhalter', seitenMitKarte.length > 0);
  for (const f of seitenMitKarte) {
    check(`KRITISCH: __MAPS_JS_KEY__ wird in ${f} beim Deploy auch ersetzt`,
      new RegExp(`sed -i "s\\|__MAPS_JS_KEY__\\|\\$EFF_MAPS_JS_KEY\\|g" dist/${f.replace('.', '\\.')}`)
        .test(workflow));
  }
}

/* Die Push-Dateien brauchen ihre Platzhalter -- und zwar in der Datei, die
   auch kopiert wird (ENT-424). Ein Platzhalter, den niemand ersetzt, waere
   ein Schluessel, der nie ankommt; eine Ersetzung ohne Platzhalter waere
   eine Zeile, die nichts tut. */
for (const [datei, platzhalter] of [
  ['backend/push.php', ['__VAPID_PRIVATE_PEM_B64__', '__VAPID_KONTAKT__',
    '__APNS_KEY_P8_B64__', '__APNS_KEY_ID__', '__APNS_TEAM_ID__']],
  ['backend/api/push_versand.php', ['__PUSH_CRON_SCHLUESSEL__']],
]) {
  const inhalt = readFileSync(`${WURZEL}/${datei}`, 'utf8');
  for (const ph of platzhalter) {
    check(`${datei} traegt den Platzhalter ${ph}`, inhalt.includes(ph));
    check(`KRITISCH: ${ph} wird beim Deploy auch ersetzt`,
      new RegExp(`sed -i "s\\|${ph}\\|`).test(workflow));
  }
}

/* push.php geht in ZWEI Buendel (dist/ und dist-cupi24/, ENT-604) -- die
   generische Pruefung oben schlaegt schon an, wenn IRGENDEINE der beiden
   Zeilen existiert. Hier zusaetzlich JEDES Ziel einzeln, dieselbe Strenge
   wie bei __MAPS_JS_KEY__ weiter oben. Gegenprobe gemacht: eine der sechs
   Zeilen entfernt, genau diese Aussage wurde rot -- die generische blieb
   gruen. */
for (const ziel of ['dist/push.php', 'dist-cupi24/push.php']) {
  for (const ph of ['__APNS_KEY_P8_B64__', '__APNS_KEY_ID__', '__APNS_TEAM_ID__']) {
    check(`KRITISCH: ${ph} wird auch in ${ziel} ersetzt (nicht nur im jeweils anderen Buendel)`,
      new RegExp(`sed -i "s\\|${ph}\\|\\$EFF_${ph.slice(2, -2)}\\|g" ${ziel.replace('.', '\\.')}`)
        .test(workflow));
  }
}

/* Die eigene Adresse der Anlage (ENT-501).

   Sie steckt in jedem Link, den der Server per E-Mail verschickt -- Passwort
   zuruecksetzen, Portalzugang, Beleg. Bis ENT-501 kam sie aus dem Host-Kopf
   DER ANFRAGE; wer die unangemeldeten Endpunkte mit einem fremden Host-Kopf
   aufrief, liess den Server einen Link auf die eigene Adresse verschicken.

   Zwei Aussagen sind hier zu sichern, und die zweite ist die
   sicherheitsrelevante: */
{
  const dbInhalt = readFileSync(`${WURZEL}/backend/db.php`, 'utf8');
  check('db.php traegt den Platzhalter __APP_BASIS_URL__',
    dbInhalt.includes('__APP_BASIS_URL__'));
  check('KRITISCH: __APP_BASIS_URL__ wird beim Deploy auch ersetzt',
    /sed -i "s\|__APP_BASIS_URL__\|\$EFF_APP_BASIS_URL\|g" dist\/db\.php/.test(workflow));

  // Der Production-Zweig hat einen Rueckfall, damit ein Deploy nicht an
  // einer nicht gesetzten Variablen scheitert und die Links dabei wortlos
  // verschwinden.
  const zweige = workflow.split('UMGEBUNG=staging');
  check('Der Production-Zweig setzt eine Basisadresse',
    /EFF_APP_BASIS_URL=/.test(zweige[0]) && /https:\/\//.test(zweige[0]));

  // KRITISCH und der eigentliche Punkt: Staging darf NICHT auf die
  // produktive Adresse zurueckfallen. Ein Staging-Link, der auf Production
  // zeigt, waere genau der Fehler, den die urspruengliche
  // HTTP_HOST-Loesung vermeiden wollte -- und ein Kunde bekaeme aus einem
  // Test eine Nachricht mit einem Link in die echte Anlage.
  const stagingZweig = (zweige[1] || '').split('fi\n')[0];
  check('KRITISCH: Staging faellt fuer die Basisadresse NICHT auf Production zurueck',
    /EFF_APP_BASIS_URL=""/.test(stagingZweig)
    && /STAGING_DOMAIN/.test(stagingZweig)
    && !/rapport\./.test(stagingZweig));
}

// Dasselbe für Dateien, die das CSS per url(...) holt -- Schriften, Bilder,
// Hintergründe. Bis ENT-223 gab es hier gar keine solche Datei, seither
// liegen zwei Schriftschnitte unter fonts/ (Inter, selbst ausgeliefert statt
// von Google, OP-224). Die Prüfung oben hätte sie NICHT gefangen: Sie kennt
// nur <script src> und .src = "…js".
//
// Der Fallstrick ist hier besonders heimtückisch, weil er nicht kracht: Fehlt
// die Schrift auf dem Server, faellt der Text still auf den System-Stapel
// zurück. Lokal sieht alles richtig aus (die Dateien liegen ja da), und
// produktiv sieht es nur "irgendwie anders" aus, ohne Fehlermeldung.
const alsGlobPassend = (pfad, zeile) => {
  // Der Deploy kopiert teils einzeln (cp gav.js dist/gav.js), teils als
  // Gruppe (cp fonts/*.woff2 dist/fonts/). Beides muss zählen, sonst
  // verlangt die Prüfung eine Schreibweise statt einer Wirkung.
  const muster = zeile.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  return new RegExp(`^${muster}$`).test(pfad);
};
const kopierteQuellen = [...workflow.matchAll(/^\s*cp\s+(\S+)\s+dist\//gm)].map(m => m[1]);

/* Dasselbe fuer Dateien, die per <link> haengen -- Favicon, Apple-Touch-Icon,
   das Bild fuer die Teilen-Vorschau (ENT-562). Dieselbe Luecke wie bei den
   Schriften: Fehlt das Favicon auf dem Server, kracht nichts, der Browser
   zeigt nur sein leeres Blatt -- und lokal faellt es NICHT auf, weil die
   Datei im Arbeitsverzeichnis ja liegt. */
for (const seite of seiten) {
  const html = readFileSync(`${WURZEL}/${seite}`, 'utf8');
  const quellen = [
    ...[...html.matchAll(/<link[^>]+href="([^"]+)"/g)].map(m => m[1]),
    ...[...html.matchAll(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/g)].map(m => m[1]),
  ]
    .filter((q, i, arr) => arr.indexOf(q) === i)
    .filter(q => !/^(https?:|data:|#)/.test(q))
    .map(q => q.replace(/^\.?\//, ''));
  for (const q of quellen) {
    check(`${seite} verweist auf ${q} — die Datei gibt es`, existsSync(`${WURZEL}/${q}`));
    check(`KRITISCH: ${q} wird auch deployt (per <link>/og:image von ${seite} verwiesen)`,
      kopierteQuellen.some(zeile => alsGlobPassend(q, zeile)));
  }
}

for (const seite of seiten) {
  const html = readFileSync(`${WURZEL}/${seite}`, 'utf8');
  const quellen = [...html.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map(m => m[1].trim())
    .filter((q, i, arr) => arr.indexOf(q) === i)
    .filter(q => !/^(https?:|data:|#)/.test(q))
    .map(q => q.replace(/^\.?\//, ''));
  for (const q of quellen) {
    check(`${seite} holt ${q} per CSS — die Datei gibt es`, existsSync(`${WURZEL}/${q}`));
    check(`KRITISCH: ${q} wird auch deployt (per CSS von ${seite} geholt)`,
      kopierteQuellen.some(zeile => alsGlobPassend(q, zeile)));
  }
}

// Dasselbe fuer Dateien, die per <source src="..."> geladen werden -- bis
// ENT-392/ENT-394 gab es keine Video-/Audioquelle in einer der drei Seiten,
// weder die <script src>- noch die CSS-url()-Pruefung oben haetten sie
// gefangen: <source> ist weder ein <script>-Tag noch ein CSS-Konstrukt.
for (const seite of seiten) {
  const html = readFileSync(`${WURZEL}/${seite}`, 'utf8');
  const quellen = [...html.matchAll(/<source\s+src="([^"]+)"/g)].map(m => m[1])
    .filter((q, i, arr) => arr.indexOf(q) === i)
    .filter(q => !/^https?:\/\//.test(q))
    .map(q => q.replace(/^\//, ''));
  for (const q of quellen) {
    check(`${seite} laedt ${q} per <source> — die Datei gibt es`, existsSync(`${WURZEL}/${q}`));
    check(`KRITISCH: ${q} wird auch deployt (per <source> von ${seite} geladen)`,
      kopierteQuellen.some(zeile => alsGlobPassend(q, zeile)));
  }
}

// Die Schriftlizenz muss mit. Die SIL Open Font License 1.1 verlangt, dass
// sie die Schrift begleitet -- wer die woff2 ausliefert und die Lizenz
// weglaesst, verteilt sie nicht lizenzkonform. Kein Aussehen-Problem,
// darum faellt es sonst niemandem auf.
if (existsSync(`${WURZEL}/fonts`)) {
  const schriften = readdirSync(`${WURZEL}/fonts`).filter(f => f.endsWith('.woff2'));
  if (schriften.length) {
    check('KRITISCH: die Schriftlizenz liegt bei den Schriften',
      existsSync(`${WURZEL}/fonts/inter-LICENSE.txt`));
    check('KRITISCH: die Schriftlizenz wird mitdeployt',
      /cp\s+fonts\/inter-LICENSE\.txt\s+dist\//.test(workflow));
  }
}

// Und die Gegenrichtung: Wer eine HTML-Seite anlegt und nicht deployt, hat
// dasselbe Problem eine Ebene höher.
for (const seite of seiten) {
  check(`KRITISCH: ${seite} wird deployt`,
    new RegExp(`cp\\s+${seite}\\s+dist/`).test(workflow));
}

// Die Ersteinrichtung gehört ausdrücklich NICHT in den Deploy (Kommentar im
// Workflow). Diese Prüfung hält den Entscheid fest, statt ihn dem nächsten
// Lesen zu überlassen.
check('KRITISCH: setup wird nicht mitdeployt', !/cp\s+setup\.(php|html)\s+dist/.test(workflow));

// ── Staging darf niemals auf Production-Secrets zurückfallen (ENT-341,
// verschärft auf Wunsch des Projektinhabers) ──────────────────────────────
//
// Warum diese Prüfung: GitHub fällt bei einem fehlenden Environment-Secret
// still auf ein gleichnamiges Repository-Secret zurück. Die einzige
// strukturelle Absicherung dagegen sind DISJUNKTE Secret-Namen für Staging
// (STAGING_DB_HOST statt DB_HOST) -- eine Konfigurationsdisziplin ("beide
// Environments sauber trennen") wäre keine Prüfung, sondern eine Hoffnung.
// Geprüft wird die AUSSAGE ("es gibt keinen Namen, den beide Umgebungen
// teilen"), nicht der Wortlaut einer einzelnen Zeile.
{
  const pflichtNamen = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD',
    'HOSTPOINT_FTP_HOST', 'HOSTPOINT_FTP_USER', 'HOSTPOINT_FTP_PASSWORD'];
  const geteilteNamen = pflichtNamen.filter(n =>
    new RegExp(`secrets\\.${n}\\b`).test(workflow) && !new RegExp(`secrets\\.STAGING_${n}\\b`).test(workflow));
  check('KRITISCH: jedes Produktions-Secret hat ein eigenes STAGING_-Gegenstück im Workflow',
    geteilteNamen.length === 0);
  if (geteilteNamen.length) { bad.push('ohne STAGING_-Gegenstück: ' + geteilteNamen.join(', ')); }

  // Gegenprobe der Aussage selbst: Ein Muster, das nur auf den Wortlaut prüft
  // ("STAGING_" kommt irgendwo vor), würde grün bleiben, auch wenn die
  // FTP-Zugangsdaten wieder direkt aus "secrets." kämen. Deshalb zusätzlich:
  // Der FTP-Deploy-Schritt selbst darf NICHT direkt auf "secrets.HOSTPOINT_FTP_*"
  // zeigen, sondern nur auf die zuvor aufgelösten env.EFF_*-Werte -- das ist
  // die Stelle, die bei einer versehentlichen Rückumstellung tatsächlich
  // Schaden anrichten würde.
  check('KRITISCH: der FTP-Upload verwendet die aufgelösten EFF_*-Werte, nicht direkt secrets.HOSTPOINT_FTP_*',
    /server:\s*\$\{\{\s*env\.EFF_HOSTPOINT_FTP_HOST\s*\}\}/.test(workflow)
    && !/server:\s*\$\{\{\s*secrets\.HOSTPOINT_FTP_HOST\s*\}\}/.test(workflow));

  // Ein fehlendes Pflicht-Secret muss den Lauf abbrechen -- sonst deployt
  // der Workflow mit leeren Platzhaltern weiter, unbemerkt.
  check('KRITISCH: der Workflow bricht bei fehlendem Pflicht-Secret ab (exit 1)',
    /PFLICHT_FEHLT/.test(workflow) && /exit 1/.test(workflow));
}

// ── Dieselbe Absicherung fuer Demo (ENT-523): kein Rueckfall auf
// Production- ODER Staging-Secrets ──────────────────────────────────────
//
// Warum diese Prüfung: Demo ist eine DRITTE Umgebung, nicht "Staging mit
// anderem Namen" -- ein DEMO_DB_HOST, das GitHub bei fehlendem
// Environment-Secret still gegen STAGING_DB_HOST oder DB_HOST aufloest,
// waere derselbe Fehler wie oben, nur eine Umgebung weiter.
{
  const pflichtNamen = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD',
    'HOSTPOINT_FTP_HOST', 'HOSTPOINT_FTP_USER', 'HOSTPOINT_FTP_PASSWORD'];
  const ohneDemoGegenstueck = pflichtNamen.filter(n =>
    new RegExp(`secrets\\.${n}\\b`).test(workflow) && !new RegExp(`secrets\\.DEMO_${n}\\b`).test(workflow));
  check('KRITISCH: jedes Produktions-Secret hat ein eigenes DEMO_-Gegenstück im Workflow',
    ohneDemoGegenstueck.length === 0);
  if (ohneDemoGegenstueck.length) { bad.push('ohne DEMO_-Gegenstück: ' + ohneDemoGegenstueck.join(', ')); }

  // Konkreter Copy-Paste-Fehler statt nur "kommt DEMO_X irgendwo vor":
  // JEDE D_<NAME>-Umgebungsvariable im Secrets-Prüfschritt (nicht nur die
  // Pflichtnamen oben -- auch SMTP_*, MAPS_JS_KEY, ANTHROPIC_API_KEY usw.)
  // muss zu IHREM EIGENEN secrets.DEMO_<NAME> gehören, nicht versehentlich
  // auf secrets.STAGING_<NAME> oder secrets.<NAME> ohne Präfix zeigen.
  // Ohne diese generische Prüfung (statt einer festen Namensliste) bliebe
  // ein Copy-Paste-Fehler bei einem Namen ausserhalb der Pflichtliste --
  // etwa D_MAPS_JS_KEY, das versehentlich STAGING_MAPS_JS_KEY läse --
  // unentdeckt.
  // Kein Umweg über einen extrahierten Schritt-Ausschnitt nötig: Der
  // Präfix "D_" als env-Schlüssel ist eindeutig genug, er kommt im
  // gesamten Workflow nur im Secrets-Prüfschritt vor.
  const dVariablen = [...workflow.matchAll(/\bD_(\w+):\s*\$\{\{\s*secrets\.(\w+)\s*\}\}/g)];
  check('KRITISCH: der Secrets-Prüfschritt deklariert überhaupt D_-Variablen (sonst liefe die vorherige Prüfung leer)',
    dVariablen.length >= 10);
  const falschVerdrahtet = dVariablen.filter(([, name, secretName]) => secretName !== `DEMO_${name}`);
  check('KRITISCH: JEDE D_<NAME>-Variable im Secrets-Prüfschritt zeigt auf genau secrets.DEMO_<NAME>, keine andere',
    falschVerdrahtet.length === 0);
  if (falschVerdrahtet.length) {
    bad.push('falsch verdrahtet: ' + falschVerdrahtet.map(([, n, s]) => `D_${n}→${s}`).join(', '));
  }

  // ANDERS als bei Production/Staging: DEMO_ANTHROPIC_API_KEY ist hier
  // ERFORDERLICH (ENT-523-N1 -- der Projektinhaber hat sich bewusst fuer
  // eine aktive KI-Funktion in der Demo entschieden). Eine Pruefung, die
  // nur "ANTHROPIC_API_KEY kommt irgendwo vor" verlangt, wuerde grün
  // bleiben, auch wenn er wie bei Production/Staging NICHT in die
  // PFLICHT_FEHLT-Liste des Demo-Zweigs aufgenommen waere.
  const demoZweig = (/elif \[ "\$IST_DEMO_REF" = "1" \][\s\S]{0,7000}?(?=\n          else)/.exec(workflow) ?? [''])[0];
  check('KRITISCH (ENT-523-N1): DEMO_ANTHROPIC_API_KEY ist im Demo-Zweig ein PFLICHT-Secret -- anders als bei Production und Staging',
    /\[ -z "\$EFF_ANTHROPIC_API_KEY" \][\s\S]{0,80}PFLICHT_FEHLT="\$PFLICHT_FEHLT DEMO_ANTHROPIC_API_KEY"/.test(demoZweig));

  // Gegenprobe der Aussage selbst: Production und Staging duerfen diese
  // Pflicht NICHT tragen -- sonst waere die obige Prüfung bedeutungslos
  // (sie fände die Zeile irgendwo im Workflow, nicht spezifisch im
  // Demo-Zweig).
  check('KRITISCH (Gegenprobe): ANTHROPIC_API_KEY bleibt fuer Production und Staging weiterhin NICHT erforderlich',
    !/\[ -z "\$EFF_ANTHROPIC_API_KEY" \][\s\S]{0,80}PFLICHT_FEHLT="\$PFLICHT_FEHLT ANTHROPIC_API_KEY"/.test(workflow)
    && !/\[ -z "\$EFF_ANTHROPIC_API_KEY" \][\s\S]{0,80}PFLICHT_FEHLT="\$PFLICHT_FEHLT STAGING_ANTHROPIC_API_KEY"/.test(workflow));
}

// ── Staging deployt nur gegen qa-*-Tags, nie gegen einen Branch (ENT-372,
// revidiert ENT-341 Punkt 5) ──────────────────────────────────────────────
//
// Warum diese Prüfung: Der dauerhafte Branch "staging" wurde ersatzlos
// gestrichen -- ein beschreibbarer Branch widerspricht der Vorgabe "main
// ist alleinige Source of Truth, kein Staging-spezifischer Code, der
// zurückgemerged werden müsste". Geprüft wird die AUSSAGE ("kein Push auf
// main+staging mehr, ein Staging-Deploy ohne passenden qa-*-Tag bricht
// ab"), nicht nur, ob der String "qa-*" irgendwo im Workflow vorkommt.
{
  check('KRITISCH: main ist der einzige Push-Auslöser, kein Branch "staging" mehr',
    /push:\s*\n\s*branches:\s*\[main\]/.test(workflow)
    && !/branches:\s*\[\s*main\s*,\s*staging\s*\]/.test(workflow));

  // Gegenprobe der Aussage selbst: Ein Muster, das nur nach "qa-*" sucht,
  // bliebe grün, wenn das nur in einem Kommentar auftaucht. Deshalb muss
  // die Prüfung tatsächlich an den github.ref_name UND an einen Abbruch
  // (exit 1) gekoppelt sein, innerhalb des staging-Zweigs.
  const qaTagAbbruch = /if\s*\[\s*"\$UMGEBUNG"\s*=\s*"staging"\s*\][\s\S]{0,300}?github\.ref_name[\s\S]{0,200}?qa-\*[\s\S]{0,300}?exit 1/;
  check('KRITISCH: ein Staging-Deploy ohne passenden qa-*-Tag bricht ab (exit 1)',
    qaTagAbbruch.test(workflow));
}

// ── Dieselbe Absicherung fuer Demo (ENT-523): nur gegen demo-*-Tags,
// nie gegen einen Branch ──────────────────────────────────────────────────
//
// Warum diese Prüfung: Ohne einen eigenen Guard würde jeder Ref, der
// weder "main" noch ein qa-*-Tag ist, automatisch als UMGEBUNG=demo
// durchgehen (siehe die environment:-Ausdruck-Prüfung unten) -- auch ein
// x-beliebiger Feature-Branch. Geprüft wird dieselbe AUSSAGE wie beim
// qa-*-Guard: der Abbruch ist an github.ref_name UND exit 1 gekoppelt,
// innerhalb des demo-Zweigs.
{
  const demoTagAbbruch = /if\s*\[\s*"\$UMGEBUNG"\s*=\s*"demo"\s*\][\s\S]{0,300}?github\.ref_name[\s\S]{0,200}?demo-\*[\s\S]{0,300}?exit 1/;
  check('KRITISCH: ein Demo-Deploy ohne passenden demo-*-Tag bricht ab (exit 1)',
    demoTagAbbruch.test(workflow));

  // Gegenprobe der Aussage selbst: Der environment:-Ausdruck muss
  // TATSÄCHLICH zwischen main, einem demo-*-Tag und allem anderen
  // (Staging) unterscheiden -- ein Muster, das nur "demo" irgendwo im
  // Workflow verlangt, bliebe grün, auch wenn environment: weiterhin
  // binär waere und jeder Nicht-main-Ref als Staging durchginge (dann
  // wuerde UMGEBUNG=demo nie erreicht, und der Guard oben liefe leer).
  check('KRITISCH: der environment:-Ausdruck waehlt "demo" fuer jeden Ref, der mit "demo-" beginnt, unabhaengig von main',
    /environment:\s*\$\{\{[\s\S]{0,50}github\.ref_name\s*==\s*'main'[\s\S]{0,50}&&\s*'production'[\s\S]{0,80}startsWith\(github\.ref_name,\s*'demo-'\)[\s\S]{0,30}&&\s*'demo'[\s\S]{0,30}\|\|\s*'staging'/.test(workflow));
}

// ── Hostpoint-Passwortschutz auf Staging: nie stillschweigend entfernt,
// nie unbemerkt veraltet, aktiv nachgewiesen statt nur angenommen (ENT-384)
// ────────────────────────────────────────────────────────────────────────
//
// Warum diese Prüfung: Der Passwortschutz lebt in einer Datei
// (Staging-.htaccess bei Hostpoint), die unser Deploy normalerweise bei
// jedem Lauf überschreiben würde. Drei Aussagen müssen gemeinsam gelten,
// nicht nur der Wortlaut einzelner Zeilen: (1) ein geändertes
// htaccess-hostpoint ohne manuelle Nachführung bricht den Staging-Deploy
// ab, (2) die Staging-.htaccess wird von Upload UND Löschung ausgenommen,
// (3) der Nachweis danach ist ein echter HTTP-Test (401 UND
// WWW-Authenticate: Basic, nicht nur eines von beidem -- ein 401 aus
// einem anderen Grund wäre sonst ein falscher Nachweis), der bei
// Netzwerkfehlern ebenfalls abbricht statt es als "nicht prüfbar, also ok"
// durchgehen zu lassen.
{
  const verifySchritt = (/Staging-Passwortschutz verifizieren[\s\S]{0,2500}/.exec(workflow) ?? [''])[0];

  check('KRITISCH: ein verändertes htaccess-hostpoint ohne manuelle Staging-Synchronisierung bricht den Staging-Deploy ab',
    /for DRIFT_DATEI in htaccess-hostpoint htaccess-staging-zusatz robots-staging\.txt/.test(workflow)
    && /AKTUELLER_HASH=\$\(sha256sum "\$DRIFT_DATEI"/.test(workflow)
    && /"\$AKTUELLER_HASH"\s*!=\s*"\$SYNCED_HASH"[\s\S]{0,500}exit 1/.test(workflow)
    && existsSync(`${WURZEL}/staging-htaccess.synced-sha256`));

  check('KRITISCH: sowohl .htaccess als auch robots.txt werden beim Staging-FTP-Upload nicht angefasst (kein Upload, keine Löschung), Production bleibt ohne Ausschluss',
    /STAGING_EXCLUDE=\$'\.htaccess\\nrobots\.txt'/.test(workflow)
    && /STAGING_EXCLUDE=""/.test(workflow)
    && /exclude:\s*\$\{\{\s*env\.STAGING_EXCLUDE\s*\}\}/.test(workflow));

  // Nicht nur "kommen die Wörter 401/WWW-Authenticate/Basic irgendwo vor"
  // -- das bliebe grün, auch wenn nur die abschliessende Erfolgsmeldung
  // ("... verifiziert (HTTP 401, WWW-Authenticate: Basic)") übrig wäre und
  // die eigentliche Prüfung fehlte. Verlangt wird die tatsächliche
  // grep-Bedingung in unmittelbarer Nähe zu ihrem eigenen Abbruch.
  check('KRITISCH: der Passwortschutz-Nachweis verlangt HTTP 401 UND einen WWW-Authenticate-Basic-Kopf, nicht nur eines von beidem',
    /grep -qE '\^HTTP\/\[0-9\.\]\+ 401'[\s\S]{0,250}exit 1/.test(workflow)
    && /grep -qi '\^WWW-Authenticate:\.\*Basic'[\s\S]{0,250}exit 1/.test(workflow));

  check('KRITISCH: der Nachweis nutzt die Environment-Variable STAGING_DOMAIN, kein Secret',
    /vars\.STAGING_DOMAIN/.test(verifySchritt) && !/secrets\.STAGING_DOMAIN/.test(workflow));

  // Auch hier reicht "--max-time und exit 1 kommen beide im Schritt vor"
  // nicht -- die anderen Abbrüche im selben Schritt (fehlende Variable,
  // falscher Status) haben ebenfalls ein "exit 1". Verlangt wird konkret,
  // dass der curl-Fehlschlag selbst (nicht 0) zum eigenen Abbruch führt.
  check('KRITISCH: ein Netzwerkfehler/Timeout beim Passwortschutz-Nachweis bricht den Deploy ab, statt als "ok" durchzugehen',
    /\$\?\s*-ne\s*0[\s\S]{0,200}exit 1/.test(verifySchritt));
}

// ── Staging-Suchmaschinenausschluss: X-Robots-Tag und robots.txt zusätzlich
// zu Basic Auth, aktiv per HTTP nachgewiesen (ENT-387)
// ────────────────────────────────────────────────────────────────────────
//
// Basic Auth (ENT-384) verhindert Indexierung bereits strukturell. Diese
// zweite Schicht soll greifen, falls Basic Auth künftig versehentlich
// geschwächt wird -- deshalb wird sie unabhängig davon aktiv nachgewiesen,
// nicht nur als Konfiguration angenommen. Ein unauthentifizierter Abruf
// wäre hier kein Nachweis (liefert wegen "Require valid-user" immer 401,
// unabhängig vom tatsächlichen Dateiinhalt) -- deshalb authentifiziert mit
// eigenen, nur für diesen Zweck bestimmten Secrets.
{
  const suchmaschinenSchritt = (/Staging-Suchmaschinenausschluss verifizieren[\s\S]{0,3000}/.exec(workflow) ?? [''])[0];

  check('KRITISCH: htaccess-staging-zusatz existiert und setzt X-Robots-Tag: noindex dauerhaft (mit "always", nicht nur bei Erfolgsantworten)',
    existsSync(`${WURZEL}/htaccess-staging-zusatz`)
    && /Header\s+always\s+set\s+X-Robots-Tag\s+"noindex/.test(readFileSync(`${WURZEL}/htaccess-staging-zusatz`, 'utf8')));

  check('KRITISCH: robots-staging.txt existiert und sperrt tatsächlich alles (User-agent: * / Disallow: /)',
    existsSync(`${WURZEL}/robots-staging.txt`)
    && /^User-agent:\s*\*/m.test(readFileSync(`${WURZEL}/robots-staging.txt`, 'utf8'))
    && /^Disallow:\s*\/\s*$/m.test(readFileSync(`${WURZEL}/robots-staging.txt`, 'utf8')));

  // Kein "die Datei existiert", sondern: der dort hinterlegte Hash stimmt
  // TATSÄCHLICH mit dem aktuellen Inhalt der drei Quelldateien überein.
  // Sonst könnte irgendein Platzhalter-Hash stehen, der nie mehr aktualisiert
  // wird, und der Drift-Guard würde niemals mehr auslösen.
  {
    const sha256 = pfad => createHash('sha256').update(readFileSync(pfad)).digest('hex');
    const syncDatei = readFileSync(`${WURZEL}/staging-htaccess.synced-sha256`, 'utf8');
    for (const datei of ['htaccess-hostpoint', 'htaccess-staging-zusatz', 'robots-staging.txt']) {
      const zeile = syncDatei.split('\n').find(z => z.startsWith(`${datei}:`));
      check(`KRITISCH: staging-htaccess.synced-sha256 trägt den tatsächlich aktuellen Hash von ${datei}`,
        !!zeile && zeile.split(':')[1]?.trim() === sha256(`${WURZEL}/${datei}`));
    }
  }

  check('KRITISCH: die authentifizierte Startseiten-Prüfung verlangt HTTP 200 UND X-Robots-Tag: noindex, beides einzeln an einen Abbruch gekoppelt',
    /grep -qE '\^HTTP\/\[0-9\.\]\+ 200'[\s\S]{0,250}exit 1/.test(suchmaschinenSchritt)
    && /grep -qi '\^X-Robots-Tag:\.\*noindex'[\s\S]{0,250}exit 1/.test(suchmaschinenSchritt));

  check('KRITISCH: die authentifizierte robots.txt-Prüfung verlangt HTTP 200 UND den Inhalt User-agent: * UND Disallow: /, alle drei einzeln an einen Abbruch gekoppelt',
    /grep -qE '\^HTTP\/\[0-9\.\]\+ 200'[\s\S]{0,600}exit 1/.test(suchmaschinenSchritt)
    && /grep -qE '\^User-agent:\[\[:space:\]\]\*\\\*'[\s\S]{0,250}exit 1/.test(suchmaschinenSchritt)
    && /grep -qE '\^Disallow:\[\[:space:\]\]\*\/\[\[:space:\]\]\*\$'[\s\S]{0,250}exit 1/.test(suchmaschinenSchritt));

  check('KRITISCH: beide authentifizierten Abrufe (Startseite UND robots.txt) brechen bei DNS-/TLS-/Netzwerkfehler oder Timeout ab, statt als "ok" durchzugehen',
    (suchmaschinenSchritt.match(/\$\?\s*-ne\s*0[\s\S]{0,300}exit 1/g) ?? []).length >= 2);

  // Nicht nur "das richtige Secret kommt irgendwo im Schritt vor" -- das
  // bliebe grün, wenn nur EINER der beiden authentifizierten Abrufe
  // (Startseite ODER robots.txt) tatsächlich STAGING_BASIC_AUTH_* nutzt und
  // der andere heimlich auf einen anderen Zugang umgestellt wird. Verlangt
  // wird, dass JEDES "-u ..." im Schritt exakt dieses Secret-Paar ist.
  {
    const alleAuthAbrufe = suchmaschinenSchritt.match(/-u\s+"[^"]*"/g) ?? [];
    const korrekteAuthAbrufe = suchmaschinenSchritt.match(/-u\s+"\$\{\{\s*secrets\.STAGING_BASIC_AUTH_USER\s*\}\}:\$\{\{\s*secrets\.STAGING_BASIC_AUTH_PASSWORD\s*\}\}"/g) ?? [];
    check('KRITISCH: beide authentifizierten Abrufe (Startseite UND robots.txt) nutzen ausschliesslich STAGING_BASIC_AUTH_USER/PASSWORD, keinen persönlichen oder produktiven Zugang',
      alleAuthAbrufe.length >= 2 && alleAuthAbrufe.length === korrekteAuthAbrufe.length);
  }

  check('KRITISCH: fehlende STAGING_BASIC_AUTH_USER/PASSWORD brechen den Nachweis ab, statt ohne Zugangsdaten "leer" weiterzulaufen',
    /secrets\.STAGING_BASIC_AUTH_USER[\s\S]{0,120}secrets\.STAGING_BASIC_AUTH_PASSWORD[\s\S]{0,250}exit 1/.test(suchmaschinenSchritt));

  // Ohne diese beiden Wächter könnte ein Redirect auf einen fremden Host
  // (curl -L folgt ihm und meldet am Ende trotzdem "200") oder ein
  // abgeschaltetes Zertifikats-Prüfen (-k) die ganze Nachweiskette
  // unbemerkt aushebeln, unabhängig davon, was die einzelnen grep-Prüfungen
  // oben verlangen.
  check('KRITISCH: keine der HTTP-Prüfungen deaktiviert die TLS-Zertifikatsprüfung (kein curl -k/--insecure)',
    !/curl\s+[^\n]*(-k\b|--insecure)/.test(workflow));

  check('KRITISCH: keine der HTTP-Prüfungen folgt Weiterleitungen (kein curl -L/--location) -- ein Redirect auf einen fremden Host kann so nie als Erfolg durchgehen',
    !/curl\s+[^\n]*(-L\b|--location)/.test(workflow));
}

// ── Demo: automatischer Suchmaschinenausschluss statt Basic Auth
// (ENT-523/ENT-523-N1) ──────────────────────────────────────────────────
//
// Warum diese Prüfung: Demo trägt bewusst KEINEN Passwortschutz (die
// Vorentscheidung, die den ganzen Unterschied zu Staging ausmacht) -- die
// .htaccess samt X-Robots-Tag entsteht stattdessen vollständig aus dem
// Repository, bei jedem Deploy neu, ohne manuellen Hostpoint-Schritt und
// ohne Drift-Guard. Ein unauthentifizierter Nachweis ist hier deshalb ein
// ECHTER Nachweis -- anders als bei Staging, wo "Require valid-user"
// jeden Pfad ohnehin mit 401 beantwortet. Vier Aussagen müssen gemeinsam
// gelten: (1) htaccess-demo-zusatz und robots-demo.txt existieren mit dem
// richtigen Inhalt, (2) beide werden im Deploy-Schritt AUSSCHLIESSLICH im
// Demo-Zweig angehängt/kopiert, (3) der Nachweis ist ein echter,
// UNAUTHENTIFIZIERTER HTTP-Test (kein -u, sonst wäre er ein Rückfall auf
// die Staging-Bauart mit Zugangsdaten, die es für Demo gar nicht gibt),
// (4) Netzwerkfehler brechen ab statt als "ok" durchzugehen.
{
  check('KRITISCH: htaccess-demo-zusatz existiert und setzt X-Robots-Tag: noindex dauerhaft (mit "always")',
    existsSync(`${WURZEL}/htaccess-demo-zusatz`)
    && /Header\s+always\s+set\s+X-Robots-Tag\s+"noindex/.test(readFileSync(`${WURZEL}/htaccess-demo-zusatz`, 'utf8')));

  check('KRITISCH: robots-demo.txt existiert und sperrt tatsächlich alles (User-agent: * / Disallow: /)',
    existsSync(`${WURZEL}/robots-demo.txt`)
    && /^User-agent:\s*\*/m.test(readFileSync(`${WURZEL}/robots-demo.txt`, 'utf8'))
    && /^Disallow:\s*\/\s*$/m.test(readFileSync(`${WURZEL}/robots-demo.txt`, 'utf8')));

  // Gegenprobe der Aussage selbst: Ein Muster, das nur "htaccess-demo-zusatz"
  // irgendwo im Workflow verlangt, bliebe grün, auch wenn der Anhängevorgang
  // unbedingt liefe (dann trüge JEDE Umgebung den Demo-Zusatz). Verlangt
  // wird die tatsächliche Kopplung an UMGEBUNG=demo im selben Bedingungsblock.
  const demoHtaccessBlock = /if\s*\[\s*"\$UMGEBUNG"\s*=\s*"demo"\s*\][\s\S]{0,300}?fi/.exec(workflow)?.[0] ?? '';
  check('KRITISCH: htaccess-demo-zusatz wird NUR im Demo-Zweig angehängt, robots-demo.txt NUR dort kopiert',
    /cat htaccess-demo-zusatz >> dist\/\.htaccess/.test(demoHtaccessBlock)
    && /cp robots-demo\.txt dist\/robots\.txt/.test(demoHtaccessBlock));

  const demoSuchmaschinenSchritt = (/Demo-Suchmaschinenausschluss verifizieren[\s\S]{0,2500}/.exec(workflow) ?? [''])[0];

  check('KRITISCH: der Schritt "Demo-Suchmaschinenausschluss verifizieren" existiert und läuft ausschliesslich für Demo',
    /name:\s*Demo-Suchmaschinenausschluss verifizieren[\s\S]{0,80}if:\s*\$\{\{\s*env\.UMGEBUNG\s*==\s*'demo'\s*\}\}/.test(workflow));

  check('KRITISCH: die Startseiten-Prüfung verlangt HTTP 200 UND X-Robots-Tag: noindex, beides einzeln an einen Abbruch gekoppelt',
    /grep -qE '\^HTTP\/\[0-9\.\]\+ 200'[\s\S]{0,250}exit 1/.test(demoSuchmaschinenSchritt)
    && /grep -qi '\^X-Robots-Tag:\.\*noindex'[\s\S]{0,250}exit 1/.test(demoSuchmaschinenSchritt));

  check('KRITISCH: die robots.txt-Prüfung verlangt HTTP 200 UND User-agent: * UND Disallow: /, alle drei einzeln an einen Abbruch gekoppelt',
    /grep -qE '\^HTTP\/\[0-9\.\]\+ 200'[\s\S]{0,600}exit 1/.test(demoSuchmaschinenSchritt)
    && /grep -qE '\^User-agent:\[\[:space:\]\]\*\\\*'[\s\S]{0,250}exit 1/.test(demoSuchmaschinenSchritt)
    && /grep -qE '\^Disallow:\[\[:space:\]\]\*\/\[\[:space:\]\]\*\$'[\s\S]{0,250}exit 1/.test(demoSuchmaschinenSchritt));

  check('KRITISCH: beide Abrufe (Startseite UND robots.txt) brechen bei DNS-/TLS-/Netzwerkfehler oder Timeout ab, statt als "ok" durchzugehen',
    (demoSuchmaschinenSchritt.match(/\$\?\s*-ne\s*0[\s\S]{0,300}exit 1/g) ?? []).length >= 2);

  // DER Kernunterschied zu Staging, konkret geprüft statt nur behauptet:
  // kein einziger authentifizierter Abruf (-u) im Demo-Schritt. Das ist
  // keine Bequemlichkeit, sondern die direkte Konsequenz von ENT-523-N1 --
  // ein "-u" hier würde bedeuten, dass doch irgendwo Demo-Basic-Auth-
  // Zugangsdaten erwartet werden, die es laut Entscheidung nicht gibt.
  check('KRITISCH (ENT-523-N1): der Demo-Suchmaschinenausschluss-Nachweis ist UNAUTHENTIFIZIERT -- kein "-u" im Schritt, anders als bei Staging',
    !/-u\s+"/.test(demoSuchmaschinenSchritt));
}

// ── qa-version.json: Live-Version-Nachweis fuer den externen QA-Runner,
// ausschliesslich Staging betreffend (ENT-435)
// ────────────────────────────────────────────────────────────────────────
//
// Warum diese Prüfung: sop-qa-runner (getrenntes Repository) muss vor jedem
// operativen Testlauf verifizieren können, dass Staging tatsächlich den
// erwarteten qa_tag/commit_sha trägt -- sonst bewiese ein grüner Lauf nur,
// dass IRGENDEINE Version antwortet. Drei Aussagen müssen gemeinsam gelten:
// (1) die Datei entsteht NUR im Staging-Zweig, (2) ihre Werte kommen aus
// github.ref_name/github.sha, nicht aus einem Secret oder einem festen Text,
// (3) für Production läuft der erzeugende Schritt gar nicht -- Production
// bleibt damit strukturell unverändert, nicht nur der Absicht nach.
{
  const versionSchritt = (/qa-version\.json erzeugen[\s\S]{0,700}/.exec(workflow) ?? [''])[0];

  check('KRITISCH: der Schritt "qa-version.json erzeugen" existiert und läuft ausschliesslich für Staging (if env.UMGEBUNG == staging)',
    /name:\s*qa-version\.json erzeugen[\s\S]{0,80}if:\s*\$\{\{\s*env\.UMGEBUNG\s*==\s*'staging'\s*\}\}/.test(workflow));

  check('KRITISCH: qa_tag kommt aus github.ref_name, nicht aus einem Secret oder einem festen Text',
    /"qa_tag":\s*"\$\{\{\s*github\.ref_name\s*\}\}"/.test(versionSchritt)
    && !/"qa_tag":\s*"\$\{\{\s*secrets\./.test(versionSchritt));

  check('KRITISCH: commit_sha kommt aus github.sha, nicht aus einem Secret oder einem festen Text',
    /"commit_sha":\s*"\$\{\{\s*github\.sha\s*\}\}"/.test(versionSchritt)
    && !/"commit_sha":\s*"\$\{\{\s*secrets\./.test(versionSchritt));

  check('KRITISCH: qa-version.json wird VOR dem FTP-Upload erzeugt (sonst würde sie den Server nie erreichen)',
    workflow.indexOf('qa-version.json erzeugen') > 0
    && workflow.indexOf('qa-version.json erzeugen') < workflow.indexOf('Nach Hostpoint hochladen'));

  check('KRITISCH: qa-version.json steht nicht in STAGING_EXCLUDE -- sonst würde sie beim Staging-Upload übersprungen',
    !/STAGING_EXCLUDE=\$'[^']*qa-version\.json[^']*'/.test(workflow));

  // Gegenprobe der Aussage selbst: Ein Muster, das nur "qa-version.json"
  // irgendwo im Workflow verlangt, bliebe grün, auch wenn der Schritt
  // unbedingt (auch für Production) liefe. Verlangt wird die tatsächliche
  // Kopplung von Dateinamen UND if-Bedingung im selben Schritt.
  check('KRITISCH: kein anderer, unbedingter Schritt erzeugt dist/qa-version.json ausserhalb des Staging-Zweigs',
    (workflow.match(/>\s*dist\/qa-version\.json/g) ?? []).length === 1);
}

// ── demo-version.json: dieselbe Nachvollziehbarkeit für Demo (ENT-523) ───
//
// Warum diese Prüfung: rein betrieblicher Nutzen (welcher Tag/Commit läuft
// gerade auf der Demo), aber derselbe Fehlerfall wie bei qa-version.json:
// ohne die Kopplung an den Demo-Zweig würde die Datei entweder nie
// entstehen oder -- schlimmer -- auch für Production erzeugt und
// hochgeladen.
{
  const demoVersionSchritt = (/demo-version\.json erzeugen[\s\S]{0,700}/.exec(workflow) ?? [''])[0];

  check('KRITISCH: der Schritt "demo-version.json erzeugen" existiert und läuft ausschliesslich für Demo (if env.UMGEBUNG == demo)',
    /name:\s*demo-version\.json erzeugen[\s\S]{0,80}if:\s*\$\{\{\s*env\.UMGEBUNG\s*==\s*'demo'\s*\}\}/.test(workflow));

  check('KRITISCH: demo_tag kommt aus github.ref_name, nicht aus einem Secret oder einem festen Text',
    /"demo_tag":\s*"\$\{\{\s*github\.ref_name\s*\}\}"/.test(demoVersionSchritt)
    && !/"demo_tag":\s*"\$\{\{\s*secrets\./.test(demoVersionSchritt));

  check('KRITISCH: commit_sha kommt aus github.sha, nicht aus einem Secret oder einem festen Text',
    /"commit_sha":\s*"\$\{\{\s*github\.sha\s*\}\}"/.test(demoVersionSchritt)
    && !/"commit_sha":\s*"\$\{\{\s*secrets\./.test(demoVersionSchritt));

  check('KRITISCH: demo-version.json wird VOR dem FTP-Upload erzeugt (sonst würde sie den Server nie erreichen)',
    workflow.indexOf('demo-version.json erzeugen') > 0
    && workflow.indexOf('demo-version.json erzeugen') < workflow.indexOf('Nach Hostpoint hochladen'));

  // Gegenprobe der Aussage selbst: Verlangt die tatsächliche Kopplung von
  // Dateinamen UND if-Bedingung im selben Schritt, nicht nur "der String
  // demo-version.json kommt irgendwo vor".
  check('KRITISCH: kein anderer, unbedingter Schritt erzeugt dist/demo-version.json ausserhalb des Demo-Zweigs',
    (workflow.match(/>\s*dist\/demo-version\.json/g) ?? []).length === 1);

  // Und die Gegenrichtung zu qa-version.json: die beiden Version-Dateien
  // duerfen sich nicht vermischen -- ein Demo-Deploy darf NIE
  // qa-version.json erzeugen und umgekehrt.
  check('KRITISCH: qa-version.json und demo-version.json sind unabhängige Schritte, keiner erzeugt die Datei des anderen',
    !/name:\s*qa-version\.json erzeugen[\s\S]{0,300}demo-version\.json/.test(workflow)
    && !/name:\s*demo-version\.json erzeugen[\s\S]{0,300}qa-version\.json/.test(workflow));
}

// ══════════ DIE HOMEPAGE AUF IHRER EIGENEN DOMAIN ════════════════════
//
// Seit guardops.ch gibt es ein ZWEITES Bündel (dist-guardops/) mit eigenem
// FTP-Ziel. Damit gilt hier derselbe Fallstrick noch einmal, und zwar
// schärfer: Die Homepage liegt dort ALLEIN. Fehlt eine Schrift, ein Icon
// oder eine der vier Einbindungen des Endpunkts, fällt es lokal NICHT auf --
// im Arbeitsverzeichnis liegt ja alles da -- und auf der Testinstanz auch
// nicht, weil deren Bündel vollständig ist.
//
// Geprüft wird deshalb nicht gegen eine abgeschriebene Liste, sondern gegen
// das, was homepage.html und der Endpunkt TATSÄCHLICH laden.
{
  const schritt = (name) => {
    const i = workflow.indexOf(`- name: ${name}`);
    if (i < 0) { return ''; }
    const j = workflow.indexOf('\n      - name:', i + 10);
    return workflow.slice(i, j < 0 ? undefined : j);
  };
  const bauen = schritt('Homepage-Buendel fuer guardops.ch bauen');
  // NUR DIE ECHTEN cp-ZEILEN, nicht der Kommentartext daneben.
  //
  // Die erste Fassung dieser Prüfungen fragte "steht der Dateiname irgendwo
  // im Schritt?". Die Gegenprobe deckte auf, dass das nicht genügt: Nimmt man
  // die cp-Zeile für recht.css heraus, bleibt der Name im Kommentar darüber
  // stehen -- und die Prüfung blieb grün, während das Stilblatt live gefehlt
  // hätte. Genau der Fall, vor dem CLAUDE.md warnt: geprüft wird die Aussage,
  // nicht der Wortlaut.
  const cpZeilen = [...bauen.matchAll(/^\s*cp\s+(\S+)\s+(\S+)\s*$/gm)]
    .map(m => ({ von: m[1], nach: m[2] }));
  const alsMuster = q => new RegExp('^' + q.split('*')
    .map(x => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$');
  // Wird diese Quelldatei kopiert? Beherrscht auch "icons/guardops-*.png".
  const wirdKopiert = pfad => cpZeilen.some(z => alsMuster(z.von).test(pfad));
  // Landet etwas unter diesem Namen im Bündel?
  const liegtImBuendel = ziel => cpZeilen.some(z => z.nach === ziel || z.nach === ziel.replace(/[^/]+$/, ''));
  const laden = schritt('Homepage nach guardops.ch hochladen (FTPS)');
  const hinweis = schritt('Hinweis, wenn guardops.ch noch nicht eingerichtet ist');
  const homepage = readFileSync(`${WURZEL}/homepage.html`, 'utf8');

  check('KRITISCH: es gibt einen Schritt, der das Bündel für guardops.ch baut, und einen, der es hochlädt',
    bauen !== '' && laden !== '');

  // Auf der eigenen Domain gehört die Seite auf "/", nicht auf
  // "/homepage.html" -- sonst zeigt guardops.ch ins Leere.
  check('KRITISCH: homepage.html wird als index.html ausgeliefert (die Seite liegt auf der Wurzel der Domain)',
    cpZeilen.some(z => z.von === 'homepage.html' && z.nach === 'dist-guardops/index.html'));

  // Aus den Dateien abgeleitet, nicht abgeschrieben: jede Schrift, die eine
  // gebündelte Seite per CSS-url() holt. Seit die Rechtsseiten dazugekommen
  // sind, ist das nicht mehr nur homepage.html -- recht.css bringt eigene
  // @font-face-Zeilen mit, und eine davon zu vergessen fiele lokal NICHT auf.
  const cssQuellen = [...bauen.matchAll(/^\s*cp\s+(\S+\.css)\s+dist-guardops\//gm)].map(m => m[1]);
  const mitCss = [homepage, ...cssQuellen.map(q => readFileSync(`${WURZEL}/${q}`, 'utf8'))].join('\n');
  const schriften = [...new Set([...mitCss.matchAll(/url\(['"]?(fonts\/[^)'"]+)/g)].map(m => m[1]))];
  const fehlendeSchriften = schriften.filter(f => !wirdKopiert(f));
  check('KRITISCH: jede Schrift, die homepage.html lädt, wird ins guardops-Bündel kopiert',
    schriften.length >= 4 && fehlendeSchriften.length === 0);
  if (fehlendeSchriften.length) { bad.push('fehlt im guardops-Bündel: ' + fehlendeSchriften.join(', ')); }

  // Ebenso die Icons -- sie hängen per <link href> und og:image, nicht per
  // <script src>: genau die Lücke, die bei den Favicons schon einmal bestand.
  const icons = [...new Set([...homepage.matchAll(/(?:href|content)="(icons\/[^"]+)"/g)].map(m => m[1]))];
  check('KRITISCH: die Icons der Seite werden ins guardops-Bündel kopiert',
    icons.length >= 3 && icons.every(i => wirdKopiert(i)));

  // Die Einbindungen des Endpunkts, aus dem Endpunkt gelesen.
  const endpunkt = readFileSync(`${WURZEL}/backend/api/demo_senden.php`, 'utf8');
  const noetig = [...endpunkt.matchAll(/require __DIR__ \. '\/\.\.\/([a-z_]+\.php)'/g)].map(m => m[1]);
  const fehlendeModule = noetig.filter(m => !liegtImBuendel(`dist-guardops/${m}`));
  check('KRITISCH: jede Datei, die der Endpunkt einbindet, liegt im guardops-Bündel',
    noetig.length >= 3 && fehlendeModule.length === 0
    && liegtImBuendel('dist-guardops/api/demo_senden.php'));
  if (fehlendeModule.length) { bad.push('Einbindung fehlt im guardops-Bündel: ' + fehlendeModule.join(', ')); }

  // Heute lädt homepage.html kein eigenes Skript -- alles steht inline. Die
  // Prüfung steht trotzdem hier: Sobald eine Datei dazukommt, muss sie ins
  // Bündel. Genau dieser Fallstrick liess qrcode.js schon einmal aus dem
  // Deploy fallen, und seit die Seite nicht mehr in "seiten" oben steht,
  // würde ihn sonst niemand mehr abfangen.
  const skripte = [...new Set([...homepage.matchAll(/<script[^>]+src="(?!https?:)([^"]+)"/g)].map(m => m[1]))];
  const fehlendeSkripte = skripte.filter(j => !wirdKopiert(j));
  check('KRITISCH: jedes eigene Skript, das homepage.html lädt, kommt ins guardops-Bündel',
    fehlendeSkripte.length === 0);
  if (fehlendeSkripte.length) { bad.push('Skript fehlt im guardops-Bündel: ' + fehlendeSkripte.join(', ')); }

  // OP-565: Die Seite darf nicht auf der Testinstanz zurückkehren. Der
  // Upload dort räumt sein Verzeichnis auf -- kommt die cp-Zeile wieder,
  // steht dieselbe Seite wieder unter zwei Adressen.
  check('KRITISCH: homepage.html wird NICHT mehr auf die Testinstanz ausgeliefert',
    !/cp\s+homepage\.html\s+dist\/homepage\.html/.test(workflow));

  // Jede gebündelte HTML-Seite: ihr Stilblatt muss mit, und jeder Verweis
  // auf eine Nachbarseite muss eine Datei treffen, die AUCH im Bündel liegt.
  // Ein Verweis auf eine Seite, die es im Repository gibt, aber nicht auf dem
  // Server, ist live ein 404 -- und lokal fällt genau das nicht auf.
  {
    const seitenImBuendel = [...bauen.matchAll(/^\s*cp\s+(\S+\.html)\s+dist-guardops\/(\S+)/gm)]
      .map(m => ({ quelle: m[1], ziel: m[2].split('/').pop() }));
    const zielNamen = new Set(seitenImBuendel.map(x => x.ziel));
    const fehlendeStile = [], insLeere = [];
    for (const { quelle } of seitenImBuendel) {
      const inhalt = readFileSync(`${WURZEL}/${quelle}`, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
      for (const m of inhalt.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="(?!https?:)([^"]+)"/g)) {
        if (!wirdKopiert(m[1])) { fehlendeStile.push(`${quelle}: ${m[1]}`); }
      }
      for (const m of inhalt.matchAll(/href="(?!https?:|mailto:|#)([a-z0-9_-]+\.html)"/g)) {
        if (!zielNamen.has(m[1])) { insLeere.push(`${quelle}: ${m[1]}`); }
      }
    }
    check('KRITISCH: jedes Stilblatt einer gebündelten Seite kommt mit ins Bündel',
      seitenImBuendel.length >= 3 && fehlendeStile.length === 0);
    if (fehlendeStile.length) { bad.push('Stilblatt fehlt: ' + fehlendeStile.join(', ')); }
    check('KRITISCH: kein Verweis zwischen den gebündelten Seiten zeigt auf eine Datei, die nicht mitgeliefert wird',
      insLeere.length === 0);
    if (insLeere.length) { bad.push('live ein 404: ' + insLeere.join(', ')); }
  }

  check('KRITISCH: die eigene .htaccess und robots.txt der Domain werden mitgeliefert',
    cpZeilen.some(z => z.von === 'htaccess-guardops' && z.nach === 'dist-guardops/.htaccess')
    && cpZeilen.some(z => z.von === 'robots-guardops.txt' && z.nach === 'dist-guardops/robots.txt')
    && existsSync(`${WURZEL}/htaccess-guardops`) && existsSync(`${WURZEL}/robots-guardops.txt`));

  // robots.txt der Verkaufsseite sagt das GEGENTEIL von robots-staging.txt:
  // Sie soll gefunden werden. Ein versehentlich kopiertes "Disallow: /"
  // nähme die Seite lautlos aus jeder Suchmaschine.
  check('KRITISCH: die robots.txt von guardops.ch sperrt die Seite NICHT aus (anders als die der Testinstanz)',
    !/^Disallow:\s*\/\s*$/m.test(readFileSync(`${WURZEL}/robots-guardops.txt`, 'utf8')));

  // DER PUNKT, AN DEM ES TEUER WÜRDE: Auf guardops.ch dürfen keine
  // Datenbank-Zugangsdaten landen. db.php wird dorthin kopiert (mailer.php
  // bindet es ein), aber NUR mit APP_ENV ersetzt -- die __DB_*__-Platzhalter
  // bleiben stehen. Ein sed, das sie dort einsetzte, legte die Zugangsdaten
  // der produktiven Datenbank an einen zweiten Ort.
  check('KRITISCH: in das guardops-Bündel wird KEIN Datenbank-Zugangsdatum eingesetzt',
    !/__DB_(HOST|NAME|USER|PASS)__\|\$EFF_DB[^\n]*dist-guardops/.test(bauen)
    && !/dist-guardops[^\n]*\$EFF_DB_/.test(bauen)
    && /__APP_ENV__[^\n]*dist-guardops\/db\.php/.test(bauen));

  // Und die Gegenprobe dazu im Workflow selbst: ein übersehener Platzhalter
  // darf nicht hochgeladen werden.
  check('KRITISCH: der Bau bricht ab, wenn ein nicht ersetzter Platzhalter im Bündel bleibt',
    /UEBRIG=/.test(bauen) && /::error::[^\n]*Platzhalter/.test(bauen) && /exit 1/.test(bauen));

  // Der Empfänger kommt aus dem Deploy -- in BEIDEN Bündeln.
  check('KRITISCH: der Empfänger der Demo-Anfragen wird in beide Bündel eingesetzt',
    /__DEMO_EMPFAENGER__\|\$EFF_DEMO_EMPFAENGER\|g"\s+dist\/demo_anfrage\.php/.test(workflow)
    && /__DEMO_EMPFAENGER__\|\$EFF_DEMO_EMPFAENGER\|g"\s+dist-guardops\/demo_anfrage\.php/.test(workflow));

  // Eigener Zugang, eigene Secret-NAMEN -- dieselbe Lehre wie bei Staging
  // (ENT-343 Punkt 1): Mit gleichen Namen fiele ein fehlendes Secret still
  // auf ein gleichnamiges Repository-Secret zurück.
  check('KRITISCH: guardops.ch benutzt einen eigenen FTP-Zugang, nicht den des Rapport-Tools',
    /server:\s*\$\{\{\s*env\.EFF_GUARDOPS_FTP_HOST\s*\}\}/.test(laden)
    && /secrets\.GUARDOPS_FTP_HOST/.test(workflow)
    && !/EFF_HOSTPOINT_FTP/.test(laden));

  // Eigenes Postfach fuer die Demo-Mail (ENT-569/OP-569, sop-projekt):
  // getrennt vom Produktions-Postfach, das auch CUPI 24s eigene Kunden-
  // Mails verschickt (ENT-371). Dieselbe Lehre wie beim FTP-Zugang oben --
  // eigene Secret-NAMEN, kein stiller Rueckfall (ENT-343 Punkt 1).
  check('KRITISCH: guardops.ch benutzt ein eigenes SMTP-Postfach, nicht das mit CUPI 24s Kunden-Mails geteilte Produktions-Postfach',
    /__SMTP_HOST__\|\$EFF_GUARDOPS_SMTP_HOST\|g"\s+dist-guardops\/mailer\.php/.test(bauen)
    && /__SMTP_PORT__\|\$EFF_GUARDOPS_SMTP_PORT\|g"\s+dist-guardops\/mailer\.php/.test(bauen)
    && /__SMTP_VERSCHLUESSELUNG__\|\$EFF_GUARDOPS_SMTP_VERSCHLUESSELUNG\|g"\s+dist-guardops\/mailer\.php/.test(bauen)
    && /__SMTP_USER__\|\$EFF_GUARDOPS_SMTP_USER\|g"\s+dist-guardops\/mailer\.php/.test(bauen)
    && /__SMTP_PASSWORD__\|\$EFF_GUARDOPS_SMTP_PASSWORD\|g"\s+dist-guardops\/mailer\.php/.test(bauen)
    && /secrets\.GUARDOPS_SMTP_HOST/.test(workflow)
    && !/EFF_SMTP_HOST/.test(bauen) && !/EFF_SMTP_PASSWORD/.test(bauen));

  // Absenderadresse und -name sind hier feste Literale, kein Secret --
  // info@guardops.ch und "GuardOpS" sind oeffentlich, keine Zugangsdaten
  // (gleiche Einordnung wie bei APP_BASIS_URL, ENT-501).
  check('KRITISCH: Absenderadresse und -name der Demo-Mail sind info@guardops.ch / GuardOpS, fest und nicht aus einem Secret',
    /__SMTP_ABSENDER__\|info@guardops\.ch\|g"\s+dist-guardops\/mailer\.php/.test(bauen)
    && /__SMTP_ABSENDER_NAME__\|GuardOpS\|g"\s+dist-guardops\/mailer\.php/.test(bauen));

  // Das Rapport-Tool selbst bleibt unberuehrt: sein Buendel (dist/) traegt
  // weiterhin die geteilten Produktions-Werte -- sonst zeigten CUPI 24s
  // eigene Offert-Mails ploetzlich den falschen Absender.
  check('KRITISCH: das Rapport-Tool-Buendel (dist/) behaelt seine eigene, unveraenderte SMTP-Identitaet',
    /__SMTP_ABSENDER__\|\$EFF_SMTP_ABSENDER\|g"\s+dist\/mailer\.php/.test(workflow)
    && /__SMTP_ABSENDER_NAME__\|\$EFF_SMTP_ABSENDER_NAME\|g"\s+dist\/mailer\.php/.test(workflow));

  // Fehlen die Secrets, soll der Deploy NICHT abbrechen -- dieselbe Regel
  // wie bei DEMO_EMPFAENGER und GUARDOPS_FTP_*: smtp_konfiguriert() meldet
  // "nicht eingerichtet" (503), statt den ganzen Lauf rot zu faerben.
  check('Fehlende GUARDOPS_SMTP_*-Secrets lassen den Deploy NICHT scheitern',
    !/PFLICHT_FEHLT="\$PFLICHT_FEHLT GUARDOPS_SMTP/.test(workflow));

  // Ein Staging-Lauf hat auf der echten Verkaufsdomain nichts verloren.
  check('KRITISCH: beide guardops-Schritte laufen nur auf Production und nur mit vorhandenem Secret',
    [bauen, laden].every(st =>
      /env\.UMGEBUNG\s*==\s*'production'/.test(st) && /env\.EFF_GUARDOPS_FTP_HOST\s*!=\s*''/.test(st)));
  check('KRITISCH: der Staging-Zweig setzt das guardops-Ziel leer, ohne Rückfall auf die Production-Werte',
    /EFF_GUARDOPS_FTP_HOST=""/.test(workflow)
    && !/EFF_GUARDOPS_FTP_HOST="\$P_GUARDOPS_FTP_HOST"[\s\S]{0,400}STAGING/.test(workflow));

  // "Nicht eingerichtet" darf nicht wie "nichts zu tun" aussehen: Ohne
  // diesen Hinweis wäre ein übersprungener Homepage-Deploy im Protokoll von
  // einem erfolgreichen nicht zu unterscheiden.
  check('KRITISCH: ein übersprungener Homepage-Deploy sagt das ausdrücklich, statt lautlos auszufallen',
    hinweis !== '' && /::notice::/.test(hinweis)
    && /env\.EFF_GUARDOPS_FTP_HOST\s*==\s*''/.test(hinweis));

  // DIESELBE PRÜFUNG WIE AUF DEM RUNNER, NUR HIER. Der Riegel oben
  // ("UEBRIG") läuft erst im Deploy -- und hat Lauf 474 rot gefärbt, weil
  // mailer.php den Platzhalternamen __ANTHROPIC + _API_KEY__ in einem
  // KOMMENTAR erwähnte. Kein Wert, kein Leck, aber der Deploy bricht ab,
  // und gemerkt hat es niemand vorher: Die volle Regression war grün.
  //
  // Darum hier dieselbe Frage an den Quelltext: Jeder Platzhalter in einer
  // Datei, die ins guardops-Bündel geht, muss dort entweder ersetzt werden
  // oder absichtlich stehen bleiben. Ein dritter Fall bricht den Deploy.
  {
    // Was kopiert wird, aus den cp-Zeilen des Bau-Schritts gelesen.
    const quellen = [...bauen.matchAll(/^\s*cp\s+(\S+)\s+dist-guardops\/\S*/gm)]
      .map(m => m[1]).filter(q => !q.includes('*') && /\.(php|html|txt|css)$/.test(q));
    // Was dort ersetzt wird.
    const ersetzt = new Set([...bauen.matchAll(/sed -i "s\|(__[A-Z_]+__)\|/g)].map(m => m[1]));
    // Was absichtlich stehen bleibt -- jeweils mit Grund:
    //   __DB_*__          auf guardops.ch liegt keine Datenbank; ein stehender
    //                     Platzhalter lässt db() laut scheitern statt still
    //                     verbinden (ENT-563 Punkt 7).
    //   __APP_BASIS_URL__ basis_url_pruefen() erkennt ihn und liefert null;
    //                     die Demo-Mail enthält keinen Link auf die Anlage.
    //   __DIR__           PHPs eigene Konstante, kein Platzhalter.
    const absichtlich = /^(__DB_[A-Z]+__|__APP_BASIS_URL__|__DIR__)$/;

    const offen = [];
    for (const q of quellen) {
      if (!existsSync(`${WURZEL}/${q}`)) { offen.push(`${q}: Datei fehlt`); continue; }
      const inhalt = readFileSync(`${WURZEL}/${q}`, 'utf8');
      for (const p of new Set([...inhalt.matchAll(/__[A-Z][A-Z_]{2,}__/g)].map(m => m[0]))) {
        if (!ersetzt.has(p) && !absichtlich.test(p)) { offen.push(`${q}: ${p}`); }
      }
    }
    check('KRITISCH: jeder Platzhalter in einer Datei des guardops-Bündels wird dort ersetzt oder bleibt mit Grund stehen',
      quellen.length >= 5 && offen.length === 0);
    if (offen.length) { bad.push('bricht den Deploy: ' + offen.join(', ')); }
  }

  // OP-566: Eine Adresse, nicht zwei. Beide Hälften müssen zusammenpassen --
  // eine Weiterleitung ohne canonical (oder umgekehrt) lässt die Seite
  // weiterhin zweimal erscheinen, je nachdem wie sie erreicht wird.
  {
    const ht = readFileSync(`${WURZEL}/htaccess-guardops`, 'utf8');
    const kanonisch = (homepage.match(/<link rel="canonical" href="([^"]+)"/) || [])[1] || '';
    const ziel = (ht.match(/RewriteRule \^\(\.\*\)\$ (https:\/\/[a-z0-9.-]+)\//) || [])[1] || '';
    check('KRITISCH: die www-Weiterleitung und die kanonische Adresse der Seite nennen dieselbe Adresse',
      kanonisch !== '' && ziel !== '' && kanonisch.replace(/\/$/, '') === ziel
      && /RewriteCond %\{HTTP_HOST\} \^www\\\./.test(ht) && /\[R=301,L\]/.test(ht));
  }

  // Die beiden Bündel dürfen sich nicht ins Gehege kommen: Der Upload des
  // Rapport-Tools räumt sein Zielverzeichnis auf.
  check('KRITISCH: die beiden Uploads haben verschiedene Quellverzeichnisse',
    /local-dir:\s*\.\/dist\//.test(workflow) && /local-dir:\s*\.\/dist-guardops\//.test(workflow));
}

// ══════════ DER BETREIBER-BEREICH AUF SEINER EIGENEN ADRESSE ═════════
//
// ENT-580: DRITTES Bündel (dist-betreiber/), diesmal mit ECHTER
// Datenbankverbindung -- anders als guardops.ch, wo bewusst keine liegt.
// Geprüft wird wieder gegen das, was betreiber.php und seine Endpunkte
// TATSÄCHLICH einbinden, nicht gegen eine abgeschriebene Liste.
{
  const schritt = (name) => {
    const i = workflow.indexOf(`- name: ${name}`);
    if (i < 0) { return ''; }
    const j = workflow.indexOf('\n      - name:', i + 10);
    return workflow.slice(i, j < 0 ? undefined : j);
  };
  const bauen = schritt('Betreiber-Buendel fuer betreiber.guardops.ch bauen');
  const laden = schritt('Betreiber-Bereich nach betreiber.guardops.ch hochladen (FTPS)');
  const hinweis = schritt('Hinweis, wenn betreiber.guardops.ch noch nicht eingerichtet ist');
  const cpZeilen = [...bauen.matchAll(/^\s*cp\s+(\S+)\s+(\S+)\s*$/gm)]
    .map(m => ({ von: m[1], nach: m[2] }));
  const alsMuster = q => new RegExp('^' + q.split('*')
    .map(x => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$');
  const wirdKopiert = pfad => cpZeilen.some(z => alsMuster(z.von).test(pfad));
  const liegtImBuendel = ziel => cpZeilen.some(z => z.nach === ziel || z.nach === ziel.replace(/[^/]+$/, ''));
  const betreiberHtml = readFileSync(`${WURZEL}/betreiber.html`, 'utf8');

  check('KRITISCH: es gibt einen Schritt, der das Bündel für betreiber.guardops.ch baut, und einen, der es hochlädt',
    bauen !== '' && laden !== '');

  // Auf der eigenen Adresse gehört der Bereich auf "/", nicht auf
  // "/betreiber.html" -- sonst zeigt betreiber.guardops.ch ins Leere.
  check('KRITISCH: betreiber.html wird als index.html ausgeliefert (die Seite liegt auf der Wurzel der Adresse)',
    cpZeilen.some(z => z.von === 'betreiber.html' && z.nach === 'dist-betreiber/index.html'));

  // Aus der Seite abgeleitet: jede Schrift, die betreiber.html per
  // CSS-url() holt.
  const schriften = [...new Set([...betreiberHtml.matchAll(/url\(['"]?(fonts\/[^)'"]+)/g)].map(m => m[1]))];
  const fehlendeSchriften = schriften.filter(f => !wirdKopiert(f));
  check('KRITISCH: jede Schrift, die betreiber.html lädt, wird ins betreiber-Bündel kopiert',
    schriften.length >= 1 && fehlendeSchriften.length === 0);
  if (fehlendeSchriften.length) { bad.push('fehlt im betreiber-Bündel: ' + fehlendeSchriften.join(', ')); }

  // Jeder betreiber_*-Endpunkt im Repository muss im Bündel landen -- sonst
  // meldet die Oberfläche unter der neuen Adresse einen Fehler, sobald sie
  // einen der noch fehlenden Endpunkte aufruft.
  const endpunkte = readdirSync(`${WURZEL}/backend/api`).filter(f => /^betreiber_.*\.php$/.test(f));
  check('KRITISCH: jeder betreiber_*-Endpunkt aus backend/api wird ins betreiber-Bündel kopiert',
    endpunkte.length >= 10 && endpunkte.every(e => wirdKopiert(`backend/api/${e}`)));

  // Die Einbindungen von betreiber.php UND all seinen Endpunkten, aus den
  // Dateien selbst gelesen -- genau die Backend-Dateien, die dieses
  // schlanke Bündel tatsächlich braucht, nicht die rund 30 Dateien des
  // Rapport-Tool-Bündels. betreiber.php selbst bindet nur db.php und
  // zweifaktor.php ein; anmeldung.php, rechte.php, support.php und
  // supportvorgang.php kommen erst über die einzelnen Endpunkte dazu.
  const betreiberPhp = readFileSync(`${WURZEL}/backend/betreiber.php`, 'utf8');
  const endpunktQuellen = endpunkte.map(e => readFileSync(`${WURZEL}/backend/api/${e}`, 'utf8'));
  const noetigeModule = [...new Set(
    [betreiberPhp, ...endpunktQuellen].join('\n')
      .matchAll(/require(?:_once)? __DIR__ \. '\/(?:\.\.\/)?([a-z_]+\.php)'/g))]
    .map(m => m[1])
    .filter(m => m !== 'betreiber.php');
  const fehlendeModule = noetigeModule.filter(m => !liegtImBuendel(`dist-betreiber/${m}`));
  check('KRITISCH: jede Datei, die betreiber.php oder einer seiner Endpunkte einbindet, liegt im betreiber-Bündel',
    noetigeModule.length >= 5 && fehlendeModule.length === 0
    && liegtImBuendel('dist-betreiber/betreiber.php'));
  if (fehlendeModule.length) { bad.push('Einbindung fehlt im betreiber-Bündel: ' + fehlendeModule.join(', ')); }

  // Die zwei öffentlichen Selbstbedienungs-Endpunkte (ENT-601) tragen kein
  // betreiber_-Präfix -- absichtlich, sie laufen ohne Anmeldung -- und
  // fallen darum durch die Prüfung zwei Blöcke oben. Eigene, schmale
  // Prüfung mit derselben Aussage: mitgeliefert, und jede ihrer
  // Einbindungen liegt ebenfalls im Bündel.
  const OEFFENTLICHE_DEMO_ENDPUNKTE = ['demo_anfordern.php', 'demo_erneut_senden.php'];
  check('KRITISCH: die öffentlichen Demo-Endpunkte (ENT-601) werden ins betreiber-Bündel kopiert',
    OEFFENTLICHE_DEMO_ENDPUNKTE.every(e => wirdKopiert(`backend/api/${e}`)));
  const oeffentlicheQuellen = OEFFENTLICHE_DEMO_ENDPUNKTE
    .map(e => readFileSync(`${WURZEL}/backend/api/${e}`, 'utf8'));
  const oeffentlicheModule = [...new Set(
    oeffentlicheQuellen.join('\n')
      .matchAll(/require(?:_once)? __DIR__ \. '\/(?:\.\.\/)?([a-z_]+\.php)'/g))]
    .map(m => m[1]);
  const fehlendeOeffentlicheModule = oeffentlicheModule.filter(m => !liegtImBuendel(`dist-betreiber/${m}`));
  check('KRITISCH: jede Datei, die ein öffentlicher Demo-Endpunkt einbindet, liegt im betreiber-Bündel',
    oeffentlicheModule.length >= 3 && fehlendeOeffentlicheModule.length === 0);
  if (fehlendeOeffentlicheModule.length) {
    bad.push('Einbindung fehlt im betreiber-Bündel (öffentliche Demo-Endpunkte): ' + fehlendeOeffentlicheModule.join(', '));
  }

  check('KRITISCH: die eigene .htaccess und robots.txt der Adresse werden mitgeliefert',
    cpZeilen.some(z => z.von === 'htaccess-betreiber' && z.nach === 'dist-betreiber/.htaccess')
    && cpZeilen.some(z => z.von === 'robots-betreiber.txt' && z.nach === 'dist-betreiber/robots.txt')
    && existsSync(`${WURZEL}/htaccess-betreiber`) && existsSync(`${WURZEL}/robots-betreiber.txt`));

  // Anders als guardops.ch: Diese Adresse SOLL nicht gefunden werden
  // (ENT-580) -- dasselbe "Disallow: /" wie bei der Testinstanz und der
  // Demo, nicht das offene "Disallow:" der Verkaufsseite.
  check('KRITISCH: die robots.txt von betreiber.guardops.ch sperrt die Seite aus',
    /^Disallow:\s*\/\s*$/m.test(readFileSync(`${WURZEL}/robots-betreiber.txt`, 'utf8')));

  // Die Sperrliste der .htaccess muss genau die Backend-Dateien treffen,
  // die dieses Bündel tatsächlich mitbringt -- weder mehr (toter Verweis)
  // noch weniger (eine ungeschützte Datei mit echten DB-Zugangsdaten).
  {
    const ht = readFileSync(`${WURZEL}/htaccess-betreiber`, 'utf8');
    const gesperrt = new Set((ht.match(/<FilesMatch "\^\(([a-z_|]+)\)\\\.php\$">/) || [])[1]?.split('|') ?? []);
    const mitgeliefertePhp = cpZeilen
      .filter(z => z.nach.startsWith('dist-betreiber/') && z.nach.endsWith('.php') && !z.nach.startsWith('dist-betreiber/api/'))
      .map(z => z.nach.replace('dist-betreiber/', '').replace(/\.php$/, ''));
    const ungeschuetzt = mitgeliefertePhp.filter(m => !gesperrt.has(m));
    check('KRITISCH: die .htaccess von betreiber.guardops.ch sperrt jede mitgelieferte Backend-Datei gegen direkten Abruf',
      mitgeliefertePhp.length >= 5 && ungeschuetzt.length === 0);
    if (ungeschuetzt.length) { bad.push('ungeschützt im betreiber-Bündel: ' + ungeschuetzt.join(', ')); }
  }

  // DER PUNKT, AN DEM ES TEUER WÜRDE, WENN ES FEHLTE: Anders als bei
  // guardops.ch braucht dieses Bündel eine ECHTE Datenbankverbindung
  // (betreiber_db() fällt auf db() zurück, ENT-519) -- dieselben
  // Zugangsdaten wie das Rapport-Tool, damit betreiber.php tatsächlich
  // etwas findet.
  check('KRITISCH: in das betreiber-Bündel werden dieselben Produktions-Datenbank-Zugangsdaten eingesetzt wie ins Rapport-Tool',
    /__DB_HOST__\|\$EFF_DB_HOST\|g"\s+dist-betreiber\/db\.php/.test(bauen)
    && /__DB_NAME__\|\$EFF_DB_NAME\|g"\s+dist-betreiber\/db\.php/.test(bauen)
    && /__DB_USER__\|\$EFF_DB_USER\|g"\s+dist-betreiber\/db\.php/.test(bauen)
    && /__DB_PASS__\|\$EFF_DB_PASSWORD\|g"\s+dist-betreiber\/db\.php/.test(bauen));

  // Eigene Adresse (ENT-501, ENT-580): festes Literal, keine Environment-
  // Variable und kein Secret -- dieselbe Einordnung wie bei den
  // GuardOpS-Literalen im guardops-Bündel.
  check('KRITISCH: betreiber.guardops.ch bekommt seine eigene, feste APP_BASIS_URL',
    /__APP_BASIS_URL__\|https:\/\/betreiber\.guardops\.ch\|g"\s+dist-betreiber\/db\.php/.test(bauen));

  // Dieselbe Gegenprobe wie beim guardops-Bündel: ein übersehener
  // Platzhalter darf hier nicht hochgeladen werden. Anders als dort bleibt
  // hier KEINE Familie absichtlich stehen (kein __DIR__ ausgenommen).
  check('KRITISCH: der Bau bricht ab, wenn ein nicht ersetzter Platzhalter im betreiber-Bündel bleibt',
    /UEBRIG=/.test(bauen) && /::error::[^\n]*Platzhalter/.test(bauen) && /exit 1/.test(bauen));

  // Eigener FTP-Zugang, eigene Secret-NAMEN -- weder der des Rapport-Tools
  // noch der von guardops.ch (ENT-343 Punkt 1).
  check('KRITISCH: betreiber.guardops.ch benutzt einen eigenen FTP-Zugang, weder den des Rapport-Tools noch den von guardops.ch',
    /server:\s*\$\{\{\s*env\.EFF_BETREIBER_FTP_HOST\s*\}\}/.test(laden)
    && /secrets\.BETREIBER_FTP_HOST/.test(workflow)
    && !/EFF_HOSTPOINT_FTP/.test(laden) && !/EFF_GUARDOPS_FTP/.test(laden));

  // Ein Staging- oder Demo-Lauf hat auf dieser Adresse nichts verloren.
  check('KRITISCH: beide betreiber-Schritte laufen nur auf Production und nur mit vorhandenem Secret',
    [bauen, laden].every(st =>
      /env\.UMGEBUNG\s*==\s*'production'/.test(st) && /env\.EFF_BETREIBER_FTP_HOST\s*!=\s*''/.test(st)));
  check('KRITISCH: der Staging-Zweig setzt das betreiber-Ziel leer, ohne Rückfall auf die Production-Werte',
    /EFF_BETREIBER_FTP_HOST=""/.test(workflow)
    && !/EFF_BETREIBER_FTP_HOST="\$P_BETREIBER_FTP_HOST"[\s\S]{0,400}STAGING/.test(workflow));

  check('KRITISCH: ein übersprungener Betreiber-Deploy sagt das ausdrücklich, statt lautlos auszufallen',
    hinweis !== '' && /::notice::/.test(hinweis)
    && /env\.EFF_BETREIBER_FTP_HOST\s*==\s*''/.test(hinweis));

  // Dieselbe Frage an den Quelltext wie beim guardops-Bündel: Jeder
  // Platzhalter in einer Datei, die ins betreiber-Bündel geht, muss dort
  // entweder ersetzt werden oder mit Grund stehen bleiben.
  {
    const quellen = [...bauen.matchAll(/^\s*cp\s+(\S+)\s+dist-betreiber\/\S*/gm)]
      .map(m => m[1]).filter(q => !q.includes('*') && /\.(php|html|txt)$/.test(q));
    const endpunktPfade = endpunkte.map(e => `backend/api/${e}`);
    for (const p of endpunktPfade) { quellen.push(p); }
    const ersetzt = new Set([...bauen.matchAll(/sed -i "s\|(__[A-Z_]+__)\|/g)].map(m => m[1]));
    // __BETREIBER_DB_*__ (backend/betreiber.php, OP-518) und seit OP-526
    // auch __MANDANT_SECRETS__ (dieselbe Datei) werden hier oben per sed
    // ersetzt -- notfalls mit einer leeren Zeichenkette, wenn die
    // zugehoerigen Secrets noch nicht gesetzt sind; betreiber_db() und
    // mandant_secret() fallen dann bewusst auf ihren jeweiligen Normalfall
    // zurueck (siehe Kommentare dort). Beide stehen darum NICHT mehr in
    // dieser Ausnahmeliste, sondern muessen ueber "ersetzt" oben gefunden
    // werden wie jeder andere Platzhalter. __DIR__ ist PHPs eigene
    // Konstante, kein Platzhalter.
    const absichtlich = /^__DIR__$/;
    const offen = [];
    for (const q of quellen) {
      if (!existsSync(`${WURZEL}/${q}`)) { offen.push(`${q}: Datei fehlt`); continue; }
      const inhalt = readFileSync(`${WURZEL}/${q}`, 'utf8');
      for (const p of new Set([...inhalt.matchAll(/__[A-Z][A-Z_]{2,}__/g)].map(m => m[0]))) {
        if (!ersetzt.has(p) && !absichtlich.test(p)) { offen.push(`${q}: ${p}`); }
      }
    }
    check('KRITISCH: jeder Platzhalter in einer Datei des betreiber-Bündels wird dort ersetzt',
      quellen.length >= 5 && offen.length === 0);
    if (offen.length) { bad.push('bricht den Deploy: ' + offen.join(', ')); }
  }

  // Alle drei Bündel müssen sich gegenseitig aus dem Weg bleiben.
  check('KRITISCH: alle drei Uploads haben verschiedene Quellverzeichnisse',
    /local-dir:\s*\.\/dist\//.test(workflow) && /local-dir:\s*\.\/dist-guardops\//.test(workflow)
    && /local-dir:\s*\.\/dist-betreiber\//.test(workflow));
}

// ENT-580: VIERTES Bündel (dist-portal/), zweite Etappe des Umzugs nach dem
// Betreiber-Bereich. Wie dist-betreiber mit ECHTER Datenbankverbindung,
// zusätzlich mit ECHTEN SMTP-Zugangsdaten (das Kundenportal verschickt
// Zugangslink-/Passwort-Mails). Geprüft wird wieder gegen das, was
// kundenportal.php und seine Endpunkte TATSÄCHLICH einbinden.
{
  const schritt = (name) => {
    const i = workflow.indexOf(`- name: ${name}`);
    if (i < 0) { return ''; }
    const j = workflow.indexOf('\n      - name:', i + 10);
    return workflow.slice(i, j < 0 ? undefined : j);
  };
  const bauen = schritt('Portal-Buendel fuer portal.guardops.ch bauen');
  const laden = schritt('Kundenportal nach portal.guardops.ch hochladen (FTPS)');
  const hinweis = schritt('Hinweis, wenn portal.guardops.ch noch nicht eingerichtet ist');
  const cpZeilen = [...bauen.matchAll(/^\s*cp\s+(\S+)\s+(\S+)\s*$/gm)]
    .map(m => ({ von: m[1], nach: m[2] }));
  const alsMuster = q => new RegExp('^' + q.split('*')
    .map(x => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$');
  const wirdKopiert = pfad => cpZeilen.some(z => alsMuster(z.von).test(pfad));
  const liegtImBuendel = ziel => cpZeilen.some(z => z.nach === ziel || z.nach === ziel.replace(/[^/]+$/, ''));
  const portalHtml = readFileSync(`${WURZEL}/portal.html`, 'utf8');

  check('KRITISCH: es gibt einen Schritt, der das Bündel für portal.guardops.ch baut, und einen, der es hochlädt',
    bauen !== '' && laden !== '');

  // Auf der eigenen Adresse gehört das Portal auf "/", nicht auf
  // "/portal.html" -- sonst zeigt portal.guardops.ch ins Leere.
  check('KRITISCH: portal.html wird als index.html ausgeliefert (die Seite liegt auf der Wurzel der Adresse)',
    cpZeilen.some(z => z.von === 'portal.html' && z.nach === 'dist-portal/index.html'));

  // Aus der Seite abgeleitet: Hintergrundfoto/-video der Anmeldemaske
  // (url()/<source> in portal.html). Keine eigene Schriftdatei -- anders
  // als betreiber.html nutzt portal.html den System-Schriftstapel.
  const bilder = [...new Set([
    ...[...portalHtml.matchAll(/url\(['"]?(img\/[^)'"]+)/g)].map(m => m[1]),
    ...[...portalHtml.matchAll(/<source\s+src="(img\/[^"]+)"/g)].map(m => m[1]),
  ])];
  const fehlendeBilder = bilder.filter(f => !wirdKopiert(f));
  check('KRITISCH: jedes Hintergrundbild/-video, das portal.html lädt, wird ins portal-Bündel kopiert',
    bilder.length >= 2 && fehlendeBilder.length === 0);
  if (fehlendeBilder.length) { bad.push('fehlt im portal-Bündel: ' + fehlendeBilder.join(', ')); }

  // Jeder portal_*-Endpunkt im Repository muss im Bündel landen.
  const endpunkte = readdirSync(`${WURZEL}/backend/api`).filter(f => /^portal_.*\.php$/.test(f));
  check('KRITISCH: jeder portal_*-Endpunkt aus backend/api wird ins portal-Bündel kopiert',
    endpunkte.length >= 10 && endpunkte.every(e => wirdKopiert(`backend/api/${e}`)));

  // Die Einbindungen von kundenportal.php UND all seinen Endpunkten, aus
  // den Dateien selbst gelesen -- genau die Backend-Dateien, die dieses
  // schlanke Bündel tatsächlich braucht.
  const kundenportalPhp = readFileSync(`${WURZEL}/backend/kundenportal.php`, 'utf8');
  const endpunktQuellen = endpunkte.map(e => readFileSync(`${WURZEL}/backend/api/${e}`, 'utf8'));
  const noetigeModule = [...new Set(
    [kundenportalPhp, ...endpunktQuellen].join('\n')
      .matchAll(/require(?:_once)? __DIR__ \. '\/(?:\.\.\/)?([a-z_]+\.php)'/g))]
    .map(m => m[1])
    .filter(m => m !== 'kundenportal.php');
  const fehlendeModule = noetigeModule.filter(m => !liegtImBuendel(`dist-portal/${m}`));
  check('KRITISCH: jede Datei, die kundenportal.php oder einer seiner Endpunkte einbindet, liegt im portal-Bündel',
    noetigeModule.length >= 3 && fehlendeModule.length === 0
    && liegtImBuendel('dist-portal/kundenportal.php'));
  if (fehlendeModule.length) { bad.push('Einbindung fehlt im portal-Bündel: ' + fehlendeModule.join(', ')); }

  check('KRITISCH: die eigene .htaccess und robots.txt der Adresse werden mitgeliefert',
    cpZeilen.some(z => z.von === 'htaccess-portal' && z.nach === 'dist-portal/.htaccess')
    && cpZeilen.some(z => z.von === 'robots-portal.txt' && z.nach === 'dist-portal/robots.txt')
    && existsSync(`${WURZEL}/htaccess-portal`) && existsSync(`${WURZEL}/robots-portal.txt`));

  // Anders als guardops.ch: Diese Adresse SOLL nicht gefunden werden
  // (ENT-580) -- dasselbe "Disallow: /" wie beim Betreiber-Bereich.
  check('KRITISCH: die robots.txt von portal.guardops.ch sperrt die Seite aus',
    /^Disallow:\s*\/\s*$/m.test(readFileSync(`${WURZEL}/robots-portal.txt`, 'utf8')));

  // Die Sperrliste der .htaccess muss genau die Backend-Dateien treffen,
  // die dieses Bündel tatsächlich mitbringt.
  {
    const ht = readFileSync(`${WURZEL}/htaccess-portal`, 'utf8');
    const gesperrt = new Set((ht.match(/<FilesMatch "\^\(([a-z_|]+)\)\\\.php\$">/) || [])[1]?.split('|') ?? []);
    const mitgeliefertePhp = cpZeilen
      .filter(z => z.nach.startsWith('dist-portal/') && z.nach.endsWith('.php') && !z.nach.startsWith('dist-portal/api/'))
      .map(z => z.nach.replace('dist-portal/', '').replace(/\.php$/, ''));
    const ungeschuetzt = mitgeliefertePhp.filter(m => !gesperrt.has(m));
    check('KRITISCH: die .htaccess von portal.guardops.ch sperrt jede mitgelieferte Backend-Datei gegen direkten Abruf',
      mitgeliefertePhp.length >= 3 && ungeschuetzt.length === 0);
    if (ungeschuetzt.length) { bad.push('ungeschützt im portal-Bündel: ' + ungeschuetzt.join(', ')); }
  }

  // ECHTE Datenbankverbindung -- das Kundenportal ist Kernbestandteil
  // desselben Tools, keine Ausnahme wie beim Betreiber-Bereich/OP-518.
  check('KRITISCH: in das portal-Bündel werden dieselben Produktions-Datenbank-Zugangsdaten eingesetzt wie ins Rapport-Tool',
    /__DB_HOST__\|\$EFF_DB_HOST\|g"\s+dist-portal\/db\.php/.test(bauen)
    && /__DB_NAME__\|\$EFF_DB_NAME\|g"\s+dist-portal\/db\.php/.test(bauen)
    && /__DB_USER__\|\$EFF_DB_USER\|g"\s+dist-portal\/db\.php/.test(bauen)
    && /__DB_PASS__\|\$EFF_DB_PASSWORD\|g"\s+dist-portal\/db\.php/.test(bauen));

  // ECHTE Produktions-SMTP-Werte -- dasselbe Postfach, über das das
  // Kundenportal seine Zugangslink-/Passwort-Mails schon heute verschickt.
  // Kein eigenes Postfach wie beim guardops-Bündel.
  check('KRITISCH: in das portal-Bündel werden dieselben Produktions-SMTP-Zugangsdaten eingesetzt wie ins Rapport-Tool',
    /__SMTP_HOST__\|\$EFF_SMTP_HOST\|g"\s+dist-portal\/mailer\.php/.test(bauen)
    && /__SMTP_USER__\|\$EFF_SMTP_USER\|g"\s+dist-portal\/mailer\.php/.test(bauen)
    && /__SMTP_PASSWORD__\|\$EFF_SMTP_PASSWORD\|g"\s+dist-portal\/mailer\.php/.test(bauen));

  // Eigene Adresse (ENT-501, ENT-580): festes Literal.
  check('KRITISCH: portal.guardops.ch bekommt seine eigene, feste APP_BASIS_URL',
    /__APP_BASIS_URL__\|https:\/\/portal\.guardops\.ch\|g"\s+dist-portal\/db\.php/.test(bauen));

  // Kartenausschnitt der Rundgänge braucht denselben Maps-Schlüssel wie das
  // Rapport-Tool.
  check('KRITISCH: portal.guardops.ch bekommt den Maps-Schlüssel für den Kartenausschnitt der Rundgänge',
    /__MAPS_JS_KEY__\|\$EFF_MAPS_JS_KEY\|g"\s+dist-portal\/index\.html/.test(bauen));

  check('KRITISCH: der Bau bricht ab, wenn ein nicht ersetzter Platzhalter im portal-Bündel bleibt',
    /UEBRIG=/.test(bauen) && /::error::[^\n]*Platzhalter/.test(bauen) && /exit 1/.test(bauen));

  // Eigener FTP-Zugang, eigene Secret-NAMEN.
  check('KRITISCH: portal.guardops.ch benutzt einen eigenen FTP-Zugang, weder den des Rapport-Tools noch den von guardops.ch/betreiber.guardops.ch',
    /server:\s*\$\{\{\s*env\.EFF_PORTAL_FTP_HOST\s*\}\}/.test(laden)
    && /secrets\.PORTAL_FTP_HOST/.test(workflow)
    && !/EFF_HOSTPOINT_FTP/.test(laden) && !/EFF_GUARDOPS_FTP/.test(laden) && !/EFF_BETREIBER_FTP/.test(laden));

  // Ein Staging- oder Demo-Lauf hat auf dieser Adresse nichts verloren.
  check('KRITISCH: beide portal-Schritte laufen nur auf Production und nur mit vorhandenem Secret',
    [bauen, laden].every(st =>
      /env\.UMGEBUNG\s*==\s*'production'/.test(st) && /env\.EFF_PORTAL_FTP_HOST\s*!=\s*''/.test(st)));
  check('KRITISCH: der Staging-Zweig setzt das portal-Ziel leer, ohne Rückfall auf die Production-Werte',
    /EFF_PORTAL_FTP_HOST=""/.test(workflow)
    && !/EFF_PORTAL_FTP_HOST="\$P_PORTAL_FTP_HOST"[\s\S]{0,400}STAGING/.test(workflow));

  check('KRITISCH: ein übersprungener Portal-Deploy sagt das ausdrücklich, statt lautlos auszufallen',
    hinweis !== '' && /::notice::/.test(hinweis)
    && /env\.EFF_PORTAL_FTP_HOST\s*==\s*''/.test(hinweis));

  // Jeder Platzhalter in einer Datei, die ins portal-Bündel geht, muss dort
  // entweder ersetzt werden oder mit Grund stehen bleiben (hier: keine
  // absichtlich offenen Platzhalter, anders als beim betreiber-Bündel).
  {
    const quellen = [...bauen.matchAll(/^\s*cp\s+(\S+)\s+dist-portal\/\S*/gm)]
      .map(m => m[1]).filter(q => !q.includes('*') && /\.(php|html|txt)$/.test(q));
    const endpunktPfade = endpunkte.map(e => `backend/api/${e}`);
    for (const p of endpunktPfade) { quellen.push(p); }
    const ersetzt = new Set([...bauen.matchAll(/sed -i "s\|(__[A-Z_]+__)\|/g)].map(m => m[1]));
    const absichtlich = /^__DIR__$/;
    const offen = [];
    for (const q of quellen) {
      if (!existsSync(`${WURZEL}/${q}`)) { offen.push(`${q}: Datei fehlt`); continue; }
      const inhalt = readFileSync(`${WURZEL}/${q}`, 'utf8');
      for (const p of new Set([...inhalt.matchAll(/__[A-Z][A-Z_]{2,}__/g)].map(m => m[0]))) {
        if (!ersetzt.has(p) && !absichtlich.test(p)) { offen.push(`${q}: ${p}`); }
      }
    }
    check('KRITISCH: jeder Platzhalter in einer Datei des portal-Bündels wird dort ersetzt',
      quellen.length >= 3 && offen.length === 0);
    if (offen.length) { bad.push('bricht den Deploy: ' + offen.join(', ')); }
  }

  // Alle vier Bündel müssen sich gegenseitig aus dem Weg bleiben.
  check('KRITISCH: alle vier Uploads haben verschiedene Quellverzeichnisse',
    /local-dir:\s*\.\/dist\//.test(workflow) && /local-dir:\s*\.\/dist-guardops\//.test(workflow)
    && /local-dir:\s*\.\/dist-betreiber\//.test(workflow) && /local-dir:\s*\.\/dist-portal\//.test(workflow));
}

// ══════════ CUPI 24 AUF IHRER EIGENEN ADRESSE ═══════════════════════════
//
// ENT-589: FÜNFTES Bündel (dist-cupi24/) -- und ANDERS als die schlanken
// betreiber-/portal-Bündel oben keine Teilmenge, sondern der VOLLE
// Dateiumfang des Rapport-Tools (Cockpit, Waechter-App, Kundenportal,
// Betreiber-Bereich), weil CUPI 24 das komplette Werkzeug nutzt. Geprüft
// wird deshalb nicht gegen eine eigene, abgeschriebene Liste, sondern GEGEN
// DEN HAUPTSCHRITT SELBST ("Platzhalter durch echte Werte ersetzen", der
// dist/ baut): jede Datei, die dort nach dist/ kopiert wird, muss auch im
// cupi24-Schritt landen, und umgekehrt keine zusätzliche -- sonst laufen
// die beiden Kopierlisten irgendwann still auseinander.
{
  const schritt = (name) => {
    const i = workflow.indexOf(`- name: ${name}`);
    if (i < 0) { return ''; }
    const j = workflow.indexOf('\n      - name:', i + 10);
    return workflow.slice(i, j < 0 ? undefined : j);
  };
  const hauptschritt = schritt('Platzhalter durch echte Werte ersetzen');
  const bauen = schritt('Rapport-Tool-Buendel fuer cupi24.guardops.ch bauen');
  const laden = schritt('Rapport-Tool nach cupi24.guardops.ch hochladen (FTPS)');
  const hinweis = schritt('Hinweis, wenn cupi24.guardops.ch noch nicht eingerichtet ist');

  check('KRITISCH: es gibt einen Schritt, der das Bündel für cupi24.guardops.ch baut, und einen, der es hochlädt',
    hauptschritt !== '' && bauen !== '' && laden !== '');

  // Jede "cp QUELLE ZIEL"-Zeile aus beiden Schritten, ZIEL relativ zum
  // jeweiligen dist-Ordner -- so lassen sich beide Listen direkt
  // gegeneinander abgleichen, unabhängig von Kommentaren oder Reihenfolge.
  const zielRelativ = (text, praefix) => [...text.matchAll(/^\s*cp\s+(\S+)\s+(\S+)\s*$/gm)]
    .map(m => m[2])
    .filter(z => z.startsWith(praefix))
    .map(z => z.slice(praefix.length));

  const hauptZiele  = new Set(zielRelativ(hauptschritt, 'dist/'));
  const cupi24Ziele = new Set(zielRelativ(bauen, 'dist-cupi24/'));

  // robots.txt ist im Hauptschritt ausschliesslich Teil des
  // "if UMGEBUNG = demo"-Zweigs (Production liefert dort gar keine aus) --
  // der cupi24-Schritt läuft nie in Demo (siehe Gate weiter unten), braucht
  // sie also folgerichtig nicht. Einzige bewusste Ausnahme von der
  // Eins-zu-eins-Forderung, mit Begründung, nicht stillschweigend.
  const fehltInCupi24 = [...hauptZiele].filter(z => !cupi24Ziele.has(z) && z !== 'robots.txt');
  const zusaetzlichInCupi24 = [...cupi24Ziele].filter(z => !hauptZiele.has(z));

  check('KRITISCH: jede Datei, die der Hauptschritt nach dist/ kopiert, landet auch im cupi24-Bündel (voller Dateiumfang, ENT-589)',
    hauptZiele.size >= 20 && fehltInCupi24.length === 0);
  if (fehltInCupi24.length) { bad.push('fehlt im cupi24-Bündel: ' + fehltInCupi24.join(', ')); }

  check('KRITISCH: das cupi24-Bündel kopiert keine Datei, die der Hauptschritt nicht auch kopiert (sonst laufen die Listen auseinander)',
    zusaetzlichInCupi24.length === 0);
  if (zusaetzlichInCupi24.length) { bad.push('nur im cupi24-Bündel, nicht im Hauptschritt: ' + zusaetzlichInCupi24.join(', ')); }

  check('KRITISCH: die eigene .htaccess der Adresse wird mitgeliefert',
    cupi24Ziele.has('.htaccess')
    && /cp\s+htaccess-cupi24\s+dist-cupi24\/\.htaccess/.test(bauen)
    && existsSync(`${WURZEL}/htaccess-cupi24`));

  // Die Sperrliste der .htaccess muss genau die Backend-Dateien treffen,
  // die dieses Bündel tatsächlich direkt unter dist-cupi24/ mitbringt (nicht
  // unter dist-cupi24/api/, die Regel greift auf den Dateinamen).
  {
    const htC = readFileSync(`${WURZEL}/htaccess-cupi24`, 'utf8');
    const gesperrt = new Set((htC.match(/<FilesMatch "\^\(([a-z_|]+)\)\\\.php\$">/) || [])[1]?.split('|') ?? []);
    const mitgeliefertePhp = [...bauen.matchAll(/^\s*cp\s+(\S+)\s+(dist-cupi24\/\S+\.php)\s*$/gm)]
      .map(m => m[2])
      .filter(z => !z.startsWith('dist-cupi24/api/'))
      .map(z => z.replace('dist-cupi24/', '').replace(/\.php$/, ''));
    const ungeschuetzt = mitgeliefertePhp.filter(m => !gesperrt.has(m));
    check('KRITISCH: die .htaccess von cupi24.guardops.ch sperrt jede mitgelieferte Backend-Hilfsdatei gegen direkten Abruf',
      mitgeliefertePhp.length >= 15 && ungeschuetzt.length === 0);
    if (ungeschuetzt.length) { bad.push('ungeschützt im cupi24-Bündel: ' + ungeschuetzt.join(', ')); }
  }

  // ECHTE Produktions-Datenbank -- dieselben Werte wie der Hauptschritt
  // (EFF_DB_*), weil CUPI 24 der Bestandsmandant ist und keine eigene
  // Datenbank braucht (mandant_db() faellt fuer die "standardverbindung"
  // auf db() zurueck, backend/betreiber.php).
  check('KRITISCH: in das cupi24-Bündel werden dieselben Produktions-Datenbank-Zugangsdaten eingesetzt wie ins Rapport-Tool',
    /__DB_HOST__\|\$EFF_DB_HOST\|g"\s+dist-cupi24\/db\.php/.test(bauen)
    && /__DB_NAME__\|\$EFF_DB_NAME\|g"\s+dist-cupi24\/db\.php/.test(bauen)
    && /__DB_USER__\|\$EFF_DB_USER\|g"\s+dist-cupi24\/db\.php/.test(bauen)
    && /__DB_PASS__\|\$EFF_DB_PASSWORD\|g"\s+dist-cupi24\/db\.php/.test(bauen));

  // Eigene Adresse (ENT-501, ENT-589): festes Literal, keine Environment-
  // Variable und kein Secret -- und bewusst NICHT über die globale
  // EFF_APP_BASIS_URL (die trägt weiterhin die alte Adresse für den
  // Hauptschritt), sondern eine lokale Ersetzung nur für dieses Bündel.
  check('KRITISCH: cupi24.guardops.ch bekommt seine eigene, feste APP_BASIS_URL, unabhängig von der des Hauptschritts',
    /__APP_BASIS_URL__\|https:\/\/cupi24\.guardops\.ch\|g"\s+dist-cupi24\/db\.php/.test(bauen));

  // ECHTES Produktions-Postfach -- dasselbe wie der Hauptschritt, kein
  // eigenes wie beim guardops-Bündel: CUPI 24 ist Mandantin desselben
  // Kernprodukts, keine separate Marketingseite.
  check('KRITISCH: in das cupi24-Bündel werden dieselben Produktions-SMTP-Zugangsdaten eingesetzt wie ins Rapport-Tool',
    /__SMTP_HOST__\|\$EFF_SMTP_HOST\|g"\s+dist-cupi24\/mailer\.php/.test(bauen)
    && /__SMTP_USER__\|\$EFF_SMTP_USER\|g"\s+dist-cupi24\/mailer\.php/.test(bauen)
    && /__SMTP_PASSWORD__\|\$EFF_SMTP_PASSWORD\|g"\s+dist-cupi24\/mailer\.php/.test(bauen));

  check('KRITISCH: der Bau bricht ab, wenn ein nicht ersetzter Platzhalter im cupi24-Bündel bleibt',
    /UEBRIG=/.test(bauen) && /::error::[^\n]*Platzhalter/.test(bauen) && /exit 1/.test(bauen));

  // DIESELBE PRÜFUNG WIE AUF DEM RUNNER, NUR HIER (vgl. der guardops-Block
  // weiter oben, der Lauf 474 zur Lehre hat). Lauf 521 hat dieselbe Lehre
  // hier wiederholt: eine blosse Erwähnung eines Platzhalternamens in einem
  // Kommentar (push.php: __DB_HOST__, demo_reset.php:
  // __PUSH_CRON_SCHLUESSEL__, betreiber.php: __DB_PASS_MANDANT_2__) hat den
  // Deploy abgebrochen, obwohl die volle Regression grün war -- der
  // UEBRIG-Riegel oben läuft erst im echten Runner. Anders als beim
  // guardops-Block kopiert dieser Schritt auch über Wildcards
  // (backend/api/*.php, handbuch/*), darum werden die hier expandiert statt
  // übersprungen.
  {
    const cpZeilenCupi = [...bauen.matchAll(/^\s*cp\s+(\S+)\s+(dist-cupi24\/\S*)\s*$/gm)]
      .map(m => ({ von: m[1], nach: m[2] }));
    const alsMusterCupi = m => new RegExp('^' + m.split('*')
      .map(x => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
    // { quelle, ziel } -- ZIEL bleibt erhalten, weil die Ersetzung unten
    // pro ZIELDATEI gilt (sed -i wirkt nur auf die eine genannte Datei).
    // Ohne diese Zuordnung würde ein "sed ... db.php" fälschlich auch eine
    // blosse Kommentar-Erwähnung desselben Platzhalters in push.php decken
    // -- genau die Lücke, die Lauf 521 durchgelassen hat.
    const quellenCupi = [];
    for (const { von, nach } of cpZeilenCupi) {
      if (!von.includes('*')) { quellenCupi.push({ quelle: von, ziel: nach }); continue; }
      const schraegstrich = von.lastIndexOf('/');
      const verz = von.slice(0, schraegstrich);
      const muster = alsMusterCupi(von.slice(schraegstrich + 1));
      if (!existsSync(`${WURZEL}/${verz}`)) { continue; }
      for (const datei of readdirSync(`${WURZEL}/${verz}`)) {
        if (muster.test(datei)) { quellenCupi.push({ quelle: `${verz}/${datei}`, ziel: `${nach}${datei}` }); }
      }
    }
    const textDateienCupi = quellenCupi.filter(q => /\.(php|html|js|css|txt|json)$/.test(q.quelle));
    // Platzhalter je ZIELDATEI, nicht global -- derselbe sed-Aufruf betrifft
    // nur die eine genannte Datei.
    const ersetztJeZiel = new Map();
    for (const m of bauen.matchAll(/sed -i "s\|(__[A-Z][A-Z0-9_]*__)\|[^"]*\|g"\s+(\S+)/g)) {
      const [, platzhalter, ziel] = m;
      if (!ersetztJeZiel.has(ziel)) { ersetztJeZiel.set(ziel, new Set()); }
      ersetztJeZiel.get(ziel).add(platzhalter);
    }
    // __MANDANT_SECRETS__ wird seit OP-526 auch hier per sed ersetzt (siehe
    // Kommentar beim betreiber-Bündel oben). Zwei bleiben aus:
    //   __DIR__          PHPs eigene Konstante, kein Platzhalter.
    //   __MAPS_IOS_KEY__ der Schlüssel der NATIVEN Karte (ENT-609). Er
    //                    gehört ins App-Bündel und wird dort von
    //                    aufs-handy.sh eingesetzt; die Web-Fassung nimmt
    //                    ihn nie in die Hand und zeichnet weiterhin mit
    //                    der JavaScript-Karte. Ihn hier einzusetzen hiesse,
    //                    einen Schlüssel zu veröffentlichen, den die Seite
    //                    gar nicht braucht. Dass der Platzhalter stehen
    //                    bleibt, ist im Code abgefangen:
    //                    mapsSchluesselTauglich() erkennt ihn.
    const absichtlichCupi = /^(__DIR__|__MAPS_IOS_KEY__)$/;

    const offenCupi = [];
    for (const { quelle, ziel } of textDateienCupi) {
      if (!existsSync(`${WURZEL}/${quelle}`)) { offenCupi.push(`${quelle}: Datei fehlt`); continue; }
      const inhalt = readFileSync(`${WURZEL}/${quelle}`, 'utf8');
      const ersetztHier = ersetztJeZiel.get(ziel) ?? new Set();
      for (const p of new Set([...inhalt.matchAll(/__[A-Z][A-Z0-9_]*__/g)].map(m => m[0]))) {
        if (!ersetztHier.has(p) && !absichtlichCupi.test(p)) { offenCupi.push(`${ziel}: ${p}`); }
      }
    }
    check('KRITISCH: jeder Platzhalter in jeder Datei des cupi24-Bündels (auch über Wildcards kopierte) wird GENAU IN DIESER DATEI ersetzt oder bleibt mit Grund stehen',
      textDateienCupi.length >= 40 && offenCupi.length === 0);
    if (offenCupi.length) { bad.push('bricht den cupi24-Deploy: ' + offenCupi.join(', ')); }
  }

  // Eigener FTP-Zugang, eigene Secret-NAMEN -- keiner der vier bestehenden.
  check('KRITISCH: cupi24.guardops.ch benutzt einen eigenen FTP-Zugang, keinen der vier bestehenden Bündel',
    /server:\s*\$\{\{\s*env\.EFF_CUPI24_FTP_HOST\s*\}\}/.test(laden)
    && /secrets\.CUPI24_FTP_HOST/.test(workflow)
    && !/EFF_HOSTPOINT_FTP/.test(laden) && !/EFF_GUARDOPS_FTP/.test(laden)
    && !/EFF_BETREIBER_FTP/.test(laden) && !/EFF_PORTAL_FTP/.test(laden));

  // Ein Staging- oder Demo-Lauf hat auf dieser Adresse nichts verloren --
  // dieselbe Begründung wie bei den vier anderen Bündeln.
  check('KRITISCH: beide cupi24-Schritte laufen nur auf Production und nur mit vorhandenem Secret',
    [bauen, laden].every(st =>
      /env\.UMGEBUNG\s*==\s*'production'/.test(st) && /env\.EFF_CUPI24_FTP_HOST\s*!=\s*''/.test(st)));
  check('KRITISCH: sowohl der Demo- als auch der Staging-Zweig setzen das cupi24-Ziel leer, ohne Rückfall auf die Production-Werte',
    (workflow.match(/EFF_CUPI24_FTP_HOST=""/g) || []).length >= 2);

  check('KRITISCH: ein übersprungener cupi24-Deploy sagt das ausdrücklich, statt lautlos auszufallen',
    hinweis !== '' && /::notice::/.test(hinweis)
    && /env\.EFF_CUPI24_FTP_HOST\s*==\s*''/.test(hinweis));

  // Alle FÜNF Bündel müssen sich gegenseitig aus dem Weg bleiben.
  check('KRITISCH: alle fünf Uploads haben verschiedene Quellverzeichnisse',
    /local-dir:\s*\.\/dist\//.test(workflow) && /local-dir:\s*\.\/dist-guardops\//.test(workflow)
    && /local-dir:\s*\.\/dist-betreiber\//.test(workflow) && /local-dir:\s*\.\/dist-portal\//.test(workflow)
    && /local-dir:\s*\.\/dist-cupi24\//.test(workflow));

  // CUPI-24-eigenes Branding (ENT-589, schliesst die zwei offenen Punkte
  // aus ENT-568): Anmeldemaske und App-Icons zeigen auf cupi24.guardops.ch
  // das CUPI-24-Siegel statt der GuardOpS-Marke. Die geteilten Flächen
  // (guardops.ch, betreiber.*, portal.*) bleiben ENT-568-konform GuardOpS
  // -- darum wird hier geprüft, dass die neuen Zeichenketten NUR im
  // cupi24-Bau-Schritt vorkommen, nirgends sonst im Workflow.
  check('KRITISCH: die CUPI-24-Icon-Dateien liegen im Repository (Favicon/App-Icons + Siegel für die Anmeldemaske)',
    ['icons/cupi24-16.png', 'icons/cupi24-32.png', 'icons/cupi24-180.png',
     'icons/cupi24-192.png', 'icons/cupi24-512.png', 'icons/cupi24-badge.png']
      .every(p => existsSync(`${WURZEL}/${p}`)));

  check('KRITISCH: die Anmeldemaske (gate-oben) des Cockpits zeigt im cupi24-Bündel das CUPI-24-Siegel statt der GuardOpS-Wortmarke',
    /class=\\"marke\\"/.test(bauen) && /cupi24-badge\.png/.test(bauen)
    && /dist-cupi24\/dashboard\.html/.test(bauen));

  check('KRITISCH: beide Web-App-Manifeste tragen im cupi24-Bündel den CUPI-24-Namen statt GuardOpS',
    /CUPI 24 – Mitarbeitende/.test(bauen) && /dist-cupi24\/manifest-app\.json/.test(bauen)
    && /Stundenrapport – CUPI 24/.test(bauen) && /dist-cupi24\/manifest\.json/.test(bauen));

  // sw.js traegt seit ENT-603 die MARKE im Quelltext (nicht mehr die
  // Mandantin) -- das cupi24-Bündel haengt PUSH_TITEL, Icon/Badge und das
  // Benachrichtigungs-Kennzeichen im Deploy-Workflow um, dieselbe Bauart
  // wie bei den Web-App-Manifesten.
  {
    const swjs = readFileSync(`${WURZEL}/sw.js`, 'utf8');
    check('KRITISCH: PUSH_TITEL in sw.js trägt im Quelltext die Marke (GuardOpS), nicht die Mandantin',
      /const PUSH_TITEL = 'GuardOpS'/.test(swjs));
  }

  check('KRITISCH: das cupi24-Bündel haengt PUSH_TITEL im sw.js auf CUPI 24 um',
    /sed -i "s\|const PUSH_TITEL = 'GuardOpS';\|const PUSH_TITEL = 'CUPI 24';\|[\s\S]{0,120}dist-cupi24\/sw\.js/.test(bauen));

  check('KRITISCH: sw.js ist Teil DERSELBEN icons/guardops- -> icons/cupi24--Umhaengung wie das Favicon (Push-Icon/-Badge)',
    /sed -i "s\|icons\/guardops-\|icons\/cupi24-\|g" \\[\s\S]{0,250}dist-cupi24\/sw\.js/.test(bauen));

  for (const tok of ['icons/cupi24-', 'cupi24-badge.png']) {
    const zaehlung = (text) => (text.match(new RegExp(tok.replace(/[.]/g, '\\.'), 'g')) || []).length;
    check(`KRITISCH: "${tok}" kommt im ganzen Workflow ausschliesslich im cupi24-Bau-Schritt vor -- sonst bliebe das GuardOpS-Branding der geteilten Bündel nicht unangetastet`,
      zaehlung(bauen) > 0 && zaehlung(workflow) === zaehlung(bauen));
  }
}

/* GitHub selbst weist einen einzelnen "run:"-Block ab, sobald sein
   Rohtext eine bestimmte Laenge ueberschreitet -- ohne dass irgendeine
   YAML-Regel das anzeigt: die Datei bleibt gueltiges YAML, ein Duplikat-
   Schluessel-Pruefer findet nichts, und lokal laeuft alles. Es faellt
   erst beim echten Deploy auf, und dann sofort komplett: GitHub kann die
   Datei dann ueberhaupt nicht mehr einlesen (0 Jobs, der Lauf traegt statt
   des Namens den Dateipfad).
   Genau das ist beim Bauen von ENT-604 passiert: der grosse "Umgebung
   waehlen"-Schritt lag mit 24909 Zeichen schon nahe an der Grenze; neun weitere
   Zeilen fuer APNs (ENT-604) haben sie auf 25561 gerissen. Empirisch
   eingegrenzt (ueber echte, manuell ausgeloeste Laeufe -- nicht geraten):
   24765 Zeichen laufen durch, 25561 nicht. Die genaue Grenze dazwischen
   ist nicht bekannt; die Zahl 21000 aus GitHubs eigener Fehlermeldung
   ("Exceeded max expression length 21000") ist jedenfalls nicht direkt
   die Rohlaenge. GRENZE liegt darum nahe dem bestaetigt LAUFENDEN Wert,
   mit etwas Luft nach oben -- wer sie anhebt, um diese Pruefung stumm zu
   schalten, hebt sie ueber Boden auf, den niemand vermessen hat. */
{
  const GRENZE = 25000;
  // Jeden "run: |"-Block bis zum naechsten Geschwister-Schritt (naechstes
  // "- name:") oder Dateiende vermessen.
  const namen = [...workflow.matchAll(/\n( +)- name: ([^\n]*)\n/g)];
  for (let i = 0; i < namen.length; i++) {
    const [, einrueckung, name] = namen[i];
    const start = namen[i].index + namen[i][0].length;
    const ende = i + 1 < namen.length ? namen[i + 1].index : workflow.length;
    const abschnitt = workflow.slice(start, ende);
    const runStart = abschnitt.indexOf(`${einrueckung}  run: |\n`);
    if (runStart === -1) { continue; }
    const laenge = abschnitt.length - runStart;
    check(`KRITISCH: run-Block "${name}" bleibt unter ${GRENZE} Zeichen (GitHub weist zu grosse Bloecke komplett ab) -- ${laenge}`,
      laenge < GRENZE);
  }
}

// ══════════ DER SCHLÜSSEL FÜRS HANDY (aufs-handy.sh) ══════════════════
// Fürs Web setzt der Deploy den Schlüssel ein (oben geprüft). Fürs Handy
// macht das aufs-handy.sh -- und das ging still durch, wenn die Datei mit
// dem Schlüssel fehlte. Auf dem Gerät stand dann in der laufenden Runde
// statt der Karte die graue Tafel von Google; vom Projektinhaber gemeldet.
//
// Geprüft wird durch AUSFÜHREN, nicht durch Lesen: Die Funktion wird aus
// dem Skript herausgeschnitten und in einem Wegwerf-Verzeichnis auf eine
// Kopie losgelassen. Eine Prüfung, die nur nach dem Wort "else" sucht,
// bliebe grün, wenn der Zweig irgendwann nichts mehr sagt.
{
  const { mkdtempSync, writeFileSync, readFileSync: lies, rmSync } = await import('fs');
  const { execFileSync } = await import('child_process');
  const { tmpdir } = await import('os');
  const { join } = await import('path');

  const skript = lies(`${WURZEL}/aufs-handy.sh`, 'utf8');
  const von = skript.indexOf('maps_schluessel_einsetzen() {');
  const bis = skript.indexOf('\n}\n', von);
  check('KRITISCH: das Einsetzen des Maps-Schlüssels steht als eigene, prüfbare Funktion da',
    von !== -1 && bis !== -1);

  if (von !== -1 && bis !== -1) {
    const fn = skript.slice(von, bis + 3);
    const lauf = (schluesselInhalt) => {
      const ordner = mkdtempSync(join(tmpdir(), 'mapskey-'));
      try {
        writeFileSync(join(ordner, 'seite.html'), 'key=__MAPS_JS_KEY__ ende');
        if (schluesselInhalt !== null) { writeFileSync(join(ordner, 'schluessel'), schluesselInhalt); }
        const ausgabe = execFileSync('bash', ['-c',
          fn + '\nmaps_schluessel_einsetzen "$1" "$2"', '--',
          join(ordner, 'seite.html'), join(ordner, 'schluessel')],
          { encoding: 'utf8' });
        return { ausgabe, seite: lies(join(ordner, 'seite.html'), 'utf8') };
      } finally { rmSync(ordner, { recursive: true, force: true }); }
    };

    const mit = lauf('AIzaSyD-Beispiel_ohne_Bedeutung_123\n');
    check('KRITISCH: mit hinterlegtem Schlüssel steht er danach wirklich in der Seite',
      mit.seite.includes('AIzaSyD-Beispiel_ohne_Bedeutung_123')
      && !mit.seite.includes('__MAPS_JS_KEY__'));

    const ohne = lauf(null);
    check('KRITISCH: ohne hinterlegten Schlüssel bleibt der Platzhalter stehen',
      ohne.seite.includes('__MAPS_JS_KEY__'));
    // Der eigentliche Befund: Es darf nicht still durchgehen.
    check('KRITISCH: und das Skript sagt es, statt stillschweigend weiterzumachen',
      ohne.ausgabe.trim().length > 40);
    check('Es sagt auch, WAS ausfällt -- die Karte, nicht die ganze App',
      /Karte/i.test(ohne.ausgabe));
    check('Und wie man es behebt',
      ohne.ausgabe.includes('.maps-key') || /schluessel/i.test(ohne.ausgabe));
    check('KRITISCH: die beiden Fälle sagen nicht dasselbe',
      ohne.ausgabe.trim() !== mit.ausgabe.trim());

    const leer = lauf('   \n');
    check('KRITISCH: eine leere Schlüsseldatei gilt nicht als Schlüssel',
      leer.seite.includes('__MAPS_JS_KEY__') && /KEINE Karte/i.test(leer.ausgabe));
  } else {
    ['KRITISCH: mit hinterlegtem Schlüssel steht er danach wirklich in der Seite',
     'KRITISCH: ohne hinterlegten Schlüssel bleibt der Platzhalter stehen',
     'KRITISCH: und das Skript sagt es, statt stillschweigend weiterzumachen',
     'Es sagt auch, WAS ausfällt -- die Karte, nicht die ganze App',
     'Und wie man es behebt',
     'KRITISCH: die beiden Fälle sagen nicht dasselbe',
     'KRITISCH: eine leere Schlüsseldatei gilt nicht als Schlüssel',
    ].forEach(n => check(n + ' (nicht prüfbar: Funktion nicht gefunden)', false));
  }
}

// ══════════ FÜR WELCHES ZIEL GEBAUT WIRD (aufs-handy.sh) ══════════════
// Vom Projektinhaber gemeldet: Der Lauf brach mit "Unable to find a
// destination matching { id:... }" ab und listete nur Simulatoren auf --
// obwohl das iPhone angeschlossen war und Schritt 4 es eben noch gefunden
// hatte. Apples zwei Werkzeuge führen getrennte Gerätelisten: devicectl
// sah es, xcodebuild nicht.
//
// Wieder durch AUSFÜHREN geprüft, nicht durch Lesen: xcodebuild wird für
// den Test durch ein Skript ersetzt, das einmal mit und einmal ohne das
// Gerät antwortet.
{
  const { mkdtempSync, writeFileSync, chmodSync, rmSync } = await import('fs');
  const { execFileSync } = await import('child_process');
  const { tmpdir } = await import('os');
  const { join } = await import('path');

  const skript = readFileSync(`${WURZEL}/aufs-handy.sh`, 'utf8');
  const von = skript.indexOf('bau_ziel_waehlen() {');
  const bis = skript.indexOf('\n}\n', von);
  check('KRITISCH: die Wahl des Bauziels steht als eigene, prüfbare Funktion da',
    von !== -1 && bis !== -1);

  if (von !== -1 && bis !== -1) {
    const fn = skript.slice(von, bis + 3);
    const KENNUNG = '00008130-000000000000000A';
    // Was xcodebuild -showdestinations ausgibt, wenn es das Gerät NICHT
    // sieht: nur Simulatoren und die beiden Platzhalter.
    const OHNE = [
      '{ platform:macOS, arch:arm64, id:00006034-000000000000001C, name:My Mac }',
      '{ platform:iOS, id:dvtdevice-DVTiPhonePlaceholder-iphoneos:placeholder, name:Any iOS Device }',
      '{ platform:iOS Simulator, arch:arm64, id:D30B9AE4-0000-0000-0000-000000000000, OS:26.5, name:iPhone 17 }',
    ].join('\n');
    const MIT = OHNE + `\n{ platform:iOS, arch:arm64, id:${KENNUNG}, name:Diensthandy }`;
    // Der Fall, an dem der Ausweichweg beim ersten Versuch vorbeilief:
    // xcodebuild KENNT das Gerät, kann es aber nicht bedienen und führt es
    // darum in einer zweiten Liste unter "Ineligible destinations". Wer
    // beide zusammen durchsucht, findet es -- und baut trotzdem ins Leere.
    const UNBRAUCHBAR = OHNE
      + '\n\nIneligible destinations for the "App" scheme:'
      + `\n{ platform:iOS, id:${KENNUNG}, name:Diensthandy, error:Diensthandy is busy }`;

    const lauf = (liste, kennung) => {
      const ordner = mkdtempSync(join(tmpdir(), 'bauziel-'));
      try {
        const stub = join(ordner, 'xcodebuild');
        writeFileSync(stub, `#!/bin/sh\ncat <<'ENDE'\n${liste}\nENDE\n`);
        chmodSync(stub, 0o755);
        return execFileSync('bash', ['-c',
          fn + '\nbau_ziel_waehlen "$1" -project irgendwas -scheme App', '--', kennung],
          { encoding: 'utf8', env: { ...process.env, PATH: `${ordner}:${process.env.PATH}` } }).trim();
      } finally { rmSync(ordner, { recursive: true, force: true }); }
    };

    check('KRITISCH: sieht xcodebuild das Gerät, wird für genau dieses gebaut',
      lauf(MIT, KENNUNG) === `id=${KENNUNG}`);
    // Der eigentliche Befund: Vorher stand hier fest "id=<UDID>", und der
    // Lauf brach ab, statt auszuweichen.
    check('KRITISCH: sieht es xcodebuild NICHT, wird allgemein für iOS gebaut statt abgebrochen',
      lauf(OHNE, KENNUNG) === 'generic/platform=iOS');
    check('KRITISCH: ohne bekannte Gerätekennung ebenfalls allgemein für iOS',
      lauf(MIT, '') === 'generic/platform=iOS');
    // Ein Simulator darf die Wahl nie gewinnen -- sonst landet die App
    // nicht auf dem Telefon, und das fiele erst beim Installieren auf.
    check('KRITISCH: ein Gerät unter "Ineligible destinations" gilt NICHT als brauchbar',
      lauf(UNBRAUCHBAR, KENNUNG) === 'generic/platform=iOS');
    check('KRITISCH: das Ergebnis ist nie ein Simulator',
      !lauf(OHNE, KENNUNG).includes('Simulator') && !lauf(MIT, KENNUNG).includes('Simulator'));
  } else {
    ['KRITISCH: sieht xcodebuild das Gerät, wird für genau dieses gebaut',
     'KRITISCH: sieht es xcodebuild NICHT, wird allgemein für iOS gebaut statt abgebrochen',
     'KRITISCH: ohne bekannte Gerätekennung ebenfalls allgemein für iOS',
     'KRITISCH: ein Gerät unter "Ineligible destinations" gilt NICHT als brauchbar',
     'KRITISCH: das Ergebnis ist nie ein Simulator',
    ].forEach(n => check(n + ' (nicht prüfbar: Funktion nicht gefunden)', false));
  }
}

// ══════════ WELCHES iPHONE GENOMMEN WIRD (aufs-handy.sh) ══════════════
// devicectl führt eine Spalte "State": "connected" heisst erreichbar,
// "available (paired)" heisst nur bekannt -- das Telefon war schon einmal
// da. Vom Projektinhaber gemeldet: Der Bau lief durch, und erst das
// Installieren fiel um mit "CoreDeviceService was unable to locate a
// device". Die Zeile stand in der Liste, erreichbar war das Gerät nicht.
//
// Auch hier durch AUSFÜHREN geprüft: die Funktion bekommt echte
// Tabellenausgaben zu lesen.
{
  const { execFileSync } = await import('child_process');
  const skript = readFileSync(`${WURZEL}/aufs-handy.sh`, 'utf8');
  const von = skript.indexOf('geraet_waehlen() {');
  const bis = skript.indexOf('\n}\n', von);
  check('KRITISCH: die Wahl des iPhones steht als eigene, prüfbare Funktion da',
    von !== -1 && bis !== -1);

  if (von !== -1 && bis !== -1) {
    const fn = skript.slice(von, bis + 3);
    const KOPF = 'Name  Hostname  Identifier  State  Model';
    const lauf = (tabelle) => execFileSync('bash',
      ['-c', fn + '\ngeraet_waehlen'],
      { encoding: 'utf8', input: tabelle }).trim();

    const NUR_BEKANNT = `${KOPF}
iPhone A  a.coredevice.local  AAAAAAAA-0000-0000-0000-000000000001  available (paired)  iPhone17,1`;
    const BEIDE = `${KOPF}
iPhone A  a.coredevice.local  AAAAAAAA-0000-0000-0000-000000000001  available (paired)  iPhone14,2
iPhone B  b.coredevice.local  BBBBBBBB-0000-0000-0000-000000000002  connected  iPhone17,1`;

    // Der eigentliche Befund: Vorher gewann schlicht die erste Zeile.
    check('KRITISCH: steht ein verbundenes Gerät weiter unten, gewinnt trotzdem es',
      lauf(BEIDE).startsWith('BBBBBBBB-0000-0000-0000-000000000002'));
    check('KRITISCH: und sein Zustand wird mitgeführt, nicht weggeworfen',
      lauf(BEIDE).includes('connected'));
    // Ein nur bekanntes Gerät bleibt brauchbar -- es kann inzwischen
    // wieder angesteckt sein. Aber der Zustand muss mitkommen, sonst
    // sieht "bekannt" wie "verbunden" aus (CLAUDE.md).
    check('KRITISCH: ist keines verbunden, wird das bekannte genommen -- mit seinem Zustand',
      lauf(NUR_BEKANNT).startsWith('AAAAAAAA-0000-0000-0000-000000000001')
      && lauf(NUR_BEKANNT).includes('available (paired)'));
    check('KRITISCH: die Kopfzeile der Tabelle gilt nicht als Gerät',
      lauf(KOPF) === '');
    check('Eine leere Liste ergibt nichts, statt etwas zu erfinden',
      lauf('') === '');
  } else {
    ['KRITISCH: steht ein verbundenes Gerät weiter unten, gewinnt trotzdem es',
     'KRITISCH: und sein Zustand wird mitgeführt, nicht weggeworfen',
     'KRITISCH: ist keines verbunden, wird das bekannte genommen -- mit seinem Zustand',
     'KRITISCH: die Kopfzeile der Tabelle gilt nicht als Gerät',
     'Eine leere Liste ergibt nichts, statt etwas zu erfinden',
    ].forEach(n => check(n + ' (nicht prüfbar: Funktion nicht gefunden)', false));
  }
}

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
