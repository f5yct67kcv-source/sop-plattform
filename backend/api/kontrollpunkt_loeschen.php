<?php
// Entfernt einen Kontrollpunkt aus der Vorlage (ENT-132/ENT-180). Bereits
// erfasste rundgang_scan-Eintraege bleiben als Nachweis stehen --
// kontrollpunkt_id wird dort ON DELETE SET NULL, nicht mitgeloescht.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';

$user = require_session();
require_recht($user, 'rundgang_verwalten');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$input = json_decode(file_get_contents('php://input'), true) ?? [];
$id = isset($input['id']) ? (int)$input['id'] : 0;
if ($id <= 0) {
    json_response(['status' => 'error', 'message' => 'id erforderlich'], 400);
}

$stmt = db()->prepare('DELETE FROM kontrollpunkt WHERE id = ?');
$stmt->execute([$id]);
if ($stmt->rowCount() === 0) {
    json_response(['status' => 'error', 'message' => 'Kontrollpunkt nicht gefunden'], 404);
}

json_response(['status' => 'ok']);
