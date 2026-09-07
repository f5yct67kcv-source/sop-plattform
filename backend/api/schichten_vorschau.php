<?php
// Zeigt, welche Schichten im Zeitraum aus den Masterschichten eines Objekts
// entstehen wuerden (ENT-021). Schreibt nichts.
//
// Das ist die Entsprechung des Pruefschritts aus ENT-015 fuer Massenbefehle:
// Statt eines vorbefuellten Formulars sieht der Admin die vollstaendige Liste
// dessen, was angelegt wuerde, und bestaetigt erst danach.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require __DIR__ . '/../planung.php';

$user = require_session();
require_recht($user, 'einsaetze_lesen');

$objektId = (int)($_GET['objekt_id'] ?? 0);
$von = trim((string)($_GET['von'] ?? ''));
$bis = trim((string)($_GET['bis'] ?? ''));

foreach (['von' => $von, 'bis' => $bis] as $feld => $wert) {
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $wert)) {
        json_response(['status' => 'error', 'message' => "$feld im Format JJJJ-MM-TT erforderlich"], 400);
    }
}
if ($bis < $von) {
    json_response(['status' => 'error', 'message' => 'Das Enddatum liegt vor dem Beginn'], 400);
}
$tage = (int)(new DateTimeImmutable($von))->diff(new DateTimeImmutable($bis))->format('%a');
if ($tage > 400) {
    json_response(['status' => 'error', 'message' => 'Hoechstens 400 Tage auf einmal'], 400);
}

$v = planung_vorschlag($objektId, $von, $bis);
if (isset($v['fehler'])) {
    json_response(['status' => 'error', 'message' => $v['fehler']], 404);
}

// Die Liste kann lang werden. Gezeigt wird ein Ausschnitt, gezaehlt wird
// vollstaendig -- eine stillschweigende Kuerzung waere irrefuehrend.
$gesamt = count($v['neu']);
$ausschnitt = array_slice($v['neu'], 0, 200);

json_response([
    'status' => 'ok',
    'objekt' => $v['objekt'],
    'von' => $von,
    'bis' => $bis,
    'anzahl' => $gesamt,
    'gezeigt' => count($ausschnitt),
    'schichten' => $ausschnitt,
    'uebersprungen' => $v['uebersprungen'],
    'vorlagen' => $v['vorlagen'],
    'feiertage' => $v['feiertage'],
]);
