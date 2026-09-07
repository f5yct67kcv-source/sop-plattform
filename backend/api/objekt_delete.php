<?php
// Entfernt ein Objekt (ENT-021). Sind bereits Schichten daraus entstanden,
// wird nur deaktiviert -- geplante und vergangene Einsaetze bleiben lesbar.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';

$user = require_session();
require_recht($user, 'objekte_schreiben');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$input = json_decode(file_get_contents('php://input'), true) ?? [];
$id = (int)($input['id'] ?? 0);
if ($id <= 0) {
    json_response(['status' => 'error', 'message' => 'id erforderlich'], 400);
}

$stmt = db()->prepare('SELECT COUNT(*) FROM einsaetze WHERE objekt_id = ?');
$stmt->execute([$id]);
$verwendet = (int)$stmt->fetchColumn();

if ($verwendet > 0) {
    $upd = db()->prepare('UPDATE objekte SET aktiv = 0 WHERE id = ?');
    $upd->execute([$id]);
    if ($upd->rowCount() === 0) {
        $chk = db()->prepare('SELECT id FROM objekte WHERE id = ?');
        $chk->execute([$id]);
        if (!$chk->fetch()) {
            json_response(['status' => 'error', 'message' => 'Objekt nicht gefunden'], 404);
        }
    }
    json_response(['status' => 'ok', 'art' => 'deaktiviert', 'einsaetze' => $verwendet]);
}

// Nie benutzt -- dann darf es wirklich weg. Die Masterschichten gehen per
// ON DELETE CASCADE mit.
$del = db()->prepare('DELETE FROM objekte WHERE id = ?');
$del->execute([$id]);
if ($del->rowCount() === 0) {
    json_response(['status' => 'error', 'message' => 'Objekt nicht gefunden'], 404);
}
json_response(['status' => 'ok', 'art' => 'geloescht']);
