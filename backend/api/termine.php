<?php
declare(strict_types=1);
// Terminbuchung "Betrieb besprechen" (gespraech.html auf guardops.ch).
//
//   GET                    freie Zeiten als JSON
//   POST aktion=buchen     Termin eintragen, Bestaetigung an beide Seiten
//   POST aktion=absagen    Termin loeschen (Link aus der Bestaetigung)
//
// OEFFENTLICH, OHNE SITZUNG -- wie api/demo_senden.php: Wer hier bucht, ist
// ein Interessent, kein Konto. Statt eines Rechts stehen dieselben Riegel:
// feste Feldliste, die dateibasierte Bremse (eigener Namensraum "termin:"),
// Fallenfeld und Zeitfalle, Zustellbarkeit der Adresse. Der Empfaenger der
// internen Meldung kommt aus dem Deploy (demo_empfaenger()), der Kalender-
// zugang ebenso (termin_zugang()). Absagen geht nur mit der Signatur aus der
// Bestaetigung.
//
// VIER ZUSTAENDE, VIER TEXTE (Hausregel "unbekannt ist nicht keine"):
// nicht eingerichtet (503 nicht_eingerichtet), Kalender antwortet nicht
// (503 kalender_stumm), nichts frei (200 mit leeren Tagen) und freie Zeiten
// (200). Die Seite zeigt fuer jeden einen eigenen Text.
//
// DIESER ENDPUNKT LIEGT AUCH IM BUENDEL DER SOFTWARE, weil der Deploy
// backend/api/*.php pauschal kopiert. Dort fehlt termine_kalender.php mit
// Absicht -- dann antwortet er "nicht eingerichtet", statt abzubrechen.
require __DIR__ . '/../db.php';

if (!is_file(__DIR__ . '/../termine_kalender.php')) {
    json_response(['status' => 'error', 'grund' => 'nicht_eingerichtet',
        'message' => 'Die Terminbuchung ist hier nicht eingerichtet.'], 503);
}
require __DIR__ . '/../termine_kalender.php';
require __DIR__ . '/../demo_bremse.php';
require __DIR__ . '/../mailer.php';
require __DIR__ . '/../demo_anfrage.php';

header('Cache-Control: no-store');
date_default_timezone_set(TERMIN_ZONE);
mb_internal_encoding('UTF-8');

$zugang = termin_zugang();
if ($zugang === null) {
    json_response(['status' => 'error', 'grund' => 'nicht_eingerichtet',
        'message' => 'Die Online-Terminwahl ist noch nicht eingerichtet.'], 503);
}

$methode = $_SERVER['REQUEST_METHOD'] ?? '';

// ── Freie Zeiten ───────────────────────────────────────────────────────
if ($methode === 'GET') {
    $ablage = termin_zwischenspeicher();
    $alt = @json_decode((string)@file_get_contents($ablage), true);
    if (is_array($alt) && ($alt['zeit'] ?? 0) > time() - TERMIN_ZWISCHENSPEICHER_S && is_array($alt['tage'] ?? null)) {
        json_response(['status' => 'ok', 'dauer' => TERMIN_DAUER_MIN, 'tage' => (object)$alt['tage']]);
    }
    $von = termin_fruehestens();
    $bis = termin_spaetestens();
    $termine = termine_holen($zugang, $von->modify('-1 day'), $bis);
    if ($termine === null) {
        json_response(['status' => 'error', 'grund' => 'kalender_stumm',
            'message' => 'Der Kalender antwortet gerade nicht.'], 503);
    }
    $tage = termin_freie_zeiten($termine, $von, $bis);
    @file_put_contents($ablage, json_encode(['zeit' => time(), 'tage' => $tage]), LOCK_EX);
    json_response(['status' => 'ok', 'dauer' => TERMIN_DAUER_MIN, 'tage' => (object)$tage]);
}

if ($methode !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur GET und POST'], 405);
}

// Nur von der eigenen Seite. Verglichen wird mit der festen Adresse, nie mit
// dem Host-Kopf der Anfrage (ENT-501). Ohne Origin (kein Browser) faellt
// dieser Riegel weg; die uebrigen bleiben.
$herkunft = (string)($_SERVER['HTTP_ORIGIN'] ?? '');
if ($herkunft !== '' && !in_array(rtrim($herkunft, '/'), [TERMIN_SEITE, 'https://www.guardops.ch'], true)) {
    json_response(['status' => 'error', 'message' => 'fremde Herkunft'], 403);
}

$in = json_decode((string)file_get_contents('php://input'), true);
if (!is_array($in)) {
    json_response(['status' => 'error', 'message' => 'Ungültige Anfrage.'], 400);
}
$aktion = termin_zeile($in['aktion'] ?? '', 20);

// ── Absagen ────────────────────────────────────────────────────────────
if ($aktion === 'absagen') {
    $uid = termin_zeile($in['uid'] ?? '', 60);
    $t = termin_zeile($in['t'] ?? '', 80);
    if (!termin_uid_gueltig($uid) || !hash_equals(termin_schluessel($zugang, $uid), $t)) {
        json_response(['status' => 'error', 'message' => 'Dieser Absage-Link ist ungültig.'], 403);
    }
    [$code, $ics] = termin_dav($zugang, 'GET', $zugang['url'] . $uid . '.ics');
    if ($code === 404) { json_response(['status' => 'ok', 'schon' => true]); }
    if ($code !== 200) {
        json_response(['status' => 'error', 'grund' => 'kalender_stumm',
            'message' => 'Der Kalender antwortet gerade nicht. Bitte später noch einmal versuchen.'], 503);
    }
    $termin = termin_ics_lesen($ics)[0] ?? null;
    [$code] = termin_dav($zugang, 'DELETE', $zugang['url'] . $uid . '.ics');
    if (!in_array($code, [200, 204, 404], true)) {
        json_response(['status' => 'error', 'grund' => 'kalender_stumm',
            'message' => 'Der Kalender antwortet gerade nicht. Bitte später noch einmal versuchen.'], 503);
    }
    @unlink(termin_zwischenspeicher());
    $wann = $termin ? termin_in_worten($termin['beginn']) : '';
    $empfaenger = demo_empfaenger();
    if ($empfaenger !== null && smtp_konfiguriert()) {
        try {
            $titel = (string)($termin['titel'] ?? 'Gespräch');
            smtp_senden($empfaenger, '', 'Abgesagt: ' . $titel,
                '<p>Dieses Gespräch wurde über den Link in der Bestätigung abgesagt:</p><p><b>'
                . htmlspecialchars($titel, ENT_QUOTES, 'UTF-8') . '</b><br>' . htmlspecialchars($wann, ENT_QUOTES, 'UTF-8')
                . '</p><p>Der Termin ist aus dem Kalender «Gespräche» entfernt, die Zeit ist wieder frei.</p>',
                "Dieses Gespräch wurde über den Link in der Bestätigung abgesagt:\n\n$titel\n$wann\n\n"
                . 'Der Termin ist aus dem Kalender «Gespräche» entfernt, die Zeit ist wieder frei.');
        } catch (Throwable $e) {
            error_log('Terminabsage: ' . $e->getMessage());
        }
    }
    json_response(['status' => 'ok', 'wann' => $wann]);
}

if ($aktion !== 'buchen') {
    json_response(['status' => 'error', 'message' => 'Unbekannte Aktion.'], 400);
}

// ── Buchen ─────────────────────────────────────────────────────────────

// Die Bremse VOR allem anderen, wie in demo_senden.php.
try {
    $sperre = demo_bremse_pruefen('termin:' . demo_bremse_adresse());
} catch (Throwable $e) {
    json_response(['status' => 'error',
        'message' => 'Die Terminbuchung ist zurzeit nicht verfügbar. Bitte versuchen Sie es in einigen Minuten erneut.'], 503);
}
if ($sperre > 0) {
    json_response(['status' => 'error', 'message' => "Zu viele Buchungen von dieser Adresse. Bitte $sperre Minuten warten."], 429);
}

// Skript erkannt: dieselbe Antwort wie fuer Menschen, aber kein Eintrag.
if (termin_zeile($in['website'] ?? '') !== '' || (int)($in['dauer'] ?? 0) < TERMIN_MINDESTDAUER_MS) {
    json_response(['status' => 'ok', 'wann' => '']);
}

$geprueft = termin_eingabe_pruefen($in);
if ($geprueft['fehler'] !== []) {
    json_response(['status' => 'error', 'message' => 'Bitte die markierten Felder prüfen.',
        'felder' => $geprueft['fehler']], 400);
}
$w = $geprueft['werte'];
if (demo_adresse_zustellbar($w['email']) === false) {
    json_response(['status' => 'error',
        'message' => 'Zu dieser E-Mail-Adresse gibt es keinen Mailserver. Bitte die Schreibweise prüfen.',
        'felder' => ['email' => 'Diese Adresse konnten wir nicht erreichen.']], 400);
}

// Ohne Versand keine Buchung: Ein Termin, von dem niemand erfaehrt, ist
// schlechter als keiner. Geprueft VOR dem Eintragen.
$empfaenger = demo_empfaenger();
if ($empfaenger === null || !smtp_konfiguriert()) {
    json_response(['status' => 'error', 'grund' => 'nicht_eingerichtet',
        'message' => 'Die Bestätigung per E-Mail ist noch nicht eingerichtet.'], 503);
}

$beginn = $w['beginn'];
$wann = termin_in_worten($beginn);
$uid = TERMIN_UID_PRAEFIX . bin2hex(random_bytes(10));
$raum = $w['art'] === 'video' ? TERMIN_VIDEO_RAUM . bin2hex(random_bytes(8)) : '';
$beschreibung = 'Betrieb: ' . $w['firma'] . "\nTelefon: " . $w['telefon'] . "\nE-Mail: " . $w['email']
    . "\nArt: " . TERMIN_ARTEN[$w['art']] . ($raum !== '' ? "\nVideo: $raum" : '')
    . "\n\nGebucht über guardops.ch/gespraech.html";

// Pruefen und Eintragen unter Sperre: zwei gleichzeitige Buchungen auf
// DIESER Seite bekommen nicht dieselbe Zeit. Gegen einen Eintrag von Hand
// im selben Augenblick schuetzt die Nachkontrolle weiter unten.
$sperrDatei = fopen(sys_get_temp_dir() . '/guardops-termine-sperre', 'c');
if ($sperrDatei) { flock($sperrDatei, LOCK_EX); }
$entsperren = function () use ($sperrDatei) { if ($sperrDatei) { flock($sperrDatei, LOCK_UN); } };

$von = termin_fruehestens();
$bis = termin_spaetestens();
$termine = termine_holen($zugang, $von->modify('-1 day'), $bis);
$eingetragen = false;
if ($termine !== null) {
    $frei = termin_freie_zeiten($termine, $von, $bis);
    if (!in_array($beginn->format('H:i'), $frei[$beginn->format('Y-m-d')] ?? [], true)) {
        $entsperren();
        json_response(['status' => 'error', 'grund' => 'besetzt',
            'message' => 'Diese Zeit ist inzwischen vergeben. Bitte eine andere wählen.'], 409);
    }
    [$code] = termin_dav($zugang, 'PUT', $zugang['url'] . $uid . '.ics',
        termin_ics($uid, $beginn, termin_titel($w), $beschreibung, '', $raum),
        ['Content-Type: text/calendar; charset=utf-8', 'If-None-Match: *']);
    $eingetragen = in_array($code, [200, 201, 204], true);

    // Nachkontrolle: Hat sich in derselben Zeit etwas anderes eingetragen
    // (ein Termin von Hand)? Dann gibt diese Seite nach.
    if ($eingetragen) {
        $tag = $beginn->setTime(0, 0);
        $nachher = termine_holen($zugang, $tag, $tag->modify('+1 day'));
        if ($nachher !== null && termin_ueberschneidung($nachher, $beginn->getTimestamp(), $uid, $tag->modify('+1 day'))) {
            termin_dav($zugang, 'DELETE', $zugang['url'] . $uid . '.ics');
            @unlink(termin_zwischenspeicher());
            $entsperren();
            json_response(['status' => 'error', 'grund' => 'besetzt',
                'message' => 'Diese Zeit wurde gerade eben vergeben. Bitte eine andere wählen.'], 409);
        }
    }
}
@unlink(termin_zwischenspeicher());
$entsperren();

// Kalender nicht erreichbar: nichts geht verloren, der Wunsch geht per Mail
// zur Bestaetigung von Hand. Die Seite sagt das so -- kein falsches "gebucht".
if (!$eingetragen) {
    [$text, $html] = termin_mail_intern($w, $wann, '', 'Der Kalender war nicht erreichbar. Der Termin steht NICHT drin -- bitte eintragen und von Hand bestätigen.');
    try {
        smtp_senden($empfaenger, '', 'Terminwunsch, NICHT eingetragen: ' . $w['firma'], $html, $text, [], [], $w['email']);
    } catch (Throwable $e) {
        json_response(['status' => 'error',
            'message' => 'Der Termin konnte nicht gebucht werden. Bitte schreiben Sie an info@guardops.ch.'], 502);
    }
    json_response(['status' => 'ok', 'wann' => $wann, 'vorbehalt' => true]);
}

[$text, $html] = termin_mail_intern($w, $wann, $raum);
try {
    smtp_senden($empfaenger, '', 'Neues Gespräch GuardOpS: ' . $w['firma'] . ', ' . $beginn->format('d.m. H:i'),
        $html, $text, [], [], $w['email']);
} catch (Throwable $e) {
    error_log('Termin intern: ' . $e->getMessage());
}

$absagen = TERMIN_SEITE . '/gespraech.html?absagen=' . $uid . '&t=' . termin_schluessel($zugang, $uid);
[$kText, $kHtml, $wie] = termin_mail_kunde($w, $wann, $absagen, $raum);
$icsKunde = termin_ics($uid, $beginn, 'Gespräch mit GuardOpS',
    $wie . ($raum !== '' ? "\n" . $raum : '') . "\n\nAbsagen: " . $absagen, 'PUBLISH', $raum);
$bestaetigt = true;
try {
    smtp_senden($w['email'], $w['name'], 'Ihr Gespräch am ' . $beginn->format('j.n.') . ' um ' . $beginn->format('H:i') . ' · GuardOpS',
        $kHtml, $kText, [['name' => 'termin.ics', 'mime' => 'text/calendar; charset=UTF-8; method=PUBLISH', 'inhalt' => $icsKunde]]);
} catch (Throwable $e) {
    $bestaetigt = false;
    error_log('Terminbestaetigung: ' . $e->getMessage());
}

json_response(['status' => 'ok', 'wann' => $wann, 'art' => $w['art'], 'raum' => $raum, 'bestaetigt' => $bestaetigt]);
