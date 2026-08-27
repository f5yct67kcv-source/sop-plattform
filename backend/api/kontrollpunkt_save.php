<?php
// Legt einen Kontrollpunkt an oder aendert ihn (ENT-132/ENT-180). Ohne "id"
// wird angelegt. Aendert nur die Vorlage -- bereits erfasste rundgang_scan
// bleiben unberuehrt (siehe Kommentar bei der Tabelle in
// planung_einrichten.php).
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';

$user = require_session();
require_recht($user, 'rundgang_verwalten');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$input = json_decode(file_get_contents('php://input'), true) ?? [];

$id          = isset($input['id']) ? (int)$input['id'] : 0;
$objektId    = isset($input['objekt_id']) ? (int)$input['objekt_id'] : 0;
$bezeichnung = trim((string)($input['bezeichnung'] ?? ''));
$reihenfolge = isset($input['reihenfolge']) ? (int)$input['reihenfolge'] : 0;
$typ         = trim((string)($input['typ'] ?? ''));
$chipId      = trim((string)($input['chip_id'] ?? '')) ?: null;
$lat         = isset($input['lat']) && $input['lat'] !== '' ? (float)$input['lat'] : null;
$lng         = isset($input['lng']) && $input['lng'] !== '' ? (float)$input['lng'] : null;
// Default 20m (ENT-132-N1), je Punkt uebersteuerbar.
$radius      = isset($input['geofence_radius_m']) && $input['geofence_radius_m'] !== ''
    ? (int)$input['geofence_radius_m'] : 20;
$aktiv       = !empty($input['aktiv']) ? 1 : 0;

if ($objektId <= 0 || $bezeichnung === '') {
    json_response(['status' => 'error', 'message' => 'Objekt und Bezeichnung erforderlich'], 400);
}
if (!in_array($typ, ['nfc', 'geofence'], true)) {
    json_response(['status' => 'error', 'message' => "typ muss 'nfc' oder 'geofence' sein"], 400);
}
if ($typ === 'nfc' && $chipId === null) {
    json_response(['status' => 'error', 'message' => 'Chip-ID erforderlich bei Typ nfc'], 400);
}
if ($typ === 'geofence' && ($lat === null || $lng === null)) {
    json_response(['status' => 'error', 'message' => 'lat/lng erforderlich bei Typ geofence'], 400);
}

$objektChk = db()->prepare('SELECT id FROM objekte WHERE id = ?');
$objektChk->execute([$objektId]);
if (!$objektChk->fetch()) {
    json_response(['status' => 'error', 'message' => 'Objekt nicht gefunden'], 404);
}

if ($id > 0) {
    $stmt = db()->prepare(
        'UPDATE kontrollpunkt SET objekt_id = ?, bezeichnung = ?, reihenfolge = ?, typ = ?,
                chip_id = ?, lat = ?, lng = ?, geofence_radius_m = ?, aktiv = ? WHERE id = ?'
    );
    $stmt->execute([$objektId, $bezeichnung, $reihenfolge, $typ, $chipId, $lat, $lng, $radius, $aktiv, $id]);
    $chk = db()->prepare('SELECT id FROM kontrollpunkt WHERE id = ?');
    $chk->execute([$id]);
    if (!$chk->fetch()) {
        json_response(['status' => 'error', 'message' => 'Kontrollpunkt nicht gefunden'], 404);
    }
} else {
    $stmt = db()->prepare(
        'INSERT INTO kontrollpunkt (objekt_id, bezeichnung, reihenfolge, typ, chip_id, lat, lng, geofence_radius_m, aktiv)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $stmt->execute([$objektId, $bezeichnung, $reihenfolge, $typ, $chipId, $lat, $lng, $radius, $aktiv]);
    $id = (int)db()->lastInsertId();
}

json_response(['status' => 'ok', 'id' => $id]);
