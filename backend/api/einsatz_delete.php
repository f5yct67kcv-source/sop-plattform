<?php
// Loescht einen geplanten Einsatz (ENT-020). Die Zuteilungen verschwinden
// per ON DELETE CASCADE mit. Bereits erfasste Rapporte sind davon nicht
// betroffen -- sie haengen nicht am Einsatz.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require __DIR__ . '/../planung.php';

$user = require_session();
require_recht($user, 'einsaetze_schreiben');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$input = json_decode(file_get_contents('php://input'), true) ?? [];
$id = (int)($input['id'] ?? 0);
if ($id <= 0) {
    json_response(['status' => 'error', 'message' => 'id erforderlich'], 400);
}
// Was abgeglichen ist, wird nicht mehr geloescht (ENT-045).
einsatz_sperre_pruefen(db(), $id);

$stmt = db()->prepare('DELETE FROM einsaetze WHERE id = ?');
$stmt->execute([$id]);
if ($stmt->rowCount() === 0) {
    json_response(['status' => 'error', 'message' => 'Einsatz nicht gefunden'], 404);
}

json_response(['status' => 'ok']);
