<?php
// Kontrollpunkte eines Objekts, sortiert nach Reihenfolge (ENT-132/ENT-180).
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
    'SELECT id, objekt_id, bezeichnung, reihenfolge, typ, chip_id, lat, lng, geofence_radius_m, aktiv
     FROM kontrollpunkt WHERE objekt_id = ? ORDER BY reihenfolge, id'
);
$stmt->execute([$objektId]);
json_response(['status' => 'ok', 'kontrollpunkte' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
