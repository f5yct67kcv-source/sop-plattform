<?php
// Push-Benachrichtigungen (ENT-424).
//
// Vom Projektinhaber bestellt als Fortsetzung von ENT-421: Die Mitteilungen
// erreichten niemanden, der die App nicht von sich aus oeffnet (OP-421).
//
// FUENF FESTLEGUNGEN, die den Aufbau erklaeren:
//
//  1. EIN ABO, MEHRERE KANAELE. Web Push kam zuerst, weil er ohne Apple-/
//     Google-Freigabe funktioniert (ENT-424: "jetzt bauen, Aufruf an die
//     Belegschaft spaeter"). Seit ENT-604 kommt natives Push dazu (APNs
//     fuer iOS, FCM fuer Android folgt), weil die Store-App-Huelle Web
//     Push technisch nicht empfangen kann (kein Service Worker in der
//     Capacitor-WKWebView). Genau dafuer war die Spalte `kanal` von Anfang
//     an vorgesehen: 'webpush' traegt eine URL in `endpunkt`, 'apns'/'fcm'
//     tragen dort das Geraete-Token. EINE Tabelle, EIN Empfaenger-Weg
//     (push_abos_fuer_mitteilung) -- nur der Transportweg (push_zustellen)
//     verzweigt nach Kanal.
//
//  2. KEIN MITTEILUNGSINHALT. Auf dem Sperrbildschirm steht "Neue
//     Mitteilung", nicht der Titel. Vom Projektinhaber so entschieden: So
//     laeuft KEIN Text der konkreten Mitteilung ueber die Server von Apple
//     und Google. Bei Web Push heisst das: ganz ohne Nutzlast (RFC 8291
//     entfaellt, es bleibt die VAPID-Signatur nach RFC 8292). Bei APNs
//     lässt sich ein Alarm ohne jede Nutzlast technisch nicht zustellen,
//     solange die App nicht laeuft -- dort traegt die Nutzlast darum einen
//     FESTEN, immer gleichen Text (siehe push_apns_senden), nie den Titel
//     oder Inhalt der Mitteilung. PREIS DAVON, und er ist bewusst bezahlt:
//     Auf dem Sperrbildschirm laesst sich "wichtig" nicht von "normal"
//     unterscheiden.
//
//  3. EIN GEHEIMNIS, NICHT ZWEI. Der oeffentliche VAPID-Schluessel wird aus
//     dem privaten ABGELEITET (push_oeffentlicher_schluessel), nicht
//     getrennt hinterlegt. Zwei Werte, die zusammenpassen muessen, laufen
//     irgendwann auseinander -- und ein oeffentlicher Schluessel, der nicht
//     zum privaten passt, faellt erst auf, wenn eine Benachrichtigung nicht
//     ankommt.
//
//  4. EIN ABGELAUFENES ABO WIRD ENTFERNT, KEIN ZWEITES MAL VERSUCHT. Die
//     Push-Dienste antworten mit 404 oder 410, wenn ein Geraet die App
//     entfernt hat. Bliebe das Abo stehen, waechst die Liste mit toten
//     Eintraegen, und die Zahl "an 12 Geraete verschickt" waere eine
//     Behauptung.
//
//  5. VERSCHICKT WIRD, WAS SICHTBAR IST. Eine Mitteilung mit "sichtbar ab"
//     in der Zukunft loest beim Speichern NICHTS aus -- sonst klingelte das
//     Telefon zu einer Meldung, die in der App noch gar nicht steht. Der
//     Nachzuegler-Versand steht in api/push_versand.php.
declare(strict_types=1);

// ── Das Geheimnis ─────────────────────────────────────────────────────
// Beim Deploy ersetzt, derselbe Mechanismus wie "__DB" + "_HOST__" und
// __SMTP_*__. Bleibt es ungesetzt, meldet push_konfiguriert() "nicht
// eingerichtet" -- es wird nichts verschickt und nichts behauptet.
//
// KEIN FREMDER PLATZHALTERNAME IN DIESER DATEI, auch nicht in einem
// Kommentar: Seit ENT-589 geht sie auch nach dist-cupi24/ mit, und der Bau
// des dortigen Buendels weist jeden Platzhalter ab, der dort nicht ersetzt
// wird. Eine blosse, ausgeschriebene Erwaehnung von "__DB" + "_HOST__" hat
// genau das in Lauf 521 ausgeloest -- gleicher Fehler wie bei
// mailer.php/Lauf 474 (siehe dort).
//
// Wert: base64 der PEM-Datei des privaten P-256-Schluessels, EINZEILIG
// (die Ersetzung im Deploy ist ein sed-Aufruf und vertraegt keine
// Zeilenumbrueche). Erzeugen laesst er sich mit:
//     openssl ecparam -genkey -name prime256v1 -noout -out vapid.pem
//     base64 -w0 vapid.pem
const VAPID_PRIVAT_B64 = '__VAPID_PRIVATE_PEM_B64__';

// Wer ist der Absender? RFC 8292 verlangt im JWT ein "sub" -- eine
// mailto:- oder https:-Adresse, unter der ein Push-Dienst den Betreiber
// erreicht, wenn etwas schiefgeht.
const VAPID_KONTAKT = '__VAPID_KONTAKT__';

// ── Das zweite Geheimnis: APNs (ENT-604) ─────────────────────────────
// Derselbe Mechanismus wie oben, ein zweiter, unabhaengiger Schluessel --
// ein APNs-Authentifizierungsschluessel ist keine Nutzererlaubnis auf VAPID,
// er wird im Apple-Developer-Portal eigens dafuer erzeugt (Certificates,
// Identifiers & Profiles -> Keys -> "+", "Apple Push Notifications
// service (APNs)" ankreuzen). Erzeugt EINMALIG herunterladbar, danach nur
// noch als Wert hier ersetzbar.
//
// Wert: base64 der .p8-Datei, EINZEILIG (derselbe Grund wie bei VAPID_PRIVAT_B64).
const APNS_KEY_P8_B64 = '__APNS_KEY_P8_B64__';
// Steht auf der Bestaetigungsseite nach dem Erzeugen des Schluessels.
const APNS_KEY_ID = '__APNS_KEY_ID__';
// Apple-Developer-Team-ID (Mitgliedschaft -> Team-ID), nicht die App-ID.
const APNS_TEAM_ID = '__APNS_TEAM_ID__';
// Die App-Kennung (ENT-568/ENT-141) -- kein Geheimnis, aber APNs verlangt
// sie im "apns-topic"-Kopf jeder Zustellung.
const APNS_BUNDLE_ID = 'ch.guardops.mitarbeiter';

// Die Kanaele. EINE Liste -- Speichern und Versand befragen sie.
// 'fcm' (Android) steht noch nicht drin: Ein Kanal, den niemand zustellen
// kann, waere ein Versprechen ohne Deckung. Kommt dazu, wenn der
// FCM-Versand gebaut wird (ENT-604, zweiter Bauabschnitt).
const PUSH_KANAELE = ['webpush', 'apns'];

function push_kanal_gueltig(string $wert): bool
{
    return in_array($wert, PUSH_KANAELE, true);
}

// ── Kodierung ─────────────────────────────────────────────────────────
// base64url ohne Fuellzeichen (RFC 7515). Wird an vier Stellen gebraucht:
// JWT-Kopf, JWT-Rumpf, Signatur und oeffentlicher Schluessel.
function push_b64url(string $roh): string
{
    return rtrim(strtr(base64_encode($roh), '+/', '-_'), '=');
}

function push_b64url_zurueck(string $text): string
{
    $rest = strlen($text) % 4;
    if ($rest) { $text .= str_repeat('=', 4 - $rest); }
    return (string)base64_decode(strtr($text, '-_', '+/'));
}

// ── Der Schluessel ────────────────────────────────────────────────────
/**
 * Der private Schluessel, oder null wenn nicht eingerichtet.
 *
 * Statisch gemerkt: Beim Versand an 30 Geraete wird er 30-mal gebraucht,
 * und das Einlesen kostet jedes Mal.
 */
function push_privatschluessel()
{
    static $schluessel = false;
    if ($schluessel !== false) { return $schluessel; }
    $schluessel = null;
    // Der unersetzte Platzhalter ist KEIN Schluessel. Ohne diese Pruefung
    // liefe base64_decode darauf und openssl bekaeme Unsinn -- die Meldung
    // hiesse dann "Schluessel ungueltig" statt "nicht eingerichtet", und
    // das sind zwei verschiedene Sachverhalte.
    if (VAPID_PRIVAT_B64 === '' || str_starts_with(VAPID_PRIVAT_B64, '__VAPID')) { return null; }
    $pem = base64_decode(VAPID_PRIVAT_B64, true);
    if ($pem === false || $pem === '') { return null; }
    $k = openssl_pkey_get_private($pem);
    if ($k === false) { return null; }
    $d = openssl_pkey_get_details($k);
    // Nur P-256. Ein Schluessel auf einer anderen Kurve wuerde hier
    // klaglos geladen und erst beim Push-Dienst abgewiesen.
    if (!isset($d['ec']['curve_name']) || $d['ec']['curve_name'] !== 'prime256v1') { return null; }
    $schluessel = $k;
    return $schluessel;
}

function push_kontakt(): string
{
    $k = VAPID_KONTAKT;
    if ($k === '' || str_starts_with($k, '__VAPID')) { return ''; }
    return $k;
}

/**
 * WARUM ist Push nicht eingerichtet? Fuenf verschiedene Antworten.
 *
 * Nachgetragen, nachdem beim ersten Einrichten genau das gefehlt hat: Die
 * Oberflaeche sagte "auf dem Server fehlt der Push-Schluessel" -- und liess
 * offen, ob gar keiner ankam (Secret-Name oder Environment falsch) oder ob
 * der Wert unlesbar war (ein Zeichen zu viel beim Kopieren). Das sind
 * zwei verschiedene Handgriffe an zwei verschiedenen Stellen, und Raten
 * kostete eine halbe Stunde. Hausregel: "unbekannt" darf nie wie "keine"
 * aussehen -- hier sahen zwei Ursachen gleich aus.
 *
 * Die Rueckgabe nennt NIE den Schluessel selbst oder Teile davon. Sie sagt
 * nur, welcher Handgriff fehlt.
 */
function push_grund(): string
{
    $wert = VAPID_PRIVAT_B64;
    if ($wert === '' || str_starts_with($wert, '__VAPID')) {
        // Der Platzhalter steht noch da (kein Deploy gelaufen) oder das
        // Secret kam leer an (Name oder Environment stimmt nicht).
        return 'kein_schluessel';
    }
    $pem = base64_decode($wert, true);
    if ($pem === false || $pem === '') {
        // base64_decode im strengen Modus weist jedes Zeichen ausserhalb
        // des Alphabets ab -- etwa das "%", das die Mac-Shell ans Ende
        // einer Zeile ohne Zeilenumbruch setzt und das beim Markieren mit
        // der Maus mitkommt.
        return 'schluessel_unlesbar';
    }
    $k = openssl_pkey_get_private($pem);
    if ($k === false) { return 'schluessel_ungueltig'; }
    $d = openssl_pkey_get_details($k);
    if (!isset($d['ec']['curve_name']) || $d['ec']['curve_name'] !== 'prime256v1') {
        return 'falsche_kurve';
    }
    if (push_kontakt() === '') { return 'kein_kontakt'; }
    return 'ok';
}

/**
 * Ist Push ueberhaupt eingerichtet?
 *
 * Beides noetig: Schluessel UND Kontaktadresse. Ohne Kontakt weisen
 * mehrere Push-Dienste das JWT ab -- ein halb eingerichteter Push
 * scheitert dann erst beim ersten echten Versand.
 *
 * EINE Wahrheit: Diese Funktion leitet sich aus push_grund() ab, statt die
 * Bedingungen ein zweites Mal aufzuschreiben. Zwei Listen von Bedingungen
 * fuer dieselbe Frage laufen irgendwann auseinander.
 */
function push_konfiguriert(): bool
{
    return push_grund() === 'ok';
}

/**
 * Der oeffentliche Schluessel als base64url, wie ihn der Browser fuer
 * `applicationServerKey` braucht: unkomprimierter Punkt, 65 Byte,
 * 0x04 || X || Y.
 *
 * ABGELEITET, nicht hinterlegt (siehe Festlegung 3 oben). x und y kommen
 * links mit Nullen aufgefuellt -- openssl liefert sie ohne fuehrende
 * Nullbytes, und ein 31 Byte langes X ergaebe einen Schluessel, den kein
 * Browser annimmt. Das passiert etwa in einem von 256 Faellen und waere
 * sonst ein Fehler, der sich nur bei bestimmten Schluesseln zeigt.
 */
function push_oeffentlicher_schluessel(): ?string
{
    $k = push_privatschluessel();
    if ($k === null) { return null; }
    $d = openssl_pkey_get_details($k);
    if (!isset($d['ec']['x'], $d['ec']['y'])) { return null; }
    $x = str_pad($d['ec']['x'], 32, "\0", STR_PAD_LEFT);
    $y = str_pad($d['ec']['y'], 32, "\0", STR_PAD_LEFT);
    return push_b64url("\x04" . $x . $y);
}

// ── Die Signatur ──────────────────────────────────────────────────────
/**
 * openssl signiert im DER-Format (Sequenz aus zwei ganzen Zahlen), JWS
 * verlangt 64 rohe Bytes (R || S, je 32). Die Umrechnung ist der Ort, an
 * dem selbstgebaute JWT-Signaturen ueblicherweise scheitern: DER kodiert
 * Zahlen mit variabler Laenge und schiebt ein fuehrendes Nullbyte davor,
 * wenn das oberste Bit gesetzt ist.
 */
function push_der_zu_roh(string $der): ?string
{
    $p = 0;
    if (($der[$p++] ?? '') !== "\x30") { return null; }     // SEQUENCE
    $len = ord($der[$p++] ?? "\0");
    if ($len > 0x80) { $p += $len - 0x80; }                  // lange Form
    $zahl = static function (string $der, int &$p): ?string {
        if (($der[$p++] ?? '') !== "\x02") { return null; }   // INTEGER
        $l = ord($der[$p++] ?? "\0");
        $wert = substr($der, $p, $l);
        $p += $l;
        $wert = ltrim($wert, "\0");                          // fuehrende Null weg
        if (strlen($wert) > 32) { return null; }
        return str_pad($wert, 32, "\0", STR_PAD_LEFT);       // links auffuellen
    };
    $r = $zahl($der, $p);
    $s = $zahl($der, $p);
    if ($r === null || $s === null) { return null; }
    return $r . $s;
}

/**
 * Das JWT nach RFC 8292 fuer genau EINEN Push-Dienst.
 *
 * $aud ist der Ursprung des Endpunkts (Schema + Host), nicht der ganze
 * Endpunkt: Ein JWT, das auf die vollstaendige Adresse lautet, wird
 * abgewiesen -- und die Adresse enthaelt die Geraetekennung, die damit in
 * einem Kopfzeilenfeld landen wuerde.
 *
 * Laufzeit 12 Stunden. Laenger als 24 lehnen die Dienste ab; kuerzer
 * brauchte es nicht, das JWT wird ohnehin je Versand neu gebildet.
 */
function push_jwt(string $aud, ?int $jetzt = null): ?string
{
    $k = push_privatschluessel();
    if ($k === null || push_kontakt() === '') { return null; }
    $jetzt = $jetzt ?? time();
    $kopf  = push_b64url((string)json_encode(['typ' => 'JWT', 'alg' => 'ES256']));
    $rumpf = push_b64url((string)json_encode([
        'aud' => $aud,
        'exp' => $jetzt + 12 * 3600,
        'sub' => push_kontakt(),
    ]));
    $sig = '';
    if (!openssl_sign($kopf . '.' . $rumpf, $sig, $k, OPENSSL_ALGO_SHA256)) { return null; }
    $roh = push_der_zu_roh($sig);
    if ($roh === null) { return null; }
    return $kopf . '.' . $rumpf . '.' . push_b64url($roh);
}

// ── APNs (ENT-604) ────────────────────────────────────────────────────
// Dieselbe Kryptografie wie VAPID (ES256, P-256), ein anderer Schluessel
// und ein anderes JWT -- darum eigene Funktionen und nicht dieselben mit
// einem Kanal-Parameter verbogen. push_der_zu_roh() bleibt gemeinsam: die
// DER-zu-roh-Umrechnung ist reine Mathematik, keine VAPID-Eigenheit.

/**
 * Der private APNs-Schluessel, oder null wenn nicht eingerichtet.
 * Statisch gemerkt wie push_privatschluessel() -- derselbe Grund.
 */
function push_apns_privatschluessel()
{
    static $schluessel = false;
    if ($schluessel !== false) { return $schluessel; }
    $schluessel = null;
    if (APNS_KEY_P8_B64 === '' || str_starts_with(APNS_KEY_P8_B64, '__APNS')) { return null; }
    $pem = base64_decode(APNS_KEY_P8_B64, true);
    if ($pem === false || $pem === '') { return null; }
    $k = openssl_pkey_get_private($pem);
    if ($k === false) { return null; }
    $d = openssl_pkey_get_details($k);
    if (!isset($d['ec']['curve_name']) || $d['ec']['curve_name'] !== 'prime256v1') { return null; }
    $schluessel = $k;
    return $schluessel;
}

/**
 * WARUM ist APNs nicht eingerichtet? Dieselbe Idee wie push_grund(): vier
 * Handgriffe, vier verschiedene Antworten, nie den Schluessel selbst.
 */
function push_apns_grund(): string
{
    if (APNS_KEY_P8_B64 === '' || str_starts_with(APNS_KEY_P8_B64, '__APNS')) { return 'kein_schluessel'; }
    $pem = base64_decode(APNS_KEY_P8_B64, true);
    if ($pem === false || $pem === '') { return 'schluessel_unlesbar'; }
    $k = openssl_pkey_get_private($pem);
    if ($k === false) { return 'schluessel_ungueltig'; }
    $d = openssl_pkey_get_details($k);
    if (!isset($d['ec']['curve_name']) || $d['ec']['curve_name'] !== 'prime256v1') { return 'falsche_kurve'; }
    if (APNS_KEY_ID === '' || str_starts_with(APNS_KEY_ID, '__APNS')) { return 'keine_key_id'; }
    if (APNS_TEAM_ID === '' || str_starts_with(APNS_TEAM_ID, '__APNS')) { return 'keine_team_id'; }
    return 'ok';
}

function push_apns_konfiguriert(): bool
{
    return push_apns_grund() === 'ok';
}

/**
 * Ein APNs-Token ist ein reiner Hex-String (typischerweise 64 Zeichen).
 * Er landet direkt in der URL des Zustellwegs -- die Pruefung ist darum
 * kein Komfort, sondern die einzige Absicherung gegen eine manipulierte
 * Adresse (ENT-501, dieselbe Haltung wie push_ursprung() bei Web Push).
 */
function push_apns_token_gueltig(string $t): bool
{
    return (bool)preg_match('/^[0-9a-fA-F]{32,255}$/', $t);
}

/**
 * Das APNs-Authentifizierungs-JWT nach Apples "Token-based provider
 * connection". Anders als bei VAPID kein "aud", sondern "iss" (Team-ID)
 * und "kid" im Kopf statt im Rumpf. Gueltigkeit hier ebenfalls 12 Stunden
 * (Apple akzeptiert selbst erstellte, gueltige Tokens bis zu einer
 * Stunde alt fuer den Versand, ein neues JWT je Versand ist unkritisch
 * und einfacher als eines vorzuhalten).
 */
function push_apns_jwt(?int $jetzt = null): ?string
{
    $k = push_apns_privatschluessel();
    if ($k === null || APNS_KEY_ID === '' || APNS_TEAM_ID === '') { return null; }
    $jetzt = $jetzt ?? time();
    $kopf  = push_b64url((string)json_encode(['alg' => 'ES256', 'kid' => APNS_KEY_ID]));
    $rumpf = push_b64url((string)json_encode(['iss' => APNS_TEAM_ID, 'iat' => $jetzt]));
    $sig = '';
    if (!openssl_sign($kopf . '.' . $rumpf, $sig, $k, OPENSSL_ALGO_SHA256)) { return null; }
    $roh = push_der_zu_roh($sig);
    if ($roh === null) { return null; }
    return $kopf . '.' . $rumpf . '.' . push_b64url($roh);
}

/**
 * Eine Benachrichtigung an ein APNs-Geraet zustellen.
 *
 * FESTER TEXT, nie der Inhalt der Mitteilung (Festlegung 2 oben) --
 * derselbe Satz wie in sw.js fuer Web Push, damit beide Wege dieselbe
 * Auskunft geben. "apns-push-type: alert" UND ein "aps.alert" sind
 * Pflicht: Ohne Alarm-Inhalt zeigt iOS nichts an, solange die App nicht
 * laeuft -- ein content-available-Push (still, ohne Anzeige) braucht eine
 * eigene Hintergrundausfuehrung, die diese App nicht hat.
 *
 * "apns-priority: 10" nur fuer wichtige Mitteilungen, sonst 5 -- dieselbe
 * Idee wie "Urgency" bei Web Push.
 */
/**
 * Die Adresse eines Geraets bei Apple. Zwei Umgebungen, streng getrennt:
 * Ein Geraet, auf dem die App ueber Xcode installiert wurde, meldet sich
 * im SANDKASTEN an und bekommt ein Token, das nur dort gilt. Dieselbe App
 * aus TestFlight oder dem Store meldet sich in der Produktivumgebung an.
 * Ein Token der einen Seite ist auf der anderen ungueltig.
 *
 * Die Umgebung steht NICHT im Token -- man sieht ihm nicht an, woher er
 * stammt. Darum probiert push_apns_senden() die zweite Umgebung, wenn die
 * erste das Token ablehnt.
 */
function push_apns_adresse(string $token, bool $sandkasten): string
{
    $wirt = $sandkasten ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';
    return 'https://' . $wirt . '/3/device/' . $token;
}

function push_apns_senden(array $abo, bool $wichtig): array
{
    $token = (string)($abo['endpunkt'] ?? '');
    if (!push_apns_token_gueltig($token)) {
        return ['code' => 0, 'ausgang' => 'entfernen', 'meldung' => 'Kein gueltiges Geraete-Token'];
    }
    $jwt = push_apns_jwt();
    if ($jwt === null) {
        return ['code' => 0, 'ausgang' => 'fehler', 'meldung' => 'APNs ist nicht eingerichtet'];
    }
    // Zuerst die Produktivumgebung, das ist der Regelfall fuer eine App aus
    // dem Store. Lehnt Apple das Token ab, war es eines aus dem Sandkasten
    // -- dann derselbe Versand noch einmal dorthin.
    //
    // WARUM UEBERHAUPT: Bis hierher ging alles nur an die Produktivadresse,
    // mit der Begruendung, die App werde ja ueber den Store verteilt. Beim
    // Testen am eigenen Geraet stimmt das nicht: Die App kommt dort direkt
    // aus Xcode, das Token gilt nur im Sandkasten, und Apple antwortet
    // BadDeviceToken. Dieser Grund gilt unten als "Geraet gibt es nicht
    // mehr" -- das Abo wurde also bei JEDEM Versuch geloescht, und es kam
    // nie etwas an.
    $ergebnis = push_apns_versuch($token, $jwt, $wichtig, false);
    if (push_apns_sandkasten_probieren($ergebnis)) {
        $ergebnis = push_apns_ergebnis_waehlen($ergebnis, push_apns_versuch($token, $jwt, $wichtig, true));
    }
    return $ergebnis;
}

/**
 * Lohnt ein zweiter Versuch im Sandkasten?
 *
 * NUR bei BadDeviceToken -- das ist Apples Art zu sagen "dieses Token
 * gehoert nicht hierher", und genau das sagt es einem Sandkasten-Token an
 * der Produktivadresse. Jeder andere Fehlschlag (abgelaufener Schluessel,
 * Stoerung bei Apple, falsches Thema) wuerde durch einen zweiten Versuch
 * nicht besser, sondern nur jede Zustellung verdoppeln.
 *
 * Eigene Funktion und nicht nur eine Bedingung im Ablauf, damit die Regel
 * ohne Netzverbindung pruefbar bleibt.
 */
function push_apns_sandkasten_probieren(array $ergebnis): bool
{
    return ($ergebnis['ausgang'] ?? '') === 'entfernen'
        && ($ergebnis['meldung'] ?? '') === 'BadDeviceToken';
}

/**
 * Welches der beiden Ergebnisse zaehlt.
 *
 * Der Sandkasten zaehlt nur, wenn er es besser weiss. Lehnt auch er das
 * Token ab, bleibt es beim ersten Ergebnis: Dann ist das Token wirklich
 * tot und das Abo gehoert entfernt. Ohne diese Regel wuerde ein wirklich
 * abgemeldetes Geraet nie aus der Empfaengerliste verschwinden.
 */
function push_apns_ergebnis_waehlen(array $erster, array $zweiter): array
{
    return ($zweiter['ausgang'] ?? '') === 'entfernen' ? $erster : $zweiter;
}

function push_apns_versuch(string $token, string $jwt, bool $wichtig, bool $sandkasten): array
{
    $ch = curl_init(push_apns_adresse($token, $sandkasten));
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => (string)json_encode(['aps' => [
            'alert' => ['title' => 'GuardOpS', 'body' => 'Neue Mitteilung — zum Lesen öffnen'],
            'sound' => 'default',
        ]]),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_HTTP_VERSION   => CURL_HTTP_VERSION_2_0,
        CURLOPT_HTTPHEADER     => [
            'authorization: bearer ' . $jwt,
            'apns-topic: ' . APNS_BUNDLE_ID,
            'apns-push-type: alert',
            'apns-priority: ' . ($wichtig ? '10' : '5'),
            'content-type: application/json',
        ],
    ]);
    $antwort = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $netzfehler = curl_error($ch);
    curl_close($ch);

    if ($antwort === false && $code === 0) {
        return ['code' => 0, 'ausgang' => 'fehler', 'meldung' => $netzfehler ?: 'keine Verbindung'];
    }
    if ($code >= 200 && $code < 300) { return ['code' => $code, 'ausgang' => 'ok', 'meldung' => ''];  }
    // Apple meldet ungueltige/entfernte Geraete ueber den Grund im
    // Antwortrumpf, nicht ueber 404/410 wie Web Push.
    $grund = '';
    $antwortDaten = json_decode((string)$antwort, true);
    if (is_array($antwortDaten)) { $grund = (string)($antwortDaten['reason'] ?? ''); }
    if (in_array($grund, ['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic'], true)) {
        return ['code' => $code, 'ausgang' => 'entfernen', 'meldung' => $grund];
    }
    return ['code' => $code, 'ausgang' => 'fehler', 'meldung' => $grund ?: ('HTTP ' . $code)];
}

/**
 * Der Ursprung eines Endpunkts -- "https://web.push.apple.com/xyz…" wird
 * zu "https://web.push.apple.com".
 */
// Die Dienste, an die ein Web-Push ueberhaupt gehen kann. Ausdrueckliche
// Liste und nicht "irgendein https" (ENT-501):
//
// Bis hierher genuegte ein gueltiges https-Schema. Damit konnte JEDE
// angemeldete Person -- push_einrichtung.php verlangt bewusst kein
// besonderes Recht, jeder darf sein eigenes Geraet anmelden -- eine
// beliebige Adresse als "Endpunkt" hinterlegen, und der Server rief sie
// danach von sich aus auf. Der Antwortcode wird vermerkt; damit laesst sich
// abtasten, was vom Server aus erreichbar ist (SSRF).
//
// Ein Push-Endpunkt ist nie eine frei gewaehlte Adresse: Er kommt aus
// PushSubscription.endpoint des Browsers und zeigt immer auf den
// Push-Dienst des jeweiligen Herstellers. Eine Liste ist hier also keine
// Einschraenkung des Normalbetriebs, sondern seine Beschreibung.
//
// Wenn ein Hersteller kuenftig eine neue Domain benutzt, faellt das
// unmittelbar auf: push_einrichtung.php antwortet dann "Kein gueltiger
// Endpunkt" -- ein sichtbares Nein statt einer stillen Oeffnung.
const PUSH_DIENSTE = [
    'android.googleapis.com',            // Chrome (alt)
    'fcm.googleapis.com',                // Chrome/Android
    'updates.push.services.mozilla.com', // Firefox
    'web.push.apple.com',                // Safari/iOS
    'notify.windows.com',                // Edge/Windows
];

// Gehoert dieser Rechnername zu einem der Dienste oben? Entweder genau der
// Name oder eine Unterdomain davon -- ".notify.windows.com" mit fuehrendem
// Punkt geprueft, damit "boesenotify.windows.com" NICHT passt.
function push_dienst_bekannt(string $host): bool
{
    $host = strtolower(rtrim($host, '.'));
    foreach (PUSH_DIENSTE as $dienst) {
        if ($host === $dienst || str_ends_with($host, '.' . $dienst)) { return true; }
    }
    return false;
}

function push_ursprung(string $endpunkt): ?string
{
    $t = parse_url($endpunkt);
    if (!isset($t['scheme'], $t['host']) || $t['scheme'] !== 'https') { return null; }
    if (!push_dienst_bekannt((string)$t['host'])) { return null; }
    return $t['scheme'] . '://' . $t['host'];
}

/**
 * Wie steht es um den Zeitgeber-Zugang? Vier verschiedene Antworten.
 *
 * Nachgetragen, weil beim Einrichten alle vier Faelle als "kein Token"
 * herauskamen -- die Meldung der Sitzungspruefung, in die der Aufruf
 * mangels gueltigem Schluessel hineinlief. "Nicht eingerichtet",
 * "Schluessel fehlt in der Adresse", "Schluessel stimmt nicht" und "nicht
 * angemeldet" verlangen vier verschiedene Handgriffe. Dieselbe Hausregel
 * wie bei push_grund(): "unbekannt" darf nie wie "keine" aussehen.
 *
 * Reine Funktion mit beiden Werten als Parameter -- so laesst sich jeder
 * Fall pruefen, ohne den Endpunkt aufzurufen.
 *
 * VERGLICHEN WIRD MIT hash_equals: Ein Vergleich, der beim ersten falschen
 * Zeichen abbricht, verraet ueber die Antwortzeit, wie viele Zeichen
 * stimmen.
 */
function push_zeitgeber_lage(string $erwartet, string $mitgegeben): string
{
    if ($erwartet === '' || str_starts_with($erwartet, '__PUSH_CRON')) {
        return 'nicht_eingerichtet';
    }
    if ($mitgegeben === '') { return 'kein_schluessel_in_der_adresse'; }
    return hash_equals($erwartet, $mitgegeben) ? 'ok' : 'falscher_schluessel';
}

// ── Der Versand ───────────────────────────────────────────────────────
/**
 * Was mit einem Abo nach der Antwort des Push-Dienstes geschehen soll.
 *
 * Drei Ausgaenge, und sie sind bewusst verschieden -- ein einzelnes
 * "hat nicht geklappt" wuerde ein totes Abo wie eine Stoerung behandeln
 * und ewig weiter anschreiben:
 *   'ok'        zugestellt (201, seltener 200/202)
 *   'entfernen' das Geraet gibt es nicht mehr (404/410)
 *   'fehler'    Stoerung, spaeter erneut versuchen (429, 5xx, kein Netz)
 */
function push_antwort_deuten(int $code): string
{
    if ($code >= 200 && $code < 300) { return 'ok'; }
    if ($code === 404 || $code === 410) { return 'entfernen'; }
    return 'fehler';
}

/**
 * Eine Benachrichtigung an ein Abo zustellen -- der EINE Einstieg, den
 * push_fuer_mitteilung() kennt (Festlegung 1). Verzweigt nach Kanal;
 * jeder Kanal bringt seinen eigenen Transportweg und seine eigene
 * Kryptografie mit.
 */
function push_zustellen(array $abo, bool $wichtig): array
{
    if ((string)($abo['kanal'] ?? 'webpush') === 'apns') {
        return push_apns_senden($abo, $wichtig);
    }
    return push_webpush_senden($abo, $wichtig);
}

/**
 * Eine Benachrichtigung an ein Web-Push-Abo zustellen.
 *
 * Ohne Nutzlast (Festlegung 2): leerer Rumpf, kein Content-Encoding.
 * "Urgency: high" nur fuer wichtige Mitteilungen -- niedrige Dringlichkeit
 * darf ein Push-Dienst zurueckhalten, bis das Geraet ohnehin wach ist.
 *
 * Der Netzzugriff steckt in einer eigenen, ersetzbaren Funktion, damit
 * die Pruefung alles davor und danach ohne Netz durchspielen kann.
 */
function push_webpush_senden(array $abo, bool $wichtig): array
{
    // Zwei verschiedene Fehler, und sie brauchen zwei verschiedene Folgen
    // (ENT-501). Bis hierher gab es nur "keine https-Adresse" -> entfernen.
    // Mit der Dienstliste in push_ursprung() kaeme ein zweiter Grund dazu,
    // und der darf NICHT dasselbe tun: Nimmt ein Hersteller kuenftig eine
    // Domain, die hier fehlt, wuerde sonst bei jedem Versand ein voellig
    // gueltiges Abo geloescht -- und die Benachrichtigungen waeren auf den
    // echten Telefonen still weg, ohne dass jemand den Grund saehe.
    //
    // Darum: kaputte Adresse -> entfernen (das war nie ein Abo). Unbekannter
    // Dienst -> Fehler mit Begruendung, Abo bleibt stehen. Dieselbe
    // Hausregel wie ueberall: "unbekannt" darf nie wie "keine" aussehen.
    $endpunkt = (string)($abo['endpunkt'] ?? '');
    $teile    = parse_url($endpunkt);
    if (!isset($teile['scheme'], $teile['host']) || $teile['scheme'] !== 'https') {
        return ['code' => 0, 'ausgang' => 'entfernen', 'meldung' => 'Endpunkt ist keine https-Adresse'];
    }
    $ursprung = push_ursprung($endpunkt);
    if ($ursprung === null) {
        return ['code' => 0, 'ausgang' => 'fehler',
                'meldung' => 'Unbekannter Push-Dienst (' . $teile['host'] . ') — '
                           . 'nicht zugestellt. Gehoert er dazu, muss er in PUSH_DIENSTE ergaenzt werden.'];
    }
    $jwt = push_jwt($ursprung);
    $pub = push_oeffentlicher_schluessel();
    if ($jwt === null || $pub === null) {
        return ['code' => 0, 'ausgang' => 'fehler', 'meldung' => 'Push ist nicht eingerichtet'];
    }

    $ch = curl_init($abo['endpunkt']);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => '',
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_HTTPHEADER     => [
            'Authorization: vapid t=' . $jwt . ', k=' . $pub,
            'TTL: 86400',
            'Urgency: ' . ($wichtig ? 'high' : 'normal'),
            'Content-Length: 0',
        ],
    ]);
    $antwort = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $netzfehler = curl_error($ch);
    curl_close($ch);

    if ($antwort === false && $code === 0) {
        return ['code' => 0, 'ausgang' => 'fehler', 'meldung' => $netzfehler ?: 'keine Verbindung'];
    }
    return ['code' => $code, 'ausgang' => push_antwort_deuten($code),
            'meldung' => $code >= 300 ? trim((string)$antwort) : ''];
}

// ── Die Abos ──────────────────────────────────────────────────────────
/**
 * Die aktiven Abos der genannten Personen.
 *
 * Eine Person kann mehrere haben -- Telefon und Tablet sind zwei Geraete
 * und bekommen beide eine Benachrichtigung.
 */
function push_abos_fuer(PDO $pdo, array $mitarbeiterIds): array
{
    if (!$mitarbeiterIds) { return []; }
    $marken = implode(',', array_fill(0, count($mitarbeiterIds), '?'));
    $st = $pdo->prepare(
        "SELECT id, mitarbeiter_id, kanal, endpunkt
           FROM push_abo
          WHERE abgemeldet_am IS NULL AND mitarbeiter_id IN ($marken)"
    );
    $st->execute(array_values($mitarbeiterIds));
    return $st->fetchAll();
}

function push_abo_erfolg(PDO $pdo, int $id, string $jetzt): void
{
    $pdo->prepare('UPDATE push_abo SET letzter_erfolg = ?, fehler_zahl = 0, letzter_fehler = NULL
                    WHERE id = ?')->execute([$jetzt, $id]);
}

function push_abo_fehler(PDO $pdo, int $id, string $meldung, string $jetzt): void
{
    $pdo->prepare('UPDATE push_abo SET fehler_zahl = fehler_zahl + 1, letzter_fehler = ?,
                          letzter_fehler_am = ? WHERE id = ?')
        ->execute([mb_substr($meldung, 0, 200), $jetzt, $id]);
}

/**
 * Ein Abo abmelden -- beim Abschalten durch die Person selbst ODER wenn
 * der Push-Dienst 404/410 meldet.
 *
 * ABGEMELDET, NICHT GELOESCHT: Dieselbe Haltung wie beim Archivieren einer
 * Mitteilung (ENT-421). Wer nachvollziehen will, warum jemand keine
 * Benachrichtigung bekommen hat, braucht den Eintrag noch.
 */
function push_abo_abmelden(PDO $pdo, int $id, string $grund, string $jetzt): void
{
    $pdo->prepare('UPDATE push_abo SET abgemeldet_am = ?, abmeldegrund = ? WHERE id = ?')
        ->execute([$jetzt, mb_substr($grund, 0, 100), $id]);
}

// ── Wer bekommt eine Benachrichtigung? ────────────────────────────────
/**
 * Die Personen, die diese Mitteilung sehen duerfen -- dieselbe Regel wie
 * in mitteilungen.php, nur andersherum gefragt.
 *
 * BEWUSST NICHT die Sichtbarkeitsbedingung nachgebaut: Zielgruppe 'alle'
 * heisst alle aktiven Konten, 'revier' heisst die mit
 * revierdienst_berechtigt. Das Zeitfenster prueft der Aufrufer, denn es
 * entscheidet ob ueberhaupt verschickt wird, nicht an wen.
 *
 * Ohne die Spalte revierdienst_berechtigt (Einrichtung noch nicht
 * gelaufen) wird an NIEMANDEN verschickt statt an alle -- im Zweifel
 * weniger, nicht mehr. Sonst bekaeme die ganze Belegschaft eine
 * Benachrichtigung zu einer Mitteilung, die nur den Revierdienst angeht.
 */
function push_empfaenger(PDO $pdo, string $zielgruppe): array
{
    if ($zielgruppe === 'revier') {
        if (!hat_spalte($pdo, 'mitarbeiter', 'revierdienst_berechtigt')) { return []; }
        $st = $pdo->query('SELECT id FROM mitarbeiter WHERE aktiv = 1 AND revierdienst_berechtigt = 1');
    } elseif ($zielgruppe === 'alle') {
        $st = $pdo->query('SELECT id FROM mitarbeiter WHERE aktiv = 1');
    } else {
        // Unbekannte Zielgruppe: niemand. Gleiche Haltung wie
        // mitteilung_sichtbar_fuer() -- ein Tippfehler in der Datenbank
        // darf keine Benachrichtigung an alle ausloesen.
        return [];
    }
    return array_map('intval', array_column($st->fetchAll(), 'id'));
}

/**
 * Eine Mitteilung an alle passenden Geraete verschicken.
 *
 * Gibt eine Bilanz zurueck: verschickt / entfernt / gescheitert. Sie wird
 * an der Mitteilung gespeichert, damit die Verwaltung sieht, was
 * tatsaechlich hinausging -- "an 12 Geraete verschickt" darf keine
 * Behauptung sein.
 *
 * DER VERFASSER BEKOMMT SIE AUCH -- seit dem ersten Einsatz geaendert.
 * Zuerst war er ausgenommen ("wer veroeffentlicht, weiss Bescheid"). Beim
 * Einrichten fiel auf, dass das ein Widerspruch war: Ueberall sonst ist er
 * ein normaler Empfaenger. Seine eigene Mitteilung steht in seiner
 * App-Liste, zaehlt bei ihm als ungelesen ("0 von 2 gelesen" zaehlt ihn
 * mit), und bei "wichtig" legt sich das Bestaetigungsfenster auch ueber
 * seinen Bildschirm. Nur der Push nahm ihn aus. Entweder Empfaenger oder
 * nicht -- vom Projektinhaber so entschieden.
 *
 * Nebenwirkung, die dazugehoert: Nach dem Klick auf "Veroeffentlichen"
 * meldet sich das eigene Telefon einmal.
 */
function push_fuer_mitteilung(PDO $pdo, array $m, string $jetzt): array
{
    $bilanz = ['geraete' => 0, 'zugestellt' => 0, 'entfernt' => 0, 'fehler' => 0];
    if (!push_konfiguriert() || !hat_tabelle($pdo, 'push_abo')) { return $bilanz; }

    $abos = push_abos_fuer_mitteilung($pdo, $m);
    $wichtig = (string)($m['stufe'] ?? 'normal') === 'wichtig';

    foreach ($abos as $abo) {
        $bilanz['geraete']++;
        $e = push_zustellen($abo, $wichtig);
        if ($e['ausgang'] === 'ok') {
            $bilanz['zugestellt']++;
            push_abo_erfolg($pdo, (int)$abo['id'], $jetzt);
        } elseif ($e['ausgang'] === 'entfernen') {
            $bilanz['entfernt']++;
            push_abo_abmelden($pdo, (int)$abo['id'], 'Push-Dienst: ' . $e['code'], $jetzt);
        } else {
            $bilanz['fehler']++;
            push_abo_fehler($pdo, (int)$abo['id'], $e['meldung'] ?: ('HTTP ' . $e['code']), $jetzt);
        }
    }
    return $bilanz;
}

/**
 * Welche Geraete diese Mitteilung anschreibt.
 *
 * Eigene Funktion und nicht in push_fuer_mitteilung() eingebaut, damit sich
 * die Frage "wer bekommt sie?" ohne Netz pruefen laesst -- der Versand
 * selbst braucht einen echten Push-Dienst, die Auswahl nicht.
 *
 * Der Verfasser ist NICHT ausgenommen, siehe push_fuer_mitteilung().
 */
function push_abos_fuer_mitteilung(PDO $pdo, array $m): array
{
    return push_abos_fuer($pdo, push_empfaenger($pdo, (string)($m['zielgruppe'] ?? '')));
}

/**
 * Vermerkt an der Mitteilung, dass (und mit welchem Ergebnis) verschickt
 * wurde. push_gesendet_am ist zugleich die Sperre gegen ein zweites Mal --
 * ohne sie schickte jeder Nachzuegler-Lauf dieselbe Meldung erneut.
 */
function push_mitteilung_vermerken(PDO $pdo, int $mitteilungId, array $bilanz, string $jetzt): void
{
    $pdo->prepare('UPDATE mitteilungen SET push_gesendet_am = ?, push_bilanz = ? WHERE id = ?')
        ->execute([$jetzt, (string)json_encode($bilanz), $mitteilungId]);
}

/**
 * Alle Mitteilungen, die jetzt sichtbar geworden sind und noch keine
 * Benachrichtigung ausgeloest haben.
 *
 * Deckt zwei Faelle mit derselben Abfrage: die eben gespeicherte Mitteilung
 * (sichtbar_ab leer) und die vorbereitete, deren Zeitpunkt inzwischen
 * erreicht ist. Abgelaufene und zurueckgezogene bleiben aussen vor -- eine
 * Benachrichtigung zu etwas, das in der App nicht mehr steht, waere die
 * schlechteste aller Meldungen.
 */
function push_faellige_mitteilungen(PDO $pdo, string $jetzt): array
{
    $st = $pdo->prepare(
        'SELECT id, titel, zielgruppe, stufe, verfasser_id
           FROM mitteilungen
          WHERE push_gesendet_am IS NULL
            AND archiviert_am IS NULL
            AND (sichtbar_ab IS NULL OR sichtbar_ab <= ?)
            AND (sichtbar_bis IS NULL OR sichtbar_bis >= ?)
          ORDER BY id'
    );
    $st->execute([$jetzt, $jetzt]);
    return $st->fetchAll();
}
