<?php
declare(strict_types=1);
// Echte Ausfuehrung der Sicherheitsregeln aus ENT-501.
//
// WARUM DIESE DATEI UEBERHAUPT: Die Browser-Suiten bilden jede Serverantwort
// nach -- PHP laeuft dabei nie. Eine Regel, die nur im Backend steht, kaeme
// dort nie vorbei, und eine Regel, die niemand ausfuehrt, ist eine
// Behauptung (dieselbe Ueberlegung wie in pruef_sitzung.php).
//
// Und es wird der ECHTE Quelltext ausgefuehrt, nicht eine Kopie davon: Die
// Funktionen werden aus den Backend-Dateien gelesen und ausgewertet. Eine
// Pruefung, die nachsieht, ob ein Wort im Code steht, bliebe gruen, wenn
// die Formulierung sich aendert und die Sache verschwindet (CLAUDE.md).
//
// Geprueft werden die fuenf reinen Regeln, die bei der Sicherheitspruefung
// vom 2026-09-09 entstanden sind:
//   1. basis_url_pruefen()  -- die eigene Adresse kommt aus dem Deploy
//   2. web_adresse_sicher() -- ein Kontaktweg wird nur zum Link, wenn er einer ist
//   3. push_dienst_bekannt()-- ein Push-Endpunkt ist ein Push-Dienst
//   4. sitzung_abdruck()    -- in der Datenbank steht nur der Abdruck
//   5. passwort_blindpruefung() -- die Antwortzeit verraet kein Konto
//   6. logo_mime_am_inhalt()-- der Bildtyp kommt aus den Bytes

$wurzel = dirname(__DIR__);
$ok = 0; $bad = [];
function pruef(string $name, bool $c): void {
    global $ok, $bad;
    if ($c) { $ok++; } else { $bad[] = $name; }
}

// Holt genau EINE Funktion (oder Konstante) aus einer Datei und wertet sie
// aus. Schlaegt laut fehl, wenn sie nicht gefunden wird -- eine Pruefung,
// die stillschweigend nichts prueft, waere schlimmer als keine.
function hol(string $datei, string $muster, string $was): void {
    $quelle = file_get_contents($datei);
    if ($quelle === false || !preg_match($muster, $quelle, $t)) {
        fwrite(STDERR, "FEHLT: $was in " . basename($datei) . " nicht gefunden — "
            . "wurde sie umbenannt oder entfernt?\n");
        exit(1);
    }
    eval($t[0]);
}

$db        = $wurzel . '/backend/db.php';
$push      = $wurzel . '/backend/push.php';
$anmeldung = $wurzel . '/backend/anmeldung.php';
$betrieb   = $wurzel . '/backend/api/betrieb.php';

hol($db,        '/function basis_url_pruefen.*?\n\}/s',      'basis_url_pruefen()');
hol($db,        '/function web_adresse_sicher.*?\n    \}/s', 'web_adresse_sicher()');
hol($db,        '/function sitzung_abdruck.*?\n\}/s',        'sitzung_abdruck()');
hol($push,      '/^const PUSH_DIENSTE\s*=\s*\[.*?\];/ms',    'PUSH_DIENSTE');
hol($push,      '/function push_dienst_bekannt.*?\n\}/s',    'push_dienst_bekannt()');
hol($anmeldung, '/^const PASSWORT_BLIND_HASH\s*=\s*\'[^\']+\';/m', 'PASSWORT_BLIND_HASH');
hol($anmeldung, '/function passwort_blindpruefung.*?\n\}/s', 'passwort_blindpruefung()');
hol($betrieb,   '/function logo_mime_am_inhalt.*?\n\}/s',    'logo_mime_am_inhalt()');

// ══════════════════════════════════════════════════════════════════════
// 1. Die eigene Adresse kommt aus dem Deploy (S-01)
//
// Der Angriff, der dahintersteht: Zwei unangemeldete Endpunkte bauten den
// per E-Mail verschickten Link aus dem Host-Kopf DER ANFRAGE. Wer sie mit
// einem fremden Host-Kopf aufrief, liess den Server einen Link auf die
// eigene Adresse verschicken -- an die echte Person, vom echten Absender.
pruef('KRITISCH: der unersetzte Platzhalter gilt NICHT als Adresse',
    basis_url_pruefen('__APP_BASIS_URL__') === null);
pruef('Leer gilt nicht als Adresse',
    basis_url_pruefen('') === null && basis_url_pruefen('   ') === null);
pruef('KRITISCH: http:// wird abgewiesen -- ein Ruecksetzlink geht nie unverschluesselt',
    basis_url_pruefen('http://beispiel.example') === null);
pruef('KRITISCH: ein anderes Schema wird abgewiesen',
    basis_url_pruefen('javascript:alert(1)') === null
    && basis_url_pruefen('//beispiel.example') === null
    && basis_url_pruefen('ftp://beispiel.example') === null);
// GEGENPROBE ERGAB (2026-09-10): Diese Aussage traegt die https-Regel
// darunter, NICHT die Steuerzeichen-Zeile darueber -- nimmt man Letztere
// weg, bleibt die Pruefung gruen, weil die verankerte Adressform einen
// Zeilenumbruch ohnehin nicht durchlaesst. Die Steuerzeichen-Zeile ist ein
// zweites Schloss und bleibt bewusst stehen; wer die https-Regel lockert,
// braucht sie. Hier festgehalten, damit niemand die falsche Zeile fuer die
// wirksame haelt.
pruef('KRITISCH: ein Zeilenumbruch in der Adresse wird abgewiesen',
    basis_url_pruefen("https://beispiel.example\r\nBcc: fremd@example") === null
    && basis_url_pruefen("https://beispiel.example\n") !== null);   // trim() ist erlaubt
pruef('Eine gueltige Adresse wird angenommen',
    basis_url_pruefen('https://beispiel.example') === 'https://beispiel.example');
pruef('Der abschliessende Schraegstrich wird entfernt -- sonst entstuende "//app.html"',
    basis_url_pruefen('https://beispiel.example/') === 'https://beispiel.example');
pruef('Ein Unterverzeichnis bleibt erhalten',
    basis_url_pruefen('https://beispiel.example/rapport') === 'https://beispiel.example/rapport');

// ══════════════════════════════════════════════════════════════════════
// 2. Ein Kontaktweg wird nur zum Link, wenn er einer ist (S-03)
//
// Der Angriff: 'webseite' war der einzige Kontaktweg ohne festes Schema
// davor und ging roh ins href. Angezeigt wird diese Liste dem Waechter
// waehrend der laufenden Runde.
pruef('KRITISCH: javascript: wird nicht zur Webadresse',
    web_adresse_sicher('javascript:alert(1)') === null);
pruef('KRITISCH: auch mit Grossbuchstaben und Leerzeichen nicht',
    web_adresse_sicher('JaVaScRiPt:alert(1)') === null
    && web_adresse_sicher('  javascript:alert(1)  ') === null);
pruef('KRITISCH: ein eingeschobenes Steuerzeichen heilt es nicht',
    web_adresse_sicher("java\nscript:alert(1)") === null
    && web_adresse_sicher("java\tscript:alert(1)") === null
    && web_adresse_sicher("java\x00script:alert(1)") === null);
pruef('KRITISCH: data: und vbscript: ebenfalls nicht',
    web_adresse_sicher('data:text/html,<script>alert(1)</script>') === null
    && web_adresse_sicher('vbscript:msgbox(1)') === null);
pruef('https und http bleiben erlaubt',
    web_adresse_sicher('https://beispiel.example') === 'https://beispiel.example'
    && web_adresse_sicher('http://beispiel.example/pfad') === 'http://beispiel.example/pfad');
pruef('Ohne Schema wird https ergaenzt -- "www.beispiel.example" ist die uebliche Eingabe',
    web_adresse_sicher('www.beispiel.example') === 'https://www.beispiel.example');
pruef('Leer bleibt leer', web_adresse_sicher('') === null && web_adresse_sicher('   ') === null);

// ══════════════════════════════════════════════════════════════════════
// 3. Ein Push-Endpunkt ist ein Push-Dienst (S-07/SSRF)
//
// Der Angriff: Jede angemeldete Person konnte eine beliebige https-Adresse
// als "Endpunkt" hinterlegen; der Server rief sie danach von sich aus auf.
pruef('Die echten Push-Dienste werden erkannt',
    push_dienst_bekannt('fcm.googleapis.com')
    && push_dienst_bekannt('web.push.apple.com')
    && push_dienst_bekannt('updates.push.services.mozilla.com'));
pruef('Unterdomains der Dienste werden erkannt -- Edge nutzt wns2-by3p.notify.windows.com',
    push_dienst_bekannt('wns2-by3p.notify.windows.com'));
pruef('Grossschreibung und Punkt am Ende aendern nichts',
    push_dienst_bekannt('FCM.GoogleAPIs.COM') && push_dienst_bekannt('fcm.googleapis.com.'));
pruef('KRITISCH: ein fremder Rechner wird abgewiesen',
    !push_dienst_bekannt('angreifer.example') && !push_dienst_bekannt('localhost')
    && !push_dienst_bekannt('127.0.0.1'));
pruef('KRITISCH: ein aehnlich aussehender Name wird abgewiesen -- die Pruefung haengt am Punkt',
    !push_dienst_bekannt('boesenotify.windows.com')
    && !push_dienst_bekannt('fcm.googleapis.com.angreifer.example'));

// ══════════════════════════════════════════════════════════════════════
// 4. In der Datenbank steht nur der Abdruck (S-06)
$roh = bin2hex(random_bytes(32));
$ab  = sitzung_abdruck($roh);
pruef('KRITISCH: der Abdruck ist nicht der Rohwert', $ab !== $roh);
pruef('Der Abdruck ist SHA-256 und passt in VARCHAR(64)',
    $ab === hash('sha256', $roh) && strlen($ab) === 64);
pruef('Gleiche Eingabe, gleicher Abdruck -- sonst fuende sich keine Sitzung wieder',
    sitzung_abdruck($roh) === $ab);
pruef('Verschiedene Eingaben, verschiedene Abdruecke',
    sitzung_abdruck($roh . 'x') !== $ab);

// ══════════════════════════════════════════════════════════════════════
// 5. Die Antwortzeit verraet kein Konto (S-12)
//
// GEMESSEN, nicht behauptet: Die Blindpruefung muss ungefaehr so lange
// rechnen wie eine echte Passwortpruefung. Ein Aufruf, der sofort
// zurueckkommt -- etwa weil jemand den Hash durch eine leere Zeichenkette
// ersetzt --, erfuellt seinen Zweck nicht und faellt hier auf.
$echterHash = password_hash('irgendein-passwort', PASSWORD_DEFAULT, ['cost' => 12]);
$t0 = microtime(true); password_verify('falsch', $echterHash); $echt = microtime(true) - $t0;
$t0 = microtime(true); passwort_blindpruefung('falsch');       $blind = microtime(true) - $t0;
pruef('KRITISCH: die Blindpruefung rechnet ueberhaupt (nicht unter 10 ms)', $blind > 0.010);
pruef('KRITISCH: sie rechnet ungefaehr so lange wie eine echte Pruefung (Faktor 2)',
    $echt > 0 && $blind > $echt / 2 && $blind < $echt * 2);
pruef('Der Blind-Hash ist ein bcrypt-Wert mit denselben Kosten wie die echten',
    str_starts_with(PASSWORT_BLIND_HASH, '$2y$12$'));
pruef('KRITISCH: kein Passwort passt auf den Blind-Hash',
    !password_verify('', PASSWORT_BLIND_HASH)
    && !password_verify('passwort', PASSWORT_BLIND_HASH));

// ══════════════════════════════════════════════════════════════════════
// 6. Der Bildtyp kommt aus den Bytes (S-14)
pruef('PNG wird an seiner Signatur erkannt',
    logo_mime_am_inhalt("\x89PNG\r\n\x1a\n" . str_repeat('x', 40)) === 'image/png');
pruef('JPEG wird an seiner Signatur erkannt',
    logo_mime_am_inhalt("\xFF\xD8\xFF\xE0" . str_repeat('x', 40)) === 'image/jpeg');
pruef('WebP wird an seiner Signatur erkannt',
    logo_mime_am_inhalt('RIFF' . "\x00\x00\x00\x00" . 'WEBP' . str_repeat('x', 40)) === 'image/webp');
pruef('KRITISCH: ein SVG wird nicht als Bild angenommen -- es darf <script> tragen',
    logo_mime_am_inhalt('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') === null);
pruef('KRITISCH: PHP-Quelltext wird nicht als Bild angenommen',
    logo_mime_am_inhalt('<?php echo 1; ?>') === null);
pruef('Leere Bytes ergeben keinen Typ', logo_mime_am_inhalt('') === null);

// ══════════════════════════════════════════════════════════════════════
// 7. Zwei Regeln ueber den GANZEN Quelltext
//
// Sie stehen hier und nicht in test_php.mjs, und das ist beim Schreiben
// aufgefallen: Der dortige Kommentarfilter ist ein Muster, kein Zerteiler.
// Er haelt die beiden Schraegstriche in der Zeichenkette 'https://' fuer
// einen Kommentarbeginn und loescht den Rest der Zeile -- ausgerechnet die
// Zeile, in der ein wieder eingebautes HTTP_HOST staende. Die Gegenprobe
// blieb dadurch gruen.
//
// Nur der PHP-Zerteiler weiss sicher, was Kommentar ist und was bloss in
// einer Zeichenkette steht (dieselbe Begruendung wie in pruef_sql.php).
function ohne_kommentare(string $quelle): string
{
    $aus = '';
    foreach (token_get_all($quelle) as $t) {
        if (is_array($t) && in_array($t[0], [T_COMMENT, T_DOC_COMMENT], true)) { continue; }
        $aus .= is_array($t) ? $t[1] : $t;
    }
    return $aus;
}

$backendDateien = array_merge(
    glob($wurzel . '/backend/*.php') ?: [],
    glob($wurzel . '/backend/api/*.php') ?: []
);
pruef('Es gibt ueberhaupt Backend-Dateien zu pruefen', count($backendDateien) > 100);

// 7a. Die eigene Adresse kommt nie aus der Anfrage (S-01)
//
// Drei Stellen bauten den per E-Mail verschickten Link aus
// $_SERVER['HTTP_HOST'] -- dem Host-Kopf DER ANFRAGE. Bei zweien brauchte
// der Aufrufer nicht einmal eine Anmeldung: Er liess den Server eine
// Nachricht vom echten Absender an die echte Person schicken, mit einem
// Link auf seine eigene Adresse.
$mitHostKopf = [];
foreach ($backendDateien as $p) {
    $q = ohne_kommentare(file_get_contents($p) ?: '');
    if (preg_match('/HTTP_HOST|SERVER_NAME/', $q)) { $mitHostKopf[] = basename($p); }
}
pruef('KRITISCH: kein Endpunkt leitet die eigene Adresse aus dem Host-Kopf der Anfrage ab'
    . ($mitHostKopf ? ' — betroffen: ' . implode(', ', $mitHostKopf) : ''),
    $mitHostKopf === []);

// Gegenrichtung: Die Ersatzquelle muss es GEBEN. Ohne diese Zeile waere die
// Pruefung oben auch dann gruen, wenn jemand den Link-Versand ersatzlos
// entfernt -- gruen aus dem falschen Grund.
$dbRoh = file_get_contents($wurzel . '/backend/db.php') ?: '';
pruef('KRITISCH: es gibt eine beim Deploy gesetzte Basisadresse als Ersatz',
    (bool)preg_match("/const APP_BASIS_URL\s*=\s*'__APP_BASIS_URL__'/", $dbRoh)
    && (bool)preg_match('/function basis_url\s*\(/', $dbRoh));

// 7b. Eine Sitzung wird nur ueber ihren Abdruck angesprochen (S-06)
//
// Die Wortgrenze ist wesentlich: "versand_token" (der oeffentliche
// Beleg-Link) ist etwas anderes und bleibt ausdruecklich ein Rohwert.
$mitSitzungsToken = [];
$ohneAbdruck = [];
foreach ($backendDateien as $p) {
    $roh = file_get_contents($p) ?: '';
    $q   = ohne_kommentare($roh);
    if (!preg_match('/\b(sessions|kunden_sessions)\b/', $q)) { continue; }
    $spricht = preg_match('/(?<![\w_])token\s*(=|<>)\s*\?/', $q)
        || preg_match('/INSERT INTO (sessions|kunden_sessions) \(token/', $q);
    if (!$spricht) { continue; }
    $mitSitzungsToken[] = basename($p);
    if (!preg_match('/sitzung_abdruck\s*\(|\$abdruck/', $q)) { $ohneAbdruck[] = basename($p); }
}
pruef('Es gibt ueberhaupt Stellen, die eine Sitzung ueber ihren Token ansprechen',
    count($mitSitzungsToken) >= 5);
pruef('KRITISCH: jede davon benutzt den Abdruck'
    . ($ohneAbdruck ? ' — roh: ' . implode(', ', $ohneAbdruck) : ''),
    $ohneAbdruck === []);

// ══════════════════════════════════════════════════════════════════════
echo "\n$ok bestanden, " . count($bad) . " nicht bestanden\n";
foreach ($bad as $b) { echo "  NICHT BESTANDEN: $b\n"; }
if ($bad) { exit(1); }
echo "Alle Pruefungen bestanden.\n";
