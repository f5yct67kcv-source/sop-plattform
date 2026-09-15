<?php
declare(strict_types=1);
// Demo-Anfrage von der oeffentlichen Homepage entgegennehmen (ENT-469).
//
// DIESE DATEI HIESS BIS 2026-09-10 demo_anfrage.php -- genau wie der
// Rechenkern backend/demo_anfrage.php. Der Deploy legt beide flach ab, und
// die Sperrliste in htaccess-hostpoint greift ueber <FilesMatch> auf den
// DATEINAMEN, nicht auf den Pfad: Sie haette damit auch diesen Endpunkt
// gesperrt. Derselbe Fall wie bei api/lohnlauf.php (ENT-451). Der
// Rechenkern behaelt seinen Namen und bleibt gesperrt -- er gehoert dorthin.
//
// EIN ENDPUNKT, ZWEI ORTE: Diese Datei laeuft sowohl auf der eigenen Domain
// der Homepage (guardops.ch) als auch neben dem Rapport-Tool. Darum braucht
// sie KEINE Datenbank -- weder fuer den Empfaenger noch fuer die Bremse.
// Zwei Kopien desselben Formulars waeren die Konstruktion, bei der in einem
// halben Jahr nur noch eine repariert wird.
//
// OEFFENTLICH, OHNE SITZUNG -- bewusst, wie login.php und
// passwort_vergessen.php: Wer hier ankommt, ist ein Interessent, kein Konto.
// Darum stehen statt eines Rechts drei Riegel:
//
//   - Nur POST mit JSON und einer festen Feldliste (backend/demo_anfrage.php).
//   - Die dateibasierte Bremse (backend/demo_bremse.php), je Absender-
//     Adresse. Wie bei der Passwort-Ruecksetzung (ENT-373) zaehlt JEDE
//     Anfrage, nicht nur eine falsche: Fuenf Anfragen in einer Viertelstunde
//     von derselben Adresse sind kein Interessent mehr. Kann die Bremse
//     nicht zaehlen, wird ABGELEHNT, nicht gesendet -- siehe dort.
//   - Das Fallenfeld: gefuellt heisst Skript. Antwort wie sonst, keine Mail.
//   - Die Zustellbarkeit der angegebenen Adresse (demo_adresse_zustellbar()).
//     Sie weist nur ab, was nachweislich keinen Mailserver hat -- ist der
//     Namensdienst gestoert, wird durchgelassen statt falsch beschuldigt.
//
// DER EMPFAENGER KOMMT AUS DEM DEPLOY, NIE AUS DER ANFRAGE: demo_empfaenger()
// reicht den vom Deploy ersetzten Platzhalter durch eine Pruefung -- dieselbe
// Regel und derselbe Aufbau wie bei basis_url() (ENT-501). Ein Endpunkt, der
// einen Empfaenger entgegennaehme, waere ein offener Mailversand fuer
// jedermann.
//
// VIER ZUSTAENDE, VIER TEXTE: "zu viele Anfragen" (429), "Bremse kann nicht
// arbeiten" (503), "Empfaenger nicht eingerichtet" (503), "SMTP nicht
// eingerichtet" (503) und "Versand fehlgeschlagen" (502) sind verschiedene
// Aussagen. Wer sie zusammenzieht, schickt den Interessenten zurueck auf
// "spaeter noch einmal", wo nie etwas gehen wird.
require __DIR__ . '/../db.php';
require __DIR__ . '/../demo_bremse.php';
require __DIR__ . '/../mailer.php';
require __DIR__ . '/../demo_anfrage.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}
$in = json_decode((string)file_get_contents('php://input'), true);
if (!is_array($in)) {
    json_response(['status' => 'error', 'message' => 'Ungültige Anfrage.'], 400);
}

// Die Bremse VOR der Pruefung der Felder: Sonst waere das Zaehlen selbst
// davon abhaengig, dass der Angreifer ein gueltiges Formular schickt.
try {
    $sperre = demo_bremse_pruefen(demo_bremse_adresse());
} catch (Throwable $e) {
    json_response(['status' => 'error',
        'message' => 'Das Anfrageformular ist zurzeit nicht verfügbar. Bitte versuchen Sie es in einigen Minuten erneut.'], 503);
}
if ($sperre > 0) {
    json_response(['status' => 'error',
        'message' => "Zu viele Anfragen von dieser Adresse. Bitte $sperre Minuten warten."], 429);
}

$geprueft = demo_anfrage_pruefen($in);
if ($geprueft['fehler'] !== []) {
    json_response(['status' => 'error', 'message' => 'Bitte die markierten Felder prüfen.',
        'felder' => $geprueft['fehler']], 400);
}
$w = $geprueft['werte'];

// Skript erkannt: dieselbe Antwort wie fuer Menschen, aber keine Mail.
if (demo_ist_falle($in)) {
    json_response(['status' => 'ok', 'message' => DEMO_DANKE]);
}

// Gibt es die Adresse ueberhaupt? Erst NACH dem Fallenfeld, damit ein Skript
// keinen Nachschlag ausloest. null heisst "nicht pruefbar" und laesst durch --
// nur ein belegtes "diese Domain gibt es nicht" weist ab (siehe
// demo_adresse_zustellbar()).
if (demo_adresse_zustellbar($w['email']) === false) {
    json_response(['status' => 'error',
        'message' => 'Zu dieser E-Mail-Adresse gibt es keinen Mailserver. Bitte die Schreibweise prüfen.',
        'felder' => ['email' => 'Diese Adresse konnten wir nicht erreichen.']], 400);
}

$empfaenger = demo_empfaenger();
if ($empfaenger === null) {
    json_response(['status' => 'error',
        'message' => 'Der Empfang von Anfragen ist noch nicht eingerichtet: Die Empfängeradresse fehlt im Deploy.'], 503);
}
if (!smtp_konfiguriert()) {
    json_response(['status' => 'error',
        'message' => 'Der E-Mail-Versand ist noch nicht eingerichtet (SMTP-Zugangsdaten fehlen).'], 503);
}

$eingang = date('d.m.Y H:i');
try {
    smtp_senden($empfaenger, '', demo_anfrage_betreff($w),
        demo_anfrage_html($w, $eingang), demo_anfrage_text($w, $eingang));
} catch (Throwable $e) {
    json_response(['status' => 'error',
        'message' => 'Die Anfrage konnte nicht übermittelt werden. Bitte versuchen Sie es später noch einmal.'], 502);
}
json_response(['status' => 'ok', 'message' => DEMO_DANKE]);
