<?php
// Sprachmodell fuer das Weckwort "Hallo Waechter" (ENT-702, Stand ENT-703).
//   GET  ?stand=1  -> Stand der Vorbereitung (schnell)
//   POST           -> Vorbereitung anstossen (holt das Modell einmal; laeuft
//                     weiter, auch wenn die Anfrage abbricht)
//   GET  ?teil=N   -> Teil N des fertigen Modells (tar.gz), sonst 409 mit Stand.
//                     Nur in Teilen: Eine einzige lange Antwort brach auf
//                     Hostpoint bei rund 9 MB ab.
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
$bereich = weckwort_teil_bereich((int)filesize($datei), (int)($_GET['teil'] ?? -1));
if ($bereich === null) {
    json_response(['status' => 'error', 'grund' => 'teil', 'message' => 'Diesen Teil des Sprachmodells gibt es nicht.'] + $stand, 400);
}
[$anfang, $laenge] = $bereich;
@set_time_limit(120);
@ini_set('zlib.output_compression', '0');
while (ob_get_level() > 0) { ob_end_clean(); }
$fh = @fopen($datei, 'rb');
if (!$fh || fseek($fh, $anfang) !== 0) {
    json_response(['status' => 'error', 'message' => 'Das Sprachmodell liess sich auf dem Server nicht lesen.'], 500);
}
header('Content-Type: application/octet-stream');
header('Content-Length: ' . $laenge);
header('Cache-Control: private, no-transform, max-age=2592000');
$rest = $laenge;
while ($rest > 0 && !feof($fh)) {
    $block = fread($fh, min(262144, $rest));
    if ($block === false || $block === '') { break; }
    echo $block;
    flush();
    $rest -= strlen($block);
}
fclose($fh);
