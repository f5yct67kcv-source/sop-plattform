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
// OEFFENTLICH, OHNE SITZUNG -- bewusst, wie login.php und
// passwort_vergessen.php: Wer hier ankommt, ist ein Interessent, kein Konto.
// Darum stehen statt eines Rechts drei Riegel:
//
//   - Nur POST mit JSON und einer festen Feldliste (backend/demo_anfrage.php).
//   - Die Anmeldebremse aus ENT-075 unter dem eigenen Namensraum "demo:",
//     je Absender-Adresse. Wie bei der Passwort-Ruecksetzung (ENT-373)
//     zaehlt JEDE Anfrage, nicht nur eine falsche: Fuenf Anfragen in einer
//     Viertelstunde von derselben Adresse sind kein Interessent mehr.
//   - Das Fallenfeld: gefuellt heisst Skript. Antwort wie sonst, keine Mail.
//
// DER EMPFAENGER KOMMT AUS DEN STAMMDATEN, NIE AUS DER ANFRAGE: Die
// E-Mail-Adresse des Betriebs (Cockpit → Administration → Einstellungen →
// Betrieb, ENT-247). Ein Endpunkt, der einen Empfaenger entgegennaehme, waere
// ein offener Mailversand fuer jedermann.
//
// "NICHT EINGERICHTET" IST NICHT "FEHLGESCHLAGEN": Fehlt die Adresse oder
// der SMTP-Zugang, sagt die Antwort das ausdruecklich (503), damit der
// Interessent nicht "spaeter noch einmal" versucht, was nie gehen kann.
require __DIR__ . '/../db.php';
require __DIR__ . '/../anmeldung.php';
require __DIR__ . '/../mailer.php';
require __DIR__ . '/../demo_anfrage.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}
$in = json_decode((string)file_get_contents('php://input'), true);
if (!is_array($in)) {
    json_response(['status' => 'error', 'message' => 'Ungültige Anfrage.'], 400);
}

$pdo = db();
$adresse = anmeld_adresse();
$bremsName = 'demo:' . $adresse;
[$jeName, $jeAdresse] = anmeld_zaehlen($pdo, $bremsName, $adresse);
$sperre = anmeld_sperre($jeName, $jeAdresse);
if ($sperre > 0) {
    json_response(['status' => 'error',
        'message' => "Zu viele Anfragen von dieser Adresse. Bitte $sperre Minuten warten."], 429);
}
anmeld_fehlversuch($pdo, $bremsName, $adresse);

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

$betrieb = $pdo->query('SELECT firma, email FROM betrieb WHERE id = 1')->fetch();
$empfaenger = trim((string)($betrieb['email'] ?? ''));
if ($empfaenger === '') {
    json_response(['status' => 'error',
        'message' => 'Der Empfang von Anfragen ist noch nicht eingerichtet: Im Cockpit fehlt die E-Mail-Adresse des Betriebs.'], 503);
}
if (!smtp_konfiguriert()) {
    json_response(['status' => 'error',
        'message' => 'Der E-Mail-Versand ist noch nicht eingerichtet (SMTP-Zugangsdaten fehlen).'], 503);
}

$eingang = date('d.m.Y H:i');
try {
    smtp_senden($empfaenger, trim((string)($betrieb['firma'] ?? '')), demo_anfrage_betreff($w),
        demo_anfrage_html($w, $eingang), demo_anfrage_text($w, $eingang));
} catch (Throwable $e) {
    json_response(['status' => 'error',
        'message' => 'Die Anfrage konnte nicht übermittelt werden. Bitte versuchen Sie es später noch einmal.'], 502);
}
json_response(['status' => 'ok', 'message' => DEMO_DANKE]);
