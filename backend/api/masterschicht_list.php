<?php
// Masterschichten eines Objekts (ENT-021). Standardmaessig nur die heute
// gueltigen Fassungen; mit "alle" auch abgelaufene und kuenftige.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';

$user = require_session();
require_recht($user, 'masterschichten_lesen');

$objektId = (int)($_GET['objekt_id'] ?? 0);
if ($objektId <= 0) {
    json_response(['status' => 'error', 'message' => 'objekt_id erforderlich'], 400);
}
$alle = !empty($_GET['alle']);
$heute = date('Y-m-d');

$sql = 'SELECT * FROM masterschichten WHERE objekt_id = ?';
$args = [$objektId];
if (!$alle) {
    $sql .= ' AND gueltig_ab <= ? AND (gueltig_bis IS NULL OR gueltig_bis >= ?)';
    $args[] = $heute;
    $args[] = $heute;
}
$sql .= ' ORDER BY von, name';

$stmt = db()->prepare($sql);
$stmt->execute($args);

$zahlen = ['objekt_id', 'bedarf_mo', 'bedarf_di', 'bedarf_mi', 'bedarf_do', 'bedarf_fr',
           'bedarf_sa', 'bedarf_so', 'bedarf_feiertag', 'bedarf_intervall', 'pause_min'];

$rows = array_map(function ($m) use ($zahlen, $heute) {
    $m['id'] = (int)$m['id'];
    foreach ($zahlen as $f) {
        $m[$f] = (int)$m[$f];
    }
    $m['auf_abruf'] = (int)$m['auf_abruf'];
    $m['arbeitszeit_h'] = (float)$m['arbeitszeit_h'];
    $m['intervall_tage'] = $m['intervall_tage'] === null ? null : (int)$m['intervall_tage'];
    $m['ersetzt_id'] = $m['ersetzt_id'] === null ? null : (int)$m['ersetzt_id'];
    // Damit die Oberflaeche abgelaufene Fassungen kennzeichnen kann.
    $m['laeuft'] = ($m['gueltig_ab'] <= $heute && ($m['gueltig_bis'] === null || $m['gueltig_bis'] >= $heute));
    return $m;
}, $stmt->fetchAll());

json_response(['status' => 'ok', 'masterschichten' => $rows]);
