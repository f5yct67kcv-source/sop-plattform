<?php
// Fuellt den Feiertagskalender fuer ein Jahr (ENT-021).
//
// Vorhandene Eintraege werden NICHT ueberschrieben -- wer einen Tag von Hand
// korrigiert oder ergaenzt hat (etwa einen Gemeindefeiertag), behaelt ihn.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require __DIR__ . '/../planung.php';

$user = require_session();
require_recht($user, 'masterschichten_schreiben');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$in = json_decode(file_get_contents('php://input'), true) ?? [];
$kanton = strtoupper(trim((string)($in['kanton'] ?? 'SO')));
$vonJahr = (int)($in['von_jahr'] ?? date('Y'));
$bisJahr = (int)($in['bis_jahr'] ?? $vonJahr);

if ($kanton !== 'SO') {
    // Bewusste Grenze: nur der Kanton mit heutigen Objekten ist hinterlegt.
    // Ein weiterer Kanton braucht eine eigene, belegte Liste -- nicht geraten.
    json_response(['status' => 'error', 'message' => 'Bisher ist nur der Kanton SO hinterlegt'], 400);
}
if ($vonJahr < 2020 || $bisJahr > 2100 || $bisJahr < $vonJahr || ($bisJahr - $vonJahr) > 10) {
    json_response(['status' => 'error', 'message' => 'Zeitraum zwischen 2020 und 2100, hoechstens 10 Jahre'], 400);
}

$ins = db()->prepare(
    'INSERT IGNORE INTO feiertage (datum, kanton, name, halbtags, ab_zeit, quelle)
     VALUES (?, ?, ?, ?, ?, ?)'
);

$neu = 0;
$jahre = [];
for ($jahr = $vonJahr; $jahr <= $bisJahr; $jahr++) {
    foreach (feiertage_solothurn($jahr) as $f) {
        $ins->execute([$f['datum'], $kanton, $f['name'], $f['halbtags'], $f['ab_zeit'], FEIERTAG_QUELLE]);
        $neu += $ins->rowCount();
    }
    $jahre[] = $jahr;
}

json_response([
    'status' => 'ok',
    'kanton' => $kanton,
    'jahre' => $jahre,
    'neu' => $neu,
    'quelle' => FEIERTAG_QUELLE,
]);
