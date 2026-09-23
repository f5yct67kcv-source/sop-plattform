<?php
// Liefert das Sprachmodell fuer das Weckwort "Hallo Waechter" aus (ENT-702).
// Beim ersten Aufruf holt der Server es einmal (siehe weckwort.php). Nur
// ausserhalb von Produktion und Demo, wie der Assistent selbst.
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

$grund = weckwort_bereitstellen();
if ($grund !== '') {
    json_response(['status' => 'error', 'grund' => 'modell_fehlt', 'message' => $grund], 503);
}
$datei = weckwort_modell_datei();
header('Content-Type: application/gzip');
header('Content-Length: ' . filesize($datei));
header('Cache-Control: private, max-age=2592000');
readfile($datei);
