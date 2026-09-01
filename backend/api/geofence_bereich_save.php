<?php
// Legt einen Geofence-Bereich an oder aendert ihn (ENT-286). Ohne "id" wird
// angelegt.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../geofence_bereich.php';

$user = require_session();
require_recht($user, 'rundgang_verwalten');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$input = json_decode(file_get_contents('php://input'), true) ?? [];

$id       = isset($input['id']) ? (int)$input['id'] : 0;
$objektId = isset($input['objekt_id']) ? (int)$input['objekt_id'] : 0;
$name     = trim((string)($input['name'] ?? ''));
$koord    = geofence_koordinaten_pruefen($input['koordinaten'] ?? null);

if ($objektId <= 0 || $name === '') {
    json_response(['status' => 'error', 'message' => 'Objekt und Name erforderlich'], 400);
}
if ($koord === null) {
    json_response(['status' => 'error', 'message' => 'Mindestens drei gueltige Eckpunkte erforderlich'], 400);
}

$objektChk = db()->prepare('SELECT id FROM objekte WHERE id = ?');
$objektChk->execute([$objektId]);
if (!$objektChk->fetch()) {
    json_response(['status' => 'error', 'message' => 'Objekt nicht gefunden'], 404);
}

$koordJson = json_encode($koord, JSON_UNESCAPED_UNICODE);

if ($id > 0) {
    $stmt = db()->prepare(
        'UPDATE geofence_bereich SET objekt_id = ?, name = ?, koordinaten = ? WHERE id = ?'
    );
    $stmt->execute([$objektId, $name, $koordJson, $id]);
    $chk = db()->prepare('SELECT id FROM geofence_bereich WHERE id = ?');
    $chk->execute([$id]);
    if (!$chk->fetch()) {
        json_response(['status' => 'error', 'message' => 'Geofence-Bereich nicht gefunden'], 404);
    }
} else {
    $stmt = db()->prepare(
        'INSERT INTO geofence_bereich (objekt_id, name, koordinaten) VALUES (?, ?, ?)'
    );
    $stmt->execute([$objektId, $name, $koordJson]);
    $id = (int)db()->lastInsertId();
}

json_response(['status' => 'ok', 'id' => $id]);
