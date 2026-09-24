<?php
// Sprachmodell fuer das Weckwort "Hallo Waechter" (ENT-702, Stand ENT-703).
//   GET  ?stand=1  -> Stand der Vorbereitung (schnell)
//   POST           -> Vorbereitung anstossen (holt das Modell einmal; laeuft
//                     weiter, auch wenn die Anfrage abbricht)
//   GET            -> das fertige Modell (tar.gz), sonst 409 mit Stand
// Nur ausserhalb von Produktion und Demo, wie der Assistent selbst.
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

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    $grund = weckwort_bereitstellen();
    json_response(['status' => $grund === '' ? 'ok' : 'error', 'message' => $grund] + weckwort_stand(), $grund === '' ? 200 : 503);
}
if (isset($_GET['stand'])) {
    json_response(['status' => 'ok'] + weckwort_stand());
}
$stand = weckwort_stand();
if ($stand['phase'] !== 'fertig') {
    json_response(['status' => 'error', 'grund' => 'nicht_bereit', 'message' => 'Das Sprachmodell ist noch nicht bereit.'] + $stand, 409);
}
$datei = weckwort_modell_datei();
header('Content-Type: application/gzip');
header('Content-Length: ' . filesize($datei));
header('Cache-Control: private, max-age=2592000');
readfile($datei);
