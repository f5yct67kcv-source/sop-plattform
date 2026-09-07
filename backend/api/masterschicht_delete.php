<?php
// Entfernt eine Masterschicht (ENT-021). Sind bereits Schichten daraus
// entstanden, wird nur die Gueltigkeit auf gestern gesetzt -- die erzeugten
// Einsaetze bleiben unveraendert bestehen.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';

$user = require_session();
require_recht($user, 'masterschichten_schreiben');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$input = json_decode(file_get_contents('php://input'), true) ?? [];
$id = (int)($input['id'] ?? 0);
if ($id <= 0) {
    json_response(['status' => 'error', 'message' => 'id erforderlich'], 400);
}

$s = db()->prepare('SELECT COUNT(*) FROM einsaetze WHERE masterschicht_id = ?');
$s->execute([$id]);
$verwendet = (int)$s->fetchColumn();

if ($verwendet > 0) {
    $gestern = (new DateTimeImmutable('yesterday'))->format('Y-m-d');
    $upd = db()->prepare('UPDATE masterschichten SET gueltig_bis = ? WHERE id = ?');
    $upd->execute([$gestern, $id]);
    json_response(['status' => 'ok', 'art' => 'beendet', 'einsaetze' => $verwendet, 'gueltig_bis' => $gestern]);
}

$del = db()->prepare('DELETE FROM masterschichten WHERE id = ?');
$del->execute([$id]);
if ($del->rowCount() === 0) {
    json_response(['status' => 'error', 'message' => 'Masterschicht nicht gefunden'], 404);
}
json_response(['status' => 'ok', 'art' => 'geloescht']);
