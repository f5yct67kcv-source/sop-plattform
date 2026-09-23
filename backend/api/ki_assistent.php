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

$antwort = anthropic_assistent($nachrichten, $heute);
if ($antwort === null) {
    ki_fehler_melden();
}
json_response(['status' => 'ok'] + $antwort);
