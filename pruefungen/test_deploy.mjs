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
const seiten = ['index.html', 'dashboard.html', 'app.html'];

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

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
