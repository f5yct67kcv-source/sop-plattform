<?php
// Geofence-Bereiche eines Objekts (ENT-286). Koordinaten kommen als
// dekodiertes Array zurueck, nicht als JSON-Text -- der Aufrufer soll sich
// nicht selbst um json_decode kuemmern muessen.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';

$user = require_session();
require_recht($user, 'rundgang_verwalten');
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_response(['status' => 'error', 'message' => 'nur GET'], 405);
}

$objektId = isset($_GET['objekt_id']) ? (int)$_GET['objekt_id'] : 0;
if ($objektId <= 0) {
    json_response(['status' => 'error', 'message' => 'objekt_id erforderlich'], 400);
}

$stmt = db()->prepare(
    'SELECT id, objekt_id, name, koordinaten, aktiv FROM geofence_bereich WHERE objekt_id = ? ORDER BY id'
);
$stmt->execute([$objektId]);
$bereiche = array_map(function (array $z): array {
    $z['koordinaten'] = json_decode((string)$z['koordinaten'], true) ?: [];
    return $z;
}, $stmt->fetchAll(PDO::FETCH_ASSOC));

json_response(['status' => 'ok', 'bereiche' => $bereiche]);
