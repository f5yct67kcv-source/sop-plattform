<?php
// Archiviert eine Leistung oder holt sie zurueck (ENT-605). Kein Loeschen:
// Positionszeilen verweisen per produkt_id zurueck, und ein Verweis ins
// Leere waere schlimmer als ein ausgeblendeter Eintrag.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';

require_betreiber_voll();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$in    = json_decode(file_get_contents('php://input'), true) ?? [];
$id    = (int)($in['id'] ?? 0);
$aktiv = !empty($in['aktiv']) ? 1 : 0;
if ($id <= 0) {
    json_response(['status' => 'error', 'message' => 'id erforderlich'], 400);
}

$pdo = betreiber_db();
$pdo->prepare('UPDATE be_produkte SET aktiv = ? WHERE id = ?')->execute([$aktiv, $id]);

$chk = $pdo->prepare('SELECT id FROM be_produkte WHERE id = ?');
$chk->execute([$id]);
if (!$chk->fetch()) {
    json_response(['status' => 'error', 'message' => 'Leistung nicht gefunden'], 404);
}

json_response(['status' => 'ok', 'aktiv' => $aktiv]);
