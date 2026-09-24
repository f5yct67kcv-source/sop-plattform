<?php
// Ein hochgeladenes Bild als Unterschrift aufbereiten (ENT-706).
//
// SPEICHERT NICHTS. Zurueck kommt die aufbereitete PNG-Zeichnung fuer die
// Vorschau; erst "Uebernehmen" speichert sie ueber
// betreiber_unterschrift_speichern.php -- denselben Weg wie das Zeichnen,
// mit derselben Pruefung und nur fuers eigene Konto. So entscheidet die
// Person, nachdem sie das Ergebnis gesehen hat (ein Foto kann Flecken
// behalten).
//
// Angemeldet wie jeder Betreiber-Weg: Die Aufbereitung kostet Rechenzeit
// und soll niemandem ohne Konto zur Verfuegung stehen.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';
require_once __DIR__ . '/../belege.php';

require_betreiber_voll();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$in = json_decode(file_get_contents('php://input') ?: '', true) ?: [];
$ergebnis = beleg_unterschrift_aus_bild((string)($in['bild'] ?? ''));
if (isset($ergebnis['fehler'])) {
    json_response(['status' => 'error', 'message' => $ergebnis['fehler']], 400);
}
json_response(['status' => 'ok', 'bild' => $ergebnis['bild'],
    'grundlinie' => beleg_unterschrift_grundlinie($ergebnis['bild'])]);
