<?php
// Archiviert einen Kunden oder holt ihn zurueck (ENT-040). Kein Loeschen:
// Objekte und Einsaetze, die per kunde_id verweisen, bleiben unveraendert
// bestehen, Rapporte sowieso (eigener Namens-Schnappschuss, kein Verweis).
// Der Kunde verschwindet nur aus der aktiven Auswahl.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';

$user = require_session();
require_recht($user, 'kunden_schreiben');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$input = json_decode(file_get_contents('php://input'), true) ?? [];
$id = (int)($input['id'] ?? 0);
$aktiv = !empty($input['aktiv']) ? 1 : 0;
if ($id <= 0) {
    json_response(['status' => 'error', 'message' => 'id erforderlich'], 400);
}

$stmt = db()->prepare('UPDATE kunden SET aktiv = ? WHERE id = ?');
$stmt->execute([$aktiv, $id]);

$chk = db()->prepare('SELECT id FROM kunden WHERE id = ?');
$chk->execute([$id]);
if (!$chk->fetch()) {
    json_response(['status' => 'error', 'message' => 'Kunde nicht gefunden'], 404);
}

json_response(['status' => 'ok', 'aktiv' => $aktiv]);
