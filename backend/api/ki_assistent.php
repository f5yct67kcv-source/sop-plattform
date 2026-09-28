<?php
// Assistent (ENT-699): reicht ein Gespraech an das Modell weiter und gibt
// dessen Antwort zurueck. Die Werkzeuge laufen im Browser auf Daten, die ueber
// die bestehenden, rechtegeprueften Endpunkte geladen sind -- siehe ai.php.
// Schreibt nichts.
//
// Nur ausserhalb von Produktion und Demo. Diese Sperre ist die massgebliche;
// dass die Figur im Cockpit dort gar nicht erscheint, erspart nur den Umweg.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require __DIR__ . '/../ai.php';

$user = require_session();
require_verwaltung($user);
if (!ki_assistent_erlaubt(APP_ENV)) {
    json_response(['status' => 'error', 'grund' => 'nur_testumgebung',
        'message' => 'Der Assistent ist erst auf der Testumgebung freigeschaltet.'], 403);
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$input = json_decode(file_get_contents('php://input'), true) ?? [];
$nachrichten = ki_assistent_nachrichten_pruefen($input['messages'] ?? null);
if (!$nachrichten) {
    json_response(['status' => 'error', 'message' => 'Das Gespräch hat eine ungültige Form. Bitte neu beginnen.'], 400);
}
$heute = trim((string)($input['heute'] ?? ''));
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $heute)) {
    $heute = date('Y-m-d');
}

// Die offene Seite (ENT-716): geprueft, sonst weggelassen -- nie abgewiesen.
$bezug = ki_bezug_pruefen($input['bezug'] ?? null);

// Als Strom (ENT-716, schneller): Text kommt Stueck fuer Stueck, am Ende die
// ganze Antwort wie ohne Strom. Puffert ein Glied dazwischen (Hostpoint,
// Proxy), kommt alles am Stueck an -- der Browser kommt mit beidem zurecht.
if (!empty($input['stream'])) {
    @set_time_limit(60);
    @ini_set('zlib.output_compression', '0');
    @ini_set('output_buffering', '0');
    @ini_set('implicit_flush', '1');
    while (ob_get_level() > 0) { ob_end_flush(); }
    header('Content-Type: text/event-stream; charset=utf-8');
    header('Cache-Control: no-cache, no-transform');
    header('X-Accel-Buffering: no');
    $senden = function (array $d): void {
        echo 'data: ' . json_encode($d, JSON_UNESCAPED_UNICODE) . "\n\n";
        @flush();
    };
    // Rund 2 KB Kommentar vorweg: Manche Zwischenglieder geben erst ab einer
    // Mindestmenge weiter. Der Browser ueberspringt Kommentarzeilen.
    echo ':' . str_repeat(' ', 2048) . "\n\n";
    @flush();
    $antwort = anthropic_assistent_strom($nachrichten, $heute, $bezug, fn(string $t) => $senden(['t' => $t]));
    if ($antwort === null) {
        $f = ki_fehler_text();
        $senden(['fehler' => ['message' => $f['message'], 'grund' => $f['grund']]]);
    } else {
        $senden(['ende' => ['status' => 'ok'] + $antwort]);
    }
    exit;
}

$antwort = anthropic_assistent($nachrichten, $heute, $bezug);
if ($antwort === null) {
    ki_fehler_melden();
}
json_response(['status' => 'ok'] + $antwort);
