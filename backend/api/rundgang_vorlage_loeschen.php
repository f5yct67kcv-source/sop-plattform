<?php
// Entfernt eine Kontrollrunden-Vorlage (ENT-204). Die Punktzuordnung
// verschwindet ueber ON DELETE CASCADE mit; bereits durchgefuehrte
// Rundgaenge, die auf diese Vorlage verwiesen, bleiben als Nachweis stehen
// -- rundgang.rundgang_vorlage_id wird dort ON DELETE SET NULL, nicht
// mitgeloescht (gleiches Prinzip wie kontrollpunkt_loeschen.php).
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

$stmt = db()->prepare('DELETE FROM rundgang_vorlage WHERE id = ?');
$stmt->execute([$id]);
if ($stmt->rowCount() === 0) {
    json_response(['status' => 'error', 'message' => 'Vorlage nicht gefunden'], 404);
}

json_response(['status' => 'ok']);
